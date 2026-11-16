// Enemy & civilian AI: perception (sight w/ light, stance, exposure; hearing), FSM, cover,
// squad tactics (suppress / flank / assault), alarms, grenades, body discovery.
import * as THREE from 'three';
import { buildHumanoid, animate, newAnim, Rig, AnimState, Outfit } from './characters';
import { audio } from '../core/audio';
import type { Game } from './game';
import type { NavPoint } from '../world/nav';
import { getConeMaterial } from '../world/level';

export type AIState = 'patrol' | 'guard' | 'suspicious' | 'investigate' | 'combat' | 'search' | 'alarm' | 'flee' | 'cower' | 'dead';

export interface SpawnDef {
  kind: Outfit;
  x: number; z: number; y?: number;
  yaw?: number;
  patrol?: [number, number, number?][];
  squad: string;
  minDiff?: number;
  maxDiff?: number;
  key?: 'blue' | 'red';
  name?: string;
  flashlight?: boolean;
  /** Stays at post (no patrol), e.g. tower guard */
  post?: boolean;
  /** Reinforcement spawned during play */
  hunter?: boolean;
}

interface EnemyWeapon { name: string; damage: number; rpm: number; burst: [number, number]; spread: number; sound: string; mag: number; reload: number; pellets: number; drop: string; range: number }

const EWEAPONS: Record<string, EnemyWeapon> = {
  rifle: { name: 'rifle', damage: 11, rpm: 600, burst: [3, 6], spread: 1, sound: 'rifle', mag: 30, reload: 2.4, pellets: 1, drop: 'ar74', range: 70 },
  smg: { name: 'smg', damage: 8, rpm: 850, burst: [4, 8], spread: 1.3, sound: 'smg', mag: 32, reload: 2, pellets: 1, drop: 'kr5', range: 45 },
  shotgun: { name: 'shotgun', damage: 7, rpm: 70, burst: [1, 1], spread: 4, sound: 'shotgun', mag: 6, reload: 3, pellets: 7, drop: 'ks12', range: 22 },
  pistol: { name: 'pistol', damage: 9, rpm: 260, burst: [2, 3], spread: 1.2, sound: 'pistol', mag: 8, reload: 1.6, pellets: 1, drop: 'sp9ammo', range: 40 },
  sniper: { name: 'sniper', damage: 38, rpm: 40, burst: [1, 1], spread: 0.35, sound: 'sniper', mag: 5, reload: 3, pellets: 1, drop: 'vs9ammo', range: 140 },
};

const BARKS = {
  suspicious: ['Hm? Who is there?', 'Did you hear that?', 'Something moved...', 'Chto eto bylo?'],
  investigate: ['Checking it out.', 'Going to take a look.', 'Stay sharp, I am checking.'],
  calm: ['Must be the wind.', 'Nothing. Fucking rats.', 'Nothing here. Back to post.'],
  spotted: ['Contact! Intruder!', 'There! Shoot him!', 'Blyat! Contact!', 'Enemy spotted!'],
  flank: ['Flanking left!', 'Moving around!', 'I will get behind him!'],
  suppress: ['Suppressing! Go, go!', 'Keep his head down!'],
  reload: ['Reloading!', 'Cover me, reloading!'],
  grenade: ['Grenade out!', 'Granata!', 'Frag out!'],
  lost: ['Where did he go?', 'I lost him!', 'Search the area!'],
  body: ['Man down! We have a body!', 'Blyat, they killed Sasha!', 'Body here! Someone is inside the base!'],
  alarm: ['Hitting the alarm!', 'Sounding the alarm!'],
  pain: ['Argh!', 'I am hit!', 'Fuck!'],
  flee: ['Help! Guards!', 'Don\'t shoot! Please!', 'Security! Security!'],
  retreat: ['Falling back!', 'I need cover!'],
  hunt: ['Spread out. Find him.', 'He is still here. Kill him on sight.'],
};
function pick<T>(a: T[]) { return a[(Math.random() * a.length) | 0]; }

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

let flashConeGeo: THREE.CylinderGeometry | null = null;

export class Actor {
  id: number;
  rig: Rig;
  anim: AnimState = newAnim();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  targetYaw = 0;
  health = 100;
  maxHealth = 100;
  alive = true;
  civilian: boolean;
  weapon: EnemyWeapon | null;
  state: AIState = 'patrol';
  stateT = 0;
  awareness = 0;
  alert = 0;               // personal alertness 0..1
  lastKnown: THREE.Vector3 | null = null;
  lastSeenT = -999;
  seesPlayer = false;
  visFrac = 0;
  stimulus: THREE.Vector3 | null = null;
  path: NavPoint[] | null = null;
  pathIdx = 0;
  pathGoal: THREE.Vector3 | null = null;
  pathPending = false;
  repathT = 0;
  patrol: THREE.Vector3[] = [];
  patrolIdx = 0;
  waitT = 0;
  homeYaw = 0;
  home = new THREE.Vector3();
  cover: THREE.Vector3 | null = null;
  coverT = 0;
  inCover = false;
  peekT = 0;
  role: 'assault' | 'flank' | 'suppress' = 'assault';
  fireT = 0;
  burstLeft = 0;
  burstPause = 0;
  reactT = 0;
  aimSettle = 0;
  ammo = 30;
  reloadT = 0;
  grenades = 0;
  flashlightOn = false;
  flashCone: THREE.Mesh | null = null;
  crouching = false;
  percT = Math.random() * 0.15;
  speakT = 0;
  deadT = 0;
  bodyFound = false;
  key: 'blue' | 'red' | null = null;
  radioT = -1;
  alarmPanel: any = null;
  spawn: SpawnDef;
  moveSpeed = 0;
  stuckT = 0;
  lastPos = new THREE.Vector3();
  headless = false;
  hitByPlayer = false;
  lookSweep = Math.random() * 10;
  surrendered = false;

