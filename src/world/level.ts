// Level construction toolkit: boxes merged by material with world-space UVs and fake
// ambient occlusion via vertex colours, plus building / wall / stair / light helpers.
import * as THREE from 'three';
import { tex, signTexture } from '../core/textures';
import { Physics, Box, Surface } from './physics';

export interface MatDef { tex?: string; scale: number; color?: number; emissive?: number; emissiveIntensity?: number; surface: Surface; fit?: boolean; transparent?: boolean }

export const MATS: Record<string, MatDef> = {
  concrete: { tex: 'concrete', scale: 4, surface: 'concrete' },
  concrete_dark: { tex: 'concrete_dark', scale: 4, surface: 'concrete' },
  concrete_wall: { tex: 'concrete_wall', scale: 3.5, surface: 'concrete' },
  metal: { tex: 'metal_panel', scale: 2, surface: 'metal' },
  metal_dark: { tex: 'metal_panel', scale: 2, color: 0x777777, surface: 'metal' },
  plate: { tex: 'diamond_plate', scale: 1.5, surface: 'metal' },
  snow: { tex: 'snow', scale: 6, surface: 'snow' },
  road: { tex: 'snow_road', scale: 6, surface: 'snow' },
  rock: { tex: 'rock', scale: 8, surface: 'rock' },
  tile: { tex: 'lab_tile', scale: 2, surface: 'concrete' },
  labwall: { tex: 'lab_wall', scale: 3, surface: 'concrete' },
  crate: { tex: 'wood_crate', scale: 1.2, surface: 'wood', fit: true },
  milcrate: { tex: 'military_crate', scale: 1, surface: 'wood', fit: true },
  hazard: { tex: 'hazard', scale: 1, surface: 'metal' },
  corrugated: { tex: 'corrugated', scale: 2, surface: 'metal' },
  tarp: { tex: 'tarp', scale: 2, surface: 'wood' },
  truck: { tex: 'truck_paint', scale: 2, surface: 'metal' },
  asphalt: { tex: 'asphalt', scale: 4, surface: 'concrete' },
  carpet: { tex: 'carpet', scale: 2, surface: 'wood' },
  woodfloor: { tex: 'wood_floor', scale: 2, surface: 'wood' },
  sandbag: { tex: 'sandbag', scale: 1, surface: 'dirt' },
  pipe: { tex: 'pipe', scale: 2, surface: 'metal' },
  tank: { tex: 'water_tank', scale: 3, surface: 'metal' },
  generator: { tex: 'generator', scale: 2, surface: 'metal', fit: true },
  server: { tex: 'server', scale: 1, surface: 'metal', fit: true, emissive: 0xffffff, emissiveIntensity: 0.35 },
  screen: { tex: 'screen', scale: 1, surface: 'glass', fit: true, emissive: 0xffffff, emissiveIntensity: 0.9 },
  screen_cam: { tex: 'screen_cam', scale: 1, surface: 'glass', fit: true, emissive: 0xffffff, emissiveIntensity: 0.9 },
  helipad: { tex: 'helipad', scale: 1, surface: 'concrete', fit: true },
  black: { scale: 1, color: 0x1a1a1c, surface: 'metal' },
  white: { scale: 1, color: 0xdddddd, surface: 'metal' },
  red: { scale: 1, color: 0x8a1a16, surface: 'metal' },
  steel: { scale: 1, color: 0x8a9098, surface: 'metal' },
  bed: { scale: 1, color: 0x5a6650, surface: 'wood' },
  desk: { tex: 'wood_floor', scale: 1.5, surface: 'wood' },
  glass: { scale: 1, color: 0x88aacc, surface: 'glass', transparent: true },
  bark: { tex: 'bark', scale: 1, surface: 'wood' },
  lampglow: { scale: 1, color: 0xfff2c0, emissive: 0xfff0c0, emissiveIntensity: 2.5, surface: 'glass' },
};

export interface LevelLight {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  range: number;
  on: boolean;
  broken: boolean;
  group: string;
  fixture?: THREE.Mesh;
  cone?: THREE.Mesh;
  box?: Box;
  flicker?: boolean;
  alarm?: boolean;
  /** Stealth contribution (0..1 at the light) */
  stealthWeight: number;
}

