/**
 * Dimension controls: Style Manager width/height, ratio lock, reset, Alt+resize.
 *
 * INTERACTION RULES:
 * 1. Bake %/calc CSS → px only when needsLayoutBake (one-time, DOM → model).
 * 2. Never mutate component styles on resize-handle pointerdown.
 * 3. Let GrapesJS own drag/resize — model is single source of truth.
 * 4. After drag/resize end, refresh view from model (never DOM → model overwrite).
 */

import {
  ensureModelLayoutBaked,
  layoutBoxFromModel,
  needsLayoutBake,
  parseStylePx,
  readLayerLayoutBox,
  refreshComponentFromModel,
  runWithoutUndo,
  type LayerLayoutBox,
} from './layerLayoutSync';
import { bakeEditableLayerLayouts } from './templateCanvasBootstrap';
import { layoutLog, layoutLogPair, logSyncVerification, snapshotComp } from './layerPipelineDebug';

const parsePx = parseStylePx;

type ResizeStart = { left: number; top: number; w: number; h: number } | null;

type ResizeSnapshot = {
  w: number;
  h: number;
  left: number;
  top: number;
  rectL: number;
  rectT: number;
  ar: number;
};

type DimBox = { width: string; height: string; left?: string; top?: string };

export function dimensionPlugin(
  editorInst: any,
  altState: { readonly altHeld: boolean; readonly resizeStart: ResizeStart },
): { cleanup: () => void; isRatioLocked: () => boolean; setRatioLocked: (v: boolean) => void } {
  let ratioLocked = true;
  let applyingRatio = false;
  let activeResize = false;
  let resizeMoved = false;
  let resizeSnapshot: ResizeSnapshot | null = null;
  const cleanups: Array<() => void> = [];

  const clearResizingBodyClass = () => {
    const strip = (body: HTMLElement | null) => {
      if (!body) return;
      body.className = body.className.replace(/\bgjs-resizing\S*/g, '').trim();
    };
    strip(document.body);
    try {
      const frame = editorInst.Canvas.getFrameEl() as HTMLIFrameElement | undefined;
      strip(frame?.contentDocument?.body ?? null);
    } catch {
      /* ignore */
    }
  };

  const refreshFromModel = (comp: any, stage: string) => {
    refreshComponentFromModel(comp, stage);
    logSyncVerification(comp, stage);
  };

  const persistLayoutMetadata = (comp: any) => {
    refreshFromModel(comp, 'persistLayoutMetadata');
    const box = layoutBoxFromModel(comp) ?? readLayerLayoutBox(comp);
    if (!box) return;
    runWithoutUndo(editorInst, () => {
      comp.set('ec-baseline', layoutBoxToDim(box));
      comp.set('ec-aspect-ratio', box.width / box.height);
      if (comp.get('ec-ratio-locked') === undefined) comp.set('ec-ratio-locked', true);
    });
  };

  const isRatioLocked = () => ratioLocked;

  const setRatioLocked = (v: boolean) => { ratioLocked = v; };

  const isRatioLockedFor = (comp: any): boolean => {
    if (!comp) return false;
    if (comp.get('ec-ratio-locked') === false) return false;
    return ratioLocked;
  };

  const resolveModel = (candidate?: any) => {
    if (candidate && typeof candidate.getEl === 'function' && typeof candidate.getStyle === 'function') {
      return candidate;
    }
    const selected = editorInst.getSelected();
    if (selected && typeof selected.getEl === 'function') return selected;
    return null;
  };

  const refreshStyleManager = (comp: any) => {
    requestAnimationFrame(() => {
      try {
        editorInst.StyleManager.select(comp);
        layoutLog('StyleManager.select', comp, {
          smTargetCid: editorInst.StyleManager?.getSelected?.()?.cid,
        });
      } catch {
        /* ignore */
      }
    });
  };

  const layoutBoxToDim = (box: LayerLayoutBox): DimBox => ({
    width: `${box.width}px`,
    height: `${box.height}px`,
    left: `${box.left}px`,
    top: `${box.top}px`,
  });

  const syncDimensionsToModel = (
    comp: any,
    options?: { refresh?: boolean; mode?: 'full' | 'size-only' },
  ) => {
    if (activeResize && options?.mode !== 'size-only') return;

    const model = resolveModel(comp);
    if (!model || model === editorInst.DomComponents.getWrapper()) return;

    if (options?.mode === 'size-only') {
      const layout = readLayerLayoutBox(model);
      if (!layout) return;
      model.addStyle({
        width: `${layout.width}px`,
        height: `${layout.height}px`,
      });
    } else if (needsLayoutBake(model)) {
      ensureModelLayoutBaked(model, editorInst);
    } else {
      refreshFromModel(model, 'syncDimensionsToModel');
    }

    const box = layoutBoxFromModel(model) ?? readLayerLayoutBox(model);
    if (!box) return;

    runWithoutUndo(editorInst, () => {
      model.set('ec-baseline', layoutBoxToDim(box));
      model.set('ec-aspect-ratio', box.width / box.height);
      if (model.get('ec-ratio-locked') === undefined) model.set('ec-ratio-locked', true);
    });

    if (options?.refresh !== false) refreshStyleManager(model);
  };

  const applyResizable = (comp: any) => {
    const locked = isRatioLockedFor(comp);
    comp.set('resizable', {
      ratioDefault: locked,
      keepRatio: locked,
      ratio: locked,
      handles: locked
        ? ['tl', 'tr', 'bl', 'br']
        : ['tl', 'tr', 'bl', 'br', 'tc', 'bc', 'cl', 'cr'],
      step: 1,
      updateOnMove: true,
    });
  };

  const getAspectRatio = (comp: any): number | null => {
    const model = resolveModel(comp);
    if (!model) return null;
    const stored = model.get('ec-aspect-ratio') as number | undefined;
    if (stored && Number.isFinite(stored) && stored > 0) return stored;
    const w = parsePx(model.getStyle()?.width);
    const h = parsePx(model.getStyle()?.height);
    if (w && h) return w / h;
    const box = readLayerLayoutBox(model);
    if (!box) return null;
    const bw = box.width;
    const bh = box.height;
    return bw && bh ? bw / bh : null;
  };

  const applyRatioFromWidth = (comp: any) => {
    const model = resolveModel(comp);
    if (!model || activeResize || applyingRatio || !isRatioLockedFor(model)) return;
    const ar = getAspectRatio(model);
    const w = parsePx(model.getStyle()?.width);
    if (!ar || !w) return;
    applyingRatio = true;
    const h = Math.max(1, Math.round(w / ar));
    model.addStyle({ height: `${h}px` });
    applyingRatio = false;
    refreshFromModel(model, 'applyRatioFromWidth');
    refreshStyleManager(model);
  };

  const applyRatioFromHeight = (comp: any) => {
    const model = resolveModel(comp);
    if (!model || activeResize || applyingRatio || !isRatioLockedFor(model)) return;
    const ar = getAspectRatio(model);
    const h = parsePx(model.getStyle()?.height);
    if (!ar || !h) return;
    applyingRatio = true;
    const w = Math.max(1, Math.round(h * ar));
    model.addStyle({ width: `${w}px` });
    applyingRatio = false;
    refreshFromModel(model, 'applyRatioFromHeight');
    refreshStyleManager(model);
  };

  const resetSizes = (comp: any) => {
    const model = resolveModel(comp);
    if (!model) return;
    const baseline = model.get('ec-baseline') as DimBox | undefined;
    if (baseline) {
      model.addStyle({
        width: baseline.width,
        height: baseline.height,
        ...(baseline.left ? { left: baseline.left } : {}),
        ...(baseline.top ? { top: baseline.top } : {}),
      });
    } else {
      model.removeStyle('width');
      model.removeStyle('height');
    }
    syncDimensionsToModel(model);
    editorInst.select(model);
  };

  const captureResizeSnapshot = (comp: any, rect?: { w?: number; h?: number; l?: number; t?: number }) => {
    const model = resolveModel(comp);
    if (!model) return;

    const style = model.getStyle() || {};
    const layout = readLayerLayoutBox(model);

    const w = Math.round(rect?.w ?? parsePx(style.width) ?? layout?.width ?? 0);
    const h = Math.round(rect?.h ?? parsePx(style.height) ?? layout?.height ?? 0);
    if (w <= 0 || h <= 0) return;

    const left = Math.round(parsePx(style.left) ?? layout?.left ?? 0);
    const top = Math.round(parsePx(style.top) ?? layout?.top ?? 0);
    const ar = getAspectRatio(model) ?? w / h;

    const rectL = rect?.l ?? left;
    const rectT = rect?.t ?? top;

    resizeSnapshot = { w, h, left, top, rectL, rectT, ar };
    // Wrap metadata write in runWithoutUndo — this is internal state, not undoable.
    runWithoutUndo(editorInst, () => model.set('ec-aspect-ratio', ar));
  };

  const applyResizeStyle = (props: any): boolean => {
    const { updateStyle, style, component, rect } = props;
    if (typeof updateStyle !== 'function' || !style || !rect) return false;

    if (altState.altHeld) {
      return enforceLockedResize(props);
    }

    // Use snapshot position as fallback — NOT rect.l / rect.t.
    // rect.l/rect.t are in GrapesJS canvas coordinates which differ from CSS
    // left/top (relative to offsetParent). Using rect.l would cause a visible
    // position jump the instant the first resize:update fires.
    const snap = resizeSnapshot;
    const comp = component ?? editorInst.getSelected();
    const currentStyle = comp?.getStyle?.() || {};

    const next: Record<string, string> = {
      position: 'absolute',
      width: style.width || `${Math.max(1, Math.round(rect.w))}px`,
      height: style.height || `${Math.max(1, Math.round(rect.h))}px`,
      left: style.left ?? currentStyle.left ?? (snap && rect.l != null ? `${snap.left + (rect.l - snap.rectL)}px` : `${Math.round(rect.l)}px`),
      top: style.top ?? currentStyle.top ?? (snap && rect.t != null ? `${snap.top + (rect.t - snap.rectT)}px` : `${Math.round(rect.t)}px`),
      right: 'auto',
      bottom: 'auto',
      transform: 'none',
    };

    updateStyle(next);
    return true;
  };
  const enforceLockedResize = (props: any) => {
    const { rect, updateStyle, component } = props;
    if (typeof updateStyle !== 'function' || !rect) return false;

    const comp = component ?? editorInst.getSelected();
    if (!comp || !isRatioLockedFor(comp)) return false;

    const snap = resizeSnapshot;
    const ar = snap?.ar ?? getAspectRatio(comp) ?? (snap && snap.h > 0 ? snap.w / snap.h : null);
    if (!ar) return false;

    // Alt — scale from center using keyboard plugin snapshot
    if (altState.altHeld && altState.resizeStart) {
      const o = altState.resizeStart;
      const dw = rect.w - o.w;
      const dh = rect.h - o.h;
      const next = {
        position: 'absolute',
        width: `${Math.max(10, Math.round(o.w + dw * 2))}px`,
        height: `${Math.max(10, Math.round(o.h + dh * 2))}px`,
        left: `${Math.round(o.left - dw)}px`,
        top: `${Math.round(o.top - dh)}px`,
        right: 'auto',
        bottom: 'auto',
        transform: 'none',
      };
      updateStyle(next);
      return true;
    }

    let newW: number;
    let newH: number;

    if (snap && snap.w > 0 && snap.h > 0) {
      const scaleW = rect.w / snap.w;
      const scaleH = rect.h / snap.h;
      const scale = Math.min(scaleW, scaleH);
      newW = Math.max(10, Math.round(snap.w * scale));
      newH = Math.max(10, Math.round(snap.h * scale));
    } else {
      newW = Math.max(10, Math.round(rect.w));
      newH = Math.max(10, Math.round(newW / ar));
    }

    const style: Record<string, string> = {
      position: 'absolute',
      width: `${newW}px`,
      height: `${newH}px`,
      right: 'auto',
      bottom: 'auto',
      transform: 'none',
    };

    // Compute position from the snapshot + size delta.
    // rect.l/rect.t can have subpixel mismatches with CSS left/top, so deriving
    // the position from the known-good snapshot avoids jumps.
    if (snap) {
      if (rect.l != null && rect.t != null) {
        // Delta from canvas rects applied to CSS absolute positions
        const deltaL = rect.l - snap.rectL;
        const deltaT = rect.t - snap.rectT;
        style.left = `${snap.left + deltaL}px`;
        style.top  = `${snap.top + deltaT}px`;
      } else {
        style.left = `${snap.left}px`;
        style.top  = `${snap.top}px`;
      }
    } else {
      const currentStyle = comp.getStyle?.() || {};
      style.left = currentStyle.left || `${Math.round(rect.l)}px`;
      style.top  = currentStyle.top  || `${Math.round(rect.t)}px`;
    }

    updateStyle(style);
    return true;
  };

  // ── Style Manager: ratio lock + reset row ─────────────────────────────────
  editorInst.StyleManager.addType('dimension-actions', {
    create() {
      const el = document.createElement('div');
      el.className = 'gjs-sm-property gjs-sm-property--full';
      el.style.cssText = [
        'width:100% !important', 'flex-basis:100% !important', 'grid-column:span 2 !important',
        'margin:12px 0 6px 0', 'display:block !important', 'clear:both !important',
      ].join(';');

      el.innerHTML = `
        <div style="display:flex;gap:8px;width:100%;clear:both;">
          <button type="button" id="btn-ratio-lock" style="flex:1;padding:6px 8px;font-size:11px;border-radius:4px;border:1px solid #444;background:#d97706;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;">
            <span id="lock-icon">🔒</span> <span id="lock-text">Ratio Locked</span>
          </button>
          <button type="button" id="btn-size-reset" style="flex:1;padding:6px 8px;font-size:11px;border-radius:4px;border:1px solid #444;background:#222;color:#ccc;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;" title="Reset to original sizes">
            <span>🔄</span> <span>Reset Sizes</span>
          </button>
        </div>
      `;

      const btnLock = el.querySelector('#btn-ratio-lock') as HTMLButtonElement;
      const btnReset = el.querySelector('#btn-size-reset') as HTMLButtonElement;
      const lockIcon = el.querySelector('#lock-icon') as HTMLElement;
      const lockText = el.querySelector('#lock-text') as HTMLElement;

      const updateLockUI = () => {
        if (ratioLocked) {
          btnLock.style.background = '#d97706';
          lockIcon.textContent = '🔒';
          lockText.textContent = 'Ratio Locked';
        } else {
          btnLock.style.background = '#374151';
          lockIcon.textContent = '🔓';
          lockText.textContent = 'Ratio Unlocked';
        }
      };

      btnLock.addEventListener('click', (e) => {
        e.preventDefault();
        setRatioLocked(!ratioLocked);
        updateLockUI();
        const selected = editorInst.getSelected();
        if (selected) {
          selected.set('ec-ratio-locked', ratioLocked);
          applyResizable(selected);
        }
      });

      btnReset.addEventListener('click', (e) => {
        e.preventDefault();
        const selected = editorInst.getSelected();
        if (!selected) return;
        resetSizes(selected);
        btnReset.innerHTML = '<span>✅</span> <span>Reset!</span>';
        setTimeout(() => { btnReset.innerHTML = '<span>🔄</span> <span>Reset Sizes</span>'; }, 1200);
      });

      const onSelect = () => {
        const stored = editorInst.getSelected()?.get('ec-ratio-locked');
        if (stored === true) setRatioLocked(true);
        else if (stored === false) setRatioLocked(false);
        updateLockUI();
      };
      editorInst.on('component:selected', onSelect);
      cleanups.push(() => editorInst.off('component:selected', onSelect));

      updateLockUI();
      return el;
    },
    emit() {},
    onUpdate() {},
  });

  const onSelectBefore = (model: any) => {
    if (!model || activeResize) return;
    const bake = needsLayoutBake(model);
    layoutLog('select:before:check', model, {
      needsLayoutBake: bake,
      activeResize,
      willBake: bake,
    });
    if (bake) {
      ensureModelLayoutBaked(model, editorInst);
    } else {
      refreshFromModel(model, 'select:before:refresh');
    }
  };
  editorInst.on('component:select:before', onSelectBefore);
  cleanups.push(() => editorInst.off('component:select:before', onSelectBefore));

  const onComponentSelected = (model: any) => {
    const stored = model.get('ec-ratio-locked');
    if (stored === true) setRatioLocked(true);
    else if (stored === false) setRatioLocked(false);

    applyResizable(model);
    if (activeResize) return;

    const box = layoutBoxFromModel(model);
    if (box) {
      runWithoutUndo(editorInst, () => {
        model.set('ec-baseline', layoutBoxToDim(box));
        model.set('ec-aspect-ratio', box.width / box.height);
        if (model.get('ec-ratio-locked') === undefined) model.set('ec-ratio-locked', true);
      });
    }
    refreshStyleManager(model);
    logSyncVerification(model, 'component:selected');
  };
  editorInst.on('component:selected', onComponentSelected);
  cleanups.push(() => editorInst.off('component:selected', onComponentSelected));

  const onResizeInit = (opts: any) => {
    const comp = opts?.component ?? opts?.target ?? editorInst.getSelected();
    if (!comp) return;
    const locked = isRatioLockedFor(comp);
    if (opts.resizable && typeof opts.resizable === 'object') {
      opts.resizable.ratioDefault = locked;
      opts.resizable.keepRatio = locked;
      opts.resizable.ratio = locked;
    }
  };
  editorInst.on('component:resize:init', onResizeInit);
  cleanups.push(() => editorInst.off('component:resize:init', onResizeInit));

  const onResizeStart = (props: any) => {
    activeResize = true;
    resizeMoved = false;
    const comp = props?.component ?? editorInst.getSelected();
    if (comp) {
      // Position is already baked to px by onSelectBefore (component:select:before).
      // Do NOT re-freeze here — a second getBoundingClientRect() call can shift
      // the element by ±1px (rounding), making the first resize:update see a
      // mismatched position and causing a visible position jump on corner drag.
      captureResizeSnapshot(comp, props?.rect);
    }
  };
  editorInst.on('component:resize:start', onResizeStart);
  cleanups.push(() => editorInst.off('component:resize:start', onResizeStart));

  const onResizeMove = () => {
    resizeMoved = true;
  };
  editorInst.on('component:resize:move', onResizeMove);
  cleanups.push(() => editorInst.off('component:resize:move', onResizeMove));

  const onResizeUpdate = (props: any) => {
    if (applyResizeStyle(props)) resizeMoved = true;
  };
  editorInst.on('component:resize:update', onResizeUpdate);
  cleanups.push(() => editorInst.off('component:resize:update', onResizeUpdate));

  const onResizeEnd = (props: any) => {
    const moved = Boolean(props?.moved ?? resizeMoved);
    activeResize = false;
    resizeMoved = false;
    resizeSnapshot = null;
    clearResizingBodyClass();

    if (moved) {
      const comp = editorInst.getSelected();
      if (comp) {
        persistLayoutMetadata(comp);
        refreshStyleManager(comp);
      }
    }
  };
  editorInst.on('component:resize:end', onResizeEnd);
  cleanups.push(() => editorInst.off('component:resize:end', onResizeEnd));

  // Style Manager edits — property:update fires BEFORE style is applied; defer one tick.
  const onPropertyUpdate = (property: any) => {
    const name = property?.getName?.() ?? property?.get?.('property');
    const comp = editorInst.getSelected();
    layoutLog('style:property:update', comp, {
      property: name,
      activeResize,
      applyingRatio,
      ratioLocked: comp ? isRatioLockedFor(comp) : false,
    });
    if (activeResize) return;
    if (name !== 'width' && name !== 'height') return;
    if (!comp || !isRatioLockedFor(comp)) return;
    queueMicrotask(() => {
      const before = snapshotComp(comp);
      if (name === 'width') applyRatioFromWidth(comp);
      else applyRatioFromHeight(comp);
      layoutLogPair(`style:property:update:${name}`, before, snapshotComp(comp));
    });
  };
  editorInst.on('style:property:update', onPropertyUpdate);
  cleanups.push(() => editorInst.off('style:property:update', onPropertyUpdate));

  const onStyleableWidth = () => {
    if (applyingRatio || activeResize) return;
    queueMicrotask(() => {
      applyRatioFromWidth(null);
      const comp = editorInst.getSelected();
      if (comp) logSyncVerification(comp, 'styleable:change:width');
    });
  };
  const onStyleableHeight = () => {
    if (applyingRatio || activeResize) return;
    queueMicrotask(() => {
      applyRatioFromHeight(null);
      const comp = editorInst.getSelected();
      if (comp) logSyncVerification(comp, 'styleable:change:height');
    });
  };
  const onStyleUpdateLeft = (comp: any) => {
    refreshFromModel(comp, 'styleUpdate:left');
  };
  const onStyleUpdateTop = (comp: any) => {
    refreshFromModel(comp, 'styleUpdate:top');
  };
  editorInst.on('styleable:change:width', onStyleableWidth);
  editorInst.on('styleable:change:height', onStyleableHeight);
  editorInst.on('component:styleUpdate:width', onStyleableWidth);
  editorInst.on('component:styleUpdate:height', onStyleableHeight);
  editorInst.on('component:styleUpdate:left', onStyleUpdateLeft);
  editorInst.on('component:styleUpdate:top', onStyleUpdateTop);
  cleanups.push(() => {
    editorInst.off('styleable:change:width', onStyleableWidth);
    editorInst.off('styleable:change:height', onStyleableHeight);
    editorInst.off('component:styleUpdate:width', onStyleableWidth);
    editorInst.off('component:styleUpdate:height', onStyleableHeight);
    editorInst.off('component:styleUpdate:left', onStyleUpdateLeft);
    editorInst.off('component:styleUpdate:top', onStyleUpdateTop);
  });

  const onStyleUpdate = (comp: any) => {
    const model = resolveModel(comp);
    if (!model || isRatioLockedFor(model) || applyingRatio || activeResize) return;
    const w = parsePx(model.getStyle()?.width);
    const h = parsePx(model.getStyle()?.height);
    if (w && h) runWithoutUndo(editorInst, () => model.set('ec-aspect-ratio', w / h));
  };
  editorInst.on('component:styleUpdate', onStyleUpdate);
  cleanups.push(() => editorInst.off('component:styleUpdate', onStyleUpdate));

  const onDragStart = (payload: { target?: any }) => {
    if (activeResize) return;
    try {
      if ((editorInst as any).Commands?.isActive?.('resize')) return;
    } catch { /* ignore */ }
    // Position baking is done by onSelectBefore (component:select:before).
    // A second freeze here would cause ±1px rounding drift from the extra
    // getBoundingClientRect() call. Skipped intentionally.
  };
  editorInst.on('component:drag:start', onDragStart);
  cleanups.push(() => editorInst.off('component:drag:start', onDragStart));

  const onDragEnd = (payload: { target?: any }) => {
    if (activeResize) return;
    const comp = resolveModel(payload?.target);
    if (comp) persistLayoutMetadata(comp);
  };
  editorInst.on('component:drag:end', onDragEnd);
  cleanups.push(() => editorInst.off('component:drag:end', onDragEnd));

  const onDeviceChange = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          bakeEditableLayerLayouts(editorInst, { clearUndo: false });
        } catch {
          /* ignore */
        }
      });
    });
  };
  editorInst.on('change:device', onDeviceChange);
  cleanups.push(() => editorInst.off('change:device', onDeviceChange));

  const onLoad = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          editorInst.Components.getWrapper()?.find('*').forEach((model: any) => {
            if (model.getStyle()?.position === 'absolute' || model.get('draggable')) {
              if (needsLayoutBake(model)) {
                ensureModelLayoutBaked(model, editorInst);
              } else {
                refreshFromModel(model, 'dimensionPlugin:onLoad');
              }
              applyResizable(model);
            }
          });
        } catch { /* ignore */ }
      });
    });
  };
  editorInst.on('load', onLoad);
  cleanups.push(() => editorInst.off('load', onLoad));

  return {
    cleanup() { cleanups.forEach((fn) => fn()); },
    isRatioLocked,
    setRatioLocked,
  };
}
