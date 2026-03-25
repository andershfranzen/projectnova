import { TileType, type MapMeta, type SpawnsFile, type NpcDef, type WorldObjectDef, type WallsFile, type StairData, type RoofData, type FloorLayerData, type KCMapFile, type KCTile, type GroundType, defaultKCTile } from '@projectrs/shared';

export interface MapListEntry {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface LoadedMap {
  meta: MapMeta;
  spawns: SpawnsFile;
  tiles: Uint8Array;   // width * height tile types (TileType enum)
  heights: Uint8Array;  // (width+1) * (height+1) values 0-255
  walls: Uint8Array;   // width * height wall edge bitmasks
  wallHeights: Map<number, number>;
  floors: Map<number, number>;
  stairs: Map<number, StairData>;
  roofs: Map<number, RoofData>;
  floorLayers: Map<number, import('../state/EditorState').FloorLayer>;
  // Store the original KC data for fields the editor doesn't modify
  _kcMapFile?: KCMapFile;
}

// --- Conversion helpers: KC format <-> editor internal format ---

const GROUND_TO_TILETYPE: Record<string, TileType> = {
  'grass': TileType.GRASS, 'dirt': TileType.DIRT, 'sand': TileType.SAND,
  'path': TileType.WOOD, 'road': TileType.STONE, 'water': TileType.WATER,
};

const TILETYPE_TO_GROUND: Record<number, GroundType> = {
  [TileType.GRASS]: 'grass', [TileType.DIRT]: 'dirt', [TileType.STONE]: 'road',
  [TileType.WATER]: 'water', [TileType.WALL]: 'grass', [TileType.SAND]: 'sand',
  [TileType.WOOD]: 'path',
};

// Default height range for encoding/decoding 0-255 <-> real heights
const HEIGHT_MIN = -2;
const HEIGHT_MAX = 10;
const HEIGHT_RANGE = HEIGHT_MAX - HEIGHT_MIN;

function heightToPixel(h: number): number {
  return Math.max(0, Math.min(255, Math.round((h - HEIGHT_MIN) / HEIGHT_RANGE * 255)));
}

function pixelToHeight(p: number): number {
  return (p / 255) * HEIGHT_RANGE + HEIGHT_MIN;
}

export class EditorApi {
  async listMaps(): Promise<MapListEntry[]> {
    const res = await fetch('/api/editor/maps');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.maps;
  }

