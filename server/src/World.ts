import { TICK_RATE, ServerOpcode, ALL_SKILLS, type SkillId, type ItemDef } from '@projectrs/shared';
import { encodePacket } from '@projectrs/shared';
import { GameMap } from './GameMap';
import { Player, type EquipSlot } from './entity/Player';
import { Npc } from './entity/Npc';
import { DataLoader } from './data/DataLoader';
import { GameDatabase } from './Database';
import { processPlayerCombat, processNpcCombat, rollLoot } from './combat/Combat';
import { broadcastPlayerInfo } from './network/ChatSocket';

export interface GroundItem {
  id: number;
  itemId: number;
  quantity: number;
  x: number;
  z: number;
  despawnTimer: number;
}

let nextGroundItemId = 1;

export class World {
  readonly map: GameMap;
  readonly data: DataLoader;
  readonly db: GameDatabase;
  readonly players: Map<number, Player> = new Map();
  readonly npcs: Map<number, Npc> = new Map();
  readonly groundItems: Map<number, GroundItem> = new Map();

  private currentTick: number = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  // Player combat targets (playerId -> npcId)
  private playerCombatTargets: Map<number, number> = new Map();

  constructor(db: GameDatabase) {
    this.db = db;
    this.map = new GameMap();
    this.data = new DataLoader();
    this.spawnNpcs();
  }

  private spawnNpcs(): void {
    // Chickens near the farm
    const chickenDef = this.data.getNpc(1)!;
    this.addNpc(new Npc(chickenDef, 55.5, 60.5));
    this.addNpc(new Npc(chickenDef, 57.5, 62.5));
    this.addNpc(new Npc(chickenDef, 53.5, 61.5));

    // Rats near the stone area
    const ratDef = this.data.getNpc(2)!;
    this.addNpc(new Npc(ratDef, 14.5, 14.5));
    this.addNpc(new Npc(ratDef, 16.5, 12.5));
    this.addNpc(new Npc(ratDef, 13.5, 16.5));

    // Goblins in the goblin camp
    const goblinDef = this.data.getNpc(3)!;
    this.addNpc(new Npc(goblinDef, 20.5, 70.5));
    this.addNpc(new Npc(goblinDef, 22.5, 72.5));
    this.addNpc(new Npc(goblinDef, 18.5, 71.5));
    this.addNpc(new Npc(goblinDef, 21.5, 74.5));

    // Wolves in the forest
    const wolfDef = this.data.getNpc(4)!;
    this.addNpc(new Npc(wolfDef, 70.5, 20.5));
    this.addNpc(new Npc(wolfDef, 73.5, 22.5));

    // Skeletons in the dungeon/dark area
    const skelDef = this.data.getNpc(5)!;
    this.addNpc(new Npc(skelDef, 80.5, 80.5));
    this.addNpc(new Npc(skelDef, 82.5, 78.5));
    this.addNpc(new Npc(skelDef, 78.5, 82.5));

    // Spiders in the forest
    const spiderDef = this.data.getNpc(6)!;
    this.addNpc(new Npc(spiderDef, 68.5, 25.5));
    this.addNpc(new Npc(spiderDef, 72.5, 28.5));

    // Guard near the village center
    const guardDef = this.data.getNpc(7)!;
    this.addNpc(new Npc(guardDef, 48.5, 48.5));
    this.addNpc(new Npc(guardDef, 50.5, 46.5));

    // Shopkeeper inside building
    const shopkeeperDef = this.data.getNpc(8)!;
    this.addNpc(new Npc(shopkeeperDef, 42.5, 52.5));

    // Dark Knight boss
    const dkDef = this.data.getNpc(9)!;
    this.addNpc(new Npc(dkDef, 85.5, 85.5));

    console.log(`Spawned ${this.npcs.size} NPCs`);
  }

  private addNpc(npc: Npc): void {
    this.npcs.set(npc.id, npc);
  }

  start(): void {
    console.log(`World starting — tick rate: ${TICK_RATE}ms`);
    this.tickTimer = setInterval(() => this.tick(), TICK_RATE);
    // Auto-save all players every 60 seconds
    this.saveTimer = setInterval(() => this.saveAllPlayers(), 60_000);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    // Final save on shutdown
    this.saveAllPlayers();
  }

  private saveAllPlayers(): void {
    for (const [, player] of this.players) {
      this.db.savePlayerState(player.accountId, player);
    }
  }

