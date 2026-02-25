import type { MapMeta, SpawnsFile, SpawnEntry, ObjectSpawnEntry, NpcDef, WorldObjectDef, StairData, RoofData } from '@projectrs/shared';

export type EditorTool = 'tile' | 'height' | 'npc' | 'object' | 'eraser' | 'eyedropper' | 'fill' | 'rect' | 'line' | 'select' | 'wall';
export type HeightMode = 'set' | 'raise' | 'lower' | 'smooth';

export interface ClipboardRegion {
  w: number;
  h: number;
  tiles: Uint8Array;
  heights: Uint8Array; // (w+1) * (h+1)
  walls: Uint8Array; // w * h
}

export interface EditorState {
  // Map data
  mapId: string;
  meta: MapMeta;
  spawns: SpawnsFile;
  tiles: Uint8Array;    // width * height
  heights: Uint8Array;  // (width+1) * (height+1)
  walls: Uint8Array;    // width * height wall edge bitmasks
  wallHeights: Map<number, number>;    // sparse: tileIdx -> wall height override
  floors: Map<number, number>;         // sparse: tileIdx -> elevated floor height
  stairs: Map<number, StairData>;      // sparse: tileIdx -> stair data
  roofs: Map<number, RoofData>;        // sparse: tileIdx -> roof data

  // Tool state
  activeTool: EditorTool;
  selectedTileType: number;
  brushSize: number;
  heightMode: HeightMode;
  heightValue: number;
  heightDelta: number;
  selectedNpcId: number;
  selectedObjectId: number;

  // Selection state
  selection: { x: number; z: number; w: number; h: number } | null;
  clipboard: ClipboardRegion | null;

  // View state
  showGrid: boolean;
  showHeights: boolean;
  showSpawns: boolean;
  showWalls: boolean;

  // Definitions
  npcDefs: NpcDef[];
  objectDefs: WorldObjectDef[];

  // Dirty flag
  dirty: boolean;
}

export function createInitialState(): EditorState {
  return {
    mapId: '',
    meta: {
      id: '', name: '', width: 0, height: 0,
      heightRange: [-2, 10], waterLevel: -0.3,
      spawnPoint: { x: 0, z: 0 },
      fogColor: [0.4, 0.6, 0.9], fogStart: 30, fogEnd: 50,
      transitions: [],
    },
    spawns: { npcs: [], objects: [] },
    tiles: new Uint8Array(0),
    heights: new Uint8Array(0),
    walls: new Uint8Array(0),
    wallHeights: new Map(),
    floors: new Map(),
    stairs: new Map(),
    roofs: new Map(),

    activeTool: 'tile',
    selectedTileType: 0,
    brushSize: 1,
    heightMode: 'set',
    heightValue: 128,
    heightDelta: 10,
    selectedNpcId: 1,
    selectedObjectId: 1,

    selection: null,
    clipboard: null,

    showGrid: false,
    showHeights: false,
    showSpawns: true,
    showWalls: true,

    npcDefs: [],
    objectDefs: [],
    dirty: false,
  };
}

export type StateChangeListener = () => void;

export class StateManager {
  state: EditorState;
  private listeners: StateChangeListener[] = [];

  constructor() {
    this.state = createInitialState();
  }

  onChange(listener: StateChangeListener): void {
    this.listeners.push(listener);
  }

  notify(): void {
    for (const l of this.listeners) l();
  }

  setTile(x: number, z: number, type: number): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    this.state.tiles[z * meta.width + x] = type;
    this.state.dirty = true;
  }

  getTile(x: number, z: number): number {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return 0;
    return this.state.tiles[z * meta.width + x];
  }

  setHeight(vx: number, vz: number, value: number): void {
    const { meta } = this.state;
    const vw = meta.width + 1;
    const vh = meta.height + 1;
    if (vx < 0 || vx >= vw || vz < 0 || vz >= vh) return;
    this.state.heights[vz * vw + vx] = Math.max(0, Math.min(255, Math.round(value)));
    this.state.dirty = true;
  }

  getHeight(vx: number, vz: number): number {
    const { meta } = this.state;
    const vw = meta.width + 1;
    const vh = meta.height + 1;
    if (vx < 0 || vx >= vw || vz < 0 || vz >= vh) return 128;
    return this.state.heights[vz * vw + vx];
  }

  getWall(x: number, z: number): number {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return 0;
    return this.state.walls[z * meta.width + x];
  }

  setWall(x: number, z: number, mask: number): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    this.state.walls[z * meta.width + x] = mask;
    this.state.dirty = true;
  }

  addNpcSpawn(npcId: number, x: number, z: number): void {
    this.state.spawns.npcs.push({ npcId, x, z });
    this.state.dirty = true;
  }

  addObjectSpawn(objectId: number, x: number, z: number): void {
    if (!this.state.spawns.objects) this.state.spawns.objects = [];
    this.state.spawns.objects.push({ objectId, x, z });
    this.state.dirty = true;
  }

  findSpawnNear(worldX: number, worldZ: number, radius: number = 1.5): { type: 'npc' | 'object'; index: number; spawn: any } | null {
    const npcs = this.state.spawns.npcs;
    let bestIdx = -1;
    let bestDist = radius;
    let bestType: 'npc' | 'object' = 'npc';

    for (let i = 0; i < npcs.length; i++) {
      const dx = npcs[i].x - worldX;
      const dz = npcs[i].z - worldZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; bestType = 'npc'; }
    }

    const objects = this.state.spawns.objects || [];
    for (let i = 0; i < objects.length; i++) {
      const dx = objects[i].x - worldX;
      const dz = objects[i].z - worldZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; bestType = 'object'; }
    }

    if (bestIdx < 0) return null;
    const spawn = bestType === 'npc' ? npcs[bestIdx] : objects[bestIdx];
    return { type: bestType, index: bestIdx, spawn };
  }

  removeSpawnNear(worldX: number, worldZ: number, radius: number = 1.5): boolean {
    const found = this.findSpawnNear(worldX, worldZ, radius);
    if (!found) return false;
    if (found.type === 'npc') {
      this.state.spawns.npcs.splice(found.index, 1);
    } else {
      (this.state.spawns.objects || []).splice(found.index, 1);
    }
    this.state.dirty = true;
    return true;
  }

  copyRegion(x: number, z: number, w: number, h: number): ClipboardRegion {
    const tiles = new Uint8Array(w * h);
    const heights = new Uint8Array((w + 1) * (h + 1));
    const walls = new Uint8Array(w * h);
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        tiles[dz * w + dx] = this.getTile(x + dx, z + dz);
        walls[dz * w + dx] = this.getWall(x + dx, z + dz);
      }
    }
    for (let dz = 0; dz <= h; dz++) {
      for (let dx = 0; dx <= w; dx++) {
        heights[dz * (w + 1) + dx] = this.getHeight(x + dx, z + dz);
      }
    }
    return { w, h, tiles, heights, walls };
  }

  pasteRegion(x: number, z: number, clip: ClipboardRegion): void {
    for (let dz = 0; dz < clip.h; dz++) {
      for (let dx = 0; dx < clip.w; dx++) {
        this.setTile(x + dx, z + dz, clip.tiles[dz * clip.w + dx]);
        this.setWall(x + dx, z + dz, clip.walls[dz * clip.w + dx]);
      }
    }
    for (let dz = 0; dz <= clip.h; dz++) {
      for (let dx = 0; dx <= clip.w; dx++) {
        this.setHeight(x + dx, z + dz, clip.heights[dz * (clip.w + 1) + dx]);
      }
    }
  }
}
