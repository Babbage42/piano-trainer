export type Hand = 'right' | 'left';

/** separate : chaque main a sa piste dans le fichier. estimated : l'app a deviné les mains. */
export type HandsMethod = 'separate' | 'estimated';

export interface Note {
  /** Position dans song.notes, sert d'identifiant. */
  id: number;
  /** Numéro MIDI : 60 = do central (Do3 en notation française). */
  pitch: number;
  /** Début et durée en secondes, au tempo d'origine. */
  start: number;
  duration: number;
  /** Force de frappe, entre 0 et 1. */
  velocity: number;
  hand: Hand;
  /** Doigt conseillé (1 pouce … 5 auriculaire), écrit dans la partition ou calculé. */
  finger?: number;
  /** Vrai si le doigté a été calculé par l'app plutôt qu'écrit dans la partition. */
  fingerAuto?: boolean;
}

export interface Song {
  title: string;
  /** Triées par début, puis par hauteur. */
  notes: Note[];
  /** Fin de la dernière note, en secondes. */
  duration: number;
  /** Début de chaque mesure, en secondes. bars[0] vaut 0. */
  bars: number[];
  /** Comment les mains ont été attribuées. */
  hands: HandsMethod;
  /** Convertit une position en noires (depuis le début) en secondes, d'après le tempo du fichier. */
  quarterToSeconds?: (quarters: number) => number;
}

export interface RawNote {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}

/** Trie les notes, leur donne un id et calcule la durée totale. */
export function buildSong(
  title: string,
  notes: Array<RawNote & { hand: Hand }>,
  bars: number[],
  hands: HandsMethod,
): Song {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const withIds = sorted.map((n, id) => ({ ...n, id }));
  const duration = withIds.reduce((end, n) => Math.max(end, n.start + n.duration), 0);
  return { title, notes: withIds, duration, bars: bars.length ? bars : [0], hands };
}

/** Indice de la mesure qui contient l'instant t (0 pour la première). */
export function barIndexAt(song: Song, t: number): number {
  let lo = 0;
  let hi = song.bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (song.bars[mid] <= t + 1e-6) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Début de la mesure i, ou fin du morceau si i dépasse la dernière. */
export function barStart(song: Song, i: number): number {
  if (i <= 0) return 0;
  if (i >= song.bars.length) return song.duration;
  return song.bars[i];
}
