import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CHUNK_SIZE, CHUNK_LOAD_RADIUS, TILE_SIZE, TileType, BLOCKING_TILES, WATER_LEVEL, tileTypeFromRgb, WallEdge, DEFAULT_WALL_HEIGHT } from '@projectrs/shared';
import type { MapMeta, WallsFile, StairData, RoofData, FloorLayerData } from '@projectrs/shared';

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

/** Building meshes for a single floor layer within a chunk */
interface FloorMeshSet {
  wall: Mesh | null;
  roof: Mesh | null;
  floor: Mesh | null;
  stairs: Mesh | null;
}

interface ChunkMeshes {
  ground: Mesh;
  water: Mesh | null;
  wall: Mesh | null;      // floor 0 walls
  roof: Mesh | null;      // floor 0 roofs
  floor: Mesh | null;     // floor 0 floors
  stairs: Mesh | null;    // floor 0 stairs
  upperFloors: Map<number, FloorMeshSet>; // floor 1+ meshes
}

/** In-memory floor layer data */
interface FloorLayerClientData {
  walls: Map<number, number>;
  wallHeights: Map<number, number>;
  floors: Map<number, number>;
  stairs: Map<number, StairData>;
  roofs: Map<number, RoofData>;
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
  private walls: Uint8Array | null = null; // width * height wall edge bitmasks
  private wallHeights: Map<number, number> = new Map(); // sparse: tile index -> height
  private floorHeights: Map<number, number> = new Map(); // sparse: tile index -> floor height
  private stairData: Map<number, StairData> = new Map(); // sparse: tile index -> stair
  private roofData: Map<number, RoofData> = new Map(); // sparse: tile index -> roof

  // Multi-floor layer data (floor 1+)
  private floorLayerData: Map<number, FloorLayerClientData> = new Map();
  private currentFloor: number = 0;

  // Active chunk meshes
  private chunks: Map<string, ChunkMeshes> = new Map();
  private lastChunkX: number = -999;
  private lastChunkZ: number = -999;

  // Shared materials
  private groundMat: StandardMaterial | null = null;
  private waterMat: StandardMaterial | null = null;
  private wallMat: StandardMaterial | null = null;
  private roofMat: StandardMaterial | null = null;
  private floorMat: StandardMaterial | null = null;
  private stairMat: StandardMaterial | null = null;

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

