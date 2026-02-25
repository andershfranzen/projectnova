import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PNG } from 'pngjs';
import { CHUNK_SIZE, TileType, BLOCKING_TILES, tileTypeFromRgb, WallEdge } from '@projectrs/shared';
import type { MapMeta, MapTransition, WallsFile } from '@projectrs/shared';

const MAPS_DIR = resolve(import.meta.dir, '../data/maps');

/**
 * Server-side map — loads terrain from heightmap + tilemap PNG files.
 */
export class GameMap {
  readonly id: string;
  readonly meta: MapMeta;
  readonly width: number;
  readonly height: number;

  /** Height values at vertices (width+1 x height+1) */
  private heights: Float32Array;
  /** Tile types (width x height) */
  private tiles: Uint8Array;
  /** Wall edge bitmasks per tile (width x height) */
  private walls: Uint8Array;

  private minH: number;
  private maxH: number;

  constructor(mapId: string) {
    this.id = mapId;
    const dir = resolve(MAPS_DIR, mapId);

    // Load meta
    this.meta = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf-8')) as MapMeta;
    this.width = this.meta.width;
    this.height = this.meta.height;
    this.minH = this.meta.heightRange[0];
    this.maxH = this.meta.heightRange[1];
    const range = this.maxH - this.minH;

    // Load heightmap
    const heightPng = PNG.sync.read(readFileSync(resolve(dir, 'heightmap.png')));
    const vw = this.width + 1;
    const vh = this.height + 1;
    if (heightPng.width !== vw || heightPng.height !== vh) {
      throw new Error(`Heightmap for '${mapId}' must be ${vw}x${vh}, got ${heightPng.width}x${heightPng.height}`);
    }

    this.heights = new Float32Array(vw * vh);
    for (let i = 0; i < vw * vh; i++) {
      // pngjs stores RGBA even for grayscale, pixel value is in R channel
      const pixel = heightPng.data[i * 4];
      this.heights[i] = (pixel / 255) * range + this.minH;
    }

    // Load tilemap
    const tilePng = PNG.sync.read(readFileSync(resolve(dir, 'tilemap.png')));
    if (tilePng.width !== this.width || tilePng.height !== this.height) {
      throw new Error(`Tilemap for '${mapId}' must be ${this.width}x${this.height}, got ${tilePng.width}x${tilePng.height}`);
    }

    this.tiles = new Uint8Array(this.width * this.height);
    for (let i = 0; i < this.width * this.height; i++) {
      const r = tilePng.data[i * 4];
      const g = tilePng.data[i * 4 + 1];
      const b = tilePng.data[i * 4 + 2];
      this.tiles[i] = tileTypeFromRgb(r, g, b);
    }

    // Load walls
    this.walls = new Uint8Array(this.width * this.height);
    const wallsPath = resolve(dir, 'walls.json');
    if (existsSync(wallsPath)) {
      const wallsData: WallsFile = JSON.parse(readFileSync(wallsPath, 'utf-8'));
      for (const [key, mask] of Object.entries(wallsData.walls)) {
        const [xStr, zStr] = key.split(',');
        const x = parseInt(xStr);
        const z = parseInt(zStr);
        if (x >= 0 && x < this.width && z >= 0 && z < this.height) {
          this.walls[z * this.width + x] = mask;
        }
      }
    }

    console.log(`Loaded map '${mapId}': ${this.width}x${this.height} tiles, height range [${this.minH}, ${this.maxH}]`);
  }

  /** Get height at a vertex coordinate */
  getVertexHeight(vx: number, vz: number): number {
    const vw = this.width + 1;
    if (vx < 0 || vx >= vw || vz < 0 || vz >= this.height + 1) return 0;
    return this.heights[vz * vw + vx];
  }

  /** Bilinear interpolation of height at fractional world coordinates */
  getInterpolatedHeight(x: number, z: number): number {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fz = z - z0;

    const h00 = this.getVertexHeight(x0, z0);
    const h10 = this.getVertexHeight(x0 + 1, z0);
    const h01 = this.getVertexHeight(x0, z0 + 1);
    const h11 = this.getVertexHeight(x0 + 1, z0 + 1);

    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;
    return h0 * (1 - fz) + h1 * fz;
  }

