// Essai : mains en 3D (modèle « generic-hand » des WebXR Input Profiles, licence MIT).
// Toutes les longueurs sont en millimètres. Repère du monde : x le long du clavier,
// y vers le haut, z vers le pianiste. Le bord avant des touches blanches est en z = 0,
// leur dessus en y = 0.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const KEY = { whiteWidth: 23.5, whiteLength: 150, blackWidth: 13.7, blackLength: 95, blackHeight: 12, press: 7 };

export type Side = 'left' | 'right';
/** Une touche tenue par un doigt (1 = pouce … 5 = auriculaire). */
export interface Press { finger: number; x: number; black: boolean; down: boolean }
/** La touche visée par un doigt (x en mm), et s'il l'enfonce ou s'apprête à le faire. */
export interface FingerGoal { x: number; black: boolean; pressed: boolean; upcoming: boolean }
/** Le but d'une main : jointure du majeur, rotation, et une touche ou rien pour chaque doigt (pouce d'abord). */
export interface HandGoal { knuckleX: number; turn: number; fingers: Array<FingerGoal | null> }
/** Longueur des touches blanches et distance du bord avant au bout des touches noires (mm). */
export interface KeyGeometry { length: number; blackFront: number }
const BENCH_KEYS: KeyGeometry = { length: KEY.whiteLength, blackFront: KEY.whiteLength - KEY.blackLength };

const LONG_FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const LONG_JOINTS = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB_JOINTS = ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'];

const KNUCKLE_HEIGHT = 32; // jointures au-dessus du dessus des touches blanches
const NATURAL = { mcp: 0.2, pip: 0.7 }; // flexions naturelles (rad)
const DIP_RATIO = 0.45; // la dernière phalange suit la deuxième
const TIP_LIFT = 6; // le bout de l'os « tip » est à l'ongle, la pulpe est dessous
const HOVER = 16;
const ELBOW_HALF = 260;
const ELBOW_DISTANCE = 380;
const MAX_TURN = 0.25;
const WRIST_PITCH = 0.12;
const HAND_SPEED = 9;
const FINGER_SPEED = 16;
const FINGER_THIN = 0.84; // le modèle a des doigts de gant : on les affine sans changer leur longueur
const THUMB_THIN = 0.9;
const THUMB_NAIL_OUTWARD = 0.25; // vu de dessus, l'ongle du pouce regarde vers le haut et un peu vers l'extérieur
const THUMB_LONGER = 1.28; // pouce du modèle : 81 mm de la base au bout, contre 105 mm environ sur une vraie main

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);

interface Rest { p: THREE.Vector3; q: THREE.Quaternion }

export class Hand3D {
  readonly object = new THREE.Group();
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<string, Rest>(); // repère aligné, origine à la jointure du majeur
  private toModel = new THREE.Quaternion(); // inverse de l'alignement
  private origin = v3(); // jointure du majeur dans le repère du modèle (m)
  private naturalReach = new Map<string, number>();
  private forearm: THREE.Mesh;
  private knuckle: THREE.Vector3 | null = null;
  private tips: Array<THREE.Vector3 | null> = [null, null, null, null, null];
  private rings: THREE.Mesh[] = [];
  readonly materials: THREE.Material[] = [];
  private nails: { mesh: THREE.Mesh; bone: string; offset: THREE.Vector3; basis: THREE.Matrix4 }[] = [];

