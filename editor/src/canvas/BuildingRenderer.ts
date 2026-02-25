import type { StateManager } from '../state/EditorState';

/**
 * Renders building features (elevated floors, stairs, roofs, wall heights) as overlays on the 2D map canvas.
 */
export class BuildingRenderer {
  private stateMgr: StateManager;

  constructor(stateMgr: StateManager) {
    this.stateMgr = stateMgr;
  }

  render(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    offsetX: number,
    offsetZ: number,
    canvasW: number,
    canvasH: number
  ): void {
    if (zoom < 1) return;

    const s = this.stateMgr.state;
    const w = s.meta.width;
    const h = s.meta.height;

    const startX = Math.max(0, Math.floor(-offsetX / zoom));
    const startZ = Math.max(0, Math.floor(-offsetZ / zoom));
    const endX = Math.min(w, Math.ceil((canvasW - offsetX) / zoom));
    const endZ = Math.min(h, Math.ceil((canvasH - offsetZ) / zoom));

    ctx.save();

    // Get floor-appropriate data
    const layer = this.stateMgr.getActiveFloorLayer();
    const activeFloors = layer ? layer.floors : s.floors;
    const activeStairs = layer ? layer.stairs : s.stairs;
    const activeRoofs = layer ? layer.roofs : s.roofs;
    const activeWallHeights = layer ? layer.wallHeights : s.wallHeights;
    const wallGetter = (idx: number) => layer ? (layer.walls.get(idx) ?? 0) : (s.walls[idx] ?? 0);

    // Render elevated floors
    for (const [idx, height] of activeFloors) {
      const x = idx % w;
      const z = Math.floor(idx / w);
      if (x < startX || x >= endX || z < startZ || z >= endZ) continue;

      const px = offsetX + x * zoom;
      const pz = offsetZ + z * zoom;

      // Semi-transparent blue overlay
      ctx.fillStyle = `rgba(80, 120, 255, 0.3)`;
      ctx.fillRect(px, pz, zoom, zoom);

      // Height label
      if (zoom >= 8) {
        ctx.fillStyle = '#4080ff';
        ctx.font = `${Math.max(8, zoom * 0.25)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`F${height.toFixed(1)}`, px + zoom / 2, pz + zoom / 2);
      }
    }

    // Render stairs
    for (const [idx, stair] of activeStairs) {
      const x = idx % w;
      const z = Math.floor(idx / w);
      if (x < startX || x >= endX || z < startZ || z >= endZ) continue;

      const px = offsetX + x * zoom;
      const pz = offsetZ + z * zoom;

      // Yellow overlay
      ctx.fillStyle = 'rgba(255, 200, 0, 0.35)';
      ctx.fillRect(px, pz, zoom, zoom);

      // Arrow for direction
      ctx.strokeStyle = '#cc8800';
      ctx.lineWidth = Math.max(1, zoom * 0.08);
      const cx = px + zoom / 2;
      const cz = pz + zoom / 2;
      const arrowLen = zoom * 0.3;

      ctx.beginPath();
      switch (stair.direction) {
        case 'N':
          ctx.moveTo(cx, cz + arrowLen);
          ctx.lineTo(cx, cz - arrowLen);
          ctx.moveTo(cx - arrowLen * 0.5, cz - arrowLen * 0.5);
          ctx.lineTo(cx, cz - arrowLen);
          ctx.lineTo(cx + arrowLen * 0.5, cz - arrowLen * 0.5);
          break;
        case 'S':
          ctx.moveTo(cx, cz - arrowLen);
          ctx.lineTo(cx, cz + arrowLen);
          ctx.moveTo(cx - arrowLen * 0.5, cz + arrowLen * 0.5);
          ctx.lineTo(cx, cz + arrowLen);
          ctx.lineTo(cx + arrowLen * 0.5, cz + arrowLen * 0.5);
          break;
        case 'W':
          ctx.moveTo(cx + arrowLen, cz);
          ctx.lineTo(cx - arrowLen, cz);
          ctx.moveTo(cx - arrowLen * 0.5, cz - arrowLen * 0.5);
          ctx.lineTo(cx - arrowLen, cz);
          ctx.lineTo(cx - arrowLen * 0.5, cz + arrowLen * 0.5);
          break;
        case 'E':
          ctx.moveTo(cx - arrowLen, cz);
          ctx.lineTo(cx + arrowLen, cz);
          ctx.moveTo(cx + arrowLen * 0.5, cz - arrowLen * 0.5);
          ctx.lineTo(cx + arrowLen, cz);
          ctx.lineTo(cx + arrowLen * 0.5, cz + arrowLen * 0.5);
          break;
      }
      ctx.stroke();

      // Height labels
      if (zoom >= 12) {
        ctx.fillStyle = '#886600';
        ctx.font = `${Math.max(7, zoom * 0.18)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${stair.baseHeight}→${stair.topHeight}`, cx, pz + zoom - 1);
      }
    }

    // Render roofs
    for (const [idx, roof] of activeRoofs) {
      const x = idx % w;
      const z = Math.floor(idx / w);
      if (x < startX || x >= endX || z < startZ || z >= endZ) continue;

      const px = offsetX + x * zoom;
      const pz = offsetZ + z * zoom;

      // Red/brown overlay
      const styleColor = roof.style === 'flat' ? 'rgba(180, 80, 80, 0.3)' :
        roof.style === 'peaked_ns' ? 'rgba(180, 100, 60, 0.3)' : 'rgba(160, 80, 100, 0.3)';
      ctx.fillStyle = styleColor;
      ctx.fillRect(px, pz, zoom, zoom);

      // Peaked ridge line
      if (roof.style === 'peaked_ns' && zoom >= 4) {
        ctx.strokeStyle = 'rgba(180, 80, 40, 0.6)';
        ctx.lineWidth = Math.max(1, zoom * 0.05);
        ctx.beginPath();
        ctx.moveTo(px + zoom / 2, pz);
        ctx.lineTo(px + zoom / 2, pz + zoom);
        ctx.stroke();
      } else if (roof.style === 'peaked_ew' && zoom >= 4) {
        ctx.strokeStyle = 'rgba(180, 80, 40, 0.6)';
        ctx.lineWidth = Math.max(1, zoom * 0.05);
        ctx.beginPath();
        ctx.moveTo(px, pz + zoom / 2);
        ctx.lineTo(px + zoom, pz + zoom / 2);
        ctx.stroke();
      }

      // Label
      if (zoom >= 10) {
        ctx.fillStyle = '#993333';
        ctx.font = `${Math.max(7, zoom * 0.18)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = roof.style === 'flat' ? `R${roof.height}` : `R${roof.height}+${roof.peakHeight ?? 0}`;
        ctx.fillText(label, px + zoom / 2, pz + zoom / 2);
      }
    }

    // Render wall height overrides (small indicator on tiles with walls)
    for (const [idx, wh] of activeWallHeights) {
      const x = idx % w;
      const z = Math.floor(idx / w);
      if (x < startX || x >= endX || z < startZ || z >= endZ) continue;
      if (wallGetter(idx) === 0) continue; // only show if tile has walls

      const px = offsetX + x * zoom;
      const pz = offsetZ + z * zoom;

      if (zoom >= 8) {
        ctx.fillStyle = '#ff8800';
        ctx.font = `${Math.max(7, zoom * 0.18)}px monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`h${wh.toFixed(1)}`, px + zoom - 1, pz + 1);
      }
    }

    ctx.restore();
  }
}
