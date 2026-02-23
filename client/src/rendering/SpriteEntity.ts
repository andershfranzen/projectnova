import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';

export interface SpriteEntityOptions {
  name: string;
  color: Color3;
  width?: number;
  height?: number;
  label?: string;
  labelColor?: string;
}

/**
 * A billboard sprite entity — a 2D plane that always faces the camera.
 * Used for players, NPCs, items on the ground.
 * For MVP, we draw colored rectangles with text labels.
 * Later these will be replaced with actual sprite textures.
 */
export class SpriteEntity {
  private plane: Mesh;
  private scene: Scene;
  private label: string;
  private _position: Vector3 = Vector3.Zero();
  private yOffset: number; // half-height, so feet sit on ground

  // Health bar (HTML overlay)
  private healthBarEl: HTMLDivElement | null = null;
  private healthBarFillEl: HTMLDivElement | null = null;
  private healthBarTextEl: HTMLDivElement | null = null;
  private maxHealth: number = 10;
  private currentHealth: number = 10;
  private healthBarVisible: boolean = false;

  // Chat bubble (HTML overlay — managed externally, we just store the element)
  private chatBubbleEl: HTMLDivElement | null = null;
  private chatBubbleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(scene: Scene, options: SpriteEntityOptions) {
    this.scene = scene;
    this.label = options.label || options.name;

    const width = options.width || 0.8;
    const height = options.height || 1.4;
    this.yOffset = height / 2; // Position plane so bottom edge sits on ground

    // Create billboard plane
    this.plane = MeshBuilder.CreatePlane(
      options.name,
      { width, height },
      scene
    );
    this.plane.billboardMode = Mesh.BILLBOARDMODE_Y; // face camera horizontally

    // Create dynamic texture for the sprite
    const texSize = 128;
    const texture = new DynamicTexture(`${options.name}_tex`, texSize, scene, false);
    const ctx = texture.getContext();

    // Draw character body
    ctx.fillStyle = `rgb(${options.color.r * 255}, ${options.color.g * 255}, ${options.color.b * 255})`;
    ctx.fillRect(24, 20, 80, 90);

    // Draw head
    ctx.fillStyle = '#eec39a'; // skin color
    ctx.beginPath();
    ctx.arc(64, 18, 16, 0, Math.PI * 2);
    ctx.fill();

    // Draw name label
    ctx.fillStyle = options.labelColor || '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    (ctx as any).textAlign = 'center';
    ctx.fillText(this.label, 64, 126);

    texture.update();

    const mat = new StandardMaterial(`${options.name}_mat`, scene);
    mat.diffuseTexture = texture;
    mat.specularColor = new Color3(0, 0, 0);
    mat.emissiveColor = new Color3(0.3, 0.3, 0.3); // Slight glow so visible in shadow
    mat.backFaceCulling = false;
    // Enable transparency for the texture
    texture.hasAlpha = true;
    mat.useAlphaFromDiffuseTexture = true;

    this.plane.material = mat;
  }

  get position(): Vector3 {
    return this._position;
  }

  set position(pos: Vector3) {
    this._position = pos;
    this.plane.position.x = pos.x;
    this.plane.position.y = pos.y + this.yOffset; // Bottom edge sits on ground
    this.plane.position.z = pos.z;
  }

