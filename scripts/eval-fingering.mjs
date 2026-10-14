// Mesure la fiabilité des doigtés calculés : sur les pièces PDMX doigtées par leur auteur,
// l'algorithme doigte toutes les notes sans voir les doigtés écrits, puis on compte combien
// il en retrouve.
//
//   node scripts/eval-fingering.mjs
//   node scripts/eval-fingering.mjs '{"weakFinger": 1}'   (essayer d'autres poids)

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { zipEntries } from './lib/archives.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}.cache/pdmx/`;
const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const tag = (xml, name) => new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml)?.[1];

/** Notes de la première partie d'un MusicXML : début en noires, hauteur MIDI, portée, doigté écrit. */
function readNotes(xml) {
  const part = /<part\b[\s\S]*?<\/part>/.exec(xml)?.[0] ?? '';
  const tempo = Number(/<sound[^>]*tempo="([\d.]+)"/.exec(xml)?.[1]) || 100;
  const notes = [];
  let divisions = 1;
  let measureStart = 0;
  for (const measure of part.match(/<measure\b[\s\S]*?<\/measure>/g) ?? []) {
    let pos = 0;
    let maxPos = 0;
    let lastOnset = 0;
    for (const [element, name] of measure.matchAll(/<(note|backup|forward|attributes)\b[\s\S]*?<\/\1>/g)) {
      if (name === 'attributes') {
        divisions = Number(tag(element, 'divisions')) || divisions;
      } else if (name === 'backup') {
        pos -= Number(tag(element, 'duration')) || 0;
      } else if (name === 'forward') {
        pos += Number(tag(element, 'duration')) || 0;
      } else {
        if (element.includes('<grace')) continue;
        const duration = Number(tag(element, 'duration')) || 0;
        const chord = element.includes('<chord');
        const onset = chord ? lastOnset : pos;
        if (!chord) {
          lastOnset = pos;
          pos += duration;
        }
        maxPos = Math.max(maxPos, pos);
        const step = tag(element, 'step');
        const tiedOnly = element.includes('<tie type="stop"') && !element.includes('<tie type="start"');
        if (!step || element.includes('<rest') || tiedOnly) continue;
        const pitch = (Number(tag(element, 'octave')) + 1) * 12 + STEPS[step] + Math.round(Number(tag(element, 'alter') ?? 0));
        const finger = Number(tag(element, 'fingering'));
        const quarters = (measureStart + onset) / divisions;
        notes.push({
          pitch,
          start: (quarters * 60) / tempo,
          duration: ((duration / divisions) * 60) / tempo,
          staff: Number(tag(element, 'staff')) || 1,
          written: finger >= 1 && finger <= 5 ? finger : undefined,
        });
      }
    }
    measureStart += Math.max(maxPos, pos);
  }
  return notes;
}

const { module: auto } = await runnerImport(`${ROOT}src/score/auto-fingering.ts`, { root: ROOT, configFile: false });
// Pour essayer d'autres réglages : node scripts/eval-fingering.mjs '{"weakFinger": 1}'
if (process.argv[2]) Object.assign(auto.WEIGHTS, JSON.parse(process.argv[2]));
const catalog = JSON.parse(await readFile(`${DIR}catalog.json`, 'utf8'));
const pieces = catalog.pieces.filter((p) => p.score && p.fingering >= 0.05);

let same = 0;
let total = 0;
let sameBeginner = 0;
let totalBeginner = 0;
const perPiece = [];
for (const piece of pieces) {
  const entry = zipEntries(await readFile(`${DIR}${piece.score}`)).find(
    (e) => /\.(xml|musicxml)$/i.test(e.name) && !e.name.startsWith('META-INF'),
  );
  if (!entry) continue;
  const notes = readNotes(entry.read().toString('utf8'));
  let s = 0;
  let t = 0;
  for (const [staff, hand] of [[1, 'right'], [2, 'left']]) {
    const handNotes = notes.filter((n) => n.staff === staff);
    const fingers = auto.fingerHand(handNotes.map(({ written, ...n }) => n), hand);
    handNotes.forEach((n, i) => {
      if (!n.written) return;
      t++;
      if (fingers[i] === n.written) s++;
    });
  }
  if (t < 10) continue;
  same += s;
  total += t;
  if (piece.level <= 2) {
    sameBeginner += s;
    totalBeginner += t;
  }
  perPiece.push(s / t);
}

perPiece.sort((a, b) => a - b);
const pct = (x) => `${(x * 100).toFixed(1)} %`;
console.log(`${perPiece.length} pièces doigtées par leur auteur, ${total} doigtés écrits comparés`);
console.log(`doigtés identiques : ${pct(same / total)} (pièces de niveau 1-2 : ${pct(sameBeginner / totalBeginner)}, ${totalBeginner} doigtés)`);
console.log(`par pièce : médiane ${pct(perPiece[perPiece.length >> 1])}, quart le moins bon sous ${pct(perPiece[perPiece.length >> 2])}, quart le meilleur au-dessus de ${pct(perPiece[(perPiece.length * 3) >> 2])}`);