  constructor(readonly side: Side, gltf: { scene: THREE.Object3D }, material: THREE.Material) {
    const model = gltf.scene;
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        mesh.material = material;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      }
    });
    const pos = (n: string) => this.bones.get(n)!.position.clone();
    // Base du modèle : direction des doigts, côté du pouce. On l'envoie sur
    // doigts → -z, pouce → -x (main droite) ou +x (main gauche).
    this.origin = pos('middle-finger-phalanx-proximal');
    const forward = this.origin.clone().sub(pos('wrist')).normalize();
    const thumbward = pos('index-finger-phalanx-proximal').sub(pos('pinky-finger-phalanx-proximal'));
    thumbward.addScaledVector(forward, -thumbward.dot(forward)).normalize();
    const basis = new THREE.Matrix4().makeBasis(forward, thumbward, forward.clone().cross(thumbward));
    const wf = v3(0, 0, -1);
    const wt = v3(side === 'right' ? -1 : 1, 0, 0);
    const world = new THREE.Matrix4().makeBasis(wf, wt, wf.clone().cross(wt));
    const align = new THREE.Quaternion().setFromRotationMatrix(world.multiply(basis.transpose()));
    this.toModel.copy(align).invert();
    for (const [name, bone] of this.bones) {
      this.rest.set(name, {
        p: bone.position.clone().sub(this.origin).applyQuaternion(align).multiplyScalar(1000),
        q: align.clone().multiply(bone.quaternion),
      });
    }
    // Le modèle passe dans le repère du monde ; les os restent écrits dans le sien.
    this.object.add(model);
    model.scale.setScalar(1000);
    model.quaternion.copy(align);
    model.position.copy(this.origin).applyQuaternion(align).multiplyScalar(-1000);
    model.updateMatrixWorld(true);
    // Les os sont à plat sous l'armature et pointent selon -z : leur échelle en x et y affine la phalange,
    // en z elle l'allonge.
    for (const [name, bone] of this.bones) {
      const thumb = name.startsWith('thumb');
      if (!/phalanx|tip/.test(name) && !thumb) continue;
      const k = name === 'thumb-metacarpal' ? 1 : thumb ? THUMB_THIN : FINGER_THIN;
      bone.scale.set(k, k, thumb ? THUMB_LONGER : 1);
    }
    const thumb = THUMB_JOINTS.map((j) => this.rest.get(`thumb-${j}`)!.p);
    const segments = thumb.slice(1).map((p, i) => p.clone().sub(thumb[i]).multiplyScalar(THUMB_LONGER));
    segments.forEach((d, i) => thumb[i + 1].copy(thumb[i]).add(d));
    this.addNails(model, align);
    // Avant-bras : cache le bord coupé du poignet.
    const arm = new THREE.CylinderGeometry(24, 29, 260, 32, 1, true);
    arm.translate(0, 130 - 26, 0);
    arm.rotateX(Math.PI / 2);
    arm.scale(1.15, 0.8, 1);
    this.forearm = new THREE.Mesh(arm, material);
    this.forearm.castShadow = true;
    this.object.add(this.forearm);
    for (const f of LONG_FINGERS) this.naturalReach.set(f, this.chain(f, NATURAL.pip).reach);
    this.materials.push(material, this.nails[0].mesh.material as THREE.Material);
    const ring = new THREE.RingGeometry(8.5, 11, 32).rotateX(-Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(
        ring,
        new THREE.MeshBasicMaterial({ color: side === 'right' ? 0x4c9bff : 0xff9a3c, transparent: true, depthTest: false }),
      );
      mesh.renderOrder = 10;
      mesh.visible = false;
      this.rings.push(mesh);
      this.object.add(mesh);
    }
  }

  /** Main estompée : celle que joue l'app pendant que l'élève joue l'autre. */
  setOpacity(alpha: number) {
    for (const m of this.materials) {
      m.transparent = alpha < 1;
      m.opacity = alpha;
    }
  }

  /** Ongles : posés sur le dos de la dernière phalange, à la hauteur mesurée sur le maillage. */
  private addNails(model: THREE.Object3D, align: THREE.Quaternion) {
    let mesh: THREE.SkinnedMesh | undefined;
    model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    if (!mesh) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const idx = geo.getAttribute('skinIndex');
    const wgt = geo.getAttribute('skinWeight');
    const boneIndex = new Map(mesh.skeleton.bones.map((b, i) => [b.name, i]));
    const material = new THREE.MeshPhysicalMaterial({ color: 0xf1c9bd, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const shape = new THREE.SphereGeometry(1, 20, 10);
    for (const finger of ['thumb', ...LONG_FINGERS]) {
      const name = `${finger}-phalanx-distal`;
      const bone = boneIndex.get(name);
      const dir = this.rest.get(`${finger}-tip`)!.p.clone().sub(this.rest.get(name)!.p).normalize();
      const back = backOf(dir);
      const side = back.clone().cross(dir);
      const thumb = finger === 'thumb';
      const thin = thumb ? THUMB_THIN : FINGER_THIN;
      // Les sommets de la dernière phalange, dans le repère de l'os : le long du doigt, vers le dos, sur le côté.
      // L'articulation d'origine sert de base (le pouce a été allongé depuis).
      const joint = this.bones.get(name)!.position.clone().sub(this.origin).applyQuaternion(align).multiplyScalar(1000);
      const verts: Array<{ along: number; up: number; across: number }> = [];
      for (let i = 0; i < pos.count; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (idx.getComponent(i, k) === bone) w += wgt.getComponent(i, k);
        if (w < 0.5) continue;
        const p = v3(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(this.origin).applyQuaternion(align).multiplyScalar(1000).sub(joint);
        verts.push({ along: p.dot(dir) * (thumb ? THUMB_LONGER : 1), up: p.dot(back) * thin, across: p.dot(side) * thin });
      }
      if (verts.length === 0) continue;
      // L'ongle finit un peu avant le bout du doigt, et s'appuie sur le dos de la phalange à cet endroit.
      const end = Math.max(...verts.map((v) => v.along));
      const length = thumb ? 11 : 9.5;
      const center = end - length / 2 - (thumb ? 4.5 : 2.5);
      const slice = verts.filter((v) => Math.abs(v.along - center) < 3.5);
      // L'os ne passe pas au milieu de la phalange : l'ongle se centre sur le dessus réel du doigt.
      const height = Math.max(...slice.map((v) => v.up));
      const top = slice.filter((v) => v.up > height - 2.5);
      const middle = top.reduce((sum, v) => sum + v.across, 0) / top.length;
      const width = (Math.max(...slice.map((v) => v.across)) - Math.min(...slice.map((v) => v.across))) / 2;
      const dorsal = verts.filter((v) => v.up > height * 0.3);
      const skin = (along: number, across: number) => skinHeight(dorsal, along, across);
      const nail = new THREE.Mesh(nailShape(shape, width * 0.6, length / 2, (x, z) => skin(center + z, middle + x) - height), material);
      nail.matrixAutoUpdate = false;
      this.object.add(nail);
      const offset = dir.clone().multiplyScalar(center).addScaledVector(back, height).addScaledVector(side, middle);
      this.nails.push({ mesh: nail, bone: name, offset, basis: new THREE.Matrix4().makeBasis(side, back, dir) });
    }
  }

  private len(a: string, b: string) {
    return this.rest.get(a)!.p.distanceTo(this.rest.get(b)!.p);
  }

  /** Forme d'un doigt dans son plan (flexion de la jointure nulle) pour une flexion donnée de l'articulation du milieu. */
  private chain(finger: string, pip: number) {
    const L = [0, 1, 2].map((i) => this.len(`${finger}-${LONG_JOINTS[i]}`, `${finger}-${LONG_JOINTS[i + 1]}`));
    const angles = [0, pip, pip * (1 + DIP_RATIO)];
    let h = 0;
    let v = 0;
    for (let i = 0; i < 3; i++) {
      h += L[i] * Math.cos(angles[i] + NATURAL.mcp);
      v += L[i] * Math.sin(angles[i] + NATURAL.mcp);
    }
    let hx = 0;
    let vy = 0;
    for (let i = 0; i < 3; i++) {
      hx += L[i] * Math.cos(angles[i]);
      vy += L[i] * Math.sin(angles[i]);
    }
    return { L, angles, reach: h, drop: v, dist: Math.hypot(hx, vy), dir: Math.atan2(vy, hx) };
  }

  /** Banc d'essai : pose la main d'un coup sur des touches tenues. */
  pose(presses: Press[], centerX: number) {
    const sign = this.side === 'right' ? 1 : -1;
    const restX = (f: number) => this.rest.get(fingerJoint(f, 'phalanx-proximal'))!.p.x;
    // Placement : la jointure de chaque doigt au-dessus de sa touche, en moyenne.
    let x = 0;
    for (const p of presses) x += p.x - (p.finger === 1 ? restX(2) - sign * 18 : restX(p.finger));
    const knuckleX = presses.length ? x / presses.length : centerX + sign * 90;
    const elbowX = centerX + sign * ELBOW_HALF;
    const turn = THREE.MathUtils.clamp(Math.atan2(knuckleX - elbowX, ELBOW_DISTANCE), -MAX_TURN, MAX_TURN);
    const fingers: HandGoal['fingers'] = [null, null, null, null, null];
    for (const p of presses) fingers[p.finger - 1] = { x: p.x, black: p.black, pressed: p.down, upcoming: false };
    this.knuckle = null;
    this.drive({ knuckleX, turn, fingers }, BENCH_KEYS, 0);
  }

  /**
   * Pose la main vers un but : jointure du majeur en `knuckleX`, rotation `turn`, et pour
   * chaque doigt sa touche. `dt` > 0 lisse le mouvement, 0 le fait d'un coup.
   */
  drive(goal: HandGoal, keys: KeyGeometry, dt: number) {
    const sign = this.side === 'right' ? 1 : -1;
    const ease = (speed: number) => (dt > 0 ? Math.min(1, dt * speed) : 1);
    // Profondeur : la main avance quand les doigts vont sur les touches noires.
    const active = goal.fingers.filter((f) => f !== null);
    const depth = active.length
      ? active.reduce((sum, f) => sum + (f!.black ? -(keys.blackFront + 30) : -45), 0) / active.length
      : -45;
    const goalKnuckle = v3(goal.knuckleX, KNUCKLE_HEIGHT, depth + this.naturalReach.get('middle-finger')!);
    if (!this.knuckle || dt === 0 || this.knuckle.distanceTo(goalKnuckle) > 300) this.knuckle = goalKnuckle;
    else this.knuckle.lerp(goalKnuckle, ease(HAND_SPEED));
    const knuckle = this.knuckle;
    const hq = new THREE.Quaternion()
      .setFromAxisAngle(UP, -goal.turn)
      .multiply(new THREE.Quaternion().setFromAxisAngle(v3(1, 0, 0), WRIST_PITCH));
    const world = new Map<string, { p: THREE.Vector3; q: THREE.Quaternion }>();
    const palm = (name: string) => knuckle.clone().add(this.rest.get(name)!.p.clone().applyQuaternion(hq));
    for (const name of this.rest.keys()) world.set(name, { p: palm(name), q: hq.clone().multiply(this.rest.get(name)!.q) });

    // Où va chaque bout de doigt, lissé pour que les doigts glissent d'une touche à l'autre.
    const surface = (f: FingerGoal) => (f.black ? KEY.blackHeight : 0) - (f.pressed ? KEY.press : 0) + (f.upcoming ? 8 : 0) + TIP_LIFT;
    const goals = goal.fingers.map((f, i) => {
      if (i === 0) {
        const restTip = palm('thumb-tip');
        return f
          ? v3(f.x, surface(f), f.black ? -(keys.blackFront + 17) : -22)
          : restTip.setY(HOVER).lerp(world.get('index-finger-phalanx-proximal')!.p.clone().setY(HOVER), 0.25).setZ(Math.min(restTip.z, -14));
      }
      const finger = LONG_FINGERS[i - 1];
      const mcp = world.get(`${finger}-phalanx-proximal`)!.p;
      return f ? this.keyTarget(mcp, f, surface(f), keys, this.naturalReach.get(finger)!) : this.hoverTarget(mcp, hq, finger);
    });
    goals.forEach((g, i) => {
      if (!this.tips[i] || dt === 0) this.tips[i] = g.clone();
      else this.tips[i]!.lerp(g, ease(FINGER_SPEED));
    });

    // Doigts longs.
    LONG_FINGERS.forEach((finger, i) => {
      const names = LONG_JOINTS.map((j) => `${finger}-${j}`);
      const mcp = world.get(names[0])!.p;
      this.orient(world, names, this.solveFinger(finger, mcp, this.tips[i + 1]!), hq);
    });

    // Pouce : le métacarpe pivote vers la touche, puis deux segments.
    const names = THUMB_JOINTS.map((j) => `thumb-${j}`);
    const cmc = world.get(names[0])!.p;
    const target = this.tips[0]!.clone();
    const a = this.len(names[1], names[2]);
    const b = this.len(names[2], names[3]);
    const restMeta = palm(names[1]).sub(cmc);
    const toTarget = target.clone().sub(cmc).normalize();
    // Le métacarpe pivote juste assez pour que les deux phalanges atteignent la touche.
    let mcp = cmc;
    for (let k = 0.3; k <= 1.001; k += 0.05) {
      const meta = restMeta.clone().normalize().lerp(toTarget, k).normalize().multiplyScalar(restMeta.length());
      mcp = cmc.clone().add(meta);
      if (mcp.distanceTo(target) < (a + b) * 0.97) break;
    }
    // Hors de portée : le pouce se pose plus près du bord de la touche.
    const reach = (a + b) * 0.97;
    const dx = target.x - mcp.x;
    const dy = target.y - mcp.y;
    if (mcp.distanceTo(target) > reach && reach * reach > dx * dx + dy * dy) {
      target.z = Math.max(target.z, mcp.z - Math.sqrt(reach * reach - dx * dx - dy * dy));
    }
    const outward = v3(-sign, 0, 0).applyQuaternion(hq);
    const pole = UP.clone().add(outward.multiplyScalar(0.6)).normalize();
    const ip = twoBone(mcp, target, a, b, pole);
    const thumbBack = UP.clone().add(v3(-sign * THUMB_NAIL_OUTWARD, 0, 0).applyQuaternion(hq));
    this.orient(world, names, [cmc, mcp, ip, ip.clone().add(target.clone().sub(ip).normalize().multiplyScalar(b))], hq, thumbBack);

    // Halo du doigt qui joue ou va jouer, sur la touche.
    this.rings.forEach((ring, i) => {
      const f = goal.fingers[i];
      ring.visible = !!f && (f.pressed || f.upcoming);
      if (!f || !ring.visible) return;
      const tip = this.tips[i]!;
      ring.position.set(tip.x, f.black ? KEY.blackHeight : 0, tip.z + (i === 0 ? 0 : 4));
      (ring.material as THREE.MeshBasicMaterial).opacity = f.pressed ? 0.9 : 0.25 + 0.3 * Math.sin(performance.now() / 120);
      ring.scale.setScalar(f.pressed ? 1 : 0.9);
    });

    const wrist = world.get('wrist')!.p;
    this.forearm.position.copy(wrist);
    this.forearm.lookAt(wrist.clone().add(wrist.clone().sub(knuckle)));

    // Les ongles suivent la rotation de la dernière phalange depuis la pose de repos.
    for (const nail of this.nails) {
      const w = world.get(nail.bone)!;
      const delta = w.q.clone().multiply(this.rest.get(nail.bone)!.q.clone().invert());
      nail.mesh.matrix
        .makeRotationFromQuaternion(delta)
        .multiply(nail.basis)
        .setPosition(nail.offset.clone().applyQuaternion(delta).add(w.p));
      nail.mesh.matrixWorldNeedsUpdate = true;
    }

    // Écrit les os dans le repère du modèle.
    for (const [name, bone] of this.bones) {
      const w = world.get(name)!;
      bone.position.copy(w.p).multiplyScalar(0.001).applyQuaternion(this.toModel).add(this.origin);
      bone.quaternion.copy(this.toModel).multiply(w.q);
    }
  }

  private keyTarget(mcp: THREE.Vector3, f: FingerGoal, y: number, keys: KeyGeometry, reach: number) {
    const dx = f.x - mcp.x;
    const natural = mcp.z - Math.sqrt(Math.max(0, reach * reach - dx * dx));
    const z = f.black
      ? THREE.MathUtils.clamp(natural, -(keys.length - 10), -(keys.blackFront + 13))
      : THREE.MathUtils.clamp(natural, -keys.blackFront, -10);
    return v3(f.x, y, z);
  }

  private hoverTarget(mcp: THREE.Vector3, hq: THREE.Quaternion, finger: string) {
    const reach = this.naturalReach.get(finger)! * 0.95;
    return mcp.clone().add(v3(0, 0, -reach).applyQuaternion(hq)).setY(HOVER + TIP_LIFT);
  }

  /** Doigt plan : on cherche la flexion du milieu qui donne la bonne distance, puis l'angle de la jointure. */
  private solveFinger(finger: string, mcp: THREE.Vector3, target: THREE.Vector3) {
    const flat = target.clone().sub(mcp).setY(0);
    const h = flat.length();
    const e = h > 1e-6 ? flat.divideScalar(h) : v3(0, 0, -1);
    const drop = mcp.y - target.y;
    const d = Math.hypot(h, drop);
    let lo = 0;
    let hi = 1.9;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (this.chain(finger, mid).dist > d) lo = mid;
      else hi = mid;
    }
    const c = this.chain(finger, lo);
    const mcpFlex = Math.atan2(drop, h) - c.dir;
    const pts = [mcp.clone()];
    for (let i = 0; i < 3; i++) {
      const a = mcpFlex + c.angles[i];
      pts.push(pts[i].clone().addScaledVector(e, c.L[i] * Math.cos(a)).addScaledVector(UP, -c.L[i] * Math.sin(a)));
    }
    return pts;
  }

  /** Oriente chaque os pour qu'il pointe vers l'articulation suivante. */
  private orient(
    world: Map<string, { p: THREE.Vector3; q: THREE.Quaternion }>,
    names: string[],
    pts: THREE.Vector3[],
    hq: THREE.Quaternion,
    dorsal?: THREE.Vector3,
  ) {
    for (let i = 0; i < names.length; i++) {
      const w = world.get(names[i])!;
      w.p.copy(pts[i]);
      const j = Math.min(i, names.length - 2);
      const restAxis = this.rest.get(names[j + 1])!.p.clone().sub(this.rest.get(names[j])!.p).normalize();
      const restDir = restAxis.clone().applyQuaternion(hq);
      const dir = pts[j + 1].clone().sub(pts[j]).normalize();
      w.q.copy(new THREE.Quaternion().setFromUnitVectors(restDir, dir).multiply(hq).multiply(this.rest.get(names[i])!.q));
      // Le pouce tourne sur lui-même : on le roule pour que son dos (l'ongle) regarde vers `dorsal`.
      if (!dorsal || i === 0) continue;
      const delta = w.q.clone().multiply(this.rest.get(names[i])!.q.clone().invert());
      const now = backOf(restAxis).applyQuaternion(delta);
      const want = dorsal.clone().addScaledVector(dir, -dorsal.dot(dir)).normalize();
      const angle = Math.atan2(now.clone().cross(want).dot(dir), now.dot(want));
      w.q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, angle));
    }
  }
}