  showHealthBar(current: number, max: number): void {
    this.currentHealth = current;
    this.maxHealth = max;
    this.healthBarVisible = true;

    if (!this.healthBarEl) {
      // Container
      this.healthBarEl = document.createElement('div');
      this.healthBarEl.className = 'entity-health-bar';
      this.healthBarEl.style.cssText = `
        position: fixed; pointer-events: none; z-index: 150;
        width: 48px; height: 8px;
        background: #400; border: 1px solid #000;
        transform: translate(-50%, -50%);
        border-radius: 1px; overflow: hidden;
      `;

      // Fill bar
      this.healthBarFillEl = document.createElement('div');
      this.healthBarFillEl.style.cssText = `
        height: 100%; transition: width 0.15s, background 0.15s;
      `;
      this.healthBarEl.appendChild(this.healthBarFillEl);

      // HP text
      this.healthBarTextEl = document.createElement('div');
      this.healthBarTextEl.style.cssText = `
        position: absolute; top: -1px; left: 0; right: 0;
        text-align: center; font-family: monospace;
        font-size: 8px; font-weight: bold; color: #fff;
        text-shadow: 1px 1px 0 #000, -1px -1px 0 #000;
        line-height: 10px; pointer-events: none;
      `;
      this.healthBarEl.appendChild(this.healthBarTextEl);

      document.body.appendChild(this.healthBarEl);
    }

    const ratio = Math.max(0, current / max);
    this.healthBarFillEl!.style.width = `${ratio * 100}%`;

    // Color: green → yellow → red
    if (ratio > 0.5) {
      this.healthBarFillEl!.style.background = '#0b0';
    } else if (ratio > 0.25) {
      this.healthBarFillEl!.style.background = '#bb0';
    } else {
      this.healthBarFillEl!.style.background = '#b00';
    }

    this.healthBarTextEl!.textContent = `${current}/${max}`;
  }

  hideHealthBar(): void {
    this.healthBarVisible = false;
    if (this.healthBarEl) {
      this.healthBarEl.remove();
      this.healthBarEl = null;
      this.healthBarFillEl = null;
      this.healthBarTextEl = null;
    }
  }

  /** Returns the world position where the health bar should be rendered */
  getHealthBarWorldPos(): Vector3 | null {
    if (!this.healthBarVisible || !this.healthBarEl) return null;
    return new Vector3(this._position.x, this._position.y + this.yOffset * 2 + 0.3, this._position.z);
  }

  /** Update the health bar screen position */
  updateHealthBarScreenPos(screenX: number, screenY: number): void {
    if (this.healthBarEl) {
      this.healthBarEl.style.left = `${screenX}px`;
      this.healthBarEl.style.top = `${screenY}px`;
    }
  }

  hasHealthBar(): boolean {
    return this.healthBarVisible && this.healthBarEl !== null;
  }

  showChatBubble(message: string, duration: number = 5000): void {
    this.hideChatBubble();

    const text = message.length > 80 ? message.substring(0, 77) + '...' : message;

    const el = document.createElement('div');
    el.className = 'chat-bubble-overlay';
    el.textContent = text;
    el.style.cssText = `
      position: fixed; pointer-events: none; z-index: 200;
      background: rgba(0, 0, 0, 0.8); color: #fff;
      font-family: monospace; font-size: 13px;
      padding: 4px 10px; border-radius: 6px;
      border: 1px solid #5a4a35; white-space: nowrap;
      transform: translate(-50%, -100%);
      text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(el);
    this.chatBubbleEl = el;

    this.chatBubbleTimer = setTimeout(() => {
      this.hideChatBubble();
    }, duration);
  }

  hideChatBubble(): void {
    if (this.chatBubbleTimer) {
      clearTimeout(this.chatBubbleTimer);
      this.chatBubbleTimer = null;
    }
    if (this.chatBubbleEl) {
      this.chatBubbleEl.remove();
      this.chatBubbleEl = null;
    }
  }

  /** Returns the world position where the chat bubble should appear (above head) */
  getChatBubbleWorldPos(): Vector3 | null {
    if (!this.chatBubbleEl) return null;
    return new Vector3(this._position.x, this._position.y + this.yOffset * 2 + 0.6, this._position.z);
  }

  /** Update the screen position of the chat bubble HTML element */
  updateChatBubbleScreenPos(screenX: number, screenY: number): void {
    if (this.chatBubbleEl) {
      this.chatBubbleEl.style.left = `${screenX}px`;
      this.chatBubbleEl.style.top = `${screenY}px`;
    }
  }

  hasChatBubble(): boolean {
    return this.chatBubbleEl !== null;
  }

  dispose(): void {
    this.hideChatBubble();
    this.hideHealthBar();
    this.plane.dispose();
  }

  getMesh(): Mesh {
    return this.plane;
  }
}
