// In-game HUD (DOM + an overlay canvas for detection / damage indicators).
import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Player } from '../game/player';

const el = (tag: string, cls: string, parent: HTMLElement, html = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
};

export class HUD {
  root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private health: HTMLElement; private armor: HTMLElement;
  private lightBar: HTMLElement; private lightMark: HTMLElement; private noiseBar: HTMLElement;
  private stance: HTMLElement; private moveMode: HTMLElement;
  private weapon: HTMLElement; private ammo: HTMLElement; private reserve: HTMLElement; private gadgets: HTMLElement;
  private location: HTMLElement; private objectives: HTMLElement;
  private feed: HTMLElement; private radioBox: HTMLElement; private subtitleBox: HTMLElement;
  private promptBox: HTMLElement; private promptText: HTMLElement; private promptBar: HTMLElement;
  private cross: HTMLElement; private hit: HTMLElement; private alarmBox: HTMLElement; private scope: HTMLElement; private deadBox: HTMLElement;
  private objFlashT = 0;
  private hitT = 0;
  private damageMarks: { angle: number; t: number; src: THREE.Vector3 }[] = [];
  private radioT = 0;
  private subT = 0;
  private radioQueue: [string, string][] = [];

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', parent);
    this.canvas = el('canvas', 'hud-canvas', this.root) as HTMLCanvasElement;
    this.g = this.canvas.getContext('2d')!;
    const resize = () => { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize);
    resize();

    this.cross = el('div', 'crosshair', this.root, '<i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><b></b>');
    this.hit = el('div', 'hitmarker', this.root, '<i></i><i></i><i></i><i></i>');
    this.scope = el('div', 'scope hidden', this.root, '<div class="scope-ring"></div><div class="scope-h"></div><div class="scope-v"></div>');

    const bl = el('div', 'panel bl', this.root);
    el('div', 'label', bl, 'HEALTH');
    this.health = el('div', 'fill hp', el('div', 'bar', bl));
    el('div', 'label', bl, 'ARMOR');
    this.armor = el('div', 'fill ar', el('div', 'bar thin', bl));
    const row = el('div', 'row', bl);
    this.stance = el('div', 'stance', row, 'STAND');
    this.moveMode = el('div', 'mode', row, 'JOG');
    el('div', 'label', bl, 'VISIBILITY');
    const lb = el('div', 'bar light', bl);
    this.lightBar = el('div', 'fill lt', lb);
    this.lightMark = el('div', 'mark', lb);
    el('div', 'label', bl, 'NOISE');
    this.noiseBar = el('div', 'fill nz', el('div', 'bar thin', bl));

    const br = el('div', 'panel br', this.root);
    this.weapon = el('div', 'weapon', br, 'SP-9');
    const am = el('div', 'ammo', br);
    this.ammo = el('span', 'mag', am, '12');
    this.reserve = el('span', 'res', am, '/ 36');
    this.gadgets = el('div', 'gadgets', br, '');

    const tl = el('div', 'panel tl', this.root);
    this.location = el('div', 'location', tl, '');
    this.objectives = el('div', 'objectives hidden', tl, '');

