// Doors, pickups, interactables, security cameras, alarm panels, thrown objects, helicopter.
import * as THREE from 'three';
import { tex } from '../core/textures';
import { audio } from '../core/audio';
import type { Game } from './game';
import type { Box } from '../world/physics';
import { getConeMaterial } from '../world/level';

// ------------------------------------------------------------------ doors
export class Door {
  panels: { mesh: THREE.Mesh; box: Box; closed: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  open = 0;
  target = 0;
  closeT = 0;
  center: THREE.Vector3;
  locked: 'blue' | 'red' | 'sealed' | null;
  label: string;

  constructor(public game: Game, x: number, z: number, y0: number, w: number, h: number, axis: 'x' | 'z', lock: 'blue' | 'red' | 'sealed' | null = null, style: 'metal' | 'vault' = 'metal', label = 'Door') {
    this.center = new THREE.Vector3(x, y0 + h / 2, z);
    this.locked = lock;
    this.label = label;
    const t = 0.16;
    const m = new THREE.MeshLambertMaterial({ map: tex(style === 'vault' ? 'door_vault' : 'door_metal') });
    const lockColor = lock === 'blue' ? 0x2266ff : lock === 'red' ? 0xff2222 : lock === 'sealed' ? 0xff8800 : 0x22ff66;
    for (const side of [-1, 1]) {
      const pw = w / 2;
      const geo = axis === 'x' ? new THREE.BoxGeometry(pw, h, t) : new THREE.BoxGeometry(t, h, pw);
      const mesh = new THREE.Mesh(geo, m);
      const cx = axis === 'x' ? x + side * pw / 2 : x;
      const cz = axis === 'z' ? z + side * pw / 2 : z;
      mesh.position.set(cx, y0 + h / 2, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      game.r.scene.add(mesh);
      const hx = axis === 'x' ? pw / 2 : t / 2, hz = axis === 'z' ? pw / 2 : t / 2;
      const box: Box = { minX: cx - hx, minY: y0, minZ: cz - hz, maxX: cx + hx, maxY: y0 + h, maxZ: cz + hz, surface: 'metal', enabled: true, owner: this };
      game.physics.addDynamic(box);
      this.panels.push({ mesh, box, closed: new THREE.Vector3(cx, y0 + h / 2, cz), dir: new THREE.Vector3(axis === 'x' ? side : 0, 0, axis === 'z' ? side : 0) });
    }
    // status lights on both sides
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: lockColor }));
      const off = 0.32;
      if (axis === 'x') l.position.set(x + w / 2 + 0.25, y0 + 1.4, z + s * off);
      else l.position.set(x + s * off, y0 + 1.4, z + w / 2 + 0.25);
      game.r.scene.add(l);
      (this as any)['light' + s] = l;
    }
    this.width = w;
  }
  width: number;

  setLockLight(color: number) {
    for (const s of [-1, 1]) ((this as any)['light' + s].material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  /** Attempt to open. Returns message if denied. */
  use(byPlayer: boolean): string | null {
    const g = this.game;
    if (this.locked && byPlayer) {
      if (this.locked === 'sealed') { audio.play('denied', { pos: this.center }); return 'Sealed. ' + this.label; }
      if (!g.player.keys.has(this.locked)) { audio.play('denied', { pos: this.center }); return `Locked - requires ${this.locked.toUpperCase()} keycard`; }
      this.locked = null;
      this.setLockLight(0x22ff66);
      audio.play('beep', { pos: this.center });
      g.hud.message(`${this.label} unlocked`, 'info');
    } else if (this.locked && !byPlayer && this.locked !== 'red' && this.locked !== 'sealed') {
      // guards have their own keys
    } else if (this.locked && !byPlayer) return 'locked';
    if (this.target < 1) {
      audio.play('door', { pos: this.center, vol: 0.7 });
      g.noise(this.center, 6, 'door', null);
    }
    this.target = 1;
    this.closeT = 5;
    return null;
  }

  update(dt: number) {
    const g = this.game;
    // guards open doors automatically
    for (const a of g.actors) {
      if (!a.alive) continue;
      if (Math.abs(a.pos.x - this.center.x) < 1.8 && Math.abs(a.pos.z - this.center.z) < 1.8 && Math.abs(a.pos.y + 1 - this.center.y) < 2) {
        if (this.target < 1) this.use(false);
        this.closeT = Math.max(this.closeT, 2);
      }
    }
    if (this.target === 1) {
      const P = g.player;
      const inDoor = Math.abs(P.pos.x - this.center.x) < 1.5 && Math.abs(P.pos.z - this.center.z) < 1.5;
      if (inDoor) this.closeT = Math.max(this.closeT, 1.5);
      this.closeT -= dt;
      if (this.closeT <= 0) {
        this.target = 0;
        audio.play('door', { pos: this.center, vol: 0.5 });
      }
    }
    const prev = this.open;
    this.open += Math.sign(this.target - this.open) * Math.min(Math.abs(this.target - this.open), dt * 1.4);
    if (prev !== this.open) {
      for (const p of this.panels) {
        const off = this.open * (this.width / 2 - 0.05);
        p.mesh.position.copy(p.closed).addScaledVector(p.dir, off);
        const hx = (p.box.maxX - p.box.minX) / 2, hz = (p.box.maxZ - p.box.minZ) / 2;
        p.box.minX = p.mesh.position.x - hx; p.box.maxX = p.mesh.position.x + hx;
        p.box.minZ = p.mesh.position.z - hz; p.box.maxZ = p.mesh.position.z + hz;
      }
    }
  }
}

// ------------------------------------------------------------------ pickups
export type PickupKind = 'weapon' | 'ammo' | 'armor' | 'medkit' | 'grenade' | 'noisemaker' | 'key' | 'intel' | 'prototype';

export class Pickup {
  mesh: THREE.Group;
  taken = false;
  t = Math.random() * 10;
  constructor(public game: Game, public kind: PickupKind, public pos: THREE.Vector3, public data: any = {}, public label = '') {
    this.mesh = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; this.mesh.add(m); return m; };
    switch (kind) {
      case 'weapon': {
        add(new THREE.BoxGeometry(0.08, 0.1, data.id === 'ks12' || data.id === 'ar74' || data.id === 'vs9' ? 0.8 : 0.45), new THREE.MeshLambertMaterial({ color: 0x2a2c30 }), 0.08);
        add(new THREE.BoxGeometry(0.05, 0.16, 0.06), new THREE.MeshLambertMaterial({ color: 0x3a3a3a }), -0.02).position.z = 0.1;
        break;
      }
      case 'ammo': add(new THREE.BoxGeometry(0.3, 0.18, 0.2), new THREE.MeshLambertMaterial({ map: tex('military_crate') }), 0.09); break;
      case 'armor': add(new THREE.BoxGeometry(0.45, 0.5, 0.15), new THREE.MeshLambertMaterial({ color: 0x34402e }), 0.25); break;
      case 'medkit': {
        add(new THREE.BoxGeometry(0.35, 0.2, 0.25), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }), 0.1);
        add(new THREE.BoxGeometry(0.2, 0.05, 0.06), new THREE.MeshBasicMaterial({ color: 0xcc1111 }), 0.21);
        add(new THREE.BoxGeometry(0.06, 0.05, 0.2), new THREE.MeshBasicMaterial({ color: 0xcc1111 }), 0.21);
        break;
      }
      case 'grenade': add(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshLambertMaterial({ color: 0x3d4a2a }), 0.07); break;
      case 'noisemaker': add(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8), new THREE.MeshLambertMaterial({ color: 0x999999 }), 0.05); break;
      case 'key': add(new THREE.BoxGeometry(0.16, 0.01, 0.1), new THREE.MeshLambertMaterial({ map: tex('keycard_' + data.color), emissive: data.color === 'blue' ? 0x1030a0 : 0xa01010, emissiveIntensity: 0.8 }), 0.02); break;
      case 'intel': add(new THREE.BoxGeometry(0.3, 0.04, 0.22), new THREE.MeshLambertMaterial({ map: tex('files') }), 0.02); break;
      case 'prototype': {
        add(new THREE.BoxGeometry(0.4, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: 0x30343a }), 0.15);
        add(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshBasicMaterial({ color: 0x7fe8ff }), 0.36);
        break;
      }
    }
    this.mesh.position.copy(pos);
    game.r.scene.add(this.mesh);
  }

  update(dt: number) {
    if (this.taken) return;
    this.t += dt;
    const k = this.kind;
    if (k === 'key' || k === 'intel' || k === 'prototype') {
      this.mesh.rotation.y += dt * 1.2;
      this.mesh.position.y = this.pos.y + (k === 'prototype' ? 0 : 0.05 + Math.sin(this.t * 2) * 0.03);
    }
  }

  remove() {
    this.taken = true;
    this.game.r.scene.remove(this.mesh);
  }
}

