import type { EditorTool, HeightMode, StateManager } from '../state/EditorState';

export interface ToolbarCallbacks {
  onToolChange: (tool: EditorTool) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenMap: () => void;
  onZoomToFit: () => void;
  onExport: () => void;
  onImport: () => void;
  onReload: () => void;
}

export class Toolbar {
  private container: HTMLElement;
  private stateMgr: StateManager;
  private callbacks: ToolbarCallbacks;
  private toolButtons: Map<EditorTool, HTMLButtonElement> = new Map();

  constructor(container: HTMLElement, stateMgr: StateManager, callbacks: ToolbarCallbacks) {
    this.container = container;
    this.stateMgr = stateMgr;
    this.callbacks = callbacks;
    this.build();
  }

  private build(): void {
    this.container.innerHTML = '';

    const mapBtn = this.btn('Open Map', () => this.callbacks.onOpenMap());
    this.container.appendChild(mapBtn);

    this.container.appendChild(this.sep());

    const tools: { id: EditorTool; label: string }[] = [
      { id: 'tile', label: 'Tile [1]' },
      { id: 'height', label: 'Height [2]' },
      { id: 'fill', label: 'Fill [3]' },
      { id: 'rect', label: 'Rect [4]' },
      { id: 'line', label: 'Line [5]' },
      { id: 'eyedropper', label: 'Pick [6]' },
      { id: 'select', label: 'Select [7]' },
      { id: 'npc', label: 'NPC [8]' },
      { id: 'object', label: 'Object [9]' },
      { id: 'eraser', label: 'Eraser [0]' },
      { id: 'wall', label: 'Wall [-]' },
    ];

    for (const t of tools) {
      const btn = this.btn(t.label, () => {
        this.callbacks.onToolChange(t.id);
        this.updateActive();
      });
      this.toolButtons.set(t.id, btn);
      this.container.appendChild(btn);
    }
    this.updateActive();

    this.container.appendChild(this.sep());

    // Brush size
    const brushLabel = document.createElement('label');
    brushLabel.textContent = 'Size:';
    this.container.appendChild(brushLabel);

    const brushSlider = document.createElement('input');
    brushSlider.type = 'range';
    brushSlider.min = '1';
    brushSlider.max = '50';
    brushSlider.value = String(this.stateMgr.state.brushSize);
    brushSlider.addEventListener('input', () => {
      this.stateMgr.state.brushSize = parseInt(brushSlider.value);
    });
    this.container.appendChild(brushSlider);

    this.container.appendChild(this.sep());

    // Height mode
    const heightLabel = document.createElement('label');
    heightLabel.textContent = 'Mode:';
    heightLabel.id = 'height-mode-label';
    this.container.appendChild(heightLabel);

    const heightSelect = document.createElement('select');
    heightSelect.id = 'height-mode-select';
    for (const mode of ['set', 'raise', 'lower', 'smooth'] as HeightMode[]) {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
      heightSelect.appendChild(opt);
    }
    heightSelect.value = this.stateMgr.state.heightMode;
    heightSelect.addEventListener('change', () => {
      this.stateMgr.state.heightMode = heightSelect.value as HeightMode;
    });
    this.container.appendChild(heightSelect);

    const hValLabel = document.createElement('label');
    hValLabel.textContent = 'Val:';
    hValLabel.id = 'height-val-label';
    this.container.appendChild(hValLabel);

    const hValInput = document.createElement('input');
    hValInput.type = 'range';
    hValInput.id = 'height-val-input';
    hValInput.min = '0';
    hValInput.max = '255';
    hValInput.value = String(this.stateMgr.state.heightValue);
    hValInput.addEventListener('input', () => {
      this.stateMgr.state.heightValue = parseInt(hValInput.value);
      this.stateMgr.state.heightDelta = parseInt(hValInput.value);
    });
    this.container.appendChild(hValInput);

    // NPC/Object select
    const spawnSelect = document.createElement('select');
    spawnSelect.id = 'spawn-select';
    spawnSelect.addEventListener('change', () => {
      const s = this.stateMgr.state;
      const val = parseInt(spawnSelect.value);
      if (s.activeTool === 'npc') s.selectedNpcId = val;
      else if (s.activeTool === 'object') s.selectedObjectId = val;
    });
    this.container.appendChild(spawnSelect);

    this.container.appendChild(this.sep());

    // View toggles
    const gridBtn = this.btn('Grid [G]', () => {
      this.stateMgr.state.showGrid = !this.stateMgr.state.showGrid;
      gridBtn.classList.toggle('active', this.stateMgr.state.showGrid);
      this.stateMgr.notify();
    });
    gridBtn.classList.toggle('active', this.stateMgr.state.showGrid);
    this.container.appendChild(gridBtn);

    const heightToggle = this.btn('Heights [H]', () => {
      this.stateMgr.state.showHeights = !this.stateMgr.state.showHeights;
      heightToggle.classList.toggle('active', this.stateMgr.state.showHeights);
      this.stateMgr.notify();
    });
    heightToggle.classList.toggle('active', this.stateMgr.state.showHeights);
    this.container.appendChild(heightToggle);

    const spawnToggle = this.btn('Spawns', () => {
      this.stateMgr.state.showSpawns = !this.stateMgr.state.showSpawns;
      spawnToggle.classList.toggle('active', this.stateMgr.state.showSpawns);
      this.stateMgr.notify();
    });
    spawnToggle.classList.toggle('active', this.stateMgr.state.showSpawns);
    this.container.appendChild(spawnToggle);

    const wallToggle = this.btn('Walls', () => {
      this.stateMgr.state.showWalls = !this.stateMgr.state.showWalls;
      wallToggle.classList.toggle('active', this.stateMgr.state.showWalls);
      this.stateMgr.notify();
    });
    wallToggle.classList.toggle('active', this.stateMgr.state.showWalls);
    this.container.appendChild(wallToggle);

    this.container.appendChild(this.sep());

    this.container.appendChild(this.btn('Fit [F]', () => this.callbacks.onZoomToFit()));
    this.container.appendChild(this.btn('Undo', () => this.callbacks.onUndo()));
    this.container.appendChild(this.btn('Redo', () => this.callbacks.onRedo()));

    this.container.appendChild(this.sep());

    const saveBtn = this.btn('Save', () => this.callbacks.onSave());
    saveBtn.style.background = '#2a7a2a';
    saveBtn.style.borderColor = '#3a9a3a';
    this.container.appendChild(saveBtn);

    const reloadBtn = this.btn('Reload', () => this.callbacks.onReload());
    reloadBtn.style.background = '#8a6a2a';
    reloadBtn.style.borderColor = '#aa8a3a';
    this.container.appendChild(reloadBtn);

    this.container.appendChild(this.sep());

    this.container.appendChild(this.btn('Export', () => this.callbacks.onExport()));
    this.container.appendChild(this.btn('Import', () => this.callbacks.onImport()));
  }

