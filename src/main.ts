import { Sampler } from './audio/sampler';
import { Player, type Judgement, type Mode, type Scheduler, type Stats } from './engine/player';
import { autoFingerSong } from './score/auto-fingering';
import { applyFingerings } from './score/fingerings';
import { ScoreView } from './score/score-view';
import { listenComputerKeyboard } from './input/computer-keyboard';
import { MidiInput, MidiOutScheduler, type MidiState } from './input/midi';
import { DEMOS } from './song/demos';
import { estimateDifficulty } from './song/difficulty';
import { songFromMidi } from './song/midi-loader';
import { barIndexAt, barStart, type Hand, type Song } from './song/types';
import { addSong, deleteSong, listSongs, loadSettings, saveSettings, type StoredSong } from './storage';
import { Renderer } from './ui/renderer';
import { SearchPanel, escapeHtml, handsBadge, levelBadge, type CatalogPiece } from './ui/search';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  songSelect: $<HTMLSelectElement>('song-select'),
  searchBtn: $('search-btn'),
  importBtn: $('import-btn'),
  deleteBtn: $('delete-btn'),
  fileInput: $<HTMLInputElement>('file-input'),
  modeBtns: [...document.querySelectorAll<HTMLButtonElement>('[data-mode]')],
  handBtns: [...document.querySelectorAll<HTMLButtonElement>('[data-hand]')],
  restartBtn: $('restart-btn'),
  playBtn: $('play-btn'),
  barLabel: $('bar-label'),
  speedRange: $<HTMLInputElement>('speed-range'),
  speedLabel: $('speed-label'),
  slowerBtn: $('slower-btn'),
  fasterBtn: $('faster-btn'),
  loopCheck: $<HTMLInputElement>('loop-check'),
  loopFrom: $<HTMLInputElement>('loop-from'),
  loopTo: $<HTMLInputElement>('loop-to'),
  namesCheck: $<HTMLInputElement>('names-check'),
  fingersSelect: $<HTMLSelectElement>('fingers-select'),
  handsCheck: $<HTMLInputElement>('hands-check'),
  viewSelect: $<HTMLSelectElement>('view-select'),
  stage: $('stage'),
  scorePanel: $('score-panel'),
  scoreMessage: $('score-message'),
  score: $('score'),
  soundSelect: $<HTMLSelectElement>('sound-select'),
  midiStatus: $('midi-status'),
  midiHelp: $<HTMLDialogElement>('midi-help'),
  midiHelpBody: $('midi-help-body'),
  timeline: $('timeline'),
  timelineProgress: $('timeline-progress'),
  timelineLoop: $('timeline-loop'),
  canvas: $<HTMLCanvasElement>('canvas'),
  songTitle: $('song-title'),
  songInfo: $('song-info'),
  stats: $('stats'),
  hint: $('hint'),
  toast: $('toast'),
};

// --- Son, piano et moteur ----------------------------------------------------------

const settings = loadSettings();
const sampler = new Sampler();
const midi = new MidiInput({
  noteOn: (pitch, velocity) => userNoteOn(pitch, velocity, 'midi'),
  noteOff: (pitch) => userNoteOff(pitch, 'midi'),
  stateChange: renderMidiState,
});

const midiOut = new MidiOutScheduler(() => midi.firstOutput());
const scheduler: Scheduler = {
  schedule(note, delay, duration) {
    const usePiano = settings.sound === 'piano' && midi.firstOutput();
    (usePiano ? midiOut : sampler).schedule(note, delay, duration);
  },
  cancelAll() {
    sampler.cancelAll();
    midiOut.cancelAll();
  },
};

const player = new Player(DEMOS[0].load(), scheduler);
player.setMode(settings.mode);
player.setUserHands(settings.hands);
player.setSpeed(settings.speed);
player.onPassEnd = showPassResult;

const renderer = new Renderer(ui.canvas);
/** Touches enfoncées, avec le jugement de leur frappe, pour les colorer. */
const pressed = new Map<number, Judgement>();
/** Notes jouées à l'écran ou au clavier d'ordinateur : c'est l'app qui les fait sonner. */
const localNotes = new Map<number, () => void>();

type Source = 'midi' | 'local';