  constructor(public game: Game, def: SpawnDef, id: number) {
    this.id = id;
    this.spawn = def;
    this.civilian = def.kind === 'scientist';
    this.rig = buildHumanoid(def.kind);
    game.r.scene.add(this.rig.root);
    const y = def.y ?? 0;
    this.pos.set(def.x, y, def.z);
    this.home.copy(this.pos);
    this.yaw = this.targetYaw = this.homeYaw = def.yaw ?? 0;
    const d = game.diff;
    const hpBase = def.kind === 'heavy' ? 160 : def.kind === 'officer' ? 90 : def.kind === 'scientist' ? 45 : def.kind === 'sniper' ? 80 : 100;
    this.health = this.maxHealth = hpBase * (this.civilian ? 1 : d.enemyHealth);
    this.weapon = this.civilian ? null : def.kind === 'heavy' ? EWEAPONS.shotgun : def.kind === 'officer' ? EWEAPONS.pistol : def.kind === 'sniper' ? EWEAPONS.sniper : (id % 3 === 0 ? EWEAPONS.smg : EWEAPONS.rifle);
    this.ammo = this.weapon?.mag ?? 0;
    this.grenades = !this.civilian && d.tactics >= 1 && def.kind !== 'sniper' ? 1 : 0;
    this.key = def.key ?? null;
    if (def.patrol) for (const p of def.patrol) this.patrol.push(new THREE.Vector3(p[0], p[2] ?? y, p[1]));
    this.state = this.civilian ? 'guard' : def.post || this.patrol.length === 0 ? 'guard' : 'patrol';
    if (def.hunter) { this.state = 'search'; this.alert = 1; }
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    // flashlight beam visual
    if (!this.civilian) {
      if (!flashConeGeo) {
        flashConeGeo = new THREE.CylinderGeometry(0.04, 2.6, 11, 16, 1, true);
        flashConeGeo.translate(0, -5.5, 0);
        flashConeGeo.rotateX(-Math.PI / 2);
      }
      const m = getConeMaterial().clone();
      m.uniforms.uColor.value = new THREE.Color(0.85, 0.9, 1);
      m.uniforms.uStrength.value = 0.1;
      // flip gradient: bright at the lamp
      this.flashCone = new THREE.Mesh(flashConeGeo, m);
      this.flashCone.visible = false;
      this.rig.light.add(this.flashCone);
    }
  }

  get eye(): THREE.Vector3 { return new THREE.Vector3(this.pos.x, this.pos.y + (this.crouching ? 1.15 : 1.62), this.pos.z); }
  get forward(): THREE.Vector3 { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  say(cat: keyof typeof BARKS, force = false) {
    if (!this.alive) return;
    if (!force && this.speakT > 0) return;
    this.speakT = 4 + Math.random() * 3;
    const line = pick(BARKS[cat]);
    const g = this.game;
    const d = this.pos.distanceTo(g.player.pos);
    if (d < 30) {
      g.hud.subtitle(this.civilian ? 'Scientist' : this.spawn.name ?? 'Merc', line);
      audio.speak(line, this.civilian ? 1.1 : 0.7);
    }
    if (!this.civilian && cat !== 'pain') audio.play('radio', { pos: this.eye, vol: 0.25 });
    // voices are noise other guards can hear
    g.noise(this.pos, 12, 'voice', this);
  }

  setState(s: AIState) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    this.path = null;
    this.pathGoal = null;
    if (s !== 'combat') { this.inCover = false; this.cover = null; }
  }

  // ------------------------------------------------------------------ perception
  perceive(dt: number) {
    const g = this.game, P = g.player, d = g.diff;
    if (!P.alive) { this.seesPlayer = false; return; }
    const eye = this.eye.clone();
    const toP = tmpV2.copy(P.eyePos).sub(eye);
    const dist = toP.length();
    const outdoor = !g.level.isIndoor(this.pos.x, this.pos.y + 1, this.pos.z);
    const range = (outdoor ? 48 : 30) * (this.civilian ? 0.7 : 1) * d.perception * (0.85 + this.alert * 0.3);
    this.seesPlayer = false;
    this.visFrac = 0;
    if (dist > range) { this.decay(dt); return; }
    toP.normalize();
    const lookYaw = this.yaw + this.anim.lookYaw;
    const fx = Math.sin(lookYaw), fz = Math.cos(lookYaw);
    const cosA = fx * toP.x + fz * toP.z;
    const fov = this.state === 'combat' || this.state === 'search' ? -0.1 : 0.42; // ~130deg normal, ~190deg alert
    const peripheral = dist < 3.2 ? -0.5 : fov;
    if (cosA < peripheral) { this.decay(dt); return; }
    // exposure: how many of the player's sample points are visible
    let vis = 0;
    const pts = P.samplePoints();
    for (const p of pts) if (g.physics.los(eye.x, eye.y, eye.z, p.x, p.y, p.z, 'sight')) vis++;
    const frac = vis / pts.length;
    if (frac === 0) { this.decay(dt); return; }
    // lighting
    let light = P.light;
    if (this.flashlightOn && dist < 24 && cosA > 0.93) light = Math.max(light, 0.95 - dist * 0.012);
    let lightF = Math.min(1, Math.max(0, (light - 0.04) / 0.45));
    lightF = Math.max(lightF, 1 - dist / 4.0); // close proximity always noticeable
    const stanceF = P.stance === 'stand' ? 1 : P.stance === 'crouch' ? 0.6 : 0.32;
    const sp = P.horizSpeed;
    const moveF = sp < 0.2 ? 0.55 : sp < 2.4 ? 0.8 : sp < 5 ? 1.1 : 1.5;
    const centerF = 0.55 + 0.45 * Math.max(0, (cosA - 0.4) / 0.6);
    const vis01 = frac * lightF * stanceF * moveF * centerF;
    this.visFrac = vis01;
    if (vis01 < 0.02) { this.decay(dt); return; }
    const inCombat = this.state === 'combat';
    const rate = (0.55 + 9 / Math.max(1.5, dist)) * d.perception * (1 + this.alert * 1.5) * (inCombat ? 6 : 1);
    this.awareness = Math.min(1.5, this.awareness + vis01 * rate * dt);
    if (this.awareness >= 1 || (inCombat && vis01 > 0.04)) {
      this.seesPlayer = true;
      this.lastKnown = (this.lastKnown ?? new THREE.Vector3()).copy(P.pos);
      this.lastSeenT = g.time;
    } else if (this.awareness > 0.3) {
      this.stimulus = (this.stimulus ?? new THREE.Vector3()).copy(P.pos);
    }
  }

