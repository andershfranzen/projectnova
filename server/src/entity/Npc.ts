import { Entity } from './Entity';
import type { NpcDef } from '@projectrs/shared';

export class Npc extends Entity {
  readonly npcId: number; // Definition ID
  readonly def: NpcDef;
  readonly spawnX: number;
  readonly spawnZ: number;

  // AI
  wanderCooldown: number = 0;
  combatTarget: Entity | null = null;
  attackCooldown: number = 0;
  returning: boolean = false; // Walking back to spawn after leash

  // Death / respawn
  dead: boolean = false;
  respawnTimer: number = 0;

  // OSRS-style leash: retreat max range (how far NPC can be from spawn in combat)
  static readonly RETREAT_MAX_RANGE = 7;
  // Retreat interaction range: if target is this far from spawn, NPC drops combat
  static readonly RETREAT_INTERACTION_RANGE = 18;

  constructor(def: NpcDef, x: number, z: number) {
    super(def.name, x, z, def.health);
    this.npcId = def.id;
    this.def = def;
    this.spawnX = x;
    this.spawnZ = z;
  }

  processAI(isBlocked: (x: number, z: number) => boolean): void {
    if (this.dead) return;

    // Returning to spawn after losing combat target (walk back)
    if (this.returning) {
      const dx = this.spawnX - this.position.x;
      const dz = this.spawnZ - this.position.y;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.5) {
        this.position.x = this.spawnX;
        this.position.y = this.spawnZ;
        this.returning = false;
        return;
      }
      this.stepToward(this.spawnX, this.spawnZ, isBlocked);
      return;
    }

    // In combat with a target
    if (this.combatTarget) {
      // Snap to tile center to prevent drifting between tiles
      this.position.x = Math.floor(this.position.x) + 0.5;
      this.position.y = Math.floor(this.position.y) + 0.5;
      const targetX = this.combatTarget.position.x;
      const targetZ = this.combatTarget.position.y;
      const dx = targetX - this.position.x;
      const dz = targetZ - this.position.y;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Non-aggressive NPCs: retaliate in place only, don't chase.
      // If target walks out of melee range, drop combat and return to spawn.
      if (!this.def.aggressive) {
        if (dist > 1.5) {
          this.combatTarget = null;
          this.returning = true;
        }
        return;
      }

      // Aggressive NPCs: chase with OSRS-style leash

      // Drop combat if target is too far from NPC spawn
      const dxSpawn = Math.abs(targetX - this.spawnX);
      const dzSpawn = Math.abs(targetZ - this.spawnZ);
      if (dxSpawn > Npc.RETREAT_INTERACTION_RANGE || dzSpawn > Npc.RETREAT_INTERACTION_RANGE) {
        this.combatTarget = null;
        this.returning = true;
        return;
      }

      // NPC won't move further than retreat max range from its spawn
      const npcDxSpawn = Math.abs(this.position.x - this.spawnX);
      const npcDzSpawn = Math.abs(this.position.y - this.spawnZ);
      if (npcDxSpawn > Npc.RETREAT_MAX_RANGE || npcDzSpawn > Npc.RETREAT_MAX_RANGE) {
        this.combatTarget = null;
        this.returning = true;
        return;
      }

      // Chase toward target if not in melee range (but don't step onto target's tile)
      if (dist > 1.5) {
        const sx = dx !== 0 ? Math.sign(dx) : 0;
        const sz = dz !== 0 ? Math.sign(dz) : 0;
        const nx = this.position.x + sx;
        const nz = this.position.y + sz;
        if (Math.abs(nx - this.spawnX) <= Npc.RETREAT_MAX_RANGE &&
            Math.abs(nz - this.spawnZ) <= Npc.RETREAT_MAX_RANGE) {
          const targetTileX = Math.floor(targetX);
          const targetTileZ = Math.floor(targetZ);
          this.stepTowardAvoidTile(targetX, targetZ, targetTileX, targetTileZ, isBlocked);
        } else {
          this.combatTarget = null;
          this.returning = true;
        }
      }
      return;
    }

