import { MAP_SIZE, TileType, BLOCKING_TILES, getInterpolatedHeight } from '@projectrs/shared';

/**
 * Server-side map — same generation as client Terrain.
 * Must stay in sync with client/src/rendering/Terrain.ts generation logic.
 */
export class GameMap {
  private tiles: TileType[][];

  constructor() {
    this.tiles = this.generateMap();
  }

  private generateMap(): TileType[][] {
    const tiles: TileType[][] = [];

    for (let x = 0; x < MAP_SIZE; x++) {
      tiles[x] = [];
      for (let z = 0; z < MAP_SIZE; z++) {
        tiles[x][z] = TileType.GRASS;
      }
    }

    const cx = Math.floor(MAP_SIZE / 2); // 48

    // === Main dirt roads (cross through center) ===
    for (let i = 10; i < MAP_SIZE - 10; i++) {
      tiles[i][cx] = TileType.DIRT;
      tiles[i][cx - 1] = TileType.DIRT;
      tiles[cx][i] = TileType.DIRT;
      tiles[cx - 1][i] = TileType.DIRT;
    }

    // === Branch road south to goblin area ===
    for (let z = cx; z < 80; z++) {
      tiles[20][z] = TileType.DIRT;
      tiles[21][z] = TileType.DIRT;
    }

    // === Branch road east to forest ===
    for (let x = cx; x < 80; x++) {
      tiles[x][22] = TileType.DIRT;
      tiles[x][23] = TileType.DIRT;
    }

    // === Village center area (around 45-55, 45-55) ===
    // Village square (stone plaza)
    for (let x = 44; x < 54; x++) {
      for (let z = 44; z < 54; z++) {
        tiles[x][z] = TileType.STONE;
      }
    }

    // Buildings around village
    this.placeBuilding(tiles, 40, 50, 6, 5); // Shop
    this.placeBuilding(tiles, 54, 46, 5, 6); // House 1
    this.placeBuilding(tiles, 44, 38, 6, 5); // House 2
    this.placeBuilding(tiles, 38, 44, 5, 5); // House 3

    // === Water pond (lake) ===
    for (let x = 58; x < 72; x++) {
      for (let z = 40; z < 54; z++) {
        const px = x - 65;
        const pz = z - 47;
        if (px * px + pz * pz < 35) {
          tiles[x][z] = TileType.WATER;
        }
      }
    }

    // Sand around lake
    for (let x = 55; x < 75; x++) {
      for (let z = 37; z < 57; z++) {
        if (x >= 0 && x < MAP_SIZE && z >= 0 && z < MAP_SIZE) {
          const px = x - 65;
          const pz = z - 47;
          const d = px * px + pz * pz;
          if (d >= 35 && d < 60 && tiles[x][z] === TileType.GRASS) {
            tiles[x][z] = TileType.SAND;
          }
        }
      }
    }

    // === Farm area (chickens) — east side ===
    for (let x = 52; x < 62; x++) {
      for (let z = 58; z < 66; z++) {
        if (x === 52 || x === 61 || z === 58 || z === 65) {
          tiles[x][z] = TileType.WOOD; // Fence (walkable)
        }
      }
    }

    // === Stone mine area (NW corner) ===
    for (let x = 10; x < 20; x++) {
      for (let z = 10; z < 20; z++) {
        tiles[x][z] = TileType.STONE;
      }
    }

    // === Forest area (NE) — trees are walls ===
    for (let x = 65; x < 88; x++) {
      for (let z = 10; z < 35; z++) {
        // Scattered trees (some blocked)
        if (Math.sin(x * 3.7 + z * 2.3) > 0.7 && tiles[x][z] === TileType.GRASS) {
          tiles[x][z] = TileType.WALL; // Tree trunk
        }
      }
    }
    // Clear paths through forest
    for (let x = 65; x < 88; x++) {
      tiles[x][22] = TileType.DIRT;
      tiles[x][23] = TileType.DIRT;
    }

    // === Dark area / dungeon (SE corner) ===
    for (let x = 75; x < 90; x++) {
      for (let z = 75; z < 90; z++) {
        tiles[x][z] = TileType.STONE;
      }
    }
    // Walls around dungeon
    for (let x = 75; x < 90; x++) {
      if (x !== 82) { // Leave entrance
        tiles[x][75] = TileType.WALL;
        tiles[x][89] = TileType.WALL;
      }
    }
    for (let z = 75; z < 90; z++) {
      tiles[75][z] = TileType.WALL;
      tiles[89][z] = TileType.WALL;
    }

    // === Goblin camp (SW area) ===
    for (let x = 15; x < 28; x++) {
      for (let z = 68; z < 78; z++) {
        if (tiles[x][z] === TileType.GRASS) {
          tiles[x][z] = TileType.DIRT;
        }
      }
    }

    // === Map border walls ===
    for (let i = 0; i < MAP_SIZE; i++) {
      tiles[0][i] = TileType.WALL;
      tiles[MAP_SIZE - 1][i] = TileType.WALL;
      tiles[i][0] = TileType.WALL;
      tiles[i][MAP_SIZE - 1] = TileType.WALL;
    }

    return tiles;
  }