/** Un ongle : ellipsoïde aplati, bombé en travers et qui plonge vers le bout, comme le doigt dessous. */
/** Un ongle mince moulé sur la peau : `surface(x, z)` donne la hauteur de la peau sous chaque point. */
function nailShape(
  sphere: THREE.BufferGeometry,
  halfWidth: number,
  halfLength: number,
  surface: (x: number, z: number) => number,
) {
  const geo = sphere.clone().scale(halfWidth, 0.45, halfLength);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) + surface(pos.getX(i), pos.getZ(i)) + 0.75);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Hauteur de la peau au-dessus de l'os, interpolée entre les sommets voisins du maillage. */
function skinHeight(verts: Array<{ along: number; up: number; across: number }>, along: number, across: number) {
  let sum = 0;
  let weights = 0;
  for (const v of verts) {
    const d2 = (v.along - along) ** 2 + (v.across - across) ** 2;
    const w = 1 / (d2 * d2 + 0.01);
    sum += w * v.up;
    weights += w;
  }
  return weights > 0 ? sum / weights : 0;
}

/** Le dos d'une phalange dans la pose de repos alignée (paume vers le bas) : vers le haut, perpendiculaire à l'os. */
function backOf(axis: THREE.Vector3) {
  return UP.clone().addScaledVector(axis, -axis.y).normalize();
}

