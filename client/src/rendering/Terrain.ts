import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { MAP_SIZE, TILE_SIZE, TileType, BLOCKING_TILES, getTerrainHeight, WATER_LEVEL } from '@projectrs/shared';

// Tile colors
const TILE_COLORS: Record<TileType, Color4> = {
  [TileType.GRASS]: new Color4(0.30, 0.55, 0.20, 1),
  [TileType.DIRT]:  new Color4(0.55, 0.40, 0.25, 1),
  [TileType.STONE]: new Color4(0.50, 0.50, 0.50, 1),
  [TileType.WATER]: new Color4(0.20, 0.35, 0.70, 1),
  [TileType.WALL]:  new Color4(0.35, 0.30, 0.30, 1),
  [TileType.SAND]:  new Color4(0.76, 0.70, 0.50, 1),
  [TileType.WOOD]:  new Color4(0.45, 0.32, 0.18, 1),
};

const WALL_HEIGHT = 1.8;

const BUILDING_FOOTPRINTS: { bx: number; bz: number; w: number; h: number }[] = [
  { bx: 40, bz: 50, w: 6, h: 5 },
  { bx: 54, bz: 46, w: 5, h: 6 },
  { bx: 44, bz: 38, w: 6, h: 5 },
  { bx: 38, bz: 44, w: 5, h: 5 },
];

function isBuildingPerimeter(x: number, z: number): boolean {
  for (const { bx, bz, w, h } of BUILDING_FOOTPRINTS) {
    if (x >= bx && x < bx + w && z >= bz && z < bz + h) {
      if (x === bx || x === bx + w - 1 || z === bz || z === bz + h - 1) {
        return true;
      }
    }
  }
  return false;
}

function isBuildingWallTile(tiles: TileType[][], x: number, z: number): boolean {
  if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) return false;
  return tiles[x][z] === TileType.WALL && isBuildingPerimeter(x, z);
}

