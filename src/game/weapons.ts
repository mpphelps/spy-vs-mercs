// Weapon definitions + first-person viewmodels.
import * as THREE from 'three';
import { tex } from '../core/textures';

export type WeaponId = 'knife' | 'sp9' | 'kr5' | 'ar74' | 'ks12' | 'vs9';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  desc: string;
  damage: number;
  pellets: number;
  rpm: number;
  auto: boolean;
  mag: number;
  reserveMax: number;
  hipSpread: number;  // degrees
  adsSpread: number;
  recoil: number;     // degrees pitch per shot
  recoilYaw: number;
  noise: number;      // meters heard
  sound: string;
  suppressed: boolean;
  reload: number;
  adsFov: number;
  headMult: number;
  range: number;
  tracerEvery: number;
  pump?: boolean;
  shellReload?: boolean;
  ammoType: string;
  scope?: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  knife: { id: 'knife', name: 'COMBAT KNIFE', desc: 'Silent. Lethal up close.', damage: 60, pellets: 1, rpm: 100, auto: false, mag: 0, reserveMax: 0, hipSpread: 0, adsSpread: 0, recoil: 0, recoilYaw: 0, noise: 0, sound: 'swing', suppressed: true, reload: 0, adsFov: 75, headMult: 1, range: 1.8, tracerEvery: 0, ammoType: '' },
  sp9: { id: 'sp9', name: 'SP-9 SUPPRESSED', desc: 'Silenced 9mm sidearm. Headshots kill.', damage: 30, pellets: 1, rpm: 380, auto: false, mag: 12, reserveMax: 72, hipSpread: 1.6, adsSpread: 0.25, recoil: 1.4, recoilYaw: 0.4, noise: 5, sound: 'pistol_sup', suppressed: true, reload: 1.5, adsFov: 58, headMult: 4, range: 120, tracerEvery: 0, ammoType: '9mm' },
  kr5: { id: 'kr5', name: 'KR-5 SMG', desc: 'Compact 9mm SMG. Fast and loud.', damage: 21, pellets: 1, rpm: 900, auto: true, mag: 32, reserveMax: 192, hipSpread: 3.2, adsSpread: 1.1, recoil: 0.9, recoilYaw: 0.7, noise: 45, sound: 'smg', suppressed: false, reload: 1.9, adsFov: 58, headMult: 3, range: 100, tracerEvery: 4, ammoType: '9mm' },
  ar74: { id: 'ar74', name: 'AR-74 RIFLE', desc: '5.45mm assault rifle. Punches through.', damage: 34, pellets: 1, rpm: 640, auto: true, mag: 30, reserveMax: 180, hipSpread: 3.6, adsSpread: 0.6, recoil: 1.35, recoilYaw: 0.8, noise: 65, sound: 'rifle', suppressed: false, reload: 2.3, adsFov: 50, headMult: 3, range: 250, tracerEvery: 3, ammoType: '545' },
  ks12: { id: 'ks12', name: 'KS-12 SHOTGUN', desc: '12 gauge pump. Room clearer.', damage: 16, pellets: 9, rpm: 75, auto: false, mag: 6, reserveMax: 36, hipSpread: 3.6, adsSpread: 2.6, recoil: 6, recoilYaw: 1.5, noise: 70, sound: 'shotgun', suppressed: false, reload: 0.55, adsFov: 62, headMult: 2.2, range: 45, tracerEvery: 0, pump: true, shellReload: true, ammoType: '12g' },
  vs9: { id: 'vs9', name: 'VS-9 MARKSMAN', desc: 'Suppressed 9x39 marksman rifle. 4x scope.', damage: 75, pellets: 1, rpm: 110, auto: false, mag: 10, reserveMax: 40, hipSpread: 4.5, adsSpread: 0.05, recoil: 4, recoilYaw: 0.6, noise: 9, sound: 'rifle_sup', suppressed: true, reload: 2.6, adsFov: 18, headMult: 4, range: 300, tracerEvery: 0, ammoType: '939', scope: true },
};

export const SLOT_ORDER: WeaponId[] = ['knife', 'sp9', 'kr5', 'ar74', 'ks12', 'vs9'];

const M = (c: number) => new THREE.MeshLambertMaterial({ color: c });

