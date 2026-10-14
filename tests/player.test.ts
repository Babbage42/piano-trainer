import { describe, expect, it } from 'vitest';
import { LEAD_IN, Player, type Scheduler } from '../src/engine/player';
import { songFromNotation } from '../src/song/notation';
import type { Note } from '../src/song/types';

class FakeScheduler implements Scheduler {
  played: Array<{ pitch: number; at: number }> = [];
  clock = 0;
  schedule(note: Note, delay: number): void {
    this.played.push({ pitch: note.pitch, at: this.clock + delay });
  }
  cancelAll(): void {}
}

// 60 bpm : un temps = une seconde. Main droite do-ré-mi-fa, main gauche un do grave sur 4 temps.
const song = () =>
  songFromNotation({ title: 't', bpm: 60, beatsPerBar: 4, right: 'C4 D4 E4 F4', left: 'C3:2 G2:2' });

/** Fait avancer le lecteur de `seconds` secondes réelles, par images de 1/60 s. */
function run(player: Player, scheduler: FakeScheduler, seconds: number) {
  const step = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += step) {
    player.tick(step);
    scheduler.clock += step;
  }
}

describe('mode écoute', () => {
  it("joue toutes les notes à l'heure", () => {
    const s = new FakeScheduler();
    const p = new Player(song(), s);
    p.play();
    run(p, s, LEAD_IN + 4.5);
    expect(s.played.map((x) => x.pitch).sort()).toEqual([43, 48, 60, 62, 64, 65]);
    const d = s.played.find((x) => x.pitch === 62)!;
    expect(d.at).toBeCloseTo(LEAD_IN + 1, 1);
    expect(p.playing).toBe(false);
  });

  it('ralentit', () => {
    const s = new FakeScheduler();
    const p = new Player(song(), s);
    p.setSpeed(0.5);
    p.play();
    run(p, s, LEAD_IN * 2 + 2.5);
    const d = s.played.find((x) => x.pitch === 62)!;
    expect(d.at).toBeCloseTo(LEAD_IN * 2 + 2, 1);
  });
});

describe('mode attente', () => {
  it("s'arrête sur la note à jouer et repart quand elle est jouée", () => {
    const s = new FakeScheduler();
    const p = new Player(song(), s);
    p.setMode('wait');
    p.setUserHands(['right']);
    p.play();
    run(p, s, LEAD_IN + 3);
    expect(p.time).toBe(0);
    expect(p.waiting).toBe(true);
    expect(p.expectedPitches()).toEqual([60]);
    // La main gauche, jouée par l'app au même instant, attend aussi.
    expect(s.played).toEqual([]);

    expect(p.noteOn(61)).toBe('wrong');
    expect(p.noteOn(60)).toBe('hit');
    expect(p.waiting).toBe(false);
    run(p, s, 0.1);
    expect(s.played.map((x) => x.pitch)).toEqual([48]);
    expect(p.time).toBeGreaterThan(0);

    run(p, s, 2);
    expect(p.time).toBe(1);
    expect(p.expectedPitches()).toEqual([62]);
    expect(p.stats).toEqual({ hit: 1, missed: 0, wrong: 1 });
  });

  it('ignore une bonne note jouée beaucoup trop tôt', () => {
    const s = new FakeScheduler();
    const p = new Player(song(), s);
    p.setMode('wait');
    p.play();
    expect(p.noteOn(60)).toBe('free');
    run(p, s, LEAD_IN - 0.2);
    expect(p.noteOn(60)).toBe('hit');
  });

  it('attend tout un accord', () => {
    const s = new FakeScheduler();
    const p = new Player(
      songFromNotation({ title: 'a', bpm: 60, beatsPerBar: 4, right: 'C4+E4+G4:4', left: 'r:4' }),
      s,
    );
    p.setMode('wait');
    p.play();
    run(p, s, LEAD_IN + 0.5);
    p.noteOn(60);
    p.noteOn(64);
    expect(p.waiting).toBe(true);
    expect(p.expectedPitches()).toEqual([67]);
    p.noteOn(67);
    expect(p.waiting).toBe(false);
  });
});

describe('mode rythme', () => {
  it('juge les notes jouées à temps et compte les ratées', () => {
    const s = new FakeScheduler();
    const p = new Player(song(), s);
    p.setMode('flow');
    p.setUserHands(['right']);
    p.play();
    run(p, s, LEAD_IN + 0.05);
    expect(p.noteOn(60)).toBe('hit');
    run(p, s, 1.5);
    // Le ré (à 1 s) n'a pas été joué : il est raté une fois la tolérance passée.
    expect(p.status[p.song.notes.find((n) => n.pitch === 62)!.id]).toBe('missed');
    expect(p.noteOn(70)).toBe('wrong');
    expect(p.stats).toEqual({ hit: 1, missed: 1, wrong: 1 });
  });
});

describe('boucle', () => {
  it('rejoue la boucle et ne joue que ses notes', () => {
    const s = new FakeScheduler();
    const p = new Player(song(), s);
    const passes: number[] = [];
    p.onPassEnd = (stats) => passes.push(stats.missed);
    p.setMode('flow');
    p.setLoop({ start: 1, end: 3 });
    expect(p.time).toBe(1 - LEAD_IN);
    p.play();
    run(p, s, LEAD_IN + 2.1);
    expect(passes).toEqual([2]);
    expect(p.time).toBeLessThan(1);
    // La main gauche n'a joué que la note de la boucle (sol à 2 s).
    expect(s.played.map((x) => x.pitch)).toEqual([43]);
  });
});

describe('départ depuis une mesure', () => {
  it("ignore les notes d'avant le point de départ", () => {
    const s = new FakeScheduler();
    const p = new Player(song(), s);
    p.setMode('wait');
    p.startFrom(2);
    expect(p.time).toBe(2 - LEAD_IN);
    p.play();
    run(p, s, LEAD_IN + 0.5);
    // Le ré (à 1 s) tombe pendant le décompte mais n'est pas attendu : on attend le mi (à 2 s).
    expect(p.time).toBe(2);
    expect(p.expectedPitches()).toEqual([64]);
  });
});
