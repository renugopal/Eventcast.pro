/**
 * Sprint 14 + 15 — Pro Image Controls & Advanced Shadow
 * Custom Style Manager types: image focal point, blend modes, advanced box-shadow.
 */

import { safeGetSelected } from './editorUtils';

const D = {
  bgSurface:    '#27272a',
  bgHover:      '#3f3f46',
  border:       '#3f3f46',
  borderSubtle: '#27272a',
  text:         '#fafafa',
  textMuted:    '#a1a1aa',
  textDim:      '#71717a',
  accent:       '#f59e0b',
  focus:        '#6366f1',
} as const;

const BLEND_MODES: Array<{ value: string; label: string }> = [
  { value: 'normal',       label: 'Normal' },
  { value: 'multiply',     label: 'Multiply' },
  { value: 'screen',       label: 'Screen' },
  { value: 'overlay',      label: 'Overlay' },
  { value: 'darken',       label: 'Darken' },
  { value: 'lighten',      label: 'Lighten' },
  { value: 'color-dodge',  label: 'Color Dodge' },
  { value: 'color-burn',   label: 'Color Burn' },
  { value: 'hard-light',   label: 'Hard Light' },
  { value: 'soft-light',   label: 'Soft Light' },
  { value: 'difference',   label: 'Difference' },
  { value: 'exclusion',    label: 'Exclusion' },
  { value: 'hue',          label: 'Hue' },
  { value: 'saturation',   label: 'Saturation' },
  { value: 'color',        label: 'Color' },
  { value: 'luminosity',   label: 'Luminosity' },
];

const OBJECT_FIT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'cover',       label: 'Cover' },
  { value: 'contain',     label: 'Contain' },
  { value: 'fill',        label: 'Fill' },
  { value: 'none',        label: 'None' },
  { value: 'scale-down',  label: 'Scale Down' },
];

export interface ShadowState {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

export function defaultShadowState(): ShadowState {
  return { inset: false, x: 0, y: 8, blur: 24, spread: 0, color: 'rgba(0,0,0,0.35)' };
}

export function parseBoxShadow(css: string | undefined | null): ShadowState {
  const base = defaultShadowState();
  if (!css || css === 'none') return base;

  let s = css.trim();
  const inset = /\binset\b/i.test(s);
  s = s.replace(/\binset\b/gi, '').trim();

  let color = base.color;
  const colorMatch = s.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))\s*$/i);
  if (colorMatch) {
    color = colorMatch[1];
    s = s.slice(0, -colorMatch[0].length).trim();
  }

  const nums = (s.match(/-?[\d.]+/g) || []).map(Number);
  return {
    inset,
    x: nums[0] ?? base.x,
    y: nums[1] ?? base.y,
    blur: nums[2] ?? base.blur,
    spread: nums[3] ?? base.spread,
    color,
  };
}

export function buildBoxShadow(state: ShadowState): string {
  if (state.blur === 0 && state.x === 0 && state.y === 0 && state.spread === 0) {
    return 'none';
  }
  const parts = [
    state.inset ? 'inset' : '',
    `${state.x}px`,
    `${state.y}px`,
    `${state.blur}px`,
    `${state.spread}px`,
    state.color,
  ].filter(Boolean);
  return parts.join(' ');
}

export function parseObjectPosition(value: string | undefined | null): { x: number; y: number } {
  if (!value) return { x: 50, y: 50 };
  const parts = value.trim().split(/\s+/);
  const axis = (p: string, isX: boolean): number => {
    const v = p.toLowerCase();
    if (v === 'center') return 50;
    if (isX && v === 'left') return 0;
    if (isX && v === 'right') return 100;
    if (!isX && v === 'top') return 0;
    if (!isX && v === 'bottom') return 100;
    if (v.endsWith('%')) return Math.min(100, Math.max(0, parseFloat(v)));
    return 50;
  };
  if (parts.length === 1) {
    const n = axis(parts[0], true);
    return { x: n, y: n };
  }
  return { x: axis(parts[0], true), y: axis(parts[1], false) };
}

export function buildObjectPosition(x: number, y: number): string {
  return `${Math.round(x)}% ${Math.round(y)}%`;
}

