import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';

/**
 * Directional sprite set — 8-direction materials loaded from 4 sprite images.
 * Directions: S, SE, E, NE (from files), N (fallback to NE), NW/W/SW (mirrored).
 * Call updateDirection() each frame with camera angle to swap material.
 */
export interface DirectionalSpriteSet {
  /** Materials for each of 8 directions: S, SE, E, NE, N, NW, W, SW */
  materials: StandardMaterial[];
  /** Whether each direction is mirrored (flip plane X scale) */
  mirrored: boolean[];
}

/**
 * Animation sprite set — 4 cardinal directions x N frames.
 * Used for attack animations etc. West mirrors East.
 */
export interface AnimationSpriteSet {
  /** materials[cardinalIndex][frameIndex] — 4 cardinal dirs x N frames */
  materials: StandardMaterial[][];
  /** Number of frames per direction */
  frameCount: number;
  /** Whether the W direction should mirror (flip X scale) */
  mirrorW: boolean;
  /** Mesh scale factors to match idle sprite pixel density (set after loading) */
  meshScaleX: number;
  meshScaleY: number;
}

/** Direction indices */
const DIR_S = 0, DIR_SE = 1, DIR_E = 2, DIR_NE = 3;
const DIR_N = 4, DIR_NW = 5, DIR_W = 6, DIR_SW = 7;

/** Cardinal indices for animation sprite sets */
const CARD_S = 0, CARD_E = 1, CARD_N = 2, CARD_W = 3;

/**
 * Map 8-direction index to closest cardinal direction index (S/E/N/W).
 * SE→S, NE→E, NW→N, SW→S  (biased toward the facing direction that looks best)
 */
const DIR_TO_CARDINAL: number[] = [
  CARD_S,  // 0: S  → S
  CARD_S,  // 1: SE → S
  CARD_E,  // 2: E  → E
  CARD_E,  // 3: NE → E
  CARD_N,  // 4: N  → N
  CARD_N,  // 5: NW → N
  CARD_W,  // 6: W  → W
  CARD_W,  // 7: SW → W
];

/**
 * Pre-load a directional sprite set from image files.
 * Expects: south.png, south-east.png, east.png, north-east.png in basePath.
 * Optional: north.png (falls back to north-east if missing).
 * W/SW/NW are auto-mirrored from E/SE/NE.
 */
export async function loadDirectionalSprites(scene: Scene, basePath: string, name: string): Promise<DirectionalSpriteSet> {
  const files = ['south.png', 'south-east.png', 'east.png', 'north-east.png', 'north.png'];

  // Also try loading explicit NW, W, SW, N sprites (full 8-direction sets)
  const allFiles = [
    'south.png', 'south-east.png', 'east.png', 'north-east.png',
    'north.png', 'north-west.png', 'west.png', 'south-west.png',
  ];

  // Load all textures, waiting for each to fully load (or fail)
  const textures: (Texture | null)[] = await Promise.all(
    allFiles.map((file) => new Promise<Texture | null>((resolve) => {
      const tex = new Texture(
        `${basePath}/${file}`, scene, false, true, Texture.NEAREST_SAMPLINGMODE,
        () => { tex.hasAlpha = true; resolve(tex); },  // onLoad
        () => { resolve(null); }                         // onError
      );
    }))
  );

  const [texS, texSE, texE, texNE, texN, texNW, texW, texSW] = textures;

  // Fallbacks: use mirrored versions if explicit sprites don't exist
  const texNorth = texN ?? texNE;
  const texNorthWest = texNW ?? texNE;
  const texWest = texW ?? texE;
  const texSouthWest = texSW ?? texSE;

  const makeMat = (label: string, tex: Texture | null): StandardMaterial => {
    const mat = new StandardMaterial(`${name}_${label}`, scene);
    if (tex) {
      mat.diffuseTexture = tex;
      mat.useAlphaFromDiffuseTexture = true;
    }
    mat.specularColor = new Color3(0, 0, 0);
    mat.emissiveColor = new Color3(0.3, 0.3, 0.3);
    mat.backFaceCulling = false;
    return mat;
  };

  const materials = [
    makeMat('S', texS),            // 0: S
    makeMat('SE', texSE),          // 1: SE
    makeMat('E', texE),            // 2: E
    makeMat('NE', texNE),          // 3: NE
    makeMat('N', texNorth),        // 4: N
    makeMat('NW', texNorthWest),   // 5: NW
    makeMat('W', texWest),         // 6: W
    makeMat('SW', texSouthWest),   // 7: SW
  ];

  // Only mirror if using fallback textures (no explicit sprite for that direction)
  const mirrored = [false, false, false, false, false, !texNW, !texW, !texSW];

  return { materials, mirrored };
}

