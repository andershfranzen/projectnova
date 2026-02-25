import { TileType, TILEMAP_COLORS } from '@projectrs/shared';
import type { StateManager } from '../state/EditorState';

const TILE_NAMES: Record<number, string> = {
  [TileType.GRASS]: 'Grass',
  [TileType.DIRT]: 'Dirt',
  [TileType.STONE]: 'Stone',
  [TileType.WATER]: 'Water',
  [TileType.WALL]: 'Wall',
  [TileType.SAND]: 'Sand',
  [TileType.WOOD]: 'Wood',
};

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

    for (const entry of TILEMAP_COLORS) {
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
      label.textContent = TILE_NAMES[entry.type] || `Type ${entry.type}`;

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
    for (let i = 0; i < TILEMAP_COLORS.length; i++) {
      this.items[i].classList.toggle('selected', TILEMAP_COLORS[i].type === this.stateMgr.state.selectedTileType);
    }
  }
}
