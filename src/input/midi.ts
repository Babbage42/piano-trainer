import type { Note } from '../song/types';
import type { Scheduler } from '../engine/player';

export type MidiState =
  | { kind: 'unsupported' }
  | { kind: 'denied' }
  | { kind: 'waiting' }
  | { kind: 'connected'; names: string[] };

export interface MidiHandlers {
  noteOn(pitch: number, velocity: number): void;
  noteOff(pitch: number): void;
  stateChange(state: MidiState): void;
}

/** Écoute tous les claviers MIDI branchés, en USB comme en Bluetooth. */
export class MidiInput {
  private access: MIDIAccess | null = null;
  state: MidiState = { kind: 'waiting' };

  constructor(private handlers: MidiHandlers) {}

  async connect(): Promise<void> {
    if (!('requestMIDIAccess' in navigator)) {
      this.setState({ kind: 'unsupported' });
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch {
      this.setState({ kind: 'denied' });
      return;
    }
    this.access.onstatechange = () => this.refresh();
    this.refresh();
  }

  /** Première sortie MIDI, pour faire jouer l'app par le piano lui-même. */
  firstOutput(): MIDIOutput | null {
    if (!this.access) return null;
    for (const output of this.access.outputs.values()) {
      if (output.state === 'connected') return output;
    }
    return null;
  }

  private refresh(): void {
    if (!this.access) return;
    const names: string[] = [];
    for (const input of this.access.inputs.values()) {
      if (input.state !== 'connected') continue;
      names.push(input.name ?? 'Clavier MIDI');
      input.onmidimessage = (event) => this.onMessage(event);
    }
    this.setState(names.length ? { kind: 'connected', names } : { kind: 'waiting' });
  }

  private onMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 3) return;
    const command = data[0] & 0xf0;
    if (command === 0x90 && data[2] > 0) this.handlers.noteOn(data[1], data[2] / 127);
    else if (command === 0x80 || command === 0x90) this.handlers.noteOff(data[1]);
  }

  private setState(state: MidiState): void {
    this.state = state;
    this.handlers.stateChange(state);
  }
}

/** Fait jouer les notes de l'app par le piano branché, avec son propre son. */
export class MidiOutScheduler implements Scheduler {
  private timers = new Set<number>();
  private sounding = new Set<number>();

  constructor(private getOutput: () => MIDIOutput | null) {}

  schedule(note: Note, delay: number, duration: number): void {
    const velocity = Math.max(1, Math.round(note.velocity * 127));
    this.later(delay, () => {
      this.getOutput()?.send([0x90, note.pitch, velocity]);
      this.sounding.add(note.pitch);
    });
    this.later(delay + duration, () => {
      this.getOutput()?.send([0x80, note.pitch, 0]);
      this.sounding.delete(note.pitch);
    });
  }

  cancelAll(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const output = this.getOutput();
    for (const pitch of this.sounding) output?.send([0x80, pitch, 0]);
    this.sounding.clear();
  }

  private later(seconds: number, fn: () => void): void {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, seconds * 1000);
    this.timers.add(timer);
  }
}
