// Entry point: wires renderer, input, menus and the game session together.
import { Renderer } from './core/render';
import { Input } from './core/input';
import { audio } from './core/audio';
import { preloadTextures, allTextures } from './core/textures';
import { HUD } from './ui/hud';
import { Menus } from './ui/menus';
import { Game } from './game/game';
import { DIFFICULTIES, Difficulty } from './game/difficulty';
import { MISSIONS, MissionDef } from './game/mission';

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;
const r = new Renderer(app);
const input = new Input(r.renderer.domElement);
const hud = new HUD(ui);
const menus = new Menus(ui);
preloadTextures();

const params = new URLSearchParams(location.search);
const debug = params.has('debug');

type State = 'menu' | 'playing' | 'paused' | 'deploy';
let state: State = 'menu';
let game: Game | null = null;
let lastMission: MissionDef = MISSIONS[0];
let lastDiff: Difficulty = DIFFICULTIES[0];

audio.setVolume(menus.settings.volume);
audio.barksEnabled = menus.settings.barks;
menus.onSettings = (s) => {
  audio.setVolume(s.volume);
  audio.barksEnabled = s.barks;
  if (game) game.settings = s;
};

function startMission(m: MissionDef, d: Difficulty) {
  lastMission = m; lastDiff = d;
  audio.init();
  if (game) { game.dispose(); game = null; }
  hud.reset();
  menus.loading();
  setTimeout(() => {
    const t0 = performance.now();
    game = new Game(r, input, hud, d, m, menus.settings);
    (window as any).__game = game;
    if (debug) console.log('level built in', Math.round(performance.now() - t0), 'ms; nav nodes', game.nav.nodeCount, 'actors', game.actors.length);
    if (params.get('god')) game.godMode = true;
    game.onEnd = (res) => {
      state = 'menu';
      input.exitLock();
      hud.show(false);
      menus.debrief(res);
    };
    // render one frame so the world is visible behind the deploy screen
    game.update(0.016);
    r.warmup(allTextures());
    r.render(0);
    state = 'deploy';
    if (params.has('nolock')) { beginPlay(); return; }
    menus.deploy(() => beginPlay());
  }, 60);
}

function beginPlay() {
  if (!game) return;
  menus.hide();
  hud.show(true);
  state = 'playing';
  input.requestLock();
  if (game.time < 0.1) {
    hud.radio('CONTROL', 'Kestrel, you are on the ground. Object 47 is due north. Stay in the shadows.');
    hud.flashObjectives();
  }
}

function pause() {
  if (state !== 'playing' || !game) return;
  state = 'paused';
  hud.show(false);
  const objs = '<h4>OBJECTIVES</h4>' + game.mission.objectives.map((o) => `<div class="obj ${o.state} ${o.constraint ? 'con' : ''}"><i></i>${o.text}</div>`).join('');
  menus.pause(objs);
}

input.onUnlock = () => { if (state === 'playing' && !params.has('nolock')) pause(); };
menus.onStart = (m, d) => startMission(m, d);
menus.onResume = () => { menus.hide(); hud.show(true); state = 'playing'; input.requestLock(); };
menus.onAbort = () => { if (game) { game.dispose(); game = null; } state = 'menu'; hud.show(false); menus.missionSelect(); };
menus.onRetry = () => startMission(lastMission, lastDiff);

// clicking the canvas while playing re-acquires the mouse
r.renderer.domElement.addEventListener('click', () => { if (state === 'playing' && !input.locked && !params.has('nolock')) input.requestLock(); });

// --- main loop
let last = performance.now();
let acc = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (game && state === 'playing') {
    // fixed-ish substeps keep physics stable at low frame rates
    acc += dt;
    let steps = 0;
    while (acc > 0 && steps < 3) {
      const step = Math.min(acc, 1 / 50);
      game.update(step);
      acc -= step;
      steps++;
    }
    acc = 0;
    r.render(game.time);
  } else if (game && (state === 'paused' || state === 'deploy')) {
    r.render(game.time);
  }
  input.endFrame();
}
requestAnimationFrame(frame);

// --- debug autostart: ?autostart&diff=1&nolock
if (params.has('autostart')) {
  const d = DIFFICULTIES[Number(params.get('diff') ?? 0)] ?? DIFFICULTIES[0];
  menus.diff = d;
  startMission(MISSIONS[0], d);
} else {
  menus.title();
}
(window as any).__dbg = { r, input, hud, menus, audio, get game() { return game; } };
