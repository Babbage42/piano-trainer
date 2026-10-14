import type { Hand, Note, Song } from '../song/types';

/**
 * listen : l'app joue tout, on regarde (simulation complète).
 * wait   : le morceau s'arrête sur chaque note à jouer jusqu'à ce qu'elle soit jouée.
 * flow   : le morceau avance au tempo choisi, chaque note est jugée juste ou ratée.
 */
export type Mode = 'listen' | 'wait' | 'flow';
export type NoteStatus = 'pending' | 'hit' | 'missed';
/** hit : bonne note. wrong : fausse note. free : jeu libre, non jugé. */
export type Judgement = 'hit' | 'wrong' | 'free';

export interface Stats {
  hit: number;
  missed: number;
  wrong: number;
}

/** Ce qui produit le son des notes que joue l'app. */
export interface Scheduler {
  /** Joue la note dans `delay` secondes réelles, pendant `duration` secondes réelles. */
  schedule(note: Note, delay: number, duration: number): void;
  /** Coupe tout ce qui sonne et tout ce qui est programmé. */
  cancelAll(): void;
}

interface Group {
  time: number;
  noteIds: number[];
}

/** Secondes de morceau affichées avant la première note, pour la voir arriver. */
export const LEAD_IN = 1.5;
/** Secondes réelles programmées à l'avance pour un son régulier. */
const LOOKAHEAD = 0.15;
/** Deux notes plus proches que ça forment un accord à jouer ensemble. */
const CHORD_WINDOW = 0.05;
/** Mode attente : une note jouée jusqu'à ce délai réel avant son arrivée est acceptée. */
const EARLY_WINDOW = 0.5;
/** Mode rythme : écart réel toléré entre la note jouée et la note prévue. */
export const FLOW_TOLERANCE = 0.2;
/** Le morceau s'arrête un peu après la dernière note. */
const TAIL = 0.5;

const emptyStats = (): Stats => ({ hit: 0, missed: 0, wrong: 0 });

export class Player {
  song: Song;
  /** Temps du morceau en secondes, au tempo d'origine. Négatif pendant le décompte. */
  time = -LEAD_IN;
  playing = false;
  mode: Mode = 'listen';
  userHands = new Set<Hand>(['right']);
  speed = 1;
  loop: { start: number; end: number } | null = null;
  status: NoteStatus[] = [];
  /** Statistiques du passage en cours. */
  stats: Stats = emptyStats();
  /** Statistiques du dernier passage terminé (fin du morceau ou tour de boucle). */
  lastPass: Stats | null = null;
  /** Vrai quand le mode attente bloque le temps sur des notes pas encore jouées. */
  waiting = false;
  onPassEnd: ((stats: Stats) => void) | null = null;

  /** Sans boucle, les notes avant cet instant ne sont ni jouées par l'app ni jugées. */
  private activeFrom = 0;
  private groups: Group[] = [];
  private nextGroup = 0;
  private nextToSchedule = 0;
  private missCursor = 0;

  constructor(song: Song, private scheduler: Scheduler) {
    this.song = song;
    this.reset(-LEAD_IN);
  }

  // --- Réglages ---------------------------------------------------------------

  setSong(song: Song): void {
    this.song = song;
    this.loop = null;
    this.playing = false;
    this.activeFrom = 0;
    this.reset(-LEAD_IN);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.reset(this.time);
  }

  setUserHands(hands: Iterable<Hand>): void {
    this.userHands = new Set(hands);
    this.reset(this.time);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.scheduler.cancelAll();
    this.nextToSchedule = this.lowerBound(this.time);
  }

  setLoop(loop: { start: number; end: number } | null): void {
    this.loop = loop && loop.end > loop.start ? loop : null;
    this.activeFrom = 0;
    const outside = this.loop && (this.time < this.loop.start - LEAD_IN || this.time >= this.loop.end);
    this.reset(outside && this.loop ? this.loop.start - LEAD_IN : this.time);
  }

  // --- Transport --------------------------------------------------------------

  play(): void {
    if (this.time >= this.song.duration) this.restart();
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
    this.waiting = false;
    this.scheduler.cancelAll();
    this.nextToSchedule = this.lowerBound(this.time);
  }

  /** Revient au début du morceau, ou de la boucle. */
  restart(): void {
    this.activeFrom = 0;
    this.reset((this.loop?.start ?? 0) - LEAD_IN);
  }

  /** Repart de l'instant `time` (le début d'une mesure), avec un décompte avant. */
  startFrom(time: number): void {
    this.activeFrom = time;
    this.reset(time - LEAD_IN);
  }

  /** Avance le morceau de `dt` secondes réelles. Appelé à chaque image. */
  tick(dt: number): void {
    if (!this.playing) return;
    let target = this.time + dt * this.speed;

    if (this.mode === 'wait') {
      const group = this.groups[this.nextGroup];
      this.waiting = !!group && target >= group.time;
      if (this.waiting) target = group.time;
    }

    if (this.loop && target >= this.loop.end) {
      this.endPass();
      this.restart();
      return;
    }

    this.time = target;
    if (this.mode === 'flow') this.markMissed();
    this.scheduleAhead();

    if (!this.loop && this.time >= this.song.duration + TAIL) {
      this.endPass();
      this.playing = false;
      this.scheduler.cancelAll();
    }
  }

  // --- Jeu de l'utilisateur ------------------------------------------------------

  /** Une touche vient d'être enfoncée sur le piano. */
  noteOn(pitch: number): Judgement {
    if (!this.playing || this.mode === 'listen') return 'free';
    return this.mode === 'wait' ? this.judgeWait(pitch) : this.judgeFlow(pitch);
  }

