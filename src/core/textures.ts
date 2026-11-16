// Procedurally painted low-res textures (canvas). Low resolution + smooth filtering gives the
// "how you remember it" N64 look rather than the raw blurry original.
import * as THREE from 'three';

type Painter = (g: CanvasRenderingContext2D, s: number, img: (fn: (x: number, y: number) => [number, number, number]) => void) => void;

let anisotropy = 4;
export function setAnisotropy(a: number) { anisotropy = a; }

// --- value noise -------------------------------------------------------------
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smooth(t: number) { return t * t * (3 - 2 * t); }
/** Tileable value noise at given period. */
function vnoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const p = (a: number) => ((a % period) + period) % period;
  const a = hash(p(xi), p(yi), seed), b = hash(p(xi + 1), p(yi), seed);
  const c = hash(p(xi), p(yi + 1), seed), d = hash(p(xi + 1), p(yi + 1), seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
export function fbm(x: number, y: number, size: number, base: number, oct: number, seed = 1) {
  let v = 0, amp = 0.5, total = 0;
  for (let o = 0; o < oct; o++) {
    const per = base * (1 << o);
    v += vnoise((x / size) * per, (y / size) * per, per, seed + o * 17) * amp;
    total += amp;
    amp *= 0.5;
  }
  return v / total;
}
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

const cache = new Map<string, THREE.Texture>();

function make(name: string, size: number, paint: Painter, opts: { repeat?: boolean; nearest?: boolean } = {}): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const img = (fn: (x: number, y: number) => [number, number, number]) => {
    const id = g.getImageData(0, 0, size, size);
    const d = id.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [r, gg, b] = fn(x, y);
      const i = (y * size + x) * 4;
      d[i] = clamp(r); d[i + 1] = clamp(gg); d[i + 2] = clamp(b); d[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  };
  paint(g, size, img);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat !== false) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = anisotropy;
  if (opts.nearest) { t.magFilter = THREE.NearestFilter; }
  t.name = name;
  cache.set(name, t);
  return t;
}

function grimeLayer(x: number, y: number, s: number, seed: number) {
  // vertical streaks + blotches
  const streak = fbm(x, y, s, 8, 3, seed);
  const blot = fbm(x, y, s, 4, 4, seed + 5);
  return (streak - 0.5) * 16 + (blot - 0.5) * 18;
}

