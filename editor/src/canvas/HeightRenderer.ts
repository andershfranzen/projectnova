import type { EditorState } from '../state/EditorState';

// Pre-compute a 256-entry color LUT: blue (low) → green (mid) → red (high) → white (peak)
const HEIGHT_LUT_R = new Uint8Array(256);
const HEIGHT_LUT_G = new Uint8Array(256);
const HEIGHT_LUT_B = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const t = i / 255;
  if (t < 0.25) {
    const s = t / 0.25;
    HEIGHT_LUT_R[i] = 0;
    HEIGHT_LUT_G[i] = Math.round(s * 140);
    HEIGHT_LUT_B[i] = Math.round(120 + s * 100);
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    HEIGHT_LUT_R[i] = 0;
    HEIGHT_LUT_G[i] = Math.round(140 + s * 115);
    HEIGHT_LUT_B[i] = Math.round(220 - s * 220);
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    HEIGHT_LUT_R[i] = Math.round(s * 255);
    HEIGHT_LUT_G[i] = 255;
    HEIGHT_LUT_B[i] = 0;
  } else {
    const s = (t - 0.75) / 0.25;
    HEIGHT_LUT_R[i] = 255;
    HEIGHT_LUT_G[i] = Math.round(255 - s * 100);
    HEIGHT_LUT_B[i] = Math.round(s * 200);
  }
}

const CONTOUR_INTERVAL = 16;

export class HeightRenderer {
  private imgCache: ImageData | null = null;
  private cacheW = 0;
  private cacheH = 0;

  render(
    ctx: CanvasRenderingContext2D,
    state: EditorState,
    scrollX: number, scrollZ: number,
    zoom: number,
    startX: number, startZ: number,
    endX: number, endZ: number,
  ): void {
    if (zoom < 2) {
      this.renderImageData(ctx, state, scrollX, scrollZ, zoom, startX, startZ, endX, endZ);
    } else {
      this.renderFillRect(ctx, state, scrollX, scrollZ, zoom, startX, startZ, endX, endZ);
    }

    // Contour lines at medium+ zoom
    if (zoom >= 4) {
      this.renderContours(ctx, state, scrollX, scrollZ, zoom, startX, startZ, endX, endZ);
    }

    // Vertex labels when very zoomed in
    if (zoom >= 16) {
      this.renderLabels(ctx, state, scrollX, scrollZ, zoom, startX, startZ, endX, endZ);
    }
  }

  private getAvgHeight(state: EditorState, tx: number, tz: number): number {
    const vw = state.meta.width + 1;
    return (
      state.heights[tz * vw + tx] +
      state.heights[tz * vw + tx + 1] +
      state.heights[(tz + 1) * vw + tx] +
      state.heights[(tz + 1) * vw + tx + 1]
    ) >> 2; // fast integer divide by 4
  }

  private renderImageData(
    ctx: CanvasRenderingContext2D,
    state: EditorState,
    scrollX: number, scrollZ: number,
    zoom: number,
    _startX: number, _startZ: number,
    _endX: number, _endZ: number,
  ): void {
    const canvasW = ctx.canvas.width;
    const canvasH = ctx.canvas.height;

    if (!this.imgCache || this.cacheW !== canvasW || this.cacheH !== canvasH) {
      this.imgCache = ctx.createImageData(canvasW, canvasH);
      this.cacheW = canvasW;
      this.cacheH = canvasH;
    }

    const data = this.imgCache.data;
    const mapW = state.meta.width;
    const mapH = state.meta.height;
    const vw = mapW + 1;
    const heights = state.heights;

    // Write RGBA pixels — alpha controls overlay blend
    for (let py = 0; py < canvasH; py++) {
      const tz = Math.floor(py / zoom + scrollZ);
      if (tz < 0 || tz >= mapH) {
        // Transparent row
        const rowStart = py * canvasW * 4;
        for (let i = 0; i < canvasW * 4; i += 4) {
          data[rowStart + i + 3] = 0;
        }
        continue;
      }

      for (let px = 0; px < canvasW; px++) {
        const tx = Math.floor(px / zoom + scrollX);
        const idx = (py * canvasW + px) * 4;
        if (tx < 0 || tx >= mapW) {
          data[idx + 3] = 0;
          continue;
        }

        const v = (
          heights[tz * vw + tx] +
          heights[tz * vw + tx + 1] +
          heights[(tz + 1) * vw + tx] +
          heights[(tz + 1) * vw + tx + 1]
        ) >> 2;

        data[idx] = HEIGHT_LUT_R[v];
        data[idx + 1] = HEIGHT_LUT_G[v];
        data[idx + 2] = HEIGHT_LUT_B[v];
        data[idx + 3] = 140; // ~55% opacity
      }
    }

    ctx.putImageData(this.imgCache, 0, 0);
  }

