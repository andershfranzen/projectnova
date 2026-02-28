import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CHUNK_SIZE, TILE_SIZE, TileType, WallEdge, DEFAULT_WALL_HEIGHT } from '@projectrs/shared';
import type { StairData, RoofData } from '@projectrs/shared';
import type { EditorState, FloorLayer } from '../state/EditorState';

const EDITOR_CHUNK_LOAD_RADIUS = 3; // 7x7 grid = 49 chunks

const TILE_COLORS: Record<number, Color4> = {
  [TileType.GRASS]: new Color4(0.30, 0.55, 0.20, 1),
  [TileType.DIRT]:  new Color4(0.55, 0.40, 0.25, 1),
  [TileType.STONE]: new Color4(0.50, 0.50, 0.50, 1),
  [TileType.WATER]: new Color4(0.20, 0.35, 0.70, 1),
  [TileType.WALL]:  new Color4(0.35, 0.30, 0.30, 1),
  [TileType.SAND]:  new Color4(0.76, 0.70, 0.50, 1),
  [TileType.WOOD]:  new Color4(0.45, 0.32, 0.18, 1),
};

interface ChunkMeshes {
  ground: Mesh;
  water: Mesh | null;
  wall: Mesh | null;
  roof: Mesh | null;
  floor: Mesh | null;
  stairs: Mesh | null;
  upperFloors: Map<number, FloorMeshSet>;
}

interface FloorMeshSet {
  wall: Mesh | null;
  roof: Mesh | null;
  floor: Mesh | null;
  stairs: Mesh | null;
}

export interface EditorMapData {
  mapWidth: number;
  mapHeight: number;
  heights: Float32Array;
  tiles: Uint8Array;
  walls: Uint8Array;
  wallHeights: Map<number, number>;
  floorHeights: Map<number, number>;
  stairData: Map<number, StairData>;
  roofData: Map<number, RoofData>;
  floorLayers: Map<number, FloorLayer>;
  waterLevel: number;
}

/** Convert editor state's Uint8Array heights (0-255 pixels) to Float32Array world heights */
export function convertEditorState(state: EditorState): EditorMapData {
  const [minH, maxH] = state.meta.heightRange;
  const range = maxH - minH;
  const vw = state.meta.width + 1;
  const vh = state.meta.height + 1;
  const heights = new Float32Array(vw * vh);
  for (let i = 0; i < vw * vh; i++) {
    heights[i] = (state.heights[i] / 255) * range + minH;
  }

  return {
    mapWidth: state.meta.width,
    mapHeight: state.meta.height,
    heights,
    tiles: state.tiles,
    walls: state.walls,
    wallHeights: state.wallHeights,
    floorHeights: state.floors,
    stairData: state.stairs,
    roofData: state.roofs,
    floorLayers: state.floorLayers,
    waterLevel: state.meta.waterLevel,
  };
}

export class EditorChunkManager {
  private scene: Scene;
  private data: EditorMapData | null = null;
  private chunks: Map<string, ChunkMeshes> = new Map();
  private dirtyChunks: Set<string> = new Set();
  private lastCamCX = -999;
  private lastCamCZ = -999;

  private groundMat!: StandardMaterial;
  private waterMat!: StandardMaterial;
  private wallMat!: StandardMaterial;
  private roofMat!: StandardMaterial;
  private floorMat!: StandardMaterial;
  private stairMat!: StandardMaterial;

  constructor(scene: Scene) {
    this.scene = scene;
    this.createMaterials();
  }

  private createMaterials(): void {
    this.groundMat = new StandardMaterial('edGroundMat', this.scene);
    this.groundMat.specularColor = new Color3(0, 0, 0);

    this.waterMat = new StandardMaterial('edWaterMat', this.scene);
    this.waterMat.specularColor = new Color3(0.3, 0.3, 0.4);
    this.waterMat.alpha = 0.6;

    this.wallMat = new StandardMaterial('edWallMat', this.scene);
    this.wallMat.specularColor = new Color3(0.05, 0.05, 0.05);
    this.wallMat.backFaceCulling = false;

    this.roofMat = new StandardMaterial('edRoofMat', this.scene);
    this.roofMat.specularColor = new Color3(0.05, 0.05, 0.05);
    this.roofMat.backFaceCulling = false;

    this.floorMat = new StandardMaterial('edFloorMat', this.scene);
    this.floorMat.specularColor = new Color3(0, 0, 0);

    this.stairMat = new StandardMaterial('edStairMat', this.scene);
    this.stairMat.specularColor = new Color3(0.05, 0.05, 0.05);
  }