  private decay(dt: number) {
    if (this.state === 'combat') return;
    this.awareness = Math.max(0, this.awareness - dt * this.game.diff.awarenessDecay * (this.alert > 0.5 ? 0.5 : 1));
  }

  hear(pos: THREE.Vector3, kind: string, source: any) {
    if (!this.alive || source === this) return;
    if (this.civilian) {
      const near = pos.distanceTo(this.pos) < (kind === 'explosion' ? 35 : 22);
      if (near && (kind === 'gunshot' || kind === 'explosion' || kind === 'scream')) {
        if (this.state !== 'flee' && this.state !== 'cower') { this.setState('flee'); this.say('flee', true); }
      }
      return;
    }
    if (kind === 'voice' && source instanceof Actor && source.state !== 'combat' && source.state !== 'search') return;
    if (this.state === 'combat') {
      if (kind === 'gunshot' && !this.seesPlayer && source === this.game.player) {
        // gunfire reveals rough position
        this.lastKnown = (this.lastKnown ?? new THREE.Vector3()).copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
      }
      return;
    }
    const loud = kind === 'gunshot' || kind === 'explosion' || (kind === 'voice' && source instanceof Actor && source.state === 'combat');
    this.stimulus = (this.stimulus ?? new THREE.Vector3()).copy(pos);
    if (loud) {
      this.alert = 1;
      this.lastKnown = (this.lastKnown ?? new THREE.Vector3()).copy(pos);
      if (this.state !== 'alarm') { this.setState('search'); this.say('lost'); }
      this.game.ai.requestAlarm(this);
    } else if (this.state === 'patrol' || this.state === 'guard' || this.state === 'suspicious' || this.state === 'investigate') {
      this.awareness = Math.max(this.awareness, 0.4);
      if (this.state !== 'investigate') {
        this.setState('suspicious');
        this.say('suspicious');
      }
    }
  }

  /** Become aware of the player in combat. */
  engage(pos: THREE.Vector3, fromRadio = false) {
    if (!this.alive || this.civilian) return;
    this.lastKnown = (this.lastKnown ?? new THREE.Vector3()).copy(pos);
    this.alert = 1;
    if (this.state !== 'combat' && this.state !== 'alarm') {
      const wasAware = this.state === 'search';
      this.setState('combat');
      this.reactT = this.game.diff.reaction * (fromRadio || wasAware ? 0.6 : 1) * (0.8 + Math.random() * 0.4);
      this.aimSettle = 1;
      if (!fromRadio) {
        this.say('spotted', true);
        this.radioT = 1.2 + Math.random() * 0.8;
        this.game.stats.timesSpotted++;
      }
      this.game.ai.requestAlarm(this);
    }
  }

  // ------------------------------------------------------------------ damage
  damage(amount: number, dir: THREE.Vector3, zone: 'head' | 'torso' | 'legs', fromPlayer: boolean, weaponId?: string) {
    if (!this.alive) return;
    const g = this.game;
    this.health -= amount;
    this.anim.flinch = 1;
    if (fromPlayer) this.hitByPlayer = true;
    if (this.health <= 0) { this.die(dir, zone, weaponId); return; }
    audio.play('grunt', { pos: this.eye, vol: 0.7 });
    if (Math.random() < 0.4) this.say('pain');
    if (this.civilian) { this.setState('flee'); return; }
    // know roughly where the shot came from
    const P = g.player;
    const guess = P.pos.clone();
    if (P.light < 0.3 && !this.seesPlayer) guess.add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
    this.engage(guess);
    this.awareness = Math.max(this.awareness, 0.9);
    this.targetYaw = Math.atan2(-dir.x, -dir.z);
    if (g.diff.tactics >= 2 && this.health < this.maxHealth * 0.35 && Math.random() < 0.6) {
      this.cover = null; this.inCover = false; this.coverT = 0;
      this.say('retreat');
    }
  }

  die(dir: THREE.Vector3, zone: string, weaponId?: string) {
    const g = this.game;
    this.alive = false;
    this.setState('dead');
    this.anim.dead = 0.001;
    // fall away from the shot
    const f = this.forward;
    this.anim.deathDir = f.x * dir.x + f.z * dir.z > 0 ? 1 : -1;
    this.anim.deathTwist = (Math.random() - 0.5) * 0.8;
    if (zone === 'head' && (weaponId === 'ks12' || weaponId === 'vs9' || weaponId === 'ar74') && Math.random() < 0.7) {
      // R-rated: head is destroyed
      this.rig.head.visible = false;
      if (this.rig.helmet) this.rig.helmet.visible = false;
      this.headless = true;
      g.fx.bloodSpray(this.rig.head.getWorldPosition(new THREE.Vector3()), dir, 2.5, true);
    }
    audio.play(zone === 'head' ? 'headshot' : 'grunt', { pos: this.eye, vol: 0.9 });
    g.onActorKilled(this, zone);
    if (this.flashCone) this.flashCone.visible = false;
    this.flashlightOn = false;
  }

  // ------------------------------------------------------------------ movement helpers
  goTo(target: THREE.Vector3) {
    if (this.pathGoal && this.pathGoal.distanceToSquared(target) < 1 && (this.path || this.pathPending)) return;
    this.pathGoal = target.clone();
    this.pathPending = true;
    this.game.ai.queuePath(this);
  }

