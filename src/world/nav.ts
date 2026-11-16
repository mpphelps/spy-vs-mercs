// Auto-generated multi-layer navigation grid + A* with path smoothing.
import { Physics } from './physics';

const CELL = 0.5;
const CLEAR_H = 1.7;
const RADIUS = 0.3;
const STEP = 0.45;

const ORTHO: [number, number, number][] = [[1, 0, 1], [-1, 0, 2], [0, 1, 4], [0, -1, 8]];
const DIAG: [number, number, number][] = [[1, 1, 1 | 4], [1, -1, 1 | 8], [-1, 1, 2 | 4], [-1, -1, 2 | 8]];

export interface NavPoint { x: number; y: number; z: number }

class MinHeap {
  ids: number[] = [];
  f: number[] = [];
  push(id: number, f: number) {
    this.ids.push(id); this.f.push(f);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      [this.ids[p], this.ids[i]] = [this.ids[i], this.ids[p]];
      [this.f[p], this.f[i]] = [this.f[i], this.f[p]];
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!, lastF = this.f.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId; this.f[0] = lastF;
      let i = 0;
      const n = this.ids.length;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < n && this.f[l] < this.f[m]) m = l;
        if (r < n && this.f[r] < this.f[m]) m = r;
        if (m === i) break;
        [this.ids[m], this.ids[i]] = [this.ids[i], this.ids[m]];
        [this.f[m], this.f[i]] = [this.f[i], this.f[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.ids.length; }
}

export class NavGrid {
  x0 = 0; z0 = 0; w = 0; d = 0;
  /** column -> first node index, count in colCount */
  colStart!: Int32Array;
  colCount!: Uint8Array;
  nodeY: number[] = [];
  nodeCol: number[] = [];
  /** Nodes adjacent to walls (good cover candidates). */
  nearWall: Uint8Array = new Uint8Array(0);
  private gScore!: Float32Array;
  private came!: Int32Array;
  private visit!: Uint32Array;
  private closed!: Uint32Array;
  private gen = 1;

  build(ph: Physics, x0: number, z0: number, x1: number, z1: number, yMin: number, yMax: number) {
    this.x0 = x0; this.z0 = z0;
    this.w = Math.ceil((x1 - x0) / CELL);
    this.d = Math.ceil((z1 - z0) / CELL);
    const cols = this.w * this.d;
    this.colStart = new Int32Array(cols).fill(-1);
    this.colCount = new Uint8Array(cols);
    const tmp: any[] = [];
    for (let iz = 0; iz < this.d; iz++) for (let ix = 0; ix < this.w; ix++) {
      const cx = x0 + (ix + 0.5) * CELL, cz = z0 + (iz + 0.5) * CELL;
      const boxes = ph.query(cx - RADIUS, yMin, cz - RADIUS, cx + RADIUS, yMax, cz + RADIUS, tmp);
      // candidate floor tops (boxes that cover the cell center)
      const tops: number[] = [];
      for (const b of boxes) {
        if (b.noCollide) continue;
        if (cx >= b.minX && cx <= b.maxX && cz >= b.minZ && cz <= b.maxZ) tops.push(b.maxY);
      }
      tops.sort((a, b) => a - b);
      const col = iz * this.w + ix;
      let prev = -Infinity;
      for (const top of tops) {
        if (top - prev < 0.05) continue;
        // clearance check
        let clear = true;
        for (const b of boxes) {
          if (b.noCollide) continue;
          if (b.maxY > top + 0.05 && b.minY < top + CLEAR_H && b.maxX > cx - RADIUS && b.minX < cx + RADIUS && b.maxZ > cz - RADIUS && b.minZ < cz + RADIUS) { clear = false; break; }
        }
        if (!clear) continue;
        prev = top;
        if (this.colStart[col] < 0) this.colStart[col] = this.nodeY.length;
        this.nodeY.push(top);
        this.nodeCol.push(col);
        this.colCount[col]++;
        if (this.colCount[col] >= 6) break;
      }
    }
    const n = this.nodeY.length;
    this.gScore = new Float32Array(n);
    this.came = new Int32Array(n);
    this.visit = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    // near-wall flags
    this.nearWall = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let cnt = 0;
      this.forNeighbors(i, () => { cnt++; });
      if (cnt < 8) this.nearWall[i] = 1;
    }
  }

  get nodeCount() { return this.nodeY.length; }

  nodePos(i: number): NavPoint {
    const col = this.nodeCol[i];
    const ix = col % this.w, iz = (col / this.w) | 0;
    return { x: this.x0 + (ix + 0.5) * CELL, y: this.nodeY[i], z: this.z0 + (iz + 0.5) * CELL };
  }

  private nodeInCol(col: number, y: number, tol: number): number {
    const s = this.colStart[col];
    if (s < 0) return -1;
    const c = this.colCount[col];
    let best = -1, bd = tol;
    for (let k = 0; k < c; k++) {
      const dy = Math.abs(this.nodeY[s + k] - y);
      if (dy <= bd) { bd = dy; best = s + k; }
    }
    return best;
  }