  setMapData(data: EditorMapData): void {
    this.disposeAll();
    this.data = data;
    this.lastCamCX = -999;
    this.lastCamCZ = -999;
  }

  markTileDirty(tileX: number, tileZ: number): void {
    const cx = Math.floor(tileX / CHUNK_SIZE);
    const cz = Math.floor(tileZ / CHUNK_SIZE);
    this.dirtyChunks.add(`${cx},${cz}`);
    // Mark neighbor chunks if tile is on an edge
    const lx = tileX % CHUNK_SIZE;
    const lz = tileZ % CHUNK_SIZE;
    if (lx === 0) this.dirtyChunks.add(`${cx - 1},${cz}`);
    if (lx === CHUNK_SIZE - 1) this.dirtyChunks.add(`${cx + 1},${cz}`);
    if (lz === 0) this.dirtyChunks.add(`${cx},${cz - 1}`);
    if (lz === CHUNK_SIZE - 1) this.dirtyChunks.add(`${cx},${cz + 1}`);
  }

  rebuildDirtyChunks(): void {
    let rebuilt = 0;
    for (const key of this.dirtyChunks) {
      if (rebuilt >= 4) break;
      if (this.chunks.has(key)) {
        this.disposeChunk(key);
        const [cx, cz] = key.split(',').map(Number);
        this.chunks.set(key, this.buildChunkMeshes(cx, cz));
        this.dirtyChunks.delete(key);
        rebuilt++;
      } else {
        this.dirtyChunks.delete(key);
      }
    }
  }

  updateCameraPosition(camX: number, camZ: number): void {
    if (!this.data) return;

    const cx = Math.floor(camX / CHUNK_SIZE);
    const cz = Math.floor(camZ / CHUNK_SIZE);

    if (cx === this.lastCamCX && cz === this.lastCamCZ) return;
    this.lastCamCX = cx;
    this.lastCamCZ = cz;

    const desired = new Set<string>();
    const maxCX = Math.ceil(this.data.mapWidth / CHUNK_SIZE);
    const maxCZ = Math.ceil(this.data.mapHeight / CHUNK_SIZE);
    for (let dx = -EDITOR_CHUNK_LOAD_RADIUS; dx <= EDITOR_CHUNK_LOAD_RADIUS; dx++) {
      for (let dz = -EDITOR_CHUNK_LOAD_RADIUS; dz <= EDITOR_CHUNK_LOAD_RADIUS; dz++) {
        const chunkX = cx + dx;
        const chunkZ = cz + dz;
        if (chunkX >= 0 && chunkX < maxCX && chunkZ >= 0 && chunkZ < maxCZ) {
          desired.add(`${chunkX},${chunkZ}`);
        }
      }
    }

    // Dispose chunks no longer needed
    for (const key of this.chunks.keys()) {
      if (!desired.has(key)) {
        this.disposeChunk(key);
        this.chunks.delete(key);
      }
    }

    // Build new chunks
    for (const key of desired) {
      if (!this.chunks.has(key)) {
        const [chunkX, chunkZ] = key.split(',').map(Number);
        this.chunks.set(key, this.buildChunkMeshes(chunkX, chunkZ));
      }
    }
  }

  disposeAll(): void {
    for (const key of this.chunks.keys()) {
      this.disposeChunk(key);
    }
    this.chunks.clear();
    this.dirtyChunks.clear();
  }

