import type { Midi } from '@tonejs/midi';
import { assignHands, type TrackNotes } from './hands';
import { buildSong, type Song } from './types';

// Conversion d'un fichier MIDI déjà lu en morceau. Séparée de la lecture pour que le script
// du catalogue (scripts/build-catalog.mjs) puisse s'en servir sous Node.

/** Début de chaque mesure et de chaque temps, d'après les chiffrages de mesure du fichier. */
function computeGrid(midi: Midi): { bars: number[]; beats: number[] } {
  const { ppq } = midi.header;
  const signatures = [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks);
  if (signatures.length === 0 || signatures[0].ticks > 0) {
    signatures.unshift({ ticks: 0, timeSignature: [4, 4] });
  }
  const endTick = midi.durationTicks;
  const bars: number[] = [];
  const beats: number[] = [];
  signatures.forEach((sig, i) => {
    const [num, den] = sig.timeSignature;
    const barTicks = (ppq * 4 * num) / den;
    // En 6/8, 9/8 ou 12/8, on bat la noire pointée (trois croches), comme un musicien.
    const compound = den === 8 && num % 3 === 0 && num > 3;
    const beatTicks = ((ppq * 4) / den) * (compound ? 3 : 1);
    const segmentEnd = signatures[i + 1]?.ticks ?? endTick;
    for (let tick = sig.ticks; tick < segmentEnd; tick += barTicks) {
      bars.push(midi.header.ticksToSeconds(tick));
      for (let beat = tick; beat < Math.min(tick + barTicks, segmentEnd) - 1e-6; beat += beatTicks) {
        beats.push(midi.header.ticksToSeconds(beat));
      }
    }
  });
  return { bars, beats };
}

/** Le titre vient du nom du fichier : le nom inscrit dans le MIDI est souvent vide ou générique. */
export function songFromParsedMidi(midi: Midi, title: string): Song {
  const tracks: TrackNotes[] = midi.tracks
    .filter((t) => !t.instrument.percussion)
    .map((t) => ({
      name: t.name,
      notes: t.notes.map((n) => ({
        pitch: n.midi,
        start: n.time,
        duration: Math.max(n.duration, 0.05),
        velocity: n.velocity,
      })),
    }));
  const { notes, method } = assignHands(tracks);
  const grid = computeGrid(midi);
  const song = buildSong(title, notes, grid.bars, method);
  song.beats = grid.beats;
  song.quarterToSeconds = (quarters) => midi.header.ticksToSeconds(quarters * midi.header.ppq);
  return song;
}
