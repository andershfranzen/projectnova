import type { EditorApi, MapListEntry } from '../api/EditorApi';

export class MapSelector {
  private api: EditorApi;
  onMapSelected?: (mapId: string) => void;

  constructor(api: EditorApi) {
    this.api = api;
  }

  async show(): Promise<void> {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = '<h2>Select Map</h2><div id="map-list">Loading...</div><hr style="border-color:#0f3460;margin:12px 0"><h2>Create New Map</h2>';

    // New map form
    const form = document.createElement('div');
    form.innerHTML = `
      <label>Map ID (e.g. "dungeon2")</label>
      <input type="text" id="new-map-id" placeholder="map_id">
      <label>Display Name</label>
      <input type="text" id="new-map-name" placeholder="My Map">
      <label>Width</label>
      <input type="number" id="new-map-width" value="256" min="32" max="2048">
      <label>Height</label>
      <input type="number" id="new-map-height" value="256" min="32" max="2048">
    `;
    modal.appendChild(form);

    const btnRow = document.createElement('div');
    btnRow.style.marginTop = '8px';

    const createBtn = document.createElement('button');
    createBtn.className = 'primary';
    createBtn.textContent = 'Create';
    createBtn.addEventListener('click', async () => {
      const mapId = (document.getElementById('new-map-id') as HTMLInputElement).value.trim();
      const name = (document.getElementById('new-map-name') as HTMLInputElement).value.trim();
      const width = parseInt((document.getElementById('new-map-width') as HTMLInputElement).value);
      const height = parseInt((document.getElementById('new-map-height') as HTMLInputElement).value);

      if (!mapId || !name) { alert('ID and name required'); return; }

      try {
        await this.api.createMap(mapId, name, width, height);
        overlay.remove();
        this.onMapSelected?.(mapId);
      } catch (e: any) {
        alert('Error: ' + e.message);
      }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());

    btnRow.appendChild(createBtn);
    btnRow.appendChild(cancelBtn);
    modal.appendChild(btnRow);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);

    // Load map list
    try {
      const maps = await this.api.listMaps();
      const listDiv = modal.querySelector('#map-list')!;
      listDiv.innerHTML = '';

      if (maps.length === 0) {
        listDiv.textContent = 'No maps found.';
        return;
      }

      for (const map of maps) {
        const item = document.createElement('div');
        item.className = 'map-list-item';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';

        const label = document.createElement('span');
        label.innerHTML = `<strong>${map.name}</strong> <span style="color:#888">(${map.id}, ${map.width}x${map.height})</span>`;
        label.style.flex = '1';
        label.style.cursor = 'pointer';
        label.addEventListener('click', () => {
          overlay.remove();
          this.onMapSelected?.(map.id);
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.style.marginLeft = '8px';
        delBtn.style.background = '#8a1a1a';
        delBtn.style.color = '#fff';
        delBtn.style.border = 'none';
        delBtn.style.padding = '2px 8px';
        delBtn.style.borderRadius = '3px';
        delBtn.style.cursor = 'pointer';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete map "${map.name}" (${map.id})? This cannot be undone.`)) return;
          try {
            await this.api.deleteMap(map.id);
            item.remove();
          } catch (err: any) {
            alert('Delete failed: ' + err.message);
          }
        });

        item.appendChild(label);
        item.appendChild(delBtn);
        listDiv.appendChild(item);
      }
    } catch (e: any) {
      const listDiv = modal.querySelector('#map-list')!;
      listDiv.textContent = 'Error loading maps: ' + e.message;
    }
  }
}
