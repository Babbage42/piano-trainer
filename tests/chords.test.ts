import { describe, expect, it } from 'vitest';
import { chordName, noteGroups } from '../src/song/chords';
import { parsePitch } from '../src/song/pitch';
import { songFromNotation } from '../src/song/notation';

const name = (...notes: string[]) => chordName(notes.map(parsePitch));

describe('noms des accords', () => {
  it('reconnaît les accords courants', () => {
    expect(name('C4', 'E4', 'G4')).toBe('Do');
    expect(name('A3', 'C4', 'E4')).toBe('La m');
    expect(name('G3', 'B3', 'D4', 'F4')).toBe('Sol 7');
    expect(name('C4', 'E4', 'G4', 'B4')).toBe('Do 7M');
    expect(name('B3', 'D4', 'F4')).toBe('Si dim');
    expect(name('Bb3', 'D4', 'F4')).toBe('Si♭');
  });

  it('ignore les octaves, les doublures et les renversements', () => {
    expect(name('C3', 'C4', 'E4', 'G4', 'C5')).toBe('Do');
    expect(name('E3', 'G3', 'C4')).toBe('Do');
    // Une note à la main gauche, deux à la main droite : c'est bien un accord.
    expect(name('F2', 'A4', 'C5')).toBe('Fa');
  });

  it('tranche par la basse quand deux lectures existent', () => {
    expect(name('C4', 'D4', 'G4')).toBe('Do sus2');
    expect(name('G3', 'C4', 'D4')).toBe('Sol sus4');
    // Ni do ni sol à la basse : pas de nom plutôt qu'un nom au hasard.
    expect(name('D3', 'C4', 'G4')).toBeNull();
  });

  it("ne nomme rien quand ce n'est pas évident", () => {
    expect(name('C4', 'E4')).toBeNull();
    expect(name('G3', 'G4')).toBeNull();
    expect(name('C4', 'D4', 'E4')).toBeNull();
    expect(name('C4', 'E4', 'G4', 'A4', 'D5')).toBeNull();
    // Augmenté : symétrique, sa fondamentale est ambiguë.
    expect(name('C4', 'E4', 'G#4')).toBeNull();
  });
});

describe('notes à jouer ensemble', () => {
  it('regroupe les notes qui commencent ensemble, les deux mains comprises', () => {
    const song = songFromNotation({ title: 't', bpm: 60, beatsPerBar: 4, right: 'E4+G4 D4 C4', left: 'C3 G2:2' });
    const groups = noteGroups(song);
    expect(groups.map((g) => g.notes.map((n) => n.pitch))).toEqual([
      [48, 64, 67],
      [43, 62],
    ]);
    expect(groups.map((g) => g.chord)).toEqual(['Do', null]);
  });
});
