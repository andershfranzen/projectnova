import { StateManager, type EditorTool } from './state/EditorState';
import { UndoManager } from './state/UndoManager';
import { EditorApi } from './api/EditorApi';
import { MapCanvas } from './canvas/MapCanvas';
import { MinimapCanvas } from './canvas/MinimapCanvas';
import { Toolbar } from './panels/Toolbar';
import { TilePalette } from './panels/TilePalette';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { MapSelector } from './panels/MapSelector';

import { TileBrush } from './tools/TileBrush';
import { HeightBrush } from './tools/HeightBrush';
import { NpcPlacer } from './tools/NpcPlacer';
import { ObjectPlacer } from './tools/ObjectPlacer';
import { SpawnEraser } from './tools/SpawnEraser';
import { Eyedropper } from './tools/Eyedropper';
import { FloodFill } from './tools/FloodFill';
import { RectTool } from './tools/RectTool';
import { LineTool } from './tools/LineTool';
import { SelectTool } from './tools/SelectTool';
import { SpawnDragger } from './tools/SpawnDragger';
import { WallBrush } from './tools/WallBrush';
import type { EditorToolInterface, EditorToolContext } from './tools/BaseTool';

const RECENT_MAPS_KEY = 'projectrs-editor-recent-maps';

function showToast(message: string, isError = false): void {
  const el = document.getElementById('toast')!;
  el.textContent = message;
  el.className = isError ? 'show error' : 'show';
  clearTimeout((el as any)._timer);
  (el as any)._timer = setTimeout(() => { el.className = ''; }, 2500);
}

export class EditorApp {
  private stateMgr = new StateManager();
  private undoMgr = new UndoManager(this.stateMgr);
  private api = new EditorApi();

  private mapCanvas!: MapCanvas;
  private minimap!: MinimapCanvas;
  private toolbar!: Toolbar;
  private tilePalette!: TilePalette;
  private propsPanel!: PropertiesPanel;
  private mapSelector!: MapSelector;

  private keysDown: Set<string> = new Set();
  private spawnDragger = new SpawnDragger();

  // Tools
  private eyedropper = new Eyedropper();
  private rectTool = new RectTool();
  private lineTool = new LineTool();
  private tools: Record<EditorTool, EditorToolInterface> = {
    tile: new TileBrush(),
    height: new HeightBrush(),
    npc: new NpcPlacer(),
    object: new ObjectPlacer(),
    eraser: new SpawnEraser(),
    eyedropper: this.eyedropper,
    fill: new FloodFill(),
    rect: this.rectTool,
    line: this.lineTool,
    select: new SelectTool(),
    wall: new WallBrush(),
  };

  private toolCtx!: EditorToolContext;

