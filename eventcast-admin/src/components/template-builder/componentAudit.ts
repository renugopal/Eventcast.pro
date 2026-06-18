/**
 * Component state audit — compare loaded vs newly-added layers.
 *
 * Browser console:
 *   window.__ecAuditComponents()           // all layers flat dump
 *   window.__ecAuditComponents('cid-here') // single component
 *   window.__ecAuditCompare()              // summary table
 */

import type { Editor } from 'grapesjs';
import { layoutBoxFromModel } from './layerLayoutSync';

export type ComponentAuditRow = {
  cid: string;
  name: string;
  type: string;
  tagName: string;
  classes: string[];
  selectable: boolean;
  draggable: boolean;
  locked: boolean;
  layerable: boolean;
  hoverable: boolean;
  visible: boolean;
  editable: boolean;
  stylable: boolean | unknown;
  dragMode: string;
  attributes: Record<string, string>;
  modelPosition: {
    left: string;
    top: string;
    width: string;
    height: string;
    position: string;
    transform: string;
  };
  layoutBox: { left: number; top: number; width: number; height: number } | null;
  domPointerEvents: string | null;
  inLayerTree: boolean;
  canSelectFromPanel: boolean;
  canHitOnCanvas: boolean;
};

function readPointerEvents(comp: any): string | null {
  try {
    const el = comp.getEl?.() as HTMLElement | null;
    if (!el) return null;
    return el.ownerDocument?.defaultView?.getComputedStyle(el)?.pointerEvents ?? null;
  } catch {
    return null;
  }
}

export function auditComponent(comp: any): ComponentAuditRow | null {
  if (!comp || typeof comp.get !== 'function') return null;

  const style = comp.getStyle?.() || {};
  const classes: string[] = comp.getClasses?.() || [];
  const attrs =
    (typeof comp.getAttributes === 'function' ? comp.getAttributes() : comp.get('attributes')) || {};

  const locked = comp.get('locked') === true;
  const draggable = Boolean(comp.get('draggable'));
  const selectable = comp.get('selectable') !== false;
  const layerable = comp.get('layerable') !== false;

  return {
    cid: String(comp.cid),
    name: String(comp.get('name') || ''),
    type: String(comp.get('type') || 'default'),
    tagName: String(comp.get('tagName') || ''),
    classes,
    selectable,
    draggable,
    locked,
    layerable,
    hoverable: comp.get('hoverable') !== false,
    visible: comp.get('visible') !== false,
    editable: comp.get('editable') !== false,
    stylable: comp.get('stylable'),
    dragMode: String(comp.getDragMode?.() ?? ''),
    attributes: { ...attrs },
    modelPosition: {
      left: String(style.left ?? ''),
      top: String(style.top ?? ''),
      width: String(style.width ?? ''),
      height: String(style.height ?? ''),
      position: String(style.position ?? ''),
      transform: String(style.transform ?? ''),
    },
    layoutBox: layoutBoxFromModel(comp),
    domPointerEvents: readPointerEvents(comp),
    inLayerTree: layerable && !['textnode', 'script', 'style'].includes(String(comp.get('tagName') || '').toLowerCase()),
    canSelectFromPanel: layerable && !locked && selectable,
    canHitOnCanvas: draggable && !locked && readPointerEvents(comp) !== 'none',
  };
}

export function auditAllComponents(editor: Editor): ComponentAuditRow[] {
  const wrapper = editor.getWrapper();
  if (!wrapper) return [];

  const rows: ComponentAuditRow[] = [];
  wrapper.onAll((comp: any) => {
    const row = auditComponent(comp);
    if (row && row.inLayerTree) rows.push(row);
  });
  return rows;
}

export function printComponentAudit(editor: Editor, filterCid?: string): void {
  const rows = auditAllComponents(editor);
  const filtered = filterCid ? rows.filter((r) => r.cid === filterCid) : rows;

  console.group('[ec-audit] Component state dump');
  console.table(
    filtered.map((r) => ({
      cid: r.cid,
      name: r.name,
      classes: r.classes.join(' '),
      selectable: r.selectable,
      draggable: r.draggable,
      locked: r.locked,
      layerable: r.layerable,
      editable: r.editable,
      dragMode: r.dragMode,
      left: r.modelPosition.left,
      top: r.modelPosition.top,
      ptrEvents: r.domPointerEvents,
      panelSelect: r.canSelectFromPanel,
      canvasHit: r.canHitOnCanvas,
    })),
  );
  console.log('Full rows:', filtered);
  console.groupEnd();
}