  private followPath(dt: number, speed: number): boolean {
    if (!this.path || this.pathIdx >= this.path.length) return true;
    const t = this.path[this.pathIdx];
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) {
      this.pathIdx++;
      return this.pathIdx >= this.path.length;
    }
    this.targetYaw = Math.atan2(dx, dz);
    this.vel.x = (dx / d) * speed;
    this.vel.z = (dz / d) * speed;
    this.moveSpeed = speed;
    return false;
  }

  arrived(tol = 0.6) {
    if (!this.pathGoal) return true;
    return Math.hypot(this.pathGoal.x - this.pos.x, this.pathGoal.z - this.pos.z) < tol && !this.pathPending;
  }

  faceTowards(p: THREE.Vector3) {
    this.targetYaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  // ------------------------------------------------------------------ main update
  update(dt: number) {
    const g = this.game;
    if (!this.alive) {
      this.deadT += dt;
      if (this.anim.dead < 1) {
        this.anim.dead = Math.min(1, this.anim.dead + dt * 1.6);
        if (this.anim.dead >= 1) {
          audio.play('bodyfall', { pos: this.pos, vol: 0.8 });
          g.noise(this.pos, 7, 'body', this);
        }
      }
      if (this.deadT > 0.9 && this.deadT - dt <= 0.9) g.fx.bloodPool(this.pos.x - this.forward.x * this.anim.deathDir * 0.6, this.pos.y + 0.02, this.pos.z - this.forward.z * this.anim.deathDir * 0.6);
      animate(this.rig, this.anim, dt);
      return;
    }
    this.stateT += dt;
    this.speakT -= dt;
    this.percT -= dt;
    if (this.percT <= 0) {
      const step = 0.1;
      this.perceive(step + (-this.percT));
      this.percT = step;
      this.checkBodies();
    }
    this.vel.x = 0; this.vel.z = 0;
    this.moveSpeed = 0;

    if (this.radioT > 0) {
      this.radioT -= dt;
      if (this.radioT <= 0 && this.state === 'combat' && this.lastKnown) g.ai.radio(this, this.lastKnown);
    }

    if (this.civilian) this.updateCivilian(dt);
    else this.updateMerc(dt);

    // flashlight
    const wantLight = !this.civilian && (this.spawn.flashlight || (g.diff.flashlights && (this.state === 'search' || this.state === 'investigate' || (this.state === 'combat' && !this.seesPlayer))) || (!g.powerOn && g.diff.tactics >= 0)) && this.alive;
    this.flashlightOn = !!wantLight && !g.level.isIndoor(this.pos.x, this.pos.y + 1, this.pos.z) || (!!wantLight && !g.powerOn);
    if (this.flashCone) this.flashCone.visible = this.flashlightOn;

    // physics
    const wasPos = this.pos.clone();
    this.vel.y -= 20 * dt;
    const r = g.physics.moveCharacter(this.pos, this.vel, dt, 0.3, this.crouching ? 1.2 : 1.75, 0.45, true);
    void r;
    if (this.pos.y < -30) { this.pos.copy(this.home); }
    // stuck detection
    if (this.moveSpeed > 0.5) {
      const moved = wasPos.distanceTo(this.pos);
      if (moved < this.moveSpeed * dt * 0.25) {
        this.stuckT += dt;
        if (this.stuckT > 1.2) { this.stuckT = 0; this.path = null; if (this.pathGoal) { const gl = this.pathGoal; this.pathGoal = null; this.goTo(gl); } }
      } else this.stuckT = 0;
    }
    // turn
    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const turnRate = this.state === 'combat' ? 9 : 4;
    this.yaw += Math.sign(dy) * Math.min(Math.abs(dy), turnRate * dt);

    // animation
    const hs = Math.hypot(this.pos.x - wasPos.x, this.pos.z - wasPos.z) / Math.max(dt, 1e-4);
    this.anim.speed += (hs - this.anim.speed) * Math.min(1, dt * 10);
    const aimTarget = this.state === 'combat' || this.state === 'search' || this.state === 'investigate' || this.state === 'alarm' ? 1 : this.alert > 0.5 ? 0.6 : 0;
    this.anim.aim += (aimTarget - this.anim.aim) * Math.min(1, dt * 5);
    this.anim.crouch += ((this.crouching ? 1 : 0) - this.anim.crouch) * Math.min(1, dt * 8);
    this.anim.handsUp += ((this.state === 'cower' ? 1 : 0) - this.anim.handsUp) * Math.min(1, dt * 5);
    if (this.state === 'combat' && this.lastKnown) {
      const e = this.eye;
      const dyp = (g.player.eyePos.y - 0.3) - e.y;
      const dh = Math.hypot(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z);
      this.anim.pitch = Math.atan2(dyp, Math.max(1, dh));
    } else this.anim.pitch *= 0.9;
    // idle look-around
    if ((this.state === 'guard' || this.state === 'search' || this.state === 'suspicious') && this.moveSpeed === 0) {
      this.lookSweep += dt * (this.state === 'search' ? 1.4 : 0.6);
      this.anim.lookYaw = Math.sin(this.lookSweep) * 0.7;
    } else this.anim.lookYaw *= 0.9;

    // footsteps
    if (hs > 0.5) {
      const ph = Math.floor(this.anim.phase / Math.PI);
      if (ph !== (this as any)._lastStep) {
        (this as any)._lastStep = ph;
        const surf = g.surfaceAt(this.pos);
        const dist = this.pos.distanceTo(g.player.pos);
        if (dist < 30) audio.play('step_' + (surf === 'snow' || surf === 'dirt' ? 'snow' : surf === 'metal' ? 'metal' : 'concrete'), { pos: this.pos, vol: hs > 3 ? 0.55 : 0.32, occlusion: g.occlusion(this.pos) });
      }
    }

    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    animate(this.rig, this.anim, dt);
  }

  private checkBodies() {
    const g = this.game;
    if (this.civilian || this.state === 'combat' || g.diff.tactics < 1) return;
    for (const a of g.actors) {
      if (a.alive || a.bodyFound || a.deadT < 1) continue;
      const d = a.pos.distanceTo(this.pos);
      if (d > 18) continue;
      const to = tmpV2.copy(a.pos).sub(this.pos).normalize();
      const f = this.forward;
      if (f.x * to.x + f.z * to.z < 0.3) continue;
      const e = this.eye;
      if (!g.physics.los(e.x, e.y, e.z, a.pos.x, a.pos.y + 0.3, a.pos.z)) continue;
      a.bodyFound = true;
      this.say('body', true);
      this.alert = 1;
      this.stimulus = a.pos.clone();
      this.lastKnown = a.pos.clone();
      this.setState('search');
      g.ai.bodyFound(this, a);
      return;
    }
  }

  // ------------------------------------------------------------------ civilians
  private updateCivilian(dt: number) {
    const g = this.game, P = g.player;
    const dP = this.pos.distanceTo(P.pos);
    switch (this.state) {
      case 'guard':
      case 'patrol': {
        if (this.awareness > 0.7) { this.setState(P.weaponRaisedAt(this) ? 'cower' : 'flee'); this.say('flee', true); break; }
        // putter around workstation
        this.waitT -= dt;
        if (this.waitT <= 0) {
          this.waitT = 4 + Math.random() * 6;
          const p = g.nav.randomNear(this.home.x, this.home.y, this.home.z, 3);
          if (p) this.goTo(new THREE.Vector3(p.x, p.y, p.z));
        }
        if (this.followPath(dt, 1.0)) this.targetYaw += Math.sin(g.time * 0.3 + this.id) * 0.002;
        break;
      }
      case 'flee': {
        if (P.weaponRaisedAt(this) && dP < 9) { this.setState('cower'); break; }
        if (!this.pathGoal || this.arrived(1)) {
          // run to alarm on Agent+, otherwise away from player
          const panel = g.diff.tactics >= 1 && !g.alarm.active ? g.ai.nearestPanel(this.pos, 35) : null;
          if (panel && !this.alarmPanel) { this.alarmPanel = panel; this.goTo(panel.stand); }
          else if (this.alarmPanel && this.arrived(1)) {
            g.raiseAlarm('A scientist triggered the alarm');
            this.alarmPanel = null;
            this.stateT = 0;
          } else {
            const away = this.pos.clone().sub(P.pos).setY(0).normalize().multiplyScalar(14).add(this.pos);
            const p = g.nav.randomNear(away.x, this.pos.y, away.z, 6);
            if (p) this.goTo(new THREE.Vector3(p.x, p.y, p.z));
          }
        }
        this.followPath(dt, 3.6);
        if (this.stateT > 25 && dP > 20) { this.setState('guard'); this.awareness = 0; }
        break;
      }
      case 'cower': {
        this.faceTowards(P.pos);
        this.crouching = true;
        this.surrendered = true;
        if (!P.weaponRaisedAt(this) && this.stateT > 6) {
          this.crouching = false;
          this.setState('flee');
        }
        break;
      }
      default: this.setState('guard');
    }
  }

  // ------------------------------------------------------------------ mercenaries
  private updateMerc(dt: number) {
    const g = this.game, d = g.diff;
    if (this.seesPlayer && this.state !== 'combat' && this.state !== 'alarm') this.engage(g.player.pos);

    switch (this.state) {
      case 'guard': {
        this.crouching = false;
        if (this.pos.distanceTo(this.home) > 1.2) { this.goTo(this.home); this.followPath(dt, 1.5); }
        else if (this.stateT > 1) this.targetYaw = this.homeYaw;
        this.checkSuspicion();
        break;
      }
      case 'patrol': {
        this.crouching = false;
        const t = this.patrol[this.patrolIdx];
        if (this.waitT > 0) {
          this.waitT -= dt;
          if (this.waitT <= 0) { this.patrolIdx = (this.patrolIdx + 1) % this.patrol.length; this.goTo(this.patrol[this.patrolIdx]); }
        } else {
          if (!this.pathGoal) this.goTo(t);
          if (this.followPath(dt, 1.45 + this.alert * 0.5) && this.arrived(0.8)) this.waitT = 2 + Math.random() * 3;
        }
        this.checkSuspicion();
        break;
      }
      case 'suspicious': {
        this.crouching = false;
        if (this.stimulus) this.faceTowards(this.stimulus);
        if (this.awareness > 0.65 || this.stateT > 2.5) {
          if (this.stimulus) { this.setState('investigate'); this.say('investigate'); }
          else this.setState(this.patrol.length ? 'patrol' : 'guard');
        } else if (this.awareness < 0.1 && this.stateT > 2) {
          this.setState(this.patrol.length ? 'patrol' : 'guard');
        }
        break;
      }
      case 'investigate': {
        if (!this.stimulus) { this.setState('search'); break; }
        if (!this.pathGoal || this.pathGoal.distanceTo(this.stimulus) > 2) this.goTo(this.stimulus);
        const done = this.followPath(dt, 1.9 + this.alert);
        if ((done && this.arrived(1.5)) || this.stateT > 20) {
          // look around a bit, then give up
          if (this.stateT > 6 || this.stateT > 20) {
            this.say('calm');
            this.stimulus = null;
            this.awareness = 0;
            this.alert = Math.min(1, this.alert + 0.3);
            this.setState(this.patrol.length ? 'patrol' : 'guard');
          }
        }
        break;
      }
      case 'search': {
        this.crouching = false;
        // hunt around last known point
        const center = this.lastKnown ?? this.stimulus ?? this.home;
        if (!this.pathGoal || this.arrived(1.2)) {
          this.waitT -= dt;
          if (this.waitT <= 0) {
            this.waitT = 1.5 + Math.random() * 2.5;
            const p = this.stateT < 3 && center ? { x: center.x, y: center.y, z: center.z } : g.nav.randomNear(center.x, center.y, center.z, 6 + Math.min(16, this.stateT * 0.4));
            if (p) this.goTo(new THREE.Vector3(p.x, p.y, p.z));
          }
        }
        this.followPath(dt, this.stateT < 8 ? 3.4 : 2.2);
        const giveUp = this.spawn.hunter ? 1e9 : d.tactics === 2 ? 90 : d.tactics === 1 ? 50 : 25;
        if (this.stateT > giveUp && !g.alarm.active) {
          this.say('calm');
          this.lastKnown = null;
          this.alert = 0.7;
          this.setState(this.patrol.length ? 'patrol' : 'guard');
        }
        if (g.alarm.active && this.stateT > giveUp && this.spawn.hunter) {
          this.lastKnown = g.player.pos.clone(); // hunters get intel updates
        }
        break;
      }
      case 'alarm': {
        const panel = this.alarmPanel;
        if (!panel || g.alarm.active || panel.disabled) { this.alarmPanel = null; this.setState('combat'); break; }
        this.goTo(panel.stand);
        if (this.followPath(dt, 4.4) && this.arrived(0.9)) {
          this.faceTowards(panel.pos);
          if (this.stateT > 0.3) {
            if (!(this as any)._alarmUseT) { (this as any)._alarmUseT = g.time; }
            if (g.time - (this as any)._alarmUseT > 1.2) {
              g.raiseAlarm('Alarm raised by a guard');
              (this as any)._alarmUseT = 0;
              this.alarmPanel = null;
              this.setState('combat');
            }
          }
        }
        // shoot back if attacked en route
        if (this.seesPlayer && this.pos.distanceTo(g.player.pos) < 8) { this.alarmPanel = null; this.setState('combat'); }
        break;
      }
      case 'combat': this.updateCombat(dt); break;
      default: break;
    }
  }

  private checkSuspicion() {
    if (this.awareness > 0.3 && this.stimulus) { this.setState('suspicious'); this.say('suspicious'); }
  }

  private updateCombat(dt: number) {
    const g = this.game, d = g.diff, P = g.player;
    const lk = this.lastKnown ?? P.pos;
    const distP = this.pos.distanceTo(P.pos);
    const sinceSeen = g.time - this.lastSeenT;
    this.reactT -= dt;
    this.aimSettle = Math.max(0, this.aimSettle - dt * 0.6);

    // reload
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      this.crouching = this.inCover || d.tactics >= 1;
      if (this.reloadT <= 0) this.ammo = this.weapon!.mag;
    }

    // dodge grenades
    for (const gr of g.thrown) {
      if (gr.kind !== 'frag' || gr.fuse > 2.2) continue;
      if (gr.pos.distanceTo(this.pos) < 6 && d.tactics >= 1) {
        const away = this.pos.clone().sub(gr.pos).setY(0).normalize().multiplyScalar(8).add(this.pos);
        this.goTo(away);
        this.followPath(dt, 4.6);
        this.cover = null;
        return;
      }
    }

    const role = this.role;
    const hasLOS = this.seesPlayer;
    // --- movement decision
    const tactical = d.tactics >= 1;
    if (hasLOS) this.faceTowards(P.pos);
    else this.faceTowards(lk);
    const elevated = this.home.y > 2 || this.spawn.kind === 'sniper';

    if (elevated) {
      // tower guards and snipers hold their perch; duck between bursts on higher difficulties
      this.crouching = tactical && !hasLOS;
    } else if (tactical) {
      this.coverT -= dt;
      const lowHP = d.tactics >= 2 && this.health < this.maxHealth * 0.35;
      if ((!this.cover && this.coverT <= 0) || (this.cover && this.coverT <= -8)) {
        this.coverT = 2.5;
        const c = g.ai.findCover(this, lk, lowHP ? 14 : role === 'flank' ? 4 : 10, role);
        if (c) { this.cover = c; this.inCover = false; this.goTo(c); }
      }
      if (this.cover) {
        const done = this.followPath(dt, this.inCover ? 0 : 4.3);
        if (done && this.arrived(0.7)) {
          if (!this.inCover) { this.inCover = true; this.coverT = 5 + Math.random() * 5; }
        }
        if (this.inCover) {
          // peek cycle: crouch hidden, stand to shoot
          this.peekT -= dt;
          if (this.peekT <= 0) this.peekT = 3 + Math.random() * 2.5;
          const exposed = this.peekT < 1.9 && this.reloadT <= 0;
          this.crouching = !exposed;
          if (this.coverT <= 0 && !lowHP) {
            // reposition after a while: advance (assault) or flank
            this.cover = null;
            this.inCover = false;
            this.coverT = 0;
            if (role === 'flank' || (d.tactics >= 2 && sinceSeen > 4)) this.say('flank');
          }
        }
      } else {
        this.crouching = false;
        if (!hasLOS) {
          this.goTo(lk);
          this.followPath(dt, sinceSeen > 6 ? 2.6 : 3.8);
        } else if (distP > this.weapon!.range * 0.7) {
          this.goTo(P.pos);
          this.followPath(dt, 3.6);
        }
      }
    } else {
      // Operative: stand and shoot, otherwise charge last known position
      this.crouching = false;
      if (!hasLOS) { this.goTo(lk); this.followPath(dt, 3.4); }
      else if (distP > this.weapon!.range * 0.8) { this.goTo(P.pos); this.followPath(dt, 3); }
      else {
        // little strafe
        const side = Math.sin(g.time * 0.8 + this.id * 2) > 0.6 ? 1 : Math.sin(g.time * 0.8 + this.id * 2) < -0.6 ? -1 : 0;
        if (side) { const f = this.forward; this.vel.x = f.z * side * 1.5; this.vel.z = -f.x * side * 1.5; this.moveSpeed = 1.5; }
      }
    }

    // --- firing
    const canShoot = this.reloadT <= 0 && this.reactT <= 0 && this.weapon;
    const suppressing = !hasLOS && d.tactics >= 2 && role === 'suppress' && sinceSeen < 6 && this.inCover;
    if (canShoot && (hasLOS || suppressing) && !this.crouching) {
      this.fireT -= dt;
      if (this.burstLeft <= 0) {
        this.burstPause -= dt;
        if (this.burstPause <= 0) {
          const [a, b] = this.weapon!.burst;
          this.burstLeft = a + Math.floor(Math.random() * (b - a + 1));
          if (suppressing && Math.random() < 0.3) this.say('suppress');
        }
      } else if (this.fireT <= 0) {
        this.fireT = 60 / this.weapon!.rpm;
        this.shoot(hasLOS ? P.aimPointFor(this) : lk.clone().setY(lk.y + 1 + Math.random()), !hasLOS);
        this.burstLeft--;
        if (this.burstLeft <= 0) this.burstPause = (d.tactics === 0 ? 1.3 : 0.7) + Math.random() * 0.8;
      }
    }

    // --- grenades
    if (this.grenades > 0 && !hasLOS && sinceSeen > 2.5 && sinceSeen < 12 && g.ai.canThrowGrenade()) {
      const dl = this.pos.distanceTo(lk);
      if (dl > 6 && dl < 24 && P.horizSpeed < 1.5) {
        this.grenades--;
        g.ai.grenadeThrown();
        this.say('grenade', true);
        g.throwGrenade(this.eye.clone(), lk.clone(), this, 'frag');
      }
    }

    // --- lost contact
    const loseAfter = d.tactics === 0 ? 8 : d.tactics === 1 ? 14 : 20;
    if (!hasLOS && sinceSeen > loseAfter) {
      this.say('lost');
      this.stimulus = lk.clone();
      this.setState('search');
    }
  }

  private shoot(target: THREE.Vector3, blind: boolean) {
    const g = this.game, d = g.diff, w = this.weapon!;
    if (this.ammo <= 0) {
      this.reloadT = w.reload;
      if (this.game.diff.tactics >= 1) this.say('reload');
      return;
    }
    this.ammo--;
    const muzzle = this.rig.muzzle.getWorldPosition(new THREE.Vector3());
    // fire from eye line to avoid shooting through cover lips, but start flash at muzzle
    const origin = this.eye.clone();
    const dir = target.clone().sub(origin).normalize();
    const P = g.player;
    let spreadDeg = d.spread * w.spread * (1 + this.aimSettle * 1.2) * (P.horizSpeed > 3 ? 1.5 : P.horizSpeed > 1 ? 1.2 : 1) * (blind ? 2.5 : 1) * (this.moveSpeed > 0.5 ? 1.6 : 1);
    if (P.stance === 'prone') spreadDeg *= 1.15;
    for (let i = 0; i < w.pellets; i++) {
      const sd = THREE.MathUtils.degToRad(spreadDeg);
      const v = dir.clone();
      v.x += (Math.random() - 0.5) * 2 * Math.tan(sd);
      v.y += (Math.random() - 0.5) * 2 * Math.tan(sd);
      v.z += (Math.random() - 0.5) * 2 * Math.tan(sd);
      v.normalize();
      g.fireBullet(origin, v, w.damage * d.enemyDamage, this, { tracer: Math.random() < 0.3, weapon: w.name });
    }
    this.anim.recoil = 1;
    g.fx.muzzle(muzzle, w.name === 'shotgun' ? 0.8 : 0.55);
    g.muzzleFlashAt(muzzle);
    audio.play(w.sound, { pos: muzzle, vol: 1.0, refDist: 6, occlusion: g.occlusion(muzzle), wet: 0.9 });
    g.noise(this.pos, 55, 'gunshot', this);
  }
}

