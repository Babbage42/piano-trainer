import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { DEMOS } from '../src/song/demos';
import { assignHands } from '../src/song/hands';
import { songFromMidi } from '../src/song/midi-loader';
import { parseVoice, songFromNotation } from '../src/song/notation';
import { frenchName, frenchOctave, parsePitch } from '../src/song/pitch';
import { barIndexAt } from '../src/song/types';

describe('hauteurs', () => {
  it('lit les noms de notes', () => {
    expect(parsePitch('C4')).toBe(60);
    expect(parsePitch('A4')).toBe(69);
    expect(parsePitch('F#3')).toBe(54);
    expect(parsePitch('Bb2')).toBe(46);
    expect(() => parsePitch('H2')).toThrow();
  });

  it('nomme les notes à la française', () => {
    expect(frenchName(60)).toBe('Do');
    expect(frenchOctave(60)).toBe(3);
    expect(frenchName(66)).toBe('Fa♯');
  });
});

describe('notation des démos', () => {
  it('place les notes, accords et silences dans le temps', () => {
    const notes = parseVoice('C4 r:1 C3+E3+G3:2 | D4:0.5', 'left', 0.5);
    expect(notes.map((n) => [n.pitch, n.start])).toEqual([
      [60, 0],
      [48, 1],
      [52, 1],
      [55, 1],
      [62, 2],
    ]);
    expect(notes[1].duration).toBeCloseTo(0.94);
  });

  it('découpe les mesures', () => {
    const song = songFromNotation({ title: 't', bpm: 60, beatsPerBar: 3, right: 'C4:3 D4:3', left: '' });
    expect(song.bars).toEqual([0, 3]);
    expect(barIndexAt(song, 2.9)).toBe(0);
    expect(barIndexAt(song, 3)).toBe(1);
  });

  it('chaque démo a des mesures complètes et deux mains', () => {
    for (const demo of DEMOS) {
      const song = demo.load();
      const hands = new Set(song.notes.map((n) => n.hand));
      expect(hands, demo.title).toEqual(new Set(['right', 'left']));
      // Les deux mains finissent à la même mesure.
      const lastBar = (hand: string) =>
        barIndexAt(song, Math.max(...song.notes.filter((n) => n.hand === hand).map((n) => n.start)));
      expect(lastBar('right'), demo.title).toBe(lastBar('left'));
      expect(lastBar('right'), demo.title).toBe(song.bars.length - 1);
    }
  });
});

describe('attribution des mains', () => {
  const note = (pitch: number) => ({ pitch, start: 0, duration: 1, velocity: 1 });

  it('utilise les noms de pistes', () => {
    const r = assignHands([
      { name: 'Piano left hand', notes: [note(70)] },
      { name: 'Piano right hand', notes: [note(40)] },
    ]);
    expect(r.notes.map((n) => n.hand)).toEqual(['left', 'right']);
  });

  it('met la piste la plus aiguë à droite', () => {
    const r = assignHands([
      { name: 'Piano', notes: [note(48), note(43)] },
      { name: 'Piano', notes: [note(72), note(67)] },
    ]);
    expect(r.notes.map((n) => n.hand)).toEqual(['left', 'left', 'right', 'right']);
    expect(r.method).toBe('separate');
  });

  it('estime les mains d\'une piste unique', () => {
    const r = assignHands([{ name: '', notes: [note(43), note(72)] }]);
    expect(r.method).toBe('estimated');
    expect(r.notes.map((n) => n.hand)).toEqual(['left', 'right']);
  });
});

describe('lecture de fichiers MIDI', () => {
  it('lit notes, mains et mesures', () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4] });
    const right = midi.addTrack();
    right.name = 'Right';
    right.addNote({ midi: 72, time: 0, duration: 0.5 });
    right.addNote({ midi: 74, time: 3, duration: 0.5 });
    const left = midi.addTrack();
    left.name = 'Left';
    left.addNote({ midi: 48, time: 0, duration: 1.5 });
    const song = songFromMidi(midi.toArray().buffer as ArrayBuffer, 'Mon morceau');

    expect(song.title).toBe('Mon morceau');
    expect(song.notes.map((n) => [n.pitch, n.hand])).toEqual([
      [48, 'left'],
      [72, 'right'],
      [74, 'right'],
    ]);
    expect(song.notes[2].start).toBeCloseTo(3);
    // 3/4 à 120 à la noire : une mesure dure 1,5 s.
    expect(song.bars[1]).toBeCloseTo(1.5);
    expect(song.bars[2]).toBeCloseTo(3);
    // Les temps du métronome : trois noires par mesure.
    expect(song.beats!.slice(0, 4).map((t) => Math.round(t * 100) / 100)).toEqual([0, 0.5, 1, 1.5]);
  });

  it('bat la noire pointée en 6/8', () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [6, 8] });
    midi.addTrack().addNote({ midi: 72, time: 0, duration: 3 });
    const song = songFromMidi(midi.toArray().buffer as ArrayBuffer, '6/8');
    // Six croches à 120 à la noire : 1,5 s par mesure, deux temps de 0,75 s.
    expect(song.beats!.slice(0, 3).map((t) => Math.round(t * 100) / 100)).toEqual([0, 0.75, 1.5]);
  });
});
