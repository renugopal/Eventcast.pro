/**
 * Model-first layout sync — GrapesJS component model is the single source of truth.
 * Never write layout values directly to el.style; purge stale inline overrides instead.
 */

import type { Editor } from 'grapesjs';

export type LayerLayoutBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function parseStylePx(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || value === 'auto') return null;
  const raw = String(value).trim();
  if (!raw.endsWith('px')) return null;
  const num = parseFloat(raw);
  return Number.isNaN(num) ? null : num;
}

export function needsPxValue(val: unknown): boolean {
  if (val == null || val === '' || val === 'auto') return true;
  const raw = String(val).trim();
  if (raw.endsWith('px')) return false;
  return true;
}

/** True when the model still needs a one-time DOM → model bake (legacy / % / right-based CSS). */
export function needsLayoutBake(comp: any): boolean {
  const style = comp.getStyle?.() || {};

  const modelNeedsBake =
    needsPxValue(style.width) ||
    needsPxValue(style.height) ||
    needsPxValue(style.left) ||
    needsPxValue(style.top) ||
    Boolean(style.right && style.right !== 'auto') ||
    Boolean(style.bottom && style.bottom !== 'auto') ||
    Boolean(style.transform && style.transform !== 'none');

  if (modelNeedsBake) return true;

  // Model has px values — never re-bake from DOM (DOM may be stale).
  const hasPxBox =
    !needsPxValue(style.left) &&
    !needsPxValue(style.top) &&
    !needsPxValue(style.width) &&
    !needsPxValue(style.height);

  if (hasPxBox) return false;

  const el = comp?.getEl?.() as HTMLElement | undefined;
  const cs = el?.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!cs) return false;

  return (
    cs.width.includes('%') ||
    cs.height.includes('%') ||
    cs.left.includes('%') ||
    cs.top.includes('%') ||
    (cs.right !== 'auto' && cs.right !== '' && cs.right !== '0px') ||
    (cs.transform !== 'none' && cs.transform !== '')
  );
}