  async loadMap(mapId: string): Promise<LoadedMap> {
    const cacheBust = `?t=${Date.now()}`;
    const [metaRes, spawnsRes, mapRes] = await Promise.all([
      fetch(`/maps/${mapId}/meta.json${cacheBust}`),
      fetch(`/maps/${mapId}/spawns.json${cacheBust}`),
      fetch(`/maps/${mapId}/map.json${cacheBust}`),
    ]);

    const meta: MapMeta = await metaRes.json();
    const spawns: SpawnsFile = await spawnsRes.json();
    const kcMapFile: KCMapFile = await mapRes.json();
    const kcMap = kcMapFile.map;

    // Convert KC tiles to integer tile types
    const tiles = new Uint8Array(meta.width * meta.height);
    for (let z = 0; z < meta.height; z++) {
      for (let x = 0; x < meta.width; x++) {
        const kcTile = kcMap.tiles[z]?.[x];
        tiles[z * meta.width + x] = kcTile
          ? (GROUND_TO_TILETYPE[kcTile.ground] ?? TileType.GRASS)
          : TileType.GRASS;
      }
    }

    // Convert KC float heights to 0-255 pixel values
    const vw = meta.width + 1;
    const vh = meta.height + 1;
    const heights = new Uint8Array(vw * vh);
    for (let z = 0; z <= meta.height; z++) {
      for (let x = 0; x <= meta.width; x++) {
        const h = kcMap.heights[z]?.[x] ?? 0;
        heights[z * vw + x] = heightToPixel(h);
      }
    }

    // Load walls
    const walls = new Uint8Array(meta.width * meta.height);
    const wallHeights = new Map<number, number>();
    const floors = new Map<number, number>();
    const stairs = new Map<number, StairData>();
    const roofs = new Map<number, RoofData>();
    const floorLayers = new Map<number, import('../state/EditorState').FloorLayer>();

    try {
      const wallsRes = await fetch(`/maps/${mapId}/walls.json${cacheBust}`);
      if (wallsRes.ok) {
        const wd: WallsFile = await wallsRes.json();
        const parseIdx = (key: string): number | null => {
          const [xs, zs] = key.split(',');
          const x = parseInt(xs), z = parseInt(zs);
          if (x >= 0 && x < meta.width && z >= 0 && z < meta.height) return z * meta.width + x;
          return null;
        };
        for (const [key, mask] of Object.entries(wd.walls)) {
          const idx = parseIdx(key);
          if (idx !== null) walls[idx] = mask;
        }
        if (wd.wallHeights) for (const [k, v] of Object.entries(wd.wallHeights)) { const i = parseIdx(k); if (i !== null) wallHeights.set(i, v); }
        if (wd.floors) for (const [k, v] of Object.entries(wd.floors)) { const i = parseIdx(k); if (i !== null) floors.set(i, v); }
        if (wd.stairs) for (const [k, v] of Object.entries(wd.stairs)) { const i = parseIdx(k); if (i !== null) stairs.set(i, v); }
        if (wd.roofs) for (const [k, v] of Object.entries(wd.roofs)) { const i = parseIdx(k); if (i !== null) roofs.set(i, v); }
        if (wd.floorLayers) {
          for (const [floorStr, layerData] of Object.entries(wd.floorLayers)) {
            const floorIdx = parseInt(floorStr);
            const layer: import('../state/EditorState').FloorLayer = {
              tiles: new Map(), walls: new Map(), wallHeights: new Map(),
              floors: new Map(), stairs: new Map(), roofs: new Map(),
            };
            if (layerData.tiles) for (const [k, v] of Object.entries(layerData.tiles)) { const i = parseIdx(k); if (i !== null) layer.tiles.set(i, v); }
            if (layerData.walls) for (const [k, v] of Object.entries(layerData.walls)) { const i = parseIdx(k); if (i !== null) layer.walls.set(i, v); }
            if (layerData.wallHeights) for (const [k, v] of Object.entries(layerData.wallHeights)) { const i = parseIdx(k); if (i !== null) layer.wallHeights.set(i, v); }
            if (layerData.floors) for (const [k, v] of Object.entries(layerData.floors)) { const i = parseIdx(k); if (i !== null) layer.floors.set(i, v); }
            if (layerData.stairs) for (const [k, v] of Object.entries(layerData.stairs)) { const i = parseIdx(k); if (i !== null) layer.stairs.set(i, v as StairData); }
            if (layerData.roofs) for (const [k, v] of Object.entries(layerData.roofs)) { const i = parseIdx(k); if (i !== null) layer.roofs.set(i, v as RoofData); }
            floorLayers.set(floorIdx, layer);
          }
        }
      }
    } catch { /* no walls.json yet */ }

    return { meta, spawns, tiles, heights, walls, wallHeights, floors, stairs, roofs, floorLayers, _kcMapFile: kcMapFile };
  }

