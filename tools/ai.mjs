// AI behaviour probe: provoke a Ghost-difficulty firefight and log what the squad does.
import { chromium } from 'playwright';
const diff = process.argv[2] ?? '2';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto('http://localhost:5173/?autostart&nolock&diff=' + diff);
await page.waitForFunction(() => window.__game && window.__game.time > 0.3, null, { timeout: 60000 });
await page.evaluate(() => {
  const g = window.__game; g.godMode = true;
  window.__log = { grenades: 0, roles: {}, cover: 0, maxCombat: 0, flankers: new Set(), suppress: new Set(), alarmRunners: new Set(), positions: {} };
  const orig = g.throwGrenade.bind(g);
  g.throwGrenade = (...a) => { if (a[2] !== g.player) window.__log.grenades++; return orig(...a); };
  // stand behind the crate stack in the courtyard, fire a loud shot to provoke
  g.player.pos.set(-18, 0, 10.5); g.player.yaw = -Math.PI / 2;
  g.player.give('ar74', 60); g.player.equip('ar74', true);
});
await page.waitForTimeout(300);
await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up();
const samples = [];
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const g = window.__game, L = window.__log;
    const combat = g.actors.filter((a) => a.alive && a.state === 'combat');
    L.maxCombat = Math.max(L.maxCombat, combat.length);
    for (const a of combat) {
      if (a.role === 'flank') L.flankers.add(a.id);
      if (a.role === 'suppress') L.suppress.add(a.id);
      if (a.inCover) L.cover++;
    }
    for (const a of g.actors) if (a.state === 'alarm') L.alarmRunners.add(a.id);
    const near = g.actors.filter((a) => a.alive && !a.civilian && a.pos.distanceTo(g.player.pos) < 30).map((a) => `${a.id}:${a.state}${a.inCover ? '/cover' : ''}${a.state === 'combat' ? '/' + a.role : ''}@${a.pos.distanceTo(g.player.pos).toFixed(0)}m`);
    return { t: g.time.toFixed(0), combat: combat.length, alarm: g.alarm.active, hp: Math.round(g.player.health), near: near.join(' ') };
  });
  samples.push(s);
}
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(Math.round(n / 2)); }; requestAnimationFrame(f); }));
await page.screenshot({ path: 'shots/50_firefight.png' });
const L = await page.evaluate(() => { const L = window.__log; const g = window.__game; return { grenades: L.grenades, maxCombat: L.maxCombat, flankers: L.flankers.size, suppressors: L.suppress.size, coverSamples: L.cover, alarmRunners: L.alarmRunners.size, alarms: g.stats.alarms, reinforcements: g.reinfWaves, actors: g.actors.length }; });
for (const s of samples.filter((_, i) => i % 3 === 0)) console.log(JSON.stringify(s));
console.log('summary', JSON.stringify(L), 'fps during firefight', fps);
console.log(errors.slice(0, 5).join('\n') || 'no page errors');
await browser.close();