// ------------------------------------------------------------------ interactables
export class Interactable {
  progress = 0;
  enabled = true;
  done = false;
  constructor(public pos: THREE.Vector3, public label: string, public holdTime: number, public onComplete: () => void, public radius = 1.8, public sound = 'typing') {}
}

// ------------------------------------------------------------------ alarm panels
export class AlarmPanel {
  disabled = false;
  mesh: THREE.Group;
  constructor(game: Game, public pos: THREE.Vector3, public stand: THREE.Vector3, facing: number) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.12), new THREE.MeshLambertMaterial({ color: 0xb8a030 }));
    g.add(body);
    const btn = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.08), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    btn.position.z = 0.08;
    g.add(btn);
    g.position.copy(pos);
    g.rotation.y = facing;
    game.r.scene.add(g);
    this.mesh = g;
  }
  disable() {
    this.disabled = true;
    ((this.mesh.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(0x222222);
  }
}

// ------------------------------------------------------------------ security cameras
export class SecurityCamera {
  mesh: THREE.Group;
  head: THREE.Group;
  box: Box;
  alive = true;
  active = true;
  awareness = 0;
  t = Math.random() * 10;
  yaw = 0;
  cone: THREE.Mesh;
  ledMat: THREE.MeshBasicMaterial;
  constructor(public game: Game, public pos: THREE.Vector3, public baseYaw: number, public sweep = 0.9, public pitch = -0.45) {
    this.mesh = new THREE.Group();
    this.mesh.position.copy(pos);
    this.head = new THREE.Group();
    this.mesh.add(this.head);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.45), new THREE.MeshLambertMaterial({ color: 0xd0d0c8 }));
    body.position.z = 0.15;
    this.head.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.39;
    this.head.add(lens);
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0x22ff44 });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), this.ledMat);
    led.position.set(0.07, 0.11, 0.3);
    this.head.add(led);
    const coneGeo = new THREE.CylinderGeometry(0.05, 3.2, 14, 14, 1, true);
    coneGeo.translate(0, -7, 0);
    coneGeo.rotateX(-Math.PI / 2);
    const cm = getConeMaterial().clone();
    cm.uniforms.uColor.value = new THREE.Color(0.3, 1, 0.4);
    cm.uniforms.uStrength.value = 0.035;
    this.cone = new THREE.Mesh(coneGeo, cm);
    this.cone.position.z = 0.4;
    this.head.add(this.cone);
    game.r.scene.add(this.mesh);
    this.box = game.physics.addStatic({ minX: pos.x - 0.22, minY: pos.y - 0.15, minZ: pos.z - 0.22, maxX: pos.x + 0.22, maxY: pos.y + 0.15, maxZ: pos.z + 0.22, surface: 'metal', enabled: true, noCollide: true, seeThrough: true, owner: this });
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.active = false;
    this.cone.visible = false;
    this.ledMat.color.setHex(0x000000);
    this.head.rotation.x = 0.9;
    this.box.enabled = false;
    audio.play('spark', { pos: this.pos });
    this.game.fx.glassBurst(this.pos);
    this.game.stats.camerasDestroyed++;
  }

  disable() {
    this.active = false;
    this.cone.visible = false;
    this.ledMat.color.setHex(0x333333);
  }

  update(dt: number) {
    if (!this.active) return;
    const g = this.game;
    const P = g.player;
    if (this.awareness < 0.3) this.t += dt * 0.35;
    this.yaw = this.baseYaw + Math.sin(this.t) * this.sweep;
    this.head.rotation.set(-this.pitch, this.yaw, 0, 'YXZ');
    this.head.rotation.x = -this.pitch;
    // detection
    const fwd = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const to = P.eyePos.clone().sub(this.pos);
    const d = to.length();
    let seen = false;
    if (P.alive && d < 16) {
      to.normalize();
      if (fwd.dot(to) > 0.88) {
        const pts = P.samplePoints();
        let v = 0;
        for (const p of pts) if (g.physics.los(this.pos.x, this.pos.y - 0.2, this.pos.z, p.x, p.y, p.z, 'sight')) v++;
        if (v > 0) {
          const lightF = Math.max(0.15, Math.min(1, P.light / 0.4));
          this.awareness += dt * (v / pts.length) * lightF * 0.9 * g.diff.perception;
          seen = true;
        }
      }
    }
    if (!seen) this.awareness = Math.max(0, this.awareness - dt * 0.3);
    const col = this.awareness > 0.05 ? (this.awareness > 0.6 ? 0xff2020 : 0xffaa20) : 0x22ff44;
    this.ledMat.color.setHex(col);
    (this.cone.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(col === 0x22ff44 ? 0x40ff60 : col);
    if (this.awareness >= 1) {
      this.awareness = 0;
      g.hud.message('Security camera spotted you!', 'warn');
      g.raiseAlarm('Spotted by a security camera');
      for (const a of g.actors) if (a.alive && !a.civilian && a.pos.distanceTo(P.pos) < 40) a.engage(P.pos.clone(), true);
    }
  }
}