    // Fetch walls data
    this.walls = new Uint8Array(this.mapWidth * this.mapHeight);
    this.wallHeights.clear();
    this.floorHeights.clear();
    this.stairData.clear();
    this.roofData.clear();
    this.floorLayerData.clear();
    this.currentFloor = 0;
    try {
      const wallsRes = await fetch(`/maps/${mapId}/walls.json${cacheBust}`);
      if (wallsRes.ok) {
        const wallsData: WallsFile = await wallsRes.json();
        const parseKey = (key: string): number | null => {
          const [xStr, zStr] = key.split(',');
          const x = parseInt(xStr);
          const z = parseInt(zStr);
          if (x >= 0 && x < this.mapWidth && z >= 0 && z < this.mapHeight) return z * this.mapWidth + x;
          return null;
        };
        for (const [key, mask] of Object.entries(wallsData.walls)) {
          const idx = parseKey(key);
          if (idx !== null) this.walls[idx] = mask;
        }
        if (wallsData.wallHeights) {
          for (const [key, h] of Object.entries(wallsData.wallHeights)) {
            const idx = parseKey(key);
            if (idx !== null) this.wallHeights.set(idx, h);
          }
        }
        if (wallsData.floors) {
          for (const [key, h] of Object.entries(wallsData.floors)) {
            const idx = parseKey(key);
            if (idx !== null) this.floorHeights.set(idx, h);
          }
        }
        if (wallsData.stairs) {
          for (const [key, data] of Object.entries(wallsData.stairs)) {
            const idx = parseKey(key);
            if (idx !== null) this.stairData.set(idx, data);
          }
        }
        if (wallsData.roofs) {
          for (const [key, data] of Object.entries(wallsData.roofs)) {
            const idx = parseKey(key);
            if (idx !== null) this.roofData.set(idx, data);
          }
        }
        // Load floor layers (floors 1+)
        if (wallsData.floorLayers) {
          for (const [floorStr, ld] of Object.entries(wallsData.floorLayers)) {
            const floorIdx = parseInt(floorStr as string);
            const layer: FloorLayerClientData = {
              walls: new Map(),
              wallHeights: new Map(),
              floors: new Map(),
              stairs: new Map(),
              roofs: new Map(),
            };
            const ldd = ld as FloorLayerData;
            if (ldd.walls) for (const [k, v] of Object.entries(ldd.walls)) { const i = parseKey(k); if (i !== null) layer.walls.set(i, v); }
            if (ldd.wallHeights) for (const [k, v] of Object.entries(ldd.wallHeights)) { const i = parseKey(k); if (i !== null) layer.wallHeights.set(i, v); }
            if (ldd.floors) for (const [k, v] of Object.entries(ldd.floors)) { const i = parseKey(k); if (i !== null) layer.floors.set(i, v); }
            if (ldd.stairs) for (const [k, v] of Object.entries(ldd.stairs)) { const i = parseKey(k); if (i !== null) layer.stairs.set(i, v as StairData); }
            if (ldd.roofs) for (const [k, v] of Object.entries(ldd.roofs)) { const i = parseKey(k); if (i !== null) layer.roofs.set(i, v as RoofData); }
            this.floorLayerData.set(floorIdx, layer);
          }
        }
      }
    } catch { /* walls.json doesn't exist yet — no walls */ }

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
    if (!this.roofMat) {
      this.roofMat = new StandardMaterial('chunkRoofMat', this.scene);
      this.roofMat.specularColor = new Color3(0.05, 0.05, 0.05);
      this.roofMat.backFaceCulling = false;
    }
    if (!this.floorMat) {
      this.floorMat = new StandardMaterial('chunkFloorMat', this.scene);
      this.floorMat.specularColor = new Color3(0, 0, 0);
    }
    if (!this.stairMat) {
      this.stairMat = new StandardMaterial('chunkStairMat', this.scene);
      this.stairMat.specularColor = new Color3(0.05, 0.05, 0.05);
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
        meshes.roof?.dispose();
        meshes.floor?.dispose();
        meshes.stairs?.dispose();
        for (const [, floorSet] of meshes.upperFloors) {
          floorSet.wall?.dispose();
          floorSet.roof?.dispose();
          floorSet.floor?.dispose();
          floorSet.stairs?.dispose();
        }
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

    // Ground mesh (always floor 0)
    const ground = this.buildGroundMesh(chunkX, chunkZ, startX, startZ, endX, endZ);
    const water = this.buildWaterMesh(chunkX, chunkZ, startX, startZ, endX, endZ);
    // Floor 0 building meshes
    const wall = this.buildWallMesh(chunkX, chunkZ, startX, startZ, endX, endZ);
    const roof = this.buildRoofMesh(chunkX, chunkZ, startX, startZ, endX, endZ);
    const floor = this.buildFloorMesh(chunkX, chunkZ, startX, startZ, endX, endZ);
    const stairs = this.buildStairMesh(chunkX, chunkZ, startX, startZ, endX, endZ);

    // Upper floor meshes
    const upperFloors = new Map<number, FloorMeshSet>();
    for (const [floorIdx, layerData] of this.floorLayerData) {
      const floorSet = this.buildFloorLayerMeshes(chunkX, chunkZ, startX, startZ, endX, endZ, floorIdx, layerData);
      if (floorSet) {
        upperFloors.set(floorIdx, floorSet);
        // Apply visibility based on current floor
        this.setFloorMeshSetVisibility(floorSet, floorIdx);
      }
    }

    return { ground, water, wall, roof, floor, stairs, upperFloors };
  }

