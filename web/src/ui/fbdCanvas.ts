import { BLOCK_DEF_MAP, formatBlockAddress, formatBlockHeaderLabel } from '../catalog/blocks';
import { adcToEng, OniPlcSimulator } from '../engine/simulator';
import { BlockInstance, BlockTypeDefinition, CanvasNote, OniProject, PinDefinition, WireConnection } from '../types';

export type EditorToolMode = 'select' | 'wire' | 'place_block' | 'note' | 'scissors';

export interface PinHit {
  block: BlockInstance;
  def: BlockTypeDefinition;
  pin: PinDefinition;
  side: 'in' | 'out';
  wx: number;
  wy: number;
}

export interface ContextMenuRequest {
  clientX: number;
  clientY: number;
  worldX: number;
  worldY: number;
  targetBlock?: BlockInstance;
  targetPin?: PinHit;
  targetWire?: WireConnection;
  targetNote?: CanvasNote;
}

export interface FbdCanvasCallbacks {
  onProjectMutated: (reason: string) => void;
  onSelectionChanged: (selectedBlockIds: string[]) => void;
  onOpenBlockProperties: (block: BlockInstance) => void;
  onOpenNoteEditor: (note: CanvasNote) => void;
  onContextMenu: (req: ContextMenuRequest) => void;
  onQuickAnalogAdjust: (block: BlockInstance, clientX: number, clientY: number) => void;
  onSimInputChanged: () => void;
  onToolResetToSelect: () => void;
}

export const BLOCK_W = 42;
export const BLOCK_MIN_H = 52;

export function getBlockHeight(def: BlockTypeDefinition): number {
  const maxPins = Math.max(def.inputs.length, def.outputs.length, 1);
  return Math.max(BLOCK_MIN_H, maxPins * 14 + 14);
}

export function getPinWorldPos(
  block: BlockInstance,
  def: BlockTypeDefinition,
  side: 'in' | 'out',
  pinIndex: number
): { x: number; y: number } {
  const h = getBlockHeight(def);
  const count = side === 'in' ? def.inputs.length : def.outputs.length;
  const spacing = h / (count + 1);
  const y = Math.round(block.y + spacing * (pinIndex + 1));
  const x = side === 'in' ? block.x - 7 : block.x + BLOCK_W + 7;
  return { x, y };
}

