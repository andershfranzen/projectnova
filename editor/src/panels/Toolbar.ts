import type { EditorTool, HeightMode, StateManager } from '../state/EditorState';
import type { RoofStyle, StairDirection } from '@projectrs/shared';

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

    // Floor selector
    const floorLabel = document.createElement('label');
    floorLabel.textContent = 'Floor:';
    this.container.appendChild(floorLabel);

    const floorDown = this.btn('▼', () => {
      if (this.stateMgr.state.currentFloor > 0) {
        this.stateMgr.state.currentFloor--;
        floorDisplay.textContent = String(this.stateMgr.state.currentFloor);
        this.stateMgr.notify();
      }
    });
    this.container.appendChild(floorDown);

    const floorDisplay = document.createElement('span');
    floorDisplay.id = 'floor-display';
    floorDisplay.textContent = String(this.stateMgr.state.currentFloor);
    floorDisplay.style.padding = '0 6px';
    floorDisplay.style.fontWeight = 'bold';
    floorDisplay.style.color = '#fff';
    this.container.appendChild(floorDisplay);

    const floorUp = this.btn('▲', () => {
      this.stateMgr.state.currentFloor++;
      floorDisplay.textContent = String(this.stateMgr.state.currentFloor);
      this.stateMgr.notify();
    });
    this.container.appendChild(floorUp);

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
      { id: 'floor' as EditorTool, label: 'Floor' },
      { id: 'stair' as EditorTool, label: 'Stair' },
      { id: 'roof' as EditorTool, label: 'Roof' },
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

    // === Wall height input (shown when wall tool active) ===
    const wallHLabel = document.createElement('label');
    wallHLabel.textContent = 'Wall H:';
    wallHLabel.id = 'wall-height-label';
    this.container.appendChild(wallHLabel);

    const wallHInput = document.createElement('input');
    wallHInput.type = 'number';
    wallHInput.id = 'wall-height-input';
    wallHInput.min = '0.1';
    wallHInput.max = '20';
    wallHInput.step = '0.1';
    wallHInput.value = String(this.stateMgr.state.wallHeightValue);
    wallHInput.style.width = '60px';
    wallHInput.addEventListener('input', () => {
      this.stateMgr.state.wallHeightValue = parseFloat(wallHInput.value) || 1.8;
    });
    this.container.appendChild(wallHInput);

    // === Floor height input ===
    const floorHLabel = document.createElement('label');
    floorHLabel.textContent = 'Floor H:';
    floorHLabel.id = 'floor-height-label';
    this.container.appendChild(floorHLabel);

    const floorHInput = document.createElement('input');
    floorHInput.type = 'number';
    floorHInput.id = 'floor-height-input';
    floorHInput.min = '0';
    floorHInput.max = '50';
    floorHInput.step = '0.5';
    floorHInput.value = String(this.stateMgr.state.floorHeightValue);
    floorHInput.style.width = '60px';
    floorHInput.addEventListener('input', () => {
      this.stateMgr.state.floorHeightValue = parseFloat(floorHInput.value) || 3.0;
    });
    this.container.appendChild(floorHInput);

    // === Stair controls ===
    const stairDirLabel = document.createElement('label');
    stairDirLabel.textContent = 'Dir:';
    stairDirLabel.id = 'stair-dir-label';
    this.container.appendChild(stairDirLabel);

    const stairDirSelect = document.createElement('select');
    stairDirSelect.id = 'stair-dir-select';
    for (const dir of ['N', 'S', 'E', 'W'] as const) {
      const opt = document.createElement('option');
      opt.value = dir;
      opt.textContent = dir;
      stairDirSelect.appendChild(opt);
    }
    stairDirSelect.value = this.stateMgr.state.stairDirection;
    stairDirSelect.addEventListener('change', () => {
      this.stateMgr.state.stairDirection = stairDirSelect.value as StairDirection;
    });
    this.container.appendChild(stairDirSelect);

    const stairBaseLabel = document.createElement('label');
    stairBaseLabel.textContent = 'Base:';
    stairBaseLabel.id = 'stair-base-label';
    this.container.appendChild(stairBaseLabel);

    const stairBaseInput = document.createElement('input');
    stairBaseInput.type = 'number';
    stairBaseInput.id = 'stair-base-input';
    stairBaseInput.step = '0.5';
    stairBaseInput.value = String(this.stateMgr.state.stairBaseHeight);
    stairBaseInput.style.width = '50px';
    stairBaseInput.addEventListener('input', () => {
      this.stateMgr.state.stairBaseHeight = parseFloat(stairBaseInput.value) || 0;
    });
    this.container.appendChild(stairBaseInput);

    const stairTopLabel = document.createElement('label');
    stairTopLabel.textContent = 'Top:';
    stairTopLabel.id = 'stair-top-label';
    this.container.appendChild(stairTopLabel);

    const stairTopInput = document.createElement('input');
    stairTopInput.type = 'number';
    stairTopInput.id = 'stair-top-input';
    stairTopInput.step = '0.5';
    stairTopInput.value = String(this.stateMgr.state.stairTopHeight);
    stairTopInput.style.width = '50px';
    stairTopInput.addEventListener('input', () => {
      this.stateMgr.state.stairTopHeight = parseFloat(stairTopInput.value) || 3.0;
    });
    this.container.appendChild(stairTopInput);

    // === Roof controls ===
    const roofStyleLabel = document.createElement('label');
    roofStyleLabel.textContent = 'Style:';
    roofStyleLabel.id = 'roof-style-label';
    this.container.appendChild(roofStyleLabel);

    const roofStyleSelect = document.createElement('select');
    roofStyleSelect.id = 'roof-style-select';
    for (const style of ['flat', 'peaked_ns', 'peaked_ew'] as const) {
      const opt = document.createElement('option');
      opt.value = style;
      opt.textContent = style;
      roofStyleSelect.appendChild(opt);
    }
    roofStyleSelect.value = this.stateMgr.state.roofStyle;
    roofStyleSelect.addEventListener('change', () => {
      this.stateMgr.state.roofStyle = roofStyleSelect.value as RoofStyle;
    });
    this.container.appendChild(roofStyleSelect);

    const roofHLabel = document.createElement('label');
    roofHLabel.textContent = 'H:';
    roofHLabel.id = 'roof-height-label';
    this.container.appendChild(roofHLabel);

    const roofHInput = document.createElement('input');
    roofHInput.type = 'number';
    roofHInput.id = 'roof-height-input';
    roofHInput.step = '0.5';
    roofHInput.value = String(this.stateMgr.state.roofHeight);
    roofHInput.style.width = '50px';
    roofHInput.addEventListener('input', () => {
      this.stateMgr.state.roofHeight = parseFloat(roofHInput.value) || 4.0;
    });
    this.container.appendChild(roofHInput);

    const roofPeakLabel = document.createElement('label');
    roofPeakLabel.textContent = 'Peak:';
    roofPeakLabel.id = 'roof-peak-label';
    this.container.appendChild(roofPeakLabel);

    const roofPeakInput = document.createElement('input');
    roofPeakInput.type = 'number';
    roofPeakInput.id = 'roof-peak-input';
    roofPeakInput.step = '0.5';
    roofPeakInput.value = String(this.stateMgr.state.roofPeakHeight);
    roofPeakInput.style.width = '50px';
    roofPeakInput.addEventListener('input', () => {
      this.stateMgr.state.roofPeakHeight = parseFloat(roofPeakInput.value) || 1.0;
    });
    this.container.appendChild(roofPeakInput);

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

    // Wall height controls
    const wallHEls = ['wall-height-label', 'wall-height-input'];
    for (const id of wallHEls) {
      const el = document.getElementById(id);
      if (el) el.style.display = active === 'wall' ? '' : 'none';
    }

    // Floor controls
    const floorEls = ['floor-height-label', 'floor-height-input'];
    for (const id of floorEls) {
      const el = document.getElementById(id);
      if (el) el.style.display = active === 'floor' ? '' : 'none';
    }

    // Stair controls
    const stairEls = ['stair-dir-label', 'stair-dir-select', 'stair-base-label', 'stair-base-input', 'stair-top-label', 'stair-top-input'];
    for (const id of stairEls) {
      const el = document.getElementById(id);
      if (el) el.style.display = active === 'stair' ? '' : 'none';
    }

    // Roof controls
    const roofEls = ['roof-style-label', 'roof-style-select', 'roof-height-label', 'roof-height-input', 'roof-peak-label', 'roof-peak-input'];
    for (const id of roofEls) {
      const el = document.getElementById(id);
      if (el) el.style.display = active === 'roof' ? '' : 'none';
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