  async init(): Promise<void> {
    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    const container = document.getElementById('canvas-container') as HTMLElement;
    const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    const toolbarEl = document.getElementById('toolbar') as HTMLElement;
    const leftPanel = document.getElementById('left-panel') as HTMLElement;
    const rightPanel = document.getElementById('right-panel') as HTMLElement;
    const coordsEl = document.getElementById('coords') as HTMLElement;

    this.mapCanvas = new MapCanvas(canvas, container, this.stateMgr);
    this.minimap = new MinimapCanvas(minimapCanvas);

    // Give canvas access to tool previews
    this.mapCanvas.rectTool = this.rectTool;
    this.mapCanvas.lineTool = this.lineTool;

    this.toolCtx = {
      stateMgr: this.stateMgr,
      undoMgr: this.undoMgr,
      requestRender: () => this.mapCanvas.requestRender(),
      rebuildMinimap: () => {
        this.minimap.rebuild(this.stateMgr.state);
        this.minimap.markDirty();
      },
    };

    // Wire eyedropper callback to update palette
    this.eyedropper.onPick = () => {
      this.tilePalette.updateSelection();
      // Auto-switch back to tile brush after picking
      this.stateMgr.state.activeTool = 'tile';
      this.toolbar.updateActive();
    };

    // Left-click: active tool
    this.mapCanvas.onMouseDown = (wx, wz) => {
      const tool = this.tools[this.stateMgr.state.activeTool];
      tool.onMouseDown(wx, wz, this.toolCtx);
    };
    this.mapCanvas.onMouseMove = (wx, wz, dragging) => {
      const tool = this.tools[this.stateMgr.state.activeTool];
      tool.onMouseMove(wx, wz, dragging, this.toolCtx);
    };
    this.mapCanvas.onMouseUp = (wx, wz) => {
      const tool = this.tools[this.stateMgr.state.activeTool];
      tool.onMouseUp(wx, wz, this.toolCtx);
    };

    // Right-click: spawn context menu or drag
    this.mapCanvas.onRightClick = (wx, wz, screenX, screenY) => {
      if (this.spawnDragger.tryStartDrag(wx, wz, this.toolCtx)) {
        // Started dragging a spawn
      } else {
        this.showContextMenu(wx, wz, screenX, screenY);
      }
    };
    this.mapCanvas.onRightDrag = (wx, wz) => {
      this.spawnDragger.onDrag(wx, wz, this.toolCtx);
    };
    this.mapCanvas.onRightUp = (_wx, _wz) => {
      this.spawnDragger.endDrag(this.toolCtx);
    };

    this.mapCanvas.onCoordsChange = (tx, tz) => {
      const s = this.stateMgr.state;
      if (s.meta.width) {
        const h = s.showHeights ? ` h:${this.stateMgr.getHeight(tx, tz)}` : '';
        const tileType = this.stateMgr.getTile(tx, tz);
        coordsEl.textContent = `${tx}, ${tz} | tile:${tileType}${h}`;
      }
    };

    this.minimap.onClick = (wx, wz) => {
      this.mapCanvas.centerOn(wx, wz);
    };

    // Panels
    this.toolbar = new Toolbar(toolbarEl, this.stateMgr, {
      onToolChange: (tool) => {
        this.stateMgr.state.activeTool = tool;
        if (tool !== 'select') this.stateMgr.state.selection = null;
        this.toolbar.updateActive();
      },
      onSave: () => this.save(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onOpenMap: () => this.mapSelector.show(),
      onZoomToFit: () => this.mapCanvas.zoomToFit(),
      onExport: () => this.exportMap(),
      onImport: () => this.importMap(),
      onReload: () => this.reloadServerMap(),
    });

    this.tilePalette = new TilePalette(leftPanel, this.stateMgr);
    this.propsPanel = new PropertiesPanel(rightPanel, this.stateMgr);
    this.mapSelector = new MapSelector(this.api);
    this.mapSelector.onMapSelected = (mapId) => this.loadMap(mapId);

    this.stateMgr.onChange(() => this.mapCanvas.requestRender());

    // Keyboard
    this.keysDown = new Set();
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.key));
    window.addEventListener('blur', () => this.keysDown.clear());

