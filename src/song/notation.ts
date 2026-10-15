import { parsePitch } from './pitch';
import { buildSong, type Hand, type RawNote, type Song } from './types';

/**
 * Petite notation texte pour écrire les morceaux de démo à la main.
 *
 * Chaque main est une suite de jetons séparés par des espaces :
 *   C4:1       une note, durée en temps (1 = une noire)
 *   C4@1:1     la même, jouée avec le pouce (doigts 1 à 5)
 *   C3+E3+G3:2 un accord
 *   r:1        un silence
 *   |          une barre de mesure (purement visuelle)
 * Une durée absente vaut 1.
 */
export interface NotationSong {
  title: string;
  bpm: number;
  beatsPerBar: number;
  /** Armure, en nombre de dièses (positif) ou de bémols (négatif). */
  fifths?: number;
  right: string;
  left: string;
}

export interface NotationEvent {
  /** Position et durée en temps (noires). */
  beat: number;
  beats: number;
  /** Vide pour un silence. */
  notes: Array<{ name: string; pitch: number; finger?: number }>;
}

export function parseTokens(text: string): NotationEvent[] {
  const events: NotationEvent[] = [];
  let beat = 0;
  for (const token of text.split(/\s+/)) {
    if (!token || token === '|') continue;
    const [pitches, durText] = token.split(':');
    const beats = durText === undefined ? 1 : Number(durText);
    if (!(beats > 0)) throw new Error(`Durée illisible : « ${token} »`);
    const notes =
      pitches === 'r'
        ? []
        : pitches.split('+').map((part) => {
            const [name, finger] = part.split('@');
            return { name, pitch: parsePitch(name), finger: finger ? Number(finger) : undefined };
          });
    events.push({ beat, beats, notes });
    beat += beats;
  }
  return events;
}

export function parseVoice(text: string, hand: Hand, secondsPerBeat: number): Array<RawNote & { hand: Hand; finger?: number }> {
  const notes: Array<RawNote & { hand: Hand; finger?: number }> = [];
  for (const event of parseTokens(text)) {
    // Petit blanc avant la note suivante pour que deux notes répétées restent distinctes.
    const gap = Math.min(0.06, event.beats * secondsPerBeat * 0.1);
    for (const note of event.notes) {
      notes.push({
        pitch: note.pitch,
        start: event.beat * secondsPerBeat,
        duration: event.beats * secondsPerBeat - gap,
        velocity: hand === 'right' ? 0.7 : 0.55,
        hand,
        finger: note.finger,
      });
    }
  }
  return notes;
}

export function songFromNotation(def: NotationSong): Song {
  const secondsPerBeat = 60 / def.bpm;
  const notes = [
    ...parseVoice(def.right, 'right', secondsPerBeat),
    ...parseVoice(def.left, 'left', secondsPerBeat),
  ];
  const end = notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
  const barLength = def.beatsPerBar * secondsPerBeat;
  const bars: number[] = [];
  for (let t = 0; t < end - 1e-6; t += barLength) bars.push(t);
  const song = buildSong(def.title, notes, bars, 'separate');
  song.beats = bars.flatMap((bar) => Array.from({ length: def.beatsPerBar }, (_, k) => bar + k * secondsPerBeat));
  song.quarterToSeconds = (quarters) => quarters * secondsPerBeat;
  return song;
}
