// Player: tactical movement (walk/jog/sprint, crouch, prone, lean, slide, mantle), weapons,
// takedowns, gadgets, stealth exposure.
import * as THREE from 'three';
import { audio } from '../core/audio';
import type { Game } from './game';
import { WEAPONS, WeaponId, WeaponState, Viewmodel, SLOT_ORDER } from './weapons';
import { rayActor, Actor } from './ai';

export type Stance = 'stand' | 'crouch' | 'prone';
const HEIGHT: Record<Stance, number> = { stand: 1.8, crouch: 1.15, prone: 0.55 };
const EYE: Record<Stance, number> = { stand: 1.66, crouch: 1.0, prone: 0.38 };
const RADIUS = 0.32;

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  stance: Stance = 'stand';
  height = 1.8;
  eyeH = 1.66;
  lean = 0;
  leanOffset = 0;
  grounded = true;
  health = 100;
  armor = 0;
  alive = true;
  walkMode = false;
  sprinting = false;
  stamina = 1;
  horizSpeed = 0;
  light = 0.3;
  noiseLevel = 0;
  keys = new Set<string>();
  inventory = new Map<WeaponId, WeaponState>();
  weapon: WeaponId = 'sp9';
  fireCD = 0;
  reloadT = 0;
  switchT = 0;
  pendingWeapon: WeaponId | null = null;
  ads = 0;
  recoilPitch = 0;
  recoilYaw = 0;
  shake = 0;
  stepAcc = 0;
  slideT = 0;
  mantleT = 0;
  mantleFrom = new THREE.Vector3();
  mantleTo = new THREE.Vector3();
  grenades = 2;
  noisemakers = 3;
  nvg = false;
  nvgBattery = 1;
  pumpT = 0;
  muzzleT = 0;
  eyePos = new THREE.Vector3();
  vm: Viewmodel;
  damageFlash = 0;
  bob = 0;
  landT = 0;
  holdingUse = 0;
  shotsFired = 0;
  private lastStepPhase = 0;
  private fallStartY = 0;

  constructor(public game: Game) {
    this.vm = new Viewmodel(game.r.viewCamera);
    this.give('knife', 0);
    this.give('sp9', 36);
    this.equip('sp9', true);
  }

  give(id: WeaponId, ammo: number) {
    const def = WEAPONS[id];
    const st = this.inventory.get(id);
    if (st) { st.reserve = Math.min(def.reserveMax, st.reserve + ammo); return false; }
    this.inventory.set(id, { def, inMag: def.mag, reserve: Math.min(def.reserveMax, ammo) });
    return true;
  }

  addAmmo(type: string, n: number) {
    let added = false;
    for (const st of this.inventory.values()) {
      if (st.def.ammoType === type) { st.reserve = Math.min(st.def.reserveMax, st.reserve + n); added = true; }
    }
    return added;
  }

  equip(id: WeaponId, instant = false) {
    if (!this.inventory.has(id) || (id === this.weapon && !instant)) return;
    this.reloadT = 0;
    this.vm.reloadT = 0;
    if (instant) { this.weapon = id; this.vm.show(id); return; }
    this.pendingWeapon = id;
    this.switchT = 0.25;
    audio.play('weapon_switch', { ui: true, vol: 0.5 });
  }

  get cur(): WeaponState { return this.inventory.get(this.weapon)!; }

  samplePoints(): THREE.Vector3[] {
    const e = this.eyePos;
    const p = this.pos;
    if (this.stance === 'prone') return [e.clone(), new THREE.Vector3(p.x, p.y + 0.3, p.z), new THREE.Vector3(p.x - Math.sin(this.yaw) * -0.8, p.y + 0.25, p.z - Math.cos(this.yaw) * -0.8)];
    return [e.clone(), new THREE.Vector3(p.x, p.y + this.height * 0.6, p.z), new THREE.Vector3(p.x, p.y + 0.35, p.z)];
  }

  /** Where an enemy aims: chest with occasional head. */
  aimPointFor(a: Actor): THREE.Vector3 {
    const pts = this.samplePoints();
    const e = a.eye;
    // aim at whichever part is visible, preferring centre mass
    for (const i of [1, 0, 2]) {
      const p = pts[i];
      if (this.game.physics.los(e.x, e.y, e.z, p.x, p.y, p.z, 'bullet')) return p;
    }
    return pts[0];
  }

  /** Is the player aiming a gun at this actor (for surrender behaviour)? */
  weaponRaisedAt(a: Actor) {
    if (this.weapon === 'knife') return false;
    const f = this.forward();
    const to = a.pos.clone().setY(a.pos.y + 1.2).sub(this.eyePos).normalize();
    return f.dot(to) > 0.95;
  }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  // ------------------------------------------------------------------ damage
  hurt(amount: number, from: THREE.Vector3 | null) {
    if (!this.alive) return;
    const g = this.game;
    if (g.godMode) return;
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.65);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    this.damageFlash = Math.min(1, this.damageFlash + 0.35 + amount * 0.015);
    this.shake = Math.min(1, this.shake + 0.25);
    if (from) g.hud.damageFrom(from, this);
    audio.play('hit_flesh', { ui: true, vol: 0.6 });
    if (Math.random() < 0.5) audio.play('grunt', { ui: true, vol: 0.5, rate: 0.85 });
    g.fx.bloodSpray(this.eyePos.clone().add(new THREE.Vector3(0, -0.4, 0)), new THREE.Vector3(Math.random() - 0.5, -0.3, Math.random() - 0.5).normalize(), 0.5);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      g.onPlayerDied();
    }
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const g = this.game, inp = g.input;
    if (!this.alive) {
      // death cam: slump to the floor
      this.eyeH += (0.25 - this.eyeH) * Math.min(1, dt * 3);
      this.lean += (0.9 - this.lean) * dt * 2;
      this.updateCamera(dt);
      return;
    }
    const sens = g.settings.sensitivity * 0.0022 * (1 - this.ads * (1 - WEAPONS[this.weapon].adsFov / 75) * 0.75);
    this.yaw -= inp.mouseDX * sens;
    this.pitch -= inp.mouseDY * sens * (g.settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));

    // --- stance input
    if (inp.pressed('KeyC')) {
      if (this.sprinting && this.stance === 'stand' && this.grounded && this.horizSpeed > 4.5) {
        this.slideT = 0.75;
        this.setStance('crouch');
        audio.play('step_snow', { ui: true, vol: 0.8, rate: 0.6 });
      } else this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
    }
    if (inp.pressed('KeyZ')) this.setStance(this.stance === 'prone' ? 'crouch' : 'prone');
    if (inp.pressed('KeyX')) { this.walkMode = !this.walkMode; g.hud.message(this.walkMode ? 'Walk (quiet)' : 'Jog', 'info'); }
    if (inp.pressed('KeyN')) {
      this.nvg = !this.nvg;
      audio.play('nvg_on', { ui: true, vol: 0.7 });
    }

    // --- movement
    const fwd = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0);
    const strafe = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    const moving = fwd !== 0 || strafe !== 0;
    const wantSprint = inp.down('ShiftLeft') && fwd > 0 && this.stance !== 'prone' && this.ads < 0.3 && this.reloadT <= 0;
    if (wantSprint && this.stance === 'crouch' && this.slideT <= 0) this.setStance('stand');
    this.sprinting = wantSprint && this.stamina > 0.05 && this.stance === 'stand';
    this.stamina = Math.max(0, Math.min(1, this.stamina + (this.sprinting && moving ? -dt / 7 : dt / 5)));
    let speed = this.stance === 'prone' ? 1.0 : this.stance === 'crouch' ? (this.walkMode ? 1.3 : 2.3) : this.sprinting ? 6.6 : this.walkMode ? 1.9 : 4.0;
    speed *= 1 - this.ads * 0.4;
    speed *= 1 - Math.abs(this.lean) * 0.4;
    if (this.weapon === 'knife') speed *= 1.06;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = (-sy * fwd + cy * strafe), wz = (-cy * fwd - sy * strafe);
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const accel = this.grounded ? 14 : 3;
    let tx = wx * speed, tz = wz * speed;
    if (this.slideT > 0) {
      this.slideT -= dt;
      const sv = 8 * (this.slideT / 0.75);
      tx = -sy * sv; tz = -cy * sv;
    }
    this.vel.x += (tx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (tz - this.vel.z) * Math.min(1, accel * dt);

    // --- jump / mantle
    if (this.mantleT > 0) {
      this.mantleT -= dt;
      const k = 1 - Math.max(0, this.mantleT) / 0.5;
      const up = Math.min(1, k * 1.6), fw = Math.max(0, (k - 0.5) * 2);
      this.pos.set(
        this.mantleFrom.x + (this.mantleTo.x - this.mantleFrom.x) * fw,
        this.mantleFrom.y + (this.mantleTo.y - this.mantleFrom.y) * up,
        this.mantleFrom.z + (this.mantleTo.z - this.mantleFrom.z) * fw,
      );
      this.vel.set(0, 0, 0);
      if (this.mantleT <= 0) { this.grounded = true; audio.play('step_concrete', { ui: true, vol: 0.5 }); }
    } else {
      if (inp.pressed('Space')) {
        if (!this.tryMantle()) {
          if (this.stance !== 'stand') this.setStance('stand');
          else if (this.grounded) { this.vel.y = 4.6; this.grounded = false; this.fallStartY = this.pos.y; }
        }
      }
      this.vel.y -= 16 * dt;
      const wasGrounded = this.grounded;
      const res = g.physics.moveCharacter(this.pos, this.vel, dt, RADIUS, this.height, this.stance === 'prone' ? 0.25 : 0.45, this.grounded);
      this.grounded = res.onGround;
      if (!wasGrounded && this.grounded) {
        const fall = this.fallStartY - this.pos.y;
        this.landT = 0.25;
        audio.play('step_' + this.stepSurface(), { ui: true, vol: 0.8 });
        g.noise(this.pos, 6, 'footstep', this);
        if (fall > 4.5) this.hurt((fall - 4.5) * 12, null);
      }
      if (wasGrounded && !this.grounded) this.fallStartY = this.pos.y;
      if (this.pos.y < -40) { this.hurt(999, null); }
    }
    this.horizSpeed = Math.hypot(this.vel.x, this.vel.z);

    // --- lean (collision-limited)
    const leanIn = (inp.down('KeyE') ? 1 : 0) - (inp.down('KeyQ') ? 1 : 0);
    this.lean += (leanIn - this.lean) * Math.min(1, dt * 9);
    const maxOff = this.stance === 'prone' ? 0.25 : 0.55;
    let off = this.lean * maxOff;
    if (Math.abs(off) > 0.01) {
      const rx = Math.cos(this.yaw) * Math.sign(off), rz = -Math.sin(this.yaw) * Math.sign(off);
      const ey = this.pos.y + this.eyeH;
      const hit = g.physics.raycast(this.pos.x, ey, this.pos.z, rx, 0, rz, Math.abs(off) + 0.2, 'any');
      if (hit) off = Math.sign(off) * Math.max(0, hit.t - 0.2);
    }
    this.leanOffset = off;

    // --- height smoothing
    const targetH = HEIGHT[this.stance];
    this.height += (targetH - this.height) * Math.min(1, dt * 10);
    this.eyeH += (EYE[this.stance] - this.eyeH) * Math.min(1, dt * 10);

    // --- footsteps + noise
    if (this.grounded && this.horizSpeed > 0.4) {
      const stride = this.sprinting ? 2.0 : this.stance === 'prone' ? 0.9 : this.walkMode || this.stance === 'crouch' ? 1.1 : 1.6;
      this.stepAcc += this.horizSpeed * dt;
      this.bob += this.horizSpeed * dt * 2.4;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        const surf = this.stepSurface();
        const surfMult = surf === 'metal' ? 1.5 : surf === 'snow' ? 0.85 : 1;
        const loud = this.sprinting ? 14 : this.stance === 'prone' ? 0.8 : this.stance === 'crouch' ? (this.walkMode ? 1.2 : 2.6) : this.walkMode ? 2.4 : 7.5;
        const r = loud * surfMult;
        this.noiseLevel = Math.max(this.noiseLevel, r / 14);
        audio.play('step_' + surf, { ui: true, vol: Math.min(0.75, 0.12 + r * 0.04) });
        g.noise(this.pos, r, 'footstep', this);
      }
    }
    this.noiseLevel = Math.max(0, this.noiseLevel - dt * 0.8);

    // --- weapons
    this.updateWeapon(dt);

    // --- interact
    g.updateInteraction(dt, inp.down('KeyF'), inp.pressed('KeyF'));

    // --- gadgets
    if (inp.pressed('KeyG') && this.grenades > 0) {
      this.grenades--;
      g.throwGrenade(this.eyePos.clone(), null, this, 'frag', this.forward().multiplyScalar(13).add(new THREE.Vector3(0, 3.5, 0)).add(this.vel.clone().multiplyScalar(0.5)));
      audio.play('swing', { ui: true, vol: 0.6 });
    }
    if (inp.pressed('KeyT') && this.noisemakers > 0) {
      this.noisemakers--;
      g.throwGrenade(this.eyePos.clone(), null, this, 'noise', this.forward().multiplyScalar(14).add(new THREE.Vector3(0, 3, 0)));
      audio.play('swing', { ui: true, vol: 0.5 });
    }

    this.damageFlash = Math.max(0, this.damageFlash - dt * 0.8);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.landT = Math.max(0, this.landT - dt);
    this.updateCamera(dt);
  }

  private stepSurface(): string {
    const s = this.game.surfaceAt(this.pos);
    return s === 'snow' || s === 'dirt' || s === 'rock' ? 'snow' : s === 'metal' ? 'metal' : 'concrete';
  }

  setStance(s: Stance) {
    if (s === this.stance) return;
    const g = this.game;
    if (HEIGHT[s] > HEIGHT[this.stance] && !g.physics.canFit(this.pos.x, this.pos.y, this.pos.z, RADIUS - 0.02, HEIGHT[s])) {
      g.hud.message('Not enough room to ' + (s === 'stand' ? 'stand up' : 'crouch'), 'info');
      return;
    }
    this.stance = s;
    audio.play('step_snow', { ui: true, vol: 0.25, rate: 0.8 });
  }

  private tryMantle(): boolean {
    const g = this.game;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const base = this.pos;
    // obstacle ahead? probe at knee, waist and chest height
    let probe = null;
    for (const h of [0.3, 0.75, 1.3]) {
      probe = g.physics.raycast(base.x, base.y + h, base.z, fx, 0, fz, 0.9, 'solid');
      if (probe) break;
    }
    if (!probe) return false;
    // find top
    const px = probe.x + fx * 0.35, pz = probe.z + fz * 0.35;
    const top = g.physics.groundHeight(px, pz, base.y + 2.1, 2.2);
    if (top === null) return false;
    const rise = top - base.y;
    if (rise < 0.3 || rise > 1.95) return false;
    if (!g.physics.canFit(px, top, pz, RADIUS - 0.04, 1.15)) return false;
    this.mantleFrom.copy(this.pos);
    this.mantleTo.set(px, top, pz);
    this.mantleT = 0.5;
    if (!g.physics.canFit(px, top, pz, RADIUS - 0.04, 1.8)) this.stance = 'crouch';
    audio.play('swing', { ui: true, vol: 0.4, rate: 0.7 });
    g.noise(this.pos, 3, 'footstep', this);
    return true;
  }

  private updateWeapon(dt: number) {
    const g = this.game, inp = g.input;
    const st = this.cur, def = st.def;
    this.fireCD -= dt;
    this.muzzleT -= dt;
    // switching
    if (inp.wheel !== 0 && this.switchT <= 0) {
      const owned = SLOT_ORDER.filter((id) => this.inventory.has(id));
      let i = owned.indexOf(this.weapon) + (inp.wheel > 0 ? 1 : -1);
      i = (i + owned.length) % owned.length;
      this.equip(owned[i]);
    }
    for (let k = 1; k <= 6; k++) if (inp.pressed('Digit' + k)) { const id = SLOT_ORDER[k - 1]; if (this.inventory.has(id)) this.equip(id); }
    if (this.switchT > 0) {
      this.switchT -= dt;
      this.vm.switchT = Math.min(1, this.vm.switchT + dt * 6);
      if (this.switchT <= 0 && this.pendingWeapon) {
        this.weapon = this.pendingWeapon;
        this.pendingWeapon = null;
        this.vm.show(this.weapon);
        this.switchT = -0.25;
      }
    } else {
      this.vm.switchT = Math.max(0, this.vm.switchT - dt * 5);
      if (this.switchT < 0) this.switchT = Math.min(0, this.switchT + dt);
    }
    const busy = this.switchT !== 0 || this.mantleT > 0;

    // ADS
    const wantAds = inp.down('Mouse2') && !this.sprinting && !busy && this.reloadT <= 0 && def.id !== 'knife';
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 12);
    this.vm.ads = this.ads;
    this.vm.sprint += ((this.sprinting && this.horizSpeed > 3 ? 1 : 0) - this.vm.sprint) * Math.min(1, dt * 8);

    // reload
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      const total = def.shellReload ? def.reload : def.reload;
      this.vm.reloadT = def.shellReload ? 0.5 + Math.sin(this.reloadT / total * Math.PI) * 0.1 : 1 - this.reloadT / total;
      if (!def.shellReload && this.reloadT < total * 0.55 && !(this as any)._magIn) { (this as any)._magIn = true; audio.play('mag_in', { ui: true, vol: 0.7 }); }
      if (this.reloadT <= 0) {
        if (def.shellReload) {
          st.inMag++; st.reserve--;
          audio.play('shell_in', { ui: true, vol: 0.7 });
          if (st.inMag < def.mag && st.reserve > 0 && !inp.down('Mouse0')) { this.reloadT = def.reload; }
          else { this.vm.reloadT = 0; audio.play('pump', { ui: true, vol: 0.6 }); this.vm.pumpT = 1; }
        } else {
          const need = def.mag - st.inMag;
          const take = Math.min(need, st.reserve);
          st.inMag += take; st.reserve -= take;
          this.vm.reloadT = 0;
          audio.play('bolt', { ui: true, vol: 0.6 });
        }
      }
    }
    const wantReload = inp.pressed('KeyR') || (st.inMag === 0 && st.reserve > 0 && inp.pressed('Mouse0'));
    if (wantReload && this.reloadT <= 0 && !busy && def.mag > 0 && st.inMag < def.mag && st.reserve > 0) {
      this.reloadT = def.reload;
      (this as any)._magIn = false;
      audio.play(def.shellReload ? 'shell_in' : 'mag_out', { ui: true, vol: 0.7 });
      g.noise(this.pos, 3, 'reload', this);
    }

    // melee / takedown (V or knife primary)
    const meleeKey = inp.pressed('KeyV') || (def.id === 'knife' && inp.pressed('Mouse0'));
    if (meleeKey && this.fireCD <= 0 && !busy) {
      this.melee();
      return;
    }

    // fire
    const trigger = def.auto ? inp.down('Mouse0') : inp.pressed('Mouse0');
    if (trigger && this.fireCD <= 0 && !busy && def.id !== 'knife' && (this.reloadT <= 0 || (def.shellReload && st.inMag > 0))) {
      if (def.shellReload && this.reloadT > 0) { this.reloadT = 0; this.vm.reloadT = 0; }
      if (st.inMag <= 0) {
        audio.play('dryfire', { ui: true, vol: 0.6 });
        this.fireCD = 0.25;
      } else if (!this.sprinting || this.vm.sprint < 0.5) {
        this.fire();
      }
    }
    this.vm.update(dt, this.horizSpeed, inp.mouseDX, inp.mouseDY, this.grounded, def.scope === true && this.ads > 0.9);
  }

  private fire() {
    const g = this.game;
    const st = this.cur, def = st.def;
    st.inMag--;
    this.fireCD = 60 / def.rpm;
    this.shotsFired++;
    g.stats.shots++;
    const fwd = this.forward();
    const moveF = this.horizSpeed > 4 ? 2.2 : this.horizSpeed > 1 ? 1.4 : 1;
    const stanceF = this.stance === 'prone' ? 0.5 : this.stance === 'crouch' ? 0.75 : 1;
    const spread = THREE.MathUtils.lerp(def.hipSpread, def.adsSpread, this.ads) * moveF * stanceF * (1 + Math.min(1.5, this.recoilPitch * 0.08));
    const origin = this.eyePos.clone();
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    for (let i = 0; i < def.pellets; i++) {
      const sd = Math.tan(THREE.MathUtils.degToRad(spread));
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * sd;
      const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      g.fireBullet(origin, dir, def.damage, this, { tracer: def.tracerEvery > 0 && this.shotsFired % def.tracerEvery === 0, weapon: def.id, headMult: def.headMult, range: def.range });
    }
    // recoil
    const rk = def.recoil * (this.stance === 'crouch' ? 0.75 : this.stance === 'prone' ? 0.55 : 1) * (1 - this.ads * 0.3);
    this.recoilPitch += rk;
    this.pitch += THREE.MathUtils.degToRad(rk) * 0.55;
    this.yaw += THREE.MathUtils.degToRad((Math.random() - 0.5) * def.recoilYaw);
    this.vm.kick = 1;
    this.vm.kickRot = Math.min(1.5, this.vm.kickRot + rk * 0.2);
    this.shake = Math.min(1, this.shake + (def.suppressed ? 0.03 : def.pellets > 1 ? 0.5 : 0.12));
    // fx
    const mz = this.muzzleScreenWorld();
    if (!def.suppressed) {
      this.vm.muzzleFlash(def.pellets > 1 ? 0.45 : 0.3);
      g.muzzleFlashAt(mz);
      this.game.r.viewLight.intensity = 6;
    } else this.vm.muzzleFlash(0.08);
    this.muzzleT = def.suppressed ? 0.05 : 0.25;
    const right2 = right.clone().add(new THREE.Vector3(0, 0.2, 0));
    if (def.id !== 'ks12') g.fx.casing(this.eyePos.clone().add(fwd.clone().multiplyScalar(0.4)).add(right.clone().multiplyScalar(0.15)).add(new THREE.Vector3(0, -0.12, 0)), right2, new THREE.Vector3(0, 1, 0));
    audio.play(def.sound, { ui: true, vol: 1.0, wet: def.suppressed ? 0.45 : 1.0 });
    if (def.pump) { setTimeout(() => { audio.play('pump', { ui: true, vol: 0.6 }); this.vm.pumpT = 1; }, 350); }
    g.noise(this.pos, def.noise, def.suppressed ? 'suppressed' : 'gunshot', this);
  }

  /** Approximate muzzle point in the world (viewmodel lives in a separate scene). */
  muzzleScreenWorld(): THREE.Vector3 {
    const f = this.forward();
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return this.eyePos.clone().addScaledVector(f, 0.8).addScaledVector(right, 0.17 * (1 - this.ads)).add(new THREE.Vector3(0, -0.13 * (1 - this.ads) - 0.04, 0));
  }

  private melee() {
    const g = this.game;
    this.fireCD = 0.6;
    this.vm.meleeT = 1;
    audio.play('swing', { ui: true, vol: 0.6 });
    const f = this.forward();
    let best: Actor | null = null, bd = 1.9;
    for (const a of g.actors) {
      if (!a.alive) continue;
      const to = a.pos.clone().setY(a.pos.y + 1).sub(this.eyePos);
      const d = Math.hypot(to.x, to.z);
      if (d > bd) continue;
      to.normalize();
      if (f.x * to.x + f.z * to.z < 0.55) continue;
      best = a; bd = d;
    }
    if (!best) return;
    const af = best.forward;
    const toPlayer = this.pos.clone().sub(best.pos).setY(0).normalize();
    const behind = af.dot(toPlayer) < -0.25;
    const unaware = best.state !== 'combat' || !best.seesPlayer;
    if ((behind && best.state !== 'combat') || (unaware && best.civilian) || best.surrendered || (best.state !== 'combat' && best.awareness < 0.5)) {
      // silent takedown
      g.stats.takedowns++;
      audio.play('crunch', { ui: true, vol: 0.9 });
      g.fx.bloodSpray(best.eye.clone().add(new THREE.Vector3(0, -0.25, 0)), f, this.weapon === 'knife' ? 1.2 : 0.3);
      best.damage(9999, f, 'torso', true, 'knife');
      g.noise(best.pos, 2.5, 'body', this);
      g.hud.message('Silent takedown', 'good');
    } else {
      audio.play('punch', { ui: true, vol: 0.9 });
      g.fx.bloodSpray(best.eye.clone().add(new THREE.Vector3(0, -0.3, 0)), f, 0.6);
      best.damage(this.weapon === 'knife' ? 55 : 35, f, 'torso', true, 'knife');
      if (best.alive) best.pos.addScaledVector(new THREE.Vector3(f.x, 0, f.z), 0.4);
    }
  }

  private updateCamera(dt: number) {
    const g = this.game, cam = g.r.camera;
    // recoil recovery
    const rec = Math.min(this.recoilPitch, dt * 14);
    this.recoilPitch -= rec;
    if (!g.input.down('Mouse0')) this.pitch -= THREE.MathUtils.degToRad(rec) * 0.35;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const bobY = this.grounded ? Math.sin(this.bob * 2) * 0.035 * Math.min(1, this.horizSpeed / 5) * (1 - this.ads * 0.8) : 0;
    const land = -Math.sin((this.landT / 0.25) * Math.PI) * 0.12;
    this.eyePos.set(this.pos.x, this.pos.y + this.eyeH + bobY + land, this.pos.z).addScaledVector(right, this.leanOffset);
    if (this.stance === 'prone' && this.alive) {
      // prone eye sits slightly forward
      this.eyePos.x += -Math.sin(this.yaw) * 0.3;
      this.eyePos.z += -Math.cos(this.yaw) * 0.3;
    }
    cam.position.copy(this.eyePos);
    const sh = this.shake * this.shake * 0.04;
    cam.rotation.set(this.pitch + (Math.random() - 0.5) * sh, this.yaw + (Math.random() - 0.5) * sh, -this.lean * 0.26 + Math.sin(this.bob) * 0.006, 'YXZ');
    // FOV
    const def = WEAPONS[this.weapon];
    const base = g.settings.fov;
    const fov = THREE.MathUtils.lerp(base, def.adsFov * (base / 75), this.ads) + (this.sprinting && this.horizSpeed > 4 ? 6 : 0) + (this.slideT > 0 ? 8 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 14);
      cam.updateProjectionMatrix();
    }
    this.game.r.viewLight.intensity *= 0.8;
  }
}
