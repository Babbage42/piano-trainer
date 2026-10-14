import type { Player } from '../engine/player';
import type { Hand, Note } from '../song/types';

/** Ce que les mains ont besoin de savoir du clavier dessiné. */
export interface KeyboardGeometry {
  /** Centre horizontal de la touche, ou null si elle est hors du clavier affiché. */
  keyCenter(pitch: number): { x: number; black: boolean } | null;
  whiteWidth: number;
  keyboardTop: number;
  keyboardHeight: number;
}

/** Une main se prépare à jouer les notes qui arrivent dans ce délai (secondes de morceau). */
const LOOKAHEAD = 0.35;
/** Au-delà, elle se place quand même au-dessus de sa prochaine note. */
const PREPARE = 2.5;
const HAND_SPEED = 9;
const FINGER_SPEED = 16;

const SKIN = { light: '#f0c8a8', base: '#e2b08e', shadow: '#c48e6c', outline: 'rgba(120, 70, 45, 0.55)', nail: '#f8e3d8' };
const HAND_COLORS: Record<Hand, string> = { right: '#4c9bff', left: '#ff9a3c' };
/** Largeur relative de chaque doigt (pouce … auriculaire). */
const FINGER_WIDTH = [0.7, 0.6, 0.62, 0.57, 0.5];

interface FingerState {
  x: number;
  y: number;
  pressed: boolean;
  upcoming: boolean;
}

interface HandState {
  anchor: number | null;
  fingers: FingerState[];
}

/**
 * Des mains vues de dessus, posées sur le clavier, qui jouent les notes avec les doigtés
 * du morceau (écrits ou calculés). Chaque doigt vise la touche que son doigté lui donne,
 * s'enfonce quand la note sonne et s'entoure d'un halo juste avant. La main glisse vers
 * sa position suivante avec un peu d'avance, comme le ferait un pianiste.
 */
export class GhostHands {
  private hands: Record<Hand, HandState> = { right: emptyHand(), left: emptyHand() };
  private last = performance.now();
  private songKey: unknown = null;