  updateActive(): void {
    const active = this.stateMgr.state.activeTool;
    for (const [id, btn] of this.toolButtons) {
      btn.classList.toggle('active', id === active);
    }

    const heightEls = ['height-mode-label', 'height-mode-select', 'height-val-label', 'height-val-input'];
    for (const id of heightEls) {
      const el = document.getElementById(id);
      if (el) el.style.display = active === 'height' ? '' : 'none';
    }

    const spawnSelect = document.getElementById('spawn-select') as HTMLSelectElement;
    if (spawnSelect) {
      const s = this.stateMgr.state;
      if (active === 'npc') {
        spawnSelect.style.display = '';
        spawnSelect.innerHTML = '';
        for (const npc of s.npcDefs) {
          const opt = document.createElement('option');
          opt.value = String(npc.id);
          opt.textContent = npc.name;
          spawnSelect.appendChild(opt);
        }
        spawnSelect.value = String(s.selectedNpcId);
      } else if (active === 'object') {
        spawnSelect.style.display = '';
        spawnSelect.innerHTML = '';
        for (const obj of s.objectDefs) {
          const opt = document.createElement('option');
          opt.value = String(obj.id);
          opt.textContent = obj.name;
          spawnSelect.appendChild(opt);
        }
        spawnSelect.value = String(s.selectedObjectId);
      } else {
        spawnSelect.style.display = 'none';
      }
    }
  }

  private btn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  private sep(): HTMLDivElement {
    const d = document.createElement('div');
    d.className = 'separator';
    return d;
  }
}