export function layoutBoxFromModel(comp: any): LayerLayoutBox | null {
  const style = comp.getStyle?.() || {};
  const left = parseStylePx(style.left);
  const top = parseStylePx(style.top);
  const width = parseStylePx(style.width);
  const height = parseStylePx(style.height);
  if (left === null || top === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

const LAYOUT_INLINE_PROPS = [
  'position',
  'top',
  'left',
  'width',
  'height',
  'right',
  'bottom',
  'margin-top',
  'margin-left',
  'margin-right',
  'transform',
  'transform-origin',
] as const;

/** Remove direct inline layout overrides so GrapesJS CSS rules from the model take effect. */
export function purgeDirectLayoutInline(el: HTMLElement): void {
  for (const prop of LAYOUT_INLINE_PROPS) {
    el.style.removeProperty(prop);
  }
}

/** Re-render the component view from model styles; purge stale inline overrides first. */
export function refreshComponentFromModel(comp: any, _stage = 'refreshComponentFromModel'): void {
  const el = comp?.getEl?.() as HTMLElement | null;
  if (el) purgeDirectLayoutInline(el);
  try {
    comp.view?.updateStyles?.();
  } catch {
    /* view may not exist yet */
  }
}

export function layerTransformReset(comp: any): Record<string, string> {
  const classes: string[] = comp.getClasses?.() || [];
  const isBell = classes.some((c) => c.includes('hero__bell'));
  if (isBell) {
    return { transform: 'none', 'transform-origin': 'top center' };
  }
  return { transform: 'none' };
}

export function runWithoutUndo(editor: Editor | undefined, fn: () => void): void {
  if (!editor?.UndoManager) {
    fn();
    return;
  }
  editor.UndoManager.skip(fn);
}

/** Read rendered layout box in px (DOM measurement — use only for initial bake). */
export function readLayerLayoutBox(comp: any): LayerLayoutBox | null {
  if (!comp || typeof comp.getEl !== 'function') return null;

  const el = comp.getEl() as HTMLElement | null;
  const offsetParent = el?.offsetParent as HTMLElement | null;
  if (!el || !offsetParent) return null;

  const win = el.ownerDocument?.defaultView;
  const cs = win?.getComputedStyle(el);

  const width = Math.round(
    parseFloat(cs?.width || '') || el.offsetWidth || el.getBoundingClientRect().width || 0,
  );
  const height = Math.round(
    parseFloat(cs?.height || '') || el.offsetHeight || el.getBoundingClientRect().height || 0,
  );
  if (width <= 0 || height <= 0) return null;

  const rect = el.getBoundingClientRect();
  const parentRect = offsetParent.getBoundingClientRect();
  const left = Math.round(rect.left - parentRect.left);
  const top = Math.round(rect.top - parentRect.top);

  return { top, left, width, height };
}

/**
 * Ensure the GrapesJS model owns layout in px.
 * - If model already has valid px values: purge stale DOM inline overrides only.
 * - If model needs bake (legacy/% CSS): one-time DOM → model via addStyle.
 * Never overwrites a valid model from stale DOM measurements.
 */
export function ensureModelLayoutBaked(comp: any, editor?: Editor): LayerLayoutBox | null {
  if (!comp || typeof comp.getEl !== 'function') return null;

  if (!needsLayoutBake(comp)) {
    refreshComponentFromModel(comp, 'ensureModelLayoutBaked:model-authoritative');
    return layoutBoxFromModel(comp);
  }

  const layout = readLayerLayoutBox(comp);
  if (!layout) return null;

  const baked: Record<string, string> = {
    position: 'absolute',
    top: `${layout.top}px`,
    left: `${layout.left}px`,
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    right: 'auto',
    bottom: 'auto',
    'margin-top': '0',
    'margin-left': '0',
    'margin-right': '0',
    ...layerTransformReset(comp),
  };

  runWithoutUndo(editor, () => comp.addStyle(baked));
  refreshComponentFromModel(comp, 'ensureModelLayoutBaked:baked-from-dom');
  return layout;
}

/** @deprecated Use ensureModelLayoutBaked */
export const freezeLayerVisualState = ensureModelLayoutBaked;

const OVERLAY_LAYER_IDS = new Set(['petals', 'particles']);

export function isOverlayDecorLayer(comp: any): boolean {
  const id = comp.getAttributes?.()?.id || '';
  const classes: string[] = comp.getClasses?.() || [];
  return (
    OVERLAY_LAYER_IDS.has(id) ||
    classes.includes('hero__petals') ||
    classes.includes('hero__particles')
  );
}

const DESIGN_LAYER_RESIZABLE = {
  ratioDefault: true,
  keepRatio: true,
  ratio: true,
  handles: ['tl', 'tr', 'bl', 'br'],
  step: 1,
  updateOnMove: true,
} as const;

function designLayerName(classes: string[]): string | null {
  if (classes.includes('hero__background')) return 'Background';
  if (classes.includes('hero__rays')) return 'Light Rays';
  return null;
}

export function applyLayerEditorDefaults(comp: any): void {
  const classes: string[] = comp.getClasses?.() || [];
  const tag = (comp.get('tagName') || '').toLowerCase();
  const structuralClasses = new Set(['hero', 'hero__stage']);

  const isRootHero = classes.includes('hero') && tag === 'main';
  const isStage = classes.includes('hero__stage');
  const isOverlay = isOverlayDecorLayer(comp);
  const isHeroLayer =
    tag === 'img' ||
    classes.some((c) => c.startsWith('hero__') && !structuralClasses.has(c) && !isOverlay);
  const isDroppedBlock = tag === 'img' || comp.get('type') === 'image' || comp.get('draggable');

  if (isRootHero) {
    comp.set({ draggable: false, droppable: true, selectable: true, hoverable: true });
    comp.addStyle({ position: 'relative', width: '100%', height: '100%' });
    return;
  }

  if (isStage) {
    comp.set({ draggable: false, droppable: true, selectable: false, hoverable: false });
    comp.addStyle({ position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' });
    return;
  }

  // Runtime injection containers — visible in layer tree, not editable on canvas.
  if (isOverlay) {
    const id = comp.getAttributes?.()?.id || '';
    const overlayName =
      classes.includes('hero__petals') || id === 'petals'
        ? 'Petals'
        : classes.includes('hero__particles') || id === 'particles'
          ? 'Particles'
          : 'Overlay';
    comp.set({
      draggable: false,
      droppable: false,
      selectable: false,
      hoverable: false,
      layerable: true,
      visible: true,
      name: overlayName,
    });
    return;
  }

  if (isHeroLayer || isDroppedBlock) {
    const style = comp.getStyle?.() || {};
    if (!style.position || style.position === 'static') {
      comp.addStyle({ position: 'absolute' });
    }
    const layerName = designLayerName(classes);
    comp.set({
      draggable: true,
      droppable: false,
      selectable: true,
      hoverable: true,
      visible: true,
      locked: false,
      resizable: DESIGN_LAYER_RESIZABLE,
      ...(layerName ? { name: layerName } : {}),
    });
    comp.removeAttributes?.('data-locked');
    comp.setDragMode?.('absolute');
  }
}

export function normalizeEditableLayer(editor: Editor, comp: any): void {
  if (!comp) return;
  runWithoutUndo(editor, () => applyLayerEditorDefaults(comp));
  if (needsLayoutBake(comp)) {
    ensureModelLayoutBaked(comp, editor);
  } else {
    refreshComponentFromModel(comp, 'normalizeEditableLayer');
  }
}