// ------------------------------------------------------------------ thrown
export class Thrown {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  fuse: number;
  resting = false;
  bounces = 0;
  constructor(public game: Game, public pos: THREE.Vector3, vel: THREE.Vector3, public owner: any, public kind: 'frag' | 'noise') {
    this.vel = vel;
    this.fuse = kind === 'frag' ? 2.8 : 6;
    this.mesh = new THREE.Mesh(kind === 'frag' ? new THREE.SphereGeometry(0.07, 8, 6) : new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8), new THREE.MeshLambertMaterial({ color: kind === 'frag' ? 0x3d4a2a : 0xaaaaaa }));
    this.mesh.castShadow = true;
    this.mesh.position.copy(pos);
    game.r.scene.add(this.mesh);
  }

  /** returns true when finished */
  update(dt: number): boolean {
    const g = this.game;
    this.fuse -= dt;
    if (!this.resting) {
      this.vel.y -= 14 * dt;
      const step = this.vel.clone().multiplyScalar(dt);
      const len = step.length();
      if (len > 0) {
        const dir = step.clone().normalize();
        const hit = g.physics.raycast(this.pos.x, this.pos.y, this.pos.z, dir.x, dir.y, dir.z, len + 0.07, 'bullet');
        if (hit) {
          this.pos.set(hit.x + hit.nx * 0.08, hit.y + hit.ny * 0.08, hit.z + hit.nz * 0.08);
          const n = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
          this.vel.reflect(n).multiplyScalar(0.4);
          this.bounces++;
          if (this.vel.length() > 1.2) audio.play(this.kind === 'noise' ? 'coin' : 'bounce', { pos: this.pos, vol: 0.8 });
          if (this.kind === 'noise' && this.bounces === 1) {
            g.noise(this.pos.clone(), 14, 'distraction', g.player);
            g.hud.message('Noisemaker landed', 'info');
          }
          if (hit.ny > 0.5 && this.vel.length() < 1.2) { this.resting = true; this.vel.set(0, 0, 0); }
        } else this.pos.add(step);
      }
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.x += dt * 8;
    }
    if (this.fuse <= 0) {
      if (this.kind === 'frag') g.explode(this.pos.clone(), this.owner);
      g.r.scene.remove(this.mesh);
      return true;
    }
    return false;
  }
}

