import type { Editor } from 'grapesjs';
import { syncCanvasFrameDimensions } from './editorWorkspace';
import { layoutLog } from './layerPipelineDebug';
import { HERO_PETAL_LAYOUT_CSS } from './petalLayoutStyles';
import { finalizeProjectLoadAssets, injectIframeAssetBase } from './templateIframeAssets';
import {
  applyLayerEditorDefaults,
  ensureModelLayoutBaked,
  freezeLayerVisualState,
  isOverlayDecorLayer,
  layoutBoxFromModel,
  layerTransformReset,
  needsLayoutBake,
  parseStylePx,
  readLayerLayoutBox,
  refreshComponentFromModel,
  runWithoutUndo,
  type LayerLayoutBox,
} from './layerLayoutSync';

export {
  ensureModelLayoutBaked,
  freezeLayerVisualState,
  isOverlayDecorLayer,
  layoutBoxFromModel,
  needsLayoutBake,
  normalizeEditableLayer,
  parseStylePx,
  readLayerLayoutBox,
  refreshComponentFromModel,
  runWithoutUndo,
  type LayerLayoutBox,
} from './layerLayoutSync';

/** Editor-only fixes — sizing handled by editorWorkspace.syncCanvasFrameDimensions */
const EDITOR_CANVAS_FIXES = `
  /* Neutralize template CSS that uses 100vw / 100dvh on .hero in editor */
  body[data-ec-device="desktop"] .hero,
  body[data-ec-device="tablet"] .hero {
    width: 480px !important;
    max-width: 480px !important;
    height: 853px !important;
    min-height: 853px !important;
    max-height: 853px !important;
  }

  .hero__particle,
  .hero__petal,
  #petals,
  #particles,
  .hero__petals,
  .hero__particles {
    pointer-events: none !important;
  }

  /* Editable design layers receive canvas clicks */
  .hero__background,
  .hero__rays,
  .hero__om,
  .hero__bell,
  .hero__bell--left,
  .hero__bell--right {
    pointer-events: auto !important;
  }

  .hero__rays {
    animation: rays-pulse 7s ease-in-out infinite !important;
  }
  .hero__om {
    animation: om-glow 5s ease-in-out infinite !important;
    transform: none !important;
  }
  /* Neutralize template %/calc/right/transform — editor bakes px on the component */
  .hero__om,
  .hero__bell,
  .hero__bell--left,
  .hero__bell--right {
    right: auto !important;
    bottom: auto !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
    transform: none !important;
    transform-origin: top center !important;
  }
  /* Pause bell swing in editor — animated transforms break resize anchoring */
  .hero__bell--left,
  .hero__bell--right {
    animation: none !important;
  }
  ${HERO_PETAL_LAYOUT_CSS.trim()}
  .hero__petal {
    animation: petal-fall var(--petal-duration, 14s) linear infinite !important;
  }
  .hero__particle {
    animation: particle-float var(--particle-duration, 18s) ease-in-out infinite !important;
    animation-delay: var(--particle-delay, 0s) !important;
  }
`;

export function isMovableHeroLayer(comp: any): boolean {
  const tag = (comp.get('tagName') || '').toLowerCase();
  const classes: string[] = comp.getClasses?.() || [];
  return tag === 'img' || classes.some((c) => c.startsWith('hero__') && !isOverlayDecorLayer(comp));
}

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function readLayoutPosition(comp: any): { top: number; left: number } {
  const fromModel = layoutBoxFromModel(comp);
  if (fromModel) return { top: fromModel.top, left: fromModel.left };
  const box = readLayerLayoutBox(comp);
  if (!box) return { top: 0, left: 0 };
  return { top: box.top, left: box.left };
}

function needsPositionBake(comp: any): boolean {
  return needsLayoutBake(comp);
}

