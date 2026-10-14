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

const SKIN = {
  light: '#f3d0b3',
  base: '#e4b392',
  shadow: '#bf8664',
  crease: 'rgba(125, 70, 45, 0.45)',
  outline: 'rgba(110, 60, 38, 0.6)',
  nail: '#f7e1d6',
  nailEdge: 'rgba(150, 95, 75, 0.55)',
};
const HAND_COLORS: Record<Hand, string> = { right: '#4c9bff', left: '#ff9a3c' };

/**
 * Proportions de chaque doigt (pouce … auriculaire), en largeurs de touche blanche et en
 * fraction de la hauteur du clavier. Vues de dessus, les jointures forment un arc dont le
 * majeur est le sommet ; le majeur va le plus loin sur les touches, l'auriculaire et le
 * pouce restent près du bord.
 */
const FINGERS = [
  { width: 0.82, tipWidth: 0.64, knuckleX: -1.75, knuckleY: 0.99, tipWhite: 0.66, tipBlack: 0.47, rest: 0.74 },
  { width: 0.62, tipWidth: 0.5, knuckleX: -0.85, knuckleY: 0.865, tipWhite: 0.5, tipBlack: 0.33, rest: 0.58 },
  { width: 0.64, tipWidth: 0.52, knuckleX: 0, knuckleY: 0.84, tipWhite: 0.46, tipBlack: 0.3, rest: 0.54 },
  { width: 0.6, tipWidth: 0.48, knuckleX: 0.82, knuckleY: 0.855, tipWhite: 0.49, tipBlack: 0.32, rest: 0.57 },
  { width: 0.52, tipWidth: 0.42, knuckleX: 1.58, knuckleY: 0.89, tipWhite: 0.56, tipBlack: 0.38, rest: 0.63 },
];

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
      const spec = FINGERS[i];
      if (key) {
        tx = key.x;
        ty = top + kh * (key.black ? spec.tipBlack : spec.tipWhite) + (pressed ? kh * 0.025 : 0);
      } else {
        tx = state.anchor! + offset(i + 1);
        ty = top + kh * spec.rest;
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
    const at = (x: number, y: number) => ({ x: anchor + side * x * ww, y: top + y * kh });
    const knuckle = (i: number) => at(FINGERS[i].knuckleX, FINGERS[i].knuckleY);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Une ombre portée : la main flotte un peu au-dessus des touches.
    const shadow = (pressed = false) => {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.32)';
      ctx.shadowBlur = ww * (pressed ? 0.25 : 0.55);
      ctx.shadowOffsetY = ww * (pressed ? 0.05 : 0.18);
    };
    const noShadow = () => {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    };

    // Le pouce : il part du bas de la paume, en biais, en deux segments.
    const thumb = state.fingers[0];
    const thumbRoot = at(-1.35, 1.35);
    const thumbJoint = knuckle(0);
    shadow(thumb.pressed);
    this.fillSegment(ctx, thumbRoot, thumbJoint, ww * 1.05, ww * 0.86, false);
    const thumbTip = this.fillSegment(ctx, thumbJoint, thumb, ww * FINGERS[0].width, ww * FINGERS[0].tipWidth, true);

    // La paume, avec l'arc des jointures et le creux entre pouce et index.
    const k1 = knuckle(1);
    const k2 = knuckle(2);
    const k3 = knuckle(3);
    const k4 = knuckle(4);
    const palm = ctx.createLinearGradient(0, top + kh * 0.8, 0, top + kh * 1.4);
    palm.addColorStop(0, SKIN.base);
    palm.addColorStop(1, SKIN.shadow);
    ctx.fillStyle = palm;
    ctx.strokeStyle = SKIN.outline;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    const start = at(2.2, 1.6);
    ctx.moveTo(start.x, start.y);
    const pinkySide = at(2.05, 0.95);
    ctx.lineTo(pinkySide.x, pinkySide.y);
    ctx.quadraticCurveTo(k4.x + side * ww * 0.35, k4.y - kh * 0.03, k4.x, k4.y - kh * 0.02);
    ctx.quadraticCurveTo(k3.x + side * ww * 0.4, k3.y - kh * 0.035, k3.x, k3.y - kh * 0.03);
    ctx.quadraticCurveTo(k2.x + side * ww * 0.4, k2.y - kh * 0.04, k2.x, k2.y - kh * 0.035);
    ctx.quadraticCurveTo(k1.x + side * ww * 0.4, k1.y - kh * 0.035, k1.x - side * ww * 0.25, k1.y - kh * 0.02);
    const web = at(-1.5, 0.93);
    ctx.quadraticCurveTo(at(-1.3, 0.88).x, at(-1.3, 0.88).y, web.x, web.y);
    const thumbBase = at(-1.95, 1.6);
    ctx.quadraticCurveTo(at(-1.75, 1.15).x, at(-1.75, 1.15).y, thumbBase.x, thumbBase.y);
    ctx.closePath();
    shadow();
    ctx.fill();
    noShadow();
    ctx.stroke();

    // Les doigts, de l'auriculaire à l'index (l'index passe au-dessus du pouce).
    const tips: Array<{ x: number; y: number }> = [thumbTip];
    for (const i of [4, 3, 2, 1]) {
      const finger = state.fingers[i];
      shadow(finger.pressed);
      tips[i] = this.fillSegment(ctx, knuckle(i), finger, ww * FINGERS[i].width, ww * FINGERS[i].tipWidth, true);
    }
    noShadow();

    // Détails : plis, ongles, halos et numéros.
    for (const i of [0, 4, 3, 2, 1]) {
      const finger = state.fingers[i];
      const base = i === 0 ? thumbJoint : knuckle(i);
      this.drawDetails(ctx, base, tips[i], finger, ww * FINGERS[i].tipWidth, hand, i + 1, i === 0 ? side : 0);
    }
    ctx.restore();
  }

  /**
   * Un segment de doigt effilé, de `base` (largeur wb) à `tip` (largeur wt), arrondi au
   * bout s'il s'agit d'une phalange terminale. Ombré en travers pour lui donner du volume.
   * Renvoie le point où s'arrête le bout du doigt.
   */
  private fillSegment(
    ctx: CanvasRenderingContext2D,
    base: { x: number; y: number },
    target: { x: number; y: number; pressed?: boolean },
    wb: number,
    wt: number,
    rounded: boolean,
  ): { x: number; y: number } {
    const dx = target.x - base.x;
    const dy = target.y - base.y;
    const length = Math.hypot(dx, dy) || 1;
    const u = { x: dx / length, y: dy / length };
    const n = { x: -u.y, y: u.x };
    // Le bout du doigt s'arrête un peu avant le point visé, pour que la pulpe soit sur la touche.
    const tipWidth = target.pressed ? wt * 1.08 : wt;
    const tip = rounded ? { x: target.x - u.x * tipWidth * 0.3, y: target.y - u.y * tipWidth * 0.3 } : target;
    const gradient = ctx.createLinearGradient(base.x + (n.x * wb) / 2, base.y + (n.y * wb) / 2, base.x - (n.x * wb) / 2, base.y - (n.y * wb) / 2);
    gradient.addColorStop(0, SKIN.shadow);
    gradient.addColorStop(0.38, target.pressed ? SKIN.shadow : SKIN.base);
    gradient.addColorStop(0.62, SKIN.light);
    gradient.addColorStop(1, SKIN.shadow);
    ctx.fillStyle = gradient;
    ctx.strokeStyle = SKIN.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(base.x + (n.x * wb) / 2, base.y + (n.y * wb) / 2);
    ctx.lineTo(tip.x + (n.x * tipWidth) / 2, tip.y + (n.y * tipWidth) / 2);
    if (rounded) {
      const angle = Math.atan2(n.y, n.x);
      ctx.arc(tip.x, tip.y, tipWidth / 2, angle, angle + Math.PI, true);
    } else {
      ctx.lineTo(tip.x - (n.x * tipWidth) / 2, tip.y - (n.y * tipWidth) / 2);
    }
    ctx.lineTo(base.x - (n.x * wb) / 2, base.y - (n.y * wb) / 2);
    ctx.closePath();
    ctx.fill();
    const saved = ctx.shadowColor;
    ctx.shadowColor = 'transparent';
    ctx.stroke();
    ctx.shadowColor = saved;
    return tip;
  }

  private drawDetails(
    ctx: CanvasRenderingContext2D,
    base: { x: number; y: number },
    tip: { x: number; y: number },
    finger: FingerState,
    width: number,
    hand: Hand,
    number: number,
    /** Pour le pouce, vu de côté : de quel côté décaler l'ongle (0 pour les autres doigts). */
    thumbSide: number,
  ): void {
    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const length = Math.hypot(dx, dy) || 1;
    const u = { x: dx / length, y: dy / length };
    const n = { x: -u.y, y: u.x };

    // Plis aux articulations (un seul pour le pouce, deux pour les autres doigts).
    ctx.strokeStyle = SKIN.crease;
    ctx.lineWidth = 1;
    for (const at of thumbSide ? [0.5] : [0.45, 0.74]) {
      const c = { x: base.x + dx * at, y: base.y + dy * at };
      const half = width * 0.38;
      ctx.beginPath();
      ctx.moveTo(c.x + n.x * half, c.y + n.y * half);
      ctx.quadraticCurveTo(c.x - u.x * width * 0.12, c.y - u.y * width * 0.12, c.x - n.x * half, c.y - n.y * half);
      ctx.stroke();
    }

    // L'ongle. Celui du pouce, vu de biais, est décalé sur le côté et plus étroit.
    ctx.save();
    const nailCenter = {
      x: tip.x - u.x * width * 0.08 + n.x * width * 0.12 * thumbSide,
      y: tip.y - u.y * width * 0.08 + n.y * width * 0.12 * thumbSide,
    };
    ctx.translate(nailCenter.x, nailCenter.y);
    ctx.rotate(Math.atan2(u.y, u.x));
    ctx.fillStyle = SKIN.nail;
    ctx.strokeStyle = SKIN.nailEdge;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, width * 0.3, width * (thumbSide ? 0.26 : 0.32), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Le doigt qui joue ou va jouer est entouré de la couleur de sa main.
    if (finger.pressed || finger.upcoming) {
      const pulse = finger.pressed ? 1 : 0.5 + 0.5 * Math.sin(performance.now() / 120);
      ctx.save();
      ctx.globalAlpha *= pulse;
      ctx.strokeStyle = HAND_COLORS[hand];
      ctx.lineWidth = finger.pressed ? 3 : 2;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, width * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Le numéro du doigt, sur la première phalange : le même que dans les pastilles.
    if (width >= 7) {
      ctx.fillStyle = 'rgba(80, 40, 22, 0.85)';
      ctx.font = `700 ${Math.round(Math.min(12, width * 0.95))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(number), base.x + dx * 0.24, base.y + dy * 0.24);
    }
  }
}

function emptyHand(): HandState {
  return { anchor: null, fingers: Array.from({ length: 5 }, () => ({ x: 0, y: 0, pressed: false, upcoming: false })) };
}
