import { Capacitor } from '@capacitor/core';
import type { HandsMethod } from '../song/types';
import type { Level } from '../song/difficulty';

export type CatalogSource = 'mutopia' | 'pdmx';

/** Un morceau du catalogue de recherche, quelle que soit sa source. */
export interface CatalogPiece {
  /** Identifiant unique, repris comme identifiant dans « Mes morceaux ». */
  key: string;
  source: CatalogSource;
  title: string;
  composer: string;
  /** Opus, style ou genre : ce qui aide à reconnaître la pièce. */
  detail: string;
  /** Adresse du fichier MIDI, servie par le serveur de l'app. */
  file: string;
  /** Page de la pièce sur le site d'origine. */
  page: string;
  /** Partition PDF, quand la source en propose une. */
  pdf?: string;
  /** Partition MusicXML (.mxl) servie par l'app, pour l'afficher et en lire les doigtés. */
  score?: string;
  /** Part des notes qui portent un doigté écrit dans la partition (0 à 1). */
  fingering: number;
  license: string;
  hands: HandsMethod;
  level: Level;
  duration: number;
  /** Difficulté choisie par l'auteur sur MuseScore : 0 non précisée, 1 débutant, 2 intermédiaire, 3 avancé. */
  authorLevel: number;
  views: number;
  rating: number;
  ratings: number;
}

export interface SearchFilters {
  level: string;
  separateOnly: boolean;
  source: 'all' | CatalogSource;
  beginnerByAuthor: boolean;
  withFingerings: boolean;
}

interface MutopiaEntry {
  id: number;
  title: string;
  composer: string;
  opus: string;
  style: string;
  license: string;
  mid: string;
  pdf?: string;
  hands: HandsMethod;
  level: Level;
  duration: number;
}

interface PdmxEntry {
  id: number;
  title: string;
  /** Nom de l'œuvre, quand il diffère du titre donné par l'auteur. */
  work?: string;
  composer: string;
  genre: string;
  license: string;
  file: string;
  hands: HandsMethod;
  level: Level;
  duration: number;
  authorLevel: number;
  views: number;
  rating: number;
  ratings: number;
  score?: string;
  fingering?: number;
}

export interface SearchHost {
  /** Vrai si le morceau est déjà dans la liste de l'utilisateur. */
  isAdded(key: string): boolean;
  add(piece: CatalogPiece): Promise<void>;
  open(key: string): void;
}

export const MUTOPIA_BASE = 'https://www.mutopiaproject.org/';
const MAX_RESULTS = 150;
/** Part de notes doigtées à partir de laquelle une pièce compte comme « avec doigtés ». */
const FINGERING_FILTER = 0.2;

const LEVEL_FILTERS: Record<string, (level: Level) => boolean> = {
  all: () => true,
  '1': (l) => l === 1,
  '1-2': (l) => l <= 2,
  '1-3': (l) => l <= 3,
  '4-5': (l) => l >= 4,
};

const LICENSES: Record<string, string> = {
  publicdomain: 'Domaine public',
  'cc-zero': 'CC0 (domaine public)',
};

export function fromMutopia(p: MutopiaEntry): CatalogPiece {
  return {
    key: `mutopia:${p.id}`,
    source: 'mutopia',
    title: p.title,
    composer: p.composer,
    detail: [p.opus, p.style].filter(Boolean).join(' · '),
    // Le serveur de dev relaie Mutopia (CORS) ; l'app iPhone y va directement, par le réseau natif.
    file: Capacitor.isNativePlatform() ? `${MUTOPIA_BASE}${p.mid}` : `/mutopia/${p.mid}`,
    page: `${MUTOPIA_BASE}cgibin/piece-info.cgi?id=${p.id}`,
    pdf: p.pdf ? `${MUTOPIA_BASE}${p.pdf}` : undefined,
    fingering: 0,
    license: p.license,
    hands: p.hands,
    level: p.level,
    duration: p.duration,
    authorLevel: 0,
    views: 0,
    rating: 0,
    ratings: 0,
  };
}