  kickAccountIfOnline(accountId: number): void {
    for (const [id, player] of this.players) {
      if (player.accountId === accountId) {
        try {
          player.ws.close(1000, 'Logged in from another session');
        } catch { /* ignore */ }
        this.removePlayer(id);
        break;
      }
    }
  }

  addPlayer(player: Player): void {
    this.players.set(player.id, player);
    console.log(`Player "${player.name}" (id=${player.id}) joined`);

    // Send login confirmation
    this.sendToPlayer(player, ServerOpcode.LOGIN_OK, player.id,
      Math.round(player.position.x * 10),
      Math.round(player.position.y * 10)
    );

    // Broadcast player name to all chat sockets (so clients can map entityId → name)
    broadcastPlayerInfo(player.id, player.name);
    // Also send all existing player names to the new player
    for (const [, other] of this.players) {
      if (other.id !== player.id) {
        broadcastPlayerInfo(other.id, other.name);
      }
    }

    // Send existing players
    for (const [, other] of this.players) {
      if (other.id !== player.id) {
        this.sendPlayerUpdate(player, other);
        this.sendPlayerUpdate(other, player);
      }
    }

    // Send existing NPCs
    for (const [, npc] of this.npcs) {
      if (!npc.dead) {
        this.sendNpcUpdate(player, npc);
      }
    }

    // Send existing ground items
    for (const [, item] of this.groundItems) {
      this.sendGroundItemUpdate(player, item);
    }

    // Send full skills
    this.sendSkills(player);
    // Send inventory
    this.sendInventory(player);
    // Send equipment
    this.sendEquipment(player);
  }

  removePlayer(playerId: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.players.delete(playerId);
    this.playerCombatTargets.delete(playerId);
    console.log(`Player "${player.name}" left`);

    for (const [, other] of this.players) {
      this.sendToPlayer(other, ServerOpcode.ENTITY_DEATH, playerId);
    }
  }

  handlePlayerMove(playerId: number, path: { x: number; z: number }[]): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // Cancel combat when moving
    this.playerCombatTargets.delete(playerId);
    player.attackTarget = null;

