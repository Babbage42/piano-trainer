import { barIndexAt, barStart, type Hand, type Note, type Song } from '../song/types';

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
  /** Un clic de métronome dans `delay` secondes réelles, accentué sur le premier temps. */
  click?(delay: number, accent: boolean): void;
}

/** Les temps du morceau : leurs instants, et lesquels ouvrent une mesure. */
interface BeatGrid {
  times: number[];
  downbeat: boolean[];
  /** Avant le début du morceau (décompte), les temps continuent à cet intervalle… */
  step: number;
  /** … groupés par mesures de ce nombre de temps. */
  perBar: number;
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
/**
 * À l'écran, une touche remonte un peu avant la fin de sa note (secondes réelles) : une note
 * répétée vite se voit ainsi frappée plusieurs fois, au lieu d'une touche restée enfoncée.
 * 70 ms, c'est environ quatre images.
 */
const KEY_RELEASE = 0.07;

const emptyStats = (): Stats => ({ hit: 0, missed: 0, wrong: 0 });

export class Player {
  song: Song;
  /** Temps du morceau en secondes, au tempo d'origine. Négatif pendant le décompte. */
  time = -LEAD_IN;
  playing = false;
  mode: Mode = 'listen';
  userHands = new Set<Hand>(['right']);
  speed = 1;
  /** Le métronome bat les temps pendant la lecture, et une mesure de décompte avant de partir. */
  metronome = false;
  loop: { start: number; end: number } | null = null;
  status: NoteStatus[] = [];
  /** Statistiques du passage en cours. */
  stats: Stats = emptyStats();
  /** Statistiques du dernier passage terminé (fin du morceau ou tour de boucle). */
  lastPass: Stats | null = null;
  /** Vrai quand le mode attente bloque le temps sur des notes pas encore jouées. */
  waiting = false;
  /**
   * Erreurs (fausses notes, notes ratées) de chaque mesure lors de son dernier passage en mode
   * Attente ou Rythme ; null tant qu'elle n'a pas été jouée. Une mesure rejouée repart de zéro.
   */
  errorsByBar: Array<number | null> = [];
  /** Change à chaque erreur ou passage : la frise ne se redessine que dans ce cas. */
  errorsVersion = 0;
  onPassEnd: ((stats: Stats) => void) | null = null;

  /** Sans boucle, les notes avant cet instant ne sont ni jouées par l'app ni jugées. */
  private activeFrom = 0;
  private groups: Group[] = [];
  private nextGroup = 0;
  private nextToSchedule = 0;
  private missCursor = 0;
  private grid: BeatGrid = { times: [0], downbeat: [true], step: 0.5, perBar: 4 };
  /** Prochain temps à programmer ; négatif pendant le décompte du début. */
  private nextBeat = 0;
  private currentBar = -1;

  constructor(song: Song, private scheduler: Scheduler) {
    this.song = song;
    this.grid = beatGrid(song);
    this.errorsByBar = song.bars.map(() => null);
    this.reset(-LEAD_IN);
  }

  // --- Réglages ---------------------------------------------------------------

  setSong(song: Song): void {
    this.song = song;
    this.grid = beatGrid(song);
    this.errorsByBar = song.bars.map(() => null);
    this.errorsVersion++;
    this.loop = null;
    this.playing = false;
    this.activeFrom = 0;
    this.reset(-this.leadIn(0));
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.reset(this.time);
  }

  setUserHands(hands: Iterable<Hand>): void {
    this.userHands = new Set(hands);
    this.reset(this.time);
  }

  /** Temps du morceau où la touche de cette note remonte à l'écran (avant la fin du son). */
  releaseTime(note: Note): number {
    return note.start + note.duration - Math.min(note.duration * 0.4, KEY_RELEASE * this.speed);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.rescheduleFromNow();
  }

  setMetronome(on: boolean): void {
    this.metronome = on;
    this.rescheduleFromNow();
  }

  setLoop(loop: { start: number; end: number } | null): void {
    this.loop = loop && loop.end > loop.start ? loop : null;
    this.activeFrom = 0;
    const lead = this.loop ? this.leadIn(this.loop.start) : 0;
    const outside = this.loop && (this.time < this.loop.start - lead || this.time >= this.loop.end);
    this.reset(outside && this.loop ? this.loop.start - lead : this.time);
  }

  // --- Transport --------------------------------------------------------------

  play(): void {
    if (this.time >= this.song.duration) this.restart();
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
    this.waiting = false;
    this.rescheduleFromNow();
  }

  /** Revient au début du morceau, ou de la boucle. */
  restart(): void {
    this.activeFrom = 0;
    const start = this.loop?.start ?? 0;
    this.reset(start - this.leadIn(start));
  }

