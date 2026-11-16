// Low-poly box humanoids (N64 style) with procedural animation.
import * as THREE from 'three';
import { tex } from '../core/textures';

export type Outfit = 'merc' | 'heavy' | 'officer' | 'scientist' | 'sniper';

export interface Rig {
  root: THREE.Group;      // at feet, rotates with yaw
  body: THREE.Group;      // hips pivot (falls on death)
  torso: THREE.Group;
  head: THREE.Mesh;
  armL: THREE.Group; armR: THREE.Group;
  foreL: THREE.Group; foreR: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  shinL: THREE.Group; shinR: THREE.Group;
  gun: THREE.Group;
  muzzle: THREE.Object3D;
  light: THREE.Group;
  helmet?: THREE.Mesh;
  mats: THREE.MeshLambertMaterial[];
}

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function mat(key: string, make: () => THREE.MeshLambertMaterial) {
  let m = matCache.get(key);
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
}

function box(w: number, h: number, d: number, m: THREE.Material | THREE.Material[], y = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

export function buildGunModel(kind: 'rifle' | 'smg' | 'shotgun' | 'pistol' | 'sniper'): THREE.Group {
  const g = new THREE.Group();
  const dark = mat('gun_dark', () => new THREE.MeshLambertMaterial({ color: 0x222326 }));
  const wood = mat('gun_wood', () => new THREE.MeshLambertMaterial({ color: 0x6b3d1f }));
  const len = kind === 'pistol' ? 0.18 : kind === 'smg' ? 0.45 : kind === 'sniper' ? 0.95 : 0.75;
  const body = box(0.06, 0.09, len, dark);
  body.position.z = len / 2 - 0.1;
  g.add(body);
  if (kind !== 'pistol') {
    const stock = box(0.05, 0.08, 0.22, kind === 'rifle' ? wood : dark);
    stock.position.set(0, -0.02, -0.2);
    g.add(stock);
    const mag = box(0.04, 0.16, 0.06, dark);
    mag.position.set(0, -0.11, len * 0.3);
    mag.rotation.x = kind === 'rifle' ? 0.35 : 0;
    g.add(mag);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.z = len - 0.08;
  muzzle.name = 'muzzle';
  g.add(muzzle);
  return g;
}

export function buildHumanoid(outfit: Outfit): Rig {
  const uniformTex = outfit === 'scientist' ? 'labcoat' : outfit === 'heavy' || outfit === 'sniper' ? 'camo_dark' : 'camo_winter';
  const uniform = mat('u_' + uniformTex, () => new THREE.MeshLambertMaterial({ map: tex(uniformTex) }));
  const pants = mat('p_' + outfit, () => new THREE.MeshLambertMaterial(outfit === 'scientist' ? { color: 0x3a3e48 } : { map: tex(uniformTex), color: 0xbbbbbb }));
  const skin = mat('skin', () => new THREE.MeshLambertMaterial({ color: outfit === 'scientist' ? 0xd9a689 : 0xc99272 }));
  const boots = mat('boots', () => new THREE.MeshLambertMaterial({ color: 0x1d1a17 }));
  const vest = mat('vest', () => new THREE.MeshLambertMaterial({ color: 0x3b4234 }));
  const gloves = mat('gloves', () => new THREE.MeshLambertMaterial({ color: 0x202020 }));
  const faceKind = outfit === 'scientist' ? 'scientist' : outfit === 'officer' ? 'officer' : outfit === 'heavy' || outfit === 'sniper' ? 'balaclava' : 'merc';
  const face = mat('face_' + faceKind, () => new THREE.MeshLambertMaterial({ map: tex('face_' + faceKind) }));
  const headSide = faceKind === 'balaclava' ? mat('bala', () => new THREE.MeshLambertMaterial({ color: 0x1c1e1f })) : faceKind === 'scientist' ? mat('hairgrey', () => new THREE.MeshLambertMaterial({ color: 0x8a8a8a })) : mat('hair', () => new THREE.MeshLambertMaterial({ color: 0x3a2a1c }));

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.92;
  root.add(body);

  const torso = new THREE.Group();
  body.add(torso);
  const chest = box(0.46, 0.6, 0.26, outfit === 'scientist' ? uniform : uniform, 0.3);
  torso.add(chest);
  if (outfit !== 'scientist') {
    const v = box(0.5, 0.38, 0.3, vest, 0.36);
    torso.add(v);
    for (let i = -1; i <= 1; i++) {
      const pouch = box(0.1, 0.12, 0.06, vest, 0.3);
      pouch.position.set(i * 0.13, 0, 0.17);
      torso.add(pouch);
    }
  } else {
    const coatTail = box(0.48, 0.35, 0.28, uniform, -0.1);
    torso.add(coatTail);
  }
  const hips = box(0.42, 0.18, 0.24, pants, -0.02);
  body.add(hips);

  // head: front face texture on +z
  const headMats = [headSide, headSide, headSide, skin, face, headSide];
  const head = box(0.24, 0.27, 0.25, headMats);
  head.position.y = 0.76;
  torso.add(head);
  let helmet: THREE.Mesh | undefined;
  if (outfit === 'merc' || outfit === 'heavy') {
    const hm = mat('helmet', () => new THREE.MeshLambertMaterial({ color: outfit === 'heavy' ? 0x2c3128 : 0xc8ccd0 }));
    helmet = box(0.29, 0.12, 0.3, hm);
    helmet.position.set(0, 0.92, -0.01);
    torso.add(helmet);
  } else if (outfit === 'officer') {
    const cap = mat('cap', () => new THREE.MeshLambertMaterial({ color: 0x2e3a2a }));
    helmet = box(0.3, 0.08, 0.34, cap);
    helmet.position.set(0, 0.92, 0.03);
    torso.add(helmet);
  } else if (outfit === 'sniper') {
    const hood = mat('hood', () => new THREE.MeshLambertMaterial({ color: 0xd0d4d8 }));
    helmet = box(0.3, 0.14, 0.3, hood);
    helmet.position.set(0, 0.9, -0.02);
    torso.add(helmet);
  }

  const mkArm = (side: number) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.3, 0.56, 0);
    torso.add(arm);
    const upper = box(0.13, 0.32, 0.13, uniform, -0.16);
    arm.add(upper);
    const fore = new THREE.Group();
    fore.position.y = -0.32;
    arm.add(fore);
    const lower = box(0.11, 0.3, 0.11, uniform, -0.15);
    fore.add(lower);
    const hand = box(0.1, 0.1, 0.1, outfit === 'scientist' ? skin : gloves, -0.33);
    fore.add(hand);
    return { arm, fore };
  };
  const L = mkArm(-1), R = mkArm(1);

  const mkLeg = (side: number) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.12, -0.06, 0);
    body.add(leg);
    const thigh = box(0.17, 0.44, 0.18, pants, -0.22);
    leg.add(thigh);
    const shin = new THREE.Group();
    shin.position.y = -0.44;
    leg.add(shin);
    const calf = box(0.15, 0.4, 0.16, pants, -0.2);
    shin.add(calf);
    const boot = box(0.16, 0.12, 0.26, boots, -0.4);
    boot.position.z = 0.04;
    shin.add(boot);
    return { leg, shin };
  };
  const LL = mkLeg(-1), LR = mkLeg(1);

  const gunKind = outfit === 'heavy' ? 'shotgun' : outfit === 'officer' ? 'pistol' : outfit === 'sniper' ? 'sniper' : 'rifle';
  const gun = buildGunModel(gunKind as any);
  gun.position.set(0.12, 0.38, 0.2);
  if (outfit !== 'scientist') torso.add(gun);
  const muzzle = gun.getObjectByName('muzzle')!;
  const light = new THREE.Group();
  light.position.set(0.0, 0.05, 0.3);
  gun.add(light);

  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });

  return {
    root, body, torso, head, helmet,
    armL: L.arm, armR: R.arm, foreL: L.fore, foreR: R.fore,
    legL: LL.leg, legR: LR.leg, shinL: LL.shin, shinR: LR.shin,
    gun, muzzle, light, mats: [],
  };
}