function userNoteOn(pitch: number, velocity: number, source: Source): void {
  if (source === 'local') {
    sampler.start();
    localNotes.get(pitch)?.();
    localNotes.set(pitch, sampler.play(pitch, velocity));
  }
  // Mains sur le piano : une note suffit pour lancer l'exercice.
  if (source === 'midi' && !player.playing && player.mode !== 'listen') {
    player.play();
    pressed.set(pitch, 'free');
    return;
  }
  pressed.set(pitch, player.noteOn(pitch));
}

function userNoteOff(pitch: number, source: Source): void {
  pressed.delete(pitch);
  if (source === 'local') {
    localNotes.get(pitch)?.();
    localNotes.delete(pitch);
  }
}

listenComputerKeyboard({
  noteOn: (pitch) => userNoteOn(pitch, 0.7, 'local'),
  noteOff: (pitch) => userNoteOff(pitch, 'local'),
  togglePlay,
});

// Un bouton cliqué à la souris ou au doigt rend le focus, pour qu'Espace lance toujours la lecture.
document.addEventListener('click', (event) => {
  if (event.detail > 0 && event.target instanceof HTMLButtonElement) event.target.blur();
});
document.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && target.type === 'checkbox')) {
    target.blur();
  }
});

// Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur.
window.addEventListener('pointerdown', () => sampler.start(), { capture: true });
window.addEventListener('keydown', () => sampler.start(), { capture: true });

// --- Morceaux ---------------------------------------------------------------------

let importedSongs: StoredSong[] = [];

async function refreshSongList(): Promise<void> {
  importedSongs = await listSongs();
  ui.songSelect.innerHTML = '';
  const demos = document.createElement('optgroup');
  demos.label = 'Démos';
  for (const demo of DEMOS) demos.append(new Option(demo.title, demo.id));
  ui.songSelect.append(demos);
  if (importedSongs.length) {
    const mine = document.createElement('optgroup');
    mine.label = 'Mes morceaux';
    for (const song of importedSongs) mine.append(new Option(song.name, song.id));
    ui.songSelect.append(mine);
  }
  ui.songSelect.value = settings.songId;
}

function loadSongById(id: string): boolean {
  const demo = DEMOS.find((d) => d.id === id);
  if (demo) {
    setSong(demo.load(), id);
    return true;
  }
  const stored = importedSongs.find((s) => s.id === id);
  if (!stored) return false;
  try {
    setSong(songFromMidi(stored.data, stored.name), id);
    return true;
  } catch {
    return false;
  }
}

function setSong(song: Song, id: string): void {
  player.setSong(song);
  renderer.fitSong(song);
  settings.songId = id;
  saveSettings(settings);
  ui.songSelect.value = id;
  ui.deleteBtn.hidden = id.startsWith('demo:');
  ui.songTitle.textContent = song.title;
  // Des doigtés tout de suite (calculés) ; ceux de la partition les remplacent dès qu'elle est lue.
  autoFingerSong(song);
  renderSongInfo(song, id);
  void loadScore(song, id);
  ui.loopCheck.checked = false;
  ui.loopFrom.max = ui.loopTo.max = String(song.bars.length);
  ui.loopFrom.value = '1';
  ui.loopTo.value = String(Math.min(4, song.bars.length));
  renderControls();
}