    // Wander behavior (only when not in combat)
    if (this.def.wanderRange > 0) {
      this.wanderCooldown--;
      if (this.wanderCooldown <= 0) {
        this.wanderCooldown = 5 + Math.floor(Math.random() * 10); // 5-15 ticks

        // Pick a random direction
        const dirs = [
          { x: -1, z: 0 },
          { x: 1, z: 0 },
          { x: 0, z: -1 },
          { x: 0, z: 1 },
        ];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        const nx = this.position.x + dir.x;
        const nz = this.position.y + dir.z;

        // Check within wander range of spawn
        const dxSpawn = nx - this.spawnX;
        const dzSpawn = nz - this.spawnZ;
        if (
          Math.abs(dxSpawn) <= this.def.wanderRange &&
          Math.abs(dzSpawn) <= this.def.wanderRange &&
          !isBlocked(nx, nz)
        ) {
          this.position.x = nx;
          this.position.y = nz;
        }
      }
    }
  }

  /** Step one tile toward (tx, tz) but avoid landing on (avoidTileX, avoidTileZ) */
  private stepTowardAvoidTile(
    tx: number, tz: number,
    avoidTileX: number, avoidTileZ: number,
    isBlocked: (x: number, z: number) => boolean
  ): void {
    const dx = tx - this.position.x;
    const dz = tz - this.position.y;
    const sx = dx !== 0 ? Math.sign(dx) : 0;
    const sz = dz !== 0 ? Math.sign(dz) : 0;
    const onAvoid = (px: number, pz: number) =>
      Math.floor(px) === avoidTileX && Math.floor(pz) === avoidTileZ;

    if (sx !== 0 && sz !== 0 && !isBlocked(this.position.x + sx, this.position.y + sz) && !onAvoid(this.position.x + sx, this.position.y + sz)) {
      this.position.x += sx;
      this.position.y += sz;
    } else if (sx !== 0 && !isBlocked(this.position.x + sx, this.position.y) && !onAvoid(this.position.x + sx, this.position.y)) {
      this.position.x += sx;
    } else if (sz !== 0 && !isBlocked(this.position.x, this.position.y + sz) && !onAvoid(this.position.x, this.position.y + sz)) {
      this.position.y += sz;
    }
  }

  /** Step one tile toward (tx, tz), trying diagonal first then cardinal */
  private stepToward(tx: number, tz: number, isBlocked: (x: number, z: number) => boolean): void {
    const dx = tx - this.position.x;
    const dz = tz - this.position.y;
    const sx = dx !== 0 ? Math.sign(dx) : 0;
    const sz = dz !== 0 ? Math.sign(dz) : 0;

    // Try diagonal
    if (sx !== 0 && sz !== 0 && !isBlocked(this.position.x + sx, this.position.y + sz)) {
      this.position.x += sx;
      this.position.y += sz;
    } else if (sx !== 0 && !isBlocked(this.position.x + sx, this.position.y)) {
      this.position.x += sx;
    } else if (sz !== 0 && !isBlocked(this.position.x, this.position.y + sz)) {
      this.position.y += sz;
    }
  }

  die(): void {
    this.dead = true;
    this.health = 0;
    this.combatTarget = null;
    this.respawnTimer = this.def.respawnTime;
  }

  respawn(): void {
    this.dead = false;
    this.health = this.maxHealth;
    this.position.x = this.spawnX;
    this.position.y = this.spawnZ;
    this.combatTarget = null;
    this.attackCooldown = 0;
    this.wanderCooldown = 0;
    this.returning = false;
  }

  tickRespawn(): boolean {
    if (!this.dead) return false;
    this.respawnTimer--;
    if (this.respawnTimer <= 0) {
      this.respawn();
      return true; // Respawned
    }
    return false;
  }
}
