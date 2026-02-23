import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
// Side-effect import required for scene.pick() to work with tree-shaking
import '@babylonjs/core/Culling/ray';

export type GroundClickCallback = (worldX: number, worldZ: number) => void;

/**
 * Handles mouse/keyboard input for the game.
 * Click-to-move: detects clicks on the terrain and reports world coordinates.
 */
export class InputManager {
  private scene: Scene;
  private groundMesh: Mesh;
  private onGroundClick: GroundClickCallback | null = null;

  constructor(scene: Scene, groundMesh: Mesh) {
    this.scene = scene;
    this.groundMesh = groundMesh;

    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        // Only left click
        if (pointerInfo.event.button !== 0) return;

        const pickResult = this.scene.pick(
          this.scene.pointerX,
          this.scene.pointerY,
          (mesh) => mesh === this.groundMesh
        );

        if (pickResult?.hit && pickResult.pickedPoint) {
          const point = pickResult.pickedPoint;
          this.onGroundClick?.(point.x, point.z);
        }
      }
    });
  }

  setGroundClickHandler(callback: GroundClickCallback): void {
    this.onGroundClick = callback;
  }
}
