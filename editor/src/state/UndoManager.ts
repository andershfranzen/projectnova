import type { StateManager } from './EditorState';

interface UndoEntry {
  type: 'tiles' | 'heights' | 'walls' | 'spawns';
  // For tiles/heights: store affected region
  region?: {
    x: number;
    z: number;
    w: number;
    h: number;
    oldData: Uint8Array;
    newData: Uint8Array;
    stride: number; // width of the full array row
  };
  // For spawns: store old and new full spawns snapshot
  oldSpawns?: string;
  newSpawns?: string;
}

export class UndoManager {
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private maxEntries = 100;
  private stateMgr: StateManager;

  // Pending region capture for brush strokes
  private pendingType: 'tiles' | 'heights' | 'walls' | null = null;
  private pendingRegion: { minX: number; minZ: number; maxX: number; maxZ: number } | null = null;
  private pendingSnapshot: Uint8Array | null = null;
  private pendingStride: number = 0;

  constructor(stateMgr: StateManager) {
    this.stateMgr = stateMgr;
  }

  /** Begin a brush stroke — snapshots the current data before changes */
  beginStroke(type: 'tiles' | 'heights' | 'walls'): void {
    this.pendingType = type;
    this.pendingRegion = null;
    const s = this.stateMgr.state;
    if (type === 'tiles') {
      this.pendingSnapshot = new Uint8Array(s.tiles);
      this.pendingStride = s.meta.width;
    } else if (type === 'heights') {
      this.pendingSnapshot = new Uint8Array(s.heights);
      this.pendingStride = s.meta.width + 1;
    } else {
      this.pendingSnapshot = new Uint8Array(s.walls);
      this.pendingStride = s.meta.width;
    }
  }

  /** Expand the affected region during a stroke */
  expandRegion(x: number, z: number, size: number = 1): void {
    if (!this.pendingRegion) {
      this.pendingRegion = { minX: x, minZ: z, maxX: x + size - 1, maxZ: z + size - 1 };
    } else {
      this.pendingRegion.minX = Math.min(this.pendingRegion.minX, x);
      this.pendingRegion.minZ = Math.min(this.pendingRegion.minZ, z);
      this.pendingRegion.maxX = Math.max(this.pendingRegion.maxX, x + size - 1);
      this.pendingRegion.maxZ = Math.max(this.pendingRegion.maxZ, z + size - 1);
    }
  }

  /** End a stroke — compute the diff and push to undo stack */
  endStroke(): void {
    if (!this.pendingType || !this.pendingRegion || !this.pendingSnapshot) {
      this.pendingType = null;
      this.pendingRegion = null;
      this.pendingSnapshot = null;
      return;
    }

    const s = this.stateMgr.state;
    const currentData = this.pendingType === 'tiles' ? s.tiles : this.pendingType === 'heights' ? s.heights : s.walls;
    const stride = this.pendingStride;
    const maxCoord = this.pendingType === 'heights'
      ? { w: s.meta.width + 1, h: s.meta.height + 1 }
      : { w: s.meta.width, h: s.meta.height };

    const r = this.pendingRegion;
    const rx = Math.max(0, r.minX);
    const rz = Math.max(0, r.minZ);
    const rw = Math.min(r.maxX, maxCoord.w - 1) - rx + 1;
    const rh = Math.min(r.maxZ, maxCoord.h - 1) - rz + 1;

    if (rw <= 0 || rh <= 0) {
      this.pendingType = null;
      this.pendingRegion = null;
      this.pendingSnapshot = null;
      return;
    }

    // Extract old and new region data
    const oldData = new Uint8Array(rw * rh);
    const newData = new Uint8Array(rw * rh);
    let hasChanges = false;
    for (let dz = 0; dz < rh; dz++) {
      for (let dx = 0; dx < rw; dx++) {
        const srcIdx = (rz + dz) * stride + (rx + dx);
        const dstIdx = dz * rw + dx;
        oldData[dstIdx] = this.pendingSnapshot[srcIdx];
        newData[dstIdx] = currentData[srcIdx];
        if (oldData[dstIdx] !== newData[dstIdx]) hasChanges = true;
      }
    }

    if (hasChanges) {
      this.undoStack.push({
        type: this.pendingType,
        region: { x: rx, z: rz, w: rw, h: rh, oldData, newData, stride },
      });
      if (this.undoStack.length > this.maxEntries) this.undoStack.shift();
      this.redoStack.length = 0;
    }

    this.pendingType = null;
    this.pendingRegion = null;
    this.pendingSnapshot = null;
  }

  /** Snapshot spawns before a change */
  snapshotSpawns(): string {
    return JSON.stringify(this.stateMgr.state.spawns);
  }

  /** Push a spawn change */
  pushSpawnChange(oldSpawns: string, newSpawns: string): void {
    if (oldSpawns === newSpawns) return;
    this.undoStack.push({ type: 'spawns', oldSpawns, newSpawns });
    if (this.undoStack.length > this.maxEntries) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;

    this.applyEntry(entry, 'undo');
    this.redoStack.push(entry);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;

    this.applyEntry(entry, 'redo');
    this.undoStack.push(entry);
    return true;
  }

  private applyEntry(entry: UndoEntry, direction: 'undo' | 'redo'): void {
    const s = this.stateMgr.state;

    if (entry.type === 'spawns') {
      const data = direction === 'undo' ? entry.oldSpawns! : entry.newSpawns!;
      s.spawns = JSON.parse(data);
      s.dirty = true;
      return;
    }

    const region = entry.region!;
    const targetData = entry.type === 'tiles' ? s.tiles : entry.type === 'heights' ? s.heights : s.walls;
    const stride = entry.type === 'heights' ? s.meta.width + 1 : s.meta.width;
    const sourceData = direction === 'undo' ? region.oldData : region.newData;

    for (let dz = 0; dz < region.h; dz++) {
      for (let dx = 0; dx < region.w; dx++) {
        const srcIdx = dz * region.w + dx;
        const dstIdx = (region.z + dz) * stride + (region.x + dx);
        targetData[dstIdx] = sourceData[srcIdx];
      }
    }
    s.dirty = true;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
}