function part(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Build a viewmodel group. Barrel points down -Z (camera forward). */
export function buildViewmodel(id: WeaponId): { group: THREE.Group; muzzle: THREE.Object3D; mag?: THREE.Object3D; slide?: THREE.Object3D } {
  const g = new THREE.Group();
  const dark = M(0x3a3d43), metal = M(0x6a707a), wood = M(0x8a5228), glove = M(0x2c2a28), sleeve = M(0x343a40), poly = M(0x484c40);
  const muzzle = new THREE.Object3D();
  let mag: THREE.Object3D | undefined, slide: THREE.Object3D | undefined;
  // forearm + hand (right)
  const arm = part(0.08, 0.08, 0.3, sleeve, 0.03, -0.14, 0.2);
  arm.rotation.x = 0.25;
  g.add(arm);
  g.add(part(0.075, 0.1, 0.1, glove, 0, -0.07, 0.04));
  if (id === 'knife') {
    g.add(part(0.03, 0.04, 0.13, dark, 0, -0.02, -0.04));
    const blade = part(0.008, 0.035, 0.2, M(0xb8bec8), 0, 0, -0.2);
    g.add(blade);
    muzzle.position.set(0, 0, -0.3);
  } else if (id === 'sp9') {
    slide = part(0.04, 0.045, 0.2, metal, 0, 0.015, -0.06);
    g.add(slide);
    g.add(part(0.038, 0.1, 0.045, dark, 0, -0.04, 0.02));
    const sup = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.17, 10), dark);
    sup.rotation.x = Math.PI / 2;
    sup.position.set(0, 0.012, -0.24);
    g.add(sup);
    muzzle.position.set(0, 0.012, -0.34);
    mag = part(0.03, 0.06, 0.035, dark, 0, -0.1, 0.02);
    g.add(mag);
    // support hand
    g.add(part(0.07, 0.08, 0.09, glove, -0.035, -0.06, 0.0));
  } else if (id === 'kr5') {
    g.add(part(0.05, 0.08, 0.36, dark, 0, 0, -0.08));
    g.add(part(0.03, 0.03, 0.12, metal, 0, 0.005, -0.31));
    mag = part(0.035, 0.18, 0.05, dark, 0, -0.12, -0.12);
    g.add(mag);
    g.add(part(0.04, 0.09, 0.05, dark, 0, -0.07, 0.03));
    g.add(part(0.03, 0.04, 0.2, dark, 0, -0.01, 0.16));
    g.add(part(0.01, 0.025, 0.01, metal, 0, 0.055, -0.2));
    muzzle.position.set(0, 0.005, -0.39);
    g.add(part(0.07, 0.07, 0.09, glove, -0.04, -0.04, -0.17));
  } else if (id === 'ar74') {
    g.add(part(0.05, 0.08, 0.45, dark, 0, 0, -0.12));
    g.add(part(0.055, 0.06, 0.22, wood, 0, -0.005, -0.26));
    g.add(part(0.025, 0.025, 0.2, metal, 0, 0.01, -0.45));
    g.add(part(0.03, 0.03, 0.05, dark, 0, 0.01, -0.57));
    mag = part(0.035, 0.2, 0.06, M(0x5a3a1c), 0, -0.13, -0.08);
    (mag as THREE.Mesh).rotation.x = -0.35;
    g.add(mag);
    g.add(part(0.04, 0.1, 0.05, wood, 0, -0.08, 0.05));
    g.add(part(0.05, 0.08, 0.25, wood, 0, -0.02, 0.22));
    g.add(part(0.01, 0.035, 0.01, metal, 0, 0.06, -0.33));
    muzzle.position.set(0, 0.01, -0.6);
    g.add(part(0.07, 0.07, 0.1, glove, -0.04, -0.045, -0.27));
  } else if (id === 'ks12') {
    g.add(part(0.06, 0.09, 0.4, dark, 0, 0, -0.08));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 10), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, -0.42);
    g.add(barrel);
    slide = part(0.06, 0.055, 0.16, poly, 0, -0.035, -0.36);
    g.add(slide);
    g.add(part(0.045, 0.1, 0.05, poly, 0, -0.08, 0.05));
    g.add(part(0.05, 0.08, 0.26, poly, 0, -0.03, 0.22));
    muzzle.position.set(0, 0.015, -0.63);
    const hand = part(0.07, 0.07, 0.1, glove, -0.03, -0.07, 0);
    slide.add(hand);
  } else if (id === 'vs9') {
    g.add(part(0.05, 0.08, 0.42, dark, 0, 0, -0.1));
    const sup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10), dark);
    sup.rotation.x = Math.PI / 2;
    sup.position.set(0, 0.01, -0.45);
    g.add(sup);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 10), metal);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.075, -0.08);
    g.add(scope);
    mag = part(0.035, 0.12, 0.06, dark, 0, -0.1, -0.1);
    g.add(mag);
    g.add(part(0.05, 0.1, 0.25, M(0x3b2a1c), 0, -0.03, 0.2));
    muzzle.position.set(0, 0.01, -0.62);
    g.add(part(0.07, 0.07, 0.1, glove, -0.04, -0.045, -0.24));
  }
  g.add(muzzle);
  g.traverse((o) => { o.frustumCulled = false; });
  return { group: g, muzzle, mag, slide };
}