const link = (href: string, text: string) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${text}</a>`;

function renderSongInfo(song: Song, id: string): void {
  const { level } = estimateDifficulty(song);
  const credit = importedSongs.find((s) => s.id === id)?.credit;
  const written = song.notes.filter((n) => n.finger && !n.fingerAuto).length;
  const computed = song.notes.filter((n) => n.fingerAuto).length;
  const fingersBadge =
    (written > 0
      ? `<span class="badge fingers" title="${written} doigtés écrits dans la partition par son auteur">Doigtés écrits</span>`
      : '') +
    (computed > 0
      ? `<span class="badge fingers auto" title="${computed} doigtés calculés automatiquement par l'app : une suggestion, pas l'avis d'un professeur. Sur des pièces doigtées par leur auteur, ce calcul retrouve environ 56 % de leurs doigtés.">Doigtés calculés (auto)</span>`
      : '');
  ui.songInfo.innerHTML =
    `${song.bars.length} mesures ${levelBadge(level)}${handsBadge(song.hands)}${fingersBadge}` +
    (credit
      ? `<br>${link(credit.page, escapeHtml(credit.source))} · ${escapeHtml(credit.license)}` +
        (credit.pdf ? ` · ${link(credit.pdf, 'partition PDF')}` : '')
      : '');
}

// --- Partition -----------------------------------------------------------------------

const scoreView = new ScoreView(ui.score, ui.scorePanel);

/** Dessine la partition du morceau s'il en a une, et recopie ses doigtés sur les notes. */
async function loadScore(song: Song, id: string): Promise<void> {
  const stored = importedSongs.find((s) => s.id === id);
  const score = stored?.score ?? DEMOS.find((d) => d.id === id)?.score();
  scoreView.clear();
  ui.scorePanel.scrollTop = 0;
  if (!score) {
    ui.scoreMessage.hidden = false;
    ui.scoreMessage.innerHTML = id.startsWith('pdmx:')
      ? "La partition n'a pas été enregistrée avec ce morceau : retire-le, puis ajoute-le de nouveau depuis la recherche."
      : `Pas de partition dans l'app pour ce morceau : seuls les démos et les morceaux MuseScore ajoutés depuis la recherche en ont une.` +
        (stored?.credit?.pdf ? ` ${link(stored.credit.pdf, 'Ouvrir sa partition PDF')} dans un autre onglet.` : '');
    return;
  }
  ui.scoreMessage.hidden = false;
  ui.scoreMessage.textContent = 'Chargement de la partition…';
  const notes = await scoreView.load(score, song);
  if (player.song !== song) return; // Un autre morceau a été choisi entre-temps.
  if (!notes) {
    ui.scoreMessage.textContent = 'Cette partition est illisible.';
    return;
  }
  ui.scoreMessage.hidden = true;
  applyFingerings(song, notes);
  autoFingerSong(song);
  renderSongInfo(song, id);
}

function applyView(): void {
  ui.stage.className = `stage view-${settings.view}`;
}

/** Vérifie et mémorise un fichier MIDI. Renvoie le morceau prêt à jouer, ou null avec un message. */
async function storeMidi(
  id: string,
  name: string,
  data: ArrayBuffer,
  credit?: StoredSong['credit'],
  score?: ArrayBuffer,
): Promise<{ song: Song; id: string } | null> {
  let song: Song;
  try {
    song = songFromMidi(data, name);
  } catch {
    showToast(`« ${name} » n'est pas un fichier MIDI lisible.`);
    return null;
  }
  if (song.notes.length === 0) {
    showToast(`« ${name} » ne contient aucune note.`);
    return null;
  }
  const stored: StoredSong = { id, name, data, added: Date.now(), credit, score };
  importedSongs.push(stored);
  await addSong(stored);
  return { song, id };
}

