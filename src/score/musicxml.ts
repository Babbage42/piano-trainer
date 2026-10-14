import { parseTokens, type NotationEvent, type NotationSong } from '../song/notation';

// Partition MusicXML d'un morceau de démo : une partie de piano sur deux portées
// (main droite en clé de sol, main gauche en clé de fa), avec ses doigtés.

const DIVISIONS = 4; // une noire = 4 : on descend jusqu'à la double croche.

const TYPES: Record<number, { type: string; dot?: boolean }> = {
  16: { type: 'whole' },
  12: { type: 'half', dot: true },
  8: { type: 'half' },
  6: { type: 'quarter', dot: true },
  4: { type: 'quarter' },
  3: { type: 'eighth', dot: true },
  2: { type: 'eighth' },
  1: { type: '16th' },
};

function noteXml(event: NotationEvent, staff: number, voice: number): string {
  const duration = Math.round(event.beats * DIVISIONS);
  const shape = TYPES[duration];
  if (!shape) throw new Error(`Durée sans figure de note : ${event.beats} temps`);
  const common = `<duration>${duration}</duration><voice>${voice}</voice><type>${shape.type}</type>${shape.dot ? '<dot/>' : ''}<staff>${staff}</staff>`;
  if (event.notes.length === 0) return `<note><rest/>${common}</note>`;
  return event.notes
    .map((note, i) => {
      const [, step, accidental, octave] = /^([A-G])([#b]?)(-?\d)$/.exec(note.name)!;
      const alter = accidental === '#' ? '<alter>1</alter>' : accidental === 'b' ? '<alter>-1</alter>' : '';
      const fingering = note.finger
        ? `<notations><technical><fingering>${note.finger}</fingering></technical></notations>`
        : '';
      return `<note>${i > 0 ? '<chord/>' : ''}<pitch><step>${step}</step>${alter}<octave>${octave}</octave></pitch>${common}${fingering}</note>`;
    })
    .join('');
}

/** Les événements d'une main, rangés par mesure. Une note ne doit pas déborder sur la mesure suivante. */
function byMeasure(events: NotationEvent[], beatsPerBar: number, count: number): NotationEvent[][] {
  const measures: NotationEvent[][] = Array.from({ length: count }, () => []);
  for (const event of events) {
    const index = Math.floor(event.beat / beatsPerBar + 1e-9);
    if (event.beat + event.beats > (index + 1) * beatsPerBar + 1e-9) {
      throw new Error(`Une note déborde de la mesure ${index + 1}`);
    }
    measures[index].push(event);
  }
  return measures;
}

export function musicXmlFromNotation(def: NotationSong): string {
  const right = parseTokens(def.right);
  const left = parseTokens(def.left);
  const end = Math.max(...[...right, ...left].map((e) => e.beat + e.beats));
  const count = Math.ceil(end / def.beatsPerBar - 1e-9);
  const rightMeasures = byMeasure(right, def.beatsPerBar, count);
  const leftMeasures = byMeasure(left, def.beatsPerBar, count);
  const barDuration = def.beatsPerBar * DIVISIONS;

  const measures = rightMeasures.map((rh, i) => {
    const attributes =
      i === 0
        ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${def.fifths ?? 0}</fifths></key>` +
          `<time><beats>${def.beatsPerBar}</beats><beat-type>4</beat-type></time><staves>2</staves>` +
          `<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` +
          `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${def.bpm}</per-minute></metronome></direction-type><sound tempo="${def.bpm}"/></direction>`
        : '';
    const lh = leftMeasures[i];
    return (
      `<measure number="${i + 1}">${attributes}` +
      rh.map((e) => noteXml(e, 1, 1)).join('') +
      `<backup><duration>${barDuration}</duration></backup>` +
      lh.map((e) => noteXml(e, 2, 5)).join('') +
      `</measure>`
    );
  });

  const title = def.title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<score-partwise version="3.1"><work><work-title>${title}</work-title></work>` +
    `<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>` +
    `<part id="P1">${measures.join('')}</part></score-partwise>`
  );
}
