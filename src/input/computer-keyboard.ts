// Jouer sans piano, avec le clavier de l'ordinateur. On lit la position physique des touches
// (event.code), donc la disposition est la même en AZERTY et en QWERTY :
// la rangée du milieu donne les touches blanches, celle du dessus les noires.
const KEY_TO_OFFSET: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

export interface KeyboardHandlers {
  noteOn(pitch: number): void;
  noteOff(pitch: number): void;
  togglePlay(): void;
}

export function listenComputerKeyboard(handlers: KeyboardHandlers): void {
  let base = 60;
  const down = new Map<string, number>();

  const isTyping = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable);

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    if (event.code === 'Space') {
      // Un bouton sélectionné au clavier (Tab) garde l'usage normal d'Espace.
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      handlers.togglePlay();
      return;
    }
    // Rangée du bas, à gauche : changer d'octave.
    if (event.code === 'KeyZ') base = Math.max(24, base - 12);
    if (event.code === 'KeyX') base = Math.min(96, base + 12);
    const offset = KEY_TO_OFFSET[event.code];
    if (offset === undefined || down.has(event.code)) return;
    const pitch = base + offset;
    down.set(event.code, pitch);
    handlers.noteOn(pitch);
  });

  window.addEventListener('keyup', (event) => {
    const pitch = down.get(event.code);
    if (pitch === undefined) return;
    down.delete(event.code);
    handlers.noteOff(pitch);
  });

  window.addEventListener('blur', () => {
    for (const pitch of down.values()) handlers.noteOff(pitch);
    down.clear();
  });
}
