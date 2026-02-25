import { tileTypeFromRgb, type MapMeta, type SpawnsFile, type NpcDef, type WorldObjectDef, type WallsFile, type StairData, type RoofData, type FloorLayerData } from '@projectrs/shared';

export interface MapListEntry {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface LoadedMap {
  meta: MapMeta;
  spawns: SpawnsFile;
  tiles: Uint8Array;   // width * height tile types
  heights: Uint8Array;  // (width+1) * (height+1) pixel values
  walls: Uint8Array;   // width * height wall edge bitmasks
  wallHeights: Map<number, number>;    // sparse: tileIdx -> height
  floors: Map<number, number>;         // sparse: tileIdx -> floor height
  stairs: Map<number, StairData>;      // sparse: tileIdx -> stair data
  roofs: Map<number, RoofData>;        // sparse: tileIdx -> roof data
  floorLayers: Map<number, import('../state/EditorState').FloorLayer>;
}

export class EditorApi {
  async listMaps(): Promise<MapListEntry[]> {
    const res = await fetch('/api/editor/maps');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.maps;
  }

  async loadMap(mapId: string): Promise<LoadedMap> {
    const [metaRes, spawnsRes, tilemapRes, heightmapRes] = await Promise.all([
      fetch(`/maps/${mapId}/meta.json?t=${Date.now()}`),
      fetch(`/maps/${mapId}/spawns.json?t=${Date.now()}`),
      fetch(`/maps/${mapId}/tilemap.png?t=${Date.now()}`),
      fetch(`/maps/${mapId}/heightmap.png?t=${Date.now()}`),
    ]);

    const meta: MapMeta = await metaRes.json();
    const spawns: SpawnsFile = await spawnsRes.json();

    // Decode tilemap PNG via OffscreenCanvas
    const tileBlob = await tilemapRes.blob();
    const tileBitmap = await createImageBitmap(tileBlob);
    const tileCanvas = new OffscreenCanvas(meta.width, meta.height);
    const tileCtx = tileCanvas.getContext('2d')!;
    tileCtx.drawImage(tileBitmap, 0, 0);
    const tileImageData = tileCtx.getImageData(0, 0, meta.width, meta.height);

    // Convert RGB pixels to tile types using nearest-color match
    const tiles = new Uint8Array(meta.width * meta.height);
    for (let i = 0; i < meta.width * meta.height; i++) {
      const r = tileImageData.data[i * 4];
      const g = tileImageData.data[i * 4 + 1];
      const b = tileImageData.data[i * 4 + 2];
      tiles[i] = tileTypeFromRgb(r, g, b);
    }

    // Decode heightmap PNG
    const vw = meta.width + 1;
    const vh = meta.height + 1;
    const heightBlob = await heightmapRes.blob();
    const heightBitmap = await createImageBitmap(heightBlob);
    const heightCanvas = new OffscreenCanvas(vw, vh);
    const heightCtx = heightCanvas.getContext('2d')!;
    heightCtx.drawImage(heightBitmap, 0, 0);
    const heightImageData = heightCtx.getImageData(0, 0, vw, vh);

    const heights = new Uint8Array(vw * vh);
    for (let i = 0; i < vw * vh; i++) {
      heights[i] = heightImageData.data[i * 4]; // R channel = grayscale value
    }

    // Load walls
    const walls = new Uint8Array(meta.width * meta.height);
    try {
      const wallsRes = await fetch(`/maps/${mapId}/walls.json?t=${Date.now()}`);
      if (wallsRes.ok) {
        const wallsData: WallsFile = await wallsRes.json();
        for (const [key, mask] of Object.entries(wallsData.walls)) {
          const [xStr, zStr] = key.split(',');
          const x = parseInt(xStr);
          const z = parseInt(zStr);
          if (x >= 0 && x < meta.width && z >= 0 && z < meta.height) {
            walls[z * meta.width + x] = mask;
          }
        }
      }
    } catch { /* no walls.json yet */ }

    // Load building data from walls.json
    const wallHeights = new Map<number, number>();
    const floors = new Map<number, number>();
    const stairs = new Map<number, StairData>();
    const roofs = new Map<number, RoofData>();
    try {
      const wallsRes2 = await fetch(`/maps/${mapId}/walls.json?t=${Date.now()}`);
      if (wallsRes2.ok) {
        const wd: WallsFile = await wallsRes2.json();
        const parseIdx = (key: string): number | null => {
          const [xs, zs] = key.split(',');
          const x = parseInt(xs), z = parseInt(zs);
          if (x >= 0 && x < meta.width && z >= 0 && z < meta.height) return z * meta.width + x;
          return null;
        };
        if (wd.wallHeights) for (const [k, v] of Object.entries(wd.wallHeights)) { const i = parseIdx(k); if (i !== null) wallHeights.set(i, v); }
        if (wd.floors) for (const [k, v] of Object.entries(wd.floors)) { const i = parseIdx(k); if (i !== null) floors.set(i, v); }
        if (wd.stairs) for (const [k, v] of Object.entries(wd.stairs)) { const i = parseIdx(k); if (i !== null) stairs.set(i, v); }
        if (wd.roofs) for (const [k, v] of Object.entries(wd.roofs)) { const i = parseIdx(k); if (i !== null) roofs.set(i, v); }
      }
    } catch { /* ok */ }

    // Load floor layers
    const floorLayers = new Map<number, import('../state/EditorState').FloorLayer>();
    try {
      const wallsRes3 = await fetch(`/maps/${mapId}/walls.json?t=${Date.now()}`);
      if (wallsRes3.ok) {
        const wd: WallsFile = await wallsRes3.json();
        if (wd.floorLayers) {
          for (const [floorStr, layerData] of Object.entries(wd.floorLayers)) {
            const floorIdx = parseInt(floorStr);
            const layer: import('../state/EditorState').FloorLayer = {
              tiles: new Map(),
              walls: new Map(),
              wallHeights: new Map(),
              floors: new Map(),
              stairs: new Map(),
              roofs: new Map(),
            };
            const parseIdx2 = (key: string): number | null => {
              const [xs, zs] = key.split(',');
              const x = parseInt(xs), z = parseInt(zs);
              if (x >= 0 && x < meta.width && z >= 0 && z < meta.height) return z * meta.width + x;
              return null;
            };
            if (layerData.tiles) for (const [k, v] of Object.entries(layerData.tiles)) { const i = parseIdx2(k); if (i !== null) layer.tiles.set(i, v); }
            if (layerData.walls) for (const [k, v] of Object.entries(layerData.walls)) { const i = parseIdx2(k); if (i !== null) layer.walls.set(i, v); }
            if (layerData.wallHeights) for (const [k, v] of Object.entries(layerData.wallHeights)) { const i = parseIdx2(k); if (i !== null) layer.wallHeights.set(i, v); }
            if (layerData.floors) for (const [k, v] of Object.entries(layerData.floors)) { const i = parseIdx2(k); if (i !== null) layer.floors.set(i, v); }
            if (layerData.stairs) for (const [k, v] of Object.entries(layerData.stairs)) { const i = parseIdx2(k); if (i !== null) layer.stairs.set(i, v as StairData); }
            if (layerData.roofs) for (const [k, v] of Object.entries(layerData.roofs)) { const i = parseIdx2(k); if (i !== null) layer.roofs.set(i, v as RoofData); }
            floorLayers.set(floorIdx, layer);
          }
        }
      }
    } catch { /* ok */ }

    return { meta, spawns, tiles, heights, walls, wallHeights, floors, stairs, roofs, floorLayers };
  }

