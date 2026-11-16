// Particles, decals, tracers and shell casings.
import * as THREE from 'three';
import { tex } from '../core/textures';
import type { Physics } from '../world/physics';

const PVERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vFog;
  uniform float uScale;
  uniform float uFogDensity;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
    float d = -mv.z;
    vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  }`;
const PFRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform vec3 uFogColor;
  uniform float uAdditive;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vFog;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    float a = t.a * vAlpha;
    if (a < 0.01) discard;
    vec3 c = vColor * t.rgb;
    if (uAdditive > 0.5) { gl_FragColor = vec4(c * a * (1.0 - vFog), 1.0); }
    else { gl_FragColor = vec4(mix(c, uFogColor, vFog), a); }
  }`;

class ParticleSystem {
  max: number;
  count = 0;
  pos: Float32Array; vel: Float32Array; col: Float32Array; size: Float32Array; alpha: Float32Array;
  life: Float32Array; maxLife: Float32Array; grav: Float32Array; drag: Float32Array; grow: Float32Array; fade: Float32Array; a0: Float32Array;
  geo: THREE.BufferGeometry;
  points: THREE.Points;
  mat: THREE.ShaderMaterial;
  private next = 0;

  constructor(max: number, additive: boolean, map: THREE.Texture) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.fade = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 600 }, uFogDensity: { value: 0.016 }, uFogColor: { value: new THREE.Color(0x1b2330) }, uAdditive: { value: additive ? 1 : 0 } },
      vertexShader: PVERT, fragmentShader: PFRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 12 : 11;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, size: number, life: number, grav: number, drag: number, alpha = 1, grow = 0) {
    let i: number;
    if (this.count < this.max) i = this.count++;
    else { i = this.next; this.next = (this.next + 1) % this.max; }
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.alpha[i] = alpha; this.a0[i] = alpha; this.grow[i] = grow;
  }

  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, f * 2.5);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.setDrawRange(0, this.count);
  }
}

class DecalSet {
  mesh: THREE.InstancedMesh;
  private idx = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  growing: { i: number; pos: THREE.Vector3; quat: THREE.Quaternion; cur: number; target: number }[] = [];