async function importFiles(files: File[]): Promise<void> {
  let last: { song: Song; id: string } | null = null;
  let count = 0;
  for (const file of files) {
    const id = `file:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const result = await storeMidi(id, file.name.replace(/\.(mid|midi)$/i, ''), await file.arrayBuffer());
    if (result) {
      last = result;
      count++;
    }
  }
  await refreshSongList();
  if (last) setSong(last.song, last.id);
  if (count > 1) showToast(`${count} morceaux ajoutés à « Mes morceaux ».`);
}

const search = new SearchPanel({
  isAdded: (key) => importedSongs.some((s) => s.id === key),
  async add(piece: CatalogPiece) {
    let data: ArrayBuffer;
    try {
      const response = await fetch(piece.file);
      if (!response.ok) throw new Error(String(response.status));
      data = await response.arrayBuffer();
    } catch {
      showToast("Téléchargement impossible : l'app doit tourner avec « npm run dev » (et Mutopia demande internet).");
      return;
    }
    // La partition est un plus : si elle manque, le morceau reste jouable.
    let score: ArrayBuffer | undefined;
    if (piece.score) {
      score = await fetch(piece.score)
        .then((r) => (r.ok ? r.arrayBuffer() : undefined))
        .catch(() => undefined);
    }
    const name = piece.composer ? `${piece.title} (${piece.composer})` : piece.title;
    const credit = {
      source: piece.source === 'pdmx' ? 'MuseScore (via PDMX)' : 'Mutopia Project',
      license: piece.license,
      page: piece.page,
      pdf: piece.pdf,
    };
    const result = await storeMidi(piece.key, name, data, credit, score);
    await refreshSongList();
    if (result) setSong(result.song, result.id);
  },
  open: (id) => loadSongById(id),
});

ui.songSelect.addEventListener('change', () => loadSongById(ui.songSelect.value));
ui.searchBtn.addEventListener('click', () => void search.open());
ui.importBtn.addEventListener('click', () => ui.fileInput.click());
ui.fileInput.addEventListener('change', () => {
  const files = [...(ui.fileInput.files ?? [])];
  if (files.length) void importFiles(files);
  ui.fileInput.value = '';
});
ui.deleteBtn.addEventListener('click', async () => {
  const stored = importedSongs.find((s) => s.id === settings.songId);
  if (!stored || !confirm(`Retirer « ${stored.name} » de la liste ?`)) return;
  await deleteSong(stored.id);
  settings.songId = DEMOS[0].id;
  await refreshSongList();
  loadSongById(DEMOS[0].id);
});

// Glisser-déposer un fichier n'importe où dans la page.
window.addEventListener('dragover', (event) => {
  event.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  document.body.classList.remove('dragging');
  const files = [...(event.dataTransfer?.files ?? [])].filter((f) => /\.(mid|midi)$/i.test(f.name));
  if (files.length) void importFiles(files);
});

// --- Commandes ---------------------------------------------------------------------

function togglePlay(): void {
  if (player.playing) player.pause();
  else {
    sampler.start();
    player.play();
  }
}

function setSpeed(speed: number): void {
  const clamped = Math.round(Math.min(1.5, Math.max(0.2, speed)) * 20) / 20;
  player.setSpeed(clamped);
  settings.speed = clamped;
  saveSettings(settings);
  renderControls();
}

function applyLoop(): void {
  const count = player.song.bars.length;
  let from = Math.min(count, Math.max(1, Math.round(Number(ui.loopFrom.value) || 1)));
  let to = Math.min(count, Math.max(1, Math.round(Number(ui.loopTo.value) || from)));
  if (to < from) [from, to] = [to, from];
  ui.loopFrom.value = String(from);
  ui.loopTo.value = String(to);
  player.setLoop(
    ui.loopCheck.checked ? { start: barStart(player.song, from - 1), end: barStart(player.song, to) } : null,
  );
}

for (const btn of ui.modeBtns) {
  btn.addEventListener('click', () => {
    settings.mode = btn.dataset.mode as Mode;
    player.setMode(settings.mode);
    saveSettings(settings);
    renderControls();
  });
}

for (const btn of ui.handBtns) {
  btn.addEventListener('click', () => {
    const hand = btn.dataset.hand as Hand;
    const hands = new Set(settings.hands);
    if (hands.has(hand)) hands.delete(hand);
    else hands.add(hand);
    if (hands.size === 0) return; // Il faut jouer au moins une main.
    settings.hands = [...hands];
    player.setUserHands(hands);
    saveSettings(settings);
    renderControls();
  });
}

ui.playBtn.addEventListener('click', togglePlay);
ui.restartBtn.addEventListener('click', () => player.restart());
ui.speedRange.addEventListener('input', () => setSpeed(Number(ui.speedRange.value)));
ui.slowerBtn.addEventListener('click', () => setSpeed(player.speed - 0.05));
ui.fasterBtn.addEventListener('click', () => setSpeed(player.speed + 0.05));
ui.loopCheck.addEventListener('change', applyLoop);
ui.loopFrom.addEventListener('change', applyLoop);
ui.loopTo.addEventListener('change', applyLoop);

ui.namesCheck.addEventListener('change', () => {
  settings.showNoteNames = ui.namesCheck.checked;
  saveSettings(settings);
});

ui.handsCheck.addEventListener('change', () => {
  settings.ghostHands = ui.handsCheck.checked;
  saveSettings(settings);
});

ui.fingersSelect.addEventListener('change', () => {
  settings.fingers = ui.fingersSelect.value as typeof settings.fingers;
  saveSettings(settings);
});

ui.viewSelect.addEventListener('change', () => {
  settings.view = ui.viewSelect.value as typeof settings.view;
  saveSettings(settings);
  applyView();
});

ui.soundSelect.addEventListener('change', () => {
  settings.sound = ui.soundSelect.value as 'browser' | 'piano';
  saveSettings(settings);
  scheduler.cancelAll();
  if (settings.sound === 'piano' && !midi.firstOutput()) {
    showToast("Aucun piano connecté : le son reste sur l'appareil pour l'instant.");
  }
});

// Frise : cliquer ou glisser pour repartir d'une mesure.
function seekFromTimeline(event: PointerEvent): void {
  const rect = ui.timeline.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const bar = barIndexAt(player.song, fraction * player.song.duration);
  player.startFrom(barStart(player.song, bar));
}
ui.timeline.addEventListener('pointerdown', (event) => {
  ui.timeline.setPointerCapture(event.pointerId);
  seekFromTimeline(event);
});
ui.timeline.addEventListener('pointermove', (event) => {
  if (ui.timeline.hasPointerCapture(event.pointerId)) seekFromTimeline(event);
});

// Clavier à l'écran : souris, doigt, plusieurs doigts à la fois.
const pointerNotes = new Map<number, number>();
function pointerPitch(event: PointerEvent): number | null {
  const rect = ui.canvas.getBoundingClientRect();
  return renderer.pitchAt(event.clientX - rect.left, event.clientY - rect.top);
}
ui.canvas.addEventListener('pointerdown', (event) => {
  const pitch = pointerPitch(event);
  if (pitch === null) return;
  ui.canvas.setPointerCapture(event.pointerId);
  pointerNotes.set(event.pointerId, pitch);
  userNoteOn(pitch, 0.75, 'local');
});
ui.canvas.addEventListener('pointermove', (event) => {
  const current = pointerNotes.get(event.pointerId);
  if (current === undefined) return;
  const pitch = pointerPitch(event);
  if (pitch === current) return;
  userNoteOff(current, 'local');
  if (pitch === null) pointerNotes.delete(event.pointerId);
  else {
    pointerNotes.set(event.pointerId, pitch);
    userNoteOn(pitch, 0.75, 'local');
  }
});
const releasePointer = (event: PointerEvent) => {
  const pitch = pointerNotes.get(event.pointerId);
  if (pitch === undefined) return;
  pointerNotes.delete(event.pointerId);
  userNoteOff(pitch, 'local');
};
ui.canvas.addEventListener('pointerup', releasePointer);
ui.canvas.addEventListener('pointercancel', releasePointer);

// --- Affichage ---------------------------------------------------------------------

function renderControls(): void {
  for (const btn of ui.modeBtns) btn.setAttribute('aria-pressed', String(btn.dataset.mode === player.mode));
  for (const btn of ui.handBtns) {
    btn.setAttribute('aria-pressed', String(player.userHands.has(btn.dataset.hand as Hand)));
    btn.disabled = player.mode === 'listen';
  }
  ui.speedRange.value = String(player.speed);
  ui.speedLabel.textContent = `${Math.round(player.speed * 100)} %`;
  ui.namesCheck.checked = settings.showNoteNames;
  ui.fingersSelect.value = settings.fingers;
  ui.handsCheck.checked = settings.ghostHands;
  ui.viewSelect.value = settings.view;
  ui.soundSelect.value = settings.sound;
}

function renderMidiState(state: MidiState): void {
  ui.midiStatus.className = `pill ${state.kind === 'connected' ? 'ok' : 'off'}`;
  ui.midiStatus.textContent =
    state.kind === 'connected' ? `🎹 ${state.names.join(', ')}`
      : state.kind === 'unsupported' ? 'Piano : navigateur non compatible'
        : state.kind === 'denied' ? 'Piano : accès refusé'
          : 'Piano non connecté';
}

const HELP: Record<MidiState['kind'], string> = {
  unsupported: `<p>Ce navigateur ne sait pas encore parler aux instruments MIDI. Ouvre l'app dans
    <strong>Chrome</strong> ou <strong>Edge</strong>, sur Mac, PC ou tablette Android.</p>
    <p>Sur iPad et iPhone, aucun navigateur ne le permet pour l'instant : il faudra une version app.
    Le mode Écouter et le clavier à l'écran marchent quand même.</p>`,
  denied: `<p>L'accès aux instruments MIDI a été refusé. Clique sur l'icône à gauche de l'adresse,
    autorise « Appareils MIDI », puis recharge la page.</p>`,
  waiting: '',
  connected: '',
};
const CONNECT_STEPS = `<ol>
  <li>Allume le piano. Si ton téléphone y est connecté en Bluetooth (app Roland), déconnecte-le :
    le piano n'accepte qu'une connexion à la fois.</li>
  <li><strong>Sur Mac, en Bluetooth</strong> : ouvre « Configuration audio et MIDI », menu Fenêtre ›
    Afficher le studio MIDI, clique l'icône Bluetooth, puis « Connecter » en face du piano.</li>
  <li><strong>Avec un câble USB</strong> : branche-le, le piano est reconnu tout de suite.</li>
  <li>Le nom du piano s'affiche en haut à droite. En mode Attente ou Rythme, joue une note pour démarrer.</li>
</ol>`;

ui.midiStatus.addEventListener('click', () => {
  ui.midiHelpBody.innerHTML = HELP[midi.state.kind] || CONNECT_STEPS;
  ui.midiHelp.showModal();
});

let toastTimer = 0;
function showToast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (ui.toast.hidden = true), 3500);
}

