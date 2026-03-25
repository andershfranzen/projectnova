import type { StateManager } from '../state/EditorState';
import type { MapMeta, MapTransition } from '@projectrs/shared';

export class PropertiesPanel {
  private container: HTMLElement;
  private stateMgr: StateManager;

  constructor(container: HTMLElement, stateMgr: StateManager) {
    this.container = container;
    this.stateMgr = stateMgr;
  }

  rebuild(): void {
    const s = this.stateMgr.state;
    if (!s.meta.id) {
      this.container.innerHTML = '<p style="padding:8px;color:#666">No map loaded</p>';
      return;
    }

    this.container.innerHTML = '';

    this.addSection('Map Properties');
    this.addField('Name', 'text', s.meta.name, (v) => { s.meta.name = v; s.dirty = true; });
    this.addField('Width', 'number', String(s.meta.width), () => {}, true);
    this.addField('Height', 'number', String(s.meta.height), () => {}, true);
    this.addField('Water Level', 'number', String(s.meta.waterLevel), (v) => { s.meta.waterLevel = parseFloat(v); s.dirty = true; });

    this.addSection('Spawn Point');
    this.addField('X', 'number', String(s.meta.spawnPoint.x), (v) => { s.meta.spawnPoint.x = parseFloat(v); s.dirty = true; });
    this.addField('Z', 'number', String(s.meta.spawnPoint.z), (v) => { s.meta.spawnPoint.z = parseFloat(v); s.dirty = true; });

    this.addSection('Fog');
    this.addField('Start', 'number', String(s.meta.fogStart), (v) => { s.meta.fogStart = parseFloat(v); s.dirty = true; });
    this.addField('End', 'number', String(s.meta.fogEnd), (v) => { s.meta.fogEnd = parseFloat(v); s.dirty = true; });

    // Fog color as hex
    const fogHex = '#' + s.meta.fogColor.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    this.addField('Color', 'color', fogHex, (v) => {
      const r = parseInt(v.slice(1, 3), 16) / 255;
      const g = parseInt(v.slice(3, 5), 16) / 255;
      const b = parseInt(v.slice(5, 7), 16) / 255;
      s.meta.fogColor = [r, g, b];
      s.dirty = true;
    });

    this.addSection('Transitions');
    for (let i = 0; i < s.meta.transitions.length; i++) {
      this.addTransitionItem(s.meta.transitions[i], i);
    }

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Transition';
    addBtn.style.cssText = 'margin-top:6px;background:#0f3460;border:none;color:#e0e0e0;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:12px;width:100%';
    addBtn.addEventListener('click', () => {
      s.meta.transitions.push({ tileX: 0, tileZ: 0, targetMap: '', targetX: 0, targetZ: 0 });
      s.dirty = true;
      this.rebuild();
    });
    this.container.appendChild(addBtn);

    this.addSection('Stats');
    const stats = document.createElement('div');
    stats.style.cssText = 'font-size:11px;color:#888;padding:4px 0';
    stats.innerHTML = `
      Tiles: ${s.meta.width} x ${s.meta.height}<br>
      NPC Spawns: ${s.spawns.npcs.length}<br>
      Object Spawns: ${(s.spawns.objects || []).length}<br>
      Transitions: ${s.meta.transitions.length}
    `;
    this.container.appendChild(stats);
  }

  private addSection(title: string): void {
    const h = document.createElement('h3');
    h.textContent = title;
    this.container.appendChild(h);
  }

  private addField(label: string, type: string, value: string, onChange: (v: string) => void, readonly = false): void {
    const lbl = document.createElement('label');
    lbl.textContent = label;
    this.container.appendChild(lbl);

    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    if (readonly) input.readOnly = true;
    input.addEventListener('change', () => onChange(input.value));
    this.container.appendChild(input);
  }

  private addTransitionItem(t: MapTransition, index: number): void {
    const div = document.createElement('div');
    div.className = 'transition-item';

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'X';
    removeBtn.addEventListener('click', () => {
      this.stateMgr.state.meta.transitions.splice(index, 1);
      this.stateMgr.state.dirty = true;
      this.rebuild();
    });
    div.appendChild(removeBtn);

    div.innerHTML += `
      <div style="margin-top:4px">
        Tile: <input type="number" value="${t.tileX}" style="width:50px;display:inline;margin:0 2px" data-field="tileX">,
        <input type="number" value="${t.tileZ}" style="width:50px;display:inline" data-field="tileZ"><br>
        Target: <input type="text" value="${t.targetMap}" style="width:80px;display:inline;margin:0 2px" data-field="targetMap"><br>
        At: <input type="number" value="${t.targetX}" style="width:50px;display:inline;margin:0 2px" data-field="targetX">,
        <input type="number" value="${t.targetZ}" style="width:50px;display:inline" data-field="targetZ">
      </div>
    `;

    // Wire up change handlers
    div.querySelectorAll('input').forEach(inp => {
      const field = inp.dataset.field;
      if (!field) return;
      inp.addEventListener('change', () => {
        const trans = this.stateMgr.state.meta.transitions[index];
        if (!trans) return;
        if (field === 'targetMap') {
          (trans as any)[field] = inp.value;
        } else {
          (trans as any)[field] = parseFloat(inp.value);
        }
        this.stateMgr.state.dirty = true;
      });
    });

    this.container.appendChild(div);
  }
}