/**
 * Load animation sprites for 4 cardinal directions x N frames.
 * Expects: basePath/south/frame_000.png .. frame_{N-1}.png, etc for east, north, west.
 * West is loaded explicitly if available; otherwise mirrors east.
 */
export async function loadAnimationSprites(
  scene: Scene, basePath: string, name: string, frameCount: number
): Promise<AnimationSpriteSet> {
  const dirs = ['south', 'east', 'north', 'west'];
  const materials: StandardMaterial[][] = [];
  let mirrorW = false;

  for (let d = 0; d < dirs.length; d++) {
    const dirMats: StandardMaterial[] = [];
    for (let f = 0; f < frameCount; f++) {
      const frameStr = String(f).padStart(3, '0');
      const filePath = `${basePath}/${dirs[d]}/frame_${frameStr}.png`;
      const mat = await new Promise<StandardMaterial>((resolve) => {
        const tex = new Texture(
          filePath, scene, false, true, Texture.NEAREST_SAMPLINGMODE,
          () => { tex.hasAlpha = true; resolve(makeMat()); },
          () => { resolve(makeMat()); } // fallback: material with no texture
        );
        function makeMat(): StandardMaterial {
          const m = new StandardMaterial(`${name}_anim_${dirs[d]}_${f}`, scene);
          if (tex.isReady()) m.diffuseTexture = tex;
          m.useAlphaFromDiffuseTexture = true;
          m.specularColor = new Color3(0, 0, 0);
          m.emissiveColor = new Color3(0.3, 0.3, 0.3);
          m.backFaceCulling = false;
          return m;
        }
      });
      dirMats.push(mat);
    }
    materials.push(dirMats);
  }

  // Check if west frames actually loaded (have textures), otherwise mirror east
  if (materials[CARD_W].length > 0 && materials[CARD_W][0].diffuseTexture) {
    mirrorW = false;
  } else {
    // Use east materials for west, and flag mirroring
    materials[CARD_W] = materials[CARD_E];
    mirrorW = true;
  }

  return { materials, frameCount, mirrorW, meshScaleX: 1, meshScaleY: 1 };
}

/**
 * Compute which of 8 direction indices to use based on camera-to-entity angle.
 * Returns 0-7 (S, SE, E, NE, N, NW, W, SW).
 */
export function getDirectionIndex(cameraPos: Vector3, entityPos: Vector3): number {
  // Angle from entity to camera (so we show the side facing the camera)
  const dx = cameraPos.x - entityPos.x;
  const dz = cameraPos.z - entityPos.z;
  let angle = Math.atan2(dx, dz); // 0 = camera south of entity (looking at front)
  if (angle < 0) angle += Math.PI * 2;

  // Quantize to 8 directions (each 45°, offset by 22.5°)
  const idx = Math.round(angle / (Math.PI / 4)) % 8;
  // Map: 0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE, 6=E, 7=SE
  // We want: 0=S, 1=SE, 2=E, 3=NE, 4=N, 5=NW, 6=W, 7=SW
  const remap = [DIR_S, DIR_SW, DIR_W, DIR_NW, DIR_N, DIR_NE, DIR_E, DIR_SE];
  return remap[idx];
}

/**
 * Compute which of 8 direction indices to use based on movement direction
 * AND camera position. Projects movement into screen space so the sprite
 * visually faces the on-screen movement direction.
 *
 * Screen space: right = +screenX, down (toward camera) = +screenY.
 * Sprite convention: DIR_S = front (walking toward camera / down on screen),
 * DIR_E = right-facing, DIR_N = back (away from camera), DIR_W = left-facing.
 */
