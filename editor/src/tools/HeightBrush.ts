import type { EditorToolInterface, EditorToolContext } from './BaseTool';

export class HeightBrush implements EditorToolInterface {
  private painting = false;

  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    this.painting = true;
    ctx.undoMgr.beginStroke('heights');
    this.paint(wx, wz, ctx);
  }

  onMouseMove(wx: number, wz: number, dragging: boolean, ctx: EditorToolContext): void {
    if (dragging && this.painting) {
      this.paint(wx, wz, ctx);
    }
  }

  onMouseUp(_wx: number, _wz: number, ctx: EditorToolContext): void {
    if (this.painting) {
      this.painting = false;
      ctx.undoMgr.endStroke();
    }
  }

  private paint(wx: number, wz: number, ctx: EditorToolContext): void {
    const s = ctx.stateMgr.state;
    // Heights are on vertices, which are offset by 0.5 from tile centers
    const cx = Math.round(wx);
    const cz = Math.round(wz);
    const half = Math.floor(s.brushSize / 2);

    for (let dz = -half; dz < s.brushSize - half; dz++) {
      for (let dx = -half; dx < s.brushSize - half; dx++) {
        const vx = cx + dx;
        const vz = cz + dz;
        ctx.undoMgr.expandRegion(vx, vz);

        const current = ctx.stateMgr.getHeight(vx, vz);
        let newVal: number;

        switch (s.heightMode) {
          case 'set':
            newVal = s.heightValue;
            break;
          case 'raise':
            newVal = current + s.heightDelta;
            break;
          case 'lower':
            newVal = current - s.heightDelta;
            break;
          case 'smooth': {
            // Average of neighbors
            let sum = 0;
            let count = 0;
            for (let nz = -1; nz <= 1; nz++) {
              for (let nx = -1; nx <= 1; nx++) {
                sum += ctx.stateMgr.getHeight(vx + nx, vz + nz);
                count++;
              }
            }
            newVal = sum / count;
            break;
          }
        }

        ctx.stateMgr.setHeight(vx, vz, newVal);
      }
    }
    ctx.requestRender();
  }
}