  private renderFillRect(
    ctx: CanvasRenderingContext2D,
    state: EditorState,
    scrollX: number, scrollZ: number,
    zoom: number,
    startX: number, startZ: number,
    endX: number, endZ: number,
  ): void {
    ctx.globalAlpha = 0.55;

    for (let tz = startZ; tz < endZ; tz++) {
      for (let tx = startX; tx < endX; tx++) {
        const v = this.getAvgHeight(state, tx, tz);
        const sx = (tx - scrollX) * zoom;
        const sz = (tz - scrollZ) * zoom;
        ctx.fillStyle = `rgb(${HEIGHT_LUT_R[v]},${HEIGHT_LUT_G[v]},${HEIGHT_LUT_B[v]})`;
        ctx.fillRect(sx, sz, zoom + 0.5, zoom + 0.5);
      }
    }

    ctx.globalAlpha = 1.0;
  }

  private renderContours(
    ctx: CanvasRenderingContext2D,
    state: EditorState,
    scrollX: number, scrollZ: number,
    zoom: number,
    startX: number, startZ: number,
    endX: number, endZ: number,
  ): void {
    const vw = state.meta.width + 1;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = zoom >= 8 ? 1.5 : 0.75;
    ctx.beginPath();

    for (let tz = startZ; tz < endZ; tz++) {
      for (let tx = startX; tx < endX; tx++) {
        const h00 = state.heights[tz * vw + tx];
        const h10 = state.heights[tz * vw + tx + 1];
        const h01 = state.heights[(tz + 1) * vw + tx];

        const sx = (tx - scrollX) * zoom;
        const sz = (tz - scrollZ) * zoom;

        this.addContourCrossings(ctx, h00, h10, sx, sz, sx + zoom, sz);
        this.addContourCrossings(ctx, h00, h01, sx, sz, sx, sz + zoom);
      }
    }

    ctx.stroke();
  }

  private addContourCrossings(
    ctx: CanvasRenderingContext2D,
    h0: number, h1: number,
    x0: number, y0: number,
    x1: number, y1: number,
  ): void {
    if (h0 === h1) return;
    const lo = Math.min(h0, h1);
    const hi = Math.max(h0, h1);
    const firstLevel = Math.ceil(lo / CONTOUR_INTERVAL) * CONTOUR_INTERVAL;
    for (let level = firstLevel; level < hi; level += CONTOUR_INTERVAL) {
      const t = (level - h0) / (h1 - h0);
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      ctx.moveTo(cx - 1.5, cy - 1.5);
      ctx.lineTo(cx + 1.5, cy + 1.5);
      ctx.moveTo(cx + 1.5, cy - 1.5);
      ctx.lineTo(cx - 1.5, cy + 1.5);
    }
  }

  private renderLabels(
    ctx: CanvasRenderingContext2D,
    state: EditorState,
    scrollX: number, scrollZ: number,
    zoom: number,
    startX: number, startZ: number,
    endX: number, endZ: number,
  ): void {
    const vw = state.meta.width + 1;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = `${Math.min(12, zoom * 0.4)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let tz = startZ; tz <= endZ; tz++) {
      for (let tx = startX; tx <= endX; tx++) {
        const h = state.heights[tz * vw + tx];
        const sx = (tx - scrollX) * zoom;
        const sz = (tz - scrollZ) * zoom;
        ctx.fillText(String(h), sx, sz);
      }
    }
  }
}
