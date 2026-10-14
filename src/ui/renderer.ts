import type { Judgement, Player } from '../engine/player';
import { frenchName, frenchOctave, isBlackKey } from '../song/pitch';
import type { FingerDisplay } from '../storage';
import { GhostHands, type KeyboardGeometry } from './ghost-hands';
import type { Hand, Note, Song } from '../song/types';

/** Secondes de morceau visibles au-dessus du clavier. */
const SECONDS_VISIBLE = 3;
const MIN_KEYS = 36;

const COLORS = {
  background: '#11131a',
  octaveLine: 'rgba(255,255,255,0.04)',
  barLine: 'rgba(255,255,255,0.13)',
  barLabel: 'rgba(255,255,255,0.4)',
  hitLine: 'rgba(255,255,255,0.35)',
  waitLine: '#ffd34d',
  hand: { right: '#4c9bff', left: '#ff9a3c' } as Record<Hand, string>,
  hit: '#36d07f',
  missed: '#5b6170',
  wrong: '#ff5a5a',
  free: '#8fb4ff',
  expected: '#ffd34d',
  white: '#f3f2ee',
  whiteBorder: '#b9b8b2',
  black: '#1b1d23',
  keyLabel: '#8a8a86',
  noteLabel: 'rgba(10,12,18,0.75)',
  fingerDisc: '#ffffff',
  fingerText: '#11131a',
  autoFingerDisc: '#d9e5f7',
  autoFingerText: '#1d3557',
};

/** Faut-il afficher le doigté de cette note ? */
function fingerShown(note: Note, display: FingerDisplay): boolean {
  return !!note.finger && (display === 'all' || (display === 'written' && !note.fingerAuto));
}