function fingerJoint(finger: number, joint: string) {
  return `${['thumb', ...LONG_FINGERS][finger - 1]}-${joint}`;
}

/** Deux segments de longueurs a et b, de `base` à `target`, le coude du côté de `pole`. */
function twoBone(base: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3) {
  const axis = target.clone().sub(base);
  const d = Math.min(axis.length(), a + b - 1e-3);
  axis.normalize();
  const side = pole.clone().addScaledVector(axis, -pole.dot(axis)).normalize();
  const along = (a * a - b * b + d * d) / (2 * d);
  const up = Math.sqrt(Math.max(0, a * a - along * along));
  return base.clone().addScaledVector(axis, along).addScaledVector(side, up);
}

export async function loadHands() {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL;
  const [left, right] = await Promise.all([
    loader.loadAsync(`${base}hands3d/left.glb`),
    loader.loadAsync(`${base}hands3d/right.glb`),
  ]);
  return { left: new Hand3D('left', left, skinMaterial()), right: new Hand3D('right', right, skinMaterial()) };
}

export function skinMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xe2b294,
    roughness: 0.62,
    sheen: 0.5,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0xff9a7a),
  });
}

/** Les lumières communes au banc d'essai et à l'app : ciel, soleil avec ombres douces. */
export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b5a4a, 1.4));
  const sun = new THREE.DirectionalLight(0xfff4e8, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  return sun;
}