export function printAuditBlockers(editor: Editor): void {
  const rows = auditAllComponents(editor);
  const blocked = rows.filter((r) => !r.canSelectFromPanel || !r.canHitOnCanvas);

  console.group('[ec-audit] Selection blockers');
  console.table(
    blocked.map((r) => ({
      name: r.name,
      cid: r.cid,
      locked: r.locked,
      selectable: r.selectable,
      draggable: r.draggable,
      ptrEvents: r.domPointerEvents,
      panelSelect: r.canSelectFromPanel,
      canvasHit: r.canHitOnCanvas,
      reason: [
        r.locked ? 'locked' : null,
        !r.selectable ? 'selectable:false' : null,
        !r.draggable ? 'draggable:false' : null,
        r.domPointerEvents === 'none' ? 'pointer-events:none' : null,
        !r.layerable ? 'layerable:false' : null,
      ]
        .filter(Boolean)
        .join(', '),
    })),
  );
  console.groupEnd();
}

export type ComponentRenderRow = {
  cid: string;
  name: string;
  tagName: string;
  type: string;
  classes: string[];
  modelVisible: boolean;
  modelDisplay: string;
  modelOpacity: string;
  src: string;
  resolvedSrc: string;
  viewExists: boolean;
  elementExists: boolean;
  connected: boolean;
  rect: { x: number; y: number; w: number; h: number } | null;
  computed: {
    display: string;
    opacity: string;
    visibility: string;
    width: string;
    height: string;
    left: string;
    top: string;
    position: string;
    transform: string;
  } | null;
  imgComplete: boolean | null;
  imgNaturalSize: { w: number; h: number } | null;
  renderStage: string;
};

function resolveImgSrc(comp: any): string {
  const direct = comp.get?.('src');
  if (typeof direct === 'string' && direct) return direct;
  const attrs =
    (typeof comp.getAttributes === 'function' ? comp.getAttributes() : comp.get('attributes')) || {};
  return String(attrs.src ?? '');
}

function diagnoseRenderStage(row: Omit<ComponentRenderRow, 'renderStage'>): string {
  if (!row.viewExists) return 'FAIL:view-missing';
  if (!row.elementExists) return 'FAIL:element-missing';
  if (!row.connected) return 'FAIL:element-detached';
  if (row.modelVisible === false) return 'FAIL:model-visible-false';
  if (row.modelDisplay === 'none' || row.computed?.display === 'none') return 'FAIL:display-none';
  if (row.computed && parseFloat(row.computed.opacity) === 0) return 'FAIL:opacity-zero';
  if (row.computed?.visibility === 'hidden') return 'FAIL:visibility-hidden';
  if (row.rect && (row.rect.w <= 0 || row.rect.h <= 0)) return 'FAIL:zero-bounding-rect';
  if (row.tagName === 'img' && !row.src) return 'FAIL:img-no-src';
  if (row.tagName === 'img' && row.imgComplete === false) return 'WARN:img-still-loading';
  if (row.tagName === 'img' && row.imgNaturalSize && (row.imgNaturalSize.w === 0 || row.imgNaturalSize.h === 0))
    return 'FAIL:img-zero-natural-size';
  if (row.rect && (row.rect.x < -2000 || row.rect.y < -2000 || row.rect.x > 4000 || row.rect.y > 4000))
    return 'FAIL:off-canvas-position';
  return 'OK:rendered';
}

