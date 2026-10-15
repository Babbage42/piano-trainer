import type { Player } from '../engine/player';
import type { Hand, Note } from '../song/types';

/** Ce que les mains ont besoin de savoir du clavier dessiné. */
export interface KeyboardGeometry {
  /** Centre horizontal de la touche, ou null si elle est hors du clavier affiché. */
  keyCenter(pitch: number): { x: number; black: boolean } | null;
  whiteWidth: number;
  keyboardTop: number;
  keyboardHeight: number;
  blackKeyHeight: number;
  /** Bas du dessin : sous le clavier, on aperçoit les poignets. */
  bottom: number;
  /** Où se tient le pianiste (le milieu de ses épaules), en x. */
  centerX: number;
}

/** Ce que les mains ont besoin de savoir du morceau en cours. */
export type HandsPlayer = Pick<Player, 'song' | 'time' | 'mode' | 'userHands' | 'releaseTime'>;

/** Une main se prépare à jouer les notes qui arrivent dans ce délai (secondes de morceau). */
const LOOKAHEAD = 0.35;
/** Au-delà, elle se place quand même au-dessus de sa prochaine note. */
const PREPARE = 2.5;
const HAND_SPEED = 9;
const FINGER_SPEED = 16;

/*
 * Règles tirées de photos de mains d'adultes au piano, vues de dessus :
 * - les jointures sont au bord avant des touches ; le dos de la main et le poignet sont
 *   devant le clavier ;
 * - les doigts sont longs (3 à 3,5 largeurs de touche), effilés, un peu écartés au bout ;
 *   les longs doigts se posent entre les touches noires, l'auriculaire plus près du bord ;
 * - le pouce sort du bas de la main, côté index, et part en biais vers l'extérieur, avec
 *   un creux en V bien ouvert ; il se pose sur le tiers avant de sa touche ;
 * - la main prolonge l'avant-bras, qui part du coude : près du milieu du clavier, les
 *   doigts pointent un peu vers le centre ;
 * - la main est une seule silhouette lisse, contour à l'extérieur seulement, avec de petits
 *   ongles clairs au bout des doigts.
 * Mesures en millimètres ; une touche blanche fait 23,5 mm de large.
 */
const WHITE_KEY_MM = 23.5;
/** Profondeur de la jointure du majeur derrière le bord avant des touches blanches. */
const KNUCKLE_DEPTH = 6;
/**
 * La main droite vue de dessus, dans un repère dont l'origine est la jointure du majeur et
 * dont l'axe y descend vers le poignet. La main gauche en est le miroir.
 */
const MCP = [
  { x: -32, y: 16 }, // pouce : il quitte la main au bord, côté index, un peu sous les jointures
  { x: -21, y: 3 },
  { x: 0, y: 0 },
  { x: 19, y: 3 },
  { x: 35, y: 10 },
];
/** Longueur visible de chaque doigt, de la jointure au bout. */
const VISIBLE = [0, 72, 80, 74, 58];
/** Position des articulations le long du doigt (fraction de la longueur visible). */
const STATIONS = [-0.08, 0.42, 0.75, 1];
/**
 * Les deux phalanges du pouce, vues de dessus : à peine plus longues que la distance à sa
 * touche, pour qu'il reste presque droit, juste un peu fléchi, comme sur les photos.
 */
const THUMB_SEGMENTS = [26, 20];
/** Le bout du pouce se pose sur le tiers avant de sa touche. */
const THUMB_TIP_DEPTH = 30;
/** Largeurs (mm) aux articulations : base, milieu, dernière articulation, bout. Pouce : base, articulation, bout. */
const WIDTHS = [
  [22, 20.5, 17],
  [18.5, 17, 15, 13.2],
  [19, 17.5, 15.5, 13.6],
  [17.5, 16.2, 14.4, 12.8],
  [15.5, 14.2, 12.8, 11.4],
];
/** Le pianiste est assis au milieu ; ses coudes sont à 26 cm de part et d'autre, 38 cm en arrière des jointures. */
const ELBOW_HALF = 260;
const ELBOW_DISTANCE = 380;
/** Une main ne tourne guère plus d'une quinzaine de degrés. */
const MAX_TURN = 0.25;

