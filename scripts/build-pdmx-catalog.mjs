// Construit .cache/pdmx/catalog.json à partir de PDMX (partitions MuseScore du domaine public,
// https://zenodo.org/records/15571083) : seulement les pièces pour piano seul, sans conflit de
// licence, vues au moins 50 fois sur MuseScore (ce qui écarte brouillons et essais ; les filtres
// anti-doublons de PDMX, eux, écartaient des arrangements utiles). Chaque pièce est analysée avec le code de l'app (mains, niveau)
// et son fichier MIDI est extrait dans .cache/pdmx/mid/, d'où le serveur de développement le sert.
//
// Prérequis, dans .cache/pdmx/ : PDMX.csv et mid.tar.gz (environ 440 Mo, voir le README).
// Les partitions s'ajoutent ensuite avec scripts/add-pdmx-scores.mjs.
//
//   node scripts/build-pdmx-catalog.mjs

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { tarEntries } from './lib/archives.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}.cache/pdmx/`;

/** Programmes MIDI des pianos (piano acoustique, électrique, clavecin exclus). */
const PIANO_PROGRAMS = new Set(['0', '1', '2', '3', '4', '5']);
const MIN_NOTES = 24;
const MIN_VIEWS = 50;

// --- Lecture du CSV (champs entre guillemets, virgules et retours à la ligne possibles) ---

function parseCsv(text, onRow) {
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      onRow(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) onRow([...row, field]);
}

const na = (value) => (value === 'NA' || value === '' ? '' : value);

function selectPieces(csvText) {
  const wanted = new Map();
  let header = null;
  let total = 0;
  parseCsv(csvText, (row) => {
    if (!header) {
      header = Object.fromEntries(row.map((name, i) => [name, i]));
      return;
    }
    total++;
    const get = (name) => row[header[name]] ?? '';
    const programs = get('tracks').split('-');
    const isPiano = programs.length >= 1 && programs.length <= 2 && programs.every((p) => PIANO_PROGRAMS.has(p));
    if (!isPiano) return;
    if (get('subset:no_license_conflict') !== 'True' || Number(get('n_views')) < MIN_VIEWS) return;
    if (get('has_paywall') === 'True' || Number(get('n_notes')) < MIN_NOTES) return;
    const mid = get('mid').replace(/^\.\//, '');
    const scoreId = /(\d+)\.json$/.exec(get('metadata'))?.[1];
    if (!mid || !scoreId) return;
    wanted.set(mid, {
      id: Number(scoreId),
      // Le titre de l'auteur dit l'essentiel (« Easy Piano », « 1st movement ») ; le nom de l'œuvre aide à chercher.
      title: na(get('title')) || na(get('song_name')),
      work: na(get('song_name')),
      composer: na(get('composer_name')) || na(get('artist_name')),
      genre: na(get('genres')).split('-')[0] ?? '',
      license: get('license'),
      rating: Number(get('rating')) || 0,
      ratings: Number(get('n_ratings')) || 0,
      views: Number(get('n_views')) || 0,
      // Difficulté choisie par l'auteur sur MuseScore : 0 non précisée, 1 débutant, 2 intermédiaire, 3 avancé.
      authorLevel: Number(get('complexity')) || 0,
    });
  });
  return { wanted, total };
}

// --- Construction du catalogue ---

async function main() {
  for (const file of ['PDMX.csv', 'mid.tar.gz']) {
    if (!existsSync(`${DIR}${file}`)) throw new Error(`${DIR}${file} manquant : télécharge-le d'abord (voir le README).`);
  }

  console.log('lecture de PDMX.csv…');
  const { wanted, total } = selectPieces(await readFile(`${DIR}PDMX.csv`, 'utf8'));
  console.log(`${total} partitions, ${wanted.size} pour piano seul retenues`);

  const { Midi } = createRequire(import.meta.url)('@tonejs/midi');
  const options = { root: ROOT, configFile: false };
  const { module: convert } = await runnerImport(`${ROOT}src/song/midi-convert.ts`, options);
  const { module: difficulty } = await runnerImport(`${ROOT}src/song/difficulty.ts`, options);

  const pieces = [];
  let seen = 0;
  let failed = 0;
  for await (const { name, data } of tarEntries(createReadStream(`${DIR}mid.tar.gz`), (n) => wanted.has(n))) {
    const info = wanted.get(name);
    if (!info) continue;
    seen++;
    if (seen % 500 === 0) process.stdout.write(`\ranalyse : ${seen} / ${wanted.size}`);
    try {
      const song = convert.songFromParsedMidi(new Midi(data), info.title);
      if (song.notes.length < MIN_NOTES) continue;
      const target = `${DIR}${name}`;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
      pieces.push({
        ...info,
        file: name,
        hands: song.hands,
        level: difficulty.estimateDifficulty(song).level,
        bars: song.bars.length,
        duration: Math.round(song.duration),
      });
    } catch {
      failed++;
    }
  }
  console.log(`\nanalyse : ${pieces.length} pièces gardées, ${failed} fichiers illisibles`);


  await writeFile(
    `${DIR}catalog.json`,
    JSON.stringify({
      source: 'PDMX (MuseScore, domaine public)',
      url: 'https://zenodo.org/records/15571083',
      generated: new Date().toISOString().slice(0, 10),
      pieces,
    }),
  );
  const count = (f) => pieces.filter(f).length;
  console.log(`catalogue : ${pieces.length} pièces → ${DIR}catalog.json`);
  console.log(`  mains séparées : ${count((p) => p.hands === 'separate')}, estimées : ${count((p) => p.hands === 'estimated')}`);
  console.log(`  niveaux : ${[1, 2, 3, 4, 5].map((l) => `${l}=${count((p) => p.level === l)}`).join(' ')}`);
  console.log(`  difficulté de l'auteur : ${[0, 1, 2, 3].map((l) => `${l}=${count((p) => p.authorLevel === l)}`).join(' ')}`);
}

await main();