function smLabel(text: string): HTMLLabelElement {
  const el = document.createElement('label');
  el.textContent = text;
  el.style.cssText = `display:block;font-size:10px;color:${D.textDim};margin:8px 0 4px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;`;
  return el;
}

function smInput(type = 'number'): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  el.style.cssText = `width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;background:${D.bgSurface};border:1px solid ${D.borderSubtle};color:${D.text};font-size:12px;`;
  return el;
}

function smSelect(): HTMLSelectElement {
  const el = document.createElement('select');
  el.style.cssText = `width:100%;padding:7px 9px;border-radius:6px;background:${D.bgSurface};border:1px solid ${D.borderSubtle};color:${D.text};font-size:12px;cursor:pointer;`;
  return el;
}

function isImageComponent(comp: any): boolean {
  if (!comp) return false;
  const type = String(comp.get('type') || '').toLowerCase();
  const tag = String(comp.get('tagName') || '').toLowerCase();
  return type === 'image' || tag === 'img';
}

function getImageSrc(comp: any): string {
  return String(comp?.get('src') || comp?.getAttributes?.()?.src || '');
}

function setSectorVisible(editorInst: any, sectorId: string, visible: boolean) {
  try {
    const sector = editorInst.StyleManager.getSector(sectorId);
    if (sector) sector.set('visible', visible);
  } catch { /* ignore */ }
}

