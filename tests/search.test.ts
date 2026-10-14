import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  fromMutopia,
  fromPdmx,
  indexCatalog,
  normalize,
  searchCatalog,
  type SearchFilters,
} from '../src/ui/search';

const mutopia = (over: Partial<Parameters<typeof fromMutopia>[0]>) =>
  fromMutopia({ id: 1, title: '', composer: '', opus: '', style: '', license: 'Public Domain', mid: 'ftp/x.mid', hands: 'separate', level: 1, duration: 60, ...over });
const pdmx = (over: Partial<Parameters<typeof fromPdmx>[0]>) =>
  fromPdmx({ id: 1, title: '', composer: '', genre: '', license: 'publicdomain', file: 'mid/x.mid', hands: 'separate', level: 1, duration: 60, authorLevel: 0, views: 0, rating: 0, ratings: 0, ...over });

const index = indexCatalog([
  mutopia({ id: 1, title: 'Étude', composer: 'F. Chopin', opus: 'Op. 10', level: 5 }),
  mutopia({ id: 2, title: 'Menuet en sol', composer: 'J. S. Bach', level: 2 }),
  mutopia({ id: 3, title: 'Für Elise', composer: 'L. V. Beethoven', level: 3 }),
  pdmx({ id: 10, title: 'Symphony No. 5 Beethoven Easy Piano', level: 1, authorLevel: 1, views: 19549, fingering: 0.6 }),
  pdmx({ id: 11, title: 'Beethoven Symphony No. 5 (1st movement) Piano solo', level: 5, authorLevel: 2, views: 392070 }),
  pdmx({ id: 12, title: 'Symphony No. 15', composer: 'Shostakovich', level: 4, hands: 'estimated' }),
  pdmx({ id: 13, title: 'Ode to Joy', composer: 'Beethoven', level: 1, views: 50 }),
]);
const all: SearchFilters = { level: 'all', separateOnly: false, source: 'all', beginnerByAuthor: false, withFingerings: false };
const keys = (query: string, filters: Partial<SearchFilters> = {}) =>
  searchCatalog(index, query, { ...all, ...filters }).map((p) => p.key);

describe('recherche dans le catalogue', () => {
  it('ignore accents et majuscules, et exige tous les mots', () => {
    expect(normalize('Étude À')).toBe('etude a');
    expect(keys('etude chopin')).toEqual(['mutopia:1']);
    expect(keys('menuet bach')).toEqual(['mutopia:2']);
  });

  it('comprend les titres français des œuvres connues', () => {
    expect(keys('lettre à Élise')).toEqual(['mutopia:3']);
    expect(keys('hymne à la joie')).toEqual(['pdmx:13']);
    expect(keys('symphonie 5 beethoven')).toEqual(['pdmx:10', 'pdmx:11']);
    expect(keys('5e symphonie')).toEqual(['pdmx:10', 'pdmx:11']);
  });

  it('ne confond pas 5 avec 15', () => {
    expect(keys('symphony 15')).toEqual(['pdmx:12']);
  });

  it('trie du plus facile au plus difficile, puis du plus vu au moins vu', () => {
    expect(keys('beethoven')).toEqual(['pdmx:10', 'pdmx:13', 'mutopia:3', 'pdmx:11']);
  });

  it('filtre par niveau, source, avis de l\'auteur et séparation des mains', () => {
    expect(keys('', { level: '1-2' })).toEqual(['pdmx:10', 'pdmx:13', 'mutopia:2']);
    expect(keys('', { source: 'mutopia' })).toEqual(['mutopia:2', 'mutopia:3', 'mutopia:1']);
    expect(keys('', { beginnerByAuthor: true })).toEqual(['pdmx:10']);
    expect(keys('symphony', { separateOnly: true })).toEqual(['pdmx:10', 'pdmx:11']);
    expect(keys('', { withFingerings: true })).toEqual(['pdmx:10']);
  });

  it('affiche les durées lisiblement', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(125)).toBe('2 min 05');
  });
});
