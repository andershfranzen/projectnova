import { TileType } from '@projectrs/shared';
import type { StateManager } from '../state/EditorState';

const TILE_ENTRIES: { type: TileType; name: string; r: number; g: number; b: number }[] = [
  { type: TileType.GRASS, name: 'Grass', r: 0x4a, g: 0x8a, b: 0x30 },
  { type: TileType.DIRT, name: 'Dirt', r: 0x8c, g: 0x68, b: 0x40 },
  { type: TileType.STONE, name: 'Stone', r: 0x80, g: 0x80, b: 0x80 },
  { type: TileType.WATER, name: 'Water', r: 0x30, g: 0x60, b: 0xb0 },
  { type: TileType.WALL, name: 'Wall', r: 0x50, g: 0x40, b: 0x40 },
  { type: TileType.SAND, name: 'Sand', r: 0xc0, g: 0xb0, b: 0x80 },
  { type: TileType.WOOD, name: 'Wood', r: 0x70, g: 0x50, b: 0x28 },
];

export class TilePalette {
  private container: HTMLElement;
  private stateMgr: StateManager;
  private items: HTMLElement[] = [];

  constructor(container: HTMLElement, stateMgr: StateManager) {
    this.container = container;
    this.stateMgr = stateMgr;
    this.build();
  }

  private build(): void {
    const header = document.createElement('h3');
    header.textContent = 'Tile Palette';
    this.container.appendChild(header);

    for (const entry of TILE_ENTRIES) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      if (entry.type === this.stateMgr.state.selectedTileType) {
        item.classList.add('selected');
      }

      const swatch = document.createElement('div');
      swatch.className = 'palette-swatch';
      swatch.style.backgroundColor = `rgb(${entry.r},${entry.g},${entry.b})`;

      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = entry.name;

      item.appendChild(swatch);
      item.appendChild(label);
      item.addEventListener('click', () => {
        this.stateMgr.state.selectedTileType = entry.type;
        this.updateSelection();
      });

      this.container.appendChild(item);
      this.items.push(item);
    }
  }

  updateSelection(): void {
    for (let i = 0; i < TILE_ENTRIES.length; i++) {
      this.items[i].classList.toggle('selected', TILE_ENTRIES[i].type === this.stateMgr.state.selectedTileType);
    }
  }
}