  private placeBuilding(tiles: TileType[][], bx: number, bz: number, w: number, h: number): void {
    for (let x = bx; x < bx + w && x < MAP_SIZE; x++) {
      for (let z = bz; z < bz + h && z < MAP_SIZE; z++) {
        if (x === bx || x === bx + w - 1 || z === bz || z === bz + h - 1) {
          if (z === bz && x === bx + Math.floor(w / 2)) {
            tiles[x][z] = TileType.DIRT; // Doorway
          } else {
            tiles[x][z] = TileType.WALL;
          }
        } else {
          tiles[x][z] = TileType.WOOD;
        }
      }
    }
  }

  getHeight(x: number, z: number): number {
    return getInterpolatedHeight(x, z);
  }

  isBlocked(x: number, z: number): boolean {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= MAP_SIZE || tz < 0 || tz >= MAP_SIZE) return true;
    return BLOCKING_TILES.has(this.tiles[tx][tz]);
  }

  getTileType(x: number, z: number): TileType {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= MAP_SIZE || tz < 0 || tz >= MAP_SIZE) return TileType.WALL;
    return this.tiles[tx][tz];
  }

  findSpawnPoint(): { x: number; z: number } {
    const cx = Math.floor(MAP_SIZE / 2);
    const cz = Math.floor(MAP_SIZE / 2);
    for (let r = 0; r < 15; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const x = cx + dx;
          const z = cz + dz;
          if (!this.isBlocked(x, z)) {
            return { x: x + 0.5, z: z + 0.5 };
          }
        }
      }
    }
    return { x: cx + 0.5, z: cz + 0.5 };
  }

  findPath(startX: number, startZ: number, goalX: number, goalZ: number): { x: number; z: number }[] {
    const sx = Math.floor(startX);
    const sz = Math.floor(startZ);
    const gx = Math.floor(goalX);
    const gz = Math.floor(goalZ);

    if (sx === gx && sz === gz) return [];
    if (this.isBlocked(gx, gz)) return [];

    const open: { x: number; z: number; g: number; f: number; parent: any }[] = [];
    const closed = new Set<string>();
    const key = (x: number, z: number) => `${x},${z}`;
    const h = (x: number, z: number) => {
      const dx = Math.abs(x - gx);
      const dz = Math.abs(z - gz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };

    open.push({ x: sx, z: sz, g: 0, f: h(sx, sz), parent: null });

    let steps = 0;
    while (open.length > 0 && steps < 400) {
      steps++;
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestIdx].f) bestIdx = i;
      }
      const current = open.splice(bestIdx, 1)[0];

      if (current.x === gx && current.z === gz) {
        const path: { x: number; z: number }[] = [];
        let node = current;
        while (node && !(node.x === sx && node.z === sz)) {
          path.unshift({ x: node.x + 0.5, z: node.z + 0.5 });
          node = node.parent;
        }
        return path;
      }

      closed.add(key(current.x, current.z));

      const dirs: [number, number][] = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
      ];
      if (!this.isBlocked(current.x - 1, current.z) && !this.isBlocked(current.x, current.z - 1)) dirs.push([-1, -1]);
      if (!this.isBlocked(current.x + 1, current.z) && !this.isBlocked(current.x, current.z - 1)) dirs.push([1, -1]);
      if (!this.isBlocked(current.x - 1, current.z) && !this.isBlocked(current.x, current.z + 1)) dirs.push([-1, 1]);
      if (!this.isBlocked(current.x + 1, current.z) && !this.isBlocked(current.x, current.z + 1)) dirs.push([1, 1]);

      for (const [dx, dz] of dirs) {
        const nx = current.x + dx;
        const nz = current.z + dz;
        if (closed.has(key(nx, nz))) continue;
        if (nx < 0 || nx >= MAP_SIZE || nz < 0 || nz >= MAP_SIZE) continue;
        if (this.isBlocked(nx, nz)) continue;

        const isDiagonal = dx !== 0 && dz !== 0;
        const g = current.g + (isDiagonal ? 1.414 : 1);
        const f = g + h(nx, nz);
        const existing = open.find(n => n.x === nx && n.z === nz);
        if (existing) {
          if (g < existing.g) {
            existing.g = g;
            existing.f = f;
            existing.parent = current;
          }
          continue;
        }
        open.push({ x: nx, z: nz, g, f, parent: current });
      }
    }
    return [];
  }
}
