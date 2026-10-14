import type { Midi } from '@tonejs/midi';
import { assignHands, type TrackNotes } from './hands';
import { buildSong, type Song } from './types';

// Conversion d'un fichier MIDI déjà lu en morceau. Séparée de la lecture pour que le script
// du catalogue (scripts/build-catalog.mjs) puisse s'en servir sous Node.

/** Début de chaque mesure, d'après les chiffrages de mesure du fichier. */
function computeBars(midi: Midi): number[] {
  const { ppq } = midi.header;
  const signatures = [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks);
  if (signatures.length === 0 || signatures[0].ticks > 0) {
    signatures.unshift({ ticks: 0, timeSignature: [4, 4] });
  }
  const endTick = midi.durationTicks;
  const bars: number[] = [];
  signatures.forEach((sig, i) => {
    const [num, den] = sig.timeSignature;
    const barTicks = (ppq * 4 * num) / den;
    const segmentEnd = signatures[i + 1]?.ticks ?? endTick;
    for (let tick = sig.ticks; tick < segmentEnd; tick += barTicks) {
      bars.push(midi.header.ticksToSeconds(tick));
    }
  });
  return bars;
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
  const song = buildSong(title, notes, computeBars(midi), method);
  song.quarterToSeconds = (quarters) => midi.header.ticksToSeconds(quarters * midi.header.ppq);
  return song;
}