// ======================================================================= director
export class AIDirector {
  private pathQueue: Actor[] = [];
  private grenadeCD = 0;
  private roleT = 0;
  panels: any[] = [];

  constructor(public game: Game) {}

  queuePath(a: Actor) { if (!this.pathQueue.includes(a)) this.pathQueue.push(a); }

  canThrowGrenade() { return this.grenadeCD <= 0; }
  grenadeThrown() { this.grenadeCD = this.game.diff.tactics >= 2 ? 9 : 16; }

  nearestPanel(p: THREE.Vector3, maxD: number) {
    let best: any = null, bd = maxD;
    for (const pn of this.panels) {
      if (pn.disabled) continue;
      if (Math.abs(pn.pos.y - p.y) > 2.5) continue;
      const d = pn.pos.distanceTo(p);
      if (d < bd) { bd = d; best = pn; }
    }
    return best;
  }

  /** Someone wants the alarm raised: on Agent+ the nearest merc runs to a panel. */
  requestAlarm(from: Actor) {
    const g = this.game;
    if (g.alarm.active || g.diff.tactics < 1) return;
    if (g.actors.some((a) => a.alive && a.state === 'alarm')) return;
    // closest merc to a panel among those near the incident
    let best: Actor | null = null, bestD = Infinity, bestPanel: any = null;
    for (const a of g.actors) {
      if (!a.alive || a.civilian) continue;
      if (a.pos.distanceTo(from.pos) > 30) continue;
      if (a.state !== 'combat' && a.state !== 'search') continue;
      const pn = this.nearestPanel(a.pos, 40);
      if (!pn) continue;
      const d = pn.pos.distanceTo(a.pos);
      if (d < bestD) { bestD = d; best = a; bestPanel = pn; }
    }
    if (best && bestPanel) {
      best.alarmPanel = bestPanel;
      best.setState('alarm');
      best.say('alarm', true);
    }
  }

