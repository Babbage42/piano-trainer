import { isBlackKey } from './pitch';
import type { Hand, Note, Song } from './types';

export type Level = 1 | 2 | 3 | 4 | 5;

export interface DifficultyDetails {
  level: Level;
  score: number;
  /** Notes par seconde de la main la plus occupée, dans ses passages chargés. */
  handDensity: number;
  /** Notes par seconde des deux mains ensemble, dans les passages chargés. */
  density: number;
  /** Déplacement de la main la plus mobile, en demi-tons par seconde, dans les passages chargés. */
  travel: number;
  /** Taille des accords d'une main (90e centile). */
  chord: number;
  /** Écart entre notes jouées ensemble par une main, en demi-tons (90e centile). */
  span: number;
  /** Part de touches noires. */
  black: number;
}

const WINDOW = 2;
const ONSET_WINDOW = 0.03;
/**
 * Bornes de score entre niveaux. Elles découpent le catalogue Mutopia en paliers
 * (10 % de pièces au niveau 1, 20 % au 2, 30 % au 3, 25 % au 4, 15 % au 5) : le niveau
 * dit surtout où se place un morceau par rapport aux autres.
 */
const THRESHOLDS = [3.2, 3.7, 4.3, 5.0];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * Somme de `amount` sur les deux secondes qui précèdent chaque événement, ramenée à la
 * seconde, dans les passages chargés (90e centile).
 */
function busyRate(events: Array<{ time: number; amount: number }>): number {
  if (events.length === 0) return 0;
  const sums: number[] = [];
  let first = 0;
  let sum = 0;
  for (let i = 0; i < events.length; i++) {
    sum += events[i].amount;
    while (events[first].time < events[i].time - WINDOW) sum -= events[first++].amount;
    sums.push(sum);
  }
  return percentile(sums, 0.9) / WINDOW;
}

const busyDensity = (notes: Note[]) => busyRate(notes.map((n) => ({ time: n.start, amount: 1 })));

/**
 * Niveau estimé de 1 (premiers morceaux) à 5 (virtuose), d'après les notes seules.
 * Comparé à une centaine de pièces de niveau connu, ce qui compte le plus est la vitesse
 * de la main la plus occupée (en logarithme : doubler le tempo ne double pas la
 * difficulté), puis la part de touches noires, un peu les déplacements de la main.
 * Accords et écarts n'apportaient presque rien une fois ces trois-là pris en compte.
 * C'est grossier (ni doigtés ni rythme ne comptent) : bon pour trier une liste, pas
 * pour remplacer l'avis d'un professeur.
 */
export function estimateDifficulty(song: Song): DifficultyDetails {
  const notes = song.notes;
  if (notes.length === 0) return { level: 1, score: 0, handDensity: 0, density: 0, travel: 0, chord: 0, span: 0, black: 0 };

  const sizes: number[] = [];
  const spans: number[] = [];
  let handDensity = 0;
  let travel = 0;
  for (const hand of ['left', 'right'] as Hand[]) {
    const handNotes = notes.filter((n) => n.hand === hand);
    handDensity = Math.max(handDensity, busyDensity(handNotes));
    // Chaque attaque de la main : sa position moyenne, pour mesurer de combien elle se déplace.
    const moves: Array<{ time: number; amount: number }> = [];
    let previous: number | null = null;
    for (let i = 0; i < handNotes.length; ) {
      let j = i + 1;
      while (j < handNotes.length && handNotes[j].start - handNotes[i].start <= ONSET_WINDOW) j++;
      const pitches = handNotes.slice(i, j).map((n) => n.pitch);
      sizes.push(pitches.length);
      spans.push(Math.max(...pitches) - Math.min(...pitches));
      const position = pitches.reduce((a, b) => a + b, 0) / pitches.length;
      if (previous !== null) moves.push({ time: handNotes[i].start, amount: Math.abs(position - previous) });
      previous = position;
      i = j;
    }
    travel = Math.max(travel, busyRate(moves));
  }
  const density = busyDensity(notes);
  const chord = percentile(sizes, 0.9);
  const span = percentile(spans, 0.9);
  const black = notes.filter((n) => isBlackKey(n.pitch)).length / notes.length;

  const score = Math.log2(1 + handDensity) + 2.5 * black + 0.1 * Math.log2(1 + travel);
  const level = (THRESHOLDS.filter((t) => score >= t).length + 1) as Level;
  return { level, score, handDensity, density, travel, chord, span, black };
}
