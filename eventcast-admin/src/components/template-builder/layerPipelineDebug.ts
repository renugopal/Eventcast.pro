/**
 * Layer editing pipeline diagnostics.
 *
 * Enable in browser console:
 *   window.__EC_LAYOUT_DEBUG = true
 *
 * Or set before page load:
 *   localStorage.setItem('ec-layout-debug', '1')
 */

import type { Editor } from 'grapesjs';
import { setupComponentAudit } from './componentAudit';
import { readLayerLayoutBox } from './layerLayoutSync';

const TAG = '[ec-layout]';

export function isLayoutDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).__EC_LAYOUT_DEBUG === true) return true;
  try {
    return localStorage.getItem('ec-layout-debug') === '1';
  } catch {
    return false;
  }
}

export function enableLayoutDebug(): void {
  if (typeof window !== 'undefined') {
    (window as any).__EC_LAYOUT_DEBUG = true;
    console.info(`${TAG} debug enabled — reload or interact to see logs`);
  }
}

export type CompSnapshot = {
  cid: string;
  id: string;
  name: string;
  tag: string;
  classes: string[];
  draggable: boolean;
  dragMode: string;
  locked: boolean;
  model: {
    left: string;
    top: string;
    width: string;
    height: string;
    position: string;
    transform: string;
    right: string;
    bottom: string;
  };
  dom: {
    left: string;
    top: string;
    width: string;
    height: string;
    transform: string;
    position: string;
  } | null;
  computed: {
    left: string;
    top: string;
    width: string;
    height: string;
    transform: string;
    position: string;
    right: string;
  } | null;
  layoutBox: { top: number; left: number; width: number; height: number } | null;
  offsetParent: string | null;
  ecBaseline: unknown;
};

export function snapshotComp(comp: any): CompSnapshot | null {
  if (!comp || typeof comp.getStyle !== 'function') return null;

  const style = comp.getStyle?.() || {};
  const el = comp.getEl?.() as HTMLElement | null;
  const win = el?.ownerDocument?.defaultView;
  const cs = el && win ? win.getComputedStyle(el) : null;
  const attrs = comp.getAttributes?.() || {};
  const classes: string[] = comp.getClasses?.() || [];

  return {
    cid: String(comp.cid ?? comp.get?.('cid') ?? '?'),
    id: String(attrs.id ?? ''),
    name: String(comp.get?.('name') ?? ''),
    tag: String(comp.get?.('tagName') ?? ''),
    classes,
    draggable: Boolean(comp.get?.('draggable')),
    dragMode: String(comp.getDragMode?.() ?? ''),
    locked: Boolean(comp.get?.('locked')),
    model: {
      left: String(style.left ?? ''),
      top: String(style.top ?? ''),
      width: String(style.width ?? ''),
      height: String(style.height ?? ''),
      position: String(style.position ?? ''),
      transform: String(style.transform ?? ''),
      right: String(style.right ?? ''),
      bottom: String(style.bottom ?? ''),
    },
    dom: el
      ? {
          left: el.style.left,
          top: el.style.top,
          width: el.style.width,
          height: el.style.height,
          transform: el.style.transform,
          position: el.style.position,
        }
      : null,
    computed: cs
      ? {
          left: cs.left,
          top: cs.top,
          width: cs.width,
          height: cs.height,
          transform: cs.transform,
          position: cs.position,
          right: cs.right,
        }
      : null,
    layoutBox: readLayerLayoutBox(comp),
    offsetParent: el?.offsetParent
      ? `${(el.offsetParent as HTMLElement).tagName}.${(el.offsetParent as HTMLElement).className?.slice?.(0, 40) ?? ''}`
      : null,
    ecBaseline: comp.get?.('ec-baseline'),
  };
}

function modelDomDiverged(snap: CompSnapshot): boolean {
  if (!snap.dom) return false;
  const pairs: Array<[string, string]> = [
    ['left', snap.model.left],
    ['top', snap.model.top],
    ['width', snap.model.width],
    ['height', snap.model.height],
  ];
  return pairs.some(([key, modelVal]) => {
    const domVal = (snap.dom as Record<string, string>)[key];
    if (!modelVal && !domVal) return false;
    if (!modelVal || !domVal) return true;
    const m = parseFloat(modelVal);
    const d = parseFloat(domVal);
    if (Number.isFinite(m) && Number.isFinite(d)) return Math.abs(m - d) > 1;
    return modelVal !== domVal;
  });
}