  /** Radio report: squad + nearby allies learn the player's position. */
  radio(from: Actor, pos: THREE.Vector3) {
    const g = this.game;
    for (const a of g.actors) {
      if (a === from || !a.alive || a.civilian) continue;
      const near = a.pos.distanceTo(from.pos) < (g.diff.tactics === 0 ? 18 : 35);
      const squad = g.diff.tactics >= 1 && a.spawn.squad === from.spawn.squad;
      if (near || squad) a.engage(pos.clone(), true);
    }
    if (g.diff.tactics >= 1) {
      // whole base goes on alert (faster detection) even without alarm
      for (const a of g.actors) if (a.alive && !a.civilian) a.alert = Math.max(a.alert, 0.6);
    }
  }

  bodyFound(finder: Actor, body: Actor) {
    const g = this.game;
    g.hud.message('A body has been discovered!', 'warn');
    g.stats.bodiesFound++;
    for (const a of g.actors) {
      if (!a.alive || a.civilian || a === finder) continue;
      if (a.spawn.squad === finder.spawn.squad || a.pos.distanceTo(finder.pos) < 25) {
        a.alert = 1;
        if (a.state === 'patrol' || a.state === 'guard') { a.stimulus = body.pos.clone(); a.setState('investigate'); }
      }
    }
    if (g.diff.tactics >= 2) this.requestAlarm(finder);
  }