export class Terrain {
  private tiles: TileType[][];
  private mesh: Mesh;
  private waterMesh: Mesh | null = null;
  private wallMesh: Mesh | null = null;
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
    this.tiles = this.generateMap();
    this.mesh = this.buildMesh();
    this.waterMesh = this.buildWaterMesh();
    this.wallMesh = this.buildBuildingWallMesh();
  }

  /**
   * Must match server/src/GameMap.ts generateMap() exactly!
   */
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
    for (let x = 44; x < 54; x++) {
      for (let z = 44; z < 54; z++) {
        tiles[x][z] = TileType.STONE;
      }
    }

    // Buildings around village
    this.placeBuilding(tiles, 40, 50, 6, 5);
    this.placeBuilding(tiles, 54, 46, 5, 6);
    this.placeBuilding(tiles, 44, 38, 6, 5);
    this.placeBuilding(tiles, 38, 44, 5, 5);

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
          tiles[x][z] = TileType.WOOD;
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
        if (Math.sin(x * 3.7 + z * 2.3) > 0.7 && tiles[x][z] === TileType.GRASS) {
          tiles[x][z] = TileType.WALL;
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
    for (let x = 75; x < 90; x++) {
      if (x !== 82) {
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
            tiles[x][z] = TileType.DIRT;
          } else {
            tiles[x][z] = TileType.WALL;
          }
        } else {
          tiles[x][z] = TileType.WOOD;
        }
      }
    }
  }

  private buildMesh(): Mesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];

    let vertexIndex = 0;

    for (let x = 0; x < MAP_SIZE; x++) {
      for (let z = 0; z < MAP_SIZE; z++) {
        const tileType = this.tiles[x][z];
        const color = TILE_COLORS[tileType];

        const variation = (Math.sin(x * 3.7 + z * 2.3) * 0.03);

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        // Per-vertex elevation from shared terrain height function
        const y00 = getTerrainHeight(x, z);
        const y10 = getTerrainHeight(x + 1, z);
        const y11 = getTerrainHeight(x + 1, z + 1);
        const y01 = getTerrainHeight(x, z + 1);

        positions.push(x0, y00, z0);
        positions.push(x1, y10, z0);
        positions.push(x1, y11, z1);
        positions.push(x0, y01, z1);

        for (let i = 0; i < 4; i++) {
          colors.push(
            color.r + variation,
            color.g + variation,
            color.b + variation,
            1
          );
        }

        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;
      }
    }

    const mesh = new Mesh('terrain', this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.colors = colors;

    // Compute normals from actual geometry instead of hardcoded (0,1,0)
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vertexData.normals = normals;

    vertexData.applyToMesh(mesh);

    const mat = new StandardMaterial('terrainMat', this.scene);
    mat.specularColor = new Color3(0, 0, 0);
    mesh.material = mat;

    mesh.hasVertexAlpha = false;
    mesh.isPickable = true;

    return mesh;
  }

  private buildWaterMesh(): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];

    let vertexIndex = 0;
    let hasWater = false;

    for (let x = 0; x < MAP_SIZE; x++) {
      for (let z = 0; z < MAP_SIZE; z++) {
        if (this.tiles[x][z] !== TileType.WATER) continue;
        hasWater = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        // All water vertices at fixed WATER_LEVEL
        positions.push(x0, WATER_LEVEL, z0);
        positions.push(x1, WATER_LEVEL, z0);
        positions.push(x1, WATER_LEVEL, z1);
        positions.push(x0, WATER_LEVEL, z1);

        for (let i = 0; i < 4; i++) {
          normals.push(0, 1, 0);
          colors.push(0.2, 0.35, 0.7, 0.6);
        }

        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;
      }
    }

    if (!hasWater) return null;

    const mesh = new Mesh('water', this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);

    const mat = new StandardMaterial('waterMat', this.scene);
    mat.specularColor = new Color3(0.3, 0.3, 0.4);
    mat.alpha = 0.6;
    mesh.material = mat;

    mesh.hasVertexAlpha = true;
    mesh.isPickable = false;

    return mesh;
  }

  private buildBuildingWallMesh(): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasWalls = false;

    const baseColor = TILE_COLORS[TileType.WALL];

    for (const { bx, bz, w, h } of BUILDING_FOOTPRINTS) {
      for (let x = bx; x < bx + w; x++) {
        for (let z = bz; z < bz + h; z++) {
          if (!isBuildingWallTile(this.tiles, x, z)) continue;
          hasWalls = true;

          const x0 = x * TILE_SIZE;
          const x1 = (x + 1) * TILE_SIZE;
          const z0 = z * TILE_SIZE;
          const z1 = (z + 1) * TILE_SIZE;

          const y00 = getTerrainHeight(x, z);
          const y10 = getTerrainHeight(x + 1, z);
          const y11 = getTerrainHeight(x + 1, z + 1);
          const y01 = getTerrainHeight(x, z + 1);

          const yt00 = y00 + WALL_HEIGHT;
          const yt10 = y10 + WALL_HEIGHT;
          const yt11 = y11 + WALL_HEIGHT;
          const yt01 = y01 + WALL_HEIGHT;

          const variation = Math.sin(x * 3.7 + z * 2.3) * 0.03;
          const cr = baseColor.r + variation;
          const cg = baseColor.g + variation;
          const cb = baseColor.b + variation;

          // Top face (cap) — slightly lighter
          positions.push(x0, yt00, z0, x1, yt10, z0, x1, yt11, z1, x0, yt01, z1);
          for (let i = 0; i < 4; i++) {
            normals.push(0, 1, 0);
            colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1);
          }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
          indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;

          // -X side
          if (!isBuildingWallTile(this.tiles, x - 1, z)) {
            positions.push(x0, y00, z0, x0, y01, z1, x0, yt01, z1, x0, yt00, z0);
            for (let i = 0; i < 4; i++) {
              normals.push(-1, 0, 0);
              colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1);
            }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
          }

          // +X side
          if (!isBuildingWallTile(this.tiles, x + 1, z)) {
            positions.push(x1, y10, z0, x1, yt10, z0, x1, yt11, z1, x1, y11, z1);
            for (let i = 0; i < 4; i++) {
              normals.push(1, 0, 0);
              colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1);
            }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
          }

          // -Z side
          if (!isBuildingWallTile(this.tiles, x, z - 1)) {
            positions.push(x0, y00, z0, x0, yt00, z0, x1, yt10, z0, x1, y10, z0);
            for (let i = 0; i < 4; i++) {
              normals.push(0, 0, -1);
              colors.push(cr, cg, cb, 1);
            }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
          }

          // +Z side
          if (!isBuildingWallTile(this.tiles, x, z + 1)) {
            positions.push(x1, y11, z1, x1, yt11, z1, x0, yt01, z1, x0, y01, z1);
            for (let i = 0; i < 4; i++) {
              normals.push(0, 0, 1);
              colors.push(cr, cg, cb, 1);
            }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
          }
        }
      }
    }

    if (!hasWalls) return null;

    const mesh = new Mesh('buildingWalls', this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);

    const mat = new StandardMaterial('buildingWallMat', this.scene);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mat.backFaceCulling = false;
    mesh.material = mat;

    mesh.hasVertexAlpha = false;
    mesh.isPickable = false;

    return mesh;
  }

  getTileType(x: number, z: number): TileType {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= MAP_SIZE || tz < 0 || tz >= MAP_SIZE) {
      return TileType.WALL;
    }
    return this.tiles[tx][tz];
  }

  isBlocked(x: number, z: number): boolean {
    return BLOCKING_TILES.has(this.getTileType(x, z));
  }

  getMesh(): Mesh {
    return this.mesh;
  }

  getTiles(): TileType[][] {
    return this.tiles;
  }
}