    const validPath: { x: number; z: number }[] = [];
    for (const step of path) {
      if (!this.map.isBlocked(step.x, step.z)) {
        validPath.push(step);
      } else {
        break;
      }
    }
    player.moveQueue = validPath;
  }

  handlePlayerAttackNpc(playerId: number, npcId: number): void {
    const player = this.players.get(playerId);
    const npc = this.npcs.get(npcId);
    if (!player || !npc || npc.dead) return;

    player.attackTarget = npc;
    this.playerCombatTargets.set(playerId, npcId);

    // Walk to NPC if not adjacent
    const dx = npc.position.x - player.position.x;
    const dz = npc.position.y - player.position.y;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 1.5) {
      const path = this.map.findPath(player.position.x, player.position.y, npc.position.x, npc.position.y);
      if (path.length > 1) {
        player.moveQueue = path.slice(0, -1);
      } else {
        player.moveQueue = path;
      }
    } else {
      player.moveQueue = [];
    }
  }

  handlePlayerPickup(playerId: number, groundItemId: number): void {
    const player = this.players.get(playerId);
    const item = this.groundItems.get(groundItemId);
    if (!player || !item) return;

    const dx = Math.abs(player.position.x - item.x);
    const dz = Math.abs(player.position.y - item.z);
    if (dx > 1.5 || dz > 1.5) return;

    if (player.addItem(item.itemId, item.quantity)) {
      this.groundItems.delete(groundItemId);
      for (const [, p] of this.players) {
        this.sendToPlayer(p, ServerOpcode.GROUND_ITEM_SYNC,
          groundItemId, 0, 0, 0, 0
        );
      }
      this.sendInventory(player);
    }
  }

  handlePlayerDrop(playerId: number, slotIndex: number): void {
    const player = this.players.get(playerId);
    if (!player) return;

    const removed = player.removeItem(slotIndex);
    if (!removed) return;

    const groundItem: GroundItem = {
      id: nextGroundItemId++,
      itemId: removed.itemId,
      quantity: removed.quantity,
      x: player.position.x,
      z: player.position.y,
      despawnTimer: 200,
    };
    this.groundItems.set(groundItem.id, groundItem);

    for (const [, p] of this.players) {
      this.sendGroundItemUpdate(p, groundItem);
    }
    this.sendInventory(player);
  }

  handlePlayerEquip(playerId: number, slotIndex: number): void {
    const player = this.players.get(playerId);
    if (!player) return;

    const slot = player.inventory[slotIndex];
    if (!slot) return;

    const itemDef = this.data.getItem(slot.itemId);
    if (!itemDef || !itemDef.equippable || !itemDef.equipSlot) return;

    const equipSlot = itemDef.equipSlot as EquipSlot;

    // Unequip current item in that slot (swap to inventory)
    const currentEquipped = player.equipment.get(equipSlot);
    if (currentEquipped !== undefined) {
      // Try to put old item in the same inventory slot
      player.inventory[slotIndex] = { itemId: currentEquipped, quantity: 1 };
    } else {
      player.removeItem(slotIndex);
    }

    // Equip new item
    player.equipment.set(equipSlot, slot.itemId);

    this.sendInventory(player);
    this.sendEquipment(player);
  }

  handlePlayerUnequip(playerId: number, equipSlotIndex: number): void {
    const player = this.players.get(playerId);
    if (!player) return;

    const slotNames: EquipSlot[] = ['weapon', 'shield', 'head', 'body', 'legs', 'neck', 'ring', 'hands', 'feet', 'cape'];
    const slotName = slotNames[equipSlotIndex];
    if (!slotName) return;

    const itemId = player.equipment.get(slotName);
    if (itemId === undefined) return;

    // Try to add to inventory
    if (player.addItem(itemId, 1)) {
      player.equipment.delete(slotName);
      this.sendInventory(player);
      this.sendEquipment(player);
    }
  }

  handlePlayerEat(playerId: number, slotIndex: number): void {
    const player = this.players.get(playerId);
    if (!player) return;

    const slot = player.inventory[slotIndex];
    if (!slot) return;

    const itemDef = this.data.getItem(slot.itemId);
    if (!itemDef || !itemDef.healAmount) return;

    // Can't eat at full health
    if (player.health >= player.maxHealth) return;

    player.heal(itemDef.healAmount);
    player.skills.hitpoints.currentLevel = player.health;
    player.removeItem(slotIndex, 1);

    this.sendInventory(player);
    this.sendToPlayer(player, ServerOpcode.PLAYER_STATS,
      player.health, player.maxHealth
    );
  }

  handlePlayerSetStance(playerId: number, stanceIndex: number): void {
    const player = this.players.get(playerId);
    if (!player) return;

    const stances = ['accurate', 'aggressive', 'defensive', 'controlled'] as const;
    if (stanceIndex >= 0 && stanceIndex < stances.length) {
      player.stance = stances[stanceIndex];
    }
  }

  private tick(): void {
    this.currentTick++;

    // Process player movement
    for (const [, player] of this.players) {
      player.processMovement();
    }

    // Process NPC AI
    for (const [, npc] of this.npcs) {
      if (npc.dead) {
        if (npc.tickRespawn()) {
          for (const [, p] of this.players) {
            this.sendNpcUpdate(p, npc);
          }
        }
        continue;
      }

      // Aggressive NPC targeting
      if (npc.def.aggressive && !npc.combatTarget) {
        for (const [, player] of this.players) {
          const dx = Math.abs(npc.position.x - player.position.x);
          const dz = Math.abs(npc.position.y - player.position.y);
          if (dx <= 5 && dz <= 5) {
            npc.combatTarget = player;
            break;
          }
        }
      }

      npc.processAI((x, z) => this.map.isBlocked(x, z));
    }

    // Process combat — chase phase: players walk toward their melee target
    const itemDefs = this.data.itemDefs;

    for (const [playerId, npcId] of this.playerCombatTargets) {
      const player = this.players.get(playerId);
      const npc = this.npcs.get(npcId);
      if (!player || !npc || npc.dead) {
        this.playerCombatTargets.delete(playerId);
        continue;
      }

      // If player is too far, walk toward NPC (but stop adjacent, not on top)
      // Snap player to tile center first to prevent drifting between tiles
      player.position.x = Math.floor(player.position.x) + 0.5;
      player.position.y = Math.floor(player.position.y) + 0.5;
      const cdx = npc.position.x - player.position.x;
      const cdz = npc.position.y - player.position.y;
      const combatDist = Math.sqrt(cdx * cdx + cdz * cdz);
      if (combatDist > 1.5) {
        player.moveQueue = [];
        const sx = cdx !== 0 ? Math.sign(cdx) : 0;
        const sz = cdz !== 0 ? Math.sign(cdz) : 0;
        const nx = player.position.x + sx;
        const nz = player.position.y + sz;
        // Don't step onto the NPC's tile
        const npcTileX = Math.floor(npc.position.x);
        const npcTileZ = Math.floor(npc.position.y);
        const wouldOverlap = (px: number, pz: number) =>
          Math.floor(px) === npcTileX && Math.floor(pz) === npcTileZ;
        if (sx !== 0 && sz !== 0 && !this.map.isBlocked(nx, nz) && !wouldOverlap(nx, nz)) {
          player.position.x = nx;
          player.position.y = nz;
        } else if (sx !== 0 && !this.map.isBlocked(player.position.x + sx, player.position.y) && !wouldOverlap(player.position.x + sx, player.position.y)) {
          player.position.x += sx;
        } else if (sz !== 0 && !this.map.isBlocked(player.position.x, player.position.y + sz) && !wouldOverlap(player.position.x, player.position.y + sz)) {
          player.position.y += sz;
        }
      }

      const result = processPlayerCombat(player, npc, itemDefs);
      if (result) {
        this.broadcastCombatHit(result.hit.attackerId, result.hit.targetId, result.hit.damage, result.hit.targetHealth, result.hit.targetMaxHealth);

        // Send XP drops
        for (const xp of result.xpDrops) {
          const skillIdx = ALL_SKILLS.indexOf(xp.skill as SkillId);
          if (skillIdx >= 0) {
            this.sendToPlayer(player, ServerOpcode.XP_GAIN, skillIdx, xp.amount);
          }
        }

        // Send level ups
        for (const lu of result.levelUps) {
          const skillIdx = ALL_SKILLS.indexOf(lu.skill as SkillId);
          if (skillIdx >= 0) {
            this.sendToPlayer(player, ServerOpcode.LEVEL_UP, skillIdx, lu.level);
          }
        }

        // Send updated skills
        if (result.xpDrops.length > 0) {
          this.sendSkills(player);
        }

        if (!npc.alive) {
          npc.die();
          this.playerCombatTargets.delete(playerId);

          for (const [, p] of this.players) {
            this.sendToPlayer(p, ServerOpcode.ENTITY_DEATH, npc.id);
          }

          // Drop loot
          const loot = rollLoot(npc);
          for (const drop of loot) {
            const groundItem: GroundItem = {
              id: nextGroundItemId++,
              itemId: drop.itemId,
              quantity: drop.quantity,
              x: npc.spawnX,
              z: npc.spawnZ,
              despawnTimer: 200,
            };
            this.groundItems.set(groundItem.id, groundItem);
            for (const [, p] of this.players) {
              this.sendGroundItemUpdate(p, groundItem);
            }
          }
        }
      }
    }

    // Process NPC combat (NPCs attacking players)
    for (const [, npc] of this.npcs) {
      if (npc.dead || !npc.combatTarget) continue;
      const target = npc.combatTarget as Player;
      if (!target.alive || !this.players.has(target.id)) {
        npc.combatTarget = null;
        continue;
      }

      const hit = processNpcCombat(npc, target, itemDefs);
      if (hit) {
        this.broadcastCombatHit(hit.attackerId, hit.targetId, hit.damage, hit.targetHealth, hit.targetMaxHealth);

        // Send updated stats
        this.sendToPlayer(target, ServerOpcode.PLAYER_STATS,
          target.health, target.maxHealth
        );
        this.sendSkills(target);

        if (!target.alive) {
          // Player died — respawn at spawn point
          const spawn = this.map.findSpawnPoint();
          target.health = target.maxHealth;
          target.skills.hitpoints.currentLevel = target.maxHealth;
          target.position.x = spawn.x;
          target.position.y = spawn.z;
          target.moveQueue = [];
          target.attackTarget = null;
          npc.combatTarget = null;
          this.playerCombatTargets.delete(target.id);

          this.sendToPlayer(target, ServerOpcode.PLAYER_STATS,
            target.health, target.maxHealth
          );
          this.sendSkills(target);
        }
      }
    }

    // NPC health regeneration: 1 HP every 10 ticks (~6s) when out of combat
    if (this.currentTick % 10 === 0) {
      for (const [, npc] of this.npcs) {
        if (npc.dead || npc.health >= npc.maxHealth) continue;
        // Skip if NPC is in combat (aggressive NPC targeting a player)
        if (npc.combatTarget) continue;
        // Skip if any player is attacking this NPC
        let inCombat = false;
        for (const [, npcId] of this.playerCombatTargets) {
          if (npcId === npc.id) { inCombat = true; break; }
        }
        if (inCombat) continue;
        npc.heal(1);
      }

      // Player health regeneration: same rate, out of combat only
      for (const [playerId, player] of this.players) {
        if (!player.alive || player.health >= player.maxHealth) continue;
        // Skip if player is attacking an NPC
        if (this.playerCombatTargets.has(playerId)) continue;
        // Skip if any NPC is targeting this player
        let inCombat = false;
        for (const [, npc] of this.npcs) {
          if (npc.combatTarget === player) { inCombat = true; break; }
        }
        if (inCombat) continue;
        player.heal(1);
        player.skills.hitpoints.currentLevel = player.health;
        this.sendToPlayer(player, ServerOpcode.PLAYER_STATS, player.health, player.maxHealth);
        this.sendSkills(player);
      }
    }

    // Despawn ground items
    for (const [id, item] of this.groundItems) {
      item.despawnTimer--;
      if (item.despawnTimer <= 0) {
        this.groundItems.delete(id);
        for (const [, p] of this.players) {
          this.sendToPlayer(p, ServerOpcode.GROUND_ITEM_SYNC, id, 0, 0, 0, 0);
        }
      }
    }

    // Broadcast positions
    this.broadcastSync();
  }

  private broadcastSync(): void {
    for (const [, viewer] of this.players) {
      for (const [, subject] of this.players) {
        this.sendPlayerUpdate(viewer, subject);
      }
      for (const [, npc] of this.npcs) {
        if (!npc.dead) {
          this.sendNpcUpdate(viewer, npc);
        }
      }
    }
  }

  private broadcastCombatHit(attackerId: number, targetId: number, damage: number, targetHp: number, targetMaxHp: number): void {
    for (const [, p] of this.players) {
      this.sendToPlayer(p, ServerOpcode.COMBAT_HIT,
        attackerId, targetId, damage, targetHp, targetMaxHp
      );
    }
  }

  private sendPlayerUpdate(viewer: Player, subject: Player): void {
    this.sendToPlayer(viewer, ServerOpcode.PLAYER_SYNC,
      subject.id,
      Math.round(subject.position.x * 10),
      Math.round(subject.position.y * 10),
      subject.health,
      subject.maxHealth
    );
  }

  private sendNpcUpdate(viewer: Player, npc: Npc): void {
    this.sendToPlayer(viewer, ServerOpcode.NPC_SYNC,
      npc.id,
      npc.npcId,
      Math.round(npc.position.x * 10),
      Math.round(npc.position.y * 10),
      npc.health,
      npc.maxHealth
    );
  }

  private sendGroundItemUpdate(viewer: Player, item: GroundItem): void {
    this.sendToPlayer(viewer, ServerOpcode.GROUND_ITEM_SYNC,
      item.id,
      item.itemId,
      item.quantity,
      Math.round(item.x * 10),
      Math.round(item.z * 10)
    );
  }

  sendInventory(player: Player): void {
    for (let i = 0; i < player.inventory.length; i++) {
      const slot = player.inventory[i];
      this.sendToPlayer(player, ServerOpcode.PLAYER_INVENTORY,
        i,
        slot ? slot.itemId : 0,
        slot ? slot.quantity : 0
      );
    }
  }

  sendSkills(player: Player): void {
    // Send all skills: [skillIndex, level, currentLevel, xpHigh, xpLow]
    // XP is split into high/low 16-bit values since it can exceed 16-bit range
    for (let i = 0; i < ALL_SKILLS.length; i++) {
      const skill = player.skills[ALL_SKILLS[i]];
      const xpHigh = (skill.xp >> 16) & 0xFFFF;
      const xpLow = skill.xp & 0xFFFF;
      this.sendToPlayer(player, ServerOpcode.PLAYER_SKILLS,
        i, skill.level, skill.currentLevel, xpHigh, xpLow
      );
    }
  }

  sendEquipment(player: Player): void {
    const slotNames: EquipSlot[] = ['weapon', 'shield', 'head', 'body', 'legs', 'neck', 'ring', 'hands', 'feet', 'cape'];
    for (let i = 0; i < slotNames.length; i++) {
      const itemId = player.equipment.get(slotNames[i]) ?? 0;
      this.sendToPlayer(player, ServerOpcode.PLAYER_EQUIPMENT, i, itemId);
    }
  }

  private sendToPlayer(player: Player, opcode: ServerOpcode, ...values: number[]): void {
    try {
      player.ws.sendBinary(encodePacket(opcode, ...values));
    } catch { /* connection closed */ }
  }

  getPlayer(id: number): Player | undefined {
    return this.players.get(id);
  }
}