/** Bake rendered layout (position + size) into GrapesJS inline px styles */
export function syncLayerLayoutToModel(
  comp: any,
  box?: LayerLayoutBox | null,
  editor?: Editor,
): LayerLayoutBox | null {
  if (!comp || typeof comp.getEl !== 'function') return null;
  if (box) {
    runWithoutUndo(editor, () =>
      comp.addStyle({
        position: 'absolute',
        top: `${box.top}px`,
        left: `${box.left}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        right: 'auto',
        bottom: 'auto',
        'margin-top': '0',
        'margin-left': '0',
        'margin-right': '0',
        ...layerTransformReset(comp),
      }),
    );
    return box;
  }
  return ensureModelLayoutBaked(comp, editor);
}

/** Copy layout position into model px styles so drag + arrow keys work */
export function syncLayerInlinePosition(editor: Editor, comp: any): void {
  ensureModelLayoutBaked(comp, editor);
}

export function nudgeComponentPosition(
  editor: Editor,
  comp: any,
  key: string,
  shiftKey: boolean,
): boolean {
  if (!ARROW_KEYS.has(key)) return false;

  // Bake % / right-based template CSS into px once — not on every key repeat
  if (needsPositionBake(comp)) {
    syncLayerInlinePosition(editor, comp);
  }

  const style = comp.getStyle?.() || {};
  let top = parseStylePx(style.top);
  let left = parseStylePx(style.left);
  if (top === null || left === null) {
    const layout = readLayoutPosition(comp);
    top = layout.top;
    left = layout.left;
  }

  const step = shiftKey ? 10 : 1;

  switch (key) {
    case 'ArrowUp':
      top -= step;
      break;
    case 'ArrowDown':
      top += step;
      break;
    case 'ArrowLeft':
      left -= step;
      break;
    case 'ArrowRight':
      left += step;
      break;
    default:
      return false;
  }

  comp.addStyle({
    position: 'absolute',
    top: `${top}px`,
    left: `${left}px`,
    right: 'auto',
    bottom: 'auto',
    ...layerTransformReset(comp),
  });
  refreshComponentFromModel(comp, 'nudgeComponentPosition');
  return true;
}

export function injectEditorCanvasFixes(doc: Document): void {
  const head = doc.head;
  if (!head) return;

  let style = head.querySelector('#gjs-template-canvas-fixes') as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = 'gjs-template-canvas-fixes';
    head.appendChild(style);
  }
  style.textContent = EDITOR_CANVAS_FIXES;
}

export function loadTemplateScript(doc: Document, syncKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = doc.querySelector('script[data-gjs-template-runtime]');
    if (existing) {
      resolve();
      return;
    }

    const script = doc.createElement('script');
    script.src = `/api/local-sync/assets/${syncKey}/script.js`;
    script.defer = true;
    script.setAttribute('data-gjs-template-runtime', '1');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load template script.js'));
    doc.body.appendChild(script);
  });
}

export function normalizeHeroLayersForEditor(editor: Editor): void {
  const wrapper = editor.getWrapper();
  if (!wrapper) return;

  runWithoutUndo(editor, () => wrapper.onAll((comp: any) => applyLayerEditorDefaults(comp)));
}

/** Bake rendered px layout for every editable absolute layer (after canvas dimensions are set). */
export function bakeEditableLayerLayouts(
  editor: Editor,
  opts?: { clearUndo?: boolean },
): void {
  const wrapper = editor.getWrapper();
  if (!wrapper) return;

  runWithoutUndo(editor, () => {
    wrapper.find('*').forEach((comp: any) => {
      const draggable = comp.get('draggable');
      const position = comp.getStyle?.()?.position;
      if (draggable || position === 'absolute' || position === 'fixed') {
        if (needsLayoutBake(comp)) {
          ensureModelLayoutBaked(comp, editor);
        } else {
          refreshComponentFromModel(comp, 'bakeEditableLayerLayouts');
        }
      }
    });
  });

  // Only wipe undo on initial template load — not on device switches.
  if (opts?.clearUndo !== false) {
    try { editor.UndoManager.clear(); } catch { /* ignore */ }
  }
}

/**
 * Find the deepest component in the hierarchy whose element matches `el`
 * or contains `el`. Returns the deepest DRAGGABLE component, not just any.
 * This prevents clicks on child elements from accidentally returning
 * a non-draggable parent (e.g. hero__stage div).
 */
function findComponentForElement(editor: Editor, el: HTMLElement | null): any | null {
  if (!el) return null;
  const wrapper = editor.getWrapper();
  if (!wrapper) return null;

  let best: any = null;
  let bestDepth = -1;

  wrapper.onAll((comp: any) => {
    const compEl = comp.getEl?.() as HTMLElement | null;
    if (!compEl) return;
    // compEl must be the clicked element or an ancestor of it
    if (compEl !== el && !compEl.contains(el)) return;
    // Only consider draggable, unlocked components
    if (!comp.get('draggable') || comp.get('locked')) return;
    // Measure depth: count ancestors up to wrapper
    let depth = 0;
    let cursor: any = comp;
    while (cursor && cursor !== wrapper) { depth++; cursor = cursor.parent?.(); }
    if (depth > bestDepth) { best = comp; bestDepth = depth; }
  });
  return best;
}

export function setupHeroLayerInteraction(editor: Editor): () => void {
  const cleanups: Array<() => void> = [];

  const activeResizeGuard = () => {
    try {
      return Boolean((editor as any).Commands?.isActive?.('resize'));
    } catch {
      return false;
    }
  };

  let pointerMoveArmed = false;
  // Tracks when a GrapesJS resize handle (.gjs-resizer-h) was clicked in the
  // HOST document.  onMouseDown (iframe) checks this flag to avoid starting
  // tlb-move while the user is trying to resize.
  let resizerPointerActive = false;

  const onNativeDragStart = (e: DragEvent) => {
    if (!pointerMoveArmed) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerUp = () => {
    pointerMoveArmed = false;
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 || e.defaultPrevented) return;
    // Resize handle click in the host doc — let GrapesJS resizer handle it
    if (resizerPointerActive) return;

    const target = e.target as HTMLElement | null;
    if (!target || target.isContentEditable) return;
    // Toolbar / badge click should not start a move
    if (target.closest?.('.gjs-toolbar, .gjs-badge, .gjs-com-badge')) return;

    // Find the deepest draggable component at the clicked element
    const hit = findComponentForElement(editor, target);
    if (!hit) return;

    // Select triggers select:before → ensureModelLayoutBaked only when model needs bake
    const selected = editor.getSelected();
    if (hit !== selected) {
      editor.select(hit);
    }

    const comp = hit;
    const el = comp.getEl() as HTMLElement | null;
    if (!el) return;

    if (activeResizeGuard()) return;
    try {
      if ((editor as any).Commands?.isActive?.('tlb-move')) {
        layoutLog('mousedown:blocked', comp, { reason: 'tlb-move-already-active' });
        return;
      }
    } catch { /* ignore */ }

    if (needsLayoutBake(comp)) {
      ensureModelLayoutBaked(comp, editor);
    }

    pointerMoveArmed = true;

    try {
      layoutLog('mousedown:pre-tlb-move', comp, {
        selectedCid: editor.getSelected()?.cid,
      });
      (editor as any).Commands.run('tlb-move', { target: comp, event: e });
    } catch (err) {
      layoutLog('mousedown:tlb-move-error', comp, { error: String(err) });
    }
  };

  const attachIframeListeners = () => {
    try {
      const doc = editor.Canvas.getDocument();
      if (!doc) return;
      doc.addEventListener('mousedown', onMouseDown, true);
      doc.addEventListener('dragstart', onNativeDragStart, true);
      doc.addEventListener('mouseup', onPointerUp, true);
      cleanups.push(() => {
        doc.removeEventListener('mousedown', onMouseDown, true);
        doc.removeEventListener('dragstart', onNativeDragStart, true);
        doc.removeEventListener('mouseup', onPointerUp, true);
      });
    } catch {
      /* canvas not ready */
    }
  };

  // ── Host-document listeners: track when user clicks a GrapesJS resize handle ──
  // Resize handles (.gjs-resizer-h) live in the HOST canvas overlay, not the
  // iframe.  We set resizerPointerActive so that onMouseDown (iframe) can skip
  // the tlb-move path and let GrapesJS resize operate without interference.
  const onHostMouseDownResizer = (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    resizerPointerActive =
      t?.classList?.contains('gjs-resizer-h') ||
      !!t?.closest?.('[class*="gjs-resizer"]');
  };
  const onHostMouseUpResizer = () => { resizerPointerActive = false; };
  document.addEventListener('mousedown', onHostMouseDownResizer, true);
  document.addEventListener('mouseup',   onHostMouseUpResizer,   true);
  cleanups.push(() => {
    document.removeEventListener('mousedown', onHostMouseDownResizer, true);
    document.removeEventListener('mouseup',   onHostMouseUpResizer,   true);
  });

  editor.on('load', attachIframeListeners);
  cleanups.push(() => editor.off('load', attachIframeListeners));
  attachIframeListeners();

  return () => {
    cleanups.forEach((fn) => fn());
  };
}

export function ensureHeroCanvasHeight(editor: Editor): void {
  syncCanvasFrameDimensions(editor);
}

let layerInteractionCleanup: (() => void) | null = null;

export async function bootstrapTemplateCanvas(
  editor: Editor,
  syncKey: string,
): Promise<void> {
  const doc = editor.Canvas.getDocument();
  if (!doc) return;

  injectIframeAssetBase(editor, syncKey);
  injectEditorCanvasFixes(doc);

  try {
    await loadTemplateScript(doc, syncKey);
  } catch (err) {
    console.warn('Template script.js could not be loaded:', err);
  }

  normalizeHeroLayersForEditor(editor);
  syncCanvasFrameDimensions(editor);

  layerInteractionCleanup?.();
  layerInteractionCleanup = setupHeroLayerInteraction(editor);

  editor.refresh();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bakeEditableLayerLayouts(editor);
      finalizeProjectLoadAssets(editor, syncKey);
    });
  });
}

export function cleanupHeroLayerInteraction(): void {
  layerInteractionCleanup?.();
  layerInteractionCleanup = null;
}
