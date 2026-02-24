import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CHUNK_SIZE, CHUNK_LOAD_RADIUS, TILE_SIZE, TileType, BLOCKING_TILES, WATER_LEVEL, tileTypeFromRgb } from '@projectrs/shared';
import type { MapMeta } from '@projectrs/shared';

// Tile colors for vertex coloring
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

interface ChunkMeshes {
  ground: Mesh;
  water: Mesh | null;
  wall: Mesh | null;
}

/**
 * Client-side chunk manager.
 * Loads heightmap + tilemap PNGs via HTTP, builds/destroys chunk terrain
 * meshes based on player position.
 */
export class ChunkManager {
  private scene: Scene;
  private mapId: string = '';
  private meta: MapMeta | null = null;

  // Map data
  private mapWidth: number = 0;
  private mapHeight: number = 0;
  private heights: Float32Array | null = null; // (width+1) * (height+1) vertices
  private tiles: Uint8Array | null = null; // width * height tiles

  // Active chunk meshes
  private chunks: Map<string, ChunkMeshes> = new Map();
  private lastChunkX: number = -999;
  private lastChunkZ: number = -999;

  // Shared materials
  private groundMat: StandardMaterial | null = null;
  private waterMat: StandardMaterial | null = null;
  private wallMat: StandardMaterial | null = null;

  private loaded: boolean = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getMeta(): MapMeta | null {
    return this.meta;
  }

  getMapWidth(): number {
    return this.mapWidth;
  }

  getMapHeight(): number {
    return this.mapHeight;
  }

  /** Load map data from server via HTTP */
  async loadMap(mapId: string): Promise<void> {
    this.disposeAll();
    this.loaded = false;
    this.mapId = mapId;

    // Fetch meta (cache-bust to avoid stale data)
    const cacheBust = `?t=${Date.now()}`;
    const metaRes = await fetch(`/maps/${mapId}/meta.json${cacheBust}`);
    this.meta = await metaRes.json() as MapMeta;
    this.mapWidth = this.meta.width;
    this.mapHeight = this.meta.height;

    // Fetch and decode heightmap
    const heightRes = await fetch(`/maps/${mapId}/heightmap.png${cacheBust}`);
    const heightBlob = await heightRes.blob();
    const heightBitmap = await createImageBitmap(heightBlob);

    const vw = this.mapWidth + 1;
    const vh = this.mapHeight + 1;
    const hCanvas = new OffscreenCanvas(vw, vh);
    const hCtx = hCanvas.getContext('2d')!;
    hCtx.drawImage(heightBitmap, 0, 0);
    const hData = hCtx.getImageData(0, 0, vw, vh);

    const [minH, maxH] = this.meta.heightRange;
    const range = maxH - minH;
    this.heights = new Float32Array(vw * vh);
    for (let i = 0; i < vw * vh; i++) {
      const pixel = hData.data[i * 4]; // R channel of RGBA
      this.heights[i] = (pixel / 255) * range + minH;
    }

    // Fetch and decode tilemap
    const tileRes = await fetch(`/maps/${mapId}/tilemap.png${cacheBust}`);
    const tileBlob = await tileRes.blob();
    const tileBitmap = await createImageBitmap(tileBlob);

    const tCanvas = new OffscreenCanvas(this.mapWidth, this.mapHeight);
    const tCtx = tCanvas.getContext('2d')!;
    tCtx.drawImage(tileBitmap, 0, 0);
    const tData = tCtx.getImageData(0, 0, this.mapWidth, this.mapHeight);

    this.tiles = new Uint8Array(this.mapWidth * this.mapHeight);
    for (let i = 0; i < this.mapWidth * this.mapHeight; i++) {
      const r = tData.data[i * 4];
      const g = tData.data[i * 4 + 1];
      const b = tData.data[i * 4 + 2];
      this.tiles[i] = tileTypeFromRgb(r, g, b);
    }

    // Create shared materials
    if (!this.groundMat) {
      this.groundMat = new StandardMaterial('chunkGroundMat', this.scene);
      this.groundMat.specularColor = new Color3(0, 0, 0);
    }
    if (!this.waterMat) {
      this.waterMat = new StandardMaterial('chunkWaterMat', this.scene);
      this.waterMat.specularColor = new Color3(0.3, 0.3, 0.4);
      this.waterMat.alpha = 0.6;
    }
    if (!this.wallMat) {
      this.wallMat = new StandardMaterial('chunkWallMat', this.scene);
      this.wallMat.specularColor = new Color3(0.05, 0.05, 0.05);
      this.wallMat.backFaceCulling = false;
    }

    this.loaded = true;
    this.lastChunkX = -999;
    this.lastChunkZ = -999;
    console.log(`[ChunkManager] Loaded map '${mapId}': ${this.mapWidth}x${this.mapHeight}`);
  }