  /** Build wall/floor/stair/roof meshes for an upper floor layer */
  private buildFloorLayerMeshes(
    chunkX: number, chunkZ: number,
    startX: number, startZ: number, endX: number, endZ: number,
    floorIdx: number, layer: FloorLayerClientData
  ): FloorMeshSet | null {
    const wall = this.buildWallMeshForLayer(chunkX, chunkZ, startX, startZ, endX, endZ, floorIdx, layer);
    const roof = this.buildRoofMeshForLayer(chunkX, chunkZ, startX, startZ, endX, endZ, floorIdx, layer);
    const floor = this.buildFloorMeshForLayer(chunkX, chunkZ, startX, startZ, endX, endZ, floorIdx, layer);
    const stairs = this.buildStairMeshForLayer(chunkX, chunkZ, startX, startZ, endX, endZ, floorIdx, layer);
    if (!wall && !roof && !floor && !stairs) return null;
    return { wall, roof, floor, stairs };
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
    if (!this.walls) return null;

    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasWalls = false;

    const WALL_THICKNESS = 0.1; // thin wall
    const cr = 0.35, cg = 0.30, cb = 0.30;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const mask = this.getWallRaw(x, z);
        if (mask === 0) continue;
        hasWalls = true;

        const tileIdx = z * this.mapWidth + x;
        const wallH = this.wallHeights.get(tileIdx) ?? DEFAULT_WALL_HEIGHT;
        const floorH = this.floorHeights.get(tileIdx) ?? 0;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        // North edge (z = z0) — wall from (x0,z0) to (x1,z0)
        if (mask & WallEdge.N) {
          const yL = this.getVertexHeight(x, z) + floorH;
          const yR = this.getVertexHeight(x + 1, z) + floorH;
          const ytL = yL + wallH;
          const ytR = yR + wallH;
          // Front face (facing -Z)
          positions.push(x0, yL, z0, x0, ytL, z0, x1, ytR, z0, x1, yR, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          // Back face (facing +Z)
          const zb = z0 + WALL_THICKNESS;
          positions.push(x1, yR, zb, x1, ytR, zb, x0, ytL, zb, x0, yL, zb);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          // Top face
          positions.push(x0, ytL, z0, x0, ytL, zb, x1, ytR, zb, x1, ytR, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }

        // South edge (z = z1) — wall from (x0,z1) to (x1,z1)
        if (mask & WallEdge.S) {
          const yL = this.getVertexHeight(x, z + 1) + floorH;
          const yR = this.getVertexHeight(x + 1, z + 1) + floorH;
          const ytL = yL + wallH;
          const ytR = yR + wallH;
          const zf = z1 - WALL_THICKNESS;
          // Front face (facing +Z)
          positions.push(x1, yR, z1, x1, ytR, z1, x0, ytL, z1, x0, yL, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          // Back face (facing -Z)
          positions.push(x0, yL, zf, x0, ytL, zf, x1, ytR, zf, x1, yR, zf);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          // Top face
          positions.push(x0, ytL, zf, x0, ytL, z1, x1, ytR, z1, x1, ytR, zf);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }

        // East edge (x = x1) — wall from (x1,z0) to (x1,z1)
        if (mask & WallEdge.E) {
          const yT = this.getVertexHeight(x + 1, z) + floorH;
          const yB = this.getVertexHeight(x + 1, z + 1) + floorH;
          const ytT = yT + wallH;
          const ytB = yB + wallH;
          // Front face (facing +X)
          positions.push(x1, yT, z0, x1, ytT, z0, x1, ytB, z1, x1, yB, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          // Back face (facing -X)
          const xb = x1 - WALL_THICKNESS;
          positions.push(xb, yB, z1, xb, ytB, z1, xb, ytT, z0, xb, yT, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          // Top face
          positions.push(xb, ytT, z0, x1, ytT, z0, x1, ytB, z1, xb, ytB, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }

        // West edge (x = x0) — wall from (x0,z0) to (x0,z1)
        if (mask & WallEdge.W) {
          const yT = this.getVertexHeight(x, z) + floorH;
          const yB = this.getVertexHeight(x, z + 1) + floorH;
          const ytT = yT + wallH;
          const ytB = yB + wallH;
          // Front face (facing -X)
          positions.push(x0, yB, z1, x0, ytB, z1, x0, ytT, z0, x0, yT, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          // Back face (facing +X)
          const xb = x0 + WALL_THICKNESS;
          positions.push(xb, yT, z0, xb, ytT, z0, xb, ytB, z1, xb, yB, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          // Top face
          positions.push(x0, ytT, z0, xb, ytT, z0, xb, ytB, z1, x0, ytB, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
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

  private buildRoofMesh(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasRoof = false;

    const cr = 0.45, cg = 0.25, cb = 0.15; // brown-red roof

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileIdx = z * this.mapWidth + x;
        const roof = this.roofData.get(tileIdx);
        if (!roof) continue;
        hasRoof = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;
        const baseY = roof.height;

        if (roof.style === 'flat') {
          // Flat roof — single quad
          positions.push(x0, baseY, z0, x1, baseY, z0, x1, baseY, z1, x0, baseY, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          // Underside
          positions.push(x0, baseY, z1, x1, baseY, z1, x1, baseY, z0, x0, baseY, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, -1, 0); colors.push(cr - 0.1, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        } else {
          // Peaked roof (NS = ridge runs N-S, EW = ridge runs E-W)
          const peak = baseY + (roof.peakHeight ?? 0.6);
          const mx = (x0 + x1) / 2;
          const mz = (z0 + z1) / 2;

          if (roof.style === 'peaked_ew') {
            // Ridge along E-W (x axis), peak at center z
            // Left slope
            positions.push(x0, baseY, z0, x1, baseY, z0, x1, peak, mz, x0, peak, mz);
            for (let i = 0; i < 4; i++) { normals.push(0, 0.7, -0.7); colors.push(cr, cg, cb, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
            // Right slope
            positions.push(x0, peak, mz, x1, peak, mz, x1, baseY, z1, x0, baseY, z1);
            for (let i = 0; i < 4; i++) { normals.push(0, 0.7, 0.7); colors.push(cr - 0.05, cg - 0.03, cb - 0.03, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
          } else {
            // Ridge along N-S (z axis), peak at center x
            // Left slope
            positions.push(x0, baseY, z0, x0, baseY, z1, mx, peak, z1, mx, peak, z0);
            for (let i = 0; i < 4; i++) { normals.push(-0.7, 0.7, 0); colors.push(cr, cg, cb, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
            // Right slope
            positions.push(mx, peak, z0, mx, peak, z1, x1, baseY, z1, x1, baseY, z0);
            for (let i = 0; i < 4; i++) { normals.push(0.7, 0.7, 0); colors.push(cr - 0.05, cg - 0.03, cb - 0.03, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
          }
        }
      }
    }

    if (!hasRoof) return null;

    const mesh = new Mesh(`roof_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);
    mesh.material = this.roofMat;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = false;
    return mesh;
  }

  private buildFloorMesh(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasFloor = false;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileIdx = z * this.mapWidth + x;
        const floorH = this.floorHeights.get(tileIdx);
        if (floorH === undefined) continue;
        hasFloor = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        const tileType = this.getTileTypeRaw(x, z);
        const baseColor = TILE_COLORS[tileType] || TILE_COLORS[TileType.WOOD];

        // Top face (walkable)
        positions.push(x0, floorH, z0, x1, floorH, z0, x1, floorH, z1, x0, floorH, z1);
        for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(baseColor.r, baseColor.g, baseColor.b, 1); }
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;

        // Bottom face (visible from below)
        positions.push(x0, floorH, z1, x1, floorH, z1, x1, floorH, z0, x0, floorH, z0);
        for (let i = 0; i < 4; i++) { normals.push(0, -1, 0); colors.push(baseColor.r - 0.1, baseColor.g - 0.1, baseColor.b - 0.1, 1); }
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;

        // Edge faces where adjacent tile has no floor at same height
        const edgeColor = { r: baseColor.r - 0.08, g: baseColor.g - 0.08, b: baseColor.b - 0.08 };
        const groundH = (this.getVertexHeight(x, z) + this.getVertexHeight(x + 1, z) + this.getVertexHeight(x, z + 1) + this.getVertexHeight(x + 1, z + 1)) / 4;
        const edgeBottom = groundH;

        // Only add edge if neighbor doesn't have the same floor
        const neighborFloor = (nx: number, nz: number) => this.floorHeights.get(nz * this.mapWidth + nx);

        if (neighborFloor(x, z - 1) !== floorH) { // North edge
          positions.push(x0, edgeBottom, z0, x0, floorH, z0, x1, floorH, z0, x1, edgeBottom, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (neighborFloor(x, z + 1) !== floorH) { // South edge
          positions.push(x1, edgeBottom, z1, x1, floorH, z1, x0, floorH, z1, x0, edgeBottom, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (neighborFloor(x + 1, z) !== floorH) { // East edge
          positions.push(x1, edgeBottom, z0, x1, floorH, z0, x1, floorH, z1, x1, edgeBottom, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (neighborFloor(x - 1, z) !== floorH) { // West edge
          positions.push(x0, edgeBottom, z1, x0, floorH, z1, x0, floorH, z0, x0, edgeBottom, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
      }
    }

    if (!hasFloor) return null;

    const mesh = new Mesh(`floor_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);
    mesh.material = this.floorMat;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = true; // walkable surface
    return mesh;
  }

  private buildStairMesh(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasStairs = false;

    const STEPS = 4; // number of steps per tile
    const cr = 0.50, cg = 0.48, cb = 0.45; // light stone color

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileIdx = z * this.mapWidth + x;
        const stair = this.stairData.get(tileIdx);
        if (!stair) continue;
        hasStairs = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;
        const heightDiff = stair.topHeight - stair.baseHeight;
        const stepH = heightDiff / STEPS;

        for (let s = 0; s < STEPS; s++) {
          const t0 = s / STEPS;
          const t1 = (s + 1) / STEPS;
          const y0 = stair.baseHeight + s * stepH;
          const y1 = stair.baseHeight + (s + 1) * stepH;

          let sx0: number, sx1: number, sz0: number, sz1: number;
          let faceNormal: [number, number, number];

          switch (stair.direction) {
            case 'N': // going up = -Z
              sx0 = x0; sx1 = x1;
              sz0 = z1 - t1 * (z1 - z0); sz1 = z1 - t0 * (z1 - z0);
              faceNormal = [0, 0, 1];
              break;
            case 'S': // going up = +Z
              sx0 = x0; sx1 = x1;
              sz0 = z0 + t0 * (z1 - z0); sz1 = z0 + t1 * (z1 - z0);
              faceNormal = [0, 0, -1];
              break;
            case 'E': // going up = +X
              sz0 = z0; sz1 = z1;
              sx0 = x0 + t0 * (x1 - x0); sx1 = x0 + t1 * (x1 - x0);
              faceNormal = [-1, 0, 0];
              break;
            case 'W': // going up = -X
              sz0 = z0; sz1 = z1;
              sx0 = x1 - t1 * (x1 - x0); sx1 = x1 - t0 * (x1 - x0);
              faceNormal = [1, 0, 0];
              break;
          }

          // Step top face
          positions.push(sx0, y1, sz0, sx1, y1, sz0, sx1, y1, sz1, sx0, y1, sz1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;

          // Step front face (riser)
          if (stair.direction === 'N' || stair.direction === 'S') {
            const fz = stair.direction === 'N' ? sz1 : sz0;
            positions.push(sx0, y0, fz, sx0, y1, fz, sx1, y1, fz, sx1, y0, fz);
          } else {
            const fx = stair.direction === 'W' ? sx1 : sx0;
            positions.push(fx, y0, sz0, fx, y1, sz0, fx, y1, sz1, fx, y0, sz1);
          }
          for (let i = 0; i < 4; i++) { normals.push(faceNormal[0], faceNormal[1], faceNormal[2]); colors.push(cr - 0.08, cg - 0.08, cb - 0.08, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
      }
    }

    if (!hasStairs) return null;

    const mesh = new Mesh(`stairs_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);
    mesh.material = this.stairMat;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = true; // walkable
    return mesh;
  }

  // --- Upper floor layer mesh builders ---

  private buildWallMeshForLayer(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number, floorIdx: number, layer: FloorLayerClientData): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasWalls = false;
    const WALL_THICKNESS = 0.1;
    const cr = 0.35, cg = 0.30, cb = 0.30;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileIdx = z * this.mapWidth + x;
        const mask = layer.walls.get(tileIdx) ?? 0;
        if (mask === 0) continue;
        hasWalls = true;

        const wallH = layer.wallHeights.get(tileIdx) ?? DEFAULT_WALL_HEIGHT;
        const floorH = layer.floors.get(tileIdx) ?? 0;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        // Use floor height as base for upper floor walls
        const baseY = floorH;

        if (mask & WallEdge.N) {
          const yL = baseY, yR = baseY, ytL = baseY + wallH, ytR = baseY + wallH;
          positions.push(x0, yL, z0, x0, ytL, z0, x1, ytR, z0, x1, yR, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          const zb = z0 + WALL_THICKNESS;
          positions.push(x1, yR, zb, x1, ytR, zb, x0, ytL, zb, x0, yL, zb);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          positions.push(x0, ytL, z0, x0, ytL, zb, x1, ytR, zb, x1, ytR, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (mask & WallEdge.S) {
          const yL = baseY, yR = baseY, ytL = baseY + wallH, ytR = baseY + wallH;
          const zf = z1 - WALL_THICKNESS;
          positions.push(x1, yR, z1, x1, ytR, z1, x0, ytL, z1, x0, yL, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          positions.push(x0, yL, zf, x0, ytL, zf, x1, ytR, zf, x1, yR, zf);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          positions.push(x0, ytL, zf, x0, ytL, z1, x1, ytR, z1, x1, ytR, zf);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (mask & WallEdge.E) {
          const yT = baseY, yB = baseY, ytT = baseY + wallH, ytB = baseY + wallH;
          positions.push(x1, yT, z0, x1, ytT, z0, x1, ytB, z1, x1, yB, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          const xb = x1 - WALL_THICKNESS;
          positions.push(xb, yB, z1, xb, ytB, z1, xb, ytT, z0, xb, yT, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          positions.push(xb, ytT, z0, x1, ytT, z0, x1, ytB, z1, xb, ytB, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (mask & WallEdge.W) {
          const yT = baseY, yB = baseY, ytT = baseY + wallH, ytB = baseY + wallH;
          positions.push(x0, yB, z1, x0, ytB, z1, x0, ytT, z0, x0, yT, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          const xb = x0 + WALL_THICKNESS;
          positions.push(xb, yT, z0, xb, ytT, z0, xb, ytB, z1, xb, yB, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          positions.push(x0, ytT, z0, xb, ytT, z0, xb, ytB, z1, x0, ytB, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
      }
    }
    if (!hasWalls) return null;
    const mesh = new Mesh(`wall_f${floorIdx}_${chunkX}_${chunkZ}`, this.scene);
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

  private buildFloorMeshForLayer(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number, floorIdx: number, layer: FloorLayerClientData): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasFloor = false;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileIdx = z * this.mapWidth + x;
        const floorH = layer.floors.get(tileIdx);
        if (floorH === undefined) continue;
        hasFloor = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;
        const baseColor = TILE_COLORS[TileType.WOOD];

        // Top face
        positions.push(x0, floorH, z0, x1, floorH, z0, x1, floorH, z1, x0, floorH, z1);
        for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(baseColor.r, baseColor.g, baseColor.b, 1); }
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;
        // Bottom face
        positions.push(x0, floorH, z1, x1, floorH, z1, x1, floorH, z0, x0, floorH, z0);
        for (let i = 0; i < 4; i++) { normals.push(0, -1, 0); colors.push(baseColor.r - 0.1, baseColor.g - 0.1, baseColor.b - 0.1, 1); }
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;

        // Edge faces
        const edgeColor = { r: baseColor.r - 0.08, g: baseColor.g - 0.08, b: baseColor.b - 0.08 };
        const edgeBottom = floorH - 0.5; // small edge height for upper floors
        const neighborFloor = (nx: number, nz: number) => layer.floors.get(nz * this.mapWidth + nx);

        if (neighborFloor(x, z - 1) !== floorH) {
          positions.push(x0, edgeBottom, z0, x0, floorH, z0, x1, floorH, z0, x1, edgeBottom, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (neighborFloor(x, z + 1) !== floorH) {
          positions.push(x1, edgeBottom, z1, x1, floorH, z1, x0, floorH, z1, x0, edgeBottom, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (neighborFloor(x + 1, z) !== floorH) {
          positions.push(x1, edgeBottom, z0, x1, floorH, z0, x1, floorH, z1, x1, edgeBottom, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
        if (neighborFloor(x - 1, z) !== floorH) {
          positions.push(x0, edgeBottom, z1, x0, floorH, z1, x0, floorH, z0, x0, edgeBottom, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
      }
    }
    if (!hasFloor) return null;
    const mesh = new Mesh(`floor_f${floorIdx}_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);
    mesh.material = this.floorMat;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = true;
    return mesh;
  }

  private buildStairMeshForLayer(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number, floorIdx: number, layer: FloorLayerClientData): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasStairs = false;
    const STEPS = 4;
    const cr = 0.50, cg = 0.48, cb = 0.45;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileIdx = z * this.mapWidth + x;
        const stair = layer.stairs.get(tileIdx);
        if (!stair) continue;
        hasStairs = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;
        const heightDiff = stair.topHeight - stair.baseHeight;
        const stepH = heightDiff / STEPS;

        for (let s = 0; s < STEPS; s++) {
          const t0 = s / STEPS;
          const t1 = (s + 1) / STEPS;
          const y0 = stair.baseHeight + s * stepH;
          const y1 = stair.baseHeight + (s + 1) * stepH;
          let sx0: number, sx1: number, sz0: number, sz1: number;
          let faceNormal: [number, number, number];
          switch (stair.direction) {
            case 'N': sx0 = x0; sx1 = x1; sz0 = z1 - t1 * (z1 - z0); sz1 = z1 - t0 * (z1 - z0); faceNormal = [0, 0, 1]; break;
            case 'S': sx0 = x0; sx1 = x1; sz0 = z0 + t0 * (z1 - z0); sz1 = z0 + t1 * (z1 - z0); faceNormal = [0, 0, -1]; break;
            case 'E': sz0 = z0; sz1 = z1; sx0 = x0 + t0 * (x1 - x0); sx1 = x0 + t1 * (x1 - x0); faceNormal = [-1, 0, 0]; break;
            case 'W': sz0 = z0; sz1 = z1; sx0 = x1 - t1 * (x1 - x0); sx1 = x1 - t0 * (x1 - x0); faceNormal = [1, 0, 0]; break;
          }
          // Step top
          positions.push(sx0!, y1, sz0!, sx1!, y1, sz0!, sx1!, y1, sz1!, sx0!, y1, sz1!);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          // Step riser
          if (stair.direction === 'N' || stair.direction === 'S') {
            const fz = stair.direction === 'N' ? sz1! : sz0!;
            positions.push(sx0!, y0, fz, sx0!, y1, fz, sx1!, y1, fz, sx1!, y0, fz);
          } else {
            const fx = stair.direction === 'W' ? sx1! : sx0!;
            positions.push(fx, y0, sz0!, fx, y1, sz0!, fx, y1, sz1!, fx, y0, sz1!);
          }
          for (let i = 0; i < 4; i++) { normals.push(faceNormal![0], faceNormal![1], faceNormal![2]); colors.push(cr - 0.08, cg - 0.08, cb - 0.08, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
      }
    }
    if (!hasStairs) return null;
    const mesh = new Mesh(`stairs_f${floorIdx}_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);
    mesh.material = this.stairMat;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = true;
    return mesh;
  }

  private buildRoofMeshForLayer(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number, floorIdx: number, layer: FloorLayerClientData): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasRoof = false;
    const cr = 0.45, cg = 0.25, cb = 0.15;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileIdx = z * this.mapWidth + x;
        const roof = layer.roofs.get(tileIdx);
        if (!roof) continue;
        hasRoof = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;
        const baseY = roof.height;

        if (roof.style === 'flat') {
          positions.push(x0, baseY, z0, x1, baseY, z0, x1, baseY, z1, x0, baseY, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
          positions.push(x0, baseY, z1, x1, baseY, z1, x1, baseY, z0, x0, baseY, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, -1, 0); colors.push(cr - 0.1, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        } else {
          const peak = baseY + (roof.peakHeight ?? 0.6);
          const mx = (x0 + x1) / 2;
          const mz = (z0 + z1) / 2;
          if (roof.style === 'peaked_ew') {
            positions.push(x0, baseY, z0, x1, baseY, z0, x1, peak, mz, x0, peak, mz);
            for (let i = 0; i < 4; i++) { normals.push(0, 0.7, -0.7); colors.push(cr, cg, cb, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
            positions.push(x0, peak, mz, x1, peak, mz, x1, baseY, z1, x0, baseY, z1);
            for (let i = 0; i < 4; i++) { normals.push(0, 0.7, 0.7); colors.push(cr - 0.05, cg - 0.03, cb - 0.03, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
          } else {
            positions.push(x0, baseY, z0, x0, baseY, z1, mx, peak, z1, mx, peak, z0);
            for (let i = 0; i < 4; i++) { normals.push(-0.7, 0.7, 0); colors.push(cr, cg, cb, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
            positions.push(mx, peak, z0, mx, peak, z1, x1, baseY, z1, x1, baseY, z0);
            for (let i = 0; i < 4; i++) { normals.push(0.7, 0.7, 0); colors.push(cr - 0.05, cg - 0.03, cb - 0.03, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
          }
        }
      }
    }
    if (!hasRoof) return null;
    const mesh = new Mesh(`roof_f${floorIdx}_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);
    mesh.material = this.roofMat;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = false;
    return mesh;
  }

  /** Set visibility of a floor mesh set based on current floor */
  private setFloorMeshSetVisibility(set: FloorMeshSet, floorIdx: number): void {
    const visible = floorIdx <= this.currentFloor;
    if (set.wall) set.wall.setEnabled(visible);
    if (set.roof) set.roof.setEnabled(floorIdx > this.currentFloor); // roofs only visible when above current floor
    if (set.floor) set.floor.setEnabled(visible);
    if (set.stairs) set.stairs.setEnabled(visible);
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

  /** Get effective walking height, accounting for floors, stairs, and current floor */
  getEffectiveHeight(x: number, z: number, floor?: number): number {
    const activeFloor = floor ?? this.currentFloor;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= this.mapWidth || tz < 0 || tz >= this.mapHeight) return 0;
    const tileIdx = tz * this.mapWidth + tx;

    if (activeFloor === 0) {
      // Check stairs first
      const stair = this.stairData.get(tileIdx);
      if (stair) {
        const fx = x - tx;
        const fz = z - tz;
        let t: number;
        switch (stair.direction) {
          case 'N': t = 1 - fz; break;
          case 'S': t = fz; break;
          case 'E': t = fx; break;
          case 'W': t = 1 - fx; break;
        }
        return stair.baseHeight + t * (stair.topHeight - stair.baseHeight);
      }
      // Check elevated floor
      const floorH = this.floorHeights.get(tileIdx);
      if (floorH !== undefined) return floorH;
      // Default terrain
      return this.getInterpolatedHeight(x, z);
    }

    // Upper floor
    const layer = this.floorLayerData.get(activeFloor);
    if (layer) {
      const stair = layer.stairs.get(tileIdx);
      if (stair) {
        const fx = x - tx;
        const fz = z - tz;
        let t: number;
        switch (stair.direction) {
          case 'N': t = 1 - fz; break;
          case 'S': t = fz; break;
          case 'E': t = fx; break;
          case 'W': t = 1 - fx; break;
        }
        return stair.baseHeight + t * (stair.topHeight - stair.baseHeight);
      }
      const floorH = layer.floors.get(tileIdx);
      if (floorH !== undefined) return floorH;
    }

    return this.getInterpolatedHeight(x, z);
  }

  getFloorHeight(x: number, z: number): number | undefined {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= this.mapWidth || tz < 0 || tz >= this.mapHeight) return undefined;
    return this.floorHeights.get(tz * this.mapWidth + tx);
  }

  getStairAt(x: number, z: number): StairData | undefined {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= this.mapWidth || tz < 0 || tz >= this.mapHeight) return undefined;
    return this.stairData.get(tz * this.mapWidth + tx);
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

  private getWallRaw(x: number, z: number): number {
    if (!this.walls) return 0;
    if (x < 0 || x >= this.mapWidth || z < 0 || z >= this.mapHeight) return 0;
    return this.walls[z * this.mapWidth + x];
  }

  /** Check if tile is blocked on the current floor */
  isBlockedOnFloor(x: number, z: number, floor: number): boolean {
    if (floor === 0) return this.isBlocked(x, z);
    const layer = this.floorLayerData.get(floor);
    if (!layer) return true;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= this.mapWidth || tz < 0 || tz >= this.mapHeight) return true;
    const idx = tz * this.mapWidth + tx;
    return !layer.floors.has(idx) && !layer.stairs.has(idx);
  }

  /** Check wall blocking on a specific floor */
  isWallBlockedOnFloor(fromX: number, fromZ: number, toX: number, toZ: number, floor: number): boolean {
    if (floor === 0) return this.isWallBlocked(fromX, fromZ, toX, toZ);
    const layer = this.floorLayerData.get(floor);
    if (!layer) return false;
    const fx = Math.floor(fromX);
    const fz = Math.floor(fromZ);
    const tx = Math.floor(toX);
    const tz = Math.floor(toZ);
    const dx = tx - fx;
    const dz = tz - fz;
    const getW = (x: number, z: number) => layer.walls.get(z * this.mapWidth + x) ?? 0;

    if (dx === 0 && dz === -1) return (getW(fx, fz) & WallEdge.N) !== 0;
    if (dx === 1 && dz === 0) return (getW(fx, fz) & WallEdge.E) !== 0;
    if (dx === 0 && dz === 1) return (getW(fx, fz) & WallEdge.S) !== 0;
    if (dx === -1 && dz === 0) return (getW(fx, fz) & WallEdge.W) !== 0;
    if (dx === 1 && dz === -1) return (getW(fx, fz) & WallEdge.N) !== 0 || (getW(fx, fz) & WallEdge.E) !== 0 || (getW(tx, tz) & WallEdge.S) !== 0 || (getW(tx, tz) & WallEdge.W) !== 0;
    if (dx === -1 && dz === -1) return (getW(fx, fz) & WallEdge.N) !== 0 || (getW(fx, fz) & WallEdge.W) !== 0 || (getW(tx, tz) & WallEdge.S) !== 0 || (getW(tx, tz) & WallEdge.E) !== 0;
    if (dx === 1 && dz === 1) return (getW(fx, fz) & WallEdge.S) !== 0 || (getW(fx, fz) & WallEdge.E) !== 0 || (getW(tx, tz) & WallEdge.N) !== 0 || (getW(tx, tz) & WallEdge.W) !== 0;
    if (dx === -1 && dz === 1) return (getW(fx, fz) & WallEdge.S) !== 0 || (getW(fx, fz) & WallEdge.W) !== 0 || (getW(tx, tz) & WallEdge.N) !== 0 || (getW(tx, tz) & WallEdge.E) !== 0;
    return false;
  }

  isWallBlocked(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const fx = Math.floor(fromX);
    const fz = Math.floor(fromZ);
    const tx = Math.floor(toX);
    const tz = Math.floor(toZ);
    const dx = tx - fx;
    const dz = tz - fz;

    if (dx === 0 && dz === -1) return (this.getWallRaw(fx, fz) & WallEdge.N) !== 0;
    if (dx === 1 && dz === 0) return (this.getWallRaw(fx, fz) & WallEdge.E) !== 0;
    if (dx === 0 && dz === 1) return (this.getWallRaw(fx, fz) & WallEdge.S) !== 0;
    if (dx === -1 && dz === 0) return (this.getWallRaw(fx, fz) & WallEdge.W) !== 0;

    // Diagonal
    if (dx === 1 && dz === -1) {
      return (this.getWallRaw(fx, fz) & WallEdge.N) !== 0 || (this.getWallRaw(fx, fz) & WallEdge.E) !== 0
          || (this.getWallRaw(tx, tz) & WallEdge.S) !== 0 || (this.getWallRaw(tx, tz) & WallEdge.W) !== 0;
    }
    if (dx === -1 && dz === -1) {
      return (this.getWallRaw(fx, fz) & WallEdge.N) !== 0 || (this.getWallRaw(fx, fz) & WallEdge.W) !== 0
          || (this.getWallRaw(tx, tz) & WallEdge.S) !== 0 || (this.getWallRaw(tx, tz) & WallEdge.E) !== 0;
    }
    if (dx === 1 && dz === 1) {
      return (this.getWallRaw(fx, fz) & WallEdge.S) !== 0 || (this.getWallRaw(fx, fz) & WallEdge.E) !== 0
          || (this.getWallRaw(tx, tz) & WallEdge.N) !== 0 || (this.getWallRaw(tx, tz) & WallEdge.W) !== 0;
    }
    if (dx === -1 && dz === 1) {
      return (this.getWallRaw(fx, fz) & WallEdge.S) !== 0 || (this.getWallRaw(fx, fz) & WallEdge.W) !== 0
          || (this.getWallRaw(tx, tz) & WallEdge.N) !== 0 || (this.getWallRaw(tx, tz) & WallEdge.E) !== 0;
    }

    return false;
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

  /** Set the active floor for multi-floor rendering */
  setCurrentFloor(floor: number): void {
    if (floor === this.currentFloor) return;
    this.currentFloor = floor;
    console.log(`[ChunkManager] Current floor set to ${floor}`);

    // Update visibility of floor 0 building meshes
    // Floor 0 roofs: only visible when player is on floor 0 or below
    for (const [, chunk] of this.chunks) {
      if (chunk.roof) chunk.roof.setEnabled(floor === 0);
      // Upper floor meshes
      for (const [floorIdx, meshSet] of chunk.upperFloors) {
        this.setFloorMeshSetVisibility(meshSet, floorIdx);
      }
    }
  }

  getCurrentFloor(): number {
    return this.currentFloor;
  }

  disposeAll(): void {
    for (const [, meshes] of this.chunks) {
      meshes.ground.dispose();
      meshes.water?.dispose();
      meshes.wall?.dispose();
      meshes.roof?.dispose();
      meshes.floor?.dispose();
      meshes.stairs?.dispose();
      for (const [, floorSet] of meshes.upperFloors) {
        floorSet.wall?.dispose();
        floorSet.roof?.dispose();
        floorSet.floor?.dispose();
        floorSet.stairs?.dispose();
      }
    }
    this.chunks.clear();
    this.heights = null;
    this.tiles = null;
    this.walls = null;
    this.wallHeights.clear();
    this.floorHeights.clear();
    this.stairData.clear();
    this.roofData.clear();
    this.floorLayerData.clear();
    this.currentFloor = 0;
    this.loaded = false;
    this.lastChunkX = -999;
    this.lastChunkZ = -999;
  }
}