  /** Cover search: nav nodes near walls that block LOS from the threat at crouch height. */
  findCover(a: Actor, threat: THREE.Vector3, maxDist: number, role: string): THREE.Vector3 | null {
    const g = this.game;
    const th = new THREE.Vector3(threat.x, threat.y + 1.5, threat.z);
    const cands = g.nav.sampleNear(a.pos.x, a.pos.y, a.pos.z, role === 'flank' ? 5 : 1.5, maxDist + (role === 'flank' ? 8 : 0), 18);
    let best: THREE.Vector3 | null = null, bestScore = -Infinity;
    const toThreat = th.clone().sub(a.pos).setY(0).normalize();
    for (const c of cands) {
      if (!g.nav.nearWall[c.id]) continue;
      const p = c.p;
      const dT = Math.hypot(p.x - threat.x, p.z - threat.z);
      if (dT < 5) continue;
      // hidden while crouched...
      if (g.physics.los(th.x, th.y, th.z, p.x, p.y + 0.9, p.z)) continue;
      // ...but can shoot when standing (peek)
      const peek = g.physics.los(th.x, th.y - 0.3, th.z, p.x, p.y + 1.6, p.z);
      // occupied?
      if (g.actors.some((o) => o !== a && o.alive && o.cover && o.cover.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) < 1.5)) continue;
      const dA = Math.hypot(p.x - a.pos.x, p.z - a.pos.z);
      let score = (peek ? 6 : 0) - dA * 0.4 - Math.abs(dT - 14) * 0.25;
      if (role === 'flank') {
        // prefer positions to the side of the threat relative to current approach
        const side = new THREE.Vector3(p.x - threat.x, 0, p.z - threat.z).normalize();
        const lateral = Math.abs(side.x * toThreat.z - side.z * toThreat.x);
        score += lateral * 8 - (dT > 16 ? 4 : 0);
      }
      if (score > bestScore) { bestScore = score; best = new THREE.Vector3(p.x, p.y, p.z); }
    }
    return best;
  }

  update(dt: number) {
    const g = this.game;
    this.grenadeCD -= dt;
    // path budget
    let budget = 4;
    while (budget-- > 0 && this.pathQueue.length) {
      const a = this.pathQueue.shift()!;
      if (!a.alive || !a.pathGoal) { a.pathPending = false; continue; }
      const t = a.pathGoal;
      const p = g.nav.findPath(a.pos.x, a.pos.y + 0.3, a.pos.z, t.x, t.y + 0.3, t.z);
      a.path = p;
      a.pathIdx = p && p.length > 1 ? 1 : 0;
      a.pathPending = false;
      if (!p) {
        // fallback straight line
        a.path = [{ x: t.x, y: t.y, z: t.z }];
        a.pathIdx = 0;
      }
    }
    // squad roles (Ghost)
    this.roleT -= dt;
    if (this.roleT <= 0 && g.diff.tactics >= 2) {
      this.roleT = 2;
      const squads = new Map<string, Actor[]>();
      for (const a of g.actors) {
        if (!a.alive || a.civilian || a.state !== 'combat') continue;
        const arr = squads.get(a.spawn.squad) ?? [];
        arr.push(a);
        squads.set(a.spawn.squad, arr);
      }
      for (const arr of squads.values()) {
        arr.sort((x, y) => x.pos.distanceTo(g.player.pos) - y.pos.distanceTo(g.player.pos));
        arr.forEach((a, i) => {
          const prev = a.role;
          a.role = arr.length === 1 ? 'assault' : i === 0 ? 'suppress' : i % 2 === 1 ? 'flank' : 'assault';
          if (a.role === 'flank' && prev !== 'flank') { a.cover = null; a.coverT = 0; a.say('flank'); }
        });
      }
    }
    // separation
    const A = g.actors;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < A.length; j++) {
        const b = A[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.5 && d2 > 1e-6 && Math.abs(a.pos.y - b.pos.y) < 1) {
          const d = Math.sqrt(d2);
          const push = (0.71 - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          if (!g.physics.blocked(a.pos.x - nx * push - 0.3, a.pos.y + 0.1, a.pos.z - nz * push - 0.3, a.pos.x - nx * push + 0.3, a.pos.y + 1.7, a.pos.z - nz * push + 0.3)) { a.pos.x -= nx * push; a.pos.z -= nz * push; }
          if (!g.physics.blocked(b.pos.x + nx * push - 0.3, b.pos.y + 0.1, b.pos.z + nz * push - 0.3, b.pos.x + nx * push + 0.3, b.pos.y + 1.7, b.pos.z + nz * push + 0.3)) { b.pos.x += nx * push; b.pos.z += nz * push; }
        }
      }
    }
  }
}