  /** Update chunks around player position — call each frame */
  updatePlayerPosition(playerX: number, playerZ: number): void {
    if (!this.loaded) return;

    const cx = Math.floor(playerX / CHUNK_SIZE);
    const cz = Math.floor(playerZ / CHUNK_SIZE);

    if (cx === this.lastChunkX && cz === this.lastChunkZ) return;
    this.lastChunkX = cx;
    this.lastChunkZ = cz;

    // Determine desired chunks
    const desired = new Set<string>();
    for (let dx = -CHUNK_LOAD_RADIUS; dx <= CHUNK_LOAD_RADIUS; dx++) {
      for (let dz = -CHUNK_LOAD_RADIUS; dz <= CHUNK_LOAD_RADIUS; dz++) {
        const chunkX = cx + dx;
        const chunkZ = cz + dz;
        const maxCX = Math.ceil(this.mapWidth / CHUNK_SIZE);
        const maxCZ = Math.ceil(this.mapHeight / CHUNK_SIZE);
        if (chunkX >= 0 && chunkX < maxCX && chunkZ >= 0 && chunkZ < maxCZ) {
          desired.add(`${chunkX},${chunkZ}`);
        }
      }
    }

    // Dispose chunks no longer needed
    for (const [key, meshes] of this.chunks) {
      if (!desired.has(key)) {
        meshes.ground.dispose();
        meshes.water?.dispose();
        meshes.wall?.dispose();
        this.chunks.delete(key);
      }
    }

    // Build new chunks
    for (const key of desired) {
      if (!this.chunks.has(key)) {
        const [chunkX, chunkZ] = key.split(',').map(Number);
        const meshes = this.buildChunkMeshes(chunkX, chunkZ);
        this.chunks.set(key, meshes);
      }
    }
  }

  private buildChunkMeshes(chunkX: number, chunkZ: number): ChunkMeshes {
    const startX = chunkX * CHUNK_SIZE;
    const startZ = chunkZ * CHUNK_SIZE;
    const endX = Math.min(startX + CHUNK_SIZE, this.mapWidth);
    const endZ = Math.min(startZ + CHUNK_SIZE, this.mapHeight);

    // Ground mesh
    const ground = this.buildGroundMesh(chunkX, chunkZ, startX, startZ, endX, endZ);
    const water = this.buildWaterMesh(chunkX, chunkZ, startX, startZ, endX, endZ);
    const wall = this.buildWallMesh(chunkX, chunkZ, startX, startZ, endX, endZ);

    return { ground, water, wall };
  }

  private buildGroundMesh(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number): Mesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileType = this.getTileTypeRaw(x, z);
        const color = TILE_COLORS[tileType] || TILE_COLORS[TileType.GRASS];
        const variation = (Math.sin(x * 3.7 + z * 2.3) * 0.03);

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        const y00 = this.getVertexHeight(x, z);
        const y10 = this.getVertexHeight(x + 1, z);
        const y11 = this.getVertexHeight(x + 1, z + 1);
        const y01 = this.getVertexHeight(x, z + 1);

        positions.push(x0, y00, z0);
        positions.push(x1, y10, z0);
        positions.push(x1, y11, z1);
        positions.push(x0, y01, z1);

