// Game session: owns the world, entities, rules, mission flow.
import * as THREE from 'three';
import { Physics } from '../world/physics';
import { Level, LevelLight } from '../world/level';
import { NavGrid } from '../world/nav';
import { Weather } from '../world/weather';
import { buildFacility, MissionLayout } from '../world/facility';
import { FX } from './fx';
import { Player } from './player';
import { Actor, AIDirector, rayActor, SpawnDef } from './ai';
import { Door, Pickup, PickupKind, Interactable, SecurityCamera, AlarmPanel, Thrown, Helicopter } from './entities';
import { MissionState, MissionDef } from './mission';
import { Difficulty } from './difficulty';
import type { Renderer } from '../core/render';
import type { Input } from '../core/input';
import type { HUD } from '../ui/hud';
import { audio } from '../core/audio';
import { WEAPONS, WeaponId } from './weapons';

export interface Settings { sensitivity: number; invertY: boolean; fov: number; volume: number; barks: boolean }

export interface Stats {
  shots: number; hits: number; kills: number; headshots: number; takedowns: number; civKills: number;
  alarms: number; timesSpotted: number; bodiesFound: number; camerasDestroyed: number; lightsShot: number;
}

export interface EndResult { success: boolean; reason: string; time: number; stats: Stats; mission: MissionState; diff: Difficulty }

const LIGHT_POWER_GROUPS = ['yard', 'gate', 'barracks', 'comms', 'security', 'pump', 'tunnel'];

export class Game {
  physics = new Physics();
  level: Level;
  nav = new NavGrid();
  fx: FX;
  weather!: Weather;
  player!: Player;
  actors: Actor[] = [];
  ai: AIDirector;
  doors: Door[] = [];
  pickups: Pickup[] = [];
  interacts: Interactable[] = [];
  cameras: SecurityCamera[] = [];
  panels: AlarmPanel[] = [];
  thrown: Thrown[] = [];
  heli!: Helicopter;
  mission: MissionState;
  layout!: MissionLayout;
  labEastDoor: Door | null = null;
  time = 0;
  alarm = { active: false, timer: 0, count: 0 };
  powerOn = true;
  commsDown = false;
  lockdown = false;
  ended = false;
  godMode = false;
  reinfWaves = 0;
  private pendingReinf = -1;
  private heliCallT = -1;
  private lightT = 0;
  private fogDensity = 0.016;
  private lastPromptKey = '';
  private extractMsgT = 0;
  private actorId = 0;
  private scheduled: { t: number; fn: () => void }[] = [];
  stats: Stats = { shots: 0, hits: 0, kills: 0, headshots: 0, takedowns: 0, civKills: 0, alarms: 0, timesSpotted: 0, bodiesFound: 0, camerasDestroyed: 0, lightsShot: 0 };
  onEnd: ((r: EndResult) => void) | null = null;

  constructor(public r: Renderer, public input: Input, public hud: HUD, public diff: Difficulty, public missionDef: MissionDef, public settings: Settings) {
    this.level = new Level(r.scene, this.physics);
    this.fx = new FX(r.scene, this.physics);
    this.ai = new AIDirector(this);
    this.mission = new MissionState(missionDef, diff.id);

    this.layout = buildFacility(this);
    this.level.finalize();

    // navigation (doors treated as open)
    for (const d of this.doors) for (const p of d.panels) p.box.enabled = false;
    const nb = this.layout.navBounds;
    this.nav.build(this.physics, nb[0], nb[1], nb[2], nb[3], nb[4], nb[5]);
    for (const d of this.doors) for (const p of d.panels) p.box.enabled = true;
    this.ai.panels = this.panels;

    for (const s of this.layout.spawns) {
      if (s.minDiff !== undefined && diff.id < s.minDiff) continue;
      if (s.maxDiff !== undefined && diff.id > s.maxDiff) continue;
      this.spawnActor(s);
    }

    this.player = new Player(this);
    this.player.pos.copy(this.layout.start);
    this.player.yaw = this.layout.startYaw;
    this.player.armor = diff.playerArmor;
    for (const st of this.player.inventory.values()) st.reserve = Math.round(st.reserve * diff.ammoMult);
    this.player.grenades = diff.id === 2 ? 1 : 2;

    this.weather = new Weather(r.scene, this.level);
    this.heli = new Helicopter(this, this.layout.extraction.clone().setY(0.3));
    this.fx.onCasingLand = (p) => audio.play('shell', { pos: p, vol: 0.35 });
    // initial lighting state
    for (const L of this.level.lights) this.level.setLightOn(L, true);
  }

