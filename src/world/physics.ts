// Axis-aligned box world: spatial grid broadphase, DDA raycasts, and a character mover
// with step-up support (stairs) and ceiling checks (crouch / prone clearance).

export type Surface = 'concrete' | 'metal' | 'snow' | 'wood' | 'glass' | 'dirt' | 'flesh' | 'rock';

export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  surface: Surface;
  enabled: boolean;
  /** Bullets pass through (e.g. chain-link fence, foliage). */
  shootThrough?: boolean;
  /** Does not block AI vision (fences). */
  seeThrough?: boolean;
  /** Not solid for movement (e.g. decorative) but hit by rays. */
  noCollide?: boolean;
  /** Arbitrary game object that owns this box (light fixture, camera, door...). */
  owner?: any;
  _stamp?: number;
}

export interface RayHit {
  t: number;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  box: Box;
}

const CELL = 4;

export class Physics {
  statics: Box[] = [];
  dynamics: Box[] = [];
  private grid = new Map<number, Box[]>();
  private stamp = 1;
  minCX = 0; maxCX = 0; minCZ = 0; maxCZ = 0;

  private key(cx: number, cz: number) { return (cx + 2048) * 4096 + (cz + 2048); }

  addStatic(b: Box) {
    this.statics.push(b);
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = this.key(cx, cz);
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(b);
    }
    this.minCX = Math.min(this.minCX, x0); this.maxCX = Math.max(this.maxCX, x1);
    this.minCZ = Math.min(this.minCZ, z0); this.maxCZ = Math.max(this.maxCZ, z1);
    return b;
  }

  addDynamic(b: Box) { this.dynamics.push(b); return b; }

  /** Boxes overlapping a region (static via grid + dynamic). */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: Box[] = []): Box[] {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const arr = this.grid.get(this.key(cx, cz));
      if (!arr) continue;
      for (const b of arr) {
        if (b._stamp === s) continue;
        b._stamp = s;
        if (!b.enabled) continue;
        if (b.maxX > minX && b.minX < maxX && b.maxY > minY && b.minY < maxY && b.maxZ > minZ && b.minZ < maxZ) out.push(b);
      }
    }
    for (const b of this.dynamics) {
      if (!b.enabled) continue;
      if (b.maxX > minX && b.minX < maxX && b.maxY > minY && b.minY < maxY && b.maxZ > minZ && b.minZ < maxZ) out.push(b);
    }
    return out;
  }

  private tmp: Box[] = [];

  /** True if an AABB region intersects any solid. */
  blocked(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const hits = this.query(minX, minY, minZ, maxX, maxY, maxZ, this.tmp);
    for (const b of hits) if (!b.noCollide) return true;
    return false;
  }

  private rayBox(b: Box, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, res: { t: number; axis: number }) {
    let tmin = 0, tmax = maxT, axis = -1;
    // X
    if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return false; }
    else {
      const inv = 1 / dx;
      let t1 = (b.minX - ox) * inv, t2 = (b.maxX - ox) * inv;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) { tmin = t1; axis = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (Math.abs(dy) < 1e-9) { if (oy < b.minY || oy > b.maxY) return false; }
    else {
      const inv = 1 / dy;
      let t1 = (b.minY - oy) * inv, t2 = (b.maxY - oy) * inv;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) { tmin = t1; axis = 1; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return false; }
    else {
      const inv = 1 / dz;
      let t1 = (b.minZ - oz) * inv, t2 = (b.maxZ - oz) * inv;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) { tmin = t1; axis = 2; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (axis === -1) { // origin inside box
      res.t = 0; res.axis = -1; return true;
    }
    res.t = tmin; res.axis = axis;
    return true;
  }

  /**
   * Raycast against world boxes. dir must be normalized.
   * mode: 'bullet' ignores shootThrough boxes, 'sight' ignores seeThrough boxes.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, mode: 'bullet' | 'sight' | 'any' | 'solid' = 'any', ignore?: Box): RayHit | null {
    let best: RayHit | null = null;
    let bestT = maxDist;
    const res = { t: 0, axis: 0 };
    const s = ++this.stamp;
    const test = (b: Box) => {
      if (b._stamp === s) return;
      b._stamp = s;
      if (!b.enabled || b === ignore) return;
      if (mode === 'bullet' && b.shootThrough) return;
      if (mode === 'sight' && b.seeThrough) return;
      if (mode === 'solid' && b.noCollide) return;
      if (this.rayBox(b, ox, oy, oz, dx, dy, dz, bestT, res) && res.t < bestT) {
        if (res.axis === -1) return; // started inside; ignore
        bestT = res.t;
        const sx = res.axis === 0 ? -Math.sign(dx) : 0, sy = res.axis === 1 ? -Math.sign(dy) : 0, sz = res.axis === 2 ? -Math.sign(dz) : 0;
        best = { t: res.t, x: ox + dx * res.t, y: oy + dy * res.t, z: oz + dz * res.t, nx: sx, ny: sy, nz: sz, box: b };
      }
    };
    for (const b of this.dynamics) test(b);

    // 2D DDA over XZ grid
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) < 1e-9 ? Infinity : CELL / Math.abs(dx);
    const tDeltaZ = Math.abs(dz) < 1e-9 ? Infinity : CELL / Math.abs(dz);
    let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / Math.abs(dx));
    let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : ((dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL) / Math.abs(dz));
    let tCur = 0;
    for (let iter = 0; iter < 512; iter++) {
      const arr = this.grid.get(this.key(cx, cz));
      if (arr) for (const b of arr) test(b);
      const tNext = Math.min(tMaxX, tMaxZ);
      if (bestT <= tNext) break; // nearest hit lies within the cell we just tested
      tCur = tNext;
      if (tCur > maxDist) break;
      if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDeltaX; } else { cz += stepZ; tMaxZ += tDeltaZ; }
      if (cx < this.minCX - 1 || cx > this.maxCX + 1 || cz < this.minCZ - 1 || cz > this.maxCZ + 1) break;
    }
    return best;
  }

  /** Line of sight between two points. */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number, mode: 'sight' | 'bullet' = 'sight'): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.001) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, mode) === null;
  }

  /** Highest floor surface under a point within a vertical window. */
  groundHeight(x: number, z: number, fromY: number, maxDrop = 50): number | null {
    const h = this.raycast(x, fromY, z, 0, -1, 0, maxDrop, 'solid');
    return h ? h.y : null;
  }

  /**
   * Move a character AABB (feet-centered). Returns updated state.
   * Handles stepping up onto obstacles <= stepHeight while grounded.
   */
  moveCharacter(pos: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }, dt: number, radius: number, height: number, stepHeight: number, grounded: boolean) {
    let hitWall = false;
    let onGround = false;
    let hitCeiling = false;
    // already overlapping something (door closed on us, odd spawn)? let horizontal motion escape it
    let stuck = this.blocked(pos.x - radius + 0.02, pos.y + 0.05, pos.z - radius + 0.02, pos.x + radius - 0.02, pos.y + height - 0.05, pos.z + radius - 0.02);
    if (stuck) {
      // sunk slightly into a step / ledge: pop up onto it
      const top = this.footprintTop(pos.x, pos.z, radius, pos.y, pos.y + 0.55);
      if (top !== null && this.canFit(pos.x, top, pos.z, radius - 0.02, height)) { pos.y = top; stuck = false; }
    }
    if (stuck) { pos.x += vel.x * dt; pos.z += vel.z * dt; }
    const total = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
    const steps = Math.max(1, Math.ceil(total / 0.2));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      // Horizontal axes
      for (const axis of [0, 2]) {
        if (stuck) break;
        const d = (axis === 0 ? vel.x : vel.z) * sdt;
        if (d === 0) continue;
        const nx = pos.x + (axis === 0 ? d : 0);
        const nz = pos.z + (axis === 2 ? d : 0);
        if (!this.blocked(nx - radius, pos.y + 0.01, nz - radius, nx + radius, pos.y + height, nz + radius)) {
          pos.x = nx; pos.z = nz;
          continue;
        }
        // try step up
        let stepped = false;
        if (grounded || onGround) {
          for (let up = 0.1; up <= stepHeight + 0.001; up += 0.1) {
            if (!this.blocked(nx - radius, pos.y + up, nz - radius, nx + radius, pos.y + up + height, nz + radius)) {
              // settle on the highest surface under the whole footprint
              const top = this.footprintTop(nx, nz, radius, pos.y - 0.01, pos.y + up + 0.01);
              pos.x = nx; pos.z = nz;
              pos.y = top !== null ? Math.max(pos.y, top) : pos.y + up;
              stepped = true;
              break;
            }
          }
        }
        if (!stepped) {
          hitWall = true;
          if (axis === 0) vel.x = 0; else vel.z = 0;
        }
      }
      // Vertical
      const dy = vel.y * sdt;
      const ny = pos.y + dy;
      if (dy <= 0) {
        const hits = this.query(pos.x - radius, ny, pos.z - radius, pos.x + radius, pos.y + 0.02, pos.z + radius, this.tmp);
        let top = -Infinity;
        for (const b of hits) if (!b.noCollide && b.maxY <= pos.y + 0.05 && b.maxY > top) top = b.maxY;
        if (top > -Infinity && ny <= top) {
          pos.y = top;
          vel.y = 0;
          onGround = true;
        } else pos.y = ny;
      } else {
        if (this.blocked(pos.x - radius, pos.y + height, pos.z - radius, pos.x + radius, ny + height, pos.z + radius)) {
          vel.y = 0;
          hitCeiling = true;
        } else pos.y = ny;
      }
    }
    // Ground probe (stick to ground when walking down small steps)
    if (!onGround && vel.y <= 0 && grounded) {
      const hits = this.query(pos.x - radius, pos.y - 0.25, pos.z - radius, pos.x + radius, pos.y + 0.02, pos.z + radius, this.tmp);
      let top = -Infinity;
      for (const b of hits) if (!b.noCollide && b.maxY <= pos.y + 0.05 && b.maxY > top) top = b.maxY;
      if (top > -Infinity) { pos.y = top; onGround = true; vel.y = 0; }
    }
    return { onGround, hitWall, hitCeiling };
  }

  /** Highest solid top within [yMin, yMax] under a square footprint. */
  footprintTop(x: number, z: number, radius: number, yMin: number, yMax: number): number | null {
    const hits = this.query(x - radius, yMin, z - radius, x + radius, yMax, z + radius, this.tmp);
    let top: number | null = null;
    for (const b of hits) if (!b.noCollide && b.maxY <= yMax && b.maxY >= yMin && (top === null || b.maxY > top)) top = b.maxY;
    return top;
  }

  /** Free space check for a standing volume (used for stance changes). */
  canFit(x: number, y: number, z: number, radius: number, height: number) {
    return !this.blocked(x - radius, y + 0.05, z - radius, x + radius, y + height, z + radius);
  }
}
