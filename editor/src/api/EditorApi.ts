import { tileTypeFromRgb, type MapMeta, type SpawnsFile, type NpcDef, type WorldObjectDef, type WallsFile } from '@projectrs/shared';

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

    return { meta, spawns, tiles, heights, walls };
  }

  async saveMap(mapId: string, meta: MapMeta, spawns: SpawnsFile, tiles: Uint8Array, heights: Uint8Array, walls: Uint8Array): Promise<void> {
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
