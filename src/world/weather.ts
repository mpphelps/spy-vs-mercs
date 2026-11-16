// Falling snow around the camera (masked out of interiors) + drifting ground fog sprites.
import * as THREE from 'three';
import { tex } from '../core/textures';
import type { Level } from './level';

export class Weather {
  snow: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private N = 3500;
  private R = 26;
  fog: THREE.Sprite[] = [];

  constructor(private scene: THREE.Scene, private level: Level) {
    this.pos = new Float32Array(this.N * 3);
    this.vel = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * this.R * 2;
      this.pos[i * 3 + 1] = Math.random() * 18;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.R * 2;
      this.vel[i] = 0.8 + Math.random() * 1.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.PointsMaterial({ color: 0xdde6f5, size: 0.07, map: tex('soft'), transparent: true, depthWrite: false, opacity: 0.85 });
    this.snow = new THREE.Points(g, m);
    this.snow.frustumCulled = false;
    scene.add(this.snow);
    // ground fog banks
    const fm = new THREE.SpriteMaterial({ map: tex('smoke'), color: 0x8a98b0, transparent: true, opacity: 0.12, depthWrite: false });
    const spots: [number, number][] = [];
    for (let i = 0; i < 40; i++) spots.push([-60 + Math.random() * 135, 44 + Math.random() * 64]);
    for (let i = 0; i < 22; i++) spots.push([-55 + Math.random() * 110, -75 + Math.random() * 110]);
    for (const [x, z] of spots) {
      if (level.isIndoor(x, 1, z)) continue;
      const s = new THREE.Sprite(fm.clone());
      const sc = 10 + Math.random() * 12;
      s.scale.set(sc, sc * 0.35, 1);
      s.position.set(x, 1 + Math.random() * 1.5, z);
      (s as any).drift = (Math.random() - 0.5) * 0.4;
      s.renderOrder = 9;
      scene.add(s);
      this.fog.push(s);
    }
  }

  update(dt: number, cam: THREE.Vector3, time: number) {
    const p = this.pos, R = this.R;
    const wind = Math.sin(time * 0.13) * 1.2 + 0.6;
    for (let i = 0; i < this.N; i++) {
      let x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      y -= this.vel[i] * dt;
      x += (wind + Math.sin(time * 1.3 + i) * 0.3) * dt;
      z += Math.cos(time * 0.9 + i * 0.7) * 0.25 * dt;
      // recycle relative to camera
      if (y < cam.y - 4 || x - cam.x > R || x - cam.x < -R || z - cam.z > R || z - cam.z < -R) {
        x = cam.x + (Math.random() - 0.5) * R * 2;
        z = cam.z + (Math.random() - 0.5) * R * 2;
        y = cam.y + 6 + Math.random() * 10;
      }
      // particles that enter a building (or fall below ground) are recycled next frame
      p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
      if (y < -0.5 || this.level.isIndoor(x, y, z)) p[i * 3 + 1] = -999;
    }
    this.snow.geometry.attributes.position.needsUpdate = true;
    for (const s of this.fog) {
      s.position.x += (s as any).drift * dt;
      (s.material as THREE.SpriteMaterial).opacity = 0.1 + Math.sin(time * 0.2 + s.position.z) * 0.03;
    }
  }
}
