import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// Dans l'app iPhone (Capacitor), le navigateur n'a pas de Web MIDI. Le module natif
// (ios/App/App/MidiPlugin.swift) le remplace ; ce fichier l'habille en Web MIDI, pour que
// le reste de l'app (src/input/midi.ts) ne voie aucune différence.

interface PortInfo {
  id: string;
  name: string;
}

interface Devices {
  inputs: PortInfo[];
  outputs: PortInfo[];
}

interface MidiPlugin {
  start(): Promise<Devices>;
  send(options: { data: number[]; id?: string }): Promise<void>;
  /** Ouvre l'écran d'Apple qui connecte un piano en Bluetooth. */
  showBluetooth(): Promise<void>;
  addListener(event: 'message', listener: (event: { data: number[]; id: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'devices', listener: (devices: Devices) => void): Promise<PluginListenerHandle>;
}

const NativeMidi = registerPlugin<MidiPlugin>('Midi');

/** Vrai dans l'app iPhone : le MIDI passe par le module natif, et se connecte en Bluetooth depuis l'app. */
export const nativeMidi = Capacitor.isNativePlatform();

export function showBluetoothPairing(): void {
  void NativeMidi.showBluetooth();
}

interface FakeInput {
  id: string;
  name: string;
  state: 'connected';
  onmidimessage: ((event: { data: Uint8Array }) => void) | null;
}

/** Installe navigator.requestMIDIAccess dans l'app iPhone. Sans effet dans un navigateur. */
export function installNativeMidi(): void {
  if (!nativeMidi) return;
  let access: Promise<MIDIAccess> | null = null;
  navigator.requestMIDIAccess = () => (access ??= createAccess());
}

async function createAccess(): Promise<MIDIAccess> {
  const inputs = new Map<string, FakeInput>();
  const outputs = new Map<string, { id: string; name: string; state: 'connected'; send(data: number[]): void }>();
  const access = { inputs, outputs, sysexEnabled: false, onstatechange: null as (() => void) | null };

  const update = (devices: Devices) => {
    // Les ports déjà connus gardent leur objet, et donc leur écouteur onmidimessage.
    for (const id of [...inputs.keys()]) if (!devices.inputs.some((p) => p.id === id)) inputs.delete(id);
    for (const port of devices.inputs) {
      if (!inputs.has(port.id)) inputs.set(port.id, { ...port, state: 'connected', onmidimessage: null });
    }
    outputs.clear();
    for (const port of devices.outputs) {
      outputs.set(port.id, {
        ...port,
        state: 'connected',
        send: (data) => void NativeMidi.send({ data: Array.from(data), id: port.id }),
      });
    }
  };

  await NativeMidi.addListener('message', ({ data, id }) => {
    const input = inputs.get(id) ?? inputs.values().next().value;
    input?.onmidimessage?.({ data: Uint8Array.from(data) });
  });
  await NativeMidi.addListener('devices', (devices) => {
    update(devices);
    access.onstatechange?.();
  });
  update(await NativeMidi.start());
  return access as unknown as MIDIAccess;
}
