// Renderer, post-processing chain, pooled dynamic lights and viewmodel pass.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { LevelLight } from '../world/level';
import { setAnisotropy } from './textures';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uNV: { value: 0 },
    uDamage: { value: 0 },
    uFlash: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uAlarm: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uNV, uDamage, uFlash, uAlarm;
    uniform vec2 uRes;
    varying vec2 vUv;
    float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      // gentle filmic grade: cool shadows, warm highlights
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, c * vec3(0.86, 0.95, 1.12), (1.0 - smoothstep(0.0, 0.5, l)) * 0.35);
      c = mix(vec3(l), c, 1.08);
      if (uNV > 0.0) {
        float g = dot(c, vec3(0.3, 0.6, 0.1));
        g = pow(g * 4.5 + 0.03, 0.75);
        float n = rand(uv * uRes + uTime * 60.0) * 0.18;
        float scan = 0.94 + 0.06 * sin(uv.y * uRes.y * 1.2);
        vec3 nv = vec3(0.25, 1.0, 0.35) * (g + n) * scan;
        float vig = smoothstep(0.85, 0.35, length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
        nv *= vig;
        c = mix(c, nv, uNV);
      }
      // vignette
      vec2 d = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      float v = smoothstep(1.1, 0.35, length(d));
      c *= mix(0.65, 1.0, v);
      // damage pulse / alarm tint
      float edge = 1.0 - v;
      c = mix(c, vec3(0.6, 0.0, 0.0), clamp(uDamage * (0.25 + edge * 1.2), 0.0, 0.75));
      c += vec3(0.25, 0.0, 0.0) * uAlarm * edge;
      c += vec3(uFlash);
      // subtle grain
      c += (rand(uv * uRes + fract(uTime)) - 0.5) * 0.025;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  viewScene = new THREE.Scene();
  viewCamera: THREE.PerspectiveCamera;
  grade: ShaderPass;
  bloom: UnrealBloomPass;
  moon: THREE.DirectionalLight;
  ambient: THREE.HemisphereLight;
  pool: THREE.PointLight[] = [];
  spotPool: THREE.SpotLight[] = [];
  private poolAssign: (LevelLight | null)[] = [];
  muzzleLight: THREE.PointLight;
  viewLight: THREE.PointLight;
  fog: THREE.FogExp2;
  baseFov = 75;

  constructor(container: HTMLElement) {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    container.appendChild(r.domElement);
    this.renderer = r;
    setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.05, 600);
    this.viewCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10);
    this.scene.add(this.camera);

    this.fog = new THREE.FogExp2(0x1b2330, 0.016);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x0d1320);

    this.ambient = new THREE.HemisphereLight(0x6a7ca0, 0x23252c, 1.35);
    this.scene.add(this.ambient);
    this.moon = new THREE.DirectionalLight(0x9fb4e0, 1.25);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
    this.moon.shadow.bias = -0.0006;
    this.moon.shadow.normalBias = 0.03;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    for (let i = 0; i < 12; i++) {
      const p = new THREE.PointLight(0xffffff, 0, 10, 1.6);
      this.scene.add(p);
      this.pool.push(p);
      this.poolAssign.push(null);
    }
    for (let i = 0; i < 4; i++) {
      const s = new THREE.SpotLight(0xe8f0ff, 0, 26, 0.42, 0.45, 1.3);
      this.scene.add(s);
      this.scene.add(s.target);
      this.spotPool.push(s);
    }
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 1.5);
    this.scene.add(this.muzzleLight);

    // viewmodel lighting (mirrors world lighting roughly)
    this.viewScene.add(new THREE.HemisphereLight(0xb8b0a4, 0x2a2622, 1.6));
    const key = new THREE.DirectionalLight(0xfff0dd, 0.8);
    key.position.set(-1, 2, 1);
    this.viewScene.add(key);
    this.viewLight = new THREE.PointLight(0xffc080, 0, 3, 1);
    this.viewLight.position.set(0.2, 0.2, -0.6);
    this.viewScene.add(this.viewLight);
    this.viewScene.add(this.viewCamera);

    const composer = new EffectComposer(r);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const vp = new RenderPass(this.viewScene, this.viewCamera);
    vp.clear = false;
    vp.clearDepth = true;
    composer.addPass(vp);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.55, 0.82);
    composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    this.grade.uniforms.uRes.value.set(w, h);
  }

  /** Assign the pooled point lights to the most relevant level lights. */
  updateLights(lights: LevelLight[], camPos: THREE.Vector3, time: number, alarm: boolean) {
    const scored: { L: LevelLight; s: number }[] = [];
    for (const L of lights) {
      if (!L.on) continue;
      const d = L.pos.distanceTo(camPos);
      if (d > 70) continue;
      scored.push({ L, s: d - L.range * 0.8 });
    }
    scored.sort((a, b) => a.s - b.s);
    const chosen = scored.slice(0, this.pool.length).map((x) => x.L);
    // keep stable assignments to minimise popping
    const free: number[] = [];
    for (let i = 0; i < this.pool.length; i++) {
      const a = this.poolAssign[i];
      if (!a || !chosen.includes(a)) { this.poolAssign[i] = null; free.push(i); }
    }
    for (const L of chosen) {
      if (this.poolAssign.includes(L)) continue;
      const i = free.shift();
      if (i === undefined) break;
      this.poolAssign[i] = L;
    }
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      const L = this.poolAssign[i];
      if (!L) { p.intensity = 0; continue; }
      p.position.copy(L.pos);
      p.color.copy(L.color);
      p.distance = L.range * 1.4;
      let inten = L.intensity * 7;
      if (L.flicker) inten *= Math.sin(time * 23) > 0.85 || Math.sin(time * 3.1 + 1) > 0.97 ? 0.15 : 1;
      if (L.alarm) inten = alarm ? (Math.sin(time * 8) * 0.5 + 0.5) * L.intensity * 9 : 0;
      p.intensity = inten;
    }
  }

  /**
   * Compile every shader and upload every texture up front so nothing compiles lazily
   * the first time it comes into view (that is what caused hitches when turning).
   */
  warmup(textures: THREE.Texture[]) {
    const hidden: THREE.Object3D[] = [];
    const counts: [THREE.InstancedMesh, number][] = [];
    for (const sc of [this.scene, this.viewScene]) {
      sc.traverse((o) => {
        if (!o.visible) { hidden.push(o); o.visible = true; }
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh) { counts.push([im, im.count]); im.count = Math.max(1, im.count); }
      });
    }
    for (const t of textures) this.renderer.initTexture(t);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.viewScene, this.viewCamera);
    // one real render (incl. shadow pass and post chain) with everything visible
    const frustum = new Map<THREE.Object3D, boolean>();
    this.scene.traverse((o) => { frustum.set(o, o.frustumCulled); o.frustumCulled = false; });
    this.composer.render();
    for (const [o, f] of frustum) o.frustumCulled = f;
    for (const o of hidden) o.visible = false;
    for (const [im, c] of counts) im.count = c;
  }

  followShadow(target: THREE.Vector3) {
    // snap to texel grid to avoid shimmering
    const step = 90 / 2048;
    const tx = Math.round(target.x / step) * step, tz = Math.round(target.z / step) * step;
    this.moon.position.set(tx - 40, 90, tz + 30);
    this.moon.target.position.set(tx, 0, tz);
  }

  render(time: number) {
    this.grade.uniforms.uTime.value = time;
    this.composer.render();
  }
}