export function fromPdmx(p: PdmxEntry): CatalogPiece {
  return {
    key: `pdmx:${p.id}`,
    source: 'pdmx',
    title: p.title,
    composer: p.composer,
    detail: [p.work && normalize(p.work) !== normalize(p.title) ? p.work : '', p.genre].filter(Boolean).join(' · '),
    file: `/pdmx/${p.file}`,
    page: `https://musescore.com/score/${p.id}`,
    score: p.score ? `/pdmx/${p.score}` : undefined,
    fingering: p.fingering ?? 0,
    license: LICENSES[p.license] ?? p.license,
    hands: p.hands,
    level: p.level,
    duration: p.duration,
    authorLevel: p.authorLevel,
    views: p.views,
    rating: p.rating,
    ratings: p.ratings,
  };
}

/** Minuscules sans accents, pour chercher « chopin » comme « Chopin » et « etude » comme « Étude ». */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Les titres sont surtout en anglais ou en allemand : on traduit les mots français courants.
const SYNONYMS: Record<string, string[]> = {
  symphonie: ['symphony', 'sinfonie'],
  sonate: ['sonata'],
  sonatine: ['sonatina'],
  valse: ['waltz', 'walzer'],
  menuet: ['minuet', 'menuett', 'minuetto'],
  marche: ['march', 'marsch'],
  berceuse: ['lullaby', 'wiegenlied'],
  etude: ['study', 'etude', 'etuede'],
  prelude: ['praeludium', 'preludio'],
  fugue: ['fuga'],
  lettre: ['fur', 'fuer'],
  hymne: ['ode', 'hymn'],
  joie: ['joy', 'freude'],
  lac: ['lake'],
  cygnes: ['swan', 'swans'],
  noel: ['christmas', 'xmas', 'carol'],
  chanson: ['song'],
  mouvement: ['movement', 'mvt'],
  facile: ['easy', 'beginner'],
  debutant: ['easy', 'beginner'],
  premier: ['1st', 'first'],
  premiere: ['1st', 'first'],
  deuxieme: ['2nd', 'second'],
  troisieme: ['3rd', 'third'],
  quatrieme: ['4th', 'fourth'],
  cinquieme: ['5th', 'fifth'],
  sixieme: ['6th', 'sixth'],
  septieme: ['7th', 'seventh'],
  neuvieme: ['9th', 'ninth'],
};
const STOP_WORDS = new Set(['a', 'au', 'aux', 'de', 'des', 'du', 'd', 'l', 'la', 'le', 'les', 'en', 'et', 'pour', 'the', 'of', 'no', 'n', 'op']);

/** Un mot de la recherche, avec ses équivalents. Un nombre (« 5 », « 5e ») ne doit pas trouver « 15 » ou « 1805 ». */
function wordMatcher(word: string): (haystack: string, tokens: string[]) => boolean {
  const numeric = /^(\d+)(?:e|er|ere|eme)?$/.exec(word);
  if (numeric) {
    const number = new RegExp(`^${numeric[1]}(?:st|nd|rd|th|e|er|eme)?$`);
    return (_, tokens) => tokens.some((t) => number.test(t));
  }
  const alternatives = [word, ...(SYNONYMS[word] ?? [])];
  return (haystack) => alternatives.some((a) => haystack.includes(a));
}

interface Indexed {
  piece: CatalogPiece;
  haystack: string;
  tokens: string[];
}

export function indexCatalog(pieces: CatalogPiece[]): Indexed[] {
  return pieces.map((piece) => {
    const haystack = normalize(`${piece.title} ${piece.composer} ${piece.detail}`);
    return { piece, haystack, tokens: haystack.split(/[^a-z0-9]+/).filter(Boolean) };
  });
}

