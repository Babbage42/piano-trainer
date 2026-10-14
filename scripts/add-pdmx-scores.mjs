// Ajoute les partitions MusicXML au catalogue PDMX (.cache/pdmx/catalog.json). Le script lit une
// archive tar.gz de PDMX qui contient les .mxl, depuis un fichier ou au fil d'un téléchargement,
// et ne garde que les partitions des pièces du catalogue (rien d'autre n'arrive sur le disque).
// Chaque pièce indique ensuite la part de ses notes qui porte un doigté écrit.
//
//   curl -L https://huggingface.co/datasets/openmusic/pdmx/resolve/main/PDMX.tar.gz | node scripts/add-pdmx-scores.mjs
//   node scripts/add-pdmx-scores.mjs chemin/vers/mxl.tar.gz

import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tarEntries, zipEntries } from './lib/archives.mjs';

const DIR = fileURLToPath(new URL('../.cache/pdmx/', import.meta.url));

/** Part des notes jouées (hors silences) qui portent un doigté écrit dans la partition. */
function fingeringShare(mxl) {
  const entry = zipEntries(mxl).find((e) => /\.(xml|musicxml)$/i.test(e.name) && !e.name.startsWith('META-INF'));
  if (!entry) return 0;
  const xml = entry.read().toString('utf8');
  const notes = (xml.match(/<note[\s>]/g) ?? []).length - (xml.match(/<rest[\s/>]/g) ?? []).length;
  const fingerings = (xml.match(/<fingering[\s>]/g) ?? []).length;
  return notes > 0 ? Math.min(1, fingerings / notes) : 0;
}

const catalog = JSON.parse(await readFile(`${DIR}catalog.json`, 'utf8'));
// mid/1/11/Qm….mid et mxl/1/11/Qm….mxl : même empreinte, autre dossier.
const byScore = new Map(catalog.pieces.map((p) => [p.file.replace(/^mid\//, 'mxl/').replace(/\.mid$/, '.mxl'), p]));

// Les copies de PDMX rangent parfois tout sous un dossier racine (« PDMX/mxl/… »).
const scorePath = (name) => name.replace(/^[^/]+\/(?=mxl\/)/, '');

const input = process.argv[2] ? createReadStream(process.argv[2]) : process.stdin;
let seen = 0;
let found = 0;
const want = (name) => {
  if (++seen % 5000 === 0) process.stdout.write(`\rarchive : ${seen} fichiers parcourus, ${found} partitions gardées`);
  return byScore.has(scorePath(name));
};
for await (const { name, data } of tarEntries(input, want)) {
  const path = scorePath(name);
  const piece = byScore.get(path);
  try {
    piece.fingering = Math.round(fingeringShare(data) * 100) / 100;
    await mkdir(dirname(`${DIR}${path}`), { recursive: true });
    await writeFile(`${DIR}${path}`, data);
    piece.score = path;
    found++;
  } catch {
    // Partition illisible : la pièce reste jouable, sans partition.
  }
}

await writeFile(`${DIR}catalog.json`, JSON.stringify(catalog));
const count = (f) => catalog.pieces.filter(f).length;
console.log(`\narchive : ${seen} fichiers parcourus`);
console.log(`partitions : ${count((p) => p.score)} sur ${catalog.pieces.length} pièces`);
console.log(`  doigtés sur au moins la moitié des notes : ${count((p) => p.fingering >= 0.5)}`);
console.log(`  quelques doigtés (5 à 50 %) : ${count((p) => p.fingering >= 0.05 && p.fingering < 0.5)}`);