  /** Nearest node to a world point (searches a small neighbourhood). */
  nearest(x: number, y: number, z: number): number {
    const ix = Math.floor((x - this.x0) / CELL), iz = Math.floor((z - this.z0) / CELL);
    for (let r = 0; r <= 6; r++) {
      let best = -1, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = ix + dx, cz = iz + dz;
        if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.d) continue;
        const col = cz * this.w + cx;
        const s = this.colStart[col];
        if (s < 0) continue;
        for (let k = 0; k < this.colCount[col]; k++) {
          const ny = this.nodeY[s + k];
          if (ny > y + 1.0) continue;
          const dd = (y - ny) * (y - ny) * 4 + dx * dx + dz * dz;
          if (dd < bd) { bd = dd; best = s + k; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  forNeighbors(i: number, fn: (j: number, cost: number) => void) {
    const col = this.nodeCol[i];
    const ix = col % this.w, iz = (col / this.w) | 0;
    const y = this.nodeY[i];
    let orth = 0; // bitmask of reachable orthogonal neighbours: 1=+x 2=-x 4=+z 8=-z
    for (const [dx, dz, bit] of ORTHO) {
      const cx = ix + dx, cz = iz + dz;
      if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.d) continue;
      const j = this.nodeInCol(cz * this.w + cx, y, STEP);
      if (j >= 0) { orth |= bit; fn(j, 1); }
    }
    for (const [dx, dz, need] of DIAG) {
      if ((orth & need) !== need) continue;
      const cx = ix + dx, cz = iz + dz;
      if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.d) continue;
      const j = this.nodeInCol(cz * this.w + cx, y, STEP);
      if (j >= 0) fn(j, 1.4142);
    }
  }

  /** A* returning world-space points (smoothed). maxNodes bounds the search cost. */
  findPath(ax: number, ay: number, az: number, bx: number, by: number, bz: number, maxNodes = 12000): NavPoint[] | null {
    const s = this.nearest(ax, ay, az), g = this.nearest(bx, by, bz);
    if (s < 0 || g < 0) return null;
    if (s === g) return [this.nodePos(g)];
    const gen = ++this.gen;
    const heap = new MinHeap();
    const gcol = this.nodeCol[g];
    const gx = gcol % this.w, gz = (gcol / this.w) | 0, gy = this.nodeY[g];
    const w = this.w;
    const h = (i: number) => {
      const col = this.nodeCol[i];
      const dx = Math.abs((col % w) - gx), dz = Math.abs(((col / w) | 0) - gz);
      return (dx + dz + (1.4142 - 2) * Math.min(dx, dz)) + Math.abs(this.nodeY[i] - gy);
    };
    this.visit[s] = gen;
    this.gScore[s] = 0;
    this.came[s] = -1;
    heap.push(s, h(s));
    let expanded = 0;
    let found = false;
    let bestNode = s, bestH = Infinity;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === g) { found = true; break; }
      if (++expanded > maxNodes) break;
      const hc = h(cur);
      if (hc < bestH) { bestH = hc; bestNode = cur; }
      const gc = this.gScore[cur];
      // wall-hugging penalty keeps agents in the middle of corridors
      this.forNeighbors(cur, (j, cost) => {
        if (this.closed[j] === gen) return;
        const ng = gc + cost + (this.nearWall[j] ? 0.6 : 0);
        if (this.visit[j] !== gen || ng < this.gScore[j]) {
          this.visit[j] = gen;
          this.gScore[j] = ng;
          this.came[j] = cur;
          heap.push(j, ng + h(j));
        }
      });
    }
    const end = found ? g : bestNode;
    if (end === s) return null;
    const ids: number[] = [];
    for (let c = end; c !== -1; c = this.came[c]) ids.push(c);
    ids.reverse();
    return this.smooth(ids);
  }

  /** Walkable straight line between two nodes on the grid. */
  walkable(a: number, b: number): boolean {
    const pa = this.nodePos(a), pb = this.nodePos(b);
    const dist = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const n = Math.ceil(dist / (CELL * 0.5));
    let y = pa.y;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = pa.x + (pb.x - pa.x) * t, z = pa.z + (pb.z - pa.z) * t;
      // check a slightly wider footprint so we don't clip corners
      for (const [ox, oz] of [[0, 0], [0.2, 0.2], [-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2]]) {
        const ix = Math.floor((x + ox - this.x0) / CELL), iz = Math.floor((z + oz - this.z0) / CELL);
        if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.d) return false;
        const j = this.nodeInCol(iz * this.w + ix, y, STEP);
        if (j < 0) return false;
        if (ox === 0 && oz === 0) y = this.nodeY[j];
      }
    }
    return Math.abs(y - pb.y) < STEP + 0.01;
  }

  private smooth(ids: number[]): NavPoint[] {
    const out: NavPoint[] = [];
    let i = 0;
    out.push(this.nodePos(ids[0]));
    while (i < ids.length - 1) {
      let j = Math.min(ids.length - 1, i + 40);
      while (j > i + 1 && !this.walkable(ids[i], ids[j])) j--;
      out.push(this.nodePos(ids[j]));
      i = j;
    }
    return out;
  }

  /** Random reachable-ish node near a point (for searching). */
  randomNear(x: number, y: number, z: number, radius: number): NavPoint | null {
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
      const n = this.nearest(x + Math.cos(a) * r, y + 0.5, z + Math.sin(a) * r);
      if (n >= 0) {
        const p = this.nodePos(n);
        if (Math.abs(p.y - y) < 2) return p;
      }
    }
    return null;
  }

  /** Nodes within radius, sampled (for cover search). */
  sampleNear(x: number, y: number, z: number, rMin: number, rMax: number, count: number): { id: number; p: NavPoint }[] {
    const res: { id: number; p: NavPoint }[] = [];
    for (let k = 0; k < count * 3 && res.length < count; k++) {
      const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
      const id = this.nearest(x + Math.cos(a) * r, y + 0.5, z + Math.sin(a) * r);
      if (id < 0) continue;
      const p = this.nodePos(id);
      if (Math.abs(p.y - y) > 1.5) continue;
      res.push({ id, p });
    }
    return res;
  }
}
