import type { EditorState } from '../state/EditorState';

export class SpawnRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    state: EditorState,
    scrollX: number, scrollZ: number,
    zoom: number,
  ): void {
    const minSize = Math.max(4, zoom * 0.6);

    // Draw NPC spawns as circles
    for (const spawn of state.spawns.npcs) {
      const sx = (spawn.x - scrollX) * zoom;
      const sz = (spawn.z - scrollZ) * zoom;

      // Find NPC name
      const def = state.npcDefs.find(d => d.id === spawn.npcId);
      const name = def ? def.name : `NPC#${spawn.npcId}`;

      ctx.fillStyle = '#ff4444';
      ctx.beginPath();
      ctx.arc(sx, sz, minSize, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sz, minSize, 0, Math.PI * 2);
      ctx.stroke();

      if (zoom >= 3) {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(10, Math.min(14, zoom * 0.8))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(name, sx, sz - minSize - 3);
      }
    }

    // Draw object spawns as squares
    const objects = state.spawns.objects || [];
    for (const spawn of objects) {
      const sx = (spawn.x - scrollX) * zoom;
      const sz = (spawn.z - scrollZ) * zoom;

      const def = state.objectDefs.find(d => d.id === spawn.objectId);
      const name = def ? def.name : `Obj#${spawn.objectId}`;

      ctx.fillStyle = '#44aaff';
      ctx.fillRect(sx - minSize, sz - minSize, minSize * 2, minSize * 2);

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx - minSize, sz - minSize, minSize * 2, minSize * 2);

      if (zoom >= 3) {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(10, Math.min(14, zoom * 0.8))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(name, sx, sz - minSize - 3);
      }
    }

    // Draw spawn point marker
    if (state.meta.spawnPoint) {
      const sp = state.meta.spawnPoint;
      const sx = (sp.x - scrollX) * zoom;
      const sz = (sp.z - scrollZ) * zoom;
      const r = Math.max(6, zoom * 0.8);

      ctx.strokeStyle = '#0f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - r, sz);
      ctx.lineTo(sx + r, sz);
      ctx.moveTo(sx, sz - r);
      ctx.lineTo(sx, sz + r);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(sx, sz, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw transition markers
    for (const t of state.meta.transitions) {
      const sx = (t.tileX + 0.5 - scrollX) * zoom;
      const sz = (t.tileZ + 0.5 - scrollZ) * zoom;
      const r = Math.max(6, zoom * 0.5);

      ctx.fillStyle = 'rgba(200, 0, 255, 0.6)';
      ctx.fillRect(sx - r, sz - r, r * 2, r * 2);
      ctx.strokeStyle = '#c800ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - r, sz - r, r * 2, r * 2);

      if (zoom >= 4) {
        ctx.fillStyle = '#e0c0ff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`-> ${t.targetMap}`, sx, sz - r - 3);
      }
    }
  }
}