    // Unsaved changes warning
    window.addEventListener('beforeunload', (e) => {
      if (this.stateMgr.state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Dismiss context menu on click
    window.addEventListener('click', () => this.dismissContextMenu());

    // Main loop
    const tick = () => {
      this.tickPan();
      this.updateMinimapViewport();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    await this.loadDefinitions();

    // Auto-load recent map or show selector
    const recent = this.getRecentMaps();
    if (recent.length > 0) {
      this.loadMap(recent[0]);
    } else {
      this.mapSelector.show();
    }
  }

  // --- Recent maps ---

  private getRecentMaps(): string[] {
    try {
      return JSON.parse(localStorage.getItem(RECENT_MAPS_KEY) || '[]');
    } catch { return []; }
  }

  private pushRecentMap(mapId: string): void {
    const recent = this.getRecentMaps().filter(id => id !== mapId);
    recent.unshift(mapId);
    if (recent.length > 10) recent.length = 10;
    localStorage.setItem(RECENT_MAPS_KEY, JSON.stringify(recent));
  }

  // --- Definitions ---

  private async loadDefinitions(): Promise<void> {
    try {
      const [npcDefs, objectDefs] = await Promise.all([
        this.api.loadNpcDefs(),
        this.api.loadObjectDefs(),
      ]);
      this.stateMgr.state.npcDefs = npcDefs;
      this.stateMgr.state.objectDefs = objectDefs;
    } catch (e) {
      console.error('Failed to load definitions:', e);
    }
  }

  // --- Map loading ---

  private async loadMap(mapId: string): Promise<void> {
    const s = this.stateMgr.state;
    if (s.dirty) {
      if (!confirm('You have unsaved changes. Discard and load new map?')) return;
    }

    try {
      const data = await this.api.loadMap(mapId);
      s.mapId = mapId;
      s.meta = data.meta;
      s.spawns = data.spawns;
      s.tiles = data.tiles;
      s.heights = data.heights;
      s.walls = data.walls;
      s.dirty = false;
      s.selection = null;

      this.mapCanvas.zoom = 4;
      this.mapCanvas.centerOn(s.meta.spawnPoint.x, s.meta.spawnPoint.z);
      this.minimap.rebuild(s);
      this.propsPanel.rebuild();
      this.toolbar.updateActive();
      this.mapCanvas.requestRender();
      this.pushRecentMap(mapId);

      document.title = `ProjectRS Editor - ${s.meta.name}`;
      showToast(`Loaded "${s.meta.name}"`);
    } catch (e: any) {
      showToast('Failed to load map: ' + e.message, true);
    }
  }

  // --- Save ---

  private async save(): Promise<void> {
    const s = this.stateMgr.state;
    if (!s.mapId) { showToast('No map loaded', true); return; }

    try {
      await this.api.saveMap(s.mapId, s.meta, s.spawns, s.tiles, s.heights, s.walls);
      s.dirty = false;
      showToast('Map saved');
    } catch (e: any) {
      showToast('Save failed: ' + e.message, true);
    }
  }

  // --- Server hot-reload ---

  private async reloadServerMap(): Promise<void> {
    const s = this.stateMgr.state;
    if (!s.mapId) { showToast('No map loaded', true); return; }
    if (s.dirty) {
      showToast('Save first before reloading', true);
      return;
    }

    try {
      await this.api.reloadMap(s.mapId);
      showToast('Server map reloaded');
    } catch (e: any) {
      showToast('Reload failed: ' + e.message, true);
    }
  }

  // --- Export/Import ---

  private async exportMap(): Promise<void> {
    const s = this.stateMgr.state;
    if (!s.mapId) { showToast('No map loaded', true); return; }

    try {
      const blob = await this.api.exportMap(s.mapId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${s.mapId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Map exported');
    } catch (e: any) {
      showToast('Export failed: ' + e.message, true);
    }
  }

  private importMap(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const mapId = await this.api.importMap(file);
        showToast(`Imported map "${mapId}"`);
        await this.loadMap(mapId);
      } catch (e: any) {
        showToast('Import failed: ' + e.message, true);
      }
    });
    input.click();
  }

  // --- Undo/Redo ---

  private undo(): void {
    if (this.undoMgr.undo()) {
      this.mapCanvas.requestRender();
      this.minimap.rebuild(this.stateMgr.state);
    }
  }

  private redo(): void {
    if (this.undoMgr.redo()) {
      this.mapCanvas.requestRender();
      this.minimap.rebuild(this.stateMgr.state);
    }
  }

  // --- Copy/Paste ---

  private copySelection(): void {
    const s = this.stateMgr.state;
    if (!s.selection) { showToast('No selection', true); return; }
    s.clipboard = this.stateMgr.copyRegion(s.selection.x, s.selection.z, s.selection.w, s.selection.h);
    showToast(`Copied ${s.selection.w}x${s.selection.h} region`);
  }

  private pasteClipboard(): void {
    const s = this.stateMgr.state;
    if (!s.clipboard) { showToast('Nothing to paste', true); return; }

    // Paste at cursor position
    const tx = Math.floor(this.mapCanvas.mouseWorldX);
    const tz = Math.floor(this.mapCanvas.mouseWorldZ);

    this.undoMgr.beginStroke('tiles');
    for (let dz = 0; dz < s.clipboard.h; dz++) {
      for (let dx = 0; dx < s.clipboard.w; dx++) {
        this.undoMgr.expandRegion(tx + dx, tz + dz);
      }
    }
    // Also capture height undo (use a second stroke)
    this.undoMgr.endStroke();

    this.undoMgr.beginStroke('heights');
    for (let dz = 0; dz <= s.clipboard.h; dz++) {
      for (let dx = 0; dx <= s.clipboard.w; dx++) {
        this.undoMgr.expandRegion(tx + dx, tz + dz);
      }
    }

    this.stateMgr.pasteRegion(tx, tz, s.clipboard);
    this.undoMgr.endStroke();

    this.mapCanvas.requestRender();
    this.minimap.rebuild(s);
    showToast(`Pasted ${s.clipboard.w}x${s.clipboard.h} region at ${tx},${tz}`);
  }

  // --- Context menu ---

  private dismissContextMenu(): void {
    document.querySelectorAll('.context-menu').forEach(el => el.remove());
  }

  private showContextMenu(wx: number, wz: number, screenX: number, screenY: number): void {
    this.dismissContextMenu();

    const s = this.stateMgr.state;
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = screenX + 'px';
    menu.style.top = screenY + 'px';

    const tx = Math.floor(wx);
    const tz = Math.floor(wz);

    // Header
    const header = document.createElement('div');
    header.className = 'context-menu-label';
    header.textContent = `Tile (${tx}, ${tz})`;
    menu.appendChild(header);

    menu.appendChild(this.menuSep());

    // Check if there's a spawn nearby
    const found = this.stateMgr.findSpawnNear(wx, wz, 1.5);
    if (found) {
      const name = found.type === 'npc'
        ? (s.npcDefs.find(d => d.id === found.spawn.npcId)?.name || `NPC#${found.spawn.npcId}`)
        : (s.objectDefs.find(d => d.id === found.spawn.objectId)?.name || `Obj#${found.spawn.objectId}`);

      const infoItem = document.createElement('div');
      infoItem.className = 'context-menu-label';
      infoItem.textContent = `${found.type === 'npc' ? 'NPC' : 'Object'}: ${name} @ ${found.spawn.x}, ${found.spawn.z}`;
      menu.appendChild(infoItem);

      this.addMenuItem(menu, 'Delete spawn', () => {
        const old = this.undoMgr.snapshotSpawns();
        this.stateMgr.removeSpawnNear(wx, wz);
        this.undoMgr.pushSpawnChange(old, this.undoMgr.snapshotSpawns());
        this.mapCanvas.requestRender();
      });

      menu.appendChild(this.menuSep());
    }

    // Eyedropper
    this.addMenuItem(menu, `Pick tile type (${s.tiles[tz * s.meta.width + tx]})`, () => {
      s.selectedTileType = this.stateMgr.getTile(tx, tz);
      this.tilePalette.updateSelection();
    });

    // Teleport spawn point
    this.addMenuItem(menu, 'Set spawn point here', () => {
      s.meta.spawnPoint = { x: tx + 0.5, z: tz + 0.5 };
      s.dirty = true;
      this.propsPanel.rebuild();
      this.mapCanvas.requestRender();
      showToast('Spawn point moved');
    });

    // Place NPC/Object
    this.addMenuItem(menu, `Place NPC here (${s.npcDefs.find(d => d.id === s.selectedNpcId)?.name || s.selectedNpcId})`, () => {
      const old = this.undoMgr.snapshotSpawns();
      this.stateMgr.addNpcSpawn(s.selectedNpcId, tx + 0.5, tz + 0.5);
      this.undoMgr.pushSpawnChange(old, this.undoMgr.snapshotSpawns());
      this.mapCanvas.requestRender();
    });

    this.addMenuItem(menu, `Place Object here (${s.objectDefs.find(d => d.id === s.selectedObjectId)?.name || s.selectedObjectId})`, () => {
      const old = this.undoMgr.snapshotSpawns();
      this.stateMgr.addObjectSpawn(s.selectedObjectId, tx + 0.5, tz + 0.5);
      this.undoMgr.pushSpawnChange(old, this.undoMgr.snapshotSpawns());
      this.mapCanvas.requestRender();
    });

    // Keep menu from going off-screen
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

    // Stop click from immediately dismissing
    setTimeout(() => {
      menu.addEventListener('click', (e) => e.stopPropagation());
    }, 0);
  }

  private addMenuItem(menu: HTMLElement, label: string, onClick: () => void): void {
    const item = document.createElement('div');
    item.className = 'context-menu-item';
    item.textContent = label;
    item.addEventListener('click', () => {
      onClick();
      this.dismissContextMenu();
    });
    menu.appendChild(item);
  }

  private menuSep(): HTMLElement {
    const d = document.createElement('div');
    d.className = 'context-menu-sep';
    return d;
  }

  // --- Pan (arrow keys + WASD) ---

  private tickPan(): void {
    const PAN_SPEED = 400 / this.mapCanvas.zoom;
    const dt = 1 / 60;
    let dx = 0, dz = 0;
    if (this.keysDown.has('ArrowLeft') || this.keysDown.has('a'))  dx -= PAN_SPEED * dt;
    if (this.keysDown.has('ArrowRight') || this.keysDown.has('d')) dx += PAN_SPEED * dt;
    if (this.keysDown.has('ArrowUp') || this.keysDown.has('w'))    dz -= PAN_SPEED * dt;
    if (this.keysDown.has('ArrowDown') || this.keysDown.has('s'))  dz += PAN_SPEED * dt;
    if (dx || dz) {
      this.mapCanvas.scrollX += dx;
      this.mapCanvas.scrollZ += dz;
      this.mapCanvas.requestRender();
    }
  }

  // --- Keyboard ---

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

    this.keysDown.add(e.key);

    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); this.undo(); }
      else if (e.key === 'y' || (e.shiftKey && e.key === 'Z')) { e.preventDefault(); this.redo(); }
      else if (e.key === 's') { e.preventDefault(); this.save(); }
      else if (e.key === 'c') { e.preventDefault(); this.copySelection(); }
      else if (e.key === 'v') { e.preventDefault(); this.pasteClipboard(); }
      return;
    }

    switch (e.key) {
      case '1': this.setTool('tile'); break;
      case '2': this.setTool('height'); break;
      case '3': this.setTool('fill'); break;
      case '4': this.setTool('rect'); break;
      case '5': this.setTool('line'); break;
      case '6': this.setTool('eyedropper'); break;
      case '7': this.setTool('select'); break;
      case '8': this.setTool('npc'); break;
      case '9': this.setTool('object'); break;
      case '0': this.setTool('eraser'); break;
      case '-': this.setTool('wall'); break;
      case 'g': case 'G':
        this.stateMgr.state.showGrid = !this.stateMgr.state.showGrid;
        this.stateMgr.notify();
        break;
      case 'h': case 'H':
        this.stateMgr.state.showHeights = !this.stateMgr.state.showHeights;
        this.stateMgr.notify();
        break;
      case 'f': case 'F':
        this.mapCanvas.zoomToFit();
        break;
      case 'Escape':
        this.stateMgr.state.selection = null;
        this.mapCanvas.requestRender();
        break;
      case 'Delete':
      case 'Backspace':
        // Delete selection contents (fill with current tile type)
        this.deleteSelection();
        break;
    }
  }

  private setTool(tool: EditorTool): void {
    this.stateMgr.state.activeTool = tool;
    if (tool !== 'select') this.stateMgr.state.selection = null;
    this.toolbar.updateActive();
  }

  private deleteSelection(): void {
    const s = this.stateMgr.state;
    if (!s.selection) return;
    const { x, z, w, h } = s.selection;
    this.undoMgr.beginStroke('tiles');
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        this.undoMgr.expandRegion(x + dx, z + dz);
        this.stateMgr.setTile(x + dx, z + dz, s.selectedTileType);
      }
    }
    this.undoMgr.endStroke();
    this.mapCanvas.requestRender();
    this.minimap.rebuild(s);
    showToast(`Filled ${w}x${h} selection`);
  }

  // --- Minimap ---

  private updateMinimapViewport(): void {
    const s = this.stateMgr.state;
    if (!s.meta.width) return;

    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    const viewW = canvas.width / this.mapCanvas.zoom;
    const viewH = canvas.height / this.mapCanvas.zoom;
    this.minimap.drawViewport(this.mapCanvas.scrollX, this.mapCanvas.scrollZ, viewW, viewH, s.meta.width, s.meta.height);
  }
}