export function getMovementDirectionIndex(moveDx: number, moveDz: number, cameraPos: Vector3, entityPos: Vector3): number {
  // Camera horizontal angle (entity → camera direction in XZ plane)
  const camDx = cameraPos.x - entityPos.x;
  const camDz = cameraPos.z - entityPos.z;
  const camAngle = Math.atan2(camDx, camDz);

  // Project world movement into screen-space axes:
  // screenRight = perpendicular to camera direction (90° CW in XZ plane)
  // screenDown = toward camera direction
  const cosA = Math.cos(camAngle);
  const sinA = Math.sin(camAngle);
  // "Toward camera" axis = (sinA, cosA) in world XZ
  // "Screen right" axis = 90° CW from toward-camera = (cosA, -sinA) in world XZ
  const screenRight = moveDx * cosA - moveDz * sinA;
  const screenDown  = moveDx * sinA + moveDz * cosA;

  // atan2(-screenRight, screenDown): 0 = toward camera = front
  // Negate screenRight to compensate for billboard Y-rotation flipping the texture horizontally
  let angle = Math.atan2(-screenRight, screenDown);
  if (angle < 0) angle += Math.PI * 2;

  const idx = Math.round(angle / (Math.PI / 4)) % 8;
  // Direct mapping: 0=front(S), 1=front-right(SE), 2=right(E), ...
  const remap = [DIR_S, DIR_SE, DIR_E, DIR_NE, DIR_N, DIR_NW, DIR_W, DIR_SW];
  return remap[idx];
}

export interface SpriteEntityOptions {
  name: string;
  color: Color3;
  width?: number;
  height?: number;
  label?: string;
  labelColor?: string;
  /** If provided, uses directional sprites instead of colored rectangle */
  directionalSprites?: DirectionalSpriteSet;
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
  private baseScaleX: number = 1; // original X scale (for mirroring)

  // Directional sprites
  private dirSprites: DirectionalSpriteSet | null = null;
  private currentDirIndex: number = -1;

  // Attack animation
  private attackAnim: AnimationSpriteSet | null = null;
  private animPlaying: boolean = false;
  private animCardinalIndex: number = 0;
  private animFrameIndex: number = 0;
  private animFrameTimer: number = 0;
  private animFrameDuration: number = 0.125; // 125ms per frame

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
    this.yOffset = height / 2;
    this.baseScaleX = 1;

    // Create billboard plane
    this.plane = MeshBuilder.CreatePlane(
      options.name,
      { width, height },
      scene
    );
    this.plane.billboardMode = Mesh.BILLBOARDMODE_Y;

    if (options.directionalSprites) {
      // Use pre-loaded directional sprite materials
      this.dirSprites = options.directionalSprites;
      this.plane.material = this.dirSprites.materials[DIR_S]; // default: south
      this.currentDirIndex = DIR_S;
    } else {
      // Fallback: colored rectangle with label (original behavior)
      const texSize = 128;
      const texture = new DynamicTexture(`${options.name}_tex`, texSize, scene, false);
      const ctx = texture.getContext();

      ctx.fillStyle = `rgb(${options.color.r * 255}, ${options.color.g * 255}, ${options.color.b * 255})`;
      ctx.fillRect(24, 20, 80, 90);

      ctx.fillStyle = '#eec39a';
      ctx.beginPath();
      ctx.arc(64, 18, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = options.labelColor || '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      (ctx as any).textAlign = 'center';
      ctx.fillText(this.label, 64, 126);

      texture.update();

      const mat = new StandardMaterial(`${options.name}_mat`, scene);
      mat.diffuseTexture = texture;
      mat.specularColor = new Color3(0, 0, 0);
      mat.emissiveColor = new Color3(0.3, 0.3, 0.3);
      mat.backFaceCulling = false;
      texture.hasAlpha = true;
      mat.useAlphaFromDiffuseTexture = true;

      this.plane.material = mat;
    }
  }

  /** Upgrade an existing sprite to use directional sprites (e.g. after async load) */
  setDirectionalSprites(sprites: DirectionalSpriteSet): void {
    this.dirSprites = sprites;
    this.currentDirIndex = DIR_S;
    this.plane.material = sprites.materials[DIR_S];
  }

  /** Attach an attack animation sprite set (call once after loading) */
  setAttackAnimation(anim: AnimationSpriteSet): void {
    this.attackAnim = anim;
  }