/** Ce que l'app passe à la surcouche, en pixels comme le reste du dessin. */
export interface OverlayHand {
  anchor: number;
  turn: number;
  alpha: number;
  fingers: Array<{ x: number; black: boolean; active: boolean; pressed: boolean; upcoming: boolean }>;
}
export interface OverlayGeometry {
  whiteWidth: number;
  keyboardTop: number;
  keyboardHeight: number;
  blackKeyHeight: number;
  centerX: number;
}

/**
 * Les mains 3D dans l'app : un canevas WebGL transparent posé sur le canevas 2D, avec une
 * caméra orthographique calée sur le clavier dessiné en dessous (1 mm = largeur d'une touche / 23,5).
 */
export class Hands3DOverlay {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 3000);
  private sun: THREE.DirectionalLight;
  private shown = false;
  private last = performance.now();

  private constructor(
    readonly canvas: HTMLCanvasElement,
    private hands: { left: Hand3D; right: Hand3D },
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.sun = addLights(this.scene);
    // Le clavier reste en 2D ; ce plan invisible ne garde que l'ombre des mains.
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1e4, 1e4), new THREE.ShadowMaterial({ opacity: 0.22 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.receiveShadow = true;
    this.scene.add(catcher, hands.left.object, hands.right.object);
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(0, 1000, 0);
    this.camera.lookAt(0, 0, 0);
  }

  static async create(under: HTMLCanvasElement) {
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    under.after(canvas);
    return new Hands3DOverlay(canvas, await loadHands());
  }

  render(geo: OverlayGeometry, hands: Record<Side, OverlayHand | null>) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const dpr = devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
    }
    const mm = geo.whiteWidth / KEY.whiteWidth;
    const front = geo.keyboardTop + geo.keyboardHeight;
    Object.assign(this.camera, { left: 0, right: w / mm, top: front / mm, bottom: -(h - front) / mm });
    this.camera.updateProjectionMatrix();
    const center = w / mm / 2;
    this.sun.position.set(center - 250, 600, 350);
    this.sun.target.position.set(center, 0, -40);
    Object.assign(this.sun.shadow.camera, { left: -w / mm, right: w / mm, top: 400, bottom: -400, near: 10, far: 2000 });
    this.sun.shadow.camera.updateProjectionMatrix();
    const keys: KeyGeometry = { length: geo.keyboardHeight / mm, blackFront: (geo.keyboardHeight - geo.blackKeyHeight) / mm };
    for (const side of ['left', 'right'] as Side[]) {
      const state = hands[side];
      const hand = this.hands[side];
      hand.object.visible = !!state;
      if (!state) continue;
      hand.setOpacity(state.alpha);
      hand.drive(
        {
          knuckleX: state.anchor / mm,
          turn: state.turn,
          fingers: state.fingers.map((f) => (f.active ? { x: f.x / mm, black: f.black, pressed: f.pressed, upcoming: f.upcoming } : null)),
        },
        keys,
        this.shown ? dt : 0,
      );
    }
    this.renderer.render(this.scene, this.camera);
    this.shown = true;
  }

  clear() {
    if (!this.shown) return;
    this.renderer.clear();
    this.shown = false;
  }
}
