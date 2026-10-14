import { Midi } from '@tonejs/midi';
import { songFromParsedMidi } from './midi-convert';
import type { Song } from './types';

export function songFromMidi(data: ArrayBuffer, title: string): Song {
  return songFromParsedMidi(new Midi(data), title);
}