  /** Les notes attendues maintenant en mode attente, pour les montrer sur le clavier. */
  expectedNotes(): Note[] {
    if (this.mode !== 'wait') return [];
    const group = this.groups[this.nextGroup];
    if (!group) return [];
    return group.noteIds.filter((id) => this.status[id] === 'pending').map((id) => this.song.notes[id]);
  }

  expectedPitches(): number[] {
    return this.expectedNotes().map((n) => n.pitch);
  }

  /** Note que joue l'utilisateur (et non l'app) dans le mode courant. */
  isUserNote(note: Note): boolean {
    return this.mode !== 'listen' && this.userHands.has(note.hand);
  }

  /** Note dans la partie travaillée : tout le morceau, ou la boucle. */
  isActive(note: Note): boolean {
    if (note.start < this.activeFrom - 1e-6) return false;
    if (!this.loop) return true;
    return note.start >= this.loop.start - 1e-6 && note.start < this.loop.end - 1e-6;
  }

  // --- Interne ------------------------------------------------------------------

  private judgeWait(pitch: number): Judgement {
    const group = this.groups[this.nextGroup];
    if (!group) return 'free';
    const id = group.noteIds.find((i) => this.song.notes[i].pitch === pitch && this.status[i] === 'pending');
    if (id === undefined) {
      this.stats.wrong++;
      return 'wrong';
    }
    // Bonne note, mais jouée bien trop tôt : on l'ignore sans la compter fausse.
    if ((group.time - this.time) / this.speed > EARLY_WINDOW) return 'free';
    this.status[id] = 'hit';
    this.stats.hit++;
    if (group.noteIds.every((i) => this.status[i] === 'hit')) {
      this.nextGroup++;
      this.waiting = false;
    }
    return 'hit';
  }

  private judgeFlow(pitch: number): Judgement {
    const tolerance = FLOW_TOLERANCE * this.speed;
    let best: Note | null = null;
    for (let i = this.lowerBound(this.time - tolerance); i < this.song.notes.length; i++) {
      const note = this.song.notes[i];
      if (note.start > this.time + tolerance) break;
      if (note.pitch !== pitch || this.status[i] !== 'pending') continue;
      if (!this.isUserNote(note) || !this.isActive(note)) continue;
      if (!best || Math.abs(note.start - this.time) < Math.abs(best.start - this.time)) best = note;
    }
    if (!best) {
      this.stats.wrong++;
      return 'wrong';
    }
    this.status[best.id] = 'hit';
    this.stats.hit++;
    return 'hit';
  }

  /** Mode rythme : les notes passées sans être jouées deviennent ratées. */
  private markMissed(): void {
    const limit = this.time - FLOW_TOLERANCE * this.speed;
    const notes = this.song.notes;
    while (this.missCursor < notes.length && notes[this.missCursor].start < limit) {
      const note = notes[this.missCursor];
      if (this.status[note.id] === 'pending' && this.isUserNote(note) && this.isActive(note)) {
        this.status[note.id] = 'missed';
        this.stats.missed++;
      }
      this.missCursor++;
    }
  }

  /** Programme le son des notes que joue l'app, un peu en avance. */
  private scheduleAhead(): void {
    let horizon = this.time + LOOKAHEAD * this.speed;
    // En mode attente, rien ne sonne au-delà des notes que l'utilisateur doit encore jouer.
    const group = this.mode === 'wait' ? this.groups[this.nextGroup] : undefined;
    if (group) horizon = Math.min(horizon, group.time);

    const notes = this.song.notes;
    while (this.nextToSchedule < notes.length && notes[this.nextToSchedule].start < horizon) {
      const note = notes[this.nextToSchedule];
      if (!this.isUserNote(note) && this.isActive(note)) {
        const delay = Math.max(0, (note.start - this.time) / this.speed);
        this.scheduler.schedule(note, delay, note.duration / this.speed);
      }
      this.nextToSchedule++;
    }
  }

  private endPass(): void {
    if (this.mode === 'flow') {
      // Tout ce qui reste à jouer dans le passage compte comme raté.
      this.song.notes.forEach((note) => {
        if (this.status[note.id] === 'pending' && this.isUserNote(note) && this.isActive(note)) {
          this.status[note.id] = 'missed';
          this.stats.missed++;
        }
      });
    }
    this.lastPass = { ...this.stats };
    if (this.mode !== 'listen') this.onPassEnd?.(this.lastPass);
  }

  /** Repart de `time` : statuts, statistiques et sons programmés sont remis à zéro. */
  private reset(time: number): void {
    this.time = time;
    this.waiting = false;
    this.scheduler.cancelAll();
    this.status = this.song.notes.map(() => 'pending');
    this.stats = emptyStats();
    this.nextToSchedule = this.lowerBound(time);
    this.missCursor = this.nextToSchedule;
    this.groups = this.buildGroups();
    this.nextGroup = this.groups.findIndex((g) => g.time >= time - 1e-6);
    if (this.nextGroup < 0) this.nextGroup = this.groups.length;
  }

  private buildGroups(): Group[] {
    const groups: Group[] = [];
    for (const note of this.song.notes) {
      if (!this.isUserNote(note) || !this.isActive(note)) continue;
      const last = groups[groups.length - 1];
      if (last && note.start - last.time <= CHORD_WINDOW) last.noteIds.push(note.id);
      else groups.push({ time: note.start, noteIds: [note.id] });
    }
    return groups;
  }

  /** Premier indice de note qui commence à `time` ou après. */
  private lowerBound(time: number): number {
    const notes = this.song.notes;
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].start < time - 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
