// Front-end screens: title, mission dossier, difficulty, briefing, controls, settings, pause, debrief.
import { MISSIONS, MissionDef } from '../game/mission';
import { DIFFICULTIES, Difficulty } from '../game/difficulty';
import type { EndResult, Settings } from '../game/game';
import { audio } from '../core/audio';

export interface Progress { [mission: string]: { [diff: number]: number } }

export function loadJSON<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? { ...fallback, ...JSON.parse(s) } : fallback; } catch { return fallback; }
}
export function saveJSON(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } }

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift', 'Sprint'], ['X', 'Toggle walk (quiet footsteps)'],
  ['C', 'Crouch  ·  while sprinting: slide'], ['Z', 'Prone (crawl through vents & culverts)'], ['Q / E', 'Lean left / right'],
  ['Space', 'Jump / mantle onto ledges'], ['LMB', 'Fire'], ['RMB', 'Aim down sights / scope'], ['R', 'Reload'],
  ['V', 'Melee · silent takedown from behind'], ['F', 'Use / open doors (hold for consoles)'], ['G', 'Throw frag grenade'],
  ['T', 'Throw noisemaker (lure guards)'], ['N', 'Night vision goggles'], ['1-6 / Wheel', 'Switch weapons'], ['Tab', 'Objectives'], ['Esc', 'Pause'],
];

const TIPS = [
  'Shoot out lights to create shadows. Guards notice broken glass, but darkness is your best friend.',
  'Your visibility meter shows how lit you are. Crouch or go prone in shadow and you are almost invisible.',
  'Suppressed shots are quiet but bullet impacts still make noise near guards.',
  'Guards who find a body will raise the alarm on higher difficulties. Kill quietly and kill out of sight.',
  'Kill the guard running for an alarm panel, or disable the panel before anyone gets there.',
  'Sabotage the comms array and the base cannot call for reinforcements.',
  'Killing the generator blacks out the compound. Night vision gives you the edge.',
  'Lean around corners: only your head is exposed, so you are much harder to spot.',
  'There are three ways into Object 47. The front door is the loudest.',
];

