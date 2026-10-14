import { describe, expect, it } from 'vitest';
import { applyFingerings, bestPitchOffset } from '../src/score/fingerings';
import { songFromNotation } from '../src/song/notation';

// 120 à la noire : une noire = 0,5 s.
const song = () => songFromNotation({ title: 't', bpm: 120, beatsPerBar: 4, right: 'C4 D4 E4 C4+E4', left: 'C3:4' });

describe('doigtés de la partition', () => {
  it('les recopie sur les notes jouées au même instant et à la même hauteur', () => {
    const s = song();
    const applied = applyFingerings(s, [
      { quarters: 0, pitch: 60, finger: 1 },
      { quarters: 0, pitch: 48, finger: 5 },
      { quarters: 1, pitch: 62, finger: 2 },
      { quarters: 2, pitch: 64 },
      { quarters: 3, pitch: 64, finger: 3 },
    ]);
    expect(applied).toBe(4);
    const finger = (pitch: number, start: number) => s.notes.find((n) => n.pitch === pitch && Math.abs(n.start - start) < 0.01)?.finger;
    expect(finger(60, 0)).toBe(1);
    expect(finger(48, 0)).toBe(5);
    expect(finger(62, 0.5)).toBe(2);
    expect(finger(64, 1)).toBeUndefined();
    expect(finger(64, 1.5)).toBe(3);
  });

  it("trouve le décalage d'octave entre la partition et le MIDI", () => {
    const s = song();
    const notes = [0, 1, 2].map((q, i) => ({ quarters: q, pitch: [60, 62, 64][i] - 48, finger: i + 1 }));
    expect(bestPitchOffset(s, notes)).toBe(48);
    expect(applyFingerings(s, notes)).toBe(3);
  });
});

describe('partition des démos', () => {
  it('produit un MusicXML à deux portées avec les doigtés et les mêmes notes que le morceau', async () => {
    const { DEMOS } = await import('../src/song/demos');
    for (const demo of DEMOS) {
      const xml = demo.score();
      const song = demo.load();
      expect(xml, demo.title).toContain('<staves>2</staves>');
      const pitched = (xml.match(/<pitch>/g) ?? []).length;
      expect(pitched, demo.title).toBe(song.notes.length);
      expect((xml.match(/<fingering>/g) ?? []).length, demo.title).toBe(song.notes.filter((n) => n.finger).length);
      expect(song.notes.every((n) => n.finger), demo.title).toBe(true);
    }
  });
});