  spawnActor(s: SpawnDef) {
    const a = new Actor(this, s, this.actorId++);
    this.actors.push(a);
    return a;
  }

  // ------------------------------------------------------------------ builders used by the level script
  addDoor(x: number, z: number, y0: number, w: number, h: number, axis: 'x' | 'z', lock: 'blue' | 'red' | 'sealed' | null = null, label = 'Door', style: 'metal' | 'vault' = 'metal') {
    const d = new Door(this, x, z, y0, w, h, axis, lock, style, label);
    this.doors.push(d);
    return d;
  }
  addPickup(kind: PickupKind, pos: THREE.Vector3, data: any, label: string) {
    const p = new Pickup(this, kind, pos, data, label);
    this.pickups.push(p);
    return p;
  }
  addInteract(pos: THREE.Vector3, label: string, hold: number, fn: () => void, radius = 1.8, sound = 'typing') {
    const i = new Interactable(pos, label, hold, fn, radius, sound);
    this.interacts.push(i);
    return i;
  }
  addCamera(pos: THREE.Vector3, yaw: number, sweep: number) {
    const c = new SecurityCamera(this, pos, yaw, sweep);
    this.cameras.push(c);
    return c;
  }
  addPanel(pos: THREE.Vector3, stand: THREE.Vector3, facing: number) {
    const p = new AlarmPanel(this, pos, stand, facing);
    this.panels.push(p);
    const it = this.addInteract(pos.clone(), 'Disable alarm panel', 2, () => { p.disable(); this.hud.message('Alarm panel disabled', 'good'); }, 1.6, 'spark');
    (p as any).interact = it;
    return p;
  }

  schedule(delay: number, fn: () => void) { this.scheduled.push({ t: this.time + delay, fn }); }

  // ------------------------------------------------------------------ queries
  surfaceAt(p: THREE.Vector3): string {
    const h = this.physics.raycast(p.x, p.y + 0.3, p.z, 0, -1, 0, 1.2, 'solid');
    return h ? h.box.surface : 'snow';
  }

  occlusion(p: THREE.Vector3): number {
    const e = this.player.eyePos;
    return this.physics.los(e.x, e.y, e.z, p.x, p.y + 0.5, p.z, 'sight') ? 0 : 0.75;
  }

  /** Stealth exposure at a point (0 = pitch black, 1 = floodlit). */
  lightAt(p: THREE.Vector3): number {
    const indoor = this.level.isIndoor(p.x, p.y, p.z);
    let v = indoor ? 0.03 : 0.13;
    const cands: { L: LevelLight; c: number }[] = [];
    for (const L of this.level.lights) {
      if (!L.on || L.stealthWeight <= 0) continue;
      const d = L.pos.distanceTo(p);
      if (d > L.range) continue;
      const f = 1 - d / L.range;
      cands.push({ L, c: L.intensity * L.stealthWeight * f * f * 0.95 });
    }
    cands.sort((a, b) => b.c - a.c);
    let tests = 0;
    for (const { L, c } of cands) {
      if (c < 0.02) break;
      if (tests++ > 6) break;
      if (this.physics.los(L.pos.x, L.pos.y - 0.25, L.pos.z, p.x, p.y, p.z, 'sight')) v += c;
    }
    if (this.player && this.player.muzzleT > 0) v += 0.7;
    return Math.min(1, v);
  }

