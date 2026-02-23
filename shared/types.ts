export interface Position {
  x: number;
  y: number;
}

export interface EntityState {
  id: number;
  type: 'player' | 'npc';
  position: Position;
  name: string;
  health: number;
  maxHealth: number;
}

export interface PlayerState extends EntityState {
  type: 'player';
  combatLevel: number;
}

export interface NpcState extends EntityState {
  type: 'npc';
  npcId: number;
}

export interface ItemDef {
  id: number;
  name: string;
  description: string;
  stackable: boolean;
  equippable: boolean;
  equipSlot?: 'weapon' | 'head' | 'body' | 'legs' | 'shield' | 'neck' | 'ring' | 'hands' | 'feet' | 'cape';
  attackSpeed?: number;
  weaponStyle?: 'stab' | 'slash' | 'crush';
  // Attack bonuses
  stabAttack?: number;
  slashAttack?: number;
  crushAttack?: number;
  // Defence bonuses
  stabDefence?: number;
  slashDefence?: number;
  crushDefence?: number;
  // Strength
  meleeStrength?: number;
  // Ranged
  rangedAccuracy?: number;
  rangedStrength?: number;
  rangedDefence?: number;
  // Magic
  magicAccuracy?: number;
  magicDefence?: number;
  // Food
  healAmount?: number;
  value: number;
}

export interface NpcDef {
  id: number;
  name: string;
  health: number;
  attack: number;
  defence: number;
  strength: number;
  attackSpeed: number; // ticks between attacks
  respawnTime: number; // ticks
  aggressive: boolean;
  wanderRange: number; // tiles from spawn
  lootTable: LootDrop[];
}

export interface LootDrop {
  itemId: number;
  quantity: number;
  chance: number; // 0-1
}

export interface InventorySlot {
  itemId: number;
  quantity: number;
}

export interface TileDef {
  type: TileType;
  elevation?: number;
}

export enum TileType {
  GRASS = 0,
  DIRT = 1,
  STONE = 2,
  WATER = 3, // blocking
  WALL = 4,  // blocking
  SAND = 5,
  WOOD = 6,  // floor
}

export const BLOCKING_TILES = new Set([TileType.WATER, TileType.WALL]);