export function logSyncVerification(comp: any, stage: string): void {
  const snap = snapshotComp(comp);
  if (!snap) return;

  const diverged = modelDomDiverged(snap);
  const payload = {
    stage,
    cid: snap.cid,
    name: snap.name,
    synced: !diverged,
    diverged,
    model: { left: snap.model.left, top: snap.model.top, width: snap.model.width, height: snap.model.height },
    dom: snap.dom
      ? { left: snap.dom.left, top: snap.dom.top, width: snap.dom.width, height: snap.dom.height }
      : null,
    layoutBox: snap.layoutBox,
  };

  if (isLayoutDebugEnabled() || (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')) {
    console.log('[ec-sync]', payload);
  }
}
export function layoutLog(
  stage: string,
  comp: any,
  extra?: Record<string, unknown>,
): void {
  if (!isLayoutDebugEnabled()) return;

  const snap = snapshotComp(comp);
  const selected = (comp?.em?.getSelected?.() ?? comp?.collection?.em?.getSelected?.()) as any;
  const selectedCid = selected?.cid ?? null;

  const payload: Record<string, unknown> = {
    stage,
    compCid: snap?.cid,
    compId: snap?.id,
    compName: snap?.name,
    selectedCid,
    sameAsSelected: selectedCid != null && snap?.cid === String(selectedCid),
    diverged: snap ? modelDomDiverged(snap) : false,
    ...extra,
  };

  if (snap) {
    payload.model = snap.model;
    payload.dom = snap.dom;
    payload.computed = snap.computed;
    payload.layoutBox = snap.layoutBox;
    payload.offsetParent = snap.offsetParent;
    payload.dragMode = snap.dragMode;
    payload.ecBaseline = snap.ecBaseline;
  }

  console.log(TAG, payload);
}

export function layoutLogPair(
  stage: string,
  before: CompSnapshot | null,
  after: CompSnapshot | null,
  extra?: Record<string, unknown>,
): void {
  if (!isLayoutDebugEnabled()) return;

  const changed: string[] = [];
  if (before && after) {
    for (const key of ['left', 'top', 'width', 'height', 'transform'] as const) {
      if (before.model[key] !== after.model[key]) changed.push(`model.${key}`);
      if (before.dom?.[key] !== after.dom?.[key]) changed.push(`dom.${key}`);
    }
    if (before.layoutBox && after.layoutBox) {
      for (const k of ['left', 'top', 'width', 'height'] as const) {
        if (before.layoutBox[k] !== after.layoutBox[k]) changed.push(`layoutBox.${k}`);
      }
    }
  }

  console.log(TAG, {
    stage,
    compCid: after?.cid ?? before?.cid,
    changed,
    before: before ? { model: before.model, dom: before.dom, layoutBox: before.layoutBox } : null,
    after: after ? { model: after.model, dom: after.dom, layoutBox: after.layoutBox } : null,
    ...extra,
  });
}

/** Global GrapesJS event taps — call once from GrapesEditor init. */
export function setupLayerPipelineDebug(editor: Editor): () => void {
  if (typeof window !== 'undefined') {
    (window as any).__ecLayoutDebug = {
      enable: enableLayoutDebug,
      snapshot: snapshotComp,
      log: layoutLog,
    };
  }

  const cleanups: Array<() => void> = [];

  const onSelected = (model: any) => {
    layoutLog('component:selected', model, {
      smTarget: editor.StyleManager?.getSelected?.()?.cid,
    });
  };
  editor.on('component:selected', onSelected);
  cleanups.push(() => editor.off('component:selected', onSelected));

  const onDeselected = () => {
    if (!isLayoutDebugEnabled()) return;
    console.log(TAG, { stage: 'component:deselected' });
  };
  editor.on('component:deselected', onDeselected);
  cleanups.push(() => editor.off('component:deselected', onDeselected));

  const styleProps = ['left', 'top', 'width', 'height', 'transform'] as const;
  for (const prop of styleProps) {
    const handler = (comp: any) => {
      layoutLog(`component:styleUpdate:${prop}`, comp, { property: prop });
    };
    editor.on(`component:styleUpdate:${prop}` as any, handler);
    cleanups.push(() => editor.off(`component:styleUpdate:${prop}` as any, handler));
  }

  const onStyleUpdate = (comp: any) => {
    layoutLog('component:styleUpdate', comp);
  };
  editor.on('component:styleUpdate', onStyleUpdate);
  cleanups.push(() => editor.off('component:styleUpdate', onStyleUpdate));

  const onDrag = (payload: { target?: any }) => {
    if (payload?.target) layoutLog('component:drag', payload.target);
  };
  editor.on('component:drag', onDrag);
  cleanups.push(() => editor.off('component:drag', onDrag));

  const onDragEnd = (payload: { target?: any }) => {
    if (payload?.target) layoutLog('component:drag:end', payload.target);
  };
  editor.on('component:drag:end', onDragEnd);
  cleanups.push(() => editor.off('component:drag:end', onDragEnd));

  const onAdd = (comp: any) => {
    layoutLog('component:add', comp, {
      parentCid: comp.parent?.()?.cid,
      draggable: comp.get('draggable'),
      dragMode: comp.getDragMode?.(),
    });
  };
  editor.on('component:add', onAdd);
  cleanups.push(() => editor.off('component:add', onAdd));

  setupComponentAudit(editor);

  if (isLayoutDebugEnabled()) {
    console.info(`${TAG} pipeline debug active`);
  } else {
    console.info(
      `${TAG} pipeline debug ready — run window.__ecLayoutDebug.enable() or localStorage.setItem('ec-layout-debug','1')`,
    );
  }

  return () => cleanups.forEach((fn) => fn());
}
