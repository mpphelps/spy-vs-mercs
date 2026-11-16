// Headless smoke test: loads the game, captures console errors and screenshots from several spots.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/?autostart&nolock&debug&diff=1';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().includes('level built')) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + e.stack));
await page.goto(url);
await page.waitForFunction(() => window.__game && window.__game.time > 0.5, null, { timeout: 120000 }).catch(e => errors.push('timeout waiting for game: ' + e.message));
const views = JSON.parse(process.argv[3] ?? '[]');
for (const v of views) {
  await page.evaluate((v) => {
    const g = window.__game; const P = g.player;
    if (v.pos) P.pos.set(v.pos[0], v.pos[1], v.pos[2]);
    if (v.yaw !== undefined) P.yaw = v.yaw;
    if (v.pitch !== undefined) P.pitch = v.pitch;
    if (v.nvg !== undefined) P.nvg = v.nvg;
    if (v.stance) P.stance = v.stance;
    g.godMode = true;
  }, v);
  await page.waitForTimeout(v.wait ?? 1500);
  await page.screenshot({ path: `shots/${v.name}.png` });
}
const info = await page.evaluate(() => { const g = window.__game; if (!g) return null; return { time: g.time, actors: g.actors.length, nav: g.nav.nodeCount, states: g.actors.map(a => a.state).join(','), fps: null }; });
console.log(JSON.stringify(info));
console.log(errors.slice(0, 30).join('\n'));
await browser.close();