  // ------------------------------------------------------------------ combat
  fireBullet(origin: THREE.Vector3, dir: THREE.Vector3, dmg: number, owner: any, opts: { tracer?: boolean; weapon?: string; headMult?: number; range?: number } = {}) {
    const range = opts.range ?? 200;
    const fromPlayer = owner === this.player;
    const hit = this.physics.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, 'bullet');
    let tMax = hit ? hit.t : range;
    let target: Actor | null = null;
    let zone: 'head' | 'torso' | 'legs' = 'torso';
    for (const a of this.actors) {
      if (a === owner || !a.alive) continue;
      if (Math.abs(a.pos.x - origin.x) > tMax + 2 && Math.abs(a.pos.z - origin.z) > tMax + 2) continue;
      const h = rayActor(a, origin, dir, tMax);
      if (h && h.t < tMax) { tMax = h.t; target = a; zone = h.zone; }
    }
    // player hit test for enemy fire
    let hitPlayer = false;
    if (!fromPlayer && this.player.alive) {
      const P = this.player;
      const top = P.pos.y + P.height;
      const lx = P.eyePos.x - P.pos.x, lz = P.eyePos.z - P.pos.z;
      const boxes = [
        [P.pos.x - 0.3, P.pos.y, P.pos.z - 0.3, P.pos.x + 0.3, top - 0.4, P.pos.z + 0.3],
        [P.pos.x + lx - 0.2, top - 0.45, P.pos.z + lz - 0.2, P.pos.x + lx + 0.2, top + 0.05, P.pos.z + lz + 0.2],
      ];
      if (P.stance === 'prone') {
        const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
        boxes[0] = [P.pos.x - 0.6 + fx * 0.3 - 0.3, P.pos.y, P.pos.z - 0.6 + fz * 0.3 - 0.3, P.pos.x + 0.6 + fx * 0.3 + 0.3, P.pos.y + 0.4, P.pos.z + 0.6 + fz * 0.3 + 0.3];
      }
      for (const b of boxes) {
        const t = rayAABB(origin, dir, b);
        if (t !== null && t < tMax) { tMax = t; hitPlayer = true; target = null; }
      }
      // near-miss whiz
      if (!hitPlayer) {
        const e = P.eyePos;
        const toE = e.clone().sub(origin);
        const along = toE.dot(dir);
        if (along > 0 && along < tMax) {
          const closest = origin.clone().addScaledVector(dir, along);
          const dd = closest.distanceTo(e);
          if (dd < 1.4) {
            audio.play('ricochet', { pos: closest, vol: 0.35, rate: 1.4 });
            P.shake = Math.min(1, P.shake + 0.08);
          }
        }
      }
    }
    const end = origin.clone().addScaledVector(dir, tMax);
    if (opts.tracer) this.fx.tracer(fromPlayer ? this.player.muzzleScreenWorld() : origin, end);