const SKIN = {
  base: '#e6b593',
  outline: '#a8714f',
  crease: 'rgba(120, 66, 40, 0.35)',
  nail: '#f3d8cd',
  nailEdge: 'rgba(160, 105, 85, 0.45)',
};
const DARK = (a: number) => `rgba(85, 40, 18, ${a})`;
const LIGHT = (a: number) => `rgba(255, 244, 235, ${a})`;
const HAND_COLORS: Record<Hand, string> = { right: '#4c9bff', left: '#ff9a3c' };

interface Point {
  x: number;
  y: number;
}

interface FingerState extends Point {
  pressed: boolean;
  upcoming: boolean;
  /** Le doigt a une touche à jouer (sinon il suit la main). */
  active: boolean;
  black: boolean;
}

/** Un autre dessin des mains (la 3D à l'essai), qui reçoit leur état à chaque image. */
export interface HandsOverlay {
  render(geo: KeyboardGeometry, hands: Record<Hand, { anchor: number; turn: number; alpha: number; fingers: FingerState[] } | null>): void;
  clear(): void;
}

interface HandState {
  anchor: number | null;
  /** Rotation de la main (radians), qui suit la direction de l'avant-bras. */
  turn: number;
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
  overlay: HandsOverlay | null = null;

  draw(ctx: CanvasRenderingContext2D, geo: KeyboardGeometry, player: HandsPlayer): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.songKey !== player.song) {
      this.songKey = player.song;
      this.hands = { right: emptyHand(), left: emptyHand() };
    }
    ctx.save();
    // Les mains restent sur le clavier et la bande sous lui, jamais sur les notes qui tombent.
    ctx.beginPath();
    ctx.rect(0, geo.keyboardTop, 1e5, geo.bottom - geo.keyboardTop);
    ctx.clip();
    const overlay: Parameters<HandsOverlay['render']>[1] = { left: null, right: null };
    for (const hand of ['left', 'right'] as Hand[]) {
      this.update(hand, geo, player, dt);
      const state = this.hands[hand];
      if (state.anchor === null) continue;
      // En mode jeu, la main que joue l'app reste discrète : c'est l'autre qu'on apprend.
      const faded = player.mode !== 'listen' && !player.userHands.has(hand);
      const alpha = faded ? 0.32 : 0.96;
      if (this.overlay) overlay[hand] = { anchor: state.anchor, turn: state.turn, alpha: faded ? 0.4 : 1, fingers: state.fingers };
      else this.drawHand(ctx, geo, hand, state, alpha);
    }
    ctx.restore();
    this.overlay?.render(geo, overlay);
  }

  private update(hand: Hand, geo: KeyboardGeometry, player: HandsPlayer, dt: number): void {
    const state = this.hands[hand];
    const t = player.time;
    const side = hand === 'right' ? 1 : -1;
    const ww = geo.whiteWidth;
    const mm = ww / WHITE_KEY_MM;
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
      const jump = state.anchor === null || Math.abs(target - state.anchor) > ww * 14;
      state.anchor = jump ? target : state.anchor! + (target - state.anchor!) * Math.min(1, dt * HAND_SPEED);
      // La main prolonge l'avant-bras, qui part du coude du même côté.
      const elbow = geo.centerX + side * ELBOW_HALF * mm;
      const turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, Math.atan((state.anchor! - elbow) / (ELBOW_DISTANCE * mm))));
      state.turn = jump ? turn : state.turn + (turn - state.turn) * Math.min(1, dt * HAND_SPEED);
    }
    if (state.anchor === null) return;

    const front = geo.keyboardTop + geo.keyboardHeight;
    const keyLength = geo.keyboardHeight / mm;
    const blackFront = (geo.keyboardHeight - geo.blackKeyHeight) / mm;
    state.fingers.forEach((finger, i) => {
      const note = assigned[i];
      const key = note && geo.keyCenter(note.pitch);
      const pressed = !!note && note.start <= t && t < player.releaseTime(note);
      // Profondeur du bout du doigt derrière le bord avant des touches blanches (mm).
      const natural = i === 0 ? THUMB_TIP_DEPTH : KNUCKLE_DEPTH - MCP[i].y + VISIBLE[i];
      let depth = natural;
      let tx: number;
      if (key) {
        tx = key.x;
        // Sur une touche noire, le doigt doit être sur la touche, un peu derrière son bord avant.
        if (key.black) depth = i === 0 ? blackFront + 6 : Math.max(natural, blackFront + 10);
        depth = Math.min(depth, keyLength - 8);
        if (pressed) depth -= 1.5;
      } else {
        tx = state.anchor! + side * (i - 2) * ww;
      }
      const ty = front - depth * mm;
      if (finger.x === 0 && finger.y === 0) {
        finger.x = tx;
        finger.y = ty;
      }
      const k = Math.min(1, dt * FINGER_SPEED);
      finger.x += (tx - finger.x) * k;
      finger.y += (ty - finger.y) * k;
      finger.pressed = pressed;
      finger.upcoming = !!note && !pressed && note.start > t;
      finger.active = !!key;
      finger.black = !!key?.black;
    });
  }

  /** Le calque où chaque main est dessinée d'un bloc avant d'être posée sur le clavier. */
  private layer: HTMLCanvasElement | null = null;

  private layerFor(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
    const main = ctx.canvas;
    this.layer ??= document.createElement('canvas');
    if (this.layer.width !== main.width || this.layer.height !== main.height) {
      this.layer.width = main.width;
      this.layer.height = main.height;
    }
    const layer = this.layer.getContext('2d')!;
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.clearRect(0, 0, main.width, main.height);
    layer.setTransform(ctx.getTransform());
    return layer;
  }

  private drawHand(ctx: CanvasRenderingContext2D, geo: KeyboardGeometry, hand: Hand, state: HandState, alpha: number): void {
    const side = hand === 'right' ? 1 : -1;
    const mm = geo.whiteWidth / WHITE_KEY_MM;
    const origin = { x: state.anchor!, y: geo.keyboardTop + geo.keyboardHeight - KNUCKLE_DEPTH * mm };
    const cos = Math.cos(state.turn);
    const sin = Math.sin(state.turn);
    /** Un point du repère de la main (mm) vers l'écran, avec la rotation de la main. */
    const P = (x: number, y: number): Point => {
      const dx = side * x * mm;
      const dy = y * mm;
      return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
    };

    // Les formes : le pouce (articulé), les quatre doigts, la paume et le poignet.
    const thumb = state.fingers[0];
    const thumbPoints = this.thumbStations(P(MCP[0].x, MCP[0].y), thumb, side, mm);
    const fingerPoints: Point[][] = [thumbPoints];
    for (const i of [1, 2, 3, 4]) {
      const mcp = P(MCP[i].x, MCP[i].y);
      const tip = state.fingers[i];
      fingerPoints[i] = STATIONS.map((f) => ({ x: mcp.x + (tip.x - mcp.x) * f, y: mcp.y + (tip.y - mcp.y) * f }));
    }
    const widths = WIDTHS.map((w) => w.map((v) => v * mm));
    const fingerPath = (i: number) => limbPath(fingerPoints[i], widths[i]);
    const palm = palmPath(P, (geo.bottom - origin.y) / mm + 60);

    const L = this.layerFor(ctx);
    L.lineJoin = 'round';
    L.lineCap = 'round';
    // 1. La silhouette d'un seul bloc : contour de toutes les formes, puis leur remplissage
    //    par-dessus, si bien que le contour ne reste qu'à l'extérieur de la main.
    const order = [0, 4, 3, 2, 1];
    L.strokeStyle = SKIN.outline;
    L.lineWidth = Math.max(1.5, 1.1 * mm);
    for (const i of order) L.stroke(fingerPath(i));
    L.stroke(palm);
    L.fillStyle = SKIN.base;
    for (const i of order) L.fill(fingerPath(i));
    // Les doigts se séparent par un trait léger là où ils se touchent.
    L.strokeStyle = DARK(0.32);
    L.lineWidth = Math.max(0.8, 0.45 * mm);
    for (const i of order) L.stroke(fingerPath(i));
    // Le dos de la main recouvre la base des doigts et du pouce.
    L.fill(palm);

    // 2. Le modelé, posé seulement sur la main (source-atop).
    L.globalCompositeOperation = 'source-atop';
    const tipLine = P(0, -78);
    const wristLine = P(0, 95);
    const along = L.createLinearGradient(tipLine.x, tipLine.y, wristLine.x, wristLine.y);
    along.addColorStop(0, DARK(0.2)); // le bout des doigts plonge vers les touches
    along.addColorStop(0.32, LIGHT(0.05));
    along.addColorStop(0.45, LIGHT(0.16)); // les jointures, le plus haut de la main
    along.addColorStop(0.7, LIGHT(0));
    along.addColorStop(1, DARK(0.25)); // le poignet qui redescend
    L.fillStyle = along;
    L.fillRect(-1e4, -1e4, 2e4, 2e4);
    const radial = P(-46, 30);
    const ulnar = P(44, 30);
    const across = L.createLinearGradient(radial.x, radial.y, ulnar.x, ulnar.y);
    across.addColorStop(0, DARK(0.14));
    across.addColorStop(0.3, LIGHT(0.06));
    across.addColorStop(0.6, LIGHT(0));
    across.addColorStop(1, DARK(0.24)); // le bord de l'auriculaire, dans l'ombre
    L.fillStyle = across;
    L.fillRect(-1e4, -1e4, 2e4, 2e4);
    // Une arête claire le long de chaque doigt : il est rond.
    L.strokeStyle = LIGHT(0.16);
    for (const i of order) {
      const pts = fingerPoints[i];
      L.lineWidth = widths[i][1] * 0.32;
      L.beginPath();
      const a = pts[i === 0 ? 0 : 1];
      const b = pts[pts.length - 2];
      L.moveTo(a.x, a.y);
      L.lineTo(b.x, b.y);
      L.stroke();
    }
    // Les bosses des jointures et le creux entre pouce et index.
    for (const i of [1, 2, 3, 4]) {
      const k = P(MCP[i].x, MCP[i].y - 2);
      const r = widths[i][0] * 0.5;
      const glow = L.createRadialGradient(k.x, k.y, 0, k.x, k.y, r);
      glow.addColorStop(0, LIGHT(0.22));
      glow.addColorStop(1, LIGHT(0));
      L.fillStyle = glow;
      L.fillRect(k.x - r, k.y - r, 2 * r, 2 * r);
    }
    const web = P(-30, 18);
    const webShade = L.createRadialGradient(web.x, web.y, 0, web.x, web.y, 12 * mm);
    webShade.addColorStop(0, DARK(0.16));
    webShade.addColorStop(1, DARK(0));
    L.fillStyle = webShade;
    L.fillRect(web.x - 12 * mm, web.y - 12 * mm, 24 * mm, 24 * mm);

    // 3. Les détails : plis des articulations et ongles.
    L.globalCompositeOperation = 'source-over';
    for (const i of order) this.drawFingerDetails(L, fingerPoints[i], widths[i], i === 0);

    // 4. La main sur le clavier, avec son ombre portée.
    const dpr = ctx.getTransform().a || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8 * mm * dpr;
    ctx.shadowOffsetY = 3 * mm * dpr;
    ctx.drawImage(this.layer!, 0, 0);
    ctx.restore();

    // 5. Les halos et les numéros, nets, par-dessus.
    for (const i of order) this.drawMarks(ctx, fingerPoints[i], widths[i], state.fingers[i], hand, i + 1, alpha);
  }

  /**
   * Le pouce, comme une articulation à deux segments de longueur fixe : son articulation se
   * place là où les deux phalanges se rejoignent, du côté extérieur de la main.
   */
  private thumbStations(base: Point, tip: Point, side: number, mm: number): Point[] {
    const a = THUMB_SEGMENTS[0] * mm;
    const b = THUMB_SEGMENTS[1] * mm;
    const d = Math.hypot(tip.x - base.x, tip.y - base.y) || 1;
    const u = { x: (tip.x - base.x) / d, y: (tip.y - base.y) / d };
    let joint: Point;
    if (d >= a + b) {
      joint = { x: base.x + u.x * d * (a / (a + b)), y: base.y + u.y * d * (a / (a + b)) };
    } else {
      const angle = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
      const turn = (s: number) => {
        const c = Math.cos(s * angle);
        const n = Math.sin(s * angle);
        return { x: base.x + (u.x * c - u.y * n) * a, y: base.y + (u.x * n + u.y * c) * a };
      };
      const one = turn(1);
      const other = turn(-1);
      // Du côté extérieur : à gauche pour la main droite, à droite pour la gauche.
      joint = side * one.x < side * other.x ? one : other;
    }
    return [base, joint, { x: tip.x, y: tip.y }];
  }

  /** Plis de la peau sur les articulations, et l'ongle, petit et clair, au bout du doigt. */
  private drawFingerDetails(L: CanvasRenderingContext2D, pts: Point[], widths: number[], thumb: boolean): void {
    const n = pts.length;
    const tip = pts[n - 1];
    const tipWidth = widths[n - 1];
    const crease = (at: Point, dir: Point, width: number, shift: number) => {
      const nrm = { x: -dir.y, y: dir.x };
      const c = { x: at.x + dir.x * shift, y: at.y + dir.y * shift };
      L.beginPath();
      L.moveTo(c.x + nrm.x * width * 0.24, c.y + nrm.y * width * 0.24);
      L.quadraticCurveTo(c.x - dir.x * width * 0.08, c.y - dir.y * width * 0.08, c.x - nrm.x * width * 0.24, c.y - nrm.y * width * 0.24);
      L.stroke();
    };
    L.strokeStyle = SKIN.crease;
    L.lineWidth = 0.8;
    if (thumb) {
      crease(pts[1], unit(pts[0], pts[2]), widths[1], 0);
    } else {
      const dir = unit(pts[0], tip);
      for (const shift of [-0.1, 0.06]) crease(pts[1], dir, widths[1], shift * widths[1]);
      crease(pts[2], dir, widths[2], 0);
    }
    // L'ongle : un ovale clair, dans l'axe du doigt, un peu en retrait du bout.
    const dir = unit(pts[n - 2], tip);
    const length = tipWidth * (thumb ? 0.62 : 0.5);
    const width = tipWidth * (thumb ? 0.6 : 0.6);
    const back = tipWidth * 0.1 + length / 2;
    L.save();
    L.translate(tip.x - dir.x * back, tip.y - dir.y * back);
    L.rotate(Math.atan2(dir.y, dir.x));
    L.beginPath();
    L.ellipse(0, 0, length / 2, width / 2, 0, 0, Math.PI * 2);
    const nail = L.createLinearGradient(-length / 2, 0, length / 2, 0);
    nail.addColorStop(0, '#ecc6b9');
    nail.addColorStop(0.6, SKIN.nail);
    nail.addColorStop(1, '#faefea');
    L.fillStyle = nail;
    L.fill();
    L.strokeStyle = SKIN.nailEdge;
    L.lineWidth = 0.7;
    L.stroke();
    L.restore();
  }

  /** Le halo du doigt qui joue ou va jouer, et le numéro du doigt. */
  private drawMarks(
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    widths: number[],
    finger: FingerState,
    hand: Hand,
    number: number,
    alpha: number,
  ): void {
    const n = pts.length;
    const tip = pts[n - 1];
    const tipWidth = widths[n - 1];
    const dir = unit(pts[n - 2], tip);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (finger.pressed || finger.upcoming) {
      const pulse = finger.pressed ? 1 : 0.25 + 0.3 * Math.sin(performance.now() / 120);
      const pad = { x: tip.x - dir.x * tipWidth * 0.45, y: tip.y - dir.y * tipWidth * 0.45 };
      ctx.globalAlpha = alpha * pulse;
      ctx.strokeStyle = HAND_COLORS[hand];
      ctx.lineWidth = finger.pressed ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, tipWidth * (finger.pressed ? 0.62 : 0.55), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }
    if (widths[0] >= 9) {
      const at = number === 1 ? pts[1] : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      ctx.fillStyle = 'rgba(85, 42, 22, 0.65)';
      ctx.font = `700 ${Math.round(Math.min(12, widths[0] * 0.5))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(number), at.x, at.y);
    }
    ctx.restore();
  }
}

/** Un doigt effilé passant par `pts`, de largeur `widths`, arrondi au bout, au contour lisse. */
function limbPath(pts: Point[], widths: number[]): Path2D {
  const n = pts.length;
  const tipRadius = widths[n - 1] / 2;
  const last = unit(pts[n - 2], pts[n - 1]);
  // Le centre du bout arrondi est en retrait d'un rayon : la pulpe touche le point visé.
  const p = pts.map((q, k) => (k === n - 1 ? { x: q.x - last.x * tipRadius, y: q.y - last.y * tipRadius } : q));
  const normals = p.map((_, k) => {
    const d = unit(p[Math.max(0, k - 1)], p[Math.min(n - 1, k + 1)]);
    return { x: -d.y, y: d.x };
  });
  const left = p.map((q, k) => ({ x: q.x + (normals[k].x * widths[k]) / 2, y: q.y + (normals[k].y * widths[k]) / 2 }));
  const right = p.map((q, k) => ({ x: q.x - (normals[k].x * widths[k]) / 2, y: q.y - (normals[k].y * widths[k]) / 2 }));
  const path = new Path2D();
  path.moveTo(left[0].x, left[0].y);
  for (let k = 1; k < n - 1; k++) {
    path.quadraticCurveTo(left[k].x, left[k].y, (left[k].x + left[k + 1].x) / 2, (left[k].y + left[k + 1].y) / 2);
  }
  path.lineTo(left[n - 1].x, left[n - 1].y);
  const angle = Math.atan2(normals[n - 1].y, normals[n - 1].x);
  path.arc(p[n - 1].x, p[n - 1].y, tipRadius, angle, angle + Math.PI, true);
  for (let k = n - 2; k >= 1; k--) {
    path.quadraticCurveTo(right[k].x, right[k].y, (right[k].x + right[k - 1].x) / 2, (right[k].y + right[k - 1].y) / 2);
  }
  path.lineTo(right[0].x, right[0].y);
  path.closePath();
  return path;
}

/** Le dos de la main et le poignet, qui continuent sous le bord du dessin. */
function palmPath(P: (x: number, y: number) => Point, below: number): Path2D {
  const steps: Array<['M' | 'L', number, number] | ['Q', number, number, number, number]> = [
    ['M', 30, below],
    ['L', 24, 80], // le poignet, côté auriculaire
    ['Q', 37, 52, 39, 26], // le bord de la main
    ['Q', 41, 12, 35, 5], // la jointure de l'auriculaire
    ['Q', 28, -3, 19, -4], // l'arc des jointures
    ['Q', 10, -8, 0, -7],
    ['Q', -10, -8, -21, -4],
    ['Q', -29, -1, -30, 8], // le bord de l'index
    ['Q', -30, 12, -36, 18], // le creux entre index et pouce
    ['Q', -44, 34, -38, 56], // le gras du pouce
    ['Q', -32, 70, -27, 80], // le poignet, côté pouce
    ['L', -32, below],
  ];
  const path = new Path2D();
  for (const step of steps) {
    if (step[0] === 'Q') {
      const c = P(step[1], step[2]);
      const q = P(step[3], step[4]);
      path.quadraticCurveTo(c.x, c.y, q.x, q.y);
    } else {
      const q = P(step[1], step[2]);
      if (step[0] === 'M') path.moveTo(q.x, q.y);
      else path.lineTo(q.x, q.y);
    }
  }
  path.closePath();
  return path;
}

function unit(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function emptyHand(): HandState {
  return { anchor: null, turn: 0, fingers: Array.from({ length: 5 }, () => ({ x: 0, y: 0, pressed: false, upcoming: false, active: false, black: false })) };
}
