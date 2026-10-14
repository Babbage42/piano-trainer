const LETTER_TO_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const FRENCH_NAMES = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

/** « C4 », « F#3 », « Bb2 » → numéro MIDI (C4 = 60). */
export function parsePitch(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Note illisible : « ${name} »`);
  const semitone = LETTER_TO_SEMITONE[m[1].toUpperCase()];
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + semitone + accidental;
}

export function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitch % 12);
}

/** Nom français sans octave : 61 → « Do♯ ». */
export function frenchName(pitch: number): string {
  return FRENCH_NAMES[pitch % 12];
}

/** Octave en notation française, où le do central (60) est Do3. */
export function frenchOctave(pitch: number): number {
  return Math.floor(pitch / 12) - 2;
}
