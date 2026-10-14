import { isBlackKey } from '../song/pitch';
import type { Hand, Song } from '../song/types';

/**
 * Doigtés calculés automatiquement, d'après le modèle ergonomique de Parncutt, Sloboda,
 * Clarke, Raekallio et Desain (1997, « An ergonomic model of keyboard fingering ») :
 * chaque paire de doigts a des écarts confortables et des écarts possibles, et des règles
 * pénalisent ce qui fatigue ou gêne (pouce sur une touche noire, doigts faibles, passages
 * du pouce, même doigt sur deux notes…). Une programmation dynamique choisit, pour chaque
 * main, la suite de doigts la moins coûteuse sur tout le morceau. Les doigtés écrits dans
 * la partition sont gardés et servent de points d'appui.
 *
 * Tout est calculé comme pour la main droite. Pour la main gauche, les hauteurs sont
 * inversées : son pouce joue la note la plus aiguë, comme le pouce droit joue la plus grave.
 */

export interface FingeringNote {
  pitch: number;
  start: number;
  duration: number;
  /** Doigt imposé (écrit dans la partition). */
  finger?: number;
}

/**
 * Écarts en demi-tons entre deux doigts (le plus petit numéro joue la note de référence),
 * d'après la table de Parncutt et al. : [minPossible, minConfortable, minDétendu,
 * maxDétendu, maxConfortable, maxPossible]. Un écart négatif est un passage du pouce.
 */
const SPANS: Record<string, [number, number, number, number, number, number]> = {
  '1-2': [-5, -3, 1, 5, 8, 10],
  '1-3': [-4, -2, 3, 7, 10, 12],
  '1-4': [-3, -1, 5, 9, 12, 14],
  '1-5': [-1, 1, 7, 10, 13, 15],
  '2-3': [1, 1, 1, 2, 3, 5],
  '2-4': [1, 1, 3, 4, 5, 7],
  '2-5': [2, 2, 5, 6, 8, 10],
  '3-4': [1, 1, 1, 2, 2, 4],
  '3-5': [1, 1, 3, 4, 5, 7],
  '4-5': [1, 1, 1, 2, 3, 5],
};

/**
 * Poids des règles, réglés sur 347 pièces MuseScore doigtées par leur auteur
 * (scripts/eval-fingering.mjs) : 56 % des doigtés écrits retrouvés, 58 % sur les pièces faciles.
 */
export const WEIGHTS = {
  /** Même doigt sur deux notes différentes. */
  sameFinger: 9,
  /** Utiliser le 4e ou le 5e doigt. */
  weakFinger: 0,
  /** Pouce sur une touche noire, après une touche blanche. */
  thumbOnBlack: 5,
  /** Part des coûts d'écart qui reste quand la main a le temps de se replacer. */
  relaxed: 0.35,
  /** Accords : écart au « un doigt par touche blanche ». */
  chordSpread: 0.5,
};

/** Une octave compte 12 demi-tons pour 7 touches blanches. */
const SEMITONES_PER_WHITE_KEY = 12 / 7;
/** Notes plus proches que ça : jouées ensemble. */
const ONSET_WINDOW = 0.03;
/** Au-delà de ce temps entre deux notes, la main a le temps de se replacer. */
const RELAXED_GAP = 0.45;

/** Coût de l'écart `d` (demi-tons) entre les doigts a < b. */
function spanCost(a: number, b: number, d: number): number {
  const [minPrac, minComf, minRel, maxRel, maxComf, maxPrac] = SPANS[`${a}-${b}`];
  const thumb = a === 1;
  let cost = 0;
  if (d < minPrac) cost += 10 + 2 * (minPrac - d);
  else if (d > maxPrac) cost += 10 + 2 * (d - maxPrac);
  if (d < minComf) cost += 2 * (minComf - d);
  else if (d > maxComf) cost += 2 * (d - maxComf);
  if (d < minRel) cost += (thumb ? 1 : 2) * (minRel - d);
  else if (d > maxRel) cost += (thumb ? 1 : 2) * (d - maxRel);
  return cost;
}

interface Point {
  /** Hauteur « virtuelle » : la vraie pour la main droite, inversée pour la gauche. */
  v: number;
  black: boolean;
}

/** Coût d'enchaîner la note `x` jouée par `fx` puis `y` jouée par `fy`. */
function stepCost(x: Point, fx: number, y: Point, fy: number, relaxed: boolean): number {
  if (fx === fy) {
    if (x.v === y.v) return 0; // Note répétée avec le même doigt : naturel.
    return (relaxed ? WEIGHTS.sameFinger / 3 : WEIGHTS.sameFinger) + Math.abs(y.v - x.v) * (relaxed ? 0.15 : 0.5);
  }
  const [a, b] = fx < fy ? [fx, fy] : [fy, fx];
  const d = fx < fy ? y.v - x.v : x.v - y.v;
  let cost = spanCost(a, b, d) * (relaxed ? WEIGHTS.relaxed : 1);
  if (fy === 4 || fy === 5) cost += WEIGHTS.weakFinger; // Doigts faibles.
  if (fx === 3 && fy === 4) {
    cost += 1;
    if (!x.black && y.black) cost += 1;
  }
  if (fy === 1 && y.black) cost += x.black ? 1 : WEIGHTS.thumbOnBlack; // Pouce sur une touche noire.
  if (fy === 5 && y.black && !x.black) cost += 2;
  // Passage du pouce (dessous en montant) ou d'un doigt par-dessus le pouce (en descendant).
  const passing = (fy === 1 && fx > 1 && y.v > x.v) || (fx === 1 && fy > 1 && y.v < x.v);
  if (passing) cost += x.black === y.black ? 1 : !x.black && y.black ? 3 : 1.5;
  return cost;
}

