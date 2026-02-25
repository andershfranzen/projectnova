import type { StateManager } from '../state/EditorState';
import { TileRenderer } from './TileRenderer';
import { HeightRenderer } from './HeightRenderer';
import { SpawnRenderer } from './SpawnRenderer';
import { GridOverlay } from './GridOverlay';
import { WallRenderer } from './WallRenderer';
import type { RectTool } from '../tools/RectTool';
import type { LineTool } from '../tools/LineTool';

export class MapCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;

  // View transform: screen = (world - scroll) * zoom
  scrollX = 0;
  scrollZ = 0;
  zoom = 1;

  private tileRenderer: TileRenderer;
  private heightRenderer: HeightRenderer;
  private spawnRenderer: SpawnRenderer;
  private gridOverlay: GridOverlay;
  private wallRenderer: WallRenderer;

  // Interaction
  private isPanning = false;
  private lastMouseX = 0;
  private lastMouseZ = 0;
  mouseWorldX = 0;
  mouseWorldZ = 0;

  // Callbacks
  onMouseDown?: (worldX: number, worldZ: number, button: number) => void;
  onMouseMove?: (worldX: number, worldZ: number, dragging: boolean) => void;
  onMouseUp?: (worldX: number, worldZ: number) => void;
  onRightClick?: (worldX: number, worldZ: number, screenX: number, screenY: number) => void;
  onRightDrag?: (worldX: number, worldZ: number) => void;
  onRightUp?: (worldX: number, worldZ: number) => void;
  onCoordsChange?: (tileX: number, tileZ: number) => void;

  // Tool preview references (set by EditorApp)
  rectTool?: RectTool;
  lineTool?: LineTool;

  private stateMgr: StateManager;
  private needsRender = true;
  private rafId = 0;
  private rightDown = false;

  constructor(canvas: HTMLCanvasElement, container: HTMLElement, stateMgr: StateManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.container = container;
    this.stateMgr = stateMgr;

    this.tileRenderer = new TileRenderer();
    this.heightRenderer = new HeightRenderer();
    this.spawnRenderer = new SpawnRenderer();
    this.gridOverlay = new GridOverlay();
    this.wallRenderer = new WallRenderer(stateMgr);

    this.setupEvents();
    this.resize();

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);

    this.renderLoop();
  }

  private setupEvents(): void {
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => { this.isPanning = false; });
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.requestRender();
  }

  screenToWorld(sx: number, sz: number): [number, number] {
    return [sx / this.zoom + this.scrollX, sz / this.zoom + this.scrollZ];
  }

  worldToScreen(wx: number, wz: number): [number, number] {
    return [(wx - this.scrollX) * this.zoom, (wz - this.scrollZ) * this.zoom];
  }

  centerOn(wx: number, wz: number): void {
    this.scrollX = wx - this.canvas.width / (2 * this.zoom);
    this.scrollZ = wz - this.canvas.height / (2 * this.zoom);
    this.requestRender();
  }

  zoomToFit(): void {
    const s = this.stateMgr.state;
    if (!s.meta.width || !s.meta.height) return;
    const zx = this.canvas.width / s.meta.width;
    const zz = this.canvas.height / s.meta.height;
    this.zoom = Math.min(zx, zz) * 0.95;
    this.centerOn(s.meta.width / 2, s.meta.height / 2);
  }

  private handleMouseDown(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sz = e.clientY - rect.top;
    const [wx, wz] = this.screenToWorld(sx, sz);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.isPanning = true;
      this.lastMouseX = e.clientX;
      this.lastMouseZ = e.clientY;
      e.preventDefault();
      return;
    }

    if (e.button === 2) {
      this.rightDown = true;
      this.onRightClick?.(wx, wz, e.clientX, e.clientY);
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      this.onMouseDown?.(wx, wz, 0);
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sz = e.clientY - rect.top;
    const [wx, wz] = this.screenToWorld(sx, sz);
    this.mouseWorldX = wx;
    this.mouseWorldZ = wz;

    if (this.isPanning) {
      const dx = e.clientX - this.lastMouseX;
      const dz = e.clientY - this.lastMouseZ;
      this.scrollX -= dx / this.zoom;
      this.scrollZ -= dz / this.zoom;
      this.lastMouseX = e.clientX;
      this.lastMouseZ = e.clientY;
      this.requestRender();
      return;
    }

    if (this.rightDown && (e.buttons & 2)) {
      this.onRightDrag?.(wx, wz);
      this.requestRender();
      return;
    }

    const tileX = Math.floor(wx);
    const tileZ = Math.floor(wz);
    this.onCoordsChange?.(tileX, tileZ);

    const dragging = (e.buttons & 1) !== 0;
    this.onMouseMove?.(wx, wz, dragging);
    this.requestRender();
  }

  private handleMouseUp(e: MouseEvent): void {
    if (this.isPanning && (e.button === 1 || e.button === 0)) {
      this.isPanning = false;
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sz = e.clientY - rect.top;
    const [wx, wz] = this.screenToWorld(sx, sz);

    if (e.button === 2) {
      this.rightDown = false;
      this.onRightUp?.(wx, wz);
      return;
    }

    this.onMouseUp?.(wx, wz);
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sz = e.clientY - rect.top;

    const [wx, wz] = this.screenToWorld(sx, sz);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.1, Math.min(64, this.zoom * factor));

    this.scrollX = wx - sx / newZoom;
    this.scrollZ = wz - sz / newZoom;
    this.zoom = newZoom;
    this.requestRender();
  }

  requestRender(): void {
    this.needsRender = true;
  }

  private renderLoop = (): void => {
    if (this.needsRender) {
      this.needsRender = false;
      this.render();
    }
    this.rafId = requestAnimationFrame(this.renderLoop);
  };

  private render(): void {
    const { ctx, canvas, zoom } = this;
    const s = this.stateMgr.state;
    if (!s.meta.width || !s.meta.height) return;

    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const startTileX = Math.max(0, Math.floor(this.scrollX));
    const startTileZ = Math.max(0, Math.floor(this.scrollZ));
    const endTileX = Math.min(s.meta.width, Math.ceil(this.scrollX + canvas.width / zoom));
    const endTileZ = Math.min(s.meta.height, Math.ceil(this.scrollZ + canvas.height / zoom));

    if (endTileX <= startTileX || endTileZ <= startTileZ) return;

    this.tileRenderer.render(ctx, s, this.scrollX, this.scrollZ, zoom, startTileX, startTileZ, endTileX, endTileZ, canvas.width, canvas.height);

    if (s.showHeights) {
      this.heightRenderer.render(ctx, s, this.scrollX, this.scrollZ, zoom, startTileX, startTileZ, endTileX, endTileZ);
    }

    if (s.showGrid && zoom >= 4) {
      this.gridOverlay.render(ctx, s, this.scrollX, this.scrollZ, zoom, startTileX, startTileZ, endTileX, endTileZ);
    }

    if (s.showWalls) {
      const offsetX = -this.scrollX * zoom;
      const offsetZ = -this.scrollZ * zoom;
      this.wallRenderer.render(ctx, zoom, offsetX, offsetZ, canvas.width, canvas.height);
    }

    if (s.showSpawns) {
      this.spawnRenderer.render(ctx, s, this.scrollX, this.scrollZ, zoom);
    }

    // Selection rectangle
    if (s.selection) {
      const [sx, sz] = this.worldToScreen(s.selection.x, s.selection.z);
      const sw = s.selection.w * zoom;
      const sh = s.selection.h * zoom;
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sx, sz, sw, sh);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(100, 200, 255, 0.1)';
      ctx.fillRect(sx, sz, sw, sh);
    }

    // Rect tool preview
    if (this.rectTool?.preview) {
      const p = this.rectTool.preview;
      const [sx, sz] = this.worldToScreen(p.x, p.z);
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(sx, sz, p.w * zoom, p.h * zoom);
      ctx.setLineDash([]);
    }

    // Line tool preview
    if (this.lineTool?.preview) {
      const p = this.lineTool.preview;
      const [sx0, sz0] = this.worldToScreen(p.x0 + 0.5, p.z0 + 0.5);
      const [sx1, sz1] = this.worldToScreen(p.x1 + 0.5, p.z1 + 0.5);
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx0, sz0);
      ctx.lineTo(sx1, sz1);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Brush cursor
    this.renderBrushCursor(ctx, s);
  }

  private renderBrushCursor(ctx: CanvasRenderingContext2D, s: import('../state/EditorState').EditorState): void {
    if (s.activeTool !== 'tile' && s.activeTool !== 'height' && s.activeTool !== 'line') return;

    const half = Math.floor(s.brushSize / 2);
    const tileX = Math.floor(this.mouseWorldX) - half;
    const tileZ = Math.floor(this.mouseWorldZ) - half;

    const [sx, sz] = this.worldToScreen(tileX, tileZ);
    const size = s.brushSize * this.zoom;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, sz, size, size);
  }
}