function showPassResult(stats: Stats): void {
  const perfect = stats.missed === 0 && stats.wrong === 0 && stats.hit > 0;
  const missed = player.mode === 'flow' ? `, ${stats.missed} ratée${stats.missed > 1 ? 's' : ''}` : '';
  const wrong = `${stats.wrong} fausse${stats.wrong > 1 ? 's' : ''}`;
  showToast(`${perfect ? 'Parfait ! ' : ''}${stats.hit} juste${stats.hit > 1 ? 's' : ''}${missed}, ${wrong}`);
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setHtml(el: HTMLElement, html: string): void {
  if (el.innerHTML !== html) el.innerHTML = html;
}

function renderLive(): void {
  const { song } = player;
  const fraction = (t: number) => `${Math.min(100, Math.max(0, (t / song.duration) * 100))}%`;
  ui.timelineProgress.style.width = fraction(player.time);
  ui.timelineLoop.hidden = !player.loop;
  if (player.loop) {
    ui.timelineLoop.style.left = fraction(player.loop.start);
    ui.timelineLoop.style.width = `calc(${fraction(player.loop.end)} - ${fraction(player.loop.start)})`;
  }
  setText(ui.playBtn, player.playing ? '⏸' : '▶');
  setText(ui.barLabel, `Mesure ${barIndexAt(song, Math.max(0, player.time)) + 1} / ${song.bars.length}`);

  if (player.mode === 'listen') setHtml(ui.stats, '');
  else {
    const { hit, missed, wrong } = player.stats;
    const lines = [`<span class="ok">✓ ${hit} justes</span>`];
    if (player.mode === 'flow') lines.push(`<span class="bad">✗ ${missed} ratées</span>`);
    lines.push(`<span class="muted">${wrong} fausses</span>`);
    setHtml(ui.stats, lines.join('<br>'));
  }

  let hint = '';
  if (!player.playing) {
    const piano = midi.state.kind === 'connected';
    hint = player.mode === 'listen' || !piano ? 'Appuie sur ▶ ou Espace pour commencer' : 'Joue une note pour commencer';
    if (!sampler.started && settings.sound === 'browser') hint += ' · touche la page une fois pour activer le son';
  } else if (player.waiting && player.stats.hit === 0) {
    hint = 'Joue les touches en jaune';
  }
  setText(ui.hint, hint);
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  player.tick(dt);
  renderer.draw({
    player,
    pressed,
    showNoteNames: settings.showNoteNames,
    fingers: settings.fingers,
    ghostHands: settings.ghostHands,
  });
  if (settings.view !== 'notes') scoreView.update(Math.max(0, player.time));
  renderLive();
  requestAnimationFrame(frame);
}

renderer.resize();
new ResizeObserver(() => renderer.resize()).observe(ui.canvas);

// --- Démarrage ---------------------------------------------------------------------

async function init(): Promise<void> {
  applyView();
  await refreshSongList();
  if (!loadSongById(settings.songId)) loadSongById(DEMOS[0].id);
  renderMidiState(midi.state);
  renderControls();
  requestAnimationFrame(frame);
  await midi.connect();
}

void init();