  getHeight(x: number, z: number): number {
    return this.getInterpolatedHeight(x, z);
  }

  isBlocked(x: number, z: number): boolean {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= this.width || tz < 0 || tz >= this.height) return true;
    return BLOCKING_TILES.has(this.tiles[tz * this.width + tx] as TileType);
  }

  getTileType(x: number, z: number): TileType {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= this.width || tz < 0 || tz >= this.height) return TileType.WALL;
    return this.tiles[tz * this.width + tx] as TileType;
  }

  getWall(x: number, z: number): number {
    if (x < 0 || x >= this.width || z < 0 || z >= this.height) return 0;
    return this.walls[z * this.width + x];
  }

  /** Check if movement from (fromX,fromZ) to (toX,toZ) is blocked by a wall edge */
  isWallBlocked(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const fx = Math.floor(fromX);
    const fz = Math.floor(fromZ);
    const tx = Math.floor(toX);
    const tz = Math.floor(toZ);

    const dx = tx - fx;
    const dz = tz - fz;

    // Cardinal movement
    if (dx === 0 && dz === -1) return (this.getWall(fx, fz) & WallEdge.N) !== 0;
    if (dx === 1 && dz === 0) return (this.getWall(fx, fz) & WallEdge.E) !== 0;
    if (dx === 0 && dz === 1) return (this.getWall(fx, fz) & WallEdge.S) !== 0;
    if (dx === -1 && dz === 0) return (this.getWall(fx, fz) & WallEdge.W) !== 0;

    // Diagonal movement — blocked if either of the two edges that would be crossed has a wall
    if (dx === 1 && dz === -1) {  // NE
      return (this.getWall(fx, fz) & WallEdge.N) !== 0 || (this.getWall(fx, fz) & WallEdge.E) !== 0
          || (this.getWall(tx, tz) & WallEdge.S) !== 0 || (this.getWall(tx, tz) & WallEdge.W) !== 0;
    }
    if (dx === -1 && dz === -1) { // NW
      return (this.getWall(fx, fz) & WallEdge.N) !== 0 || (this.getWall(fx, fz) & WallEdge.W) !== 0
          || (this.getWall(tx, tz) & WallEdge.S) !== 0 || (this.getWall(tx, tz) & WallEdge.E) !== 0;
    }
    if (dx === 1 && dz === 1) {   // SE
      return (this.getWall(fx, fz) & WallEdge.S) !== 0 || (this.getWall(fx, fz) & WallEdge.E) !== 0
          || (this.getWall(tx, tz) & WallEdge.N) !== 0 || (this.getWall(tx, tz) & WallEdge.W) !== 0;
    }
    if (dx === -1 && dz === 1) {  // SW
      return (this.getWall(fx, fz) & WallEdge.S) !== 0 || (this.getWall(fx, fz) & WallEdge.W) !== 0
          || (this.getWall(tx, tz) & WallEdge.N) !== 0 || (this.getWall(tx, tz) & WallEdge.E) !== 0;
    }

    return false;
  }

  findSpawnPoint(): { x: number; z: number } {
    const sp = this.meta.spawnPoint;
    // Verify spawn point isn't blocked, search nearby if it is
    if (!this.isBlocked(sp.x, sp.z)) {
      return { x: sp.x, z: sp.z };
    }
    for (let r = 0; r < 15; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const x = sp.x + dx;
          const z = sp.z + dz;
          if (!this.isBlocked(x, z)) {
            return { x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5 };
          }
        }
      }
    }
    return { x: sp.x, z: sp.z };
  }

  getTransitions(): MapTransition[] {
    return this.meta.transitions;
  }

  /** Check if a position is on a transition tile. Returns the transition or null. */
  getTransitionAt(x: number, z: number): MapTransition | null {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    for (const t of this.meta.transitions) {
      if (t.tileX === tx && t.tileZ === tz) return t;
    }
    return null;
  }

  findPath(startX: number, startZ: number, goalX: number, goalZ: number): { x: number; z: number }[] {
    const sx = Math.floor(startX);
    const sz = Math.floor(startZ);
    const gx = Math.floor(goalX);
    const gz = Math.floor(goalZ);

    if (sx === gx && sz === gz) return [];
    if (this.isBlocked(gx, gz)) return [];

    const w = this.width;
    const h = this.height;
    const maxSteps = 800;

    // Binary min-heap
    interface PNode { x: number; z: number; g: number; hv: number; f: number; parent: PNode | null; heapIdx: number }
    const heap: PNode[] = [];
    const openMap = new Map<number, PNode>();
    const closed = new Set<number>();
    const key = (x: number, z: number) => z * w + x;

    const heuristic = (x: number, z: number) => {
      const dx = Math.abs(x - gx);
      const dz = Math.abs(z - gz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };

    const bubbleUp = (i: number) => {
      const node = heap[i];
      while (i > 0) {
        const pi = (i - 1) >> 1;
        const parent = heap[pi];
        if (node.f >= parent.f) break;
        heap[i] = parent; parent.heapIdx = i;
        i = pi;
      }
      heap[i] = node; node.heapIdx = i;
    };

    const sinkDown = (i: number) => {
      const len = heap.length;
      const node = heap[i];
      while (true) {
        let sm = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < len && heap[l].f < heap[sm].f) sm = l;
        if (r < len && heap[r].f < heap[sm].f) sm = r;
        if (sm === i) break;
        heap[i] = heap[sm]; heap[i].heapIdx = i;
        i = sm;
      }
      heap[i] = node; node.heapIdx = i;
    };

    const pushNode = (n: PNode) => { n.heapIdx = heap.length; heap.push(n); bubbleUp(heap.length - 1); };
    const popNode = (): PNode => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) { heap[0] = last; last.heapIdx = 0; sinkDown(0); }
      return top;
    };

    const sh = heuristic(sx, sz);
    const startNode: PNode = { x: sx, z: sz, g: 0, hv: sh, f: sh, parent: null, heapIdx: 0 };
    pushNode(startNode);
    openMap.set(key(sx, sz), startNode);

    let steps = 0;
    while (heap.length > 0 && steps < maxSteps) {
      steps++;
      const current = popNode();
      const ck = key(current.x, current.z);
      openMap.delete(ck);

      if (current.x === gx && current.z === gz) {
        const path: { x: number; z: number }[] = [];
        let node: PNode | null = current;
        while (node && !(node.x === sx && node.z === sz)) {
          path.unshift({ x: node.x + 0.5, z: node.z + 0.5 });
          node = node.parent;
        }
        return path;
      }

      closed.add(ck);

      const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      // Diagonal: allowed only if both cardinal neighbors are passable AND no wall edges block
      const canW = !this.isBlocked(current.x - 1, current.z) && !this.isWallBlocked(current.x, current.z, current.x - 1, current.z);
      const canE = !this.isBlocked(current.x + 1, current.z) && !this.isWallBlocked(current.x, current.z, current.x + 1, current.z);
      const canN = !this.isBlocked(current.x, current.z - 1) && !this.isWallBlocked(current.x, current.z, current.x, current.z - 1);
      const canS = !this.isBlocked(current.x, current.z + 1) && !this.isWallBlocked(current.x, current.z, current.x, current.z + 1);
      if (canW && canN) dirs.push([-1, -1]);
      if (canE && canN) dirs.push([1, -1]);
      if (canW && canS) dirs.push([-1, 1]);
      if (canE && canS) dirs.push([1, 1]);

      for (const [dx, dz] of dirs) {
        const nx = current.x + dx;
        const nz = current.z + dz;
        const nk = key(nx, nz);
        if (closed.has(nk)) continue;
        if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;
        if (this.isBlocked(nx, nz)) continue;
        if (this.isWallBlocked(current.x, current.z, nx, nz)) continue;

        const isDiag = dx !== 0 && dz !== 0;
        const g = current.g + (isDiag ? 1.414 : 1);

        const existing = openMap.get(nk);
        if (existing) {
          if (g < existing.g) {
            existing.g = g;
            existing.f = g + existing.hv;
            existing.parent = current;
            bubbleUp(existing.heapIdx);
          }
          continue;
        }

        const nhv = heuristic(nx, nz);
        const node: PNode = { x: nx, z: nz, g, hv: nhv, f: g + nhv, parent: current, heapIdx: 0 };
        pushNode(node);
        openMap.set(nk, node);
      }
    }
    return [];
  }
}