/** Ray vs actor hit zones (in actor local space). */
export function rayActor(a: Actor, o: THREE.Vector3, d: THREE.Vector3, maxT: number): { t: number; zone: 'head' | 'torso' | 'legs' } | null {
  if (!a.alive) return null;
  const c = Math.cos(-a.yaw), s = Math.sin(-a.yaw);
  const lx = o.x - a.pos.x, lz = o.z - a.pos.z;
  const ox = lx * c + lz * s, oz = -lx * s + lz * c, oy = o.y - a.pos.y;
  const dx = d.x * c + d.z * s, dz = -d.x * s + d.z * c, dy = d.y;
  const cr = a.anim.crouch;
  const drop = cr * 0.45;
  const zones: [string, number, number, number, number, number, number][] = [
    ['head', -0.15, 1.48 - drop, -0.15, 0.15, 1.82 - drop, 0.15],
    ['torso', -0.3, 0.88 - drop * 0.9, -0.2, 0.3, 1.5 - drop, 0.2],
    ['legs', -0.25, 0, -0.18, 0.25, 0.9 - drop * 0.9, 0.18],
  ];
  let best: { t: number; zone: any } | null = null;
  for (const [zone, x0, y0, z0, x1, y1, z1] of zones) {
    let tmin = 0, tmax = maxT;
    const slab = (oo: number, dd: number, mn: number, mx: number) => {
      if (Math.abs(dd) < 1e-9) return oo >= mn && oo <= mx;
      let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      return tmin <= tmax;
    };
    if (slab(ox, dx, x0, x1) && slab(oy, dy, y0, y1) && slab(oz, dz, z0, z1)) {
      if (!best || tmin < best.t) best = { t: tmin, zone };
    }
  }
  return best;
}