  /** Start playing the attack animation based on current facing direction */
  playAttackAnimation(): void {
    if (!this.attackAnim) return;
    this.animCardinalIndex = DIR_TO_CARDINAL[this.currentDirIndex >= 0 ? this.currentDirIndex : DIR_S];
    this.animFrameIndex = 0;
    this.animFrameTimer = 0;
    this.animPlaying = true;
    // Set first frame material
    this.plane.material = this.attackAnim.materials[this.animCardinalIndex][0];
    // Scale mesh to preserve pixel density (attack canvas may differ from idle)
    const mirror = this.animCardinalIndex === CARD_W && this.attackAnim.mirrorW;
    this.plane.scaling.x = (mirror ? -1 : 1) * this.baseScaleX * this.attackAnim.meshScaleX;
    this.plane.scaling.y = this.attackAnim.meshScaleY;
    // Shift Y so feet stay grounded (scale expands from center, push center up)
    this.plane.position.y = this._position.y + this.yOffset * this.attackAnim.meshScaleY;
  }

  /** Advance animation timer. Call every frame with delta time in seconds. */
  updateAnimation(dt: number): void {
    if (!this.animPlaying || !this.attackAnim) return;
    this.animFrameTimer += dt;
    if (this.animFrameTimer >= this.animFrameDuration) {
      this.animFrameTimer -= this.animFrameDuration;
      this.animFrameIndex++;
      if (this.animFrameIndex >= this.attackAnim.frameCount) {
        // Animation finished — restore idle material and mesh scale
        this.animPlaying = false;
        this.plane.scaling.y = 1;
        this.plane.position.y = this._position.y + this.yOffset;
        if (this.dirSprites && this.currentDirIndex >= 0) {
          this.plane.material = this.dirSprites.materials[this.currentDirIndex];
          this.plane.scaling.x = this.dirSprites.mirrored[this.currentDirIndex] ? -this.baseScaleX : this.baseScaleX;
        } else {
          this.plane.scaling.x = this.baseScaleX;
        }
        return;
      }
      // Advance to next frame
      this.plane.material = this.attackAnim.materials[this.animCardinalIndex][this.animFrameIndex];
    }
  }

  /** Whether an animation is currently playing */
  isAnimating(): boolean {
    return this.animPlaying;
  }

  /**
   * Update directional sprite based on camera position.
   * Call each frame for entities with directional sprites.
   */
  updateDirection(cameraPos: Vector3): void {
    if (!this.dirSprites || this.animPlaying) return;
    const idx = getDirectionIndex(cameraPos, this._position);
    if (idx === this.currentDirIndex) return;
    this.currentDirIndex = idx;
    this.plane.material = this.dirSprites.materials[idx];
    // Mirror for W/SW/NW directions
    this.plane.scaling.x = this.dirSprites.mirrored[idx] ? -this.baseScaleX : this.baseScaleX;
  }

  /**
   * Update directional sprite based on movement direction (dx, dz) and camera position.
   * Only updates if the entity is actually moving (dx/dz non-zero).
   */
  updateMovementDirection(dx: number, dz: number, cameraPos: Vector3): void {
    if (!this.dirSprites || this.animPlaying) return;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return; // not moving, keep last direction
    const idx = getMovementDirectionIndex(dx, dz, cameraPos, this._position);
    if (idx === this.currentDirIndex) return;
    this.currentDirIndex = idx;
    this.plane.material = this.dirSprites.materials[idx];
    this.plane.scaling.x = this.dirSprites.mirrored[idx] ? -this.baseScaleX : this.baseScaleX;
  }

  /**
   * Face toward a target position (e.g. combat target).
   * Uses the same screen-space projection as movement direction.
   */
  faceToward(targetPos: Vector3, cameraPos: Vector3): void {
    if (!this.dirSprites || this.animPlaying) return;
    const dx = targetPos.x - this._position.x;
    const dz = targetPos.z - this._position.z;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
    const idx = getMovementDirectionIndex(dx, dz, cameraPos, this._position);
    if (idx === this.currentDirIndex) return;
    this.currentDirIndex = idx;
    this.plane.material = this.dirSprites.materials[idx];
    this.plane.scaling.x = this.dirSprites.mirrored[idx] ? -this.baseScaleX : this.baseScaleX;
  }

  get position(): Vector3 {
    return this._position;
  }

  set position(pos: Vector3) {
    this._position = pos;
    this.plane.position.x = pos.x;
    // During animation, mesh is scaled — adjust Y so feet stay grounded
    const yScale = this.animPlaying && this.attackAnim ? this.attackAnim.meshScaleY : 1;
    this.plane.position.y = pos.y + this.yOffset * yScale;
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