export function searchCatalog(index: Indexed[], query: string, filters: SearchFilters): CatalogPiece[] {
  const words = normalize(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w));
  const matchers = words.map(wordMatcher);
  const levelOk = LEVEL_FILTERS[filters.level] ?? LEVEL_FILTERS.all;
  return index
    .filter(({ piece: p }) =>
      levelOk(p.level) &&
      (!filters.separateOnly || p.hands === 'separate') &&
      (filters.source === 'all' || p.source === filters.source) &&
      (!filters.beginnerByAuthor || p.authorLevel === 1) &&
      (!filters.withFingerings || p.fingering >= FINGERING_FILTER),
    )
    .filter(({ haystack, tokens }) => matchers.every((m) => m(haystack, tokens)))
    .map(({ piece }) => piece)
    .sort((a, b) => a.level - b.level || b.views - a.views || a.title.localeCompare(b.title, 'fr'));
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return minutes ? `${minutes} min ${rest}` : `${seconds} s`;
}

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function levelBadge(level: Level): string {
  return `<span class="badge level l${level}" title="Difficulté estimée d'après les notes">Niveau ${level}/5</span>`;
}

export function handsBadge(hands: HandsMethod): string {
  return hands === 'separate'
    ? '<span class="badge hands ok" title="Chaque main a sa piste dans le fichier">2 mains séparées</span>'
    : '<span class="badge hands warn" title="Une seule piste : l\'app devine quelle main joue quoi">Mains estimées</span>';
}

const AUTHOR_LEVELS = ['', 'Débutant', 'Intermédiaire', 'Avancé'];

function pieceBadges(p: CatalogPiece): string {
  const badges = [levelBadge(p.level), handsBadge(p.hands)];
  if (p.fingering >= 0.5) {
    badges.push('<span class="badge fingers" title="Doigtés écrits sur la plupart des notes">Doigtés</span>');
  } else if (p.fingering >= 0.05) {
    badges.push(`<span class="badge fingers partial" title="Doigtés écrits sur ${Math.round(p.fingering * 100)} % des notes">Quelques doigtés</span>`);
  }
  if (p.authorLevel > 0) {
    badges.push(`<span class="badge author" title="Difficulté indiquée par l'auteur de l'arrangement">${AUTHOR_LEVELS[p.authorLevel]} selon l'auteur</span>`);
  }
  const popularity = [
    p.ratings > 0 ? `★ ${p.rating.toFixed(1).replace('.', ',')} (${p.ratings})` : '',
    p.views > 0 ? `${p.views.toLocaleString('fr-FR')} vues` : '',
  ].filter(Boolean);
  if (popularity.length) badges.push(`<span class="badge muted">${popularity.join(' · ')}</span>`);
  badges.push(`<span class="badge muted">${p.source === 'pdmx' ? 'MuseScore' : 'Mutopia'}</span>`);
  return badges.join('');
}

/** La fenêtre « Chercher un morceau ». */
export class SearchPanel {
  private index: Indexed[] | null = null;
  private dialog = document.getElementById('search-dialog') as HTMLDialogElement;
  private input = document.getElementById('search-input') as HTMLInputElement;
  private level = document.getElementById('search-level') as HTMLSelectElement;
  private source = document.getElementById('search-source') as HTMLSelectElement;
  private separate = document.getElementById('search-separate') as HTMLInputElement;
  private beginner = document.getElementById('search-beginner') as HTMLInputElement;
  private fingers = document.getElementById('search-fingers') as HTMLInputElement;
  private count = document.getElementById('search-count')!;
  private list = document.getElementById('search-results')!;
  private busy = new Set<string>();
  private shown: CatalogPiece[] = [];

