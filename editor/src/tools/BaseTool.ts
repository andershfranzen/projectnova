import type { StateManager } from '../state/EditorState';
import type { UndoManager } from '../state/UndoManager';

export interface EditorToolContext {
  stateMgr: StateManager;
  undoMgr: UndoManager;
  requestRender: () => void;
  rebuildMinimap: () => void;
}

export interface EditorToolInterface {
  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void;
  onMouseMove(wx: number, wz: number, dragging: boolean, ctx: EditorToolContext): void;
  onMouseUp(wx: number, wz: number, ctx: EditorToolContext): void;
}