/** Les façons de répartir `count` notes (de la plus grave à la plus aiguë, en virtuel) sur des doigts croissants. */
function assignments(count: number): number[][] {
  const result: number[][] = [];
  const pick = (start: number, chosen: number[]) => {
    if (chosen.length === count) {
      result.push(chosen);
      return;
    }
    for (let f = start; f <= 5; f++) pick(f + 1, [...chosen, f]);
  };
  pick(1, []);
  return result;
}
const ASSIGNMENTS = [[], ...[1, 2, 3, 4, 5].map(assignments)];

interface Event {
  /** Indices des notes, de la plus grave à la plus aiguë en hauteur virtuelle. */
  indices: number[];
  points: Point[];
  start: number;
  end: number;
}

/** Doigt de chaque note d'une main (dans l'ordre des notes reçues). */
export function fingerHand(notes: FingeringNote[], hand: Hand): number[] {
  const sign = hand === 'right' ? 1 : -1;
  const order = notes.map((_, i) => i).sort((i, j) => notes[i].start - notes[j].start || sign * (notes[i].pitch - notes[j].pitch));
  const fingers = new Array<number>(notes.length).fill(0);

  // Attaques simultanées : une seule « position » de la main. Au-delà de cinq notes, les plus extrêmes restent sans doigt.
  const events: Event[] = [];
  for (let k = 0; k < order.length; ) {
    let m = k + 1;
    while (m < order.length && notes[order[m]].start - notes[order[k]].start <= ONSET_WINDOW) m++;
    const indices = order.slice(k, m).slice(0, 5);
    events.push({
      indices,
      points: indices.map((i) => ({ v: sign * notes[i].pitch, black: isBlackKey(notes[i].pitch) })),
      start: notes[order[k]].start,
      end: Math.max(...indices.map((i) => notes[i].start + notes[i].duration)),
    });
    k = m;
  }
  if (events.length === 0) return fingers;

  // Pour chaque attaque : les répartitions possibles (compatibles avec les doigts imposés) et leur coût interne.
  const states = events.map((event) =>
    ASSIGNMENTS[event.indices.length]
      .filter((a) => event.indices.every((i, n) => !notes[i].finger || notes[i].finger === a[n]))
      .map((a) => {
        let inner = 0;
        for (let n = 1; n < a.length; n++) {
          const d = event.points[n].v - event.points[n - 1].v;
          inner += spanCost(a[n - 1], a[n], d) * 1.5;
          // Dans un accord, la main s'ouvre en proportion : environ un doigt par touche blanche.
          inner += WEIGHTS.chordSpread * Math.abs(a[n] - a[n - 1] - d / SEMITONES_PER_WHITE_KEY);
        }
        return { fingers: a, inner };
      }),
  );
  // Un doigt imposé impossible à respecter (accord trop large…) : on l'ignore plutôt que de bloquer.
  states.forEach((list, e) => {
    if (list.length === 0) {
      states[e] = ASSIGNMENTS[events[e].indices.length].map((a) => ({ fingers: a, inner: 0 }));
    }
  });

  // Programmation dynamique (Viterbi) : coût minimal pour arriver à chaque état.
  const cost: number[][] = [states[0].map((s) => s.inner)];
  const back: number[][] = [states[0].map(() => -1)];
  for (let e = 1; e < events.length; e++) {
    const prev = events[e - 1];
    const cur = events[e];
    const relaxed = cur.start - prev.end >= RELAXED_GAP || cur.start - prev.start >= RELAXED_GAP * 2;
    // Enchaînements comparés : note grave → note grave et note aiguë → note aiguë.
    const lastPrev = prev.points.length - 1;
    const lastCur = cur.points.length - 1;
    cost.push([]);
    back.push([]);
    states[e].forEach((s) => {
      let best = Infinity;
      let arg = 0;
      states[e - 1].forEach((p, pi) => {
        let c = cost[e - 1][pi] + stepCost(prev.points[lastPrev], p.fingers[lastPrev], cur.points[lastCur], s.fingers[lastCur], relaxed);
        if (lastPrev > 0 || lastCur > 0) {
          c += stepCost(prev.points[0], p.fingers[0], cur.points[0], s.fingers[0], relaxed);
        }
        if (c < best) {
          best = c;
          arg = pi;
        }
      });
      cost[e].push(best + s.inner);
      back[e].push(arg);
    });
  }

  let state = cost[events.length - 1].indexOf(Math.min(...cost[events.length - 1]));
  for (let e = events.length - 1; e >= 0; e--) {
    const chosen = states[e][state].fingers;
    events[e].indices.forEach((i, n) => (fingers[i] = chosen[n]));
    state = back[e][state];
  }
  return fingers;
}

/**
 * Complète les doigtés du morceau : les notes sans doigté écrit reçoivent un doigté
 * calculé, marqué comme tel. Renvoie le nombre de doigtés calculés.
 */
export function autoFingerSong(song: Song): number {
  let added = 0;
  for (const hand of ['right', 'left'] as Hand[]) {
    const notes = song.notes.filter((n) => n.hand === hand);
    const fingers = fingerHand(notes.map((n) => ({ ...n, finger: n.fingerAuto ? undefined : n.finger })), hand);
    notes.forEach((note, i) => {
      if (note.finger !== undefined && !note.fingerAuto) return;
      if (!fingers[i]) return;
      note.finger = fingers[i];
      note.fingerAuto = true;
      added++;
    });
  }
  return added;
}
