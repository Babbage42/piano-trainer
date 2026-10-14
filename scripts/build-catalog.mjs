// Construit public/catalog/mutopia.json : les pièces pour piano seul du Mutopia Project
// (domaine public ou Creative Commons), avec pour chacune la séparation des mains et un
// niveau estimé. Le site est parcouru poliment, une requête par seconde au plus, et tout
// est gardé en cache dans .cache : relancer le script ne retélécharge rien.
//
//   node scripts/build-catalog.mjs             (complète le cache si besoin)
//   node scripts/build-catalog.mjs --offline   (seulement ce qui est déjà en cache)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = `${ROOT}.cache/mutopia/`;
const OUTPUT = `${ROOT}public/catalog/mutopia.json`;
const BASE = 'https://www.mutopiaproject.org/';
const LISTING = `${BASE}cgibin/make-table.cgi?Instrument=Piano&solo=1&startat=`;
const USER_AGENT = 'piano-practice-app/0.1 (catalogue personnel, 1 requete par seconde)';
const DELAY_MS = 1000;
const OFFLINE = process.argv.includes('--offline');

// Instruments acceptés à côté du piano : d'autres claviers, pour des pièces « piano ou clavecin ».
const KEYBOARDS = /^(piano|pianoforte|harpsichord|clavecin|clavichord|organ|orgue|harmonium|keyboard)$/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function politeFetch(url, binary) {
  await sleep(DELAY_MS);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} pour ${url}`);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.text();
}

async function cached(name, url, binary) {
  const path = `${CACHE}${name}`;
  if (existsSync(path)) return readFile(path, binary ? undefined : 'utf8');
  if (OFFLINE) return null;
  const data = await politeFetch(url, binary);
  await writeFile(path, data);
  return data;
}

function decode(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Une page de liste → les pièces qu'elle décrit. */
function parseListing(html) {
  return html
    .split('result-table')
    .slice(1)
    .map((block) => {
      const cells = [...block.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      const composerCell = cells.find((c) => c.startsWith('by ')) ?? '';
      const composer = decode(composerCell.slice(3));
      const instruments = decode(cells.find((c) => c.startsWith('for ')) ?? '').slice(4);
      const id = /piece-info\.cgi\?id=(\d+)/.exec(block)?.[1];
      const mid = /href="https:\/\/www\.mutopiaproject\.org\/(ftp\/[^"]+\.mid)"/.exec(block)?.[1];
      const pdf = /href="https:\/\/www\.mutopiaproject\.org\/(ftp\/[^"]+-a4\.pdf)"/.exec(block)?.[1];
      const license = decode(/legal\.html#[^"]*">([^<]*)</.exec(block)?.[1] ?? '');
      const forIndex = cells.findIndex((c) => c.startsWith('for '));
      return {
        id: Number(id),
        title: decode(cells[0] ?? ''),
        composer: composer.replace(/\s*\([^)]*\)\s*$/, ''),
        years: /\(([^)]*)\)\s*$/.exec(composer)?.[1] ?? '',
        opus: decode(cells[2] ?? ''),
        instruments,
        style: forIndex >= 0 ? decode(cells[forIndex + 2] ?? '') : '',
        license,
        mid,
        pdf,
      };
    });
}

function isSoloPiano(piece) {
  const parts = piece.instruments.split(/\s*(?:,|\bor\b|\bou\b|\band\b|&)\s*/i).filter(Boolean);
  return parts.some((p) => /^piano/i.test(p)) && parts.every((p) => KEYBOARDS.test(p));
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(`${ROOT}public/catalog`, { recursive: true });

  // 1. Parcourir la liste, dix pièces par page.
  const pieces = [];
  for (let start = 0; ; start += 10) {
    const html = await cached(`list-${start}.html`, `${LISTING}${start}`, false);
    if (html === null) break;
    const page = parseListing(html);
    pieces.push(...page);
    process.stdout.write(`\rliste : ${pieces.length} pièces`);
    if (page.length < 10 || !html.includes(`startat=${start + 10}&`)) break;
  }
  console.log();

  const solo = pieces.filter((p) => p.id && isSoloPiano(p));
  const withMidi = solo.filter((p) => p.mid);
  console.log(`piano seul : ${solo.length}, avec un fichier MIDI unique : ${withMidi.length}`);

  // 2. Télécharger et analyser chaque fichier MIDI avec le code de l'app.
  const { Midi } = createRequire(import.meta.url)('@tonejs/midi');
  const { module: convert } = await runnerImport(`${ROOT}src/song/midi-convert.ts`, { root: ROOT, configFile: false });
  const { module: difficulty } = await runnerImport(`${ROOT}src/song/difficulty.ts`, { root: ROOT, configFile: false });

  const catalog = [];
  for (const [i, piece] of withMidi.entries()) {
    process.stdout.write(`\rMIDI : ${i + 1} / ${withMidi.length}`);
    try {
      const data = await cached(`${piece.id}.mid`, `${BASE}${piece.mid}`, true);
      if (data === null) continue;
      const song = convert.songFromParsedMidi(new Midi(data), piece.title);
      if (song.notes.length === 0) continue;
      const level = difficulty.estimateDifficulty(song).level;
      catalog.push({
        id: piece.id,
        title: piece.title,
        composer: piece.composer,
        years: piece.years,
        opus: piece.opus,
        style: piece.style,
        license: piece.license,
        mid: piece.mid,
        pdf: piece.pdf,
        hands: song.hands,
        level,
        bars: song.bars.length,
        duration: Math.round(song.duration),
      });
    } catch (error) {
      console.log(`\n  ignorée : ${piece.title} (${error.message})`);
    }
  }
  console.log();

  catalog.sort((a, b) => a.composer.localeCompare(b.composer, 'fr') || a.title.localeCompare(b.title, 'fr'));
  const output = {
    source: 'Mutopia Project',
    url: BASE,
    generated: new Date().toISOString().slice(0, 10),
    pieces: catalog,
  };
  await writeFile(OUTPUT, JSON.stringify(output));

  const count = (f) => catalog.filter(f).length;
  console.log(`catalogue : ${catalog.length} pièces → ${OUTPUT}`);
  console.log(`  mains séparées : ${count((p) => p.hands === 'separate')}, estimées : ${count((p) => p.hands === 'estimated')}`);
  console.log(`  niveaux : ${[1, 2, 3, 4, 5].map((l) => `${l}=${count((p) => p.level === l)}`).join(' ')}`);
}

await main();
