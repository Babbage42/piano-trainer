import type { Note } from '../song/types';
import type { Scheduler } from '../engine/player';

// Échantillons du Salamander Grand Piano (Alexander Holm, CC-BY 3.0), servis par le projet Tone.js.
const SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/';
// Un échantillon toutes les trois notes ; les notes intermédiaires sont transposées.
const SAMPLE_NAMES = ['C', 'Ds', 'Fs', 'A'];
const SAMPLE_SEMITONES = [0, 3, 6, 9];
const RELEASE = 0.4;

interface Voice {
  source: AudioScheduledSourceNode;
  gain: GainNode;
}

/** Son de piano dans le navigateur. Tant que les échantillons chargent, un son de synthèse les remplace. */
export class Sampler implements Scheduler {
  private ctx: AudioContext | null = null;
  private output: GainNode | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private voices = new Set<Voice>();
  private loading: Promise<void> | null = null;
  volume = 0.8;

  /** À appeler depuis un geste de l'utilisateur (clic, touche) : les navigateurs l'exigent. */
  start(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.connect(this.ctx.destination);
      this.output = this.ctx.createGain();
      this.output.gain.value = this.volume;
      this.output.connect(compressor);
      this.loading = this.loadSamples();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Faux tant que l'utilisateur n'a pas encore cliqué ou tapé dans la page. */
  get started(): boolean {
    return this.ctx?.state === 'running';
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.output) this.output.gain.value = volume;
  }

  schedule(note: Note, delay: number, duration: number): void {
    this.play(note.pitch, note.velocity, delay, duration);
  }

  /** Joue une hauteur. Sans durée, la note tient jusqu'à l'appel de la fonction renvoyée. */
  play(pitch: number, velocity: number, delay = 0, duration?: number): () => void {
    if (!this.ctx || !this.output) return () => {};
    const ctx = this.ctx;
    const at = ctx.currentTime + delay + 0.01;
    const gain = ctx.createGain();
    const level = 0.15 + 0.85 * velocity * velocity;
    gain.connect(this.output);

    const source = this.createSource(pitch, at, gain, level);
    const voice: Voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => {
      gain.disconnect();
      this.voices.delete(voice);
    };

    // Le relâchement part du niveau atteint à cet instant, quel qu'il soit.
    const release = (when: number) => {
      const t = Math.max(when, ctx.currentTime);
      gain.gain.setTargetAtTime(0, t, RELEASE / 4);
      source.stop(t + RELEASE);
    };
    if (duration !== undefined) release(at + duration);
    return () => release(ctx.currentTime);
  }

  cancelAll(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.02);
      try {
        voice.source.stop(now + 0.1);
      } catch {
        // Déjà arrêtée.
      }
    }
  }

  private createSource(pitch: number, at: number, gain: GainNode, level: number): AudioScheduledSourceNode {
    const ctx = this.ctx!;
    const sample = this.nearestSample(pitch);
    if (sample) {
      const source = ctx.createBufferSource();
      source.buffer = sample.buffer;
      source.playbackRate.value = 2 ** ((pitch - sample.pitch) / 12);
      source.connect(gain);
      gain.gain.setValueAtTime(level, at);
      source.start(at);
      return source;
    }
    // Son de secours : une onde triangle qui s'éteint doucement, comme une corde frappée.
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
    osc.connect(gain);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level * 0.5, at + 0.005);
    gain.gain.setTargetAtTime(level * 0.15, at + 0.005, 0.4);
    osc.start(at);
    return osc;
  }

  private nearestSample(pitch: number): { pitch: number; buffer: AudioBuffer } | null {
    let best: { pitch: number; buffer: AudioBuffer } | null = null;
    for (const [samplePitch, buffer] of this.buffers) {
      if (!best || Math.abs(samplePitch - pitch) < Math.abs(best.pitch - pitch)) best = { pitch: samplePitch, buffer };
    }
    return best;
  }

  private async loadSamples(): Promise<void> {
    const ctx = this.ctx!;
    const jobs: Promise<void>[] = [];
    // De A0 (21) à C8 (108).
    for (let octave = 0; octave <= 8; octave++) {
      SAMPLE_NAMES.forEach((name, i) => {
        const pitch = (octave + 1) * 12 + SAMPLE_SEMITONES[i];
        if (pitch < 21 || pitch > 108) return;
        jobs.push(
          fetch(`${SAMPLE_BASE_URL}${name}${octave}.mp3`)
            .then((r) => {
              if (!r.ok) throw new Error(String(r.status));
              return r.arrayBuffer();
            })
            .then((data) => ctx.decodeAudioData(data))
            .then((buffer) => {
              this.buffers.set(pitch, buffer);
            })
            .catch(() => {
              // Hors ligne ou échantillon manquant : la note voisine ou le son de secours prend le relais.
            }),
        );
      });
    }
    await Promise.all(jobs);
  }

  whenLoaded(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }
}