export interface WeaponState {
  def: WeaponDef;
  inMag: number;
  reserve: number;
}

/** Viewmodel animator: owns the per-weapon groups and procedural motion. */
export class Viewmodel {
  root = new THREE.Group();
  models = new Map<WeaponId, ReturnType<typeof buildViewmodel>>();
  current: WeaponId = 'sp9';
  kick = 0;
  kickRot = 0;
  bobPhase = 0;
  swayX = 0; swayY = 0;
  reloadT = 0;   // 0..1 progress when reloading
  switchT = 0;   // 1 = lowered
  ads = 0;
  sprint = 0;
  meleeT = 0;
  pumpT = 0;
  flash: THREE.Sprite;
  flashT = 0;

  constructor(cam: THREE.Camera) {
    cam.add(this.root);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('flash'), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.flash.visible = false;
    this.flash.renderOrder = 20;
    this.root.scale.setScalar(0.85);
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const m = buildViewmodel(id);
      m.group.visible = false;
      this.root.add(m.group);
      this.models.set(id, m);
    }
  }

  show(id: WeaponId) {
    this.current = id;
    for (const [k, m] of this.models) m.group.visible = k === id;
    this.models.get(id)!.muzzle.add(this.flash);
  }

  muzzleFlash(size: number) {
    this.flashT = 0.05;
    this.flash.visible = true;
    this.flash.scale.setScalar(size);
    (this.flash.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
  }

  muzzleWorld(out: THREE.Vector3) {
    return this.models.get(this.current)!.muzzle.getWorldPosition(out);
  }

  update(dt: number, moveSpeed: number, mdx: number, mdy: number, grounded: boolean, scoped: boolean) {
    const m = this.models.get(this.current)!;
    this.bobPhase += dt * (moveSpeed * 2.2);
    const bobAmt = Math.min(1, moveSpeed / 4) * (grounded ? 1 : 0.2) * (1 - this.ads * 0.85);
    this.swayX += (-mdx * 0.0006 - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (mdy * 0.0006 - this.swayY) * Math.min(1, dt * 8);
    this.kick = Math.max(0, this.kick - dt * 9);
    this.kickRot = Math.max(0, this.kickRot - dt * 7);
    this.meleeT = Math.max(0, this.meleeT - dt * 3.5);
    this.pumpT = Math.max(0, this.pumpT - dt * 2.5);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }

    const hip = new THREE.Vector3(0.2, -0.2, -0.44);
    const adsPos = new THREE.Vector3(0, this.current === 'vs9' ? -0.085 : -0.06, this.current === 'sp9' ? -0.3 : -0.25);
    const p = hip.lerp(adsPos, this.ads);
    p.x += Math.sin(this.bobPhase) * 0.012 * bobAmt + this.swayX;
    p.y += -Math.abs(Math.cos(this.bobPhase)) * 0.012 * bobAmt + this.swayY;
    p.z += this.kick * 0.06;
    // sprint lower, switch lower, reload dip
    const reloadDip = Math.sin(Math.min(1, this.reloadT) * Math.PI);
    p.y -= this.sprint * 0.06 + this.switchT * 0.35 + reloadDip * 0.08;
    m.group.position.copy(p);
    m.group.rotation.set(
      this.kickRot * 0.18 + this.sprint * -0.35 + reloadDip * -0.5 + this.switchT * -0.8,
      this.sprint * 0.6 + reloadDip * 0.25,
      reloadDip * 0.5 + this.sprint * 0.2,
    );
    // melee swing
    if (this.meleeT > 0) {
      const s = Math.sin(this.meleeT * Math.PI);
      m.group.position.x -= s * 0.15;
      m.group.position.z -= s * 0.2;
      m.group.rotation.y += s * 1.0;
      m.group.rotation.x -= s * 0.4;
    }
    if (m.mag) m.mag.visible = !(this.reloadT > 0.25 && this.reloadT < 0.6);
    if (m.slide && this.current === 'ks12') m.slide.position.z = -0.36 + Math.sin(this.pumpT * Math.PI) * 0.09;
    if (m.slide && this.current === 'sp9') m.slide.position.z = -0.06 + this.kick * 0.05;
    this.root.visible = !scoped;
  }
}