  constructor(public max: number, map: THREE.Texture, opacity = 1, emissive = false) {
    const mat = new THREE.MeshLambertMaterial({ map, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    if (emissive) mat.emissive.set(0x000000);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 5;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
  }

  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, grow = 0) {
    const i = this.idx;
    this.idx = (this.idx + 1) % this.max;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    const n = new THREE.Vector3(nx, ny, nz).normalize();
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const spin = new THREE.Quaternion().setFromAxisAngle(n, Math.random() * Math.PI * 2);
    this.q.premultiply(spin);
    this.p.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
    const sc = grow > 0 ? size * 0.2 : size;
    this.s.set(sc, sc, sc);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.growing = this.growing.filter((g) => g.i !== i);
    if (grow > 0) this.growing.push({ i, pos: this.p.clone(), quat: this.q.clone(), cur: size * 0.2, target: size });
  }

  update(dt: number) {
    if (this.growing.length === 0) return;
    for (const g of this.growing) {
      g.cur = Math.min(g.target, g.cur + dt * 0.25);
      this.s.set(g.cur, g.cur, g.cur);
      this.m.compose(g.pos, g.quat, this.s);
      this.mesh.setMatrixAt(g.i, this.m);
    }
    this.growing = this.growing.filter((g) => g.cur < g.target);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

interface Casing { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; floor: number; life: number; bounced: number }

export class FX {
  normal: ParticleSystem;
  additive: ParticleSystem;
  holes: DecalSet;
  blood: DecalSet;
  scorch: DecalSet;
  tracers: { mesh: THREE.Mesh; life: number }[] = [];
  casings: Casing[] = [];
  private casingIdx = 0;
  flashes: { sprite: THREE.Sprite; life: number }[] = [];
  onCasingLand: ((p: THREE.Vector3) => void) | null = null;

  constructor(private scene: THREE.Scene, private physics: Physics) {
    this.normal = new ParticleSystem(5000, false, tex('soft'));
    this.additive = new ParticleSystem(2500, true, tex('soft'));
    scene.add(this.normal.points, this.additive.points);
    this.holes = new DecalSet(300, tex('bullethole'));
    this.blood = new DecalSet(200, tex('blood'), 0.95);
    this.scorch = new DecalSet(20, tex('scorch'), 0.9);
    scene.add(this.holes.mesh, this.blood.mesh, this.scorch.mesh);
    const tm = new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 1), tm);
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    const cm = new THREE.MeshLambertMaterial({ color: 0xc8a040, emissive: 0x302000 });
    const cg = new THREE.BoxGeometry(0.012, 0.012, 0.04);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(cg, cm);
      m.visible = false;
      scene.add(m);
      this.casings.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), floor: 0, life: 0, bounced: 0 });
    }
    const fm = new THREE.SpriteMaterial({ map: tex('flash'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(fm.clone());
      s.visible = false;
      scene.add(s);
      this.flashes.push({ sprite: s, life: 0 });
    }
  }

  setFog(color: THREE.Color, density: number) {
    for (const s of [this.normal, this.additive]) {
      s.mat.uniforms.uFogDensity.value = density;
      s.mat.uniforms.uFogColor.value.copy(color);
    }
  }

  setScale(h: number) {
    this.normal.mat.uniforms.uScale.value = h * 0.9;
    this.additive.mat.uniforms.uScale.value = h * 0.9;
  }

  // ------------------------------------------------------------------ effects
  bloodSpray(p: THREE.Vector3, dir: THREE.Vector3, amount: number, headshot = false) {
    const n = Math.floor(24 * amount * (headshot ? 2.5 : 1));
    for (let i = 0; i < n; i++) {
      const sp = 1.5 + Math.random() * 4.5 * amount;
      const r = 0.3 + Math.random() * 0.25;
      this.normal.spawn(p.x, p.y, p.z,
        dir.x * sp + (Math.random() - 0.5) * 2.5, dir.y * sp + Math.random() * 2, dir.z * sp + (Math.random() - 0.5) * 2.5,
        r, 0.0, 0.0, 0.06 + Math.random() * 0.09, 0.6 + Math.random() * 0.5, 9.8, 0.5, 1);
    }
    // back-spray toward the shooter
    for (let i = 0; i < n / 3; i++) {
      const sp = 0.8 + Math.random() * 1.5;
      this.normal.spawn(p.x, p.y, p.z, -dir.x * sp + (Math.random() - 0.5), Math.random() * 1.5, -dir.z * sp + (Math.random() - 0.5), 0.4, 0.01, 0.01, 0.05 + Math.random() * 0.05, 0.5, 9.8, 0.6, 1);
    }
    if (headshot) {
      for (let i = 0; i < 10; i++) {
        const sp = 2 + Math.random() * 4;
        this.normal.spawn(p.x, p.y, p.z, dir.x * sp + (Math.random() - 0.5) * 3, Math.random() * 3, dir.z * sp + (Math.random() - 0.5) * 3, 0.25, 0.02, 0.03, 0.12 + Math.random() * 0.08, 1.2, 9.8, 0.2, 1);
      }
    }
    // mist
    for (let i = 0; i < 5 * amount; i++) {
      this.normal.spawn(p.x, p.y, p.z, dir.x * 0.8 + (Math.random() - 0.5), (Math.random() - 0.3) * 0.6, dir.z * 0.8 + (Math.random() - 0.5),
        0.45, 0.02, 0.02, 0.25, 0.6 + Math.random() * 0.4, 0.4, 2.5, 0.55, 0.6);
    }
    // splatter on the surface behind
    const hit = this.physics.raycast(p.x, p.y, p.z, dir.x, dir.y, dir.z, 3.5, 'bullet');
    if (hit) this.blood.add(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, (0.5 + Math.random() * 0.6) * (headshot ? 1.8 : 1));
    // drips onto floor
    const fl = this.physics.raycast(p.x + dir.x * 0.5, p.y, p.z + dir.z * 0.5, 0, -1, 0, 3);
    if (fl && Math.random() < 0.7) this.blood.add(fl.x, fl.y, fl.z, 0, 1, 0, 0.3 + Math.random() * 0.4);
  }

  bloodPool(x: number, y: number, z: number) {
    this.blood.add(x, y, z, 0, 1, 0, 1.4 + Math.random() * 0.8, 1);
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, surface: string) {
    this.holes.add(p.x, p.y, p.z, n.x, n.y, n.z, surface === 'snow' ? 0.18 : 0.1 + Math.random() * 0.04);
    const metal = surface === 'metal';
    const sparks = metal ? 10 : 4;
    for (let i = 0; i < sparks; i++) {
      const s = 3 + Math.random() * 5;
      this.additive.spawn(p.x, p.y, p.z, n.x * s + (Math.random() - 0.5) * 4, n.y * s + Math.random() * 3, n.z * s + (Math.random() - 0.5) * 4,
        1.0, 0.75, 0.35, 0.035, 0.15 + Math.random() * 0.25, 12, 1, 1);
    }
    const dustCol = surface === 'snow' ? [0.85, 0.88, 0.95] : surface === 'wood' ? [0.45, 0.33, 0.2] : [0.55, 0.53, 0.5];
    const dn = surface === 'metal' ? 2 : 7;
    for (let i = 0; i < dn; i++) {
      const s = 0.5 + Math.random() * 2;
      this.normal.spawn(p.x, p.y, p.z, n.x * s + (Math.random() - 0.5), n.y * s + Math.random() * 0.8, n.z * s + (Math.random() - 0.5),
        dustCol[0], dustCol[1], dustCol[2], 0.12 + Math.random() * 0.15, 0.6 + Math.random() * 0.6, 1.5, 2.5, 0.7, 0.5);
    }
    // chips
    for (let i = 0; i < 4; i++) {
      const s = 2 + Math.random() * 3;
      this.normal.spawn(p.x, p.y, p.z, n.x * s + (Math.random() - 0.5) * 3, n.y * s + Math.random() * 3, n.z * s + (Math.random() - 0.5) * 3,
        dustCol[0] * 0.6, dustCol[1] * 0.6, dustCol[2] * 0.6, 0.03, 0.6, 9.8, 0.3, 1);
    }
  }

  glassBurst(p: THREE.Vector3) {
    for (let i = 0; i < 25; i++) {
      this.additive.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 4, Math.random() * 2 - 1, (Math.random() - 0.5) * 4, 1, 0.95, 0.8, 0.04, 0.4 + Math.random() * 0.4, 9.8, 0.5, 1);
    }
    for (let i = 0; i < 12; i++) {
      this.additive.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6, 1, 0.7, 0.3, 0.05, 0.3 + Math.random() * 0.5, 12, 0.5, 1);
    }
  }

  explosion(p: THREE.Vector3) {
    for (let i = 0; i < 60; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 10);
      this.additive.spawn(p.x, p.y + 0.3, p.z, d.x, d.y, d.z, 1, 0.6 + Math.random() * 0.3, 0.2, 0.6 + Math.random() * 0.8, 0.25 + Math.random() * 0.4, 2, 4, 1, 2);
    }
    for (let i = 0; i < 40; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(1 + Math.random() * 4);
      const g = 0.12 + Math.random() * 0.15;
      this.normal.spawn(p.x, p.y + 0.5, p.z, d.x, d.y, d.z, g, g, g, 1.2 + Math.random(), 2.5 + Math.random() * 2, -0.3, 1.2, 0.75, 1.5);
    }
    for (let i = 0; i < 30; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() + 0.3, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 10);
      this.additive.spawn(p.x, p.y + 0.2, p.z, d.x, d.y, d.z, 1, 0.8, 0.4, 0.05, 0.8 + Math.random() * 0.8, 9.8, 0.2, 1);
    }
    const fl = this.physics.raycast(p.x, p.y + 0.5, p.z, 0, -1, 0, 3);
    if (fl) this.scorch.add(fl.x, fl.y, fl.z, 0, 1, 0, 3.5);
  }

  muzzle(p: THREE.Vector3, size = 0.5) {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.sprite.position.copy(p);
    f.sprite.scale.set(size, size, size);
    (f.sprite.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
    f.sprite.visible = true;
    f.life = 0.05;
    for (let i = 0; i < 3; i++) this.normal.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5, 0.6, 0.6, 0.6, 0.2, 0.6, -0.3, 1.5, 0.25, 0.6);
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3) {
    const t = this.tracers.find((x) => x.life <= 0);
    if (!t) return;
    const len = a.distanceTo(b);
    if (len < 1) return;
    // show a segment near the end so it reads as a moving round
    const segLen = Math.min(len * 0.6, 6);
    const start = a.clone().lerp(b, Math.random() * 0.3);
    const end = start.clone().add(b.clone().sub(a).normalize().multiplyScalar(segLen));
    t.mesh.position.copy(start).lerp(end, 0.5);
    t.mesh.lookAt(end);
    t.mesh.scale.set(1, 1, segLen);
    t.mesh.visible = true;
    t.life = 0.045;
  }

  casing(p: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3) {
    const c = this.casings[this.casingIdx];
    this.casingIdx = (this.casingIdx + 1) % this.casings.length;
    c.mesh.position.copy(p);
    c.vel.copy(right).multiplyScalar(2 + Math.random()).addScaledVector(up, 1.5 + Math.random());
    c.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    const g = this.physics.groundHeight(p.x, p.z, p.y, 6);
    c.floor = g ?? p.y - 1.5;
    c.life = 3;
    c.bounced = 0;
    c.mesh.visible = true;
  }

  update(dt: number) {
    this.normal.update(dt);
    this.additive.update(dt);
    this.blood.update(dt);
    for (const t of this.tracers) if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.mesh.visible = false; }
    for (const f of this.flashes) if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.sprite.visible = false; }
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      if (c.bounced >= 3) continue;
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
      if (c.mesh.position.y < c.floor + 0.01) {
        c.mesh.position.y = c.floor + 0.01;
        c.vel.y = -c.vel.y * 0.35; c.vel.x *= 0.5; c.vel.z *= 0.5; c.spin.multiplyScalar(0.5);
        c.bounced++;
        if (c.bounced === 1) this.onCasingLand?.(c.mesh.position);
        if (c.bounced >= 3) c.mesh.rotation.set(Math.PI / 2, c.mesh.rotation.y, 0);
      }
    }
  }
}