// ------------------------------------------------------------------ helicopter
export class Helicopter {
  root = new THREE.Group();
  rotor: THREE.Mesh;
  tail: THREE.Mesh;
  state: 'away' | 'inbound' | 'landed' = 'away';
  t = 0;
  spot: THREE.SpotLight;
  constructor(public game: Game, public pad: THREE.Vector3) {
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b3036 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x223344, emissive: 0x112233 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 6), dark);
    body.position.y = 1.6;
    this.root.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.4), glass);
    nose.position.set(0, 1.5, 3.4);
    this.root.add(nose);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 6), dark);
    boom.position.set(0, 2.2, -5.5);
    this.root.add(boom);
    this.tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 0.3), dark);
    this.tail.position.set(0.35, 2.6, -8.3);
    this.root.add(this.tail);
    for (const s of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 5), dark);
      skid.position.set(s * 1.2, 0.06, 0);
      this.root.add(skid);
    }
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(13, 0.05, 0.35), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    this.rotor.position.y = 3.05;
    this.root.add(this.rotor);
    const r2 = this.rotor.clone();
    r2.rotation.y = Math.PI / 2;
    this.rotor.add(r2);
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    beacon.position.set(0, 2.8, -1);
    this.root.add(beacon);
    this.spot = new THREE.SpotLight(0xffffff, 0, 60, 0.35, 0.5, 1);
    this.spot.position.set(0, 0.6, 2.5);
    this.root.add(this.spot);
    this.root.add(this.spot.target);
    this.spot.target.position.set(0, -10, 8);
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.root.position.set(0, -600, 0);
    game.r.scene.add(this.root);
  }

  call() {
    if (this.state !== 'away') return;
    this.state = 'inbound';
    this.t = 0;
    this.spot.intensity = 60;
  }

  update(dt: number) {
    if (this.state === 'away') return;
    this.t += dt;
    this.rotor.rotation.y += dt * 30;
    const g = this.game;
    if (this.state === 'inbound') {
      const T = 14;
      const k = Math.min(1, this.t / T);
      const e = 1 - Math.pow(1 - k, 3);
      const start = this.pad.clone().add(new THREE.Vector3(-120, 60, -60));
      this.root.position.lerpVectors(start, this.pad, e);
      const dir = this.pad.clone().sub(start).setY(0);
      this.root.rotation.y = Math.atan2(dir.x, dir.z);
      this.root.rotation.x = (1 - k) * 0.15;
      if (k >= 1) { this.state = 'landed'; g.onHeliLanded(); }
    }
    const d = this.root.position.distanceTo(g.player.pos);
    audio.setHeli(Math.min(0.6, 30 / (d + 5)));
  }
}
