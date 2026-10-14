import { musicXmlFromNotation } from '../score/musicxml';
import { songFromNotation, type NotationSong } from './notation';
import type { Song } from './types';

// Morceaux du domaine public, écrits à la main pour essayer l'app sans fichier.

const AU_CLAIR_DE_LA_LUNE: NotationSong = {
  title: 'Au clair de la lune',
  bpm: 100,
  beatsPerBar: 4,
  right: `
    C4@1 C4@1 C4@1 D4@2 | E4@3:2 D4@2:2 | C4@1 E4@3 D4@2 D4@2 | C4@1:4 |
    C4@1 C4@1 C4@1 D4@2 | E4@3:2 D4@2:2 | C4@1 E4@3 D4@2 D4@2 | C4@1:4 |
    D4@5 D4@5 D4@5 D4@5 | A3@2:2 A3@2:2 | D4@5 C4@4 B3@3 A3@2 | G3@1:4 |
    C4@1 C4@1 C4@1 D4@2 | E4@3:2 D4@2:2 | C4@1 E4@3 D4@2 D4@2 | C4@1:4 |`,
  left: `
    C3@2:4 | C3@2:2 G2@5:2 | C3@2:2 G2@5:2 | C3@2:4 |
    C3@2:4 | C3@2:2 G2@5:2 | C3@2:2 G2@5:2 | C3@2:4 |
    G2@5:4 | D3@1:4        | G2@5:4        | G2@5:4 |
    C3@2:4 | C3@2:2 G2@5:2 | C3@2:2 G2@5:2 | C3@2:4 |`,
};

const ODE_A_LA_JOIE: NotationSong = {
  title: 'Ode à la joie (Beethoven)',
  bpm: 100,
  beatsPerBar: 4,
  right: `
    E4@3 E4@3 F4@4 G4@5 | G4@5 F4@4 E4@3 D4@2 | C4@1 C4@1 D4@2 E4@3 | E4@3:1.5 D4@2:0.5 D4@2:2 |
    E4@3 E4@3 F4@4 G4@5 | G4@5 F4@4 E4@3 D4@2 | C4@1 C4@1 D4@2 E4@3 | D4@2:1.5 C4@1:0.5 C4@1:2 |
    D4@2 D4@2 E4@3 C4@1 | D4@2 E4@3:0.5 F4@4:0.5 E4@3 C4@1 | D4@2 E4@3:0.5 F4@4:0.5 E4@3 D4@2 | C4@1 D4@2 G3@1:2 |
    E4@3 E4@3 F4@4 G4@5 | G4@5 F4@4 E4@3 D4@2 | C4@1 C4@1 D4@2 E4@3 | D4@2:1.5 C4@1:0.5 C4@1:2 |`,
  left: `
    C3@2:4        | G2@5:4        | C3@2:4 | C3@2:2 G2@5:2 |
    C3@2:4        | G2@5:4        | C3@2:4 | G2@5:2 C3@2:2 |
    G2@5:2 C3@2:2 | G2@5:2 C3@2:2 | G2@5:4 | C3@2:2 G2@5:2 |
    C3@2:4        | G2@5:4        | C3@2:4 | G2@5:2 C3@2:2 |`,
};

const MENUET_EN_SOL: NotationSong = {
  title: 'Menuet en sol (Petzold, simplifié)',
  bpm: 90,
  beatsPerBar: 3,
  fifths: 1,
  right: `
    D5@5 G4@1:0.5 A4@2:0.5 B4@3:0.5 C5@4:0.5 | D5@5 G4@1 G4@1 | E5@3 C5@1:0.5 D5@2:0.5 E5@3:0.5 F#5@4:0.5 | G5@5 G4@1 G4@1 |
    C5@4 D5@5:0.5 C5@4:0.5 B4@3:0.5 A4@2:0.5 | B4@3 C5@4:0.5 B4@3:0.5 A4@2:0.5 G4@1:0.5 | F#4@1 G4@2:0.5 A4@3:0.5 B4@4:0.5 G4@2:0.5 | A4@3:3 |
    D5@5 G4@1:0.5 A4@2:0.5 B4@3:0.5 C5@4:0.5 | D5@5 G4@1 G4@1 | E5@3 C5@1:0.5 D5@2:0.5 E5@3:0.5 F#5@4:0.5 | G5@5 G4@1 G4@1 |
    C5@4 D5@5:0.5 C5@4:0.5 B4@3:0.5 A4@2:0.5 | B4@3 C5@4:0.5 B4@3:0.5 A4@2:0.5 G4@1:0.5 | A4@3 B4@4:0.5 A4@3:0.5 G4@2:0.5 F#4@1:0.5 | G4@2:3 |`,
  left: `
    G3@5+B3@3+D4@1:2 A3@4 | B3@3:3 | C4@2:3 | B3@3:3 |
    A3@4:3 | G3@5:3 | D4@1 B3@3 G3@5 | D4@1 D3@5:0.5 C4@1:0.5 B3@2:0.5 A3@3:0.5 |
    B3@2:2 A3@3 | G3@4 B3@2 G3@4 | C4@1:3 | B3@2 C4@1:0.5 B3@2:0.5 A3@3:0.5 G3@4:0.5 |
    A3@3:2 F#3@5 | G3@4:2 B3@2 | C4@2 D4@1 D3@5 | G3@1:2 G2@5 |`,
};

export interface DemoEntry {
  id: string;
  title: string;
  load: () => Song;
  /** La partition MusicXML de la démo, avec ses doigtés. */
  score: () => string;
}

export const DEMOS: DemoEntry[] = (
  [
    ['demo:clair-de-lune', AU_CLAIR_DE_LA_LUNE],
    ['demo:ode-a-la-joie', ODE_A_LA_JOIE],
    ['demo:menuet-en-sol', MENUET_EN_SOL],
  ] as const
).map(([id, def]) => ({
  id,
  title: def.title,
  load: () => songFromNotation(def),
  score: () => musicXmlFromNotation(def),
}));
