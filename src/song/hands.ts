import type { Hand, HandsMethod, RawNote } from './types';

export interface TrackNotes {
  name: string;
  notes: RawNote[];
}

export interface HandAssignment {
  notes: Array<RawNote & { hand: Hand }>;
  method: HandsMethod;
}

const RIGHT_NAME = /right|droite|\brh\b|treble|upper|main d/i;
const LEFT_NAME = /left|gauche|\blh\b|bass|lower|main g/i;
const MIDDLE_C = 60;

function meanPitch(notes: RawNote[]): number {
  return notes.reduce((sum, n) => sum + n.pitch, 0) / notes.length;
}

/** Décide quelle main joue chaque note, à partir des pistes du fichier. */
export function assignHands(allTracks: TrackNotes[]): HandAssignment {
  const tracks = allTracks.filter((t) => t.notes.length > 0);
  const tag = (notes: RawNote[], hand: Hand) => notes.map((n) => ({ ...n, hand }));

  if (tracks.length === 0) return { notes: [], method: 'estimated' };

  // 1. Les noms de pistes le disent clairement.
  const byName = tracks.map((t) =>
    RIGHT_NAME.test(t.name) && !LEFT_NAME.test(t.name) ? 'right'
      : LEFT_NAME.test(t.name) && !RIGHT_NAME.test(t.name) ? 'left'
        : null,
  );
  if (tracks.length >= 2 && byName.every((h) => h !== null)) {
    return { notes: tracks.flatMap((t, i) => tag(t.notes, byName[i] as Hand)), method: 'separate' };
  }

  // 2. Plusieurs pistes (une par portée, en général) : la plus aiguë à droite, la plus grave à gauche.
  if (tracks.length >= 2) {
    const means = tracks.map((t) => meanPitch(t.notes));
    const highest = means.indexOf(Math.max(...means));
    const lowest = means.indexOf(Math.min(...means));
    const handOf = (i: number): Hand =>
      i === highest ? 'right' : i === lowest ? 'left' : means[i] >= MIDDLE_C ? 'right' : 'left';
    return { notes: tracks.flatMap((t, i) => tag(t.notes, handOf(i))), method: 'separate' };
  }

  // 3. Une seule piste : il faut deviner.
  return { notes: estimateHands(tracks[0].notes), method: 'estimated' };
}

/** Notes plus proches que ça : jouées ensemble. */
const ONSET_WINDOW = 0.03;
/** Écart au-delà duquel une main ne peut plus tenir l'accord (une neuvième). */
const MAX_SPAN = 14;
const MAX_NOTES_PER_HAND = 5;
/** Écart minimal entre les positions des deux mains. */
const MIN_GAP = 7;

/** Coût de faire jouer ces notes (triées) par une main placée autour de `center`. */
function handCost(notes: RawNote[], center: number): number {
  if (notes.length === 0) return 0;
  let cost = notes.reduce((sum, n) => sum + Math.abs(n.pitch - center), 0);
  if (notes[notes.length - 1].pitch - notes[0].pitch > MAX_SPAN) cost += 100;
  if (notes.length > MAX_NOTES_PER_HAND) cost += 100;
  return cost;
}

/**
 * Sépare les mains d'une piste unique. On suit la position de chaque main ; à chaque
 * attaque, les notes sont coupées en deux (graves à gauche, aiguës à droite) à l'endroit
 * qui éloigne le moins chaque main de sa position et reste jouable.
 * Plus juste qu'une coupure fixe au do central, mais ça reste une estimation.
 */
export function estimateHands(notes: RawNote[]): Array<RawNote & { hand: Hand }> {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const result: Array<RawNote & { hand: Hand }> = [];
  let left = 48;
  let right = 67;

  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].start - sorted[i].start <= ONSET_WINDOW) j++;
    const group = sorted.slice(i, j).sort((a, b) => a.pitch - b.pitch);

    let split = 0;
    let bestCost = Infinity;
    for (let k = 0; k <= group.length; k++) {
      const cost = handCost(group.slice(0, k), left) + handCost(group.slice(k), right);
      if (cost < bestCost) {
        bestCost = cost;
        split = k;
      }
    }

    const leftNotes = group.slice(0, split);
    const rightNotes = group.slice(split);
    for (const n of leftNotes) result.push({ ...n, hand: 'left' });
    for (const n of rightNotes) result.push({ ...n, hand: 'right' });
    if (leftNotes.length) left = (left + meanPitch(leftNotes)) / 2;
    if (rightNotes.length) right = (right + meanPitch(rightNotes)) / 2;
    if (right - left < MIN_GAP) {
      const middle = (left + right) / 2;
      left = middle - MIN_GAP / 2;
      right = middle + MIN_GAP / 2;
    }
    i = j;
  }
  return result;
}
