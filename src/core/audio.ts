// Procedural audio: every sound is synthesized at startup into AudioBuffers.
// Gunshots are layered (transient + crack + body + sub thump + tail), saturated, then
// sent through spatial panners and a generated convolution reverb (indoor / outdoor).

type Vec3Like = { x: number; y: number; z: number };

export interface PlayOpts {
  pos?: Vec3Like;
  vol?: number;
  rate?: number;
  refDist?: number;
  /** 0..1, how much the source is blocked by walls (adds lowpass). */
  occlusion?: number;
  /** Multiplier on reverb send. */
  wet?: number;
  /** Treat as 2D UI sound. */
  ui?: boolean;
}

function rnd(a = -1, b = 1) { return a + Math.random() * (b - a); }

export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private verbIn!: GainNode;
  private verbOut!: GainNode;
  private sendIndoor!: GainNode;
  private sendOutdoor!: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private windGain!: GainNode;
  private humGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private sirenGain: GainNode | null = null;
  private heliGain: GainNode | null = null;
  private heartbeatTimer = 0;
  private indoorMix = 0;
  volume = 0.8;
  barksEnabled = true;
  private lastSpeak = 0;
  private listener = { x: 0, y: 0, z: 0 };

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.55;
    this.amb.connect(this.master);

    // Reverb buses
    this.verbIn = ctx.createGain();
    this.verbOut = ctx.createGain();
    const convIndoor = ctx.createConvolver();
    convIndoor.buffer = this.makeIR(0.9, false);
    const convOutdoor = ctx.createConvolver();
    convOutdoor.buffer = this.makeIR(2.8, true);
    this.sendIndoor = ctx.createGain();
    this.sendOutdoor = ctx.createGain();
    this.verbIn.connect(this.sendIndoor).connect(convIndoor).connect(this.master);
    this.verbIn.connect(this.sendOutdoor).connect(convOutdoor).connect(this.master);
    this.setIndoor(0);

    this.generateAll();
    this.startAmbience();
    try { window.speechSynthesis?.getVoices(); } catch { /* no tts */ }
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // ---------------------------------------------------------------- synthesis helpers
  private buf(dur: number, fn: (t: number, i: number, sr: number) => number, stereo = false): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const n = Math.max(1, Math.floor(dur * sr));
    const b = ctx.createBuffer(stereo ? 2 : 1, n, sr);
    const d = b.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = fn(i / sr, i, sr);
      d[i] = v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    if (peak > 0.0001) {
      const g = 0.95 / peak;
      for (let i = 0; i < n; i++) d[i] *= g;
    }
    // Fade the last few ms to avoid clicks
    const fade = Math.min(n, Math.floor(sr * 0.004));
    for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
    if (stereo) b.getChannelData(1).set(d);
    return b;
  }

  private add(name: string, b: AudioBuffer) {
    const arr = this.buffers.get(name) ?? [];
    arr.push(b);
    this.buffers.set(name, arr);
  }

  private makeIR(seconds: number, outdoor: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const n = Math.floor(seconds * sr);
    const b = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let v = rnd() * Math.exp(-t * (outdoor ? 2.2 : 6.5));
        if (outdoor) {
          // discrete mountain slap echoes
          for (const e of [0.21, 0.47, 0.83, 1.35]) {
            const dt = t - e - ch * 0.013;
            if (dt > 0 && dt < 0.09) v += rnd() * 1.6 * Math.exp(-dt * 40) * Math.exp(-e * 1.4);
          }
          lp += (v - lp) * 0.18; // darker tail
          v = lp * 2.2;
        } else {
          if (t < 0.04) v *= t / 0.04 * 0.6 + 0.4;
          lp += (v - lp) * 0.55;
          v = lp;
        }
        d[i] = v * 0.5;
      }
    }
    return b;
  }

  // ---------------------------------------------------------------- layered composer
  // Sounds are built from layers mixed into one sample array, then saturated + normalised.
  // Layers: filtered noise bursts, inharmonic metal modes (real metal is never a pure sine),
  // and falling-pitch sub thumps.
  private compose(dur: number, layers: ((d: Float32Array, sr: number) => void)[], drive = 1.4): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const n = Math.max(1, Math.floor(dur * sr));
    const d = new Float32Array(n);
    for (const l of layers) l(d, sr);
    let peak = 0;
    for (let i = 0; i < n; i++) { d[i] = Math.tanh(d[i] * drive); const a = Math.abs(d[i]); if (a > peak) peak = a; }
    const g = peak > 1e-4 ? 0.95 / peak : 1;
    const fade = Math.min(n, Math.floor(sr * 0.004));
    for (let i = 0; i < n; i++) d[i] *= g * (i > n - fade ? (n - i) / fade : 1);
    const b = ctx.createBuffer(1, n, sr);
    b.getChannelData(0).set(d);
    return b;
  }

  /** Noise burst. lp/hp in Hz (0 = off), decay = exp rate, attack seconds, optional rattle (AM). */
  private noise(t0: number, dur: number, o: { amp?: number; decay?: number; lp?: number; hp?: number; attack?: number; rattle?: number; lp2?: boolean }) {
    return (d: Float32Array, sr: number) => {
      const a = o.amp ?? 1, k = o.decay ?? 30, att = o.attack ?? 0;
      const cl = o.lp ? 1 - Math.exp((-2 * Math.PI * o.lp) / sr) : 1;
      const ch = o.hp ? 1 - Math.exp((-2 * Math.PI * o.hp) / sr) : 0;
      let l1 = 0, l2 = 0, h = 0;
      const i0 = Math.floor(t0 * sr), i1 = Math.min(d.length, Math.floor((t0 + dur) * sr));
      for (let i = i0; i < i1; i++) {
        const t = (i - i0) / sr;
        let x = Math.random() * 2 - 1;
        l1 += (x - l1) * cl; x = l1;
        if (o.lp2) { l2 += (x - l2) * cl; x = l2; }
        if (ch > 0) { h += (x - h) * ch; x = x - h; }
        let env = Math.exp(-t * k);
        if (att > 0 && t < att) env *= t / att;
        if (o.rattle) env *= 0.55 + 0.45 * Math.sin(t * o.rattle * 2 * Math.PI + Math.sin(t * 37) * 3);
        d[i] += x * env * a;
      }
    };
  }

  /** Inharmonic modal ring: struck metal. */
  private modes(t0: number, base: number, o: { amp?: number; decay?: number; ratios?: number[]; dur?: number }) {
    const ratios = o.ratios ?? [1, 1.47, 2.09, 2.56, 3.31, 4.18, 5.07];
    const parts = ratios.map((r, i) => ({ f: base * r * (1 + rnd(-0.015, 0.015)), a: (0.9 / (1 + i * 0.6)) * (0.6 + Math.random() * 0.4), k: (o.decay ?? 60) * (1 + i * 0.35), ph: Math.random() * 6.28 }));
    return (d: Float32Array, sr: number) => {
      const i0 = Math.floor(t0 * sr), i1 = Math.min(d.length, Math.floor((t0 + (o.dur ?? 0.25)) * sr));
      for (let i = i0; i < i1; i++) {
        const t = (i - i0) / sr;
        let v = 0;
        for (const p of parts) v += Math.sin(p.ph + 2 * Math.PI * p.f * t) * p.a * Math.exp(-t * p.k);
        d[i] += v * (o.amp ?? 1);
      }
    };
  }

  /** Falling sine thump (body / chest punch). */
  private thump(t0: number, f0: number, f1: number, o: { amp?: number; decay?: number; sweep?: number }) {
    return (d: Float32Array, sr: number) => {
      let ph = 0;
      const i0 = Math.floor(t0 * sr), i1 = Math.min(d.length, i0 + Math.floor(0.4 * sr));
      for (let i = i0; i < i1; i++) {
        const t = (i - i0) / sr;
        const f = f1 + (f0 - f1) * Math.exp(-t * (o.sweep ?? 30));
        ph += (2 * Math.PI * f) / sr;
        d[i] += Math.sin(ph) * Math.exp(-t * (o.decay ?? 30)) * (o.amp ?? 1) * Math.min(1, t * 2000);
      }
    };
  }

  /** Metal-on-metal mechanical clack: sharp transient + ring + body knock. */
  private clack(t0: number, scale = 1, weight = 1, amp = 1) {
    const s = scale * (1 + rnd(-0.05, 0.05));
    return [
      this.noise(t0, 0.004, { amp: 1.4 * amp, decay: 700, hp: 2500 }),
      this.noise(t0, 0.03, { amp: 0.7 * amp, decay: 160, lp: 7000 * s, hp: 900 }),
      this.modes(t0, 1750 * s, { amp: 0.32 * amp, decay: 75 / Math.max(0.4, weight), dur: 0.2 }),
      this.thump(t0, 320 * s, 180 * s, { amp: 0.3 * amp * weight, decay: 70, sweep: 60 }),
    ];
  }

  /** Layered firearm report. */
  private gunshot(o: { crack: number; body: number; bodyLP: number; thumpF0: number; thumpF1: number; thump: number; decay: number; tail: number; drive: number; dur: number }) {
    return this.compose(o.dur, [
      this.noise(0, 0.004, { amp: 2.2 * o.crack, decay: 800, hp: 1800 }),
      this.noise(0, 0.12, { amp: 1.1 * o.crack, decay: 110, hp: 1400 }),
      this.noise(0, 0.5, { amp: 3.2 * o.body, decay: o.decay, lp: o.bodyLP, hp: 250, lp2: true }),
      this.noise(0, 0.25, { amp: 1.6 * o.body, decay: o.decay * 1.5, lp: 4500, hp: 900 }),
      this.thump(0, o.thumpF0, o.thumpF1, { amp: 0.45 * o.thump, decay: 26 }),
      this.noise(0.01, o.dur, { amp: 0.5 * o.tail, decay: 5, lp: 450, lp2: true }),
      ...this.clack(0.014, 0.9, 1.1, 0.22),
    ], o.drive);
  }

  /** Suppressed pistol: heavy muffled THWAP + slide cycling clack-clack. */
  private suppressed(pitch: number, heavy = false) {
    const p = pitch;
    return this.compose(heavy ? 0.45 : 0.32, [
      this.noise(0, 0.002, { amp: 1.6, decay: 900, hp: 2200 }),
      this.noise(0, 0.18, { amp: heavy ? 4.2 : 3.6, decay: heavy ? 28 : 36, lp: (heavy ? 1900 : 2600) * p, hp: 280, lp2: true }),
      this.noise(0, 0.06, { amp: 1.4, decay: 70, lp: 5000, hp: 1200 }),
      this.noise(0, 0.012, { amp: 0.9, decay: 300, lp: 6000, hp: 2500 }),
      this.thump(0, (heavy ? 140 : 170) * p, (heavy ? 60 : 75) * p, { amp: heavy ? 0.6 : 0.45, decay: heavy ? 22 : 30 }),
      ...this.clack(heavy ? 0.03 : 0.008, 1.0 * p, heavy ? 1.4 : 1, heavy ? 0.9 : 0.75),
      ...this.clack(heavy ? 0.12 : 0.048, 1.12 * p, heavy ? 1.2 : 0.8, 0.6),
      this.noise(0.01, 0.3, { amp: 0.35, decay: 9, lp: 700, lp2: true }),
    ], 1.8);
  }

  private metalClick(freqs: number[], decay: number, noiseAmt: number, dur = 0.15) {
    return this.buf(dur, (t) => {
      let v = rnd() * Math.exp(-t * 600) * noiseAmt;
      for (const f of freqs) v += Math.sin(t * 2 * Math.PI * f * (1 + rnd(-0.002, 0.002))) * Math.exp(-t * decay);
      return v;
    });
  }

  private generateAll() {
    // ---- firearms (3 variations each)
    for (let k = 0; k < 3; k++) {
      const j = () => 1 + rnd(-0.06, 0.06);
      this.add('pistol_sup', this.suppressed(j()));
      this.add('rifle_sup', this.suppressed(j() * 0.9, true));
      this.add('smg', this.gunshot({ crack: 1.0 * j(), body: 0.9, bodyLP: 2200, thumpF0: 170, thumpF1: 60, thump: 0.9, decay: 32, tail: 0.3, drive: 2.2, dur: 0.6 }));
      this.add('rifle', this.gunshot({ crack: 1.3 * j(), body: 1.1, bodyLP: 1500, thumpF0: 150, thumpF1: 45, thump: 1.3, decay: 22, tail: 0.4, drive: 2.8, dur: 0.85 }));
      this.add('shotgun', this.gunshot({ crack: 1.1 * j(), body: 1.4, bodyLP: 900, thumpF0: 120, thumpF1: 38, thump: 1.7, decay: 14, tail: 0.55, drive: 3.4, dur: 1.0 }));
      this.add('pistol', this.gunshot({ crack: 1.2 * j(), body: 0.8, bodyLP: 2400, thumpF0: 190, thumpF1: 70, thump: 0.9, decay: 30, tail: 0.3, drive: 2.0, dur: 0.6 }));
      this.add('sniper', this.gunshot({ crack: 1.6 * j(), body: 1.2, bodyLP: 1100, thumpF0: 130, thumpF1: 40, thump: 1.6, decay: 16, tail: 0.65, drive: 3.2, dur: 1.2 }));
    }
    // ---- weapon handling (2 variations each)
    for (let k = 0; k < 2; k++) {
      // hammer / striker falling on an empty chamber
      this.add('dryfire', this.compose(0.12, [...this.clack(0, 1.5, 0.35, 0.8)], 1.2));
      // mag release click, mag scraping out of the well, mag knock
      this.add('mag_out', this.compose(0.4, [
        ...this.clack(0, 1.4, 0.4, 0.55),
        this.noise(0.025, 0.14, { amp: 0.5, decay: 8, lp: 3800, hp: 900, attack: 0.04, rattle: 90 }),
        ...this.clack(0.17, 0.75, 1.2, 0.6),
      ], 1.3));
      // mag scraping in, then a solid seat + catch click
      this.add('mag_in', this.compose(0.35, [
        this.noise(0, 0.1, { amp: 0.45, decay: 6, lp: 3500, hp: 800, attack: 0.05, rattle: 110 }),
        ...this.clack(0.1, 0.85, 1.6, 1.0),
        ...this.clack(0.122, 1.45, 0.4, 0.45),
      ], 1.5));
      // charging handle / slide rack: back with a scrape, slam home
      this.add('bolt', this.compose(0.42, [
        ...this.clack(0, 1.05, 0.9, 0.85),
        this.noise(0.01, 0.1, { amp: 0.4, decay: 10, lp: 5000, hp: 1200, rattle: 140 }),
        ...this.clack(0.15, 0.95, 1.5, 1.0),
      ], 1.6));
      // pump shotgun: shuck back, shuck forward
      this.add('pump', this.compose(0.5, [
        this.noise(0, 0.07, { amp: 0.6, decay: 25, lp: 2500, hp: 300 }),
        ...this.clack(0.045, 0.7, 1.7, 0.95),
        this.noise(0.17, 0.07, { amp: 0.6, decay: 25, lp: 2500, hp: 300 }),
        ...this.clack(0.215, 0.8, 1.8, 1.0),
      ], 1.6));
      // shell pushed into the tube
      this.add('shell_in', this.compose(0.22, [
        this.noise(0, 0.05, { amp: 0.5, decay: 40, lp: 3000, hp: 400 }),
        ...this.clack(0.035, 0.9, 1.1, 0.8),
      ], 1.4));
      // weapon swap: sling / cloth rustle + receiver knock
      this.add('weapon_switch', this.compose(0.32, [
        this.noise(0, 0.25, { amp: 0.5, decay: 9, lp: 2200, hp: 300, attack: 0.06, rattle: 23 }),
        ...this.clack(0.15, 0.9, 1.0, 0.55),
      ], 1.3));
      // ammo / gear pickup: cloth grab + rattling rounds
      const rattles = [0.03, 0.07 + Math.random() * 0.02, 0.1 + Math.random() * 0.03, 0.14 + Math.random() * 0.03].flatMap((t) => this.clack(t, 1.2 + Math.random() * 0.5, 0.3, 0.35 + Math.random() * 0.25));
      this.add('pickup', this.compose(0.32, [
        this.noise(0, 0.2, { amp: 0.55, decay: 12, lp: 2600, hp: 300, attack: 0.03, rattle: 30 }),
        ...rattles,
      ], 1.4));
    }
    // ---- brass casings bouncing on the floor
    for (let k = 0; k < 4; k++) {
      const f = 3600 + Math.random() * 2200;
      const t1 = 0.06 + Math.random() * 0.04, t2 = t1 + 0.05 + Math.random() * 0.04;
      this.add('shell', this.compose(0.32, [
        this.modes(0, f, { amp: 0.7, decay: 45, ratios: [1, 1.53, 2.31, 2.97], dur: 0.3 }),
        this.noise(0, 0.004, { amp: 0.6, decay: 900, hp: 4000 }),
        this.modes(t1, f * 1.01, { amp: 0.4, decay: 60, ratios: [1, 1.53, 2.31], dur: 0.2 }),
        this.modes(t2, f * 0.99, { amp: 0.22, decay: 80, ratios: [1, 1.53], dur: 0.15 }),
      ], 1.1));
    }
    // ---- footsteps
    for (let k = 0; k < 5; k++) {
      // snow crunch: many tiny grains, low-passed
      const grains: number[] = [];
      for (let g = 0; g < 26; g++) grains.push(Math.random() * 0.13);
      let lp = 0;
      this.add('step_snow', this.buf(0.2, (t) => {
        let v = 0;
        for (const g of grains) { const d = t - g; if (d > 0 && d < 0.012) v += rnd() * (1 - d / 0.012); }
        lp += (v - lp) * 0.3;
        return lp * Math.exp(-t * 10);
      }));
      let lp2 = 0;
      const pf = 90 + Math.random() * 40;
      this.add('step_concrete', this.buf(0.14, (t) => {
        const n = rnd();
        lp2 += (n - lp2) * 0.25;
        return (n * Math.exp(-t * 220) * 0.4 + lp2 * Math.exp(-t * 50) * 1.2 + Math.sin(t * 2 * Math.PI * pf) * Math.exp(-t * 45) * 0.8);
      }));
      const mf = 500 + Math.random() * 300;
      this.add('step_metal', this.buf(0.3, (t) => rnd() * Math.exp(-t * 200) * 0.5 + Math.sin(t * 2 * Math.PI * mf) * Math.exp(-t * 18) * 0.35 + Math.sin(t * 2 * Math.PI * mf * 2.7) * Math.exp(-t * 30) * 0.2 + Math.sin(t * 2 * Math.PI * 110) * Math.exp(-t * 40) * 0.5));
    }
    // ---- impacts
    for (let k = 0; k < 4; k++) {
      let lp = 0;
      this.add('hit_concrete', this.buf(0.35, (t) => {
        const n = rnd();
        lp += (n - lp) * 0.12;
        let v = n * Math.exp(-t * 160) + lp * Math.exp(-t * 25) * 1.5;
        // debris
        if (t > 0.03 && Math.random() < 0.004) v += rnd() * 2;
        return v * (t > 0.03 ? Math.exp(-(t - 0.03) * 12) : 1);
      }));
      const f = 2000 + Math.random() * 2500;
      this.add('hit_metal', this.buf(0.5, (t) => rnd() * Math.exp(-t * 300) * 0.8 + Math.sin(t * 2 * Math.PI * f) * Math.exp(-t * 12) * 0.5 + Math.sin(t * 2 * Math.PI * f * 1.41) * Math.exp(-t * 16) * 0.35));
      let lpf = 0;
      this.add('hit_flesh', this.buf(0.28, (t) => {
        const n = rnd();
        lpf += (n - lpf) * 0.07;
        const squelch = Math.sin(t * 2 * Math.PI * (180 + 120 * Math.sin(t * 60))) * Math.exp(-t * 30) * 0.4;
        return lpf * Math.exp(-t * 22) * 4 + squelch + n * Math.exp(-t * 400) * 0.3;
      }));
      let lps = 0;
      this.add('hit_snow', this.buf(0.2, (t) => { lps += (rnd() - lps) * 0.2; return lps * Math.exp(-t * 30); }));
    }
    for (let k = 0; k < 3; k++) {
      const f0 = 3200 + Math.random() * 1500;
      this.add('ricochet', this.buf(0.45, (t) => Math.sin(2 * Math.PI * (f0 * t - 1800 * t * t) + Math.sin(t * 90) * 2) * Math.exp(-t * 7) * 0.6 * Math.min(1, t * 80)));
    }
    this.add('headshot', this.buf(0.35, (t) => {
      const n = rnd();
      return n * Math.exp(-t * 90) * 0.8 + Math.sin(t * 2 * Math.PI * 90) * Math.exp(-t * 30) * 0.9 + (Math.random() < 0.02 ? rnd() * Math.exp(-t * 10) : 0);
    }));
    // ---- glass
    this.add('glass', this.buf(0.9, (t) => {
      let v = rnd() * Math.exp(-t * 40) * 0.6;
      if (Math.random() < 0.003 * Math.exp(-t * 3)) v += rnd() * 3;
      return v + Math.sin(t * 2 * Math.PI * 5200) * Math.exp(-t * 20) * 0.2;
    }));
    // ---- explosion
    let elp = 0, elp2 = 0, ephase = 0;
    this.add('explosion', this.buf(2.4, (t, _i, sr) => {
      const n = rnd();
      elp += (n - elp) * 0.05;
      elp2 += (elp - elp2) * 0.1;
      const f = 25 + 55 * Math.exp(-t * 6);
      ephase += (2 * Math.PI * f) / sr;
      const crackle = Math.random() < 0.002 * Math.exp(-t * 2) ? rnd() * 2 : 0;
      const v = n * Math.exp(-t * 60) * 1.2 + elp2 * Math.exp(-t * 2.2) * 8 + Math.sin(ephase) * Math.exp(-t * 3.5) * 1.4 + crackle;
      return Math.tanh(v * 2);
    }));
    // ---- melee & takedowns
    let wlp = 0;
    this.add('swing', this.buf(0.25, (t) => { wlp += (rnd() - wlp) * (0.05 + t * 1.5); return wlp * Math.sin(Math.PI * t / 0.25) * 2; }));
    this.add('punch', this.buf(0.2, (t) => { const n = rnd(); return n * Math.exp(-t * 120) + Math.sin(t * 2 * Math.PI * 80) * Math.exp(-t * 35) * 1.5; }));
    this.add('crunch', this.buf(0.3, (t) => {
      let v = Math.sin(t * 2 * Math.PI * 70) * Math.exp(-t * 25);
      if (t > 0.04 && t < 0.16 && Math.random() < 0.05) v += rnd() * 1.6;
      return v + rnd() * Math.exp(-t * 80) * 0.5;
    }));
    // ---- body fall
    let blp = 0;
    this.add('bodyfall', this.buf(0.6, (t) => {
      blp += (rnd() - blp) * 0.06;
      let v = blp * Math.exp(-t * 14) * 5 + Math.sin(t * 2 * Math.PI * 60) * Math.exp(-t * 20);
      const t2 = t - 0.18;
      if (t2 > 0) v += Math.sin(t2 * 2 * Math.PI * 75) * Math.exp(-t2 * 25) * 0.6;
      return v;
    }));
    // ---- voice grunts (formant-filtered buzz)
    for (let k = 0; k < 5; k++) {
      const f0 = 95 + Math.random() * 50;
      const dur = 0.25 + Math.random() * 0.25;
      let ph = 0, a1 = 0, a2 = 0;
      const vowel = Math.random();
      this.add('grunt', this.buf(dur, (t, _i, sr) => {
        const f = f0 * (1.15 - 0.3 * (t / dur));
        ph += f / sr;
        const saw = (ph % 1) * 2 - 1;
        a1 += (saw - a1) * (0.08 + vowel * 0.05);
        a2 += (a1 - a2) * 0.12;
        const env = Math.min(1, t * 40) * Math.exp(-t * 6);
        return (a1 - a2 * 0.6 + rnd() * 0.08) * env;
      }));
    }
    // ---- doors / UI
    let dlp = 0;
    this.add('door', this.buf(0.9, (t) => {
      dlp += (rnd() - dlp) * 0.08;
      const env = Math.sin(Math.PI * Math.min(1, t / 0.8));
      return dlp * env * 2.5 + Math.sin(t * 2 * Math.PI * (120 + t * 40)) * env * 0.25 + (t > 0.78 ? Math.sin(t * 2 * Math.PI * 70) * Math.exp(-(t - 0.78) * 40) : 0);
    }));
    this.add('beep', this.buf(0.15, (t) => Math.sin(t * 2 * Math.PI * 1760) * (t < 0.13 ? 1 : 0) * 0.5));
    this.add('denied', this.buf(0.4, (t) => Math.sign(Math.sin(t * 2 * Math.PI * 140)) * 0.3 * (t < 0.35 ? 1 : 0)));
    this.add('objective', this.buf(0.9, (t) => {
      let v = 0;
      for (const [s, f] of [[0, 660], [0.12, 880], [0.24, 1320]] as const) {
        const d = t - s;
        if (d > 0) v += Math.sin(d * 2 * Math.PI * f) * Math.exp(-d * 5) * 0.4;
      }
      return v;
    }));
    this.add('fail', this.buf(1.1, (t) => {
      let v = 0;
      for (const [s, f] of [[0, 440], [0.2, 330], [0.4, 220]] as const) {
        const d = t - s;
        if (d > 0) v += Math.sign(Math.sin(d * 2 * Math.PI * f)) * Math.exp(-d * 4) * 0.2;
      }
      return v;
    }));
    this.add('ui', this.buf(0.06, (t) => Math.sin(t * 2 * Math.PI * 1200) * Math.exp(-t * 60)));
    this.add('ui_select', this.buf(0.2, (t) => Math.sin(t * 2 * Math.PI * (600 + t * 2400)) * Math.exp(-t * 18)));
    let rlp = 0;
    this.add('radio', this.buf(0.18, (t) => { rlp += (rnd() - rlp) * 0.5; return (rnd() - rlp) * Math.exp(-t * 8) * 0.6; }));
    this.add('hitmarker', this.buf(0.05, (t) => Math.sin(t * 2 * Math.PI * 2400) * Math.exp(-t * 80)));
    this.add('heartbeat', this.buf(0.6, (t) => {
      let v = 0;
      for (const s of [0, 0.22]) { const d = t - s; if (d > 0) v += Math.sin(d * 2 * Math.PI * 50) * Math.exp(-d * 18) * (s === 0 ? 1 : 0.6); }
      return v;
    }));
    this.add('bounce', this.metalClick([700, 1450], 40, 1.2, 0.2));
    this.add('coin', this.metalClick([4200, 6300, 7900], 25, 0.4, 0.4));
    this.add('nvg_on', this.buf(0.5, (t) => Math.sin(2 * Math.PI * (4000 * t + 6000 * t * t)) * 0.15 * Math.exp(-t * 3)));
    this.add('typing', this.buf(0.5, (t) => { const ph = (t * 14) % 1; return ph < 0.1 ? rnd() * (1 - ph * 10) : 0; }));
    let slp = 0;
    this.add('spark', this.buf(0.6, (t) => { slp += (rnd() - slp) * 0.6; return (Math.random() < 0.08 ? slp * 3 : 0) * Math.exp(-t * 4); }));
  }

  // ---------------------------------------------------------------- ambience
  private noiseLoop(seconds: number) {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd();
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    return src;
  }

  private startAmbience() {
    const ctx = this.ctx!;
    // wind
    const wind = this.noiseLoop(4);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.35;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(this.windFilter.frequency);
    wind.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    wind.start();
    lfo.start();
    // indoor hum
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    for (const [f, g] of [[50, 0.05], [100, 0.04], [150, 0.015], [300, 0.006]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.humGain);
      o.start();
    }
    const hiss = this.noiseLoop(2);
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 900;
    const hg = ctx.createGain();
    hg.gain.value = 0.03;
    hiss.connect(hf).connect(hg).connect(this.humGain);
    hiss.start();
    this.humGain.connect(this.amb);
  }

  /** 0 = outdoors, 1 = indoors. Smoothly crossfades reverb + ambience. */
  setIndoor(target: number) {
    if (!this.ctx) return;
    this.indoorMix += (target - this.indoorMix) * 0.05;
    const m = this.indoorMix;
    this.sendIndoor.gain.value = 0.55 * m;
    this.sendOutdoor.gain.value = 0.42 * (1 - m);
    if (this.windGain) {
      this.windGain.gain.value = 0.35 * (1 - m) + 0.04;
      this.humGain.gain.value = 0.9 * m;
    }
  }

  setSiren(on: boolean) {
    if (!this.ctx) return;
    if (on && !this.sirenGain) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.45;
      const lg = ctx.createGain();
      lg.gain.value = 260;
      o.frequency.value = 620;
      lfo.connect(lg).connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 1);
      o.connect(f).connect(g).connect(this.amb);
      g.connect(this.verbIn);
      o.start();
      lfo.start();
      this.sirenGain = g;
      (g as any)._nodes = [o, lfo];
    } else if (!on && this.sirenGain) {
      const g = this.sirenGain;
      g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1);
      const nodes = (g as any)._nodes as OscillatorNode[];
      setTimeout(() => nodes.forEach((n) => n.stop()), 1200);
      this.sirenGain = null;
    }
  }

  setHeli(vol: number) {
    if (!this.ctx) return;
    if (!this.heliGain) {
      const ctx = this.ctx;
      const src = this.noiseLoop(2);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 300;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 11;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      this.heliGain = ctx.createGain();
      this.heliGain.gain.value = 0;
      src.connect(f).connect(am).connect(this.heliGain).connect(this.amb);
      src.start();
      lfo.start();
    }
    this.heliGain.gain.value = vol;
  }

  stopAll() {
    this.setSiren(false);
    if (this.heliGain) this.heliGain.gain.value = 0;
  }

  // ---------------------------------------------------------------- playback
  setListener(pos: Vec3Like, fwd: Vec3Like, up: Vec3Like) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(up.x, t);
      l.upY.setValueAtTime(up.y, t);
      l.upZ.setValueAtTime(up.z, t);
    } else {
      (l as any).setPosition(pos.x, pos.y, pos.z);
      (l as any).setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  play(name: string, o: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const arr = this.buffers.get(name);
    if (!arr || arr.length === 0) return;
    const b = arr[(Math.random() * arr.length) | 0];
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = (o.rate ?? 1) * (1 + rnd(-0.04, 0.04));
    const g = ctx.createGain();
    g.gain.value = o.vol ?? 1;
    let node: AudioNode = src;
    if (o.pos && !o.ui) {
      const dx = o.pos.x - this.listener.x, dy = o.pos.y - this.listener.y, dz = o.pos.z - this.listener.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const occ = o.occlusion ?? 0;
      // distance + occlusion low-pass: distant gunfire sounds like a dull boom
      const cutoff = Math.max(350, 20000 / (1 + dist * 0.05) * (1 - occ * 0.85));
      if (cutoff < 18000) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = cutoff;
        node.connect(f);
        node = f;
      }
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = o.refDist ?? 2;
      p.rolloffFactor = 1;
      p.maxDistance = 400;
      p.positionX.value = o.pos.x;
      p.positionY.value = o.pos.y;
      p.positionZ.value = o.pos.z;
      node.connect(p);
      node = p;
      if (occ > 0) g.gain.value *= 1 - occ * 0.5;
    }
    node.connect(g);
    g.connect(this.sfx);
    const send = ctx.createGain();
    send.gain.value = (o.wet ?? 0.5) * (o.ui ? 0 : 1);
    g.connect(send).connect(this.verbIn);
    src.start();
  }

  heartbeat(dt: number, healthFrac: number) {
    if (healthFrac > 0.3 || healthFrac <= 0) return;
    this.heartbeatTimer -= dt;
    if (this.heartbeatTimer <= 0) {
      this.heartbeatTimer = 0.6 + healthFrac * 2;
      this.play('heartbeat', { ui: true, vol: 0.6 });
    }
  }

  /** Enemy voice bark through speech synthesis + radio squelch. Rate-limited. */
  speak(text: string, pitch = 0.8) {
    const now = performance.now();
    if (!this.barksEnabled || now - this.lastSpeak < 1500) return;
    this.lastSpeak = now;
    try {
      const s = window.speechSynthesis;
      if (!s) return;
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = pitch;
      u.rate = 1.05;
      u.volume = 0.55 * this.volume;
      const voices = s.getVoices();
      const ru = voices.find((v) => /ru/i.test(v.lang) && /en/i.test(v.lang)) ?? voices.find((v) => /male|david|george|daniel/i.test(v.name));
      if (ru) u.voice = ru;
      s.speak(u);
    } catch { /* speech not available */ }
  }
}

export const audio = new AudioSys();