  async saveMap(mapId: string, map: LoadedMap): Promise<void> {
    const { meta, spawns, tiles, heights, walls } = map;
    // Convert walls Uint8Array to sparse format
    const wallsObj: Record<string, number> = {};
    for (let z = 0; z < meta.height; z++) {
      for (let x = 0; x < meta.width; x++) {
        const mask = walls[z * meta.width + x];
        if (mask !== 0) {
          wallsObj[`${x},${z}`] = mask;
        }
      }
    }

    // Convert sparse Maps to "x,z" keyed objects
    const toSparse = <T>(m: Map<number, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [idx, v] of m) {
        const x = idx % meta.width;
        const z = Math.floor(idx / meta.width);
        out[`${x},${z}`] = v;
      }
      return out;
    };

    // Serialize floor layers
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
        if (layer.tiles.size > 0) {
          ld.tiles = {};
          for (const [idx, v] of layer.tiles) {
            const x = idx % meta.width;
            const z = Math.floor(idx / meta.width);
            ld.tiles[`${x},${z}`] = v;
          }
        }
        if (layer.wallHeights.size > 0) ld.wallHeights = toSparse(layer.wallHeights);
        if (layer.floors.size > 0) ld.floors = toSparse(layer.floors);
        if (layer.stairs.size > 0) ld.stairs = toSparse(layer.stairs);
        if (layer.roofs.size > 0) ld.roofs = toSparse(layer.roofs);
        floorLayersObj[floorIdx] = ld;
      }
    }

    const res = await fetch('/api/editor/save-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapId,
        meta,
        spawns,
        tilemap: Array.from(tiles),
        heightmap: Array.from(heights),
        walls: wallsObj,
        wallHeights: map.wallHeights.size > 0 ? toSparse(map.wallHeights) : undefined,
        floors: map.floors.size > 0 ? toSparse(map.floors) : undefined,
        stairs: map.stairs.size > 0 ? toSparse(map.stairs) : undefined,
        roofs: map.roofs.size > 0 ? toSparse(map.roofs) : undefined,
        floorLayers: floorLayersObj,
      }),
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