  async saveMap(mapId: string, map: LoadedMap): Promise<void> {
    const { meta, spawns, tiles, heights, walls } = map;

    // Convert editor tiles/heights back to KC format
    const kcTiles: KCTile[][] = [];
    for (let z = 0; z < meta.height; z++) {
      const row: KCTile[] = [];
      for (let x = 0; x < meta.width; x++) {
        const tileType = tiles[z * meta.width + x] as TileType;
        const ground = TILETYPE_TO_GROUND[tileType] ?? 'grass';
        const tile = defaultKCTile(ground);
        if (ground === 'water') tile.waterPainted = true;
        row.push(tile);
      }
      kcTiles.push(row);
    }

    const kcHeights: number[][] = [];
    const vw = meta.width + 1;
    for (let z = 0; z <= meta.height; z++) {
      const row: number[] = [];
      for (let x = 0; x <= meta.width; x++) {
        row.push(pixelToHeight(heights[z * vw + x]));
      }
      kcHeights.push(row);
    }

    // Preserve KC-specific data from the original load if available
    const origKC = map._kcMapFile;
    const mapData: KCMapFile = {
      map: {
        width: meta.width,
        height: meta.height,
        waterLevel: meta.waterLevel,
        chunkWaterLevels: origKC?.map.chunkWaterLevels ?? {},
        texturePlanes: origKC?.map.texturePlanes ?? [],
        tiles: kcTiles,
        heights: kcHeights,
      },
      placedObjects: origKC?.placedObjects ?? [],
      layers: origKC?.layers ?? [{ id: 'default', name: 'Default', visible: true }],
      activeLayerId: origKC?.activeLayerId ?? 'default',
    };

    // Build walls
    const wallsObj: Record<string, number> = {};
    for (let z = 0; z < meta.height; z++) {
      for (let x = 0; x < meta.width; x++) {
        const mask = walls[z * meta.width + x];
        if (mask !== 0) wallsObj[`${x},${z}`] = mask;
      }
    }

    const toSparse = <T>(m: Map<number, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [idx, v] of m) {
        const x = idx % meta.width;
        const z = Math.floor(idx / meta.width);
        out[`${x},${z}`] = v;
      }
      return out;
    };

    let floorLayersObj: Record<number, FloorLayerData> | undefined;
    if (map.floorLayers && map.floorLayers.size > 0) {
      floorLayersObj = {};
      for (const [floorIdx, layer] of map.floorLayers) {
        const ld: FloorLayerData = { walls: {} };
        for (const [idx, v] of layer.walls) {
          const x = idx % meta.width;
          const z = Math.floor(idx / meta.width);
          ld.walls[`${x},${z}`] = v;
        }
        if (layer.tiles.size > 0) { ld.tiles = {}; for (const [idx, v] of layer.tiles) { const x = idx % meta.width; const z = Math.floor(idx / meta.width); ld.tiles[`${x},${z}`] = v; } }
        if (layer.wallHeights.size > 0) ld.wallHeights = toSparse(layer.wallHeights);
        if (layer.floors.size > 0) ld.floors = toSparse(layer.floors);
        if (layer.stairs.size > 0) ld.stairs = toSparse(layer.stairs);
        if (layer.roofs.size > 0) ld.roofs = toSparse(layer.roofs);
        floorLayersObj[floorIdx] = ld;
      }
    }

    const wallsFile: WallsFile = { walls: wallsObj };
    if (map.wallHeights.size > 0) wallsFile.wallHeights = toSparse(map.wallHeights);
    if (map.floors.size > 0) wallsFile.floors = toSparse(map.floors);
    if (map.stairs.size > 0) wallsFile.stairs = toSparse(map.stairs);
    if (map.roofs.size > 0) wallsFile.roofs = toSparse(map.roofs);
    if (floorLayersObj) wallsFile.floorLayers = floorLayersObj;

    const res = await fetch('/api/editor/save-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId, meta, spawns, mapData, walls: wallsFile }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
  }

  async createMap(mapId: string, name: string, width: number, height: number): Promise<MapMeta> {
    const res = await fetch('/api/editor/new-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId, name, width, height }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.meta;
  }

  async loadNpcDefs(): Promise<NpcDef[]> {
    const res = await fetch('/data/npcs.json');
    return res.json();
  }

  async loadObjectDefs(): Promise<WorldObjectDef[]> {
    const res = await fetch('/data/objects.json');
    return res.json();
  }

  async reloadMap(mapId: string): Promise<void> {
    const res = await fetch('/api/editor/reload-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
  }

  async exportMap(mapId: string): Promise<Blob> {
    const res = await fetch(`/api/editor/export-map?mapId=${encodeURIComponent(mapId)}`);
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  }

  async deleteMap(mapId: string): Promise<void> {
    const res = await fetch('/api/editor/delete-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
  }

  async importMap(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/editor/import-map', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.mapId;
  }
}