  /** Repart de l'instant `time` (le début d'une mesure), avec un décompte avant. */
  startFrom(time: number): void {
    this.activeFrom = time;
    this.reset(time - this.leadIn(time));
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
    this.enterBar();
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
      this.addError(group.time);
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
      this.addError(this.time);
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
        this.addError(note.start);
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

    if (!this.metronome || !this.scheduler.click) return;
    // En mode attente, le temps de la note attendue bat quand même : c'est le signal pour la jouer.
    const beatHorizon = group ? horizon + 1e-6 : horizon;
    for (let t = this.beatTime(this.nextBeat); t < beatHorizon; t = this.beatTime(++this.nextBeat)) {
      // La boucle repart avant son dernier temps : il serait de trop.
      if (this.loop && t >= this.loop.end - 1e-6) break;
      this.scheduler.click(Math.max(0, (t - this.time) / this.speed), this.isDownbeat(this.nextBeat));
    }
  }

  /** En entrant dans une mesure de la partie travaillée, on oublie ses erreurs du passage précédent. */
  private enterBar(): void {
    if (this.mode === 'listen' || this.time < 0) return;
    const bar = barIndexAt(this.song, this.time);
    if (bar === this.currentBar) return;
    this.currentBar = bar;
    const from = this.loop?.start ?? this.activeFrom;
    if (barStart(this.song, bar) < from - 1e-6) return;
    this.errorsByBar[bar] = 0;
    this.errorsVersion++;
  }

  private addError(t: number): void {
    const bar = barIndexAt(this.song, Math.max(0, t));
    this.errorsByBar[bar] = (this.errorsByBar[bar] ?? 0) + 1;
    this.errorsVersion++;
  }

  /** Décompte avant `at` : 1,5 s, ou avec le métronome une mesure entière (deux si elle est très courte). */
  private leadIn(at: number): number {
    if (!this.metronome) return LEAD_IN;
    const bar = Math.max(0, barIndexAt(this.song, at) - 1);
    const length = at > 0 ? at - barStart(this.song, bar) : this.grid.step * this.grid.perBar;
    if (length <= 0) return LEAD_IN;
    return length * Math.max(1, Math.ceil(LEAD_IN / length - 1e-6));
  }

  /** Instant du temps k ; les k négatifs sont les temps du décompte, avant le début du morceau. */
  private beatTime(k: number): number {
    if (k < 0) return k * this.grid.step;
    return k < this.grid.times.length ? this.grid.times[k] : Infinity;
  }

  private isDownbeat(k: number): boolean {
    if (k < 0) return (((k % this.grid.perBar) + this.grid.perBar) % this.grid.perBar) === 0;
    return this.grid.downbeat[k] ?? false;
  }

  /** Premier temps à partir de l'instant t. */
  private firstBeatFrom(t: number): number {
    if (t < 0) return Math.ceil(t / this.grid.step - 1e-9);
    const { times } = this.grid;
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < t - 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Oublie ce qui était programmé et reprend la programmation à partir de maintenant. */
  private rescheduleFromNow(): void {
    this.scheduler.cancelAll();
    this.nextToSchedule = this.lowerBound(this.time);
    this.nextBeat = this.firstBeatFrom(this.time);
  }

  private endPass(): void {
    if (this.mode === 'flow') {
      // Tout ce qui reste à jouer dans le passage compte comme raté.
      this.song.notes.forEach((note) => {
        if (this.status[note.id] === 'pending' && this.isUserNote(note) && this.isActive(note)) {
          this.status[note.id] = 'missed';
          this.stats.missed++;
          this.addError(note.start);
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
    this.nextBeat = this.firstBeatFrom(time);
    this.currentBar = -1;
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

/** Les temps du morceau, et ceux qui tombent sur un début de mesure. */
function beatGrid(song: Song): BeatGrid {
  const times = song.beats?.length
    ? song.beats
    : song.bars.flatMap((bar, i) => {
        const length = (barStart(song, i + 1) - bar) / 4;
        return [0, 1, 2, 3].map((k) => bar + k * length);
      });
  const downbeat = times.map((t) => Math.abs(barStart(song, barIndexAt(song, t)) - t) < 1e-4);
  const firstBarEnd = song.bars[1] ?? Infinity;
  return {
    times,
    downbeat,
    step: times.length > 1 ? times[1] - times[0] : 0.5,
    perBar: Math.max(1, times.filter((t) => t < firstBarEnd - 1e-6).length),
  };
}

/**
 * Les `span` mesures qui se suivent et cumulent le plus d'erreurs au dernier passage, en indices
 * (première et dernière incluses), ou null sans erreur. À égalité, la plus tôt : une seule mesure
 * fautive est ainsi travaillée avec celle d'avant, qui y mène.
 */
export function worstBars(errors: Array<number | null>, span = 2): { first: number; last: number } | null {
  const width = Math.min(span, errors.length);
  let best = -1;
  let bestSum = 0;
  for (let first = 0; first + width <= errors.length; first++) {
    let sum = 0;
    for (let k = 0; k < width; k++) sum += errors[first + k] ?? 0;
    if (sum > bestSum) {
      best = first;
      bestSum = sum;
    }
  }
  return best < 0 ? null : { first: best, last: best + width - 1 };
}