  constructor(private host: SearchHost) {
    this.input.addEventListener('input', () => this.render());
    // « Rechercher » sur le clavier de l'iPhone le range, pour voir les résultats.
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.input.blur();
      }
    });
    for (const control of [this.level, this.source, this.separate, this.beginner, this.fingers]) {
      control.addEventListener('change', () => this.render());
    }
    this.list.addEventListener('click', (event) => void this.onClick(event));
  }

  async open(): Promise<void> {
    this.dialog.showModal();
    // Au doigt, pas de clavier qui surgit et cache la moitié de l'écran : on le demande en touchant le champ.
    if (!matchMedia('(pointer: coarse)').matches) this.input.focus();
    else this.input.blur();
    if (!this.index) {
      this.count.textContent = 'Chargement du catalogue…';
      this.index = indexCatalog(await this.loadCatalogs());
    }
    this.render();
  }

  /** Mutopia est livré avec l'app ; PDMX n'existe que si son catalogue a été construit sur cette machine. */
  private async loadCatalogs(): Promise<CatalogPiece[]> {
    const load = async <T>(url: string): Promise<T[]> => {
      try {
        const response = await fetch(url);
        if (!response.ok) return [];
        return ((await response.json()) as { pieces: T[] }).pieces;
      } catch {
        return [];
      }
    };
    const [mutopia, pdmx] = await Promise.all([
      load<MutopiaEntry>(`${import.meta.env.BASE_URL}catalog/mutopia.json`),
      load<PdmxEntry>('/pdmx/catalog.json'),
    ]);
    this.source.disabled = pdmx.length === 0;
    return [...mutopia.map(fromMutopia), ...pdmx.map(fromPdmx)];
  }

  private render(): void {
    if (!this.index) return;
    const results = searchCatalog(this.index, this.input.value, {
      level: this.level.value,
      separateOnly: this.separate.checked,
      source: this.source.value as SearchFilters['source'],
      beginnerByAuthor: this.beginner.checked,
      withFingerings: this.fingers.checked,
    });
    this.shown = results.slice(0, MAX_RESULTS);
    this.count.textContent =
      this.index.length === 0 ? 'Catalogue introuvable.'
        : results.length === 0 ? 'Aucun morceau ne correspond.'
          : results.length > MAX_RESULTS
            ? `${results.length.toLocaleString('fr-FR')} morceaux : les ${MAX_RESULTS} plus faciles sont affichés, précise ta recherche.`
            : `${results.length} morceau${results.length > 1 ? 'x' : ''}, du plus facile au plus difficile.`;
    this.list.innerHTML = this.shown.map((p) => this.row(p)).join('');
  }

  private row(p: CatalogPiece): string {
    const details = [p.composer, p.detail, formatDuration(p.duration)].filter(Boolean).map(escapeHtml).join(' · ');
    const key = escapeHtml(p.key);
    const action = this.busy.has(p.key)
      ? '<button class="btn" disabled>Téléchargement…</button>'
      : this.host.isAdded(p.key)
        ? `<button class="btn" data-open="${key}">Ouvrir</button>`
        : `<button class="btn primary" data-add="${key}">Ajouter</button>`;
    const score = p.pdf ?? (p.source === 'pdmx' ? p.page : undefined);
    const scoreLink = score
      ? `<a class="btn" href="${escapeHtml(score)}" target="_blank" rel="noopener" title="Voir la partition sur le site d'origine">Partition</a>`
      : '';
    return `<li class="result">
      <div class="result-main">
        <div class="result-title">${escapeHtml(p.title)}</div>
        <div class="muted small">${details}</div>
        <div class="badges">${pieceBadges(p)}</div>
      </div>
      <div class="result-actions">${scoreLink}${action}</div>
    </li>`;
  }

  private async onClick(event: Event): Promise<void> {
    const target = (event.target as HTMLElement).closest('button');
    if (!target) return;
    if (target.dataset.open) {
      this.host.open(target.dataset.open);
      this.dialog.close();
      return;
    }
    const piece = this.shown.find((p) => p.key === target.dataset.add);
    if (!piece) return;
    this.busy.add(piece.key);
    this.render();
    try {
      await this.host.add(piece);
      this.dialog.close();
    } finally {
      this.busy.delete(piece.key);
      this.render();
    }
  }
}
