import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { Song } from '../song/types';
import type { ScoreNote } from './fingerings';

/**
 * La partition, dessinée par OpenSheetMusicDisplay à partir du MusicXML, avec un curseur
 * qui suit le morceau. Les reprises sont dépliées comme dans le fichier MIDI : chaque
 * position du curseur est datée sur la ligne de temps « dépliée » (enrolled) d'OSMD.
 */
export class ScoreView {
  private osmd: OpenSheetMusicDisplay | null = null;
  /** Instant (en secondes de morceau) de chaque position du curseur. */
  private times: number[] = [];
  private index = -1;
  private loading = 0;

  constructor(private container: HTMLElement, private scroller: HTMLElement) {}

  get loaded(): boolean {
    return this.osmd !== null;
  }

  clear(): void {
    this.loading++;
    this.osmd?.clear();
    this.osmd = null;
    this.times = [];
    this.index = -1;
    this.container.innerHTML = '';
  }

  /**
   * Dessine la partition (.mxl compressé, ou MusicXML en texte) et renvoie ses notes, pour en
   * tirer les doigtés. Null si elle est illisible.
   */
  async load(score: ArrayBuffer | string, song: Song): Promise<ScoreNote[] | null> {
    this.clear();
    const ticket = this.loading;
    // OSMD pèse lourd : il n'est chargé qu'à la première partition affichée.
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
    if (ticket !== this.loading) return null;
    const osmd = new OpenSheetMusicDisplay(this.container, {
      autoResize: true,
      backend: 'svg',
      // Titre et compositeur sont déjà affichés par l'app : la place va à la musique.
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      // Les paroles (plusieurs couplets parfois) prennent la place des portées.
      drawLyrics: false,
      drawCredits: false,
      drawPartNames: false,
      drawFingerings: true,
      followCursor: false,
      // Nos partitions de démo n'écrivent pas les ligatures : OSMD les ajoute. Les vraies partitions ont les leurs.
      autoBeam: typeof score === 'string',
      cursorsOptions: [{ type: 0, color: '#4c9bff', alpha: 0.35, follow: false }],
    });
    try {
      await osmd.load(typeof score === 'string' ? score : new Blob([score]));
      if (ticket !== this.loading) return null;
      osmd.Zoom = 0.8;
      osmd.render();
    } catch {
      return null;
    }
    this.osmd = osmd;

    const toSeconds = song.quarterToSeconds ?? ((q: number) => q * 0.5);
    const notes: ScoreNote[] = [];
    const cursor = osmd.cursor;
    cursor.show();
    cursor.reset();
    const iterator = cursor.iterator;
    while (!iterator.EndReached) {
      const quarters = iterator.CurrentEnrolledTimestamp.RealValue * 4;
      this.times.push(toSeconds(quarters));
      for (const entry of iterator.CurrentVoiceEntries) {
        for (const note of entry.Notes) {
          // Une note liée à la précédente ne se rejoue pas : elle n'existe pas dans le MIDI.
          if (note.isRest() || !note.Pitch || (note.NoteTie && note.NoteTie.StartNote !== note)) continue;
          const finger = Number(note.Fingering?.value);
          notes.push({ quarters, pitch: note.halfTone, finger: finger >= 1 && finger <= 5 ? finger : undefined });
        }
      }
      iterator.moveToNext();
    }
    cursor.reset();
    this.index = 0;
    return notes;
  }

  /** Place le curseur sur la position jouée à l'instant `time`, et fait défiler si besoin. */
  update(time: number): void {
    const cursor = this.osmd?.cursor;
    if (!cursor || this.times.length === 0) return;
    let target = 0;
    let lo = 0;
    let hi = this.times.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] <= time + 0.02) {
        target = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (target === this.index) return;
    if (target < this.index) {
      cursor.reset();
      this.index = 0;
    }
    for (; this.index < target; this.index++) cursor.iterator.moveToNext();
    cursor.update();
    this.scrollToCursor();
  }

  private scrollToCursor(): void {
    const element = this.osmd?.cursor.cursorElement;
    if (!element) return;
    const top = element.offsetTop;
    const view = this.scroller;
    const visibleTop = view.scrollTop + view.clientHeight * 0.1;
    const visibleBottom = view.scrollTop + view.clientHeight * 0.8;
    if (top < visibleTop || top + element.offsetHeight > visibleBottom) {
      view.scrollTo({ top: Math.max(0, top - view.clientHeight * 0.15), behavior: 'smooth' });
    }
  }
}