        for (let i = 0; i < 4; i++) {
          colors.push(color.r + variation, color.g + variation, color.b + variation, 1);
        }

        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;
      }
    }

    const mesh = new Mesh(`chunk_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.colors = colors;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vertexData.normals = normals;
    vertexData.applyToMesh(mesh);

    mesh.material = this.groundMat;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = true;

    return mesh;
  }

  private buildWaterMesh(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasWater = false;

    const waterLevel = this.meta?.waterLevel ?? WATER_LEVEL;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        if (this.getTileTypeRaw(x, z) !== TileType.WATER) continue;
        hasWater = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        positions.push(x0, waterLevel, z0);
        positions.push(x1, waterLevel, z0);
        positions.push(x1, waterLevel, z1);
        positions.push(x0, waterLevel, z1);

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

    const mesh = new Mesh(`water_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);

    mesh.material = this.waterMat;
    mesh.hasVertexAlpha = true;
    mesh.isPickable = false;

    return mesh;
  }

  private buildWallMesh(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasWalls = false;

    const baseColor = TILE_COLORS[TileType.WALL];

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        if (this.getTileTypeRaw(x, z) !== TileType.WALL) continue;
        // Only build 3D walls for tiles that look like building perimeters
        // Check if this wall tile has non-wall neighbors (edge detection)
        const hasNonWallNeighbor =
          this.getTileTypeRaw(x - 1, z) !== TileType.WALL ||
          this.getTileTypeRaw(x + 1, z) !== TileType.WALL ||
          this.getTileTypeRaw(x, z - 1) !== TileType.WALL ||
          this.getTileTypeRaw(x, z + 1) !== TileType.WALL;
        if (!hasNonWallNeighbor) continue;

        hasWalls = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        const y00 = this.getVertexHeight(x, z);
        const y10 = this.getVertexHeight(x + 1, z);
        const y11 = this.getVertexHeight(x + 1, z + 1);
        const y01 = this.getVertexHeight(x, z + 1);

        const yt00 = y00 + WALL_HEIGHT;
        const yt10 = y10 + WALL_HEIGHT;
        const yt11 = y11 + WALL_HEIGHT;
        const yt01 = y01 + WALL_HEIGHT;

        const variation = Math.sin(x * 3.7 + z * 2.3) * 0.03;
        const cr = baseColor.r + variation;
        const cg = baseColor.g + variation;
        const cb = baseColor.b + variation;

        // Top face
        positions.push(x0, yt00, z0, x1, yt10, z0, x1, yt11, z1, x0, yt01, z1);
        for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;

        // Side faces — only if neighbor isn't also a wall
        if (this.getTileTypeRaw(x - 1, z) !== TileType.WALL) {
          positions.push(x0, y00, z0, x0, y01, z1, x0, yt01, z1, x0, yt00, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (this.getTileTypeRaw(x + 1, z) !== TileType.WALL) {
          positions.push(x1, y10, z0, x1, yt10, z0, x1, yt11, z1, x1, y11, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (this.getTileTypeRaw(x, z - 1) !== TileType.WALL) {
          positions.push(x0, y00, z0, x0, yt00, z0, x1, yt10, z0, x1, y10, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (this.getTileTypeRaw(x, z + 1) !== TileType.WALL) {
          positions.push(x1, y11, z1, x1, yt11, z1, x0, yt01, z1, x0, y01, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
      }
    }

    if (!hasWalls) return null;

    const mesh = new Mesh(`wall_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);

    mesh.material = this.wallMat;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = false;

    return mesh;
  }

  // --- Public query methods (used by game logic) ---

  getVertexHeight(vx: number, vz: number): number {
    if (!this.heights) return 0;
    const vw = this.mapWidth + 1;
    if (vx < 0 || vx >= vw || vz < 0 || vz >= this.mapHeight + 1) return 0;
    return this.heights[vz * vw + vx];
  }

  getInterpolatedHeight(x: number, z: number): number {
    if (!this.heights) return 0;
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

  private getTileTypeRaw(x: number, z: number): TileType {
    if (!this.tiles) return TileType.WALL;
    if (x < 0 || x >= this.mapWidth || z < 0 || z >= this.mapHeight) return TileType.WALL;
    return this.tiles[z * this.mapWidth + x] as TileType;
  }

  getTileType(x: number, z: number): TileType {
    return this.getTileTypeRaw(Math.floor(x), Math.floor(z));
  }

  isBlocked(x: number, z: number): boolean {
    return BLOCKING_TILES.has(this.getTileType(x, z));
  }

  /** Get tile data for minimap rendering (windowed view) */
  getTilesForMinimap(centerX: number, centerZ: number, radius: number): { tiles: Uint8Array; size: number; startX: number; startZ: number } {
    const size = radius * 2;
    const startX = Math.floor(centerX) - radius;
    const startZ = Math.floor(centerZ) - radius;
    const result = new Uint8Array(size * size);

    for (let dz = 0; dz < size; dz++) {
      for (let dx = 0; dx < size; dx++) {
        result[dz * size + dx] = this.getTileTypeRaw(startX + dx, startZ + dz);
      }
    }

    return { tiles: result, size, startX, startZ };
  }

  /** Check if any ground mesh was picked at the given screen coordinates */
  isGroundMesh(meshName: string): boolean {
    return meshName.startsWith('chunk_');
  }

  /** Get all active ground meshes for picking */
  getGroundMeshes(): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [, chunk] of this.chunks) {
      meshes.push(chunk.ground);
    }
    return meshes;
  }

  disposeAll(): void {
    for (const [, meshes] of this.chunks) {
      meshes.ground.dispose();
      meshes.water?.dispose();
      meshes.wall?.dispose();
    }
    this.chunks.clear();
    this.heights = null;
    this.tiles = null;
    this.loaded = false;
    this.lastChunkX = -999;
    this.lastChunkZ = -999;
  }
}
