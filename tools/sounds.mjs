// Exports synthesized sounds to WAV (tools/sound-preview/) and prints simple spectral metrics:
//   tonality  = spectral peak / mean over the first 60 ms (high = pure "ping", low = noisy/realistic)
//   low%      = share of energy below 200 Hz (chest punch)
//   len       = audible length (ms above -40 dB)
import { chromium } from 'playwright';
import fs from 'node:fs';
const names = ['pistol_sup', 'rifle_sup', 'smg', 'rifle', 'shotgun', 'dryfire', 'mag_out', 'mag_in', 'bolt', 'pump', 'shell_in', 'weapon_switch', 'pickup', 'shell'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__dbg);
const out = await page.evaluate((names) => {
  const a = window.__dbg.audio; a.init();
  const res = {};
  for (const n of names) {
    const b = a.buffers.get(n)[0];
    const d = b.getChannelData(0), sr = b.sampleRate;
    // metrics: DFT of first 60ms (coarse, 64 bins up to 8 kHz)
    const N = Math.min(d.length, Math.floor(sr * 0.06));
    const mags = [];
    let low = 0, tot = 0, mid = 0, pres = 0, hi = 0;
    for (let k = 1; k <= 160; k++) {
      const f = k * 50; // 50 Hz .. 8 kHz
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); re += d[i] * w * Math.cos((2 * Math.PI * f * i) / sr); im -= d[i] * w * Math.sin((2 * Math.PI * f * i) / sr); }
      const m = re * re + im * im;
      mags.push(m); tot += m; if (f <= 200) low += m; else if (f <= 1000) mid += m; else if (f <= 4000) pres += m; else hi += m;
    }
    const mean = tot / mags.length, peak = Math.max(...mags);
    let last = 0; for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.01) last = i;
    // 16-bit WAV
    const buf = new ArrayBuffer(44 + d.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, d.length * 2, true);
    for (let i = 0; i < d.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
    let bin = ''; const u8 = new Uint8Array(buf); for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    const pc = (x) => Math.round((x / tot) * 100);
    res[n] = { bands: `${pc(low)}/${pc(mid)}/${pc(pres)}/${pc(hi)}`, tonality: +(peak / mean).toFixed(1), lowPct: Math.round((low / tot) * 100), lenMs: Math.round((last / sr) * 1000), wav: btoa(bin) };
  }
  return res;
}, names);
fs.mkdirSync('tools/sound-preview', { recursive: true });
for (const [n, r] of Object.entries(out)) {
  fs.writeFileSync(`tools/sound-preview/${n}.wav`, Buffer.from(r.wav, 'base64'));
  console.log(n.padEnd(14), 'energy <200/200-1k/1-4k/>4k %', r.bands.padEnd(12), ' len', r.lenMs + 'ms');
}
await browser.close();