    this.feed = el('div', 'feed', this.root);
    this.alarmBox = el('div', 'alarm hidden', this.root, 'ALARM');
    this.radioBox = el('div', 'radio hidden', this.root);
    this.subtitleBox = el('div', 'subtitle hidden', this.root);
    this.promptBox = el('div', 'prompt hidden', this.root);
    this.promptText = el('div', 'ptext', this.promptBox);
    this.promptBar = el('div', 'pfill', el('div', 'pbar', this.promptBox));
    this.deadBox = el('div', 'dead hidden', this.root, '<h1>AGENT DOWN</h1><p>Signal lost.</p>');
  }

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }

  reset() {
    this.feed.innerHTML = '';
    this.deadBox.classList.add('hidden');
    this.alarmBox.classList.add('hidden');
    this.radioBox.classList.add('hidden');
    this.subtitleBox.classList.add('hidden');
    this.radioQueue = [];
    this.damageMarks = [];
  }

  message(text: string, type: 'info' | 'good' | 'warn' | 'fail' | 'objective' = 'info') {
    const m = el('div', 'msg ' + type, this.feed, text);
    setTimeout(() => m.classList.add('fade'), 4200);
    setTimeout(() => m.remove(), 5200);
    while (this.feed.children.length > 6) this.feed.firstChild!.remove();
  }

  radio(who: string, text: string) {
    this.radioQueue.push([who, text]);
    if (this.radioT <= 0) this.nextRadio();
  }
  private nextRadio() {
    const n = this.radioQueue.shift();
    if (!n) { this.radioBox.classList.add('hidden'); return; }
    this.radioBox.innerHTML = `<b>${n[0]}</b> ${n[1]}`;
    this.radioBox.classList.remove('hidden');
    this.radioT = 3 + n[1].length * 0.045;
  }

  subtitle(who: string, text: string) {
    this.subtitleBox.innerHTML = `<b>${who}:</b> ${text}`;
    this.subtitleBox.classList.remove('hidden');
    this.subT = 2.6;
  }

  prompt(text: string | null, progress: number) {
    if (!text) { this.promptBox.classList.add('hidden'); return; }
    this.promptBox.classList.remove('hidden');
    this.promptText.textContent = text;
    this.promptBar.parentElement!.style.display = progress >= 0 ? 'block' : 'none';
    this.promptBar.style.width = Math.max(0, progress) * 100 + '%';
  }

  hitmarker(kill: boolean, head: boolean) {
    this.hit.classList.remove('show', 'kill', 'head');
    void this.hit.offsetWidth;
    this.hit.classList.add('show');
    if (kill) this.hit.classList.add('kill');
    if (head) this.hit.classList.add('head');
    this.hitT = 0.25;
  }

  damageFrom(src: THREE.Vector3, _p: Player) {
    this.damageMarks.push({ angle: 0, t: 1.4, src: src.clone() });
  }

  alarm(on: boolean, reason: string) {
    this.alarmBox.classList.toggle('hidden', !on);
    this.alarmBox.innerHTML = on ? `ALARM<small>${reason}</small>` : '';
    if (on) this.message(reason, 'warn');
  }

  dead() { this.deadBox.classList.remove('hidden'); }

  flashObjectives() { this.objFlashT = 6; }

  update(game: Game, dt: number) {
    const P = game.player;
    const st = P.cur;
    this.health.style.width = Math.max(0, P.health) + '%';
    this.health.classList.toggle('low', P.health < 30);
    this.armor.style.width = P.armor + '%';
    this.stance.textContent = P.stance === 'stand' ? (P.sprinting ? 'SPRINT' : 'STAND') : P.stance.toUpperCase();
    this.moveMode.textContent = P.walkMode ? 'WALK' : 'JOG';
    this.moveMode.classList.toggle('quiet', P.walkMode);
    const lv = P.light;
    this.lightBar.style.width = lv * 100 + '%';
    this.lightMark.style.left = lv * 100 + '%';
    this.lightBar.parentElement!.classList.toggle('hidden-state', lv < 0.22);
    this.noiseBar.style.width = Math.min(1, P.noiseLevel) * 100 + '%';
    this.weapon.textContent = st.def.name;
    if (st.def.mag > 0) {
      this.ammo.textContent = String(st.inMag);
      this.reserve.textContent = '/ ' + st.reserve;
      this.ammo.classList.toggle('empty', st.inMag === 0);
    } else { this.ammo.textContent = '—'; this.reserve.textContent = ''; }
    this.gadgets.innerHTML = `<span>[G] FRAG ×${P.grenades}</span><span>[T] NOISE ×${P.noisemakers}</span><span class="${P.nvg ? 'on' : ''}">[N] NVG ${P.nvg ? 'ON' : 'OFF'}</span>` +
      (P.keys.size ? `<span>${[...P.keys].map((k) => `<i class="key ${k}"></i>`).join('')}</span>` : '');
    const area = game.level.areaName(P.pos.x, P.pos.y + 0.5, P.pos.z);
    const m = Math.floor(game.time / 60), s = Math.floor(game.time % 60);
    this.location.innerHTML = `<span>${area || 'Object 47'}</span><span class="time">${m}:${String(s).padStart(2, '0')}</span>`;
    // objectives
    this.objFlashT -= dt;
    const showObj = game.input.down('Tab') || this.objFlashT > 0;
    this.objectives.classList.toggle('hidden', !showObj);
    if (showObj) {
      this.objectives.innerHTML = '<h4>OBJECTIVES — ' + game.diff.name + '</h4>' + game.mission.objectives.map((o) =>
        `<div class="obj ${o.state} ${o.constraint ? 'con' : ''}"><i></i>${o.text}</div>`).join('');
    }
    // crosshair spread
    const def = st.def;
    const spread = (def.hipSpread * (1 - P.ads) + def.adsSpread * P.ads) * (P.horizSpeed > 4 ? 2.2 : P.horizSpeed > 1 ? 1.4 : 1) * (P.stance === 'prone' ? 0.5 : P.stance === 'crouch' ? 0.75 : 1);
    const px = 4 + spread * 6 + P.recoilPitch * 1.5;
    this.cross.style.setProperty('--gap', px + 'px');
    this.cross.style.opacity = (def.scope && P.ads > 0.8) ? '0' : P.ads > 0.6 && def.id !== 'ks12' ? '0.35' : '1';
    this.scope.classList.toggle('hidden', !(def.scope && P.ads > 0.85));
    this.hitT -= dt;
    if (this.hitT <= 0) this.hit.classList.remove('show');
    // radio / subtitles
    if (this.radioT > 0) { this.radioT -= dt; if (this.radioT <= 0) this.nextRadio(); }
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.subtitleBox.classList.add('hidden'); }
    this.drawOverlay(game, dt);
  }

  private drawOverlay(game: Game, dt: number) {
    const g = this.g, W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    const P = game.player;
    const cx = W / 2, cy = H / 2;
    const yawTo = (p: THREE.Vector3) => {
      // clockwise screen angle from the view direction to the point
      const dx = p.x - P.pos.x, dz = p.z - P.pos.z;
      const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
      const fwd = -dx * sy - dz * cy;
      const right = dx * cy - dz * sy;
      return Math.atan2(right, fwd);
    };
    // detection arcs: enemies becoming aware of you
    const R = Math.min(W, H) * 0.16;
    for (const a of game.actors) {
      if (!a.alive || a.awareness < 0.04) continue;
      if (a.state === 'combat' && !a.seesPlayer) continue;
      const ang = yawTo(a.pos);
      const lvl = Math.min(1, a.awareness);
      const combat = a.state === 'combat';
      g.save();
      g.translate(cx, cy);
      g.rotate(ang);
      g.beginPath();
      g.arc(0, 0, R, -Math.PI / 2 - 0.22, -Math.PI / 2 + 0.22);
      g.lineWidth = 6;
      g.strokeStyle = combat ? 'rgba(255,40,30,0.9)' : `rgba(255,${Math.round(220 - lvl * 160)},40,${0.25 + lvl * 0.6})`;
      g.stroke();
      // chevron
      g.beginPath();
      g.moveTo(-8, -R - 10); g.lineTo(0, -R - 20 - lvl * 6); g.lineTo(8, -R - 10);
      g.fillStyle = g.strokeStyle;
      g.fill();
      g.restore();
    }
    // damage direction
    for (const d of this.damageMarks) {
      d.t -= dt;
      const ang = yawTo(d.src);
      g.save();
      g.translate(cx, cy);
      g.rotate(ang);
      g.beginPath();
      g.arc(0, 0, R * 1.35, -Math.PI / 2 - 0.35, -Math.PI / 2 + 0.35);
      g.lineWidth = 14;
      g.strokeStyle = `rgba(200,0,0,${Math.max(0, d.t / 1.4) * 0.7})`;
      g.stroke();
      g.restore();
    }
    this.damageMarks = this.damageMarks.filter((d) => d.t > 0);
  }
}