  private disposeChunk(key: string): void {
    const meshes = this.chunks.get(key);
    if (!meshes) return;
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

  // --- Mesh builders ---

  private buildChunkMeshes(chunkX: number, chunkZ: number): ChunkMeshes {
    const d = this.data!;
    const startX = chunkX * CHUNK_SIZE;
    const startZ = chunkZ * CHUNK_SIZE;
    const endX = Math.min(startX + CHUNK_SIZE, d.mapWidth);
    const endZ = Math.min(startZ + CHUNK_SIZE, d.mapHeight);

    const ground = this.buildGroundMesh(chunkX, chunkZ, startX, startZ, endX, endZ);
    const water = this.buildWaterMesh(chunkX, chunkZ, startX, startZ, endX, endZ);
    const wall = this.buildWallMesh(chunkX, chunkZ, startX, startZ, endX, endZ, d.walls, d.wallHeights, d.floorHeights);
    const roof = this.buildRoofMesh(chunkX, chunkZ, startX, startZ, endX, endZ, d.roofData);
    const floor = this.buildFloorMesh(chunkX, chunkZ, startX, startZ, endX, endZ, d.floorHeights);
    const stairs = this.buildStairMesh(chunkX, chunkZ, startX, startZ, endX, endZ, d.stairData);

    const upperFloors = new Map<number, FloorMeshSet>();
    for (const [floorIdx, layer] of d.floorLayers) {
      const floorSet = this.buildFloorLayerMeshes(chunkX, chunkZ, startX, startZ, endX, endZ, floorIdx, layer);
      if (floorSet) upperFloors.set(floorIdx, floorSet);
    }

    return { ground, water, wall, roof, floor, stairs, upperFloors };
  }

  private buildFloorLayerMeshes(
    chunkX: number, chunkZ: number,
    startX: number, startZ: number, endX: number, endZ: number,
    floorIdx: number, layer: FloorLayer
  ): FloorMeshSet | null {
    const wall = this.buildWallMeshForLayer(chunkX, chunkZ, startX, startZ, endX, endZ, floorIdx, layer);
    const roof = this.buildRoofMesh(chunkX, chunkZ, startX, startZ, endX, endZ, layer.roofs, `_f${floorIdx}`);
    const floor = this.buildFloorMeshForLayer(chunkX, chunkZ, startX, startZ, endX, endZ, floorIdx, layer);
    const stairs = this.buildStairMesh(chunkX, chunkZ, startX, startZ, endX, endZ, layer.stairs, `_f${floorIdx}`);
    if (!wall && !roof && !floor && !stairs) return null;
    return { wall, roof, floor, stairs };
  }

  private getVertexHeight(vx: number, vz: number): number {
    const d = this.data!;
    const vw = d.mapWidth + 1;
    if (vx < 0 || vx >= vw || vz < 0 || vz >= d.mapHeight + 1) return 0;
    return d.heights[vz * vw + vx];
  }

  private getTileType(x: number, z: number): TileType {
    const d = this.data!;
    if (x < 0 || x >= d.mapWidth || z < 0 || z >= d.mapHeight) return TileType.WALL;
    return d.tiles[z * d.mapWidth + x] as TileType;
  }

  // --- Ground ---

  private buildGroundMesh(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number): Mesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileType = this.getTileType(x, z);
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

  // --- Water ---

  private buildWaterMesh(chunkX: number, chunkZ: number, startX: number, startZ: number, endX: number, endZ: number): Mesh | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasWater = false;
    const waterLevel = this.data!.waterLevel;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        if (this.getTileType(x, z) !== TileType.WATER) continue;
        hasWater = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        positions.push(x0, waterLevel, z0, x1, waterLevel, z0, x1, waterLevel, z1, x0, waterLevel, z1);
        for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(0.2, 0.35, 0.7, 0.6); }
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
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

  // --- Walls (floor 0) ---

