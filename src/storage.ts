import type { Mode } from './engine/player';
import type { Hand } from './song/types';

// Réglages et morceaux importés restent sur l'appareil. Si le navigateur refuse le stockage
// (navigation privée, par exemple), l'app marche quand même, sans mémoire.

export type FingerDisplay = 'all' | 'written' | 'none';

export interface Settings {
  songId: string;
  mode: Mode;
  hands: Hand[];
  speed: number;
  showNoteNames: boolean;
  /** Doigtés affichés : écrits et calculés, écrits seulement, ou aucun. */
  fingers: FingerDisplay;
  /** Mains fantômes posées sur le clavier. */
  ghostHands: boolean;
  view: 'notes' | 'both' | 'score';
  sound: 'browser' | 'piano';
}

const SETTINGS_KEY = 'piano.settings';

export const DEFAULT_SETTINGS: Settings = {
  songId: 'demo:clair-de-lune',
  mode: 'listen',
  hands: ['right'],
  speed: 1,
  showNoteNames: true,
  fingers: 'all',
  ghostHands: true,
  view: 'both',
  sound: 'browser',
};

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    // Ancien réglage : une simple case « Doigtés ».
    if (saved.showFingers === false && !saved.fingers) saved.fingers = 'none';
    delete saved.showFingers;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Stockage indisponible : tant pis.
  }
}

export interface StoredSong {
  id: string;
  name: string;
  data: ArrayBuffer;
  added: number;
  /** D'où vient le morceau, pour le créditer et retrouver sa partition. */
  credit?: { source: string; license: string; page: string; pdf?: string };
  /** La partition MusicXML compressée (.mxl), quand la source en fournit une. */
  score?: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('piano', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('songs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = fn(db.transaction('songs', mode).objectStore('songs'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listSongs(): Promise<StoredSong[]> {
  try {
    const songs = await withStore('readonly', (s) => s.getAll() as IDBRequest<StoredSong[]>);
    return songs.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  } catch {
    return [];
  }
}

export async function addSong(song: StoredSong): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(song));
  } catch {
    // Le morceau reste utilisable pendant la session, il ne sera juste pas mémorisé.
  }
}

export async function deleteSong(id: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(id));
  } catch {
    // Rien à faire.
  }
}