export function proImageStylesPlugin(editorInst: any): { cleanup: () => void } {
  let refreshFocalPoint: (() => void) | null = null;

  const commitStyle = (prop: string, value: string) => {
    const comp = safeGetSelected(editorInst);
    if (!comp) return;
    const empty =
      !value ||
      value === 'none' ||
      value === 'normal' ||
      (prop === 'object-fit' && value === 'fill');
    if (empty) comp.removeStyle(prop);
    else comp.addStyle({ [prop]: value });
  };

  // ── Blend Mode ────────────────────────────────────────────────────────────
  editorInst.StyleManager.addType('blend-mode-picker', {
    create({ change }) {
      const wrap = document.createElement('div');
      wrap.className = 'gjs-sm-property gjs-sm-property--full';
      wrap.style.cssText = 'width:100%;padding:2px 0 6px;';

      const sel = smSelect();
      sel.innerHTML = BLEND_MODES.map((m) => `<option value="${m.value}">${m.label}</option>`).join('');

      const commit = () => {
        const val = sel.value || 'normal';
        commitStyle('mix-blend-mode', val === 'normal' ? '' : val);
        change?.({ value: val, partial: false });
      };

      sel.addEventListener('change', commit);
      wrap.appendChild(smLabel('Blend Mode'));
      wrap.appendChild(sel);
      return wrap;
    },
    update({ el }) {
      const comp = safeGetSelected(editorInst);
      const sel = el?.querySelector('select') as HTMLSelectElement | null;
      if (!comp || !sel) return;
      const val = comp.getStyle()?.['mix-blend-mode'] || 'normal';
      sel.value = val;
    },
    destroy() {},
  });

  // ── Object Fit ────────────────────────────────────────────────────────────
  editorInst.StyleManager.addType('object-fit-picker', {
    create({ change }) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'width:100%;padding:2px 0 4px;';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';

      const buttons: HTMLButtonElement[] = [];

      const commit = (value: string) => {
        commitStyle('object-fit', value === 'fill' ? '' : value);
        buttons.forEach((btn) => {
          const active = btn.dataset.value === value;
          btn.style.background = active ? D.accent : D.bgSurface;
          btn.style.color = active ? '#18181b' : D.textMuted;
          btn.style.borderColor = active ? D.accent : D.borderSubtle;
        });
        change?.({ value, partial: false });
        refreshFocalPoint?.();
      };

      OBJECT_FIT_OPTIONS.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.value = opt.value;
        btn.textContent = opt.label;
        btn.style.cssText = `
          flex:1 1 calc(33% - 4px);min-width:0;padding:6px 4px;border-radius:6px;cursor:pointer;
          font-size:10px;font-weight:600;border:1px solid ${D.borderSubtle};background:${D.bgSurface};color:${D.textMuted};
        `;
        btn.addEventListener('click', () => commit(opt.value));
        row.appendChild(btn);
        buttons.push(btn);
      });

      wrap.appendChild(smLabel('Object Fit'));
      wrap.appendChild(row);
      (wrap as any).__commitFit = commit;
      return wrap;
    },
    update({ el }) {
      const comp = safeGetSelected(editorInst);
      if (!comp || !el) return;
      const val = comp.getStyle()?.['object-fit'] || 'fill';
      (el as any).__commitFit?.(val);
    },
    destroy() {},
  });

  // ── Image Focal Point (object-position visual picker) ─────────────────────
  editorInst.StyleManager.addType('image-focal-point', {
    create({ change }) {
      const wrap = document.createElement('div');
      wrap.className = 'gjs-sm-property gjs-sm-property--full';
      wrap.style.cssText = 'width:100%;padding:4px 0 10px;';

      const preview = document.createElement('div');
      preview.style.cssText = `
        position:relative;width:100%;aspect-ratio:4/3;border-radius:8px;overflow:hidden;
        border:1px solid ${D.border};background:${D.bgSurface};cursor:crosshair;
        background-size:cover;background-position:center;background-repeat:no-repeat;
      `;

      const grid = document.createElement('div');
      grid.style.cssText = `
        position:absolute;inset:0;pointer-events:none;
        background-image:
          linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px);
        background-size:33.33% 33.33%;
      `;

      const dot = document.createElement('div');
      dot.style.cssText = `
        position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;
        border:2px solid #fafafa;background:${D.accent};box-shadow:0 0 0 2px rgba(0,0,0,0.45);
        pointer-events:none;z-index:2;transition:left .08s,top .08s;
      `;

      preview.appendChild(grid);
      preview.appendChild(dot);

      const posReadout = document.createElement('div');
      posReadout.style.cssText = `font-size:10px;color:${D.textMuted};font-variant-numeric:tabular-nums;margin-top:6px;text-align:center;`;

      const presetRow = document.createElement('div');
      presetRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:8px;';
      const PRESETS = [
        { label: '↖', x: 0, y: 0 },   { label: '↑', x: 50, y: 0 },   { label: '↗', x: 100, y: 0 },
        { label: '←', x: 0, y: 50 },  { label: '⊕', x: 50, y: 50 },  { label: '→', x: 100, y: 50 },
        { label: '↙', x: 0, y: 100 }, { label: '↓', x: 50, y: 100 }, { label: '↘', x: 100, y: 100 },
      ];

      let focal = { x: 50, y: 50 };
      let dragging = false;

      const applyFocal = (x: number, y: number, emit = true) => {
        focal = { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
        dot.style.left = `${focal.x}%`;
        dot.style.top = `${focal.y}%`;
        posReadout.textContent = `Focal point: ${Math.round(focal.x)}% × ${Math.round(focal.y)}%`;
        preview.style.backgroundPosition = `${focal.x}% ${focal.y}%`;

        const comp = safeGetSelected(editorInst);
        if (comp && emit) {
          const pos = buildObjectPosition(focal.x, focal.y);
          comp.addStyle({ 'object-position': pos });
          change?.({ value: pos, partial: false });
        }
      };

      const setPreviewImage = (src: string, objectFit: string) => {
        if (src && !src.startsWith('blob:')) {
          preview.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
        } else {
          preview.style.backgroundImage = `linear-gradient(135deg, ${D.bgHover} 0%, ${D.border} 100%)`;
        }
        preview.style.backgroundSize = objectFit === 'contain' ? 'contain' : 'cover';
      };

      const pointerToFocal = (e: PointerEvent) => {
        const rect = preview.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        applyFocal(x, y);
      };

      preview.addEventListener('pointerdown', (e) => {
        dragging = true;
        preview.setPointerCapture(e.pointerId);
        pointerToFocal(e);
      });
      preview.addEventListener('pointermove', (e) => {
        if (dragging) pointerToFocal(e);
      });
      preview.addEventListener('pointerup', () => { dragging = false; });
      preview.addEventListener('pointerleave', () => { dragging = false; });

      PRESETS.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = p.label;
        btn.title = `${p.x}% ${p.y}%`;
        btn.style.cssText = `
          padding:6px;border-radius:6px;border:1px solid ${D.borderSubtle};background:${D.bgSurface};
          color:${D.textMuted};cursor:pointer;font-size:12px;line-height:1;
        `;
        btn.addEventListener('click', () => applyFocal(p.x, p.y));
        presetRow.appendChild(btn);
      });

      wrap.appendChild(smLabel('Focal Point'));
      wrap.appendChild(preview);
      wrap.appendChild(posReadout);
      wrap.appendChild(smLabel('Quick Positions'));
      wrap.appendChild(presetRow);

      const setState = (x: number, y: number, src: string, objectFit: string) => {
        setPreviewImage(src, objectFit);
        applyFocal(x, y, false);
      };

      (wrap as any).__setState = setState;
      refreshFocalPoint = () => {
        const comp = safeGetSelected(editorInst);
        if (!comp || !isImageComponent(comp)) return;
        const pos = parseObjectPosition(comp.getStyle()?.['object-position']);
        const fit = comp.getStyle()?.['object-fit'] || 'cover';
        setState(pos.x, pos.y, getImageSrc(comp), fit);
      };

      return wrap;
    },
    update({ el }) {
      const comp = safeGetSelected(editorInst);
      if (!comp || !el) return;
      const pos = parseObjectPosition(comp.getStyle()?.['object-position']);
      const fit = comp.getStyle()?.['object-fit'] || 'cover';
      (el as any).__setState?.(pos.x, pos.y, getImageSrc(comp), fit);
    },
    destroy() {},
  });

  // ── Advanced Box Shadow ───────────────────────────────────────────────────
  editorInst.StyleManager.addType('advanced-shadow', {
    create({ change }) {
      const wrap = document.createElement('div');
      wrap.className = 'gjs-sm-property gjs-sm-property--full';
      wrap.style.cssText = 'width:100%;padding:4px 0 10px;';

      const preview = document.createElement('div');
      preview.style.cssText = `
        width:100%;height:52px;border-radius:8px;margin-bottom:8px;
        background:linear-gradient(145deg, #3f3f46 0%, #27272a 100%);
        border:1px solid ${D.borderSubtle};
      `;

      const insetToggle = document.createElement('button');
      insetToggle.type = 'button';
      insetToggle.textContent = 'Outer Shadow';
      insetToggle.style.cssText = `
        width:100%;padding:7px;margin-bottom:8px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;
        border:1px solid ${D.borderSubtle};background:${D.bgSurface};color:${D.textMuted};
      `;

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';

      const xIn = smInput(); xIn.step = '1';
      const yIn = smInput(); yIn.step = '1';
      const blurIn = smInput(); blurIn.step = '1'; blurIn.min = '0';
      const spreadIn = smInput(); spreadIn.step = '1';
      const colorRow = document.createElement('div');
      colorRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
      const colorPicker = smInput('color');
      colorPicker.style.cssText = `width:40px;height:32px;padding:2px;border-radius:6px;background:${D.bgSurface};border:1px solid ${D.borderSubtle};cursor:pointer;flex-shrink:0;`;
      const colorText = smInput('text');
      colorText.placeholder = 'rgba(0,0,0,0.35)';

      const field = (label: string, input: HTMLElement) => {
        const box = document.createElement('div');
        box.appendChild(smLabel(label));
        box.appendChild(input);
        return box;
      };

      grid.appendChild(field('X Offset', xIn));
      grid.appendChild(field('Y Offset', yIn));
      grid.appendChild(field('Blur', blurIn));
      grid.appendChild(field('Spread', spreadIn));

      const colorWrap = document.createElement('div');
      colorWrap.style.gridColumn = 'span 2';
      colorWrap.appendChild(smLabel('Shadow Color'));
      colorRow.appendChild(colorPicker);
      colorRow.appendChild(colorText);
      colorWrap.appendChild(colorRow);
      grid.appendChild(colorWrap);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:6px;margin-top:10px;';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = 'Remove Shadow';
      clearBtn.style.cssText = `
        flex:1;padding:7px;border-radius:6px;cursor:pointer;font-size:11px;
        border:1px solid ${D.border};background:transparent;color:${D.textMuted};
      `;

      let state = defaultShadowState();

      const render = (emit = true) => {
        const css = buildBoxShadow(state);
        preview.style.boxShadow = css === 'none' ? 'none' : css;
        insetToggle.textContent = state.inset ? '◧ Inset Shadow' : '◨ Outer Shadow';
        insetToggle.style.background = state.inset ? 'rgba(245,158,11,0.15)' : D.bgSurface;
        insetToggle.style.color = state.inset ? D.accent : D.textMuted;
        insetToggle.style.borderColor = state.inset ? 'rgba(245,158,11,0.35)' : D.borderSubtle;

        if (emit) {
          commitStyle('box-shadow', css);
          change?.({ value: css, partial: false });
        }
      };

      const syncInputs = () => {
        xIn.value = String(state.x);
        yIn.value = String(state.y);
        blurIn.value = String(state.blur);
        spreadIn.value = String(state.spread);
        colorText.value = state.color;
        if (state.color.startsWith('#') && state.color.length >= 7) {
          colorPicker.value = state.color.slice(0, 7);
        }
        render(false);
      };

      const readInputs = () => {
        state = {
          ...state,
          x: parseInt(xIn.value, 10) || 0,
          y: parseInt(yIn.value, 10) || 0,
          blur: parseInt(blurIn.value, 10) || 0,
          spread: parseInt(spreadIn.value, 10) || 0,
          color: colorText.value.trim() || colorPicker.value || state.color,
        };
        render();
      };

      [xIn, yIn, blurIn, spreadIn].forEach((inp) => inp.addEventListener('change', readInputs));
      [xIn, yIn, blurIn, spreadIn].forEach((inp) => inp.addEventListener('input', readInputs));
      colorPicker.addEventListener('input', () => {
        colorText.value = colorPicker.value;
        readInputs();
      });
      colorText.addEventListener('change', readInputs);
      colorText.addEventListener('input', readInputs);
      insetToggle.addEventListener('click', () => { state.inset = !state.inset; render(); });
      clearBtn.addEventListener('click', () => {
        state = defaultShadowState();
        state.blur = 0;
        state.y = 0;
        syncInputs();
        commitStyle('box-shadow', 'none');
        change?.({ value: 'none', partial: false });
      });

      btnRow.appendChild(clearBtn);

      wrap.appendChild(smLabel('Shadow Preview'));
      wrap.appendChild(preview);
      wrap.appendChild(insetToggle);
      wrap.appendChild(grid);
      wrap.appendChild(btnRow);

      (wrap as any).__setState = (next: ShadowState) => {
        state = { ...next };
        syncInputs();
      };

      syncInputs();
      return wrap;
    },
    update({ el }) {
      const comp = safeGetSelected(editorInst);
      if (!comp || !el) return;
      const parsed = parseBoxShadow(comp.getStyle()?.['box-shadow']);
      (el as any).__setState?.(parsed);
    },
    destroy() {},
  });

  // Show Image Focus sector only for image layers
  const onSelected = (comp: any) => {
    setSectorVisible(editorInst, 'image-focus', isImageComponent(comp));
  };
  const onDeselected = () => setSectorVisible(editorInst, 'image-focus', false);

  const onSrcUpdate = () => refreshFocalPoint?.();

  editorInst.on('component:selected', onSelected);
  editorInst.on('component:deselected', onDeselected);
  editorInst.on('component:update:src', onSrcUpdate);

  editorInst.on('load', () => {
    setSectorVisible(editorInst, 'image-focus', false);
    const sel = safeGetSelected(editorInst);
    if (sel) onSelected(sel);
  });

  return {
    cleanup() {
      editorInst.off('component:selected', onSelected);
      editorInst.off('component:deselected', onDeselected);
      editorInst.off('component:update:src', onSrcUpdate);
      refreshFocalPoint = null;
    },
  };
}