export class FbdSchematicCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private project: OniProject;
  private sim: OniPlcSimulator;
  private cb: FbdCanvasCallbacks;

  public zoom = 1.15;
  public panX = 30;
  public panY = 24;
  public showGrid = true;
  public showModbusAddresses = true;
  public showBlockParams = true;

  public toolMode: EditorToolMode = 'select';
  public pendingBlockType: string | null = null;

  public selectedBlockIds = new Set<string>();
  public selectedWireId: string | null = null;
  public selectedNoteId: string | null = null;

  private hoveredPin: PinHit | null = null;
  private hoveredBlock: BlockInstance | null = null;
  private hoveredWire: WireConnection | null = null;

  // Interaction states
  private isPanning = false;
  private spacePressed = false;
  private panStartClient = { x: 0, y: 0 };
  private panStartOffset = { x: 0, y: 0 };

  private isDraggingBlocks = false;
  private dragStartWorld = { x: 0, y: 0 };
  private dragInitialPositions = new Map<string, { x: number; y: number }>();
  private dragMoved = false;

  private isMarquee = false;
  private marqueeStart = { x: 0, y: 0 };
  private marqueeCurr = { x: 0, y: 0 };

  private activeWireSource: PinHit | null = null;
  private pointerWorld = { x: 0, y: 0 };

  private activeMomentaryChannel: { ch: number; restoreVal: boolean } | null = null;

  // Two-finger touch pinch/pan state
  private activeTouches = new Map<number, { x: number; y: number }>();
  private lastPinchDist = 0;
  private lastPinchCenter = { x: 0, y: 0 };
  private longPressTimer: number | null = null;

  constructor(
    container: HTMLElement,
    project: OniProject,
    sim: OniPlcSimulator,
    callbacks: FbdCanvasCallbacks
  ) {
    this.project = project;
    this.sim = sim;
    this.cb = callbacks;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'oni-fbd-canvas';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    this.bindEvents();
    this.resize();
  }

  public setProject(project: OniProject) {
    this.project = project;
    this.selectedBlockIds.clear();
    this.selectedWireId = null;
    this.selectedNoteId = null;
    this.activeWireSource = null;
    this.render();
  }

  public resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(300, Math.floor(rect.width));
    const h = Math.max(200, Math.floor(rect.height));
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  public fitToContent() {
    if (this.project.blocks.length === 0) {
      this.zoom = 1.15;
      this.panX = 30;
      this.panY = 24;
      this.render();
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const b of this.project.blocks) {
      minX = Math.min(minX, b.x - 40);
      minY = Math.min(minY, b.y - 30);
      maxX = Math.max(maxX, b.x + BLOCK_W + 60);
      maxY = Math.max(maxY, b.y + 85);
    }
    for (const n of this.project.notes) {
      minX = Math.min(minX, n.x - 10);
      minY = Math.min(minY, n.y - 20);
      maxX = Math.max(maxX, n.x + 320);
      maxY = Math.max(maxY, n.y + 70);
    }
    const viewW = this.canvas.clientWidth || 900;
    const viewH = this.canvas.clientHeight || 500;
    const contentW = Math.max(200, maxX - minX);
    const contentH = Math.max(160, maxY - minY);
    const z = Math.max(0.55, Math.min(1.6, Math.min((viewW - 60) / contentW, (viewH - 60) / contentH)));
    this.zoom = Number(z.toFixed(2));
    this.panX = Math.round((viewW - contentW * this.zoom) / 2 - minX * this.zoom);
    this.panY = Math.round((viewH - contentH * this.zoom) / 2 - minY * this.zoom);
    this.render();
  }

  public setZoom(newZoom: number, anchorClientX?: number, anchorClientY?: number) {
    const clamped = Math.max(0.4, Math.min(2.8, newZoom));
    const rect = this.canvas.getBoundingClientRect();
    const cx = anchorClientX !== undefined ? anchorClientX - rect.left : rect.width / 2;
    const cy = anchorClientY !== undefined ? anchorClientY - rect.top : rect.height / 2;
    const wx = (cx - this.panX) / this.zoom;
    const wy = (cy - this.panY) / this.zoom;
    this.zoom = Number(clamped.toFixed(2));
    this.panX = cx - wx * this.zoom;
    this.panY = cy - wy * this.zoom;
    this.render();
  }

  public clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  private bindEvents() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        this.spacePressed = true;
      }
      if (e.key === 'Escape') {
        this.activeWireSource = null;
        if (this.toolMode !== 'select') {
          this.toolMode = 'select';
          this.pendingBlockType = null;
          this.cb.onToolResetToSelect();
        }
        this.render();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spacePressed = false;
    });

    // Prevent browser default context menu; open authentic ONI PLR Studio right-click menu!
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.activeWireSource) {
        this.activeWireSource = null;
        this.render();
        return;
      }
      const world = this.clientToWorld(e.clientX, e.clientY);
      const pin = this.hitTestPin(world.x, world.y);
      const block = !pin ? this.hitTestBlock(world.x, world.y) : undefined;
      const wire = !pin && !block ? this.hitTestWire(world.x, world.y) : undefined;
      const note = !pin && !block && !wire ? this.hitTestNote(world.x, world.y) : undefined;

      if (block && !this.selectedBlockIds.has(block.id)) {
        this.selectedBlockIds.clear();
        this.selectedBlockIds.add(block.id);
        this.cb.onSelectionChanged([...this.selectedBlockIds]);
        this.render();
      }
      this.cb.onContextMenu({
        clientX: e.clientX,
        clientY: e.clientY,
        worldX: world.x,
        worldY: world.y,
        targetBlock: block ?? undefined,
        targetPin: pin ?? undefined,
        targetWire: wire ?? undefined,
        targetNote: note ?? undefined,
      });
    });

    // Mouse wheel zoom
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.91;
        this.setZoom(this.zoom * factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    // Double-click: invert input pin (Slide 4 ONI PLR Studio feature!) OR open Block Properties!
    this.canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const world = this.clientToWorld(e.clientX, e.clientY);
      const pinHit = this.hitTestPin(world.x, world.y);
      if (pinHit && pinHit.side === 'in' && pinHit.pin.invertible && !this.sim.running) {
        pinHit.block.invertedInputs = pinHit.block.invertedInputs || {};
        pinHit.block.invertedInputs[pinHit.pin.id] = !pinHit.block.invertedInputs[pinHit.pin.id];
        this.activeWireSource = null;
        this.cb.onProjectMutated('Инверсия входа блока');
        this.render();
        return;
      }
      const blk = this.hitTestBlock(world.x, world.y);
      if (blk) {
        this.cb.onOpenBlockProperties(blk);
        return;
      }
      const note = this.hitTestNote(world.x, world.y);
      if (note) {
        this.cb.onOpenNoteEditor(note);
      }
    });

    // Pointer events (handles USB/Bluetooth mouse, stylus, and finger touch seamlessly!)
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    // HTML5 Drag & Drop from Left Block Library Tree
    this.canvas.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    this.canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const blockType = e.dataTransfer?.getData('application/x-oni-block');
      if (blockType && !this.sim.running) {
        const w = this.clientToWorld(e.clientX, e.clientY);
        this.placeNewBlockAt(blockType, w.x - BLOCK_W / 2, w.y - 24);
      }
    });
  }

  private clearLongPress() {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private onPointerDown(e: PointerEvent) {
    this.canvas.focus();

    if (e.pointerType === 'touch') {
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouches.size === 2) {
        this.clearLongPress();
        const pts = [...this.activeTouches.values()];
        this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this.lastPinchCenter = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        this.isDraggingBlocks = false;
        this.isMarquee = false;
        return;
      }
      // Long-press on touch opens right-click context menu!
      this.clearLongPress();
      const cx = e.clientX;
      const cy = e.clientY;
      this.longPressTimer = window.setTimeout(() => {
        const world = this.clientToWorld(cx, cy);
        const pin = this.hitTestPin(world.x, world.y);
        const block = !pin ? this.hitTestBlock(world.x, world.y) : undefined;
        const wire = !pin && !block ? this.hitTestWire(world.x, world.y) : undefined;
        this.isDraggingBlocks = false;
        this.isMarquee = false;
        this.cb.onContextMenu({
          clientX: cx,
          clientY: cy,
          worldX: world.x,
          worldY: world.y,
          targetBlock: block ?? undefined,
          targetPin: pin ?? undefined,
          targetWire: wire ?? undefined,
        });
      }, 550);
    }

    // Middle mouse button or Space+Left -> Pan
    if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
      e.preventDefault();
      this.isPanning = true;
      this.panStartClient = { x: e.clientX, y: e.clientY };
      this.panStartOffset = { x: this.panX, y: this.panY };
      return;
    }

    if (e.button !== 0) return;

    const world = this.clientToWorld(e.clientX, e.clientY);
    this.pointerWorld = world;

    // ======== SIMULATION MODE INTERACTIONS ========
    if (this.sim.running) {
      const blk = this.hitTestBlock(world.x, world.y);
      if (blk) {
        if (blk.type === 'DI') {
          const ch = blk.channelIndex;
          const mode = (blk.params.simSwitchMode as string) || blk.simMode || 'toggle';
          if (mode === 'momentary_no') {
            this.activeMomentaryChannel = { ch, restoreVal: false };
            this.sim.diState[ch] = true;
          } else if (mode === 'momentary_nc') {
            this.activeMomentaryChannel = { ch, restoreVal: true };
            this.sim.diState[ch] = false;
          } else {
            this.sim.diState[ch] = !this.sim.diState[ch];
          }
          this.cb.onSimInputChanged();
          this.render();
          return;
        }
        if (blk.type === 'AI') {
          this.cb.onQuickAnalogAdjust(blk, e.clientX, e.clientY);
          return;
        }
        if (blk.type === 'C') {
          const ch = blk.channelIndex;
          this.sim.cKeyState[ch] = !this.sim.cKeyState[ch];
          this.cb.onSimInputChanged();
          this.render();
          return;
        }
      }
      // Allow panning on empty canvas in Simulation mode!
      this.isPanning = true;
      this.panStartClient = { x: e.clientX, y: e.clientY };
      this.panStartOffset = { x: this.panX, y: this.panY };
      return;
    }

    // ======== EDIT MODE INTERACTIONS ========
    if (this.toolMode === 'place_block' && this.pendingBlockType) {
      this.placeNewBlockAt(this.pendingBlockType, world.x - BLOCK_W / 2, world.y - 24);
      if (!e.shiftKey) {
        // Keep placing if Shift held, otherwise return to cursor or keep placing like ONI?
        // In ONI PLR Studio, clicking places block; Esc or Cursor switches back. Let's allow multiple placements until Esc or right-click, OR single if touch!
        if (e.pointerType === 'touch') {
          this.toolMode = 'select';
          this.pendingBlockType = null;
          this.cb.onToolResetToSelect();
        }
      }
      return;
    }

    if (this.toolMode === 'note') {
      const newNote: CanvasNote = {
        id: `note_${Date.now()}`,
        x: Math.round(world.x / 10) * 10,
        y: Math.round(world.y / 10) * 10,
        text: 'Комментарий КИПиА',
      };
      this.project.notes.push(newNote);
      this.toolMode = 'select';
      this.cb.onToolResetToSelect();
      this.cb.onProjectMutated('Добавлена надпись');
      this.cb.onOpenNoteEditor(newNote);
      this.render();
      return;
    }

    if (this.toolMode === 'scissors') {
      const wire = this.hitTestWire(world.x, world.y);
      if (wire) {
        wire.splitMode = !wire.splitMode;
        this.cb.onProjectMutated('Разрыв/сшивка линии связи');
        this.render();
      }
      return;
    }

    // Check pin hit first (for wiring in both 'select' and 'wire' modes!)
    const pinHit = this.hitTestPin(world.x, world.y);
    if (pinHit) {
      if (!this.activeWireSource) {
        this.activeWireSource = pinHit;
        this.render();
        return;
      } else {
        this.tryCompleteWire(this.activeWireSource, pinHit);
        this.activeWireSource = null;
        this.render();
        return;
      }
    }

    if (this.activeWireSource) {
      // Clicked empty space while drawing wire -> cancel wire
      this.activeWireSource = null;
      this.render();
      return;
    }

    // Check block hit
    const blkHit = this.hitTestBlock(world.x, world.y);
    if (blkHit) {
      this.selectedWireId = null;
      this.selectedNoteId = null;
      if (e.shiftKey) {
        if (this.selectedBlockIds.has(blkHit.id)) this.selectedBlockIds.delete(blkHit.id);
        else this.selectedBlockIds.add(blkHit.id);
      } else if (!this.selectedBlockIds.has(blkHit.id)) {
        this.selectedBlockIds.clear();
        this.selectedBlockIds.add(blkHit.id);
      }
      this.cb.onSelectionChanged([...this.selectedBlockIds]);

      this.isDraggingBlocks = true;
      this.dragMoved = false;
      this.dragStartWorld = { x: world.x, y: world.y };
      this.dragInitialPositions.clear();
      for (const id of this.selectedBlockIds) {
        const b = this.project.blocks.find((item) => item.id === id);
        if (b) this.dragInitialPositions.set(id, { x: b.x, y: b.y });
      }
      this.render();
      return;
    }

    // Check note hit
    const noteHit = this.hitTestNote(world.x, world.y);
    if (noteHit) {
      this.selectedBlockIds.clear();
      this.selectedWireId = null;
      this.selectedNoteId = noteHit.id;
      this.cb.onSelectionChanged([]);
      this.isDraggingBlocks = true;
      this.dragMoved = false;
      this.dragStartWorld = { x: world.x, y: world.y };
      this.dragInitialPositions.clear();
      this.dragInitialPositions.set(noteHit.id, { x: noteHit.x, y: noteHit.y });
      this.render();
      return;
    }

    // Check wire hit
    const wireHit = this.hitTestWire(world.x, world.y);
    if (wireHit) {
      this.selectedBlockIds.clear();
      this.selectedNoteId = null;
      this.selectedWireId = wireHit.id;
      this.cb.onSelectionChanged([]);
      this.render();
      return;
    }

    // Empty canvas -> start rubber-band marquee selection
    if (!e.shiftKey) {
      this.selectedBlockIds.clear();
      this.selectedWireId = null;
      this.selectedNoteId = null;
      this.cb.onSelectionChanged([]);
    }
    this.isMarquee = true;
    this.marqueeStart = { x: world.x, y: world.y };
    this.marqueeCurr = { x: world.x, y: world.y };
    this.render();
  }

  private onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch' && this.activeTouches.has(e.pointerId)) {
      const prev = this.activeTouches.get(e.pointerId)!;
      if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 8) {
        this.clearLongPress();
      }
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouches.size === 2) {
        const pts = [...this.activeTouches.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (this.lastPinchDist > 10) {
          const scale = dist / this.lastPinchDist;
          this.setZoom(this.zoom * scale, center.x, center.y);
        }
        this.panX += center.x - this.lastPinchCenter.x;
        this.panY += center.y - this.lastPinchCenter.y;
        this.lastPinchDist = dist;
        this.lastPinchCenter = center;
        this.render();
        return;
      }
    }

    if (this.isPanning) {
      this.panX = this.panStartOffset.x + (e.clientX - this.panStartClient.x);
      this.panY = this.panStartOffset.y + (e.clientY - this.panStartClient.y);
      this.render();
      return;
    }

    const world = this.clientToWorld(e.clientX, e.clientY);
    this.pointerWorld = world;

    if (this.isDraggingBlocks) {
      const dx = world.x - this.dragStartWorld.x;
      const dy = world.y - this.dragStartWorld.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.dragMoved = true;

      if (this.selectedNoteId && this.dragInitialPositions.has(this.selectedNoteId)) {
        const init = this.dragInitialPositions.get(this.selectedNoteId)!;
        const note = this.project.notes.find((n) => n.id === this.selectedNoteId);
        if (note) {
          note.x = Math.max(10, Math.round((init.x + dx) / 10) * 10);
          note.y = Math.max(20, Math.round((init.y + dy) / 10) * 10);
        }
      } else {
        for (const [id, init] of this.dragInitialPositions.entries()) {
          const b = this.project.blocks.find((item) => item.id === id);
          if (b) {
            b.x = Math.max(20, Math.round((init.x + dx) / 10) * 10);
            b.y = Math.max(25, Math.round((init.y + dy) / 10) * 10);
          }
        }
      }
      this.render();
      return;
    }

    if (this.isMarquee) {
      this.marqueeCurr = { x: world.x, y: world.y };
      const x1 = Math.min(this.marqueeStart.x, this.marqueeCurr.x);
      const y1 = Math.min(this.marqueeStart.y, this.marqueeCurr.y);
      const x2 = Math.max(this.marqueeStart.x, this.marqueeCurr.x);
      const y2 = Math.max(this.marqueeStart.y, this.marqueeCurr.y);
      this.selectedBlockIds.clear();
      for (const b of this.project.blocks) {
        const def = BLOCK_DEF_MAP[b.type];
        const bh = def ? getBlockHeight(def) : BLOCK_MIN_H;
        if (b.x + BLOCK_W >= x1 && b.x <= x2 && b.y + bh >= y1 && b.y <= y2) {
          this.selectedBlockIds.add(b.id);
        }
      }
      this.cb.onSelectionChanged([...this.selectedBlockIds]);
      this.render();
      return;
    }

    // Hover feedback
    const prevPin = this.hoveredPin;
    const prevBlk = this.hoveredBlock;
    const prevWire = this.hoveredWire;
    this.hoveredPin = this.hitTestPin(world.x, world.y);
    this.hoveredBlock = !this.hoveredPin ? this.hitTestBlock(world.x, world.y) : null;
    this.hoveredWire = !this.hoveredPin && !this.hoveredBlock ? this.hitTestWire(world.x, world.y) : null;

    if (this.hoveredPin) {
      this.canvas.style.cursor = 'crosshair';
    } else if (this.sim.running && this.hoveredBlock && (this.hoveredBlock.type === 'DI' || this.hoveredBlock.type === 'AI' || this.hoveredBlock.type === 'C')) {
      this.canvas.style.cursor = 'pointer';
    } else if (this.toolMode === 'place_block' || this.toolMode === 'wire' || this.toolMode === 'note') {
      this.canvas.style.cursor = 'crosshair';
    } else if (this.hoveredBlock) {
      this.canvas.style.cursor = 'move';
    } else if (this.spacePressed) {
      this.canvas.style.cursor = 'grab';
    } else {
      this.canvas.style.cursor = 'default';
    }

    if (
      this.activeWireSource ||
      this.toolMode === 'place_block' ||
      prevPin?.pin.id !== this.hoveredPin?.pin.id ||
      prevBlk?.id !== this.hoveredBlock?.id ||
      prevWire?.id !== this.hoveredWire?.id
    ) {
      this.render();
    }
  }

  private onPointerUp(e: PointerEvent) {
    this.clearLongPress();
    if (e.pointerType === 'touch') {
      this.activeTouches.delete(e.pointerId);
      if (this.activeTouches.size < 2) this.lastPinchDist = 0;
    }

    if (this.activeMomentaryChannel) {
      this.sim.diState[this.activeMomentaryChannel.ch] = this.activeMomentaryChannel.restoreVal;
      this.activeMomentaryChannel = null;
      this.cb.onSimInputChanged();
      this.render();
    }

    if (this.isPanning) {
      this.isPanning = false;
    }

    // Support drag-and-release wiring from pin A directly onto pin B!
    if (this.activeWireSource) {
      const world = this.clientToWorld(e.clientX, e.clientY);
      const endPin = this.hitTestPin(world.x, world.y);
      if (endPin && (endPin.block.id !== this.activeWireSource.block.id || endPin.pin.id !== this.activeWireSource.pin.id)) {
        this.tryCompleteWire(this.activeWireSource, endPin);
        this.activeWireSource = null;
        this.render();
      }
    }

    if (this.isDraggingBlocks) {
      this.isDraggingBlocks = false;
      if (this.dragMoved) {
        this.cb.onProjectMutated('Перемещение элементов схемы');
      }
    }

    if (this.isMarquee) {
      this.isMarquee = false;
      this.render();
    }
  }

  public placeNewBlockAt(blockType: string, rawX: number, rawY: number): BlockInstance | null {
    const def = BLOCK_DEF_MAP[blockType];
    if (!def) return null;

    // Pick lowest unused channel number for this prefix
    const used = new Set(
      this.project.blocks
        .filter((b) => {
          const d = BLOCK_DEF_MAP[b.type];
          if (!d) return false;
          if (def.prefix === 'B') return d.prefix === 'B';
          return b.type === blockType;
        })
        .map((b) => b.channelIndex)
    );
    let ch = 1;
    while (used.has(ch)) ch++;

    const params: Record<string, number | string | boolean> = {};
    for (const p of def.params) params[p.key] = p.defaultValue;

    const newBlk: BlockInstance = {
      id: `blk_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: blockType,
      channelIndex: ch,
      x: Math.max(30, Math.round(rawX / 10) * 10),
      y: Math.max(30, Math.round(rawY / 10) * 10),
      customName: '',
      comment: '',
      showParams: Boolean(def.showParamsOnCanvas),
      retentive: false,
      protectedBlock: false,
      invertedInputs: {},
      params,
    };

    this.project.blocks.push(newBlk);
    this.selectedBlockIds.clear();
    this.selectedBlockIds.add(newBlk.id);
    this.cb.onSelectionChanged([newBlk.id]);
    this.cb.onProjectMutated(`Добавлен блок ${formatBlockHeaderLabel(def, ch, '')}`);
    this.render();
    return newBlk;
  }

  private tryCompleteWire(a: PinHit, b: PinHit) {
    if (a.side === b.side) return;
    const outHit = a.side === 'out' ? a : b;
    const inHit = a.side === 'in' ? a : b;

    // Prevent connecting analog output to digital input without comparator (warn or allow? In ONI PLR Studio, digital->digital and analog->analog!)
    if (outHit.pin.type !== inHit.pin.type) {
      return;
    }

    // Replace existing wire connected to this input pin (1 driver per input pin in FBD!)
    this.project.wires = this.project.wires.filter(
      (w) => !(w.toBlockId === inHit.block.id && w.toPinId === inHit.pin.id)
    );

    this.project.wires.push({
      id: `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      fromBlockId: outHit.block.id,
      fromPinId: outHit.pin.id,
      toBlockId: inHit.block.id,
      toPinId: inHit.pin.id,
    });
    this.cb.onProjectMutated('Создано соединение');
  }

  public deleteSelection() {
    if (this.sim.running) return;
    let changed = false;
    if (this.selectedBlockIds.size > 0) {
      this.project.blocks = this.project.blocks.filter((b) => !this.selectedBlockIds.has(b.id));
      this.project.wires = this.project.wires.filter(
        (w) => !this.selectedBlockIds.has(w.fromBlockId) && !this.selectedBlockIds.has(w.toBlockId)
      );
      this.selectedBlockIds.clear();
      this.cb.onSelectionChanged([]);
      changed = true;
    }
    if (this.selectedWireId) {
      this.project.wires = this.project.wires.filter((w) => w.id !== this.selectedWireId);
      this.selectedWireId = null;
      changed = true;
    }
    if (this.selectedNoteId) {
      this.project.notes = this.project.notes.filter((n) => n.id !== this.selectedNoteId);
      this.selectedNoteId = null;
      changed = true;
    }
    if (changed) {
      this.cb.onProjectMutated('Удаление выбранных элементов');
      this.render();
    }
  }

  private hitTestPin(wx: number, wy: number): PinHit | null {
    const hitRadius = 9;
    for (let i = this.project.blocks.length - 1; i >= 0; i--) {
      const b = this.project.blocks[i];
      const def = BLOCK_DEF_MAP[b.type];
      if (!def) continue;
      for (let idx = 0; idx < def.inputs.length; idx++) {
        const pos = getPinWorldPos(b, def, 'in', idx);
        if (Math.hypot(wx - pos.x, wy - pos.y) <= hitRadius) {
          return { block: b, def, pin: def.inputs[idx], side: 'in', wx: pos.x, wy: pos.y };
        }
      }
      for (let idx = 0; idx < def.outputs.length; idx++) {
        const pos = getPinWorldPos(b, def, 'out', idx);
        if (Math.hypot(wx - pos.x, wy - pos.y) <= hitRadius) {
          return { block: b, def, pin: def.outputs[idx], side: 'out', wx: pos.x, wy: pos.y };
        }
      }
    }
    return null;
  }

  private hitTestBlock(wx: number, wy: number): BlockInstance | null {
    for (let i = this.project.blocks.length - 1; i >= 0; i--) {
      const b = this.project.blocks[i];
      const def = BLOCK_DEF_MAP[b.type];
      if (!def) continue;
      const h = getBlockHeight(def);
      if (wx >= b.x && wx <= b.x + BLOCK_W && wy >= b.y && wy <= b.y + h) {
        return b;
      }
    }
    return null;
  }

  private hitTestNote(wx: number, wy: number): CanvasNote | null {
    for (let i = this.project.notes.length - 1; i >= 0; i--) {
      const n = this.project.notes[i];
      const lines = n.text.split('\n');
      const maxLen = Math.max(...lines.map((l) => l.length), 8);
      const w = maxLen * 7.2 + 12;
      const h = lines.length * 16 + 8;
      if (wx >= n.x - 4 && wx <= n.x + w && wy >= n.y - 14 && wy <= n.y + h - 10) {
        return n;
      }
    }
    return null;
  }

  private computeOrthogonalPoints(x1: number, y1: number, x2: number, y2: number, seedOffset = 0): { x: number; y: number }[] {
    if (x2 >= x1 + 12) {
      const midX = Math.round(((x1 + x2) / 2 + seedOffset) / 5) * 5;
      return [
        { x: x1, y: y1 },
        { x: midX, y: y1 },
        { x: midX, y: y2 },
        { x: x2, y: y2 },
      ];
    }
    // Feedback loop (target pin is to the left of source pin) -> route cleanly above/below!
    const detourY = y2 >= y1 ? Math.max(y1, y2) + 42 : Math.min(y1, y2) - 42;
    return [
      { x: x1, y: y1 },
      { x: x1 + 16, y: y1 },
      { x: x1 + 16, y: detourY },
      { x: x2 - 16, y: detourY },
      { x: x2 - 16, y: y2 },
      { x: x2, y: y2 },
    ];
  }

  private hitTestWire(wx: number, wy: number): WireConnection | null {
    const blkMap = new Map(this.project.blocks.map((b) => [b.id, b]));
    for (const w of this.project.wires) {
      if (w.splitMode) continue;
      const fb = blkMap.get(w.fromBlockId);
      const tb = blkMap.get(w.toBlockId);
      if (!fb || !tb) continue;
      const fDef = BLOCK_DEF_MAP[fb.type];
      const tDef = BLOCK_DEF_MAP[tb.type];
      if (!fDef || !tDef) continue;
      const outIdx = Math.max(0, fDef.outputs.findIndex((p) => p.id === w.fromPinId));
      const inIdx = Math.max(0, tDef.inputs.findIndex((p) => p.id === w.toPinId));
      const p1 = getPinWorldPos(fb, fDef, 'out', outIdx);
      const p2 = getPinWorldPos(tb, tDef, 'in', inIdx);
      const pts = this.computeOrthogonalPoints(p1.x, p1.y, p2.x, p2.y);
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegment(wx, wy, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        if (d <= 6) return w;
      }
    }
    return null;
  }

  public render() {
    const ctx = this.ctx;
    const viewW = this.canvas.clientWidth || 800;
    const viewH = this.canvas.clientHeight || 500;

    // 1. Authentic ONI PLR Studio silver-grey background (#B5B5B5)
    ctx.fillStyle = '#B5B5B5';
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // 2. Dotted 10px grid (#6C6C6C)
    if (this.showGrid && this.zoom >= 0.55) {
      const startX = Math.floor(-this.panX / this.zoom / 10) * 10;
      const startY = Math.floor(-this.panY / this.zoom / 10) * 10;
      const endX = startX + viewW / this.zoom + 20;
      const endY = startY + viewH / this.zoom + 20;
      ctx.fillStyle = '#6A6A6A';
      const step = this.zoom < 0.8 ? 20 : 10;
      for (let gx = startX; gx < endX; gx += step) {
        for (let gy = startY; gy < endY; gy += step) {
          ctx.fillRect(gx, gy, 1.15, 1.15);
        }
      }
    }

    // 3. Render free text notes (Consolas monospace black text like ONI PLR Studio)
    for (const note of this.project.notes) {
      const isSel = this.selectedNoteId === note.id;
      const lines = note.text.split('\n');
      if (isSel) {
        const maxLen = Math.max(...lines.map((l) => l.length), 8);
        ctx.strokeStyle = '#0055CC';
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(note.x - 4, note.y - 13, maxLen * 7.2 + 12, lines.length * 15 + 8);
        ctx.setLineDash([]);
      }
      ctx.font = '12px "Consolas", "Courier New", monospace';
      ctx.fillStyle = '#000000';
      lines.forEach((line, idx) => {
        ctx.fillText(line, note.x, note.y + idx * 15);
      });
    }

    // 4. Render wires (Black in Edit Mode; RED = ON / BLUE = OFF in Simulation Mode!)
    const blkMap = new Map(this.project.blocks.map((b) => [b.id, b]));
    const fanoutCounts = new Map<string, number>();
    for (const w of this.project.wires) {
      const k = `${w.fromBlockId}:${w.fromPinId}`;
      fanoutCounts.set(k, (fanoutCounts.get(k) ?? 0) + 1);
    }

    for (const w of this.project.wires) {
      const fb = blkMap.get(w.fromBlockId);
      const tb = blkMap.get(w.toBlockId);
      if (!fb || !tb) continue;
      const fDef = BLOCK_DEF_MAP[fb.type];
      const tDef = BLOCK_DEF_MAP[tb.type];
      if (!fDef || !tDef) continue;

      const outIdx = Math.max(0, fDef.outputs.findIndex((p) => p.id === w.fromPinId));
      const inIdx = Math.max(0, tDef.inputs.findIndex((p) => p.id === w.toPinId));
      const outPin = fDef.outputs[outIdx];
      const p1 = getPinWorldPos(fb, fDef, 'out', outIdx);
      const p2 = getPinWorldPos(tb, tDef, 'in', inIdx);

      let stroke = '#000000';
      let lineWidth = 1.4;
      if (this.sim.running) {
        const st = this.sim.blockStates[fb.id];
        if (outPin?.type === 'analog') {
          stroke = '#006050';
          lineWidth = 2.0;
        } else {
          const isHigh = Boolean(st?.digitalOutputs?.[w.fromPinId] ?? st?.digitalOutputs?.Q ?? false);
          stroke = isHigh ? '#FF0000' : '#0000FF';
          lineWidth = isHigh ? 2.0 : 1.5;
        }
      } else if (this.selectedWireId === w.id) {
        stroke = '#FF6600';
        lineWidth = 2.4;
      } else if (this.hoveredWire?.id === w.id) {
        stroke = '#0044AA';
        lineWidth = 2.0;
      }

      if (w.splitMode) {
        // Cut/Reference arrow labels (Scissors mode in ONI PLR Studio)
        const srcTag = formatBlockAddress(fDef.prefix, fb.channelIndex);
        const dstTag = formatBlockAddress(tDef.prefix, tb.channelIndex);
        ctx.fillStyle = '#EFEFEF';
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.1;
        ctx.fillRect(p1.x + 2, p1.y - 7, 46, 14);
        ctx.strokeRect(p1.x + 2, p1.y - 7, 46, 14);
        ctx.fillRect(p2.x - 48, p2.y - 7, 46, 14);
        ctx.strokeRect(p2.x - 48, p2.y - 7, 46, 14);
        ctx.fillStyle = '#000';
        ctx.font = '9px "Consolas", monospace';
        ctx.fillText(`→${dstTag}`, p1.x + 5, p1.y + 3);
        ctx.fillText(`${srcTag}→`, p2.x - 45, p2.y + 3);
        continue;
      }

      const pts = this.computeOrthogonalPoints(p1.x, p1.y, p2.x, p2.y, inIdx * 3);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();

      // Draw junction dot if fanout > 1
      if ((fanoutCounts.get(`${w.fromBlockId}:${w.fromPinId}`) ?? 0) > 1 && pts.length >= 2) {
        ctx.fillStyle = stroke;
        ctx.beginPath();
        ctx.arc(pts[1].x, pts[1].y, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Active wire preview while connecting
    if (this.activeWireSource) {
      const s = this.activeWireSource;
      const pts =
        s.side === 'out'
          ? this.computeOrthogonalPoints(s.wx, s.wy, this.pointerWorld.x, this.pointerWorld.y)
          : this.computeOrthogonalPoints(this.pointerWorld.x, this.pointerWorld.y, s.wx, s.wy);
      ctx.strokeStyle = '#D9480F';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 5. Render Blocks (Authentic ONI PLR Studio green / light-blue / royal-blue blocks!)
    for (const b of this.project.blocks) {
      const def = BLOCK_DEF_MAP[b.type];
      if (!def) continue;
      this.drawBlock(ctx, b, def);
    }

    // Ghost preview when placing block from library
    if (this.toolMode === 'place_block' && this.pendingBlockType && !this.sim.running) {
      const gDef = BLOCK_DEF_MAP[this.pendingBlockType];
      if (gDef) {
        ctx.save();
        ctx.globalAlpha = 0.65;
        const gx = Math.round((this.pointerWorld.x - BLOCK_W / 2) / 10) * 10;
        const gy = Math.round((this.pointerWorld.y - 24) / 10) * 10;
        ctx.fillStyle =
          gDef.colorKind === 'io_green' ? '#00A83E' : gDef.colorKind === 'logic_blue' ? '#5D96D8' : '#0068B7';
        ctx.fillRect(gx, gy, BLOCK_W, getBlockHeight(gDef));
        ctx.strokeStyle = '#FFFFFF';
        ctx.strokeRect(gx, gy, BLOCK_W, getBlockHeight(gDef));
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px "Consolas", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(gDef.codeLabel, gx + BLOCK_W / 2, gy + 22);
        ctx.textAlign = 'left';
        ctx.restore();
      }
    }

    // Selection marquee box
    if (this.isMarquee) {
      const mx = Math.min(this.marqueeStart.x, this.marqueeCurr.x);
      const my = Math.min(this.marqueeStart.y, this.marqueeCurr.y);
      const mw = Math.abs(this.marqueeCurr.x - this.marqueeStart.x);
      const mh = Math.abs(this.marqueeCurr.y - this.marqueeStart.y);
      ctx.fillStyle = 'rgba(0, 102, 204, 0.14)';
      ctx.strokeStyle = '#0055CC';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  private drawBlock(ctx: CanvasRenderingContext2D, b: BlockInstance, def: BlockTypeDefinition) {
    const h = getBlockHeight(def);
    const isSel = this.selectedBlockIds.has(b.id);
    const st = this.sim.blockStates[b.id];

    // Header label above block: e.g. I001, B001[M1], Q001
    const header = formatBlockHeaderLabel(def, b.channelIndex, b.customName);
    ctx.font = '11px "Consolas", "Courier New", monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText(header, b.x - 1, b.y - 5);

    // Body color (exact ONI PLR Studio palette!)
    let bodyFill = '#0068B7';
    if (def.colorKind === 'io_green') bodyFill = '#00A83E';
    else if (def.colorKind === 'logic_blue') bodyFill = '#6299D9';

    ctx.fillStyle = bodyFill;
    ctx.fillRect(b.x, b.y, BLOCK_W, h);

    // Inner symbol & code label
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.font = def.codeLabel.length > 3 ? 'bold 10px "Arial Narrow", Arial, sans-serif' : 'bold 13px "Arial Narrow", Arial, sans-serif';
    ctx.fillText(def.codeLabel, b.x + BLOCK_W / 2, b.y + 18);

    // Authentic ONI bottom sub-graphic inside block
    this.drawBlockSubGraphic(ctx, b.x, b.y, BLOCK_W, h, def);
    ctx.textAlign = 'left';

    // Border: in Simulation Mode -> 2.2px RED (ON) or BLUE (OFF) just like simulation.png!
    if (this.sim.running) {
      const isAnalogOnly = def.outputs.length > 0 && def.outputs[0].type === 'analog' && def.outputs.every((o) => o.type === 'analog');
      if (!isAnalogOnly) {
        const isOn = Boolean(st?.digitalOutputs?.Q);
        ctx.strokeStyle = isOn ? '#FF0000' : '#0000FF';
        ctx.lineWidth = 2.2;
        ctx.strokeRect(b.x - 0.5, b.y - 0.5, BLOCK_W + 1, h + 1);

        // "ON" / "OFF" text at top-right of block!
        ctx.font = 'bold 10px "Consolas", monospace';
        ctx.fillStyle = isOn ? '#FF0000' : '#0000FF';
        ctx.fillText(isOn ? 'ON' : 'OFF', b.x + BLOCK_W + 6, b.y + 9);
      } else {
        ctx.strokeStyle = '#005B4F';
        ctx.lineWidth = 1.8;
        ctx.strokeRect(b.x, b.y, BLOCK_W, h);
        const val = st?.analogOutputs?.AQ ?? 0;
        let badge = `${val}`;
        if (b.type === 'AI') {
          const cfg = this.project.analogConfigs.find((c) => c.channel === b.channelIndex);
          if (cfg) {
            const conv = adcToEng(val, cfg);
            badge = `${val} (${conv.eng}${cfg.unit})`;
          }
        }
        ctx.font = 'bold 10px "Consolas", monospace';
        ctx.fillStyle = '#004D40';
        ctx.fillText(badge, b.x + BLOCK_W + 6, b.y + 9);
      }

      // Hover "[Вход]" tooltip on clickable DI/AI blocks in Simulation mode (exact match to simulation.png!)
      if (this.hoveredBlock?.id === b.id && (b.type === 'DI' || b.type === 'AI')) {
        const tip = b.type === 'DI' ? 'Вход' : 'Шкала AI';
        const tw = tip.length * 6.5 + 8;
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 0.9;
        ctx.fillRect(b.x + 8, b.y + h - 4, tw, 14);
        ctx.strokeRect(b.x + 8, b.y + h - 4, tw, 14);
        ctx.fillStyle = '#000000';
        ctx.font = '10px Tahoma, sans-serif';
        ctx.fillText(tip, b.x + 12, b.y + h + 6);
      }
    } else {
      // Edit mode border & selection handles
      ctx.strokeStyle = isSel ? '#FFCC00' : '#1A3E5C';
      ctx.lineWidth = isSel ? 2.2 : 1.0;
      ctx.strokeRect(b.x, b.y, BLOCK_W, h);

      if (isSel) {
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#003399';
        ctx.lineWidth = 1;
        const corners = [
          [b.x - 3, b.y - 3],
          [b.x + BLOCK_W - 1, b.y - 3],
          [b.x - 3, b.y + h - 1],
          [b.x + BLOCK_W - 1, b.y + h - 1],
        ];
        for (const [cx, cy] of corners) {
          ctx.fillRect(cx, cy, 4, 4);
          ctx.strokeRect(cx, cy, 4, 4);
        }
      }
    }

    // Draw Input Pins (Left)
    def.inputs.forEach((pin, idx) => {
      const pos = getPinWorldPos(b, def, 'in', idx);
      const isHovered = this.hoveredPin?.block.id === b.id && this.hoveredPin?.pin.id === pin.id && this.hoveredPin?.side === 'in';
      const isSource = this.activeWireSource?.block.id === b.id && this.activeWireSource?.pin.id === pin.id;
      const isInverted = Boolean(b.invertedInputs?.[pin.id]);

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(b.x, pos.y);
      ctx.stroke();

      // Edge trigger green triangle ▶ (like on RS S-pin in scheme.png!)
      if (pin.edgeMarker) {
        ctx.fillStyle = '#00CC44';
        ctx.beginPath();
        ctx.moveTo(b.x, pos.y - 3.5);
        ctx.lineTo(b.x + 5, pos.y);
        ctx.lineTo(b.x, pos.y + 3.5);
        ctx.closePath();
        ctx.fill();
      }

      // Reset priority red circle marker on R pin (like on RS R-pin in scheme.png!)
      if (pin.resetPriorityMarker && !isInverted) {
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#E00000';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(b.x - 2.5, pos.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Inverted input bubble ○ (double-click NOT feature from Slide 4!)
      if (isInverted) {
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(b.x - 3.5, pos.y, 3.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      if (def.inputs.length > 1 || pin.type === 'analog') {
        ctx.font = '8.5px "Tahoma", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(pin.label, b.x + 2.5, pos.y + 3);
      }

      if (isHovered || isSource) {
        ctx.fillStyle = 'rgba(255, 230, 0, 0.85)';
        ctx.strokeStyle = '#CC3300';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    });

    // Draw Output Pins (Right)
    def.outputs.forEach((pin, idx) => {
      const pos = getPinWorldPos(b, def, 'out', idx);
      const isHovered = this.hoveredPin?.block.id === b.id && this.hoveredPin?.pin.id === pin.id && this.hoveredPin?.side === 'out';
      const isSource = this.activeWireSource?.block.id === b.id && this.activeWireSource?.pin.id === pin.id;

      ctx.strokeStyle = this.sim.running && pin.type === 'digital' ? (st?.digitalOutputs?.[pin.id] ? '#FF0000' : '#0000FF') : '#000000';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(b.x + BLOCK_W, pos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();

      if (isHovered || isSource) {
        ctx.fillStyle = 'rgba(255, 230, 0, 0.85)';
        ctx.strokeStyle = '#CC3300';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    });

    // Sub-block Modbus address & Parameter readout (exact match to Slide 2 of ONI PLR Studio!)
    let bottomY = b.y + h + 10;
    ctx.font = '9.5px "Consolas", monospace';
    if (this.showModbusAddresses && def.modbusBase !== undefined) {
      let addrStr = '';
      if (b.type === 'DI') addrStr = `=${String(100000 + b.channelIndex - 1).padStart(6, '0')}`;
      else if (b.type === 'DO') addrStr = `=${String(b.channelIndex - 1).padStart(6, '0')}`;
      else if (b.type === 'AI') addrStr = `=${String(300000 + b.channelIndex - 1).padStart(6, '0')}`;
      else if (b.type === 'AO') addrStr = `=${String(400000 + b.channelIndex - 1).padStart(6, '0')}`;
      else addrStr = `Modbus=${def.modbusBase + b.channelIndex * 2}`;
      ctx.fillStyle = '#555555';
      ctx.fillText(addrStr, b.x - 4, bottomY);
      bottomY += 10;
    }

    if (this.showBlockParams && b.showParams) {
      ctx.fillStyle = '#3B4856';
      const paramLines = this.formatBlockCanvasParams(b, st);
      for (const pl of paramLines) {
        ctx.fillText(pl, b.x - 4, bottomY);
        bottomY += 10;
      }
    }
  }

  private drawBlockSubGraphic(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, def: BlockTypeDefinition) {
    const cx = x + w / 2;
    const sy = y + h - 13;
    ctx.save();
    ctx.strokeStyle = '#FFFFFF';
    ctx.fillStyle = '#FFFFFF';
    ctx.lineWidth = 1.25;

    if (def.subSymbol === 'switch' || def.subSymbol === 'relay') {
      // Switch contact symbol ─o/ o─ like DI/DO in scheme.png!
      ctx.beginPath();
      ctx.moveTo(x + 6, sy + 3);
      ctx.lineTo(x + 14, sy + 3);
      ctx.moveTo(x + 14, sy + 3);
      ctx.lineTo(x + 26, sy - 2);
      ctx.moveTo(x + 27, sy + 3);
      ctx.lineTo(x + w - 6, sy + 3);
      ctx.stroke();
    } else if (def.subSymbol === 'lock') {
      // Padlock + RS/SR (exact match to B001[M1] RS in scheme.png!)
      ctx.strokeRect(cx - 6, sy - 4, 12, 9);
      ctx.beginPath();
      ctx.arc(cx, sy - 4, 4, Math.PI, 0);
      ctx.stroke();
    } else if (def.subSymbol === 'ton' || def.subSymbol === 'tof' || def.subSymbol === 'tonof' || def.subSymbol === 'tonr') {
      // Crossed timer box [☒] from Slide 2 & 3!
      ctx.strokeRect(cx - 7, sy - 5, 14, 10);
      ctx.beginPath();
      ctx.moveTo(cx - 7, sy - 5);
      ctx.lineTo(cx + 7, sy + 5);
      ctx.moveTo(cx + 7, sy - 5);
      ctx.lineTo(cx - 7, sy + 5);
      ctx.stroke();
    } else if (def.subSymbol === 'blink' || def.subSymbol === 'pulse') {
      // Square pulse train ⎍⎍ from Slide 2!
      ctx.beginPath();
      ctx.moveTo(x + 6, sy + 4);
      ctx.lineTo(x + 11, sy + 4);
      ctx.lineTo(x + 11, sy - 3);
      ctx.lineTo(x + 18, sy - 3);
      ctx.lineTo(x + 18, sy + 4);
      ctx.lineTo(x + 24, sy + 4);
      ctx.lineTo(x + 24, sy - 3);
      ctx.lineTo(x + 31, sy - 3);
      ctx.lineTo(x + 31, sy + 4);
      ctx.lineTo(x + w - 5, sy + 4);
      ctx.stroke();
    } else if (def.colorKind === 'logic_blue' && def.subSymbol) {
      // White inner mini-gate box like Slide 2!
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx - 9, sy - 6, 18, 12);
      ctx.fillStyle = '#2B5B84';
      ctx.font = 'bold 9px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(def.subSymbol, cx, sy + 3);
    } else if (def.subSymbol === 'wave') {
      ctx.beginPath();
      ctx.moveTo(x + 6, sy);
      ctx.bezierCurveTo(x + 14, sy - 7, x + 20, sy + 7, x + 28, sy);
      ctx.bezierCurveTo(x + 31, sy - 3, x + 34, sy + 2, x + w - 5, sy);
      ctx.stroke();
    } else if (def.subSymbol === 'pid') {
      ctx.beginPath();
      ctx.moveTo(x + 6, sy + 5);
      ctx.quadraticCurveTo(x + 16, sy - 8, x + w - 6, sy - 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private formatBlockCanvasParams(b: BlockInstance, st: OniPlcSimulator['blockStates'][string] | undefined): string[] {
    const out: string[] = [];
    if (b.type === 'TON' || b.type === 'TOF' || b.type === 'TONR') {
      const d = Number(b.params.delay ?? 5).toFixed(2);
      out.push(`T=${d}${b.params.unit || 's'}`);
      if (this.sim.running && st) out.push(`Тек=${st.internalTimerSec.toFixed(1)}s`);
    } else if (b.type === 'TP') {
      out.push(`T=${Number(b.params.pulseWidth ?? 3).toFixed(1)}s`);
      if (this.sim.running && st) out.push(`Тек=${st.internalTimerSec.toFixed(1)}s`);
    } else if (b.type === 'BLINK' || b.type === 'TONOF') {
      out.push(`${Number(b.params.th ?? 0.5).toFixed(1)}s/${Number(b.params.tl ?? 0.5).toFixed(1)}s`);
    } else if (b.type === 'CTUD') {
      out.push(`ON=${b.params.onThreshold ?? 5}`);
      if (this.sim.running && st) out.push(`Счёт=${st.counterValue}`);
    } else if (b.type === 'ATRG') {
      out.push(`Вкл:${b.params.onThreshold} Выкл:${b.params.offThreshold}`);
    } else if (b.type === 'AWD') {
      out.push(`[${b.params.minVal}..${b.params.maxVal}]`);
    } else if (b.type === 'AMP') {
      out.push(`×${b.params.gain} ${Number(b.params.offset) >= 0 ? '+' : ''}${b.params.offset}${b.params.unitLabel || ''}`);
    } else if (b.type === 'PI') {
      out.push(`SP=${b.params.spDefault} Kc=${b.params.kc}`);
      if (this.sim.running && st) out.push(`AQ=${st.analogOutputs.AQ ?? 0}`);
    } else if (b.type === 'MSG') {
      out.push(`Приор.${b.params.priority ?? 10}`);
    }
    return out;
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}