  private buildWallMesh(
    chunkX: number, chunkZ: number,
    startX: number, startZ: number, endX: number, endZ: number,
    wallData: Uint8Array, wallHeights: Map<number, number>, floorHeights: Map<number, number>,
    suffix = ''
  ): Mesh | null {
    const d = this.data!;
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
        const tileIdx = z * d.mapWidth + x;
        const mask = wallData[tileIdx] ?? 0;
        if (mask === 0) continue;
        hasWalls = true;

        const wallH = wallHeights.get(tileIdx) ?? DEFAULT_WALL_HEIGHT;
        const floorH = floorHeights.get(tileIdx) ?? 0;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        if (mask & WallEdge.N) {
          const yL = this.getVertexHeight(x, z) + floorH;
          const yR = this.getVertexHeight(x + 1, z) + floorH;
          const ytL = yL + wallH, ytR = yR + wallH;
          positions.push(x0, yL, z0, x0, ytL, z0, x1, ytR, z0, x1, yR, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          const zb = z0 + WALL_THICKNESS;
          positions.push(x1, yR, zb, x1, ytR, zb, x0, ytL, zb, x0, yL, zb);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(x0, ytL, z0, x0, ytL, zb, x1, ytR, zb, x1, ytR, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }

        if (mask & WallEdge.S) {
          const yL = this.getVertexHeight(x, z + 1) + floorH;
          const yR = this.getVertexHeight(x + 1, z + 1) + floorH;
          const ytL = yL + wallH, ytR = yR + wallH;
          const zf = z1 - WALL_THICKNESS;
          positions.push(x1, yR, z1, x1, ytR, z1, x0, ytL, z1, x0, yL, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(x0, yL, zf, x0, ytL, zf, x1, ytR, zf, x1, yR, zf);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(x0, ytL, zf, x0, ytL, z1, x1, ytR, z1, x1, ytR, zf);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }

        if (mask & WallEdge.E) {
          const yT = this.getVertexHeight(x + 1, z) + floorH;
          const yB = this.getVertexHeight(x + 1, z + 1) + floorH;
          const ytT = yT + wallH, ytB = yB + wallH;
          positions.push(x1, yT, z0, x1, ytT, z0, x1, ytB, z1, x1, yB, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          const xb = x1 - WALL_THICKNESS;
          positions.push(xb, yB, z1, xb, ytB, z1, xb, ytT, z0, xb, yT, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(xb, ytT, z0, x1, ytT, z0, x1, ytB, z1, xb, ytB, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }

        if (mask & WallEdge.W) {
          const yT = this.getVertexHeight(x, z) + floorH;
          const yB = this.getVertexHeight(x, z + 1) + floorH;
          const ytT = yT + wallH, ytB = yB + wallH;
          positions.push(x0, yB, z1, x0, ytB, z1, x0, ytT, z0, x0, yT, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          const xb = x0 + WALL_THICKNESS;
          positions.push(xb, yT, z0, xb, ytT, z0, xb, ytB, z1, xb, yB, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(x0, ytT, z0, xb, ytT, z0, xb, ytB, z1, x0, ytB, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
      }
    }

    if (!hasWalls) return null;
    const mesh = new Mesh(`wall${suffix}_${chunkX}_${chunkZ}`, this.scene);
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

  // --- Walls for upper floor layers ---

  private buildWallMeshForLayer(
    chunkX: number, chunkZ: number,
    startX: number, startZ: number, endX: number, endZ: number,
    floorIdx: number, layer: FloorLayer
  ): Mesh | null {
    const d = this.data!;
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
        const tileIdx = z * d.mapWidth + x;
        const mask = layer.walls.get(tileIdx) ?? 0;
        if (mask === 0) continue;
        hasWalls = true;

        const wallH = layer.wallHeights.get(tileIdx) ?? DEFAULT_WALL_HEIGHT;
        const floorH = layer.floors.get(tileIdx) ?? 0;
        const baseY = floorH;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        if (mask & WallEdge.N) {
          const yL = baseY, yR = baseY, ytL = baseY + wallH, ytR = baseY + wallH;
          positions.push(x0, yL, z0, x0, ytL, z0, x1, ytR, z0, x1, yR, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          const zb = z0 + WALL_THICKNESS;
          positions.push(x1, yR, zb, x1, ytR, zb, x0, ytL, zb, x0, yL, zb);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(x0, ytL, z0, x0, ytL, zb, x1, ytR, zb, x1, ytR, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
        if (mask & WallEdge.S) {
          const ytL = baseY + wallH, ytR = baseY + wallH;
          const zf = z1 - WALL_THICKNESS;
          positions.push(x1, baseY, z1, x1, ytR, z1, x0, ytL, z1, x0, baseY, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(cr, cg, cb, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(x0, baseY, zf, x0, ytL, zf, x1, ytR, zf, x1, baseY, zf);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(x0, ytL, zf, x0, ytL, z1, x1, ytR, z1, x1, ytR, zf);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
        if (mask & WallEdge.E) {
          const ytT = baseY + wallH, ytB = baseY + wallH;
          positions.push(x1, baseY, z0, x1, ytT, z0, x1, ytB, z1, x1, baseY, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          const xb = x1 - WALL_THICKNESS;
          positions.push(xb, baseY, z1, xb, ytB, z1, xb, ytT, z0, xb, baseY, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(xb, ytT, z0, x1, ytT, z0, x1, ytB, z1, xb, ytB, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
        if (mask & WallEdge.W) {
          const ytT = baseY + wallH, ytB = baseY + wallH;
          positions.push(x0, baseY, z1, x0, ytB, z1, x0, ytT, z0, x0, baseY, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(cr - 0.03, cg - 0.03, cb - 0.03, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          const xb = x0 + WALL_THICKNESS;
          positions.push(xb, baseY, z0, xb, ytT, z0, xb, ytB, z1, xb, baseY, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(cr - 0.05, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(x0, ytT, z0, xb, ytT, z0, xb, ytB, z1, x0, ytB, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(cr + 0.05, cg + 0.05, cb + 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
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

  // --- Roof (shared between floor 0 and upper layers) ---

  private buildRoofMesh(
    chunkX: number, chunkZ: number,
    startX: number, startZ: number, endX: number, endZ: number,
    roofSource: Map<number, RoofData>,
    suffix = ''
  ): Mesh | null {
    const d = this.data!;
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasRoof = false;
    const cr = 0.45, cg = 0.25, cb = 0.15;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileIdx = z * d.mapWidth + x;
        const roof = roofSource.get(tileIdx);
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
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          positions.push(x0, baseY, z1, x1, baseY, z1, x1, baseY, z0, x0, baseY, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, -1, 0); colors.push(cr - 0.1, cg - 0.05, cb - 0.05, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        } else {
          const peak = baseY + (roof.peakHeight ?? 0.6);
          const mx = (x0 + x1) / 2;
          const mz = (z0 + z1) / 2;

          if (roof.style === 'peaked_ew') {
            positions.push(x0, baseY, z0, x1, baseY, z0, x1, peak, mz, x0, peak, mz);
            for (let i = 0; i < 4; i++) { normals.push(0, 0.7, -0.7); colors.push(cr, cg, cb, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
            positions.push(x0, peak, mz, x1, peak, mz, x1, baseY, z1, x0, baseY, z1);
            for (let i = 0; i < 4; i++) { normals.push(0, 0.7, 0.7); colors.push(cr - 0.05, cg - 0.03, cb - 0.03, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          } else {
            positions.push(x0, baseY, z0, x0, baseY, z1, mx, peak, z1, mx, peak, z0);
            for (let i = 0; i < 4; i++) { normals.push(-0.7, 0.7, 0); colors.push(cr, cg, cb, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
            positions.push(mx, peak, z0, mx, peak, z1, x1, baseY, z1, x1, baseY, z0);
            for (let i = 0; i < 4; i++) { normals.push(0.7, 0.7, 0); colors.push(cr - 0.05, cg - 0.03, cb - 0.03, 1); }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
          }
        }
      }
    }

    if (!hasRoof) return null;
    const mesh = new Mesh(`roof${suffix}_${chunkX}_${chunkZ}`, this.scene);
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

  // --- Floor (floor 0) ---

  private buildFloorMesh(
    chunkX: number, chunkZ: number,
    startX: number, startZ: number, endX: number, endZ: number,
    floorSource: Map<number, number>,
    suffix = ''
  ): Mesh | null {
    const d = this.data!;
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasFloor = false;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileIdx = z * d.mapWidth + x;
        const floorH = floorSource.get(tileIdx);
        if (floorH === undefined) continue;
        hasFloor = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;

        const tileType = this.getTileType(x, z);
        const baseColor = TILE_COLORS[tileType] || TILE_COLORS[TileType.WOOD];

        // Top face
        positions.push(x0, floorH, z0, x1, floorH, z0, x1, floorH, z1, x0, floorH, z1);
        for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); colors.push(baseColor.r, baseColor.g, baseColor.b, 1); }
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        // Bottom face
        positions.push(x0, floorH, z1, x1, floorH, z1, x1, floorH, z0, x0, floorH, z0);
        for (let i = 0; i < 4; i++) { normals.push(0, -1, 0); colors.push(baseColor.r - 0.1, baseColor.g - 0.1, baseColor.b - 0.1, 1); }
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;

        // Edge faces
        const edgeColor = { r: baseColor.r - 0.08, g: baseColor.g - 0.08, b: baseColor.b - 0.08 };
        const groundH = (this.getVertexHeight(x, z) + this.getVertexHeight(x + 1, z) + this.getVertexHeight(x, z + 1) + this.getVertexHeight(x + 1, z + 1)) / 4;
        const edgeBottom = groundH;
        const neighborFloor = (nx: number, nz: number) => floorSource.get(nz * d.mapWidth + nx);

        if (neighborFloor(x, z - 1) !== floorH) {
          positions.push(x0, edgeBottom, z0, x0, floorH, z0, x1, floorH, z0, x1, edgeBottom, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
        if (neighborFloor(x, z + 1) !== floorH) {
          positions.push(x1, edgeBottom, z1, x1, floorH, z1, x0, floorH, z1, x0, edgeBottom, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
        if (neighborFloor(x + 1, z) !== floorH) {
          positions.push(x1, edgeBottom, z0, x1, floorH, z0, x1, floorH, z1, x1, edgeBottom, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
        if (neighborFloor(x - 1, z) !== floorH) {
          positions.push(x0, edgeBottom, z1, x0, floorH, z1, x0, floorH, z0, x0, edgeBottom, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
      }
    }

    if (!hasFloor) return null;
    const mesh = new Mesh(`floor${suffix}_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);
    mesh.material = this.floorMat;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = false;
    return mesh;
  }

  // --- Floor for upper layers ---

  private buildFloorMeshForLayer(
    chunkX: number, chunkZ: number,
    startX: number, startZ: number, endX: number, endZ: number,
    floorIdx: number, layer: FloorLayer
  ): Mesh | null {
    const d = this.data!;
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    let vertexIndex = 0;
    let hasFloor = false;

    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const tileIdx = z * d.mapWidth + x;
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
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        // Bottom face
        positions.push(x0, floorH, z1, x1, floorH, z1, x1, floorH, z0, x0, floorH, z0);
        for (let i = 0; i < 4; i++) { normals.push(0, -1, 0); colors.push(baseColor.r - 0.1, baseColor.g - 0.1, baseColor.b - 0.1, 1); }
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;

        // Edge faces
        const edgeColor = { r: baseColor.r - 0.08, g: baseColor.g - 0.08, b: baseColor.b - 0.08 };
        const edgeBottom = floorH - 0.5;
        const neighborFloor = (nx: number, nz: number) => layer.floors.get(nz * d.mapWidth + nx);

        if (neighborFloor(x, z - 1) !== floorH) {
          positions.push(x0, edgeBottom, z0, x0, floorH, z0, x1, floorH, z0, x1, edgeBottom, z0);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, -1); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
        if (neighborFloor(x, z + 1) !== floorH) {
          positions.push(x1, edgeBottom, z1, x1, floorH, z1, x0, floorH, z1, x0, edgeBottom, z1);
          for (let i = 0; i < 4; i++) { normals.push(0, 0, 1); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
        if (neighborFloor(x + 1, z) !== floorH) {
          positions.push(x1, edgeBottom, z0, x1, floorH, z0, x1, floorH, z1, x1, edgeBottom, z1);
          for (let i = 0; i < 4; i++) { normals.push(1, 0, 0); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
        if (neighborFloor(x - 1, z) !== floorH) {
          positions.push(x0, edgeBottom, z1, x0, floorH, z1, x0, floorH, z0, x0, edgeBottom, z0);
          for (let i = 0; i < 4; i++) { normals.push(-1, 0, 0); colors.push(edgeColor.r, edgeColor.g, edgeColor.b, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
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
    mesh.isPickable = false;
    return mesh;
  }

  // --- Stairs (shared between floor 0 and upper layers) ---

  private buildStairMesh(
    chunkX: number, chunkZ: number,
    startX: number, startZ: number, endX: number, endZ: number,
    stairSource: Map<number, StairData>,
    suffix = ''
  ): Mesh | null {
    const d = this.data!;
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
        const tileIdx = z * d.mapWidth + x;
        const stair = stairSource.get(tileIdx);
        if (!stair) continue;
        hasStairs = true;

        const x0 = x * TILE_SIZE;
        const x1 = (x + 1) * TILE_SIZE;
        const z0 = z * TILE_SIZE;
        const z1 = (z + 1) * TILE_SIZE;
        const stepH = (stair.topHeight - stair.baseHeight) / STEPS;

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
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;

          // Step riser
          if (stair.direction === 'N' || stair.direction === 'S') {
            const fz = stair.direction === 'N' ? sz1! : sz0!;
            positions.push(sx0!, y0, fz, sx0!, y1, fz, sx1!, y1, fz, sx1!, y0, fz);
          } else {
            const fx = stair.direction === 'W' ? sx1! : sx0!;
            positions.push(fx, y0, sz0!, fx, y1, sz0!, fx, y1, sz1!, fx, y0, sz1!);
          }
          for (let i = 0; i < 4; i++) { normals.push(faceNormal![0], faceNormal![1], faceNormal![2]); colors.push(cr - 0.08, cg - 0.08, cb - 0.08, 1); }
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3); vertexIndex += 4;
        }
      }
    }

    if (!hasStairs) return null;
    const mesh = new Mesh(`stairs${suffix}_${chunkX}_${chunkZ}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);
    mesh.material = this.stairMat;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = false;
    return mesh;
  }
}
