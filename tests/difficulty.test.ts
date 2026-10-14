import { describe, expect, it } from 'vitest';
import { DEMOS } from '../src/song/demos';
import { estimateDifficulty } from '../src/song/difficulty';
import { estimateHands } from '../src/song/hands';
import { songFromNotation } from '../src/song/notation';

const raw = (pitch: number, start: number) => ({ pitch, start, duration: 0.4, velocity: 0.7 });

describe('estimation des mains sur une piste unique', () => {
  it('sépare une mélodie et des accords de basse', () => {
    const notes = [48, 52, 55, 72].map((p) => raw(p, 0)).concat([74, 76].map((p, i) => raw(p, 0.5 + i * 0.5)));
    const hands = Object.fromEntries(estimateHands(notes).map((n) => [n.pitch, n.hand]));
    expect(hands).toEqual({ 48: 'left', 52: 'left', 55: 'left', 72: 'right', 74: 'right', 76: 'right' });
  });

  it('laisse la main gauche monter au-dessus du do central', () => {
    // La main gauche joue un ré3 (62) pendant que la droite est dans l'aigu : une coupure fixe au do se tromperait.
    const notes = [raw(55, 0), raw(72, 0), raw(59, 0.5), raw(74, 0.5), raw(62, 1), raw(76, 1)];
    const left = estimateHands(notes).filter((n) => n.hand === 'left').map((n) => n.pitch);
    expect(left).toEqual([55, 59, 62]);
  });

  it('suit une main droite qui descend sous le do central', () => {
    const melody = [67, 64, 62, 60, 59, 57].map((p, i) => raw(p, i * 0.5));
    expect(estimateHands([raw(43, 0), ...melody]).filter((n) => n.hand === 'right').length).toBe(6);
  });
});

describe('difficulté estimée', () => {
  const level = (id: string) => estimateDifficulty(DEMOS.find((d) => d.id === id)!.load()).level;

  it('met les démos au plus bas et range le menuet après les comptines', () => {
    const score = (id: string) => estimateDifficulty(DEMOS.find((d) => d.id === id)!.load()).score;
    expect(level('demo:clair-de-lune')).toBe(1);
    expect(level('demo:ode-a-la-joie')).toBe(1);
    expect(level('demo:menuet-en-sol')).toBeLessThanOrEqual(2);
    expect(score('demo:menuet-en-sol')).toBeGreaterThan(score('demo:ode-a-la-joie'));
  });

  it('met un passage rapide en accords tout en haut', () => {
    const fast = 'C4+E4+G4+C5:0.25 '.repeat(64);
    const song = songFromNotation({ title: 'x', bpm: 160, beatsPerBar: 4, right: fast, left: 'C2+G2+C3:0.25 '.repeat(64) });
    expect(estimateDifficulty(song).level).toBe(5);
  });
});