export function auditComponentRender(comp: any): ComponentRenderRow | null {
  if (!comp || typeof comp.get !== 'function') return null;

  const style = comp.getStyle?.() || {};
  const classes: string[] = comp.getClasses?.() || [];
  const el = comp.getEl?.() as HTMLElement | null;
  const view = comp.view ?? null;
  const win = el?.ownerDocument?.defaultView;
  const cs = el && win ? win.getComputedStyle(el) : null;
  const rect = el?.getBoundingClientRect?.();
  const src = resolveImgSrc(comp);

  let imgComplete: boolean | null = null;
  let imgNaturalSize: { w: number; h: number } | null = null;
  if (el && el.tagName === 'IMG') {
    const img = el as HTMLImageElement;
    imgComplete = img.complete;
    imgNaturalSize = { w: img.naturalWidth, h: img.naturalHeight };
  }

  const base: Omit<ComponentRenderRow, 'renderStage'> = {
    cid: String(comp.cid),
    name: String(comp.get('name') || ''),
    tagName: String(comp.get('tagName') || ''),
    type: String(comp.get('type') || 'default'),
    classes,
    modelVisible: comp.get('visible') !== false,
    modelDisplay: String(style.display ?? ''),
    modelOpacity: String(style.opacity ?? ''),
    src,
    resolvedSrc: el?.tagName === 'IMG' ? (el as HTMLImageElement).currentSrc || src : src,
    viewExists: Boolean(view),
    elementExists: Boolean(el),
    connected: Boolean(el?.isConnected),
    rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
    computed: cs
      ? {
          display: cs.display,
          opacity: cs.opacity,
          visibility: cs.visibility,
          width: cs.width,
          height: cs.height,
          left: cs.left,
          top: cs.top,
          position: cs.position,
          transform: cs.transform,
        }
      : null,
    imgComplete,
    imgNaturalSize,
  };

  return { ...base, renderStage: diagnoseRenderStage(base) };
}

export function auditAllComponentRenders(editor: Editor): ComponentRenderRow[] {
  const wrapper = editor.getWrapper();
  if (!wrapper) return [];
  const rows: ComponentRenderRow[] = [];
  wrapper.onAll((comp: any) => {
    const row = auditComponentRender(comp);
    if (!row) return;
    const tag = row.tagName.toLowerCase();
    if (['textnode', 'script', 'style', 'meta', 'link', 'base'].includes(tag)) return;
    if (comp.get('layerable') === false) return;
    rows.push(row);
  });
  return rows;
}

export function printRenderAudit(editor: Editor, filterCid?: string): void {
  const rows = auditAllComponentRenders(editor);
  const filtered = filterCid ? rows.filter((r) => r.cid === filterCid) : rows;
  const failed = filtered.filter((r) => !r.renderStage.startsWith('OK'));

  console.group('[ec-audit] Render pipeline dump');
  console.table(
    filtered.map((r) => ({
      name: r.name,
      cid: r.cid,
      tag: r.tagName,
      renderStage: r.renderStage,
      modelVisible: r.modelVisible,
      display: r.computed?.display ?? r.modelDisplay,
      opacity: r.computed?.opacity ?? r.modelOpacity,
      src: r.src ? r.src.slice(0, 60) : '',
      view: r.viewExists,
      el: r.elementExists,
      rect: r.rect ? `${r.rect.w}×${r.rect.h} @${r.rect.x},${r.rect.y}` : '—',
    })),
  );
  console.log('Failed stages:', failed.map((r) => ({ name: r.name, stage: r.renderStage, src: r.src })));
  console.log('Full rows:', filtered);
  console.groupEnd();
}

export function printRenderCompare(editor: Editor, loadedCid: string, newCid: string): void {
  const loaded = auditComponentRender(findCompByCid(editor, loadedCid));
  const fresh = auditComponentRender(findCompByCid(editor, newCid));
  console.group('[ec-audit] Loaded vs new layer compare');
  console.log('LOADED', loaded);
  console.log('NEW', fresh);
  console.groupEnd();
}

function findCompByCid(editor: Editor, cid: string): any | null {
  const wrapper = editor.getWrapper();
  if (!wrapper) return null;
  let found: any = null;
  wrapper.onAll((comp: any) => {
    if (!found && String(comp.cid) === cid) found = comp;
  });
  return found;
}

export function setupComponentAudit(editor: Editor): void {
  if (typeof window === 'undefined') return;
  (window as any).__ecAuditComponents = (cid?: string) => printComponentAudit(editor, cid);
  (window as any).__ecAuditBlockers = () => printAuditBlockers(editor);
  (window as any).__ecAuditRender = (cid?: string) => {
    if (cid) {
      const comp = findCompByCid(editor, cid);
      if (!comp) {
        console.warn('[ec-audit] No component for cid', cid);
        return;
      }
      console.log('[ec-audit] render', auditComponentRender(comp));
      return;
    }
    printRenderAudit(editor);
  };
  (window as any).__ecAuditRenderCompare = (loadedCid: string, newCid: string) =>
    printRenderCompare(editor, loadedCid, newCid);
  console.info(
    '[ec-audit] Run window.__ecAuditComponents() | __ecAuditRender() | __ecAuditRenderCompare(loaded,new)',
  );
}
