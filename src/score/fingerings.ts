import type { Song } from '../song/types';

/** Une note lue dans la partition : sa position en noires, sa hauteur MIDI et son doigté éventuel. */
export interface ScoreNote {
  quarters: number;
  pitch: number;
  finger?: number;
}

/** Écart toléré entre une note de la partition et la note jouée du fichier MIDI. */
const TOLERANCE = 0.06;

/** La note du morceau qui correspond à cette hauteur et cet instant, s'il y en a une. */
function findNote(song: Song, pitch: number, time: number): number {
  const notes = song.notes;
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start < time - TOLERANCE) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < notes.length && notes[i].start <= time + TOLERANCE; i++) {
    if (notes[i].pitch === pitch) return i;
  }
  return -1;
}

/**
 * Les bibliothèques de partition ne numérotent pas toujours les octaves comme le MIDI :
 * on essaie les décalages possibles et on garde celui qui fait correspondre le plus de notes.
 */
export function bestPitchOffset(song: Song, scoreNotes: ScoreNote[]): number {
  if (!song.quarterToSeconds) return 0;
  const sample = scoreNotes.slice(0, 400);
  let best = 0;
  let bestMatches = -1;
  for (const offset of [0, 12, 24, 36, 48, 60, -12]) {
    const matches = sample.filter((n) => findNote(song, n.pitch + offset, song.quarterToSeconds!(n.quarters)) >= 0).length;
    if (matches > bestMatches) {
      bestMatches = matches;
      best = offset;
    }
  }
  return best;
}

/** Recopie sur les notes du morceau les doigtés écrits dans la partition. Renvoie leur nombre. */
export function applyFingerings(song: Song, scoreNotes: ScoreNote[]): number {
  for (const note of song.notes) {
    delete note.finger;
    delete note.fingerAuto;
  }
  if (!song.quarterToSeconds) return 0;
  const offset = bestPitchOffset(song, scoreNotes);
  let applied = 0;
  for (const n of scoreNotes) {
    if (!n.finger) continue;
    const index = findNote(song, n.pitch + offset, song.quarterToSeconds(n.quarters));
    if (index >= 0 && song.notes[index].finger === undefined) {
      song.notes[index].finger = n.finger;
      applied++;
    }
  }
  return applied;
}
