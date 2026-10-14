import { describe, expect, it } from 'vitest';
import { autoFingerSong, fingerHand } from '../src/score/auto-fingering';
import { DEMOS } from '../src/song/demos';
import { parsePitch } from '../src/song/pitch';

const melody = (names: string, step = 0.25) =>
  names.split(' ').map((name, i) => ({ pitch: parsePitch(name), start: i * step, duration: step * 0.9 }));

describe('doigtés calculés', () => {
  it('doigte la gamme de do majeur comme dans les méthodes, avec le passage du pouce', () => {
    expect(fingerHand(melody('C4 D4 E4 F4 G4 A4 B4 C5'), 'right')).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
    expect(fingerHand(melody('C5 B4 A4 G4 F4 E4 D4 C4'), 'right')).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });

  it('doigte la gamme de main gauche en miroir', () => {
    expect(fingerHand(melody('C3 D3 E3 F3 G3 A3 B3 C4'), 'left')).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });

  it('garde une position à cinq doigts pour cinq notes voisines', () => {
    expect(fingerHand(melody('C4 D4 E4 F4 G4 F4 E4 D4 C4'), 'right')).toEqual([1, 2, 3, 4, 5, 4, 3, 2, 1]);
  });

  it('respecte les doigtés imposés', () => {
    const notes = melody('C4 D4 E4');
    notes[0] = { ...notes[0], finger: 2 } as (typeof notes)[0] & { finger: number };
    expect(fingerHand(notes, 'right')[0]).toBe(2);
  });

  it('doigte un accord de main droite du pouce vers le haut', () => {
    const chord = ['C4', 'E4', 'G4'].map((n) => ({ pitch: parsePitch(n), start: 0, duration: 1 }));
    expect(fingerHand(chord, 'right')).toEqual([1, 3, 5]);
    expect(fingerHand(chord, 'left')).toEqual([5, 3, 1]);
  });

  it('retrouve la plupart des doigtés écrits des démos', () => {
    let same = 0;
    let total = 0;
    for (const demo of DEMOS) {
      const song = demo.load();
      const written = song.notes.map((n) => n.finger);
      for (const n of song.notes) delete n.finger;
      autoFingerSong(song);
      song.notes.forEach((n, i) => {
        total++;
        if (n.finger === written[i]) same++;
      });
      expect(song.notes.every((n) => n.fingerAuto && n.finger)).toBe(true);
    }
    expect(same / total).toBeGreaterThan(0.6);
  });
});
