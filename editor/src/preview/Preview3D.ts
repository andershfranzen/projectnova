import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/core/Culling/ray';
import { EditorChunkManager, convertEditorState } from './EditorChunkManager';
import { EditorCamera } from './EditorCamera';
import { SpawnMarkers } from './SpawnMarkers';
import type { EditorState } from '../state/EditorState';
import type { EditorMapData } from './EditorChunkManager';

export class Preview3D {
  private canvas: HTMLCanvasElement;
  private engine: Engine;
  private scene: Scene;
  private camera: EditorCamera;
  private chunkMgr: EditorChunkManager;
  private spawnMarkers: SpawnMarkers;
  private active = false;
  private mapData: EditorMapData | null = null;
  private fogEnabled = false;
  private lastState: EditorState | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, { antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.4, 0.6, 0.9, 1.0);

    // Lighting — same as game client
    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.5;
    ambient.groundColor = new Color3(0.3, 0.3, 0.35);

    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.3), this.scene);
    sun.intensity = 0.8;

    this.camera = new EditorCamera(this.scene, canvas);
    this.chunkMgr = new EditorChunkManager(this.scene);
    this.spawnMarkers = new SpawnMarkers(this.scene);

    // Left-click on terrain to move camera target there
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.active) return;
      const pick = this.scene.pick(e.offsetX, e.offsetY, (m) => m.name.startsWith('chunk_'));
      if (pick?.hit && pick.pickedPoint) {
        this.camera.setTarget(pick.pickedPoint.x, pick.pickedPoint.y, pick.pickedPoint.z);
      }
    });
  }

  loadFromState(state: EditorState): void {
    this.lastState = state;
    this.mapData = convertEditorState(state);
    this.chunkMgr.setMapData(this.mapData);
    this.applyFog();

    const sp = state.meta.spawnPoint;
    this.camera.setTarget(sp.x, 0, sp.z);

    this.rebuildSpawns(state);
  }

  /** Refresh map data from editor state (for live updates) */
  refreshData(state: EditorState): void {
    this.mapData = convertEditorState(state);
    this.chunkMgr.setMapData(this.mapData);
  }

  private applyFog(): void {
    if (this.fogEnabled && this.lastState) {
      const meta = this.lastState.meta;
      this.scene.fogMode = Scene.FOGMODE_LINEAR;
      this.scene.fogColor = new Color3(meta.fogColor[0], meta.fogColor[1], meta.fogColor[2]);
      this.scene.fogStart = meta.fogStart;
      this.scene.fogEnd = meta.fogEnd;
      this.scene.clearColor = new Color4(meta.fogColor[0], meta.fogColor[1], meta.fogColor[2], 1.0);
    } else {
      this.scene.fogMode = Scene.FOGMODE_NONE;
      this.scene.clearColor = new Color4(0.4, 0.6, 0.9, 1.0);
    }
  }

  toggleFog(): void {
    this.fogEnabled = !this.fogEnabled;
    this.applyFog();
  }

  isFogEnabled(): boolean { return this.fogEnabled; }

  markDirty(tileX: number, tileZ: number): void {
    this.chunkMgr.markTileDirty(tileX, tileZ);
  }

  rebuildSpawns(state: EditorState): void {
    if (!this.mapData) return;
    const data = this.mapData;
    this.spawnMarkers.rebuild(state.spawns, (x, z) => {
      const vw = data.mapWidth + 1;
      const ix = Math.floor(x);
      const iz = Math.floor(z);
      if (ix < 0 || ix >= data.mapWidth || iz < 0 || iz >= data.mapHeight) return 0;
      const fx = x - ix;
      const fz = z - iz;
      const h00 = data.heights[iz * vw + ix];
      const h10 = data.heights[iz * vw + ix + 1];
      const h01 = data.heights[(iz + 1) * vw + ix];
      const h11 = data.heights[(iz + 1) * vw + ix + 1];
      return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
    });
  }

  start(): void {
    this.active = true;
    let lastTime = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      this.camera.update(dt);
      this.chunkMgr.updateCameraPosition(
        this.camera.getTargetX(),
        this.camera.getTargetZ()
      );
      this.chunkMgr.rebuildDirtyChunks();
      this.scene.render();
    });
  }

  stop(): void {
    this.active = false;
    this.engine.stopRenderLoop();
  }

  resize(): void {
    this.engine.resize();
  }

  dispose(): void {
    this.stop();
    this.spawnMarkers.dispose();
    this.chunkMgr.disposeAll();
    this.scene.dispose();
    this.engine.dispose();
  }

  isActive(): boolean { return this.active; }

  getCameraTargetX(): number { return this.camera.getTargetX(); }
  getCameraTargetZ(): number { return this.camera.getTargetZ(); }
  getCameraRadius(): number { return this.camera.getRadius(); }
  setCameraTarget(x: number, z: number): void { this.camera.setTarget(x, 0, z); }

  handleKeyDown(key: string): void { this.camera.handleKeyDown(key); }
  handleKeyUp(key: string): void { this.camera.handleKeyUp(key); }
  clearKeys(): void { this.camera.clearKeys(); }
}