  draw(ctx: CanvasRenderingContext2D, geo: KeyboardGeometry, player: Player): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.songKey !== player.song) {
      this.songKey = player.song;
      this.hands = { right: emptyHand(), left: emptyHand() };
    }
    for (const hand of ['left', 'right'] as Hand[]) {
      this.update(hand, geo, player, dt);
      const state = this.hands[hand];
      if (state.anchor === null) continue;
      // En mode jeu, la main que joue l'app reste discrète : c'est l'autre qu'on apprend.
      const faded = player.mode !== 'listen' && !player.userHands.has(hand);
      this.drawHand(ctx, geo, hand, state, faded ? 0.3 : 0.78);
    }
  }

  private update(hand: Hand, geo: KeyboardGeometry, player: Player, dt: number): void {
    const state = this.hands[hand];
    const t = player.time;
    const side = hand === 'right' ? 1 : -1;
    const ww = geo.whiteWidth;
    const offset = (f: number) => side * (f - 3) * ww;

    // Pour chaque doigt, la note qu'il joue maintenant, sinon celle qu'il va jouer bientôt.
    const assigned: Array<Note | null> = [null, null, null, null, null];
    let next: Note | null = null;
    for (const note of player.song.notes) {
      if (note.start > t + PREPARE) break;
      if (note.hand !== hand || !note.finger || note.start + note.duration <= t) continue;
      if (!next && note.start >= t) next = note;
      if (note.start > t + LOOKAHEAD) continue;
      const current = assigned[note.finger - 1];
      const sounding = note.start <= t;
      if (!current || (sounding && current.start > t) || (!sounding && current.start > t && note.start < current.start)) {
        assigned[note.finger - 1] = note;
      }
    }

    // Position de la main : là où chaque doigt occupé tombe naturellement sur sa touche.
    const anchors: number[] = [];
    assigned.forEach((note, i) => {
      const key = note && geo.keyCenter(note.pitch);
      if (key) anchors.push(key.x - offset(i + 1));
    });
    if (anchors.length === 0 && next?.finger) {
      const key = geo.keyCenter(next.pitch);
      if (key) anchors.push(key.x - offset(next.finger));
    }
    if (anchors.length > 0) {
      const target = anchors.reduce((a, b) => a + b, 0) / anchors.length;
      // Un grand saut (changement de morceau, retour au début) se fait d'un coup.
      if (state.anchor === null || Math.abs(target - state.anchor) > ww * 14) state.anchor = target;
      else state.anchor += (target - state.anchor) * Math.min(1, dt * HAND_SPEED);
    }
    if (state.anchor === null) return;

    const top = geo.keyboardTop;
    const kh = geo.keyboardHeight;
    state.fingers.forEach((finger, i) => {
      const note = assigned[i];
      const key = note && geo.keyCenter(note.pitch);
      const pressed = !!note && note.start <= t && t < note.start + note.duration * 0.92;
      let tx: number;
      let ty: number;
      if (key) {
        tx = key.x;
        ty = top + kh * (key.black ? 0.3 : 0.5) + (pressed ? kh * 0.03 : 0);
      } else {
        tx = state.anchor! + offset(i + 1);
        ty = top + kh * (i === 0 ? 0.68 : 0.57);
      }
      if (finger.x === 0 && finger.y === 0) {
        finger.x = tx;
        finger.y = ty;
      }
      const k = Math.min(1, dt * FINGER_SPEED);
      finger.x += (tx - finger.x) * k;
      finger.y += (ty - finger.y) * k;
      finger.pressed = pressed;
      finger.upcoming = !!note && !pressed && note.start > t;
    });
  }

  private drawHand(ctx: CanvasRenderingContext2D, geo: KeyboardGeometry, hand: Hand, state: HandState, alpha: number): void {
    const side = hand === 'right' ? 1 : -1;
    const ww = geo.whiteWidth;
    const top = geo.keyboardTop;
    const kh = geo.keyboardHeight;
    const anchor = state.anchor!;
    const knuckleY = top + kh * 0.84;
    // Les jointures restent groupées au-dessus de la main ; ce sont les doigts qui s'écartent.
    const knuckle = (i: number) => ({
      x: anchor + side * (i - 2) * ww * 0.82,
      y: i === 0 ? top + kh * 0.98 : knuckleY - Math.sin(((i - 1) / 3) * Math.PI) * kh * 0.03,
    });

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // La paume, qui sort du bas de l'écran.
    const k1 = knuckle(1);
    const k4 = knuckle(4);
    const palmLeft = Math.min(k1.x, k4.x) - ww * 0.45;
    const palmRight = Math.max(k1.x, k4.x) + ww * 0.45;
    const palmGradient = ctx.createLinearGradient(0, knuckleY - kh * 0.05, 0, top + kh * 1.4);
    palmGradient.addColorStop(0, SKIN.base);
    palmGradient.addColorStop(1, SKIN.shadow);
    ctx.fillStyle = palmGradient;
    ctx.strokeStyle = SKIN.outline;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(palmLeft, top + kh * 1.6);
    ctx.lineTo(palmLeft, knuckleY + kh * 0.02);
    ctx.quadraticCurveTo((palmLeft + palmRight) / 2, knuckleY - kh * 0.08, palmRight, knuckleY + kh * 0.02);
    ctx.lineTo(palmRight, top + kh * 1.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Les doigts, de l'auriculaire au pouce.
    for (const i of [4, 3, 2, 1, 0]) {
      const base = knuckle(i);
      const finger = state.fingers[i];
      const width = ww * FINGER_WIDTH[i];
      this.drawFinger(ctx, base, finger, width, hand, i + 1);
    }
    ctx.restore();
  }

  private drawFinger(
    ctx: CanvasRenderingContext2D,
    base: { x: number; y: number },
    finger: FingerState,
    width: number,
    hand: Hand,
    number: number,
  ): void {
    const dx = finger.x - base.x;
    const dy = finger.y - base.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    // Le bout du doigt s'arrête un peu avant le point visé, pour que l'ongle soit sur la touche.
    const tip = { x: finger.x - ux * width * 0.15, y: finger.y - uy * width * 0.15 };

    // Contour, puis chair, puis un reflet : un tube arrondi qui donne du volume.
    ctx.strokeStyle = SKIN.outline;
    ctx.lineWidth = width + 2;
    line(ctx, base, tip);
    ctx.strokeStyle = finger.pressed ? SKIN.shadow : SKIN.base;
    ctx.lineWidth = width;
    line(ctx, base, tip);
    ctx.strokeStyle = SKIN.light;
    ctx.lineWidth = width * 0.35;
    line(ctx, { x: base.x - uy * width * 0.15, y: base.y + ux * width * 0.15 }, { x: tip.x - uy * width * 0.15, y: tip.y + ux * width * 0.15 });

    // Un pli à la phalange.
    const crease = { x: base.x + dx * 0.55, y: base.y + dy * 0.55 };
    ctx.strokeStyle = SKIN.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crease.x - uy * width * 0.35, crease.y + ux * width * 0.35);
    ctx.lineTo(crease.x + uy * width * 0.35, crease.y - ux * width * 0.35);
    ctx.stroke();

    // L'ongle, au bout, dans l'axe du doigt.
    ctx.save();
    ctx.translate(tip.x - ux * width * 0.2, tip.y - uy * width * 0.2);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.fillStyle = SKIN.nail;
    ctx.strokeStyle = SKIN.outline;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, width * 0.36, width * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Le doigt qui joue ou va jouer est entouré de la couleur de sa main.
    if (finger.pressed || finger.upcoming) {
      const pulse = finger.pressed ? 1 : 0.5 + 0.5 * Math.sin(performance.now() / 120);
      ctx.save();
      ctx.globalAlpha *= finger.pressed ? 1 : pulse;
      ctx.strokeStyle = HAND_COLORS[hand];
      ctx.lineWidth = finger.pressed ? 3 : 2;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, width * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Le numéro du doigt, sur la phalange : le même que dans les pastilles.
    if (width >= 9) {
      ctx.fillStyle = 'rgba(70, 35, 20, 0.85)';
      ctx.font = `700 ${Math.round(Math.min(12, width * 0.75))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(number), base.x + dx * 0.3, base.y + dy * 0.3);
    }
  }
}

function emptyHand(): HandState {
  return { anchor: null, fingers: Array.from({ length: 5 }, () => ({ x: 0, y: 0, pressed: false, upcoming: false })) };
}

function line(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