export interface Zone { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; name: string }

export interface Gap { side: 'n' | 's' | 'e' | 'w'; at: number; w: number; h: number; y?: number }

class Accum { pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; }

let coneMaterial: THREE.ShaderMaterial | null = null;
export function getConeMaterial() {
  if (coneMaterial) return coneMaterial;
  coneMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 0.85, 0.6) }, uStrength: { value: 0.22 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
    vertexShader: /* glsl */`
      varying float vH;
      varying vec3 vN;
      varying vec3 vV;
      varying float vDepth;
      void main() {
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vH;
      varying vec3 vN;
      varying vec3 vV;
      varying float vDepth;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float fall = pow(vH, 1.4);
        float nearFade = smoothstep(0.3, 2.5, vDepth);
        float a = edge * fall * uStrength * nearFade;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  return coneMaterial;
}

export class Level {
  private acc = new Map<string, Accum>();
  private materials = new Map<string, THREE.Material>();
  lights: LevelLight[] = [];
  indoor: Zone[] = [];
  areas: Zone[] = [];
  group = new THREE.Group();

  constructor(public scene: THREE.Scene, public physics: Physics) {
    scene.add(this.group);
  }

  material(name: string): THREE.Material {
    let m = this.materials.get(name);
    if (m) return m;
    const d = MATS[name];
    if (!d) throw new Error('No material ' + name);
    const mat = new THREE.MeshLambertMaterial({
      map: d.tex ? tex(d.tex) : null,
      color: d.color ?? 0xffffff,
      vertexColors: true,
      emissive: d.emissive ?? 0x000000,
      emissiveIntensity: d.emissiveIntensity ?? 0,
      transparent: d.transparent ?? false,
      opacity: d.transparent ? 0.35 : 1,
      depthWrite: !d.transparent,
    });
    if (d.emissive && d.tex) mat.emissiveMap = tex(d.tex);
    this.materials.set(name, mat);
    return mat;
  }

  /** Same look as material(name) but without vertex colours, for free-form decor meshes. */
  decor(name: string): THREE.Material {
    const key = name + '#decor';
    let m = this.materials.get(key);
    if (m) return m;
    m = (this.material(name) as THREE.MeshLambertMaterial).clone();
    (m as THREE.MeshLambertMaterial).vertexColors = false;
    this.materials.set(key, m);
    return m;
  }

  /** Add a solid, textured box. Returns the physics box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, o: { collide?: boolean; visual?: boolean; shootThrough?: boolean; seeThrough?: boolean; noBottom?: boolean; noTop?: boolean; surface?: Surface; ao?: boolean } = {}): Box | null {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    if (o.visual !== false) this.addBoxGeometry(x0, y0, z0, x1, y1, z1, mat, o.noBottom ?? (y0 <= -0.9 && y1 >= -0.05), o.noTop ?? false, o.ao ?? true);
    if (o.collide === false) return null;
    const d = MATS[mat];
    return this.physics.addStatic({ minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1, surface: o.surface ?? d?.surface ?? 'concrete', enabled: true, shootThrough: o.shootThrough, seeThrough: o.seeThrough });
  }

  private addBoxGeometry(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, noBottom: boolean, noTop: boolean, ao: boolean) {
    let a = this.acc.get(mat);
    if (!a) { a = new Accum(); this.acc.set(mat, a); }
    const d = MATS[mat];
    const s = d.scale;
    const fit = !!d.fit;
    const quad = (p: number[][], n: number[], uvs: number[][], cols: number[]) => {
      const idx = [0, 1, 2, 0, 2, 3];
      for (const i of idx) {
        a!.pos.push(p[i][0], p[i][1], p[i][2]);
        a!.nrm.push(n[0], n[1], n[2]);
        a!.uv.push(uvs[i][0], uvs[i][1]);
        const c = cols[i];
        a!.col.push(c, c, c);
      }
    };
    // AO: darken vertical faces near their base (and near the ground)
    const aoAt = (y: number) => {
      if (!ao) return 1;
      const h = y - y0;
      const k = Math.min(1, h / Math.min(1.6, (y1 - y0) * 0.5 + 0.01));
      return 0.62 + 0.38 * k;
    };
    const uvq = (ua: number, ub: number, va: number, vb: number) => fit
      ? [[0, 0], [1, 0], [1, 1], [0, 1]]
      : [[ua / s, va / s], [ub / s, va / s], [ub / s, vb / s], [ua / s, vb / s]];
    const cB = aoAt(y0), cT = aoAt(y1);
    // +X
    quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], uvq(-z1, -z0, y0, y1), [cB, cB, cT, cT]);
    // -X
    quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], uvq(z0, z1, y0, y1), [cB, cB, cT, cT]);
    // +Z
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], uvq(x0, x1, y0, y1), [cB, cB, cT, cT]);
    // -Z
    quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], uvq(-x1, -x0, y0, y1), [cB, cB, cT, cT]);
    // +Y
    if (!noTop) quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], uvq(x0, x1, -z1, -z0), [1, 1, 1, 1]);
    // -Y
    if (!noBottom) quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], uvq(x0, x1, z0, z1), [0.7, 0.7, 0.7, 0.7]);
  }

  /** Wall along X (constant z band) from xa..xb with gaps (gap.at is x center). */
  wallX(z0: number, z1: number, xa: number, xb: number, y0: number, h: number, gaps: { at: number; w: number; h: number; y?: number }[], mat: string) {
    const sorted = [...gaps].sort((a, b) => a.at - b.at);
    let x = xa;
    for (const g of sorted) {
      const g0 = g.at - g.w / 2, g1 = g.at + g.w / 2;
      const gy = g.y ?? 0;
      if (g0 > x) this.box(x, y0, z0, g0, y0 + h, z1, mat);
      if (gy > 0) this.box(g0, y0, z0, g1, y0 + gy, z1, mat);
      if (gy + g.h < h) this.box(g0, y0 + gy + g.h, z0, g1, y0 + h, z1, mat);
      x = g1;
    }
    if (x < xb) this.box(x, y0, z0, xb, y0 + h, z1, mat);
  }

  /** Wall along Z (constant x band) from za..zb with gaps (gap.at is z center). */
  wallZ(x0: number, x1: number, za: number, zb: number, y0: number, h: number, gaps: { at: number; w: number; h: number; y?: number }[], mat: string) {
    const sorted = [...gaps].sort((a, b) => a.at - b.at);
    let z = za;
    for (const g of sorted) {
      const g0 = g.at - g.w / 2, g1 = g.at + g.w / 2;
      const gy = g.y ?? 0;
      if (g0 > z) this.box(x0, y0, z, x1, y0 + h, g0, mat);
      if (gy > 0) this.box(x0, y0, g0, x1, y0 + gy, g1, mat);
      if (gy + g.h < h) this.box(x0, y0 + gy + g.h, g0, x1, y0 + h, g1, mat);
      z = g1;
    }
    if (z < zb) this.box(x0, y0, z, x1, y0 + h, zb, mat);
  }

  /**
   * Enclosed building: floor, ceiling, roof and two-layer walls (exterior / interior textures).
   */
  building(o: { name: string; x0: number; z0: number; x1: number; z1: number; y0?: number; h: number; ext?: string; int?: string; floor?: string; ceil?: string; roof?: string | null; gaps?: Gap[]; t?: number; noFloor?: boolean; noCeil?: boolean }) {
    const y0 = o.y0 ?? 0;
    const t = o.t ?? 0.4;
    const ht = t / 2;
    const ext = o.ext ?? 'concrete_wall', int = o.int ?? ext;
    const gaps = o.gaps ?? [];
    const side = (s: Gap['side']) => gaps.filter((g) => g.side === s);
    const WH = o.h + 0.25;
    // south (+z) wall
    this.wallX(o.z1 - ht, o.z1, o.x0, o.x1, y0, WH, side('s'), ext);
    this.wallX(o.z1 - t, o.z1 - ht, o.x0 + t, o.x1 - t, y0, WH, side('s'), int);
    // north (-z)
    this.wallX(o.z0, o.z0 + ht, o.x0, o.x1, y0, WH, side('n'), ext);
    this.wallX(o.z0 + ht, o.z0 + t, o.x0 + t, o.x1 - t, y0, WH, side('n'), int);
    // west (-x)
    this.wallZ(o.x0, o.x0 + ht, o.z0 + ht, o.z1 - ht, y0, WH, side('w'), ext);
    this.wallZ(o.x0 + ht, o.x0 + t, o.z0 + t, o.z1 - t, y0, WH, side('w'), int);
    // east (+x)
    this.wallZ(o.x1 - ht, o.x1, o.z0 + ht, o.z1 - ht, y0, WH, side('e'), ext);
    this.wallZ(o.x1 - t, o.x1 - ht, o.z0 + t, o.z1 - t, y0, WH, side('e'), int);
    if (!o.noFloor) this.box(o.x0, y0 - 0.3, o.z0, o.x1, y0, o.z1, o.floor ?? 'concrete', { noBottom: true, ao: false });
    if (!o.noCeil) this.box(o.x0 + t, y0 + o.h, o.z0 + t, o.x1 - t, y0 + o.h + 0.25, o.z1 - t, o.ceil ?? 'concrete_dark', { ao: false });
    if (o.roof !== null) {
      this.box(o.x0 - 0.3, y0 + o.h + 0.25, o.z0 - 0.3, o.x1 + 0.3, y0 + o.h + 0.6, o.z1 + 0.3, o.roof ?? 'concrete_dark', { ao: false, noBottom: false });
    }
    this.indoor.push({ minX: o.x0, minY: y0 - 0.5, minZ: o.z0, maxX: o.x1, maxY: y0 + o.h + 0.3, maxZ: o.z1, name: o.name });
  }

  /** Straight staircase. dir: direction of ascent. */
  stairs(x0: number, z0: number, x1: number, z1: number, yBottom: number, yTop: number, dir: 'n' | 's' | 'e' | 'w', mat = 'concrete', steps = 0) {
    const rise = yTop - yBottom;
    const n = steps || Math.ceil(rise / 0.3);
    const sh = rise / n;
    for (let i = 0; i < n; i++) {
      const top = yBottom + sh * (i + 1);
      const f0 = i / n, f1 = (i + 1) / n;
      // step i spans from its start to the far end (solid stairs)
      if (dir === 'n') this.box(x0, yBottom, z1 - (z1 - z0) * f1, x1, top, z1 - (z1 - z0) * f0, mat, { ao: false });
      if (dir === 's') this.box(x0, yBottom, z0 + (z1 - z0) * f0, x1, top, z0 + (z1 - z0) * f1, mat, { ao: false });
      if (dir === 'e') this.box(x0 + (x1 - x0) * f0, yBottom, z0, x0 + (x1 - x0) * f1, top, z1, mat, { ao: false });
      if (dir === 'w') this.box(x1 - (x1 - x0) * f1, yBottom, z0, x1 - (x1 - x0) * f0, top, z1, mat, { ao: false });
    }
  }

  crate(x: number, z: number, size = 1.2, y = 0, mat = 'crate') {
    const h = size / 2;
    return this.box(x - h, y, z - h, x + h, y + size, z + h, mat);
  }

  /** Sign plane on a wall facing a direction. */
  sign(x: number, y: number, z: number, facing: 'n' | 's' | 'e' | 'w', text: string, sub = '', w = 1.6) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshLambertMaterial({ map: signTexture(text, sub) }));
    m.position.set(x, y, z);
    m.rotation.y = facing === 's' ? 0 : facing === 'n' ? Math.PI : facing === 'e' ? Math.PI / 2 : -Math.PI / 2;
    this.group.add(m);
  }

  /** Light with visible fixture and optional volumetric cone. */
  light(x: number, y: number, z: number, o: { color?: number; intensity?: number; range?: number; group?: string; cone?: boolean; coneRadius?: number; fixture?: 'lamp' | 'tube' | 'flood' | 'none'; flicker?: boolean; breakable?: boolean; stealth?: number }) {
    const color = new THREE.Color(o.color ?? 0xffd9a0);
    const L: LevelLight = {
      pos: new THREE.Vector3(x, y, z), color, intensity: o.intensity ?? 1, range: o.range ?? 10, on: true, broken: false,
      group: o.group ?? 'default', flicker: o.flicker, stealthWeight: o.stealth ?? 1,
    };
    const fx = o.fixture ?? 'lamp';
    if (fx !== 'none') {
      const geo = fx === 'tube' ? new THREE.BoxGeometry(1.2, 0.08, 0.18) : fx === 'flood' ? new THREE.BoxGeometry(0.5, 0.3, 0.3) : new THREE.CylinderGeometry(0.12, 0.3, 0.22, 8);
      const mat = new THREE.MeshLambertMaterial({ color: 0x333333, emissive: color.clone(), emissiveIntensity: 1.5 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y + 0.1, z);
      this.group.add(m);
      L.fixture = m;
      if (o.breakable !== false) {
        const hs = fx === 'tube' ? [0.6, 0.08, 0.12] : [0.3, 0.15, 0.3];
        L.box = this.physics.addStatic({ minX: x - hs[0], minY: y - hs[1] + 0.1, minZ: z - hs[2], maxX: x + hs[0], maxY: y + hs[1] + 0.1, maxZ: z + hs[2], surface: 'glass', enabled: true, noCollide: true, seeThrough: true, owner: L });
      }
    }
    if (o.cone) {
      const h = y - 0.05;
      const r = o.coneRadius ?? h * 0.55;
      const g = new THREE.CylinderGeometry(0.15, r, h, 20, 1, true);
      g.translate(0, -h / 2, 0);
      const mat = getConeMaterial().clone();
      mat.uniforms.uColor.value = color.clone();
      mat.uniforms.uStrength.value = 0.16 * (o.intensity ?? 1);
      const cone = new THREE.Mesh(g, mat);
      cone.position.set(x, y, z);
      cone.renderOrder = 10;
      this.group.add(cone);
      L.cone = cone;
    }
    this.lights.push(L);
    return L;
  }

  setLightOn(L: LevelLight, on: boolean) {
    L.on = on && !L.broken;
    if (L.fixture) (L.fixture.material as THREE.MeshLambertMaterial).emissiveIntensity = L.on ? 1.5 : 0;
    if (L.cone) L.cone.visible = L.on;
  }

  breakLight(L: LevelLight) {
    if (L.broken) return false;
    L.broken = true;
    this.setLightOn(L, false);
    if (L.box) L.box.enabled = false;
    return true;
  }

  isIndoor(x: number, y: number, z: number) {
    for (const zn of this.indoor) if (x > zn.minX && x < zn.maxX && y > zn.minY && y < zn.maxY && z > zn.minZ && z < zn.maxZ) return zn;
    return null;
  }

  areaName(x: number, y: number, z: number) {
    for (const zn of this.areas) if (x > zn.minX && x < zn.maxX && y > zn.minY && y < zn.maxY && z > zn.minZ && z < zn.maxZ) return zn.name;
    return '';
  }

  /** Build merged meshes. */
  finalize() {
    for (const [name, a] of this.acc) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.material(name));
      m.castShadow = !MATS[name].transparent && name !== 'snow' && name !== 'road';
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.group.add(m);
    }
    this.acc.clear();
  }
}

/** Subtract axis-aligned rectangles (holes) from a rectangle. Rect = [x0,z0,x1,z1]. */
export function subtractRects(rect: [number, number, number, number], holes: [number, number, number, number][]): [number, number, number, number][] {
  let rects: [number, number, number, number][] = [rect];
  for (const h of holes) {
    const next: [number, number, number, number][] = [];
    for (const r of rects) {
      const [x0, z0, x1, z1] = r;
      const hx0 = Math.max(x0, h[0]), hz0 = Math.max(z0, h[1]), hx1 = Math.min(x1, h[2]), hz1 = Math.min(z1, h[3]);
      if (hx0 >= hx1 || hz0 >= hz1) { next.push(r); continue; }
      if (z0 < hz0) next.push([x0, z0, x1, hz0]);
      if (hz1 < z1) next.push([x0, hz1, x1, z1]);
      if (x0 < hx0) next.push([x0, hz0, hx0, hz1]);
      if (hx1 < x1) next.push([hx1, hz0, x1, hz1]);
    }
    rects = next;
  }
  return rects;
}
