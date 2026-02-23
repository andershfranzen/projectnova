import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { NpcDef, ItemDef } from '@projectrs/shared';

const DATA_DIR = resolve(import.meta.dir, '../../data');

export class DataLoader {
  private npcs: Map<number, NpcDef> = new Map();
  private items: Map<number, ItemDef> = new Map();

  get itemDefs(): Map<number, ItemDef> {
    return this.items;
  }

  constructor() {
    this.loadNpcs();
    this.loadItems();
  }

  private loadNpcs(): void {
    const raw = readFileSync(resolve(DATA_DIR, 'npcs.json'), 'utf-8');
    const defs: NpcDef[] = JSON.parse(raw);
    for (const def of defs) {
      this.npcs.set(def.id, def);
    }
    console.log(`Loaded ${this.npcs.size} NPC definitions`);
  }

  private loadItems(): void {
    const raw = readFileSync(resolve(DATA_DIR, 'items.json'), 'utf-8');
    const defs: ItemDef[] = JSON.parse(raw);
    for (const def of defs) {
      this.items.set(def.id, def);
    }
    console.log(`Loaded ${this.items.size} item definitions`);
  }

  getNpc(id: number): NpcDef | undefined {
    return this.npcs.get(id);
  }

  getItem(id: number): ItemDef | undefined {
    return this.items.get(id);
  }

  getAllNpcs(): NpcDef[] {
    return Array.from(this.npcs.values());
  }

  getAllItems(): ItemDef[] {
    return Array.from(this.items.values());
  }
}
