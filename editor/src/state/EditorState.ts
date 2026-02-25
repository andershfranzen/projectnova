import type { MapMeta, SpawnsFile, SpawnEntry, ObjectSpawnEntry, NpcDef, WorldObjectDef, StairData, RoofData, RoofStyle, StairDirection, FloorLayerData } from '@projectrs/shared';

/** In-memory representation of a floor layer (for floors 1+) */
export interface FloorLayer {
  tiles: Map<number, number>;            // sparse tileIdx -> tile type
  walls: Map<number, number>;            // sparse tileIdx -> wall bitmask
  wallHeights: Map<number, number>;
  floors: Map<number, number>;
  stairs: Map<number, StairData>;
  roofs: Map<number, RoofData>;
}

export function createFloorLayer(): FloorLayer {
  return {
    tiles: new Map(),
    walls: new Map(),
    wallHeights: new Map(),
    floors: new Map(),
    stairs: new Map(),
    roofs: new Map(),
  };
}

export type EditorTool = 'tile' | 'height' | 'npc' | 'object' | 'eraser' | 'eyedropper' | 'fill' | 'rect' | 'line' | 'select' | 'wall' | 'floor' | 'stair' | 'roof';
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

  // Multi-floor layer data (floor 1+). Floor 0 uses the above arrays.
  floorLayers: Map<number, FloorLayer>;  // floorIndex -> layer data

  // Tool state
  activeTool: EditorTool;
  selectedTileType: number;
  brushSize: number;
  heightMode: HeightMode;
  heightValue: number;
  heightDelta: number;
  selectedNpcId: number;
  selectedObjectId: number;

  // Building tool state
  wallHeightValue: number;       // wall height override for wall tool
  floorHeightValue: number;      // elevated floor height
  stairDirection: StairDirection; // stair direction
  stairBaseHeight: number;
  stairTopHeight: number;
  roofStyle: RoofStyle;
  roofHeight: number;
  roofPeakHeight: number;

  // Multi-floor
  currentFloor: number;          // which floor layer is being edited

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
    floorLayers: new Map(),

    activeTool: 'tile',
    selectedTileType: 0,
    brushSize: 1,
    heightMode: 'set',
    heightValue: 128,
    heightDelta: 10,
    selectedNpcId: 1,
    selectedObjectId: 1,

    wallHeightValue: 1.8,
    floorHeightValue: 3.0,
    stairDirection: 'N' as StairDirection,
    stairBaseHeight: 0,
    stairTopHeight: 3.0,
    roofStyle: 'flat' as RoofStyle,
    roofHeight: 4.0,
    roofPeakHeight: 1.0,

    currentFloor: 0,

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
    const layer = this.getActiveFloorLayer();
    if (layer) {
      const idx = z * meta.width + x;
      layer.tiles.set(idx, type);
    } else {
      this.state.tiles[z * meta.width + x] = type;
    }
    this.state.dirty = true;
  }

  getTile(x: number, z: number): number {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return 0;
    const layer = this.getActiveFloorLayer();
    if (layer) {
      const idx = z * meta.width + x;
      return layer.tiles.get(idx) ?? -1; // -1 = no tile on this floor
    }
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
    const idx = z * meta.width + x;
    return this.getActiveWalls().get(idx);
  }

  setWall(x: number, z: number, mask: number): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    const idx = z * meta.width + x;
    this.getActiveWalls().set(idx, mask);
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

  /** Get the active floor layer (null = floor 0 ground) */
  getActiveFloorLayer(): FloorLayer | null {
    const floor = this.state.currentFloor;
    if (floor === 0) return null;
    let layer = this.state.floorLayers.get(floor);
    if (!layer) {
      layer = createFloorLayer();
      this.state.floorLayers.set(floor, layer);
    }
    return layer;
  }

  /** Get walls map for active floor */
  getActiveWalls(): { get: (idx: number) => number; set: (idx: number, val: number) => void } {
    const layer = this.getActiveFloorLayer();
    if (!layer) {
      const s = this.state;
      return {
        get: (idx: number) => s.walls[idx] ?? 0,
        set: (idx: number, val: number) => { s.walls[idx] = val; },
      };
    }
    return {
      get: (idx: number) => layer.walls.get(idx) ?? 0,
      set: (idx: number, val: number) => { if (val === 0) layer.walls.delete(idx); else layer.walls.set(idx, val); },
    };
  }

  /** Get the active wallHeights map */
  getActiveWallHeights(): Map<number, number> {
    const layer = this.getActiveFloorLayer();
    return layer ? layer.wallHeights : this.state.wallHeights;
  }

  /** Get the active floors map */
  getActiveFloors(): Map<number, number> {
    const layer = this.getActiveFloorLayer();
    return layer ? layer.floors : this.state.floors;
  }

  /** Get the active stairs map */
  getActiveStairs(): Map<number, StairData> {
    const layer = this.getActiveFloorLayer();
    return layer ? layer.stairs : this.state.stairs;
  }

  /** Get the active roofs map */
  getActiveRoofs(): Map<number, RoofData> {
    const layer = this.getActiveFloorLayer();
    return layer ? layer.roofs : this.state.roofs;
  }

  tileIdx(x: number, z: number): number {
    return z * this.state.meta.width + x;
  }

  setFloor(x: number, z: number, height: number): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    this.getActiveFloors().set(this.tileIdx(x, z), height);
    this.state.dirty = true;
  }

  removeFloor(x: number, z: number): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    this.getActiveFloors().delete(this.tileIdx(x, z));
    this.state.dirty = true;
  }

  setStair(x: number, z: number, data: StairData): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    this.getActiveStairs().set(this.tileIdx(x, z), data);
    this.state.dirty = true;
  }

  removeStair(x: number, z: number): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    this.getActiveStairs().delete(this.tileIdx(x, z));
    this.state.dirty = true;
  }

  setRoof(x: number, z: number, data: RoofData): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    this.getActiveRoofs().set(this.tileIdx(x, z), data);
    this.state.dirty = true;
  }

  removeRoof(x: number, z: number): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    this.getActiveRoofs().delete(this.tileIdx(x, z));
    this.state.dirty = true;
  }

  setWallHeight(x: number, z: number, height: number): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    this.getActiveWallHeights().set(this.tileIdx(x, z), height);
    this.state.dirty = true;
  }

  removeWallHeight(x: number, z: number): void {
    const { meta } = this.state;
    if (x < 0 || x >= meta.width || z < 0 || z >= meta.height) return;
    this.getActiveWallHeights().delete(this.tileIdx(x, z));
    this.state.dirty = true;
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
