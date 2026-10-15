import type { Note, Song } from './types';

/** Deux notes plus proches que ça se jouent ensemble (comme en mode Attente, src/engine/player.ts). */
const TOGETHER = 0.05;

/** Des notes à jouer en même temps, et le nom de l'accord qu'elles forment s'il est évident. */
export interface NoteGroup {
  start: number;
  notes: Note[];
  chord: string | null;
}

/** Les groupes d'au moins deux notes qui commencent ensemble, toutes mains confondues. */
export function noteGroups(song: Song): NoteGroup[] {
  const groups: NoteGroup[] = [];
  let current: Note[] = [];
  const flush = () => {
    if (current.length >= 2) {
      groups.push({ start: current[0].start, notes: current, chord: chordName(current.map((n) => n.pitch)) });
    }
  };
  for (const note of song.notes) {
    if (current.length && note.start - current[0].start > TOGETHER) {
      flush();
      current = [];
    }
    current.push(note);
  }
  flush();
  return groups;
}

// Les noms des notes pour les accords : les altérations les plus courantes (Si♭ plutôt que La♯).
const ROOTS = ['Do', 'Do♯', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

/**
 * Les accords reconnus : intervalles depuis la fondamentale, et suffixe à la française
 * (rien pour majeur, « m » pour mineur, « 7M » pour la septième majeure). Les accords
 * symétriques (augmenté, septième diminuée), dont la fondamentale est ambiguë, n'y sont pas.
 */
const CHORDS: Array<{ intervals: number[]; suffix: string }> = [
  { intervals: [0, 4, 7], suffix: '' },
  { intervals: [0, 3, 7], suffix: ' m' },
  { intervals: [0, 3, 6], suffix: ' dim' },
  { intervals: [0, 5, 7], suffix: ' sus4' },
  { intervals: [0, 2, 7], suffix: ' sus2' },
  { intervals: [0, 4, 7, 10], suffix: ' 7' },
  { intervals: [0, 4, 7, 11], suffix: ' 7M' },
  { intervals: [0, 3, 7, 10], suffix: ' m7' },
  { intervals: [0, 3, 6, 10], suffix: ' m7♭5' },
];

/**
 * Le nom de l'accord formé par ces hauteurs, ou null s'il n'est pas évident : moins de trois
 * notes différentes, une note étrangère à l'accord, ou plusieurs lectures possibles (do-ré-sol
 * est Do sus2 ou Sol sus4 : la basse tranche, sinon on ne dit rien). Les octaves et les
 * renversements ne changent pas le nom.
 */
export function chordName(pitches: number[]): string | null {
  const classes = [...new Set(pitches.map((p) => ((p % 12) + 12) % 12))].sort((a, b) => a - b);
  if (classes.length < 3) return null;
  const bass = ((Math.min(...pitches) % 12) + 12) % 12;
  const matches: Array<{ root: number; suffix: string }> = [];
  for (const root of classes) {
    const intervals = classes.map((c) => (c - root + 12) % 12).sort((a, b) => a - b);
    for (const chord of CHORDS) {
      if (chord.intervals.length === intervals.length && chord.intervals.every((v, i) => v === intervals[i])) {
        matches.push({ root, suffix: chord.suffix });
      }
    }
  }
  const pick = matches.length === 1 ? matches[0] : matches.find((m) => m.root === bass);
  return pick ? ROOTS[pick.root] + pick.suffix : null;
}