export class Menus {
  root: HTMLElement;
  settings: Settings;
  progress: Progress;
  onStart: ((m: MissionDef, d: Difficulty) => void) | null = null;
  onResume: (() => void) | null = null;
  onAbort: (() => void) | null = null;
  onRetry: (() => void) | null = null;
  onSettings: ((s: Settings) => void) | null = null;
  private selMission: MissionDef = MISSIONS[0];
  private selDiff: Difficulty = DIFFICULTIES[0];
  private backFromSettings: () => void = () => this.title();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'menus';
    parent.appendChild(this.root);
    this.settings = loadJSON<Settings>('svm_settings', { sensitivity: 1, invertY: false, fov: 75, volume: 0.8, barks: true });
    this.progress = loadJSON<Progress>('svm_progress', {});
  }

  private screen(html: string, cls = '') {
    this.root.innerHTML = `<div class="screen ${cls}">${html}</div>`;
    this.root.classList.remove('hidden');
    this.root.querySelectorAll('button').forEach((b) => b.addEventListener('mouseenter', () => audio.play('ui', { ui: true, vol: 0.3 })));
    return this.root.firstElementChild as HTMLElement;
  }

  private on(sel: string, fn: () => void) {
    this.root.querySelectorAll(sel).forEach((e) => e.addEventListener('click', () => { audio.init(); audio.play('ui_select', { ui: true, vol: 0.5 }); fn(); }));
  }

  hide() { this.root.classList.add('hidden'); this.root.innerHTML = ''; }

  title() {
    this.screen(`
      <div class="title-wrap">
        <div class="agency">ARGUS · SPECIAL ACTIVITIES DIVISION</div>
        <h1 class="logo">SPY <span>vs</span> MERCS</h1>
        <div class="sub">OPERATION KOLYBEL</div>
        <div class="menu-col">
          <button class="big" id="b-start">MISSION SELECT</button>
          <button id="b-controls">CONTROLS</button>
          <button id="b-settings">SETTINGS</button>
        </div>
        <div class="rating">Rated M · Blood and gore · Intense violence · Strong language</div>
      </div>`, 'title');
    this.on('#b-start', () => this.missionSelect());
    this.on('#b-controls', () => this.controls(() => this.title()));
    this.on('#b-settings', () => this.settingsScreen(() => this.title()));
  }

  missionSelect() {
    const cards = MISSIONS.map((m, i) => {
      const best = this.progress[m.id] ?? {};
      return `<div class="dossier ${m.available ? '' : 'locked'}" data-i="${i}">
        <div class="tab">FILE ${String(i + 1).padStart(2, '0')}</div>
        <div class="stamp">${m.available ? 'TOP SECRET' : 'CLASSIFIED'}</div>
        <h3>${m.available ? m.title : '██████████'}</h3>
        <div class="code">${m.codename}</div>
        <div class="loc">${m.location}</div>
        ${m.available ? `<div class="bests">${DIFFICULTIES.map((d) => `<span class="${best[d.id] ? 'done' : ''}">${d.name}<b>${best[d.id] ? fmt(best[d.id]) : '--:--'}</b></span>`).join('')}</div>` : '<div class="bests"><span>Not yet available</span></div>'}
      </div>`;
    }).join('');
    this.screen(`<h2 class="screen-title">MISSION SELECT</h2><div class="dossiers">${cards}</div><div class="foot"><button id="b-back">BACK</button></div>`);
    this.root.querySelectorAll('.dossier').forEach((d) => d.addEventListener('click', () => {
      const m = MISSIONS[Number((d as HTMLElement).dataset.i)];
      if (!m.available) { audio.play('denied', { ui: true, vol: 0.5 }); return; }
      audio.play('ui_select', { ui: true, vol: 0.5 });
      this.selMission = m;
      this.difficulty();
    }));
    this.on('#b-back', () => this.title());
  }

  difficulty() {
    const m = this.selMission;
    const cards = DIFFICULTIES.map((d) => {
      const objs = m.objectives.filter((o) => d.id >= o.minDiff && (o.maxDiff === undefined || d.id <= o.maxDiff));
      return `<div class="diff ${d.id === this.selDiff.id ? 'sel' : ''}" data-d="${d.id}">
        <h3>${d.name}</h3><p class="tag">${d.tagline}</p>
        <ul>${objs.map((o) => `<li class="${o.constraint ? 'con' : ''}">${o.text}</li>`).join('')}</ul>
      </div>`;
    }).join('');
    this.screen(`<h2 class="screen-title">${m.title.toUpperCase()} <small>${m.codename}</small></h2>
      <div class="diffs">${cards}</div>
      <div class="foot"><button id="b-back">BACK</button><button class="big" id="b-brief">BRIEFING ▸</button></div>`);
    this.root.querySelectorAll('.diff').forEach((e) => e.addEventListener('click', () => {
      this.selDiff = DIFFICULTIES[Number((e as HTMLElement).dataset.d)];
      audio.play('ui_select', { ui: true, vol: 0.5 });
      this.difficulty();
    }));
    this.on('#b-back', () => this.missionSelect());
    this.on('#b-brief', () => this.briefing());
  }

  briefing() {
    const m = this.selMission, d = this.selDiff;
    const objs = m.objectives.filter((o) => d.id >= o.minDiff && (o.maxDiff === undefined || d.id <= o.maxDiff));
    this.screen(`<h2 class="screen-title">BRIEFING <small>${m.codename} · ${d.name}</small></h2>
      <div class="brief">
        <div class="brief-text">${m.briefing.map((p) => `<p>${p}</p>`).join('')}</div>
        <div class="brief-side">
          <h4>OBJECTIVES</h4><ol>${objs.map((o) => `<li class="${o.constraint ? 'con' : ''}">${o.text}</li>`).join('')}</ol>
          <h4>LOADOUT</h4><p>SP-9 suppressed pistol · combat knife · frag grenades · noisemakers · night vision</p>
          <h4>FIELD TIP</h4><p class="tip">${TIPS[(Math.random() * TIPS.length) | 0]}</p>
        </div>
      </div>
      <div class="foot"><button id="b-back">BACK</button><button id="b-controls">CONTROLS</button><button class="big" id="b-go">BEGIN MISSION</button></div>`);
    this.on('#b-back', () => this.difficulty());
    this.on('#b-controls', () => this.controls(() => this.briefing()));
    this.on('#b-go', () => this.onStart?.(m, d));
  }

  controls(back: () => void) {
    this.screen(`<h2 class="screen-title">CONTROLS</h2>
      <div class="controls">${CONTROLS.map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>
      <div class="foot"><button id="b-back">BACK</button></div>`);
    this.on('#b-back', back);
  }

  settingsScreen(back: () => void) {
    this.backFromSettings = back;
    const s = this.settings;
    this.screen(`<h2 class="screen-title">SETTINGS</h2>
      <div class="settings">
        <label>Mouse sensitivity <input type="range" id="s-sens" min="0.2" max="3" step="0.05" value="${s.sensitivity}"><output>${s.sensitivity.toFixed(2)}</output></label>
        <label>Field of view <input type="range" id="s-fov" min="60" max="100" step="1" value="${s.fov}"><output>${s.fov}</output></label>
        <label>Volume <input type="range" id="s-vol" min="0" max="1" step="0.05" value="${s.volume}"><output>${Math.round(s.volume * 100)}%</output></label>
        <label class="check"><input type="checkbox" id="s-inv" ${s.invertY ? 'checked' : ''}> Invert mouse Y</label>
        <label class="check"><input type="checkbox" id="s-barks" ${s.barks ? 'checked' : ''}> Enemy voice (text-to-speech)</label>
      </div>
      <div class="foot"><button id="b-back">BACK</button></div>`);
    const bind = (id: string, fn: (v: string, el: HTMLInputElement) => void) => {
      const e = this.root.querySelector('#' + id) as HTMLInputElement;
      e.addEventListener('input', () => { fn(e.value, e); const o = e.nextElementSibling as HTMLOutputElement | null; if (o && o.tagName === 'OUTPUT') o.textContent = id === 's-vol' ? Math.round(Number(e.value) * 100) + '%' : id === 's-sens' ? Number(e.value).toFixed(2) : e.value; this.commit(); });
    };
    bind('s-sens', (v) => { s.sensitivity = Number(v); });
    bind('s-fov', (v) => { s.fov = Number(v); });
    bind('s-vol', (v) => { s.volume = Number(v); });
    bind('s-inv', (_v, e) => { s.invertY = e.checked; });
    bind('s-barks', (_v, e) => { s.barks = e.checked; });
    this.on('#b-back', () => this.backFromSettings());
  }

  private commit() {
    saveJSON('svm_settings', this.settings);
    this.onSettings?.(this.settings);
  }

  loading(text = 'INSERTING AGENT...') {
    this.screen(`<div class="loading"><div class="spinner"></div><div>${text}</div><p class="tip">${TIPS[(Math.random() * TIPS.length) | 0]}</p></div>`, 'dim');
  }

  deploy(onClick: () => void) {
    const s = this.screen(`<div class="deploy"><h2>OBJECT 47</h2><p>${this.selDiff.name}</p><button class="big" id="b-deploy">CLICK TO DEPLOY</button><p class="hint">Hold TAB for objectives · ESC to pause</p></div>`, 'dim');
    void s;
    this.on('#b-deploy', onClick);
  }

  pause(objHtml: string) {
    this.screen(`<h2 class="screen-title">PAUSED</h2>
      <div class="pause">
        <div class="menu-col"><button class="big" id="b-resume">RESUME</button><button id="b-controls">CONTROLS</button><button id="b-settings">SETTINGS</button><button id="b-abort">ABORT MISSION</button></div>
        <div class="pause-obj">${objHtml}</div>
      </div>`, 'dim');
    this.on('#b-resume', () => this.onResume?.());
    this.on('#b-controls', () => this.controls(() => this.pause(objHtml)));
    this.on('#b-settings', () => this.settingsScreen(() => this.pause(objHtml)));
    this.on('#b-abort', () => this.onAbort?.());
  }

  debrief(r: EndResult) {
    const m = this.selMission;
    const st = r.stats;
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    let rating = 'BLUNT INSTRUMENT';
    if (r.success) {
      if (st.timesSpotted === 0 && st.alarms === 0 && st.kills === 0) rating = 'GHOST';
      else if (st.timesSpotted === 0 && st.alarms === 0) rating = 'SILENT ASSASSIN';
      else if (st.alarms === 0) rating = 'PROFESSIONAL';
      else if (st.kills > 25) rating = 'ONE-MAN ARMY';
      else rating = 'OPERATIVE';
    }
    let newBest = false;
    if (r.success) {
      const p = this.progress[m.id] ?? (this.progress[m.id] = {});
      if (!p[r.diff.id] || r.time < p[r.diff.id]) { p[r.diff.id] = r.time; newBest = true; }
      saveJSON('svm_progress', this.progress);
    }
    this.screen(`<h2 class="screen-title ${r.success ? 'win' : 'lose'}">${r.success ? 'MISSION COMPLETE' : 'MISSION FAILED'} <small>${m.title} · ${r.diff.name}</small></h2>
      <div class="debrief">
        <div class="col">
          <h4>OBJECTIVES</h4>
          ${r.mission.objectives.map((o) => `<div class="obj ${o.state === 'pending' && o.constraint ? 'done' : o.state}"><i></i>${o.text}</div>`).join('')}
          ${!r.success ? `<p class="reason">${r.reason}</p>` : ''}
        </div>
        <div class="col stats">
          <h4>FIELD REPORT</h4>
          <div><span>Time</span><b>${fmt(r.time)}${newBest ? ' ★ NEW BEST' : ''}</b></div>
          <div><span>Rating</span><b>${rating}</b></div>
          <div><span>Kills</span><b>${st.kills}</b></div>
          <div><span>Headshots</span><b>${st.headshots}</b></div>
          <div><span>Silent takedowns</span><b>${st.takedowns}</b></div>
          <div><span>Accuracy</span><b>${acc}%</b></div>
          <div><span>Times spotted</span><b>${st.timesSpotted}</b></div>
          <div><span>Alarms raised</span><b>${st.alarms}</b></div>
          <div><span>Bodies discovered</span><b>${st.bodiesFound}</b></div>
          <div><span>Lights shot out</span><b>${st.lightsShot}</b></div>
          <div><span>Cameras destroyed</span><b>${st.camerasDestroyed}</b></div>
          <div><span>Civilians killed</span><b>${st.civKills}</b></div>
        </div>
      </div>
      <div class="foot"><button id="b-menu">MISSION SELECT</button><button class="big" id="b-retry">RETRY</button></div>`, r.success ? 'win' : 'lose');
    this.on('#b-menu', () => this.missionSelect());
    this.on('#b-retry', () => this.onRetry?.());
  }

  get mission() { return this.selMission; }
  get diff() { return this.selDiff; }
  set diff(d: Difficulty) { this.selDiff = d; }
}