const painters: Record<string, [number, Painter, { repeat?: boolean; nearest?: boolean }?]> = {
  concrete: [128, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 5, 3);
    const v = 112 + (n - 0.5) * 34 + grimeLayer(x, y, s, 9) + (Math.random() - 0.5) * 10;
    const seam = (y % 64 < 2 || x % 128 < 1) ? -30 : 0;
    return [v + seam, v + seam - 2, v + seam - 6];
  })],
  concrete_dark: [128, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 5, 33);
    const v = 70 + (n - 0.5) * 40 + grimeLayer(x, y, s, 2) * 0.6 + (Math.random() - 0.5) * 8;
    return [v, v + 2, v + 4];
  })],
  concrete_wall: [128, (_g, s, img) => img((x, y) => {
    // Soviet panel wall: two-tone (paint band lower half)
    const n = fbm(x, y, s, 4, 4, 7);
    const lower = y > s * 0.55;
    const base = lower ? [86, 104, 96] : [168, 164, 150];
    const g2 = grimeLayer(x, y, s, 4) * (lower ? 0.6 : 1);
    const line = Math.abs(y - s * 0.55) < 1.5 ? -50 : 0;
    const seam = x % 64 < 1.5 ? -25 : 0;
    const v = (n - 0.5) * 30 + g2 + line + seam;
    return [base[0] + v, base[1] + v, base[2] + v];
  })],
  metal_panel: [128, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 8, 3, 11);
    const px = x % 64, py = y % 64;
    const edge = px < 2 || py < 2 ? -40 : px > 61 || py > 61 ? 25 : 0;
    const rivet = ((px - 6) ** 2 + (py - 6) ** 2 < 5 || (px - 57) ** 2 + (py - 6) ** 2 < 5 || (px - 6) ** 2 + (py - 57) ** 2 < 5 || (px - 57) ** 2 + (py - 57) ** 2 < 5) ? 40 : 0;
    const v = 92 + (n - 0.5) * 30 + edge + rivet + grimeLayer(x, y, s, 12) * 0.5;
    return [v, v + 6, v + 12];
  })],
  diamond_plate: [64, (_g, s, img) => img((x, y) => {
    const u = ((x + y) % 16), w = ((x - y + 64) % 16);
    const bump = (u < 3 && w > 4 && w < 11) || (w < 3 && u > 4 && u < 11) ? 45 : 0;
    const n = fbm(x, y, s, 4, 3, 21);
    const v = 95 + bump + (n - 0.5) * 30;
    return [v, v + 2, v + 5];
  })],
  snow: [128, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 5, 41);
    const sp = Math.random() < 0.02 ? 25 : 0;
    const v = 205 + (n - 0.5) * 45 + sp;
    return [v - 8, v, v + 12];
  })],
  snow_road: [128, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 5, 42);
    const track = Math.abs(((x / s) * 4) % 1 - 0.5) < 0.12 ? -40 : 0;
    const v = 170 + (n - 0.5) * 60 + track * fbm(x, y, s, 8, 2, 4);
    return [v - 10, v - 5, v + 4];
  })],
  rock: [128, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 3, 6, 51);
    const cr = fbm(x * 2, y, s, 6, 3, 52);
    const strata = Math.sin((y / s) * Math.PI * 10 + n * 6) * 12;
    let v = 85 + (n - 0.5) * 80 + strata + (cr < 0.3 ? -30 : 0);
    const snowy = fbm(x, y, s, 2, 4, 53) > 0.62 ? 1 : 0;
    if (snowy) return [205, 212, 222];
    return [v + 4, v, v - 4];
  })],
  lab_tile: [128, (_g, s, img) => img((x, y) => {
    const px = x % 32, py = y % 32;
    const grout = px < 1.5 || py < 1.5 ? -55 : 0;
    const n = fbm(x, y, s, 8, 3, 61);
    const v = 196 + grout + (n - 0.5) * 22;
    const tint = ((Math.floor(x / 32) + Math.floor(y / 32)) % 2) * 6;
    return [v - tint, v - tint + 2, v + 6];
  })],
  lab_wall: [128, (_g, s, img) => img((x, y) => {
    const py = y % 128, px = x % 64;
    const seam = px < 1.5 || py < 1.5 ? -40 : 0;
    const stripe = y > 86 && y < 96 ? [-90, -30, 10] : [0, 0, 0];
    const n = fbm(x, y, s, 6, 3, 62);
    const v = 200 + (n - 0.5) * 16 + seam;
    return [v + stripe[0], v + stripe[1] + 2, v + stripe[2] + 6];
  })],
  wood_crate: [64, (g, s, img) => {
    img((x, y) => {
      const n = fbm(x * 0.4, y * 3, s, 4, 4, 71);
      const plank = (y % 16) < 1.2 ? -45 : 0;
      const v = 120 + (n - 0.5) * 50 + plank;
      return [v + 20, v - 5, v - 40];
    });
    g.strokeStyle = 'rgba(40,25,10,0.8)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, s - 4, s - 4);
    g.beginPath(); g.moveTo(4, 4); g.lineTo(s - 4, s - 4); g.stroke();
  }],
  military_crate: [64, (g, s, img) => {
    img((x, y) => {
      const n = fbm(x, y, s, 4, 3, 72);
      const v = (n - 0.5) * 25;
      return [68 + v, 82 + v, 52 + v];
    });
    g.fillStyle = 'rgba(230,220,180,0.75)';
    g.font = 'bold 11px monospace';
    g.fillText('ОПАСНО', 8, 30);
    g.fillText('7.62', 20, 46);
    g.strokeStyle = 'rgba(20,25,15,0.9)';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, s - 3, s - 3);
  }],
  hazard: [64, (_g, s, img) => img((x, y) => {
    const band = Math.floor((x + y) / 16) % 2;
    const n = fbm(x, y, s, 4, 3, 81);
    const v = (n - 0.5) * 30;
    return band ? [220 + v, 170 + v, 20 + v] : [30 + v, 30 + v, 30 + v];
  })],
  corrugated: [64, (_g, s, img) => img((x, y) => {
    const ridge = Math.sin((x / s) * Math.PI * 16) * 25;
    const rust = fbm(x, y, s, 4, 4, 91);
    const r = rust > 0.6 ? (rust - 0.6) * 300 : 0;
    const v = 105 + ridge;
    return [v + r * 0.6, v + r * 0.2 + 4, v - r * 0.2 + 8];
  })],
  tarp: [64, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 4, 101);
    const v = (n - 0.5) * 30 + Math.sin(x * 0.4) * 4;
    return [70 + v, 80 + v, 55 + v];
  })],
  truck_paint: [64, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 4, 102);
    const v = (n - 0.5) * 20;
    return [60 + v, 72 + v, 50 + v];
  })],
  asphalt: [128, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 8, 4, 111);
    const v = 55 + (n - 0.5) * 30 + (Math.random() - 0.5) * 18;
    return [v, v, v + 3];
  })],
  carpet: [64, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 8, 3, 121);
    const pat = ((x >> 3) + (y >> 3)) % 2 ? 8 : 0;
    const v = (n - 0.5) * 20 + pat;
    return [110 + v, 40 + v, 38 + v];
  })],
  wood_floor: [64, (_g, s, img) => img((x, y) => {
    const n = fbm(x * 0.3, y * 2, s, 4, 4, 131);
    const seam = y % 12 < 1 ? -40 : 0;
    const v = 105 + (n - 0.5) * 40 + seam;
    return [v + 30, v + 5, v - 25];
  })],
  sandbag: [64, (_g, s, img) => img((x, y) => {
    const row = Math.floor(y / 16);
    const off = row % 2 ? 16 : 0;
    const bx = ((x + off) % 32) / 32, by = (y % 16) / 16;
    const shade = Math.sin(bx * Math.PI) * Math.sin(by * Math.PI);
    const n = fbm(x, y, s, 8, 3, 141);
    const v = 70 + shade * 70 + (n - 0.5) * 20;
    return [v + 30, v + 22, v];
  })],
  bark: [64, (_g, s, img) => img((x, y) => {
    const n = fbm(x * 3, y * 0.4, s, 4, 4, 151);
    const v = 60 + (n - 0.5) * 60;
    return [v + 15, v, v - 10];
  })],
  pine: [64, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 8, 3, 161);
    const snow = fbm(x, y, s, 3, 3, 162) > 0.62;
    if (snow) return [200, 210, 220];
    const v = (n - 0.5) * 40;
    return [28 + v, 62 + v, 40 + v];
  })],
  camo_winter: [64, (_g, s, img) => img((x, y) => {
    const a = fbm(x, y, s, 4, 3, 171), b = fbm(x, y, s, 5, 3, 172);
    if (a > 0.62) return [45, 48, 52];
    if (b > 0.58) return [120, 124, 128];
    const n = (Math.random() - 0.5) * 10;
    return [180 + n, 184 + n, 188 + n];
  })],
  camo_dark: [64, (_g, s, img) => img((x, y) => {
    const a = fbm(x, y, s, 4, 3, 181), b = fbm(x, y, s, 5, 3, 182);
    if (a > 0.6) return [30, 34, 28];
    if (b > 0.55) return [72, 78, 60];
    const n = (Math.random() - 0.5) * 10;
    return [52 + n, 58 + n, 48 + n];
  })],
  labcoat: [32, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 2, 191);
    const v = 215 + (n - 0.5) * 25;
    return [v, v + 2, v + 4];
  })],
  spy_suit: [32, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 2, 192);
    const v = 30 + (n - 0.5) * 16;
    return [v, v + 3, v + 6];
  })],
  server: [64, (g, s) => {
    g.fillStyle = '#1a1d22';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 8; i++) {
      const y = 2 + i * 8;
      g.fillStyle = '#2b3038';
      g.fillRect(3, y, s - 6, 6);
      g.fillStyle = '#0d0f12';
      for (let k = 0; k < 6; k++) g.fillRect(8 + k * 5, y + 2, 3, 2);
      g.fillStyle = Math.random() < 0.5 ? '#3cff6a' : '#ffb020';
      g.fillRect(s - 12, y + 2, 2, 2);
      g.fillStyle = '#3cff6a';
      g.fillRect(s - 8, y + 2, 2, 2);
    }
  }, { repeat: false }],
  screen: [64, (g, s) => {
    g.fillStyle = '#04140a';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#39ff7a';
    g.font = '7px monospace';
    const lines = ['СИСТЕМА', '> ВЕСНА-7', 'ОК 0x3F', 'ПРОТОКОЛ', '>>> ....', 'ДОСТУП', 'ЗАПРЕЩЁН', '_'];
    lines.forEach((l, i) => g.fillText(l, 3, 9 + i * 7.5));
    for (let y = 0; y < s; y += 2) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y, s, 1); }
  }, { repeat: false }],
  screen_cam: [64, (g, s) => {
    g.fillStyle = '#0b1210';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4; i++) {
      const x = (i % 2) * 32, y = Math.floor(i / 2) * 32;
      g.fillStyle = `rgb(${40 + i * 10},${60 + i * 5},${55})`;
      g.fillRect(x + 1, y + 1, 30, 30);
      g.fillStyle = 'rgba(200,255,220,0.6)';
      g.font = '6px monospace';
      g.fillText('CAM' + (i + 1), x + 3, y + 8);
    }
  }, { repeat: false }],
  door_metal: [64, (g, s, img) => {
    img((x, y) => {
      const n = fbm(x, y, s, 4, 3, 201);
      const v = 100 + (n - 0.5) * 25 + (x < 2 || x > s - 3 ? -30 : 0);
      return [v - 8, v + 2, v + 10];
    });
    // hazard band
    for (let x = 0; x < s; x += 8) {
      g.fillStyle = (x / 8) % 2 ? '#d8a818' : '#222';
      g.beginPath(); g.moveTo(x, s * 0.86); g.lineTo(x + 8, s * 0.86); g.lineTo(x + 4, s); g.lineTo(x - 4, s); g.fill();
    }
    g.fillStyle = '#3a3f46';
    g.fillRect(s * 0.1, s * 0.15, s * 0.8, s * 0.08);
  }, { repeat: false }],
  door_vault: [64, (g, s, img) => {
    img((x, y) => {
      const d = Math.hypot(x - s / 2, y - s / 2);
      const ring = Math.abs(d - s * 0.35) < 2 ? -40 : 0;
      const n = fbm(x, y, s, 4, 3, 202);
      const v = 120 + ring + (n - 0.5) * 20;
      return [v + 4, v + 4, v];
    });
    g.fillStyle = '#b01818';
    g.fillRect(0, 0, s, 5);
    g.fillRect(0, s - 5, s, 5);
  }, { repeat: false }],
  helipad: [128, (g, s, img) => {
    img((x, y) => {
      const n = fbm(x, y, s, 8, 3, 211);
      const v = 70 + (n - 0.5) * 20;
      return [v, v, v + 3];
    });
    g.strokeStyle = '#d8d0b0';
    g.lineWidth = 6;
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#d8d0b0';
    g.fillRect(s * 0.32, s * 0.28, s * 0.09, s * 0.44);
    g.fillRect(s * 0.59, s * 0.28, s * 0.09, s * 0.44);
    g.fillRect(s * 0.32, s * 0.46, s * 0.36, s * 0.08);
  }, { repeat: false }],
  water_tank: [64, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 4, 221);
    const rust = n > 0.6 ? 50 : 0;
    const band = y % 32 < 2 ? -30 : 0;
    const v = 110 + (n - 0.5) * 20 + band;
    return [v + rust, v + rust * 0.4, v - 10];
  })],
  generator: [64, (g, s, img) => {
    img((x, y) => {
      const n = fbm(x, y, s, 4, 3, 231);
      const v = (n - 0.5) * 20;
      const grill = y > 20 && y < 44 && x % 6 < 2 ? -40 : 0;
      return [70 + v + grill, 90 + v + grill, 62 + v + grill];
    });
    g.fillStyle = '#d8a818';
    g.fillRect(4, 4, 20, 8);
    g.fillStyle = '#111';
    g.font = 'bold 7px monospace';
    g.fillText('ДГ-200', 5, 11);
  }],
  lamp: [16, (g, s) => { g.fillStyle = '#fff6d0'; g.fillRect(0, 0, s, s); }],
  glow_core: [32, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 3, 241);
    return [80 + n * 60, 200 + n * 55, 255];
  })],
  keycard_blue: [32, (g, s) => { g.fillStyle = '#1d4fd8'; g.fillRect(0, 0, s, s); g.fillStyle = '#ddd'; g.fillRect(3, 3, 10, 7); g.fillStyle = '#ffcc00'; g.fillRect(4, s - 10, s - 8, 3); }, { repeat: false }],
  keycard_red: [32, (g, s) => { g.fillStyle = '#c21b1b'; g.fillRect(0, 0, s, s); g.fillStyle = '#ddd'; g.fillRect(3, 3, 10, 7); g.fillStyle = '#ffcc00'; g.fillRect(4, s - 10, s - 8, 3); }, { repeat: false }],
  files: [32, (g, s) => { g.fillStyle = '#c9a55a'; g.fillRect(0, 0, s, s); g.fillStyle = '#a5121a'; g.font = 'bold 8px monospace'; g.fillText('СЕКРЕТНО', 0, 18); }, { repeat: false }],
  blood: [64, (g, s) => {
    g.clearRect(0, 0, s, s);
    const blob = (cx: number, cy: number, r: number) => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); };
    g.fillStyle = 'rgba(95,4,4,0.95)';
    blob(s / 2, s / 2, s * 0.24);
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, d = s * (0.15 + Math.random() * 0.3);
      blob(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 1 + Math.random() * s * 0.07);
    }
    g.fillStyle = 'rgba(140,10,8,0.6)';
    blob(s / 2 - 3, s / 2 - 3, s * 0.12);
  }, { repeat: false }],
  bullethole: [32, (g, s) => {
    g.clearRect(0, 0, s, s);
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(0.18, 'rgba(10,10,10,0.95)');
    gr.addColorStop(0.35, 'rgba(40,36,30,0.6)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }, { repeat: false }],
  scorch: [64, (g, s) => {
    g.clearRect(0, 0, s, s);
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)');
    gr.addColorStop(0.6, 'rgba(15,12,10,0.6)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }, { repeat: false }],
  flash: [64, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.translate(s / 2, s / 2);
    for (let i = 0; i < 7; i++) {
      g.rotate((Math.PI * 2) / 7 + Math.random() * 0.3);
      const gr = g.createLinearGradient(0, 0, s / 2, 0);
      gr.addColorStop(0, 'rgba(255,240,200,1)');
      gr.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -3); g.lineTo(s / 2, 0); g.lineTo(0, 3); g.fill();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, s / 3);
    gr.addColorStop(0, 'rgba(255,255,240,1)');
    gr.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = gr;
    g.fillRect(-s / 2, -s / 2, s, s);
  }, { repeat: false }],
  soft: [32, (g, s) => {
    g.clearRect(0, 0, s, s);
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }, { repeat: false }],
  smoke: [64, (_g, s, img) => {
    // alpha written separately below
    img((x, y) => { const n = fbm(x, y, s, 3, 4, 251); return [n * 255, n * 255, n * 255]; });
    const g2 = _g;
    const id = g2.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const d = Math.hypot(x - s / 2, y - s / 2) / (s / 2);
      const n = id.data[i] / 255;
      id.data[i + 3] = Math.max(0, (1 - d) * n * 1.6) * 255;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = 200;
    }
    g2.putImageData(id, 0, 0);
  }, { repeat: false }],
  pipe: [64, (_g, s, img) => img((x, y) => {
    const n = fbm(x, y, s, 4, 4, 261);
    const v = 85 + (n - 0.5) * 50 + Math.sin(y * 0.5) * 5;
    return [v + 10, v + 8, v];
  })],
};

/** Face textures for character heads (front). */
function paintFace(g: CanvasRenderingContext2D, s: number, kind: 'merc' | 'balaclava' | 'scientist' | 'officer') {
  const skin = kind === 'scientist' ? '#d9a689' : '#c99272';
  if (kind === 'balaclava') {
    g.fillStyle = '#1c1e1f';
    g.fillRect(0, 0, s, s);
    g.fillStyle = skin;
    g.fillRect(s * 0.18, s * 0.34, s * 0.64, s * 0.2);
  } else {
    g.fillStyle = skin;
    g.fillRect(0, 0, s, s);
    // hair / stubble
    g.fillStyle = kind === 'scientist' ? '#9a9a9a' : '#3a2a1c';
    g.fillRect(0, 0, s, s * (kind === 'officer' ? 0.2 : 0.16));
    if (kind !== 'scientist') {
      g.fillStyle = 'rgba(60,40,30,0.35)';
      g.fillRect(s * 0.15, s * 0.66, s * 0.7, s * 0.34);
    }
  }
  // eyes
  g.fillStyle = '#f2f2f2';
  g.fillRect(s * 0.24, s * 0.4, s * 0.17, s * 0.09);
  g.fillRect(s * 0.59, s * 0.4, s * 0.17, s * 0.09);
  g.fillStyle = '#1b2733';
  g.fillRect(s * 0.3, s * 0.4, s * 0.08, s * 0.09);
  g.fillRect(s * 0.62, s * 0.4, s * 0.08, s * 0.09);
  // brows
  g.fillStyle = 'rgba(30,20,15,0.9)';
  g.fillRect(s * 0.22, s * 0.34, s * 0.2, s * 0.04);
  g.fillRect(s * 0.58, s * 0.34, s * 0.2, s * 0.04);
  if (kind !== 'balaclava') {
    // nose + mouth
    g.fillStyle = 'rgba(120,70,50,0.6)';
    g.fillRect(s * 0.46, s * 0.48, s * 0.08, s * 0.16);
    g.fillStyle = '#6b2f2a';
    g.fillRect(s * 0.34, s * 0.73, s * 0.32, s * 0.05);
  }
  if (kind === 'scientist') {
    g.strokeStyle = '#222';
    g.lineWidth = 1.5;
    g.strokeRect(s * 0.21, s * 0.37, s * 0.23, s * 0.15);
    g.strokeRect(s * 0.56, s * 0.37, s * 0.23, s * 0.15);
  }
}

for (const k of ['merc', 'balaclava', 'scientist', 'officer'] as const) {
  painters['face_' + k] = [32, (g, s) => paintFace(g, s, k), { repeat: false }];
}

/** Sign with Cyrillic text. */
export function signTexture(text: string, sub = '', bg = '#d6c9a0', fg = '#8a1010'): THREE.Texture {
  const key = 'sign_' + text + sub + bg;
  const c = cache.get(key);
  if (c) return c;
  const t = make(key, 128, (g, s) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, s, s / 2);
    g.fillStyle = fg;
    g.fillRect(0, 0, s, 6);
    g.fillRect(0, s / 2 - 6, s, 6);
    g.font = 'bold 20px Arial';
    g.textAlign = 'center';
    g.fillText(text, s / 2, 32);
    g.font = '11px Arial';
    g.fillStyle = '#222';
    g.fillText(sub, s / 2, 48);
  }, { repeat: false });
  t.repeat.set(1, 2);
  t.offset.set(0, 0.5);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function tex(name: string): THREE.Texture {
  const c = cache.get(name);
  if (c) return c;
  const p = painters[name];
  if (!p) throw new Error('No texture ' + name);
  return make(name, p[0], p[1], p[2]);
}

export function allTextures() { return [...cache.values()]; }

export function preloadTextures() {
  for (const k of Object.keys(painters)) tex(k);
}