export interface RenderState {
  player: Player;
  /** Touches enfoncées par l'utilisateur, avec le jugement de leur dernière frappe. */
  pressed: Map<number, Judgement>;
  showNoteNames: boolean;
  /** Doigtés affichés : écrits et calculés, écrits seulement, ou aucun. */
  fingers: FingerDisplay;
  /** Mains fantômes posées sur le clavier. */
  ghostHands: boolean;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private lo = 48;
  private hi = 83;
  private whiteIndex = new Map<number, number>();
  private ghost = new GhostHands();
  private whiteCount = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.setRange(this.lo, this.hi);
  }

  /** Cadre le clavier sur les notes du morceau : octaves entières, au moins trois. */
  fitSong(song: Song): void {
    if (song.notes.length === 0) return this.setRange(48, 83);
    const pitches = song.notes.map((n) => n.pitch);
    let lo = Math.min(...pitches);
    let hi = Math.max(...pitches);
    lo -= lo % 12;
    hi = hi - (hi % 12) + 11;
    let growLow = true;
    while (hi - lo + 1 < MIN_KEYS && (lo > 21 || hi < 108)) {
      if ((growLow && lo > 21) || hi >= 108) lo -= 12;
      else hi += 12;
      growLow = !growLow;
    }
    this.setRange(Math.max(21, lo), Math.min(108, hi));
  }

  setRange(lo: number, hi: number): void {
    this.lo = lo;
    this.hi = hi;
    this.whiteIndex.clear();
    let i = 0;
    for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) this.whiteIndex.set(p, i++);
    this.whiteCount = i;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- Géométrie ---------------------------------------------------------------

  private get whiteWidth(): number {
    return this.width / this.whiteCount;
  }

  private get keyboardHeight(): number {
    return Math.max(60, Math.min(this.whiteWidth * 5.5, 190, this.height * 0.3));
  }

  private get keyboardTop(): number {
    return this.height - this.keyboardHeight;
  }

  private keyRect(pitch: number): { x: number; w: number; black: boolean } | null {
    if (pitch < this.lo || pitch > this.hi) return null;
    const ww = this.whiteWidth;
    if (!isBlackKey(pitch)) return { x: this.whiteIndex.get(pitch)! * ww, w: ww, black: false };
    const left = this.whiteIndex.get(pitch - 1);
    if (left === undefined) return null;
    const bw = ww * 0.6;
    return { x: (left + 1) * ww - bw / 2, w: bw, black: true };
  }

  private geometry(): KeyboardGeometry {
    return {
      keyCenter: (pitch) => {
        const r = this.keyRect(pitch);
        return r ? { x: r.x + r.w / 2, black: r.black } : null;
      },
      whiteWidth: this.whiteWidth,
      keyboardTop: this.keyboardTop,
      keyboardHeight: this.keyboardHeight,
    };
  }

  /** La touche sous le doigt ou la souris, ou null hors du clavier. */
  pitchAt(x: number, y: number): number | null {
    const top = this.keyboardTop;
    if (y < top) return null;
    if (y < top + this.keyboardHeight * 0.62) {
      for (let p = this.lo; p <= this.hi; p++) {
        const r = isBlackKey(p) ? this.keyRect(p) : null;
        if (r && x >= r.x && x < r.x + r.w) return p;
      }
    }
    for (let p = this.lo; p <= this.hi; p++) {
      const r = isBlackKey(p) ? null : this.keyRect(p);
      if (r && x >= r.x && x < r.x + r.w) return p;
    }
    return null;
  }

  // --- Dessin ------------------------------------------------------------------

  draw(state: RenderState): void {
    if (this.width === 0 || this.height === 0) return;
    const { ctx } = this;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGuides(state.player);
    this.drawNotes(state);
    this.drawKeyboard(state);
    if (state.ghostHands) this.ghost.draw(this.ctx, this.geometry(), state.player);
  }

  private drawGuides(player: Player): void {
    const { ctx } = this;
    const top = this.keyboardTop;
    const pps = top / SECONDS_VISIBLE;

    // Repères verticaux : chaque do, et la frontière mi-fa.
    ctx.fillStyle = COLORS.octaveLine;
    for (let p = this.lo; p <= this.hi; p++) {
      if (p % 12 === 0 || p % 12 === 5) {
        const r = this.keyRect(p)!;
        ctx.fillRect(Math.round(r.x), 0, 1, top);
      }
    }

    // Barres de mesure, numérotées comme sur une partition.
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    player.song.bars.forEach((barTime, i) => {
      const y = top - (barTime - player.time) * pps;
      if (y < -20 || y > top) return;
      const inLoop = player.loop && barTime >= player.loop.start - 1e-6 && barTime <= player.loop.end + 1e-6;
      ctx.fillStyle = inLoop ? 'rgba(255,211,77,0.35)' : COLORS.barLine;
      ctx.fillRect(0, Math.round(y), this.width, 1);
      ctx.fillStyle = COLORS.barLabel;
      ctx.fillText(String(i + 1), 6, y - 2);
    });

    ctx.fillStyle = player.waiting ? COLORS.waitLine : COLORS.hitLine;
    ctx.fillRect(0, top - (player.waiting ? 3 : 2), this.width, player.waiting ? 3 : 2);
  }

  private noteColor(player: Player, note: Note): { fill: string; alpha: number } {
    if (!player.isActive(note)) return { fill: COLORS.hand[note.hand], alpha: 0.12 };
    const status = player.status[note.id];
    if (status === 'hit') return { fill: COLORS.hit, alpha: 1 };
    if (status === 'missed') return { fill: COLORS.missed, alpha: 0.8 };
    // En mode jeu, les notes que joue l'app sont estompées pour laisser ressortir les siennes.
    const alpha = player.mode === 'listen' || player.isUserNote(note) ? 1 : 0.32;
    return { fill: COLORS.hand[note.hand], alpha };
  }

  private drawNotes(state: RenderState): void {
    const { ctx } = this;
    const { player } = state;
    const top = this.keyboardTop;
    const pps = top / SECONDS_VISIBLE;
    const windowEnd = player.time + SECONDS_VISIBLE + 0.1;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.width, top);
    ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Les notes blanches d'abord, puis les noires par-dessus, comme sur le clavier.
    for (const blackPass of [false, true]) {
      for (const note of player.song.notes) {
        if (note.start > windowEnd) break;
        if (note.start + note.duration < player.time - 0.1) continue;
        const r = this.keyRect(note.pitch);
        if (!r || r.black !== blackPass) continue;
        const yBottom = top - (note.start - player.time) * pps;
        const yTop = top - (note.start + note.duration - player.time) * pps;
        const pad = r.black ? 1 : 2;
        const x = r.x + pad;
        const w = r.w - pad * 2;
        const h = Math.max(4, yBottom - yTop - 1);
        const { fill, alpha } = this.noteColor(player, note);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        this.roundRect(x, yBottom - h, w, h, Math.min(5, w / 3));
        ctx.fill();
        if (alpha <= 0.3) continue;
        ctx.globalAlpha = 1;
        // Le doigté dans une pastille en bas de la note, le nom de la note juste au-dessus.
        let labelBottom = yBottom - 3;
        if (fingerShown(note, state.fingers) && w >= 10 && h >= 12) {
          const radius = Math.min(9, w / 2 - 1, h / 2 - 1);
          const cy = yBottom - radius - 2;
          this.drawFinger(note.finger!, x + w / 2, cy, radius, note.fingerAuto);
          labelBottom = cy - radius - 2;
        }
        if (state.showNoteNames && w >= 14 && labelBottom - (yBottom - h) >= 13) {
          ctx.fillStyle = COLORS.noteLabel;
          ctx.font = `600 ${Math.min(12, Math.floor(w * 0.45))}px system-ui, sans-serif`;
          ctx.textBaseline = 'bottom';
          ctx.fillText(frenchName(note.pitch).replace('♯', '#'), x + w / 2, labelBottom);
        }
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawKeyboard(state: RenderState): void {
    const { ctx } = this;
    const { player } = state;
    const top = this.keyboardTop;
    const kh = this.keyboardHeight;
    const blackH = kh * 0.62;

    // Couleur de chaque touche : jeu de l'utilisateur d'abord, puis notes jouées par l'app.
    const keyColor = new Map<number, string>();
    for (const note of player.song.notes) {
      if (note.start > player.time) break;
      if (note.start + note.duration <= player.time) continue;
      // En attente, les notes de l'app prévues à cet instant ne sonnent pas encore.
      if (player.waiting && note.start >= player.time - 1e-9) continue;
      if (player.isUserNote(note) || !player.isActive(note)) continue;
      keyColor.set(note.pitch, COLORS.hand[note.hand]);
    }
    for (const [pitch, judgement] of state.pressed) keyColor.set(pitch, COLORS[judgement]);
    const expectedNotes = player.playing ? player.expectedNotes() : [];
    const expected = new Set(expectedNotes.map((n) => n.pitch));
    const fingerOf = new Map(expectedNotes.filter((n) => fingerShown(n, state.fingers)).map((n) => [n.pitch, n]));
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 160);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let p = this.lo; p <= this.hi; p++) {
      if (isBlackKey(p)) continue;
      const r = this.keyRect(p)!;
      ctx.fillStyle = keyColor.get(p) ?? COLORS.white;
      ctx.fillRect(r.x, top, r.w, kh);
      ctx.fillStyle = COLORS.whiteBorder;
      ctx.fillRect(r.x + r.w - 1, top, 1, kh);
      if (expected.has(p)) {
        this.drawExpected(r.x + 3, top + kh * 0.66, r.w - 6, kh * 0.3, pulse);
        const note = fingerOf.get(p);
        if (note) this.drawFinger(note.finger!, r.x + r.w / 2, top + kh * 0.5, Math.min(10, r.w / 2 - 2), note.fingerAuto);
      }
      const label = p % 12 === 0 ? `Do${frenchOctave(p)}` : state.showNoteNames ? frenchName(p) : '';
      if (label && r.w >= 16) {
        ctx.fillStyle = COLORS.keyLabel;
        ctx.font = `${Math.min(11, Math.floor(r.w * 0.42))}px system-ui, sans-serif`;
        ctx.fillText(label, r.x + r.w / 2, top + kh - 4);
      }
    }
    for (let p = this.lo; p <= this.hi; p++) {
      if (!isBlackKey(p)) continue;
      const r = this.keyRect(p);
      if (!r) continue;
      ctx.fillStyle = keyColor.get(p) ?? COLORS.black;
      this.roundRect(r.x, top, r.w, blackH, 3);
      ctx.fill();
      if (expected.has(p)) {
        this.drawExpected(r.x + 2, top + blackH * 0.55, r.w - 4, blackH * 0.4, pulse);
        const note = fingerOf.get(p);
        if (note) this.drawFinger(note.finger!, r.x + r.w / 2, top + blackH * 0.35, Math.min(9, r.w / 2), note.fingerAuto);
      }
    }
  }

  /**
   * Un doigté : le numéro du doigt (1 pouce … 5 auriculaire) dans une pastille. Blanche et
   * pleine s'il est écrit dans la partition, bleu pâle à bord pointillé s'il est calculé.
   */
  private drawFinger(finger: number, cx: number, cy: number, radius: number, auto = false): void {
    if (radius < 4) return;
    const { ctx } = this;
    ctx.fillStyle = auto ? COLORS.autoFingerDisc : COLORS.fingerDisc;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    // Un contour, pour que la pastille se voie aussi sur une touche blanche.
    ctx.strokeStyle = auto ? COLORS.autoFingerText : COLORS.fingerText;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(auto ? [2.5, 2] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = auto ? COLORS.autoFingerText : COLORS.fingerText;
    ctx.font = `700 ${Math.round(radius * 1.35)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(String(finger), cx, cy + 0.5);
    ctx.textBaseline = 'bottom';
  }

  /** Signale une touche à jouer maintenant, en mode attente. */
  private drawExpected(x: number, y: number, w: number, h: number, pulse: number): void {
    const { ctx } = this;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = COLORS.expected;
    this.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.max(0, r));
  }
}
