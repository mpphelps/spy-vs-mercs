// Hitch probe: spins the camera through several areas and records frame times.
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?autostart&nolock&diff=' + (process.argv[2] ?? '1'));
await page.waitForFunction(() => window.__game && window.__game.time > 0.3, null, { timeout: 60000 });
const spots = [[0, 0, 100], [0, 0, 30], [-20, 0, 0], [-45, 0, 8], [-10, 0, -49], [-55.5, -4, 0], [-10, -4, -70], [36, 0, -60]];
const res = await page.evaluate(async (spots) => {
  const g = window.__game; g.godMode = true;
  const frames = [];
  for (const s of spots) {
    g.player.pos.set(s[0], s[1], s[2]);
    await new Promise((done) => {
      let last = performance.now(), t0 = last;
      const f = () => {
        const now = performance.now();
        frames.push({ dt: now - last, at: s.join(',') });
        last = now;
        g.player.yaw += 0.12;                 // fast mouse turn
        g.player.pitch = Math.sin(now / 300) * 0.6;
        if (now - t0 < 2500) requestAnimationFrame(f); else done();
      };
      requestAnimationFrame(f);
    });
  }
  // skip the very first frames after each teleport? keep all: teleporting is harsher than real play
  const dts = frames.map((f) => f.dt).sort((a, b) => a - b);
  const worst = frames.slice().sort((a, b) => b.dt - a.dt).slice(0, 5).map((f) => `${f.dt.toFixed(0)}ms@${f.at}`);
  return { frames: frames.length, median: dts[dts.length >> 1].toFixed(1), p99: dts[Math.floor(dts.length * 0.99)].toFixed(1), over50: dts.filter((d) => d > 50).length, worst };
}, spots);
console.log(JSON.stringify(res));
// tunnel ceiling check
await page.evaluate(() => { const P = window.__game.player; P.pos.set(-55.5, -4, -10); P.yaw = 0; P.pitch = 1.3; });
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/70_tunnel_up.png' });
await page.evaluate(() => { const P = window.__game.player; P.pos.set(-45, -4, -47.5); P.yaw = -1.57; P.pitch = 0.9; });
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/71_tunnelB_up.png' });
console.log(errors.join('\n') || 'no page errors');
await browser.close();
