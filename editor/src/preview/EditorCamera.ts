import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

export class EditorCamera {
  private camera: ArcRotateCamera;
  private keysDown: Set<string> = new Set();
  private moveSpeed = 30;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.camera = new ArcRotateCamera(
      'editorCamera',
      -Math.PI / 4,
      Math.PI / 3.2,
      40,
      new Vector3(0, 0, 0),
      scene
    );

    this.camera.lowerBetaLimit = 0.1;
    this.camera.upperBetaLimit = Math.PI / 2.1;
    this.camera.lowerRadiusLimit = 5;
    this.camera.upperRadiusLimit = 200;

    this.camera.panningSensibility = 50;
    this.camera.inertia = 0.85;
    this.camera.panningInertia = 0.85;

    this.camera.attachControl(canvas, true);

    // Right-mouse orbit, middle-mouse pan, no drag-zoom (scroll handles it)
    (this.camera.inputs.attached.pointers as any).buttons = [2, -1, 1];

    // Remove built-in keyboard — we handle WASD
    this.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
  }

  update(dt: number): void {
    let dx = 0, dz = 0;
    if (this.keysDown.has('w') || this.keysDown.has('ArrowUp'))    dz -= this.moveSpeed * dt;
    if (this.keysDown.has('s') || this.keysDown.has('ArrowDown'))  dz += this.moveSpeed * dt;
    if (this.keysDown.has('a') || this.keysDown.has('ArrowLeft'))  dx -= this.moveSpeed * dt;
    if (this.keysDown.has('d') || this.keysDown.has('ArrowRight')) dx += this.moveSpeed * dt;

    if (dx || dz) {
      const cos = Math.cos(this.camera.alpha);
      const sin = Math.sin(this.camera.alpha);
      const rx = dx * cos - dz * sin;
      const rz = -dx * sin - dz * cos;
      this.camera.target.x += rx;
      this.camera.target.z += rz;
    }
  }

  setTarget(x: number, y: number, z: number): void {
    this.camera.target.set(x, y, z);
  }

  getTargetX(): number { return this.camera.target.x; }
  getTargetZ(): number { return this.camera.target.z; }
  getRadius(): number { return this.camera.radius; }
  getCamera(): ArcRotateCamera { return this.camera; }

  handleKeyDown(key: string): void { this.keysDown.add(key); }
  handleKeyUp(key: string): void { this.keysDown.delete(key); }
  clearKeys(): void { this.keysDown.clear(); }
}