    if (hitPlayer) {
      const mult = 1;
      this.player.hurt(dmg * mult, origin);
      return;
    }
    if (target) {
      const headMult = opts.headMult ?? 2.5;
      const mult = zone === 'head' ? headMult : zone === 'legs' ? 0.65 : 1;
      let damage = dmg * mult;
      if (!fromPlayer && !target.civilian) damage *= 0.4; // friendly fire is real but reduced
      const wasAlive = target.alive;
      target.damage(damage, dir, zone, fromPlayer, opts.weapon);
      this.fx.bloodSpray(end, dir, zone === 'head' ? 1.4 : 1, zone === 'head');
      audio.play('hit_flesh', { pos: end, vol: 0.8 });
      if (fromPlayer) {
        this.stats.hits++;
        this.hud.hitmarker(wasAlive && !target.alive, zone === 'head');
        if (zone === 'head' && wasAlive && !target.alive) this.stats.headshots++;
      }
      return;
    }
    if (hit) {
      const n = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
      const owner2 = hit.box.owner;
      if (owner2 && (owner2 as LevelLight).range !== undefined && (owner2 as LevelLight).pos) {
        const L = owner2 as LevelLight;
        if (this.level.breakLight(L)) {
          audio.play('glass', { pos: L.pos, vol: 0.9 });
          this.fx.glassBurst(L.pos);
          this.noise(L.pos, 12, 'glass', owner);
          if (fromPlayer) this.stats.lightsShot++;
        }
        return;
      }
      if (owner2 instanceof SecurityCamera) { owner2.destroy(); this.noise(owner2.pos, 8, 'glass', owner); return; }
      this.fx.impact(end, n, hit.box.surface);
      const s = hit.box.surface;
      const snd = s === 'metal' ? 'hit_metal' : s === 'snow' || s === 'dirt' ? 'hit_snow' : 'hit_concrete';
      audio.play(snd, { pos: end, vol: 0.7, occlusion: this.occlusion(end) });
      if ((s === 'metal' || s === 'concrete' || s === 'rock') && Math.random() < 0.12) audio.play('ricochet', { pos: end, vol: 0.4 });
      if (fromPlayer) this.noise(end, s === 'metal' ? 9 : 6, 'impact', owner);
    }
  }

  noise(pos: THREE.Vector3, radius: number, kind: string, source: any) {
    if (radius <= 0) return;
    for (const a of this.actors) {
      if (!a.alive || a === source) continue;
      const d = a.pos.distanceTo(pos);
      let r = radius * this.diff.hearing;
      if (d > r) continue;
      if (kind !== 'gunshot' && kind !== 'explosion' && !this.physics.los(a.pos.x, a.pos.y + 1.6, a.pos.z, pos.x, pos.y + 0.5, pos.z)) {
        r *= 0.55;
        if (d > r) continue;
      }
      a.hear(pos.clone(), kind === 'suppressed' ? 'impact' : kind, source);
    }
  }

  muzzleFlashAt(p: THREE.Vector3) {
    this.r.muzzleLight.position.copy(p);
    this.r.muzzleLight.intensity = 10;
  }

  throwGrenade(from: THREE.Vector3, target: THREE.Vector3 | null, owner: any, kind: 'frag' | 'noise', vel?: THREE.Vector3) {
    let v = vel;
    if (!v && target) {
      const d = Math.hypot(target.x - from.x, target.z - from.z);
      const t = Math.min(1.6, Math.max(0.7, d / 12));
      v = new THREE.Vector3((target.x - from.x) / t, (target.y - from.y) / t + 0.5 * 14 * t, (target.z - from.z) / t);
    }
    const th = new Thrown(this, from.clone(), v ?? new THREE.Vector3(), owner, kind);
    this.thrown.push(th);
  }

  explode(p: THREE.Vector3, owner: any) {
    this.fx.explosion(p);
    audio.play('explosion', { pos: p, vol: 1.3, refDist: 14, wet: 1.2 });
    this.r.muzzleLight.position.copy(p).add(new THREE.Vector3(0, 0.8, 0));
    this.r.muzzleLight.intensity = 60;
    this.noise(p, 90, 'explosion', owner);
    const R = 7.5;
    for (const a of this.actors) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(p);
      if (d > R) continue;
      if (!this.physics.los(p.x, p.y + 0.3, p.z, a.pos.x, a.pos.y + 1, a.pos.z)) continue;
      const dmg = 220 * Math.pow(1 - d / R, 1.3);
      const dir = a.pos.clone().sub(p).normalize();
      const alive = a.alive;
      a.damage(dmg, dir, 'torso', owner === this.player, 'frag');
      if (alive && !a.alive) {
        this.fx.bloodSpray(a.pos.clone().setY(a.pos.y + 1), dir, 3);
        if (owner === this.player) this.hud.hitmarker(true, false);
      }
    }
    const P = this.player;
    const d = P.pos.distanceTo(p);
    if (d < R && this.physics.los(p.x, p.y + 0.3, p.z, P.eyePos.x, P.eyePos.y, P.eyePos.z)) P.hurt(160 * Math.pow(1 - d / R, 1.4), p);
    P.shake = Math.min(1, P.shake + Math.max(0, 1 - d / 25));
    for (const L of this.level.lights) if (L.pos.distanceTo(p) < 5) this.level.breakLight(L);
    for (const c of this.cameras) if (c.pos.distanceTo(p) < 4) c.destroy();
  }

  // ------------------------------------------------------------------ events
  raiseAlarm(reason: string, scripted = false) {
    if (this.alarm.active) { this.alarm.timer = Math.max(this.alarm.timer, 60); return; }
    this.alarm.active = true;
    this.alarm.timer = scripted ? 1e9 : 75;
    if (!scripted) {
      this.alarm.count++;
      this.stats.alarms++;
      if (this.alarm.count > 1 && this.mission.fail('alarm')) this.objectiveFailed('Too many alarms raised');
    }
    this.hud.alarm(true, reason);
    audio.setSiren(true);
    for (const a of this.actors) {
      if (!a.alive || a.civilian) continue;
      a.alert = 1;
      if (a.state !== 'combat' && a.state !== 'alarm') {
        a.lastKnown = this.player.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20));
        if (!a.spawn.post) a.setState('search');
      }
    }
    if (!this.commsDown && this.reinfWaves < this.diff.reinforcements && this.pendingReinf < 0) {
      this.pendingReinf = this.time + 18;
      this.hud.radio('CONTROL', 'They\'re radioing for reinforcements. Should have cut their comms.');
    } else if (this.commsDown && !scripted) {
      this.hud.radio('CONTROL', 'Alarm\'s up, but with their comms dead nobody outside can hear it.');
    }
  }

  spawnReinforcements(n: number, at: THREE.Vector3) {
    for (let i = 0; i < n; i++) {
      const kind = i === 0 && this.diff.id >= 1 ? 'heavy' : 'merc';
      const a = this.spawnActor({ kind: kind as any, x: at.x + (i % 3) * 1.2 - 1.2, z: at.z + Math.floor(i / 3) * 1.4, y: at.y, squad: 'reinf' + this.reinfWaves, hunter: true, name: 'Chernobog trooper' });
      a.lastKnown = this.player.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12));
      a.stateT = 0;
    }
  }

  setPower(on: boolean) {
    this.powerOn = on;
    for (const L of this.level.lights) if (LIGHT_POWER_GROUPS.includes(L.group)) this.level.setLightOn(L, on);
    audio.play(on ? 'beep' : 'spark', { pos: this.player.pos, vol: 1 });
    this.hud.message(on ? 'Power restored' : 'Power cut. The base is dark.', on ? 'info' : 'good');
    if (!on) {
      this.hud.radio('CONTROL', 'Lights out. Your goggles will love this. Their flashlights will come on, so watch for beams.');
      for (const a of this.actors) if (a.alive && !a.civilian) a.alert = Math.max(a.alert, 0.5);
      // two closest guards go check the generator
      const gen = new THREE.Vector3(43, 0, 8.5);
      const near = this.actors.filter((a) => a.alive && !a.civilian && (a.state === 'patrol' || a.state === 'guard')).sort((x, y) => x.pos.distanceTo(gen) - y.pos.distanceTo(gen)).slice(0, 2);
      for (const a of near) { a.stimulus = gen.clone(); a.setState('investigate'); a.say('investigate', true); }
    }
    // generator interactable label toggles
    const it = this.interacts.find((i) => i.label.includes('generator') || i.label.includes('power'));
    if (it) { it.enabled = true; it.done = false; it.progress = 0; it.label = on ? 'Kill the power (generator)' : 'Restore power (generator)'; }
  }

  sabotageComms() {
    this.commsDown = true;
    this.pendingReinf = -1;
    this.fx.glassBurst(new THREE.Vector3(50, 1.4, -3.4));
    audio.play('spark', { pos: this.player.pos, vol: 1 });
    for (const L of this.level.lights) if (L.group === 'comms' && L.flicker) this.level.setLightOn(L, false);
    this.objectiveDone('comms', 'Comms array sabotaged');
    this.hud.radio('CONTROL', 'Good. Their radio net is dead. If they want help now, they\'ll have to shout for it.');
  }

  disableCameras() {
    for (const c of this.cameras) c.disable();
    this.hud.message('Security cameras offline', 'good');
    audio.play('beep', { ui: true });
  }

  downloadData() {
    this.objectiveDone('data', 'VESNA research data downloaded');
    this.hud.radio('CONTROL', 'Data received. Orlov\'s notes are... thorough. God help us.');
  }

  onPrototype() {
    this.objectiveDone('prototype', 'VESNA prototype secured');
    this.lockdown = true;
    this.hud.radio('CONTROL', 'You tripped a weight sensor. They know. The whole base is coming for you. Helicopter is inbound to the helipad, get topside!');
    this.raiseAlarm('LOCKDOWN - prototype removed', true);
    if (this.labEastDoor) { this.labEastDoor.locked = null; this.labEastDoor.setLockLight(0x22ff66); this.labEastDoor.use(false); }
    const n = [2, 4, 6][this.diff.id];
    this.spawnReinforcements(Math.ceil(n / 2), new THREE.Vector3(-10, 0, -40));
    this.reinfWaves++;
    this.schedule(6, () => this.spawnReinforcements(Math.floor(n / 2), new THREE.Vector3(0, 0, 25)));
    this.heliCallT = this.time + 16;
  }

  onHeliLanded() {
    this.hud.radio('PILOT', 'Raven-One on the pad. Move your ass, we are not staying long!');
    this.hud.message('Extraction helicopter landed at the helipad', 'good');
  }

  objectiveDone(id: string, msg: string) {
    if (this.mission.complete(id)) {
      this.hud.message('OBJECTIVE COMPLETE: ' + msg, 'objective');
      audio.play('objective', { ui: true, vol: 0.8 });
      this.hud.flashObjectives();
    }
  }

  objectiveFailed(msg: string) {
    this.hud.message('OBJECTIVE FAILED: ' + msg, 'fail');
    audio.play('fail', { ui: true, vol: 0.8 });
    this.hud.flashObjectives();
  }

  onActorKilled(a: Actor, zone: string) {
    if (a.hitByPlayer) {
      if (a.civilian) this.stats.civKills++;
      else this.stats.kills++;
    }
    if (a.civilian && a.hitByPlayer) {
      this.noise(a.pos, 16, 'scream', a);
      if (this.mission.has('civ0') && this.mission.fail('civ0')) this.objectiveFailed('A scientist was killed');
      if (this.mission.has('civ2') && this.stats.civKills > 2 && this.mission.fail('civ2')) this.objectiveFailed('Too many scientists killed');
    }
    // drops
    const p = a.pos.clone();
    if (a.weapon) {
      const map: Record<string, [WeaponId | null, string, number]> = {
        rifle: ['ar74', '545', 18], smg: ['kr5', '9mm', 20], shotgun: ['ks12', '12g', 6], pistol: [null, '9mm', 10], sniper: ['vs9', '939', 6],
      };
      const [wid, type, n] = map[a.weapon.name];
      const drop = p.clone().add(new THREE.Vector3(Math.random() - 0.5, 0.05, Math.random() - 0.5));
      if (wid) this.addPickup('weapon', drop, { id: wid, ammo: Math.round(n * this.diff.ammoMult), dropped: true }, WEAPONS[wid].name);
      else this.addPickup('ammo', drop, { type, n }, '9mm rounds');
    }
    if (a.key) this.addPickup('key', p.clone().add(new THREE.Vector3(0.4, 0.05, 0.3)), { color: a.key }, a.key.toUpperCase() + ' keycard');
    if (a.grenades > 0 && Math.random() < 0.5) this.addPickup('grenade', p.clone().add(new THREE.Vector3(-0.4, 0.05, 0.2)), { n: 1 }, 'Frag grenade');
  }

  onPlayerDied() {
    this.hud.dead();
    audio.play('fail', { ui: true });
    this.schedule(3.5, () => this.end(false, 'Agent KIA'));
  }

  end(success: boolean, reason: string) {
    if (this.ended) return;
    this.ended = true;
    audio.stopAll();
    this.onEnd?.({ success, reason, time: this.time, stats: this.stats, mission: this.mission, diff: this.diff });
  }

  // ------------------------------------------------------------------ interaction
  private holding: Interactable | null = null;
  updateInteraction(dt: number, holding: boolean, pressed: boolean) {
    const P = this.player;
    const f = P.forward();
    let prompt: string | null = null;
    let progress = -1;
    // doors
    let bestDoor: Door | null = null, bd = 2.6;
    for (const d of this.doors) {
      if (d.target === 1 && d.open > 0.5) continue;
      const to = d.center.clone().sub(P.eyePos);
      const dist = Math.hypot(to.x, to.z);
      if (dist > bd || Math.abs(to.y) > 2) continue;
      to.normalize();
      if (f.dot(to) < 0.5) continue;
      bd = dist; bestDoor = d;
    }
    // interactables
    let best: Interactable | null = null, bi = Infinity;
    for (const it of this.interacts) {
      if (!it.enabled) continue;
      const to = it.pos.clone().sub(P.eyePos);
      const dist = to.length();
      if (dist > it.radius + 0.6) continue;
      to.normalize();
      if (f.dot(to) < 0.55) continue;
      if (dist < bi) { bi = dist; best = it; }
    }
    if (best && (!bestDoor || bi < bd)) {
      prompt = `[F] Hold: ${best.label}`;
      if (holding) {
        if (this.holding !== best) { this.holding = best; best.progress = 0; }
        best.progress += dt;
        if (Math.floor((best.progress - dt) / 0.5) !== Math.floor(best.progress / 0.5)) audio.play(best.sound, { pos: best.pos, vol: 0.5 });
        progress = Math.min(1, best.progress / best.holdTime);
        if (best.progress >= best.holdTime) {
          best.enabled = false;
          best.done = true;
          this.holding = null;
          best.onComplete();
          this.noise(best.pos, 4, 'impact', P);
        }
      } else if (this.holding) { this.holding.progress = 0; this.holding = null; }
    } else if (bestDoor) {
      prompt = bestDoor.locked ? `[F] ${bestDoor.label} (${bestDoor.locked === 'sealed' ? 'sealed' : bestDoor.locked.toUpperCase() + ' keycard'})` : '[F] Open door';
      if (pressed) {
        const msg = bestDoor.use(true);
        if (msg) this.hud.message(msg, 'warn');
      }
    } else if (this.holding) { this.holding.progress = 0; this.holding = null; }
    this.hud.prompt(prompt, progress);
  }

  // ------------------------------------------------------------------ pickups
  private collect(p: Pickup) {
    const P = this.player;
    const d = p.data;
    switch (p.kind) {
      case 'weapon': {
        const fresh = P.give(d.id, d.ammo ?? 0);
        if (fresh) { this.hud.message('Picked up ' + WEAPONS[d.id as WeaponId].name, 'good'); if (!d.dropped) P.equip(d.id); }
        else this.hud.message('+' + d.ammo + ' ' + WEAPONS[d.id as WeaponId].name + ' ammo', 'info');
        break;
      }
      case 'ammo': if (!P.addAmmo(d.type, Math.round(d.n * this.diff.ammoMult))) return; this.hud.message('+' + p.label, 'info'); break;
      case 'armor': if (P.armor >= 100) return; P.armor = Math.min(100, P.armor + d.n); this.hud.message('Body armor', 'good'); break;
      case 'medkit': if (P.health >= 100) return; P.health = Math.min(100, P.health + d.n); this.hud.message('Medkit', 'good'); break;
      case 'grenade': P.grenades += d.n; this.hud.message('+' + d.n + ' frag grenade' + (d.n > 1 ? 's' : ''), 'info'); break;
      case 'noisemaker': P.noisemakers += d.n; this.hud.message('+' + d.n + ' noisemakers', 'info'); break;
      case 'key': P.keys.add(d.color); this.hud.message('Acquired ' + d.color.toUpperCase() + ' keycard', 'good'); break;
      case 'intel': this.objectiveDone('intel', 'Chernobog contract recovered'); if (!this.mission.has('intel')) this.hud.message('Contract files (intel)', 'good'); this.hud.radio('CONTROL', 'Forty million euros for one weapon. Somebody in Moscow signed this.'); break;
      case 'prototype': this.onPrototype(); break;
    }
    audio.play('pickup', { ui: true, vol: 0.7 });
    p.remove();
  }

  // ------------------------------------------------------------------ main update
  update(dt: number) {
    if (this.ended) return;
    this.time += dt;
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      if (this.time >= this.scheduled[i].t) { const s = this.scheduled[i]; this.scheduled.splice(i, 1); s.fn(); }
    }
    const P = this.player;
    P.update(dt);
    this.ai.update(dt);
    for (const a of this.actors) a.update(dt);
    for (const d of this.doors) d.update(dt);
    for (const c of this.cameras) c.update(dt);
    for (let i = this.thrown.length - 1; i >= 0; i--) if (this.thrown[i].update(dt)) this.thrown.splice(i, 1);
    this.heli.update(dt);

    // pickups
    if (P.alive) for (const p of this.pickups) {
      if (p.taken) continue;
      p.update(dt);
      if (Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z) < 1.2 && p.pos.y - P.pos.y > -0.6 && p.pos.y - P.pos.y < 1.7) this.collect(p);
    }

    // alarm
    if (this.alarm.active) {
      this.alarm.timer -= dt;
      if (this.alarm.timer <= 0) {
        this.alarm.active = false;
        this.hud.alarm(false, '');
        audio.setSiren(false);
        this.hud.message('Alarm has ended', 'info');
      }
    }
    if (this.pendingReinf > 0 && this.time > this.pendingReinf) {
      this.pendingReinf = -1;
      if (!this.commsDown) {
        this.reinfWaves++;
        this.spawnReinforcements(this.diff.id === 2 ? 5 : 3, this.layout.reinforcementPoint);
        this.hud.message('Enemy reinforcements have arrived!', 'warn');
      }
    }
    if (this.heliCallT > 0 && this.time > this.heliCallT) {
      this.heliCallT = -1;
      this.heli.call();
      this.hud.radio('PILOT', 'Raven-One inbound. Fifteen seconds. Get to the pad!');
    }
    // extraction
    this.extractMsgT -= dt;
    if (this.heli.state === 'landed' && P.alive && P.pos.distanceTo(this.layout.extraction) < 7) {
      const pend = this.mission.pendingTasks();
      if (pend.length === 0) {
        this.mission.complete('extract');
        this.hud.message('EXTRACTED', 'objective');
        audio.play('objective', { ui: true });
        this.end(true, 'Mission complete');
        return;
      } else if (this.extractMsgT <= 0) {
        this.extractMsgT = 4;
        this.hud.message('Cannot extract. Incomplete: ' + pend.map((o) => o.text.split(' (')[0]).join(' / '), 'warn');
      }
    }

    // stealth light
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.1;
      const lp = P.pos.clone().setY(P.pos.y + P.height * 0.6);
      const target = this.lightAt(lp);
      P.light += (target - P.light) * 0.5;
    }

    // ---- render sync
    const cam = this.r.camera;
    const f = P.forward();
    audio.setListener(cam.position, f, new THREE.Vector3(0, 1, 0));
    const indoor = this.level.isIndoor(cam.position.x, cam.position.y, cam.position.z);
    audio.setIndoor(indoor ? 1 : 0);
    audio.heartbeat(dt, P.health / 100);
    this.r.updateLights(this.level.lights, cam.position, this.time, this.alarm.active);
    this.updateFlashlights();
    this.r.followShadow(P.pos);
    const fogT = indoor ? 0.008 : P.nvg ? 0.012 : 0.017;
    this.fogDensity += (fogT - this.fogDensity) * Math.min(1, dt * 2);
    this.r.fog.density = this.fogDensity;
    this.fx.setFog(this.r.fog.color, this.fogDensity);
    this.fx.setScale(window.innerHeight);
    this.r.muzzleLight.intensity *= Math.pow(0.0001, dt);
    this.fx.update(dt);
    this.weather.update(dt, cam.position, this.time);
    const gu = this.r.grade.uniforms;
    gu.uNV.value += ((P.nvg ? 1 : 0) - gu.uNV.value) * Math.min(1, dt * 10);
    gu.uDamage.value = P.damageFlash * 0.8 + (P.health < 30 && P.alive ? (0.25 + Math.sin(this.time * 5) * 0.1) : 0) + (P.alive ? 0 : 0.6);
    gu.uAlarm.value = this.alarm.active ? (Math.sin(this.time * 6) * 0.5 + 0.5) * 0.25 : 0;
    this.r.bloom.strength = P.nvg ? 0.9 : 0.55;
    const vh = this.r.viewScene.children[0] as THREE.HemisphereLight;
    vh.intensity = 0.9 + P.light * 2.4 + (P.nvg ? 1.2 : 0);
    this.hud.update(this, dt);
  }

  private updateFlashlights() {
    const P = this.player;
    const lit = this.actors.filter((a) => a.alive && a.flashlightOn).sort((a, b) => a.pos.distanceToSquared(P.pos) - b.pos.distanceToSquared(P.pos));
    const pool = this.r.spotPool;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      const a = lit[i];
      if (!a) { s.intensity = 0; continue; }
      const p = a.rig.light.getWorldPosition(new THREE.Vector3());
      s.position.copy(p);
      const yaw = a.yaw + a.anim.lookYaw;
      const pitch = a.anim.pitch - 0.12;
      s.target.position.set(p.x + Math.sin(yaw) * Math.cos(pitch) * 10, p.y + Math.sin(pitch) * 10, p.z + Math.cos(yaw) * Math.cos(pitch) * 10);
      s.intensity = 45;
    }
  }

  dispose() {
    audio.stopAll();
    const sc = this.r.scene;
    const keep = new Set<THREE.Object3D>([this.r.camera, this.r.moon, this.r.moon.target, this.r.ambient, this.r.muzzleLight, ...this.r.pool, ...this.r.spotPool, ...this.r.spotPool.map((s) => s.target)]);
    for (const o of [...sc.children]) if (!keep.has(o)) sc.remove(o);
    sc.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !keep.has(o)) m.geometry.dispose();
    });
    this.player.vm.root.removeFromParent();
  }
}

function rayAABB(o: THREE.Vector3, d: THREE.Vector3, b: number[]): number | null {
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const oo = i === 0 ? o.x : i === 1 ? o.y : o.z;
    const dd = i === 0 ? d.x : i === 1 ? d.y : d.z;
    const mn = b[i], mx = b[i + 3];
    if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) return null; continue; }
    let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
