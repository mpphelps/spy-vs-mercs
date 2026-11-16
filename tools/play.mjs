// Scripted gameplay test: drives real keyboard / mouse input and checks outcomes.
import { chromium } from 'playwright';
const diff = process.argv[2] ?? '0';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('[console] ' + m.text()); });
await page.goto('http://localhost:5173/?autostart&nolock&diff=' + diff);
await page.waitForFunction(() => window.__game && window.__game.time > 0.3, null, { timeout: 60000 });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const P = () => ev(() => { const p = window.__game.player; return { x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), hp: Math.round(p.health), stance: p.stance }; });
const tp = (x, y, z, yaw = 0, pitch = 0) => ev(([x, y, z, yaw, pitch]) => { const p = window.__game.player; p.pos.set(x, y, z); p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch; }, [x, y, z, yaw, pitch]);
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
const results = [];
const check = (name, ok, info) => results.push((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + (info !== undefined ? JSON.stringify(info) : ''));
await ev(() => { window.__game.godMode = true; });

const fps = await ev(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(Math.round(n / 3)); }; requestAnimationFrame(f); }));
check('fps (headless 1280x720)', fps > 20, { fps });

let a = await P(); await hold('KeyW', 1500); let b = await P();
check('walk forward moves north', b.z < a.z - 3, { from: a.z, to: b.z });

await tp(0, 0, -33, 0); await hold('KeyW', 1500); b = await P();
check('blocked by lab wall', b.z > -36.1, b);

await tp(-55.8, 0, 34.5, 0); await hold('KeyW', 3000); b = await P();
check('descend pump stairs to tunnel', b.y < -3.5, b);
await tp(-55.8, -4, 25, Math.PI); await hold('KeyW', 3000); b = await P();
check('climb pump stairs', b.y > -0.2, b);

await tp(-50, 0, 50, 0); await hold('KeyW', 1500); b = await P();
check('culvert blocks standing', b.z > 48.5, b);
await page.keyboard.press('KeyZ'); await wait(400); await hold('KeyW', 13000); b = await P();
check('prone crawl through culvert into pump house', b.z < 38.5, b);
await page.keyboard.press('KeyZ'); await wait(200); await page.keyboard.press('Space'); await wait(500);

await tp(65, 0, 7.5, Math.PI / 2); await hold('KeyW', 900); await page.keyboard.press('Space'); await wait(800); await hold('KeyW', 1500); b = await P();
check('mantle through east breach', b.x < 60, b);

await tp(-34.5, 0, 11, Math.PI / 2); await wait(200); await page.keyboard.press('KeyF'); await wait(1600); await hold('KeyW', 1500); b = await P();
check('open barracks door and walk in', b.x < -37, b);

await tp(-10, 0, -34.5, 0); await wait(200); await page.keyboard.press('KeyF'); await wait(1500); await hold('KeyW', 1200); b = await P();
check('lab entrance locked without BLUE key', b.z > -36.3, b);
await tp(-55, 0, -27.8, 0); await wait(400);
const hasBlue = await ev(() => window.__game.player.keys.has('blue'));
check('picked up blue keycard', hasBlue);
await tp(-10, 0, -34.5, 0); await wait(200); await page.keyboard.press('KeyF'); await wait(1600); await hold('KeyW', 1500); b = await P();
check('lab entrance opens with BLUE key', b.z < -37, b);

const shot = await ev(async () => {
  const g = window.__game; const P = g.player;
  const t = g.actors.find((a) => a.alive && !a.civilian && a.spawn.name === 'Checkpoint guard' && a.spawn.post);
  t.setState('guard'); t.awareness = 0; P.pos.set(t.pos.x, 0, t.pos.z + 8); P.vel.set(0, 0, 0);
  await new Promise((r) => setTimeout(r, 300));
  const head = t.pos.clone(); head.y += 1.66;
  const d = head.clone().sub(P.eyePos);
  P.yaw = Math.atan2(-d.x, -d.z); P.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  return { id: t.id };
});
await page.mouse.down({ button: 'right' }); await wait(450);
await ev((id) => { const g = window.__game; const P = g.player; const t = g.actors.find((a) => a.id === id); const head = t.pos.clone(); head.y += 1.64; const d = head.clone().sub(P.eyePos); P.yaw = Math.atan2(-d.x, -d.z); P.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); }, shot.id);
await page.mouse.down({ button: 'left' }); await wait(60); await page.mouse.up({ button: 'left' }); await page.mouse.up({ button: 'right' }); await wait(500);
const sres = await ev((id) => { const g = window.__game; const t = g.actors.find((a) => a.id === id); return { alive: t.alive, hp: Math.round(t.health), headshots: g.stats.headshots, shots: g.stats.shots, hits: g.stats.hits }; }, shot.id);
check('one-shot headshot with SP-9', !sres.alive && sres.headshots >= 1, sres);

await ev(() => { const g = window.__game; g.godMode = false; g.player.health = 100; g.player.armor = 0; });
await ev(() => { const g = window.__game; const t = g.actors.find((a) => a.alive && !a.civilian && a.pos.y < 1 && a.pos.z > 20 && a.spawn.kind !== 'sniper'); const f = t.forward; g.player.pos.set(t.pos.x + f.x * 5, t.pos.y, t.pos.z + f.z * 5); window.__dmgT = t.id; });
await page.waitForFunction(() => window.__game.player.health < 100, null, { timeout: 10000, polling: 50 }).catch(() => {});
await ev(() => { window.__game.godMode = true; });
const hp = await ev(() => ({ hp: Math.round(window.__game.player.health), states: window.__game.actors.filter((a) => a.id === window.__dmgT).map((a) => a.state + ' ' + a.spawn.name) }));
check('enemies engage and damage player', hp.hp < 100, hp);
await ev(() => { const g = window.__game; g.godMode = true; g.player.health = 100; });

await tp(5.5, 0, -61.2, 0); await wait(400);
const hasRed = await ev(() => window.__game.player.keys.has('red'));
check('picked up red keycard', hasRed);
await tp(-22, -4, -71, -Math.PI / 2); await wait(200); await page.keyboard.press('KeyF'); await wait(1800); await hold('KeyW', 1500);
b = await P();
check('vault door opens with RED key', b.x > -20, b);
await tp(-8, -4, -70.5, 0); await wait(600);
const lock = await ev(() => ({ lockdown: window.__game.lockdown, proto: window.__game.mission.get('prototype').state, alarm: window.__game.alarm.active }));
check('prototype stolen -> lockdown', lock.lockdown && lock.proto === 'done', lock);
await ev(() => { const g = window.__game; if (g.mission.has('comms')) g.sabotageComms(); if (g.mission.has('data')) g.downloadData(); if (g.mission.has('intel')) g.objectiveDone('intel', 'x'); });
await tp(30, 0.3, -60, 0);
await page.waitForFunction(() => window.__game.heli.state === 'landed', null, { timeout: 60000 }).catch(() => {});
await page.screenshot({ path: 'shots/19_heli.png' });
await tp(36, 0.3, -64, 0); await wait(1000);
const end = await ev(() => ({ ended: window.__game?.ended, heli: window.__game?.heli.state, screen: document.querySelector('.screen-title')?.textContent }));
check('extraction completes mission', end.ended && /COMPLETE/.test(end.screen ?? ''), end);
await page.screenshot({ path: 'shots/20_debrief.png' });

console.log(results.join('\n'));
console.log(errors.slice(0, 10).join('\n') || 'no page errors');
await browser.close();