export interface AnimState {
  speed: number;      // m/s
  phase: number;      // walk phase accumulator
  aim: number;        // 0..1 weapon raised
  crouch: number;     // 0..1
  pitch: number;      // aim pitch
  recoil: number;
  flinch: number;
  handsUp: number;    // surrender pose (scientists)
  dead: number;       // 0..1 death progress
  deathDir: number;   // +1 forward, -1 backward
  deathTwist: number;
  talk: number;
  lookYaw: number;
}

export function newAnim(): AnimState {
  return { speed: 0, phase: Math.random() * 10, aim: 0, crouch: 0, pitch: 0, recoil: 0, flinch: 0, handsUp: 0, dead: 0, deathDir: -1, deathTwist: 0, talk: 0, lookYaw: 0 };
}

export function animate(r: Rig, a: AnimState, dt: number) {
  a.phase += dt * (a.speed * 2.6 + 0.0001);
  const sw = Math.sin(a.phase) * Math.min(1, a.speed / 3.5) * (1 - a.crouch * 0.5);
  const run = Math.min(1, a.speed / 5);
  const legSwing = sw * (0.6 + run * 0.35);
  const c = a.crouch;

  if (a.dead > 0) {
    // collapse: fall around the feet, limbs go limp
    const t = Math.min(1, a.dead);
    const e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
    r.body.rotation.x = a.deathDir * e * (Math.PI / 2 - 0.08);
    r.body.rotation.z = a.deathTwist * e;
    r.body.position.y = 0.92 - e * 0.74;
    r.body.position.z = -a.deathDir * e * 0.15;
    r.legL.rotation.x = -a.deathDir * e * 0.2; r.legR.rotation.x = -a.deathDir * e * 0.35;
    r.shinL.rotation.x = e * 0.3; r.shinR.rotation.x = e * 0.1;
    r.armL.rotation.x = -a.deathDir * e * 1.8; r.armR.rotation.x = -a.deathDir * e * 1.4;
    r.armL.rotation.z = -e * 0.4; r.armR.rotation.z = e * 0.6;
    r.foreL.rotation.x = 0; r.foreR.rotation.x = 0;
    r.torso.rotation.set(0, 0, 0);
    r.head.rotation.x = a.deathDir * e * 0.3;
    r.gun.visible = false;
    return;
  }
  r.gun.visible = true;
  // body height / crouch
  r.body.position.y = 0.92 - c * 0.42 + Math.abs(Math.cos(a.phase)) * 0.03 * run;
  r.body.position.z = 0;
  r.body.rotation.x = c * 0.25 + run * 0.12;
  r.body.rotation.z = 0;
  r.legL.rotation.x = legSwing - c * 1.25;
  r.legR.rotation.x = -legSwing - c * 1.25;
  r.shinL.rotation.x = Math.max(0, -Math.sin(a.phase + 0.8)) * 0.9 * Math.min(1, a.speed / 2) + c * 2.0;
  r.shinR.rotation.x = Math.max(0, Math.sin(a.phase + 0.8)) * 0.9 * Math.min(1, a.speed / 2) + c * 2.0;

  a.recoil = Math.max(0, a.recoil - dt * 8);
  a.flinch = Math.max(0, a.flinch - dt * 4);
  r.torso.rotation.x = -c * 0.2 - a.flinch * 0.4 - a.recoil * 0.12;
  r.torso.rotation.y = a.lookYaw + Math.sin(a.phase) * 0.06 * run;
  r.torso.rotation.z = a.flinch * 0.2;
  r.head.rotation.x = -a.pitch * 0.5;

  if (a.handsUp > 0.01) {
    const h = a.handsUp;
    r.armL.rotation.set(0, 0, -h * 2.6); r.armR.rotation.set(0, 0, h * 2.6);
    r.foreL.rotation.x = 0; r.foreR.rotation.x = 0;
    return;
  }
  // arms: weapon held (aim blend) vs relaxed swing
  const aim = a.aim;
  const relaxL = -sw * 0.6, relaxR = sw * 0.6;
  const holdPitch = -1.2 - a.pitch;
  r.armR.rotation.x = relaxR * (1 - aim) + (-0.55 + holdPitch * 0.6) * aim - a.recoil * 0.25 + (1 - aim) * -0.5 * 0.4;
  r.armR.rotation.y = 0;
  r.armR.rotation.z = 0.1 * (1 - aim);
  r.foreR.rotation.x = -0.4 * (1 - aim) - 0.8 * aim;
  r.armL.rotation.x = relaxL * (1 - aim) + (-1.15 + holdPitch * 0.4) * aim;
  r.armL.rotation.y = 0.5 * aim;
  r.armL.rotation.z = -0.1 * (1 - aim);
  r.foreL.rotation.x = -0.3 * (1 - aim) - 0.5 * aim;
  // gun follows: low-ready vs raised
  r.gun.position.set(0.12, 0.3 + aim * 0.1, 0.18 + aim * 0.1);
  r.gun.rotation.x = (1 - aim) * 0.7 - a.pitch * aim - a.recoil * 0.3;
  r.gun.rotation.y = (1 - aim) * -0.3;
}
