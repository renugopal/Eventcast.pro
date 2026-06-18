import type { Editor } from 'grapesjs';
import { normalizeEditableLayer } from './layerLayoutSync';

/** Invitation card content is always portrait 9:16 */
export const CARD_ASPECT_W = 9;
export const CARD_ASPECT_H = 16;
export const CARD_EDIT_WIDTH = 480;

export function cardHeightForWidth(width: number): number {
  return Math.round((width * CARD_ASPECT_H) / CARD_ASPECT_W);
}

export const CARD_EDIT_HEIGHT = cardHeightForWidth(CARD_EDIT_WIDTH);

/** Landscape 16:9 viewport (desktop monitor) */
export function landscapeHeightForWidth(width: number): number {
  return Math.round((width * 9) / 16);
}

export type FrameAspect = '16:9' | '9:16' | '3:4';

export type DeviceProfile = {
  name: string;
  width: number;
  height: number;
  toolbarKey: 'desktop' | 'tablet' | 'mobile';
  frameAspect: FrameAspect;
  title: string;
};

/**
 * Device viewports:
 *  - Desktop  → 16:9 landscape monitor tall enough to show the full 480×853 card
 *  - Tablet   → iPad portrait 3:4; 9:16 card centered inside
 *  - Mobile   → 9:16 phone screen; card fills the frame
 */
export const DEVICE_PROFILES: DeviceProfile[] = [
  {
    name: 'Desktop',
    width: Math.round(CARD_EDIT_HEIGHT * (16 / 9)),
    height: CARD_EDIT_HEIGHT,
    toolbarKey: 'desktop',
    frameAspect: '16:9',
    title: `Desktop — ${Math.round(CARD_EDIT_HEIGHT * (16 / 9))}×${CARD_EDIT_HEIGHT} (16:9, card ${CARD_EDIT_WIDTH}px centered)`,
  },
  {
    name: 'Tablet',
    width: 768,
    height: 1024,
    toolbarKey: 'tablet',
    frameAspect: '3:4',
    title: 'iPad / Tablet — 768×1024 (3:4, card 480px centered)',
  },
  {
    name: 'Mobile',
    width: 390,
    height: cardHeightForWidth(390),
    toolbarKey: 'mobile',
    frameAspect: '9:16',
    title: 'Mobile — 390×693 (9:16 full screen)',
  },
];

export const DEVICE_FRAME_WIDTH: Record<string, number> = Object.fromEntries(
  DEVICE_PROFILES.map((d) => [d.name, d.width]),
);

export function getDeviceProfile(name: string): DeviceProfile {
  return DEVICE_PROFILES.find((d) => d.name === name) ?? DEVICE_PROFILES[0];
}

export function getActiveDeviceProfile(editor: Editor): DeviceProfile {
  try {
    const device = editor.DeviceManager?.getSelected?.();
    const name = device?.get?.('name') as string | undefined;
    if (name) return getDeviceProfile(name);
  } catch {
    /* ignore */
  }
  return DEVICE_PROFILES[0];
}

export function getActiveDeviceWidth(editor: Editor): number {
  return getActiveDeviceProfile(editor).width;
}

const WORKSPACE_STYLE_ID = 'gjs-invitation-workspace';

const CARD_SELECTORS =
  'main.hero, .hero, .invitation-workspace, .invitation-card, .app-container';

function cardRules(cardW: number, cardH: number, fillFrame: boolean): string {
  if (fillFrame) {
    return `
    ${CARD_SELECTORS} {
      position: relative !important;
      width: ${cardW}px !important;
      max-width: ${cardW}px !important;
      height: ${cardH}px !important;
      min-height: ${cardH}px !important;
      max-height: ${cardH}px !important;
      aspect-ratio: ${CARD_ASPECT_W} / ${CARD_ASPECT_H} !important;
      overflow: hidden !important;
      margin: 0 !important;
      flex-shrink: 0 !important;
    }`;
  }

  return `
    ${CARD_SELECTORS} {
      position: relative !important;
      width: ${CARD_EDIT_WIDTH}px !important;
      max-width: ${CARD_EDIT_WIDTH}px !important;
      height: ${CARD_EDIT_HEIGHT}px !important;
      min-height: ${CARD_EDIT_HEIGHT}px !important;
      max-height: none !important;
      aspect-ratio: ${CARD_ASPECT_W} / ${CARD_ASPECT_H} !important;
      overflow: hidden !important;
      margin: 0 auto !important;
      flex-shrink: 0 !important;
    }`;
}

export function getWorkspaceStyles(profile: DeviceProfile): string {
  const { width: fw, height: fh, frameAspect } = profile;
  const fillFrame = frameAspect === '9:16';
  const cardW = fillFrame ? fw : CARD_EDIT_WIDTH;
  const cardH = fillFrame ? fh : CARD_EDIT_HEIGHT;

  const bodyLayout =
    frameAspect === '9:16'
      ? `display: block !important;`
      : `display: flex !important;
         align-items: center !important;
         justify-content: center !important;`;

  const bodyOverflow = `overflow: hidden !important;`;

  return `
    html, body {
      width: ${fw}px !important;
      max-width: ${fw}px !important;
      min-height: ${fh}px !important;
      height: ${fh}px !important;
      margin: 0 !important;
      padding: 0 !important;
      ${bodyOverflow}
      background: #1a1a1a !important;
    }

    body {
      ${bodyLayout}
    }

    ${cardRules(cardW, cardH, fillFrame)}

    .hero__stage {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
    }
  `;
}

export function injectWorkspaceCanvasStyles(editor: Editor): void {
  const doc = editor.Canvas.getDocument();
  if (!doc?.head) return;

  const profile = getActiveDeviceProfile(editor);

  let style = doc.getElementById(WORKSPACE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = WORKSPACE_STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = getWorkspaceStyles(profile);

  const body = editor.Canvas.getBody() as HTMLElement | null;
  if (body) {
    body.setAttribute('data-ec-device', profile.toolbarKey);
    body.style.width = `${profile.width}px`;
    body.style.maxWidth = `${profile.width}px`;
    body.style.minHeight = `${profile.height}px`;
    body.style.height = `${profile.height}px`;
  }

  const hero = body?.querySelector(CARD_SELECTORS) as HTMLElement | null;
  if (hero && profile.frameAspect !== '9:16') {
    hero.style.width = `${CARD_EDIT_WIDTH}px`;
    hero.style.maxWidth = `${CARD_EDIT_WIDTH}px`;
    hero.style.height = `${CARD_EDIT_HEIGHT}px`;
    hero.style.minHeight = `${CARD_EDIT_HEIGHT}px`;
    hero.style.margin = '0 auto';
  } else if (hero && profile.frameAspect === '9:16') {
    hero.style.width = `${profile.width}px`;
    hero.style.height = `${profile.height}px`;
  }
}

/** Resize GrapesJS iframe to the active device viewport ratio */
export function syncCanvasFrameDimensions(editor: Editor): void {
  const profile = getActiveDeviceProfile(editor);

  injectWorkspaceCanvasStyles(editor);

  try {
    const frame = editor.Canvas.getFrameEl() as HTMLIFrameElement | null;
    if (frame) {
      frame.style.width = `${profile.width}px`;
      frame.style.height = `${profile.height}px`;
      frame.style.minHeight = `${profile.height}px`;
    }

    const canvasEl = editor.Canvas.getElement() as HTMLElement | null;
    const frameWrapper = canvasEl?.querySelector('.gjs-frame-wrapper') as HTMLElement | null;
    if (frameWrapper) {
      frameWrapper.style.width = `${profile.width}px`;
      frameWrapper.style.height = `${profile.height}px`;
      frameWrapper.style.minHeight = `${profile.height}px`;
    }
  } catch {
    /* canvas not ready */
  }

  // Auto-zoom so wide desktop/tablet frames fit the visible canvas area
  applyFitZoom(editor, profile);

  editor.refresh();
  fixCanvasFrameCentering(editor);
  watchFrameWrapperMargin(editor);
}

export function findHeroStage(editor: Editor): any | null {
  const wrapper = editor.DomComponents.getWrapper();
  if (!wrapper) return null;

  const stages = wrapper.find('.hero__stage');
  if (stages?.length) return stages[0];

  const heroes = wrapper.find('main.hero, .hero, .invitation-workspace');
  if (heroes?.length) return heroes[0];

  return null;
}

export function findDropTarget(editor: Editor): any {
  return findHeroStage(editor) ?? editor.DomComponents.getWrapper();
}

export function getCardContainerEl(editor: Editor): HTMLElement | null {
  const body = editor.Canvas.getBody() as HTMLElement | null;
  if (!body) return null;
  return body.querySelector(CARD_SELECTORS) || body;
}

export function setupEmptyInvitationWorkspace(editor: Editor): void {
  const wrapper = editor.DomComponents.getWrapper();
  if (!wrapper) return;

  if (findHeroStage(editor)) {
    syncCanvasFrameDimensions(editor);
    return;
  }

  const existing = wrapper.components();
  if (existing.length > 0) {
    syncCanvasFrameDimensions(editor);
    return;
  }

  wrapper.append({
    tagName: 'main',
    classes: ['hero', 'invitation-workspace'],
    name: 'Main',
    draggable: false,
    droppable: false,
    selectable: true,
    attributes: { 'aria-label': 'Invitation card' },
    components: [
      {
        tagName: 'div',
        classes: ['hero__stage'],
        name: 'Stage',
        draggable: false,
        droppable: true,
        selectable: false,
        attributes: { 'data-ec-drop-zone': 'true' },
      },
    ],
  });

  syncCanvasFrameDimensions(editor);
}

export function reparentToHeroStage(editor: Editor, component: any): void {
  const dropTarget = findHeroStage(editor);
  const wrapper = editor.DomComponents.getWrapper();
  if (!dropTarget || !wrapper || component === dropTarget) return;

  const parent = component.parent?.();
  if (parent !== wrapper) return;

  setTimeout(() => {
    try {
      if (component.parent?.() === wrapper) {
        dropTarget.append(component);
      }
    } catch {
      /* component may have been removed */
    }
  }, 0);
}

export function setupDropIntoHeroStage(editor: Editor): () => void {
  const onAdd = (component: any) => {
    reparentToHeroStage(editor, component);
    setTimeout(() => normalizeEditableLayer(editor, component), 0);
  };
  editor.on('component:add', onAdd);
  return () => editor.off('component:add', onAdd);
}

export function alignSelectedHorizontal(
  editor: Editor,
  mode: 'left' | 'center' | 'right',
): void {
  const selected = editor.getSelected() as any;
  if (!selected) return;

  const el = selected.getEl() as HTMLElement | null;
  if (!el) return;

  const cardEl = getCardContainerEl(editor);
  const offsetParent = (el.offsetParent as HTMLElement | null) || cardEl;
  if (!offsetParent) return;

  const layoutWidth = el.offsetWidth;
  if (!layoutWidth) return;

  const parentWidth = offsetParent.offsetWidth || offsetParent.clientWidth;
  let leftVal = 0;
  if (mode === 'center') leftVal = Math.round((parentWidth - layoutWidth) / 2);
  if (mode === 'right') leftVal = Math.round(parentWidth - layoutWidth);

  const style: Record<string, string> = {
    position: 'absolute',
    left: `${leftVal}px`,
    right: 'auto',
    transform: 'none',
    'margin-left': '0',
    'margin-right': '0',
  };

  selected.addStyle(style);

  el.style.position = 'absolute';
  el.style.left = `${leftVal}px`;
  el.style.right = 'auto';
  el.style.transform = 'none';
  el.style.marginLeft = '0';
  el.style.marginRight = '0';
}

let dropCleanup: (() => void) | null = null;
let deviceChangeHandler: (() => void) | null = null;
let zoomChangeCallback: ((z: number) => void) | null = null;
let frameMarginObserver: MutationObserver | null = null;

function resetFrameWrapperMargin(frameWrapper: HTMLElement): void {
  frameWrapper.style.setProperty('margin', '0 auto', 'important');
  frameWrapper.style.setProperty('margin-top', '0', 'important');
  frameWrapper.style.setProperty('margin-bottom', '0', 'important');
}

function watchFrameWrapperMargin(editor: Editor): void {
  frameMarginObserver?.disconnect();
  frameMarginObserver = null;

  const canvasEl = editor.Canvas.getElement() as HTMLElement | null;
  const frameWrapper = canvasEl?.querySelector('.gjs-frame-wrapper') as HTMLElement | null;
  if (!frameWrapper) return;

  resetFrameWrapperMargin(frameWrapper);

  frameMarginObserver = new MutationObserver(() => {
    const marginRight = frameWrapper.style.marginRight;
    if (marginRight && marginRight.startsWith('-')) {
      resetFrameWrapperMargin(frameWrapper);
    }
  });
  frameMarginObserver.observe(frameWrapper, { attributes: true, attributeFilter: ['style'] });
}

function applyFitZoom(editor: Editor, profile: DeviceProfile): void {
  const canvasEl = editor.Canvas.getElement() as HTMLElement | null;
  const availW = canvasEl?.clientWidth ?? 0;
  const availH = canvasEl?.clientHeight ?? 0;
  if (availW <= 0 || availH <= 0) return;

  let zoom = 100;
  if (profile.toolbarKey !== 'mobile') {
    const zoomW = Math.floor((availW / profile.width) * 100 * 0.9);
    const zoomH = Math.floor((availH / profile.height) * 100 * 0.9);
    zoom = Math.min(zoomW, zoomH);
    zoom = Math.max(35, Math.min(100, zoom));
  }

  editor.Canvas.setZoom(zoom);
  zoomChangeCallback?.(zoom);
}

/** GrapesJS mis-centers wide scaled frames; align iframe to canvas center */
export function fixCanvasFrameCentering(editor: Editor): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        const canvasEl = editor.Canvas.getElement() as HTMLElement | null;
        const frameEl = editor.Canvas.getFrameEl() as HTMLIFrameElement | null;
        const framesEl = canvasEl?.querySelector('.gjs-cv-canvas__frames') as HTMLElement | null;
        if (!canvasEl || !frameEl || !framesEl) return;

        const frameWrapper = canvasEl.querySelector('.gjs-frame-wrapper') as HTMLElement | null;
        if (frameWrapper) {
          resetFrameWrapperMargin(frameWrapper);
        }

        const canvasRect = canvasEl.getBoundingClientRect();
        const frameRect = frameEl.getBoundingClientRect();
        const delta =
          frameRect.left + frameRect.width / 2 - (canvasRect.left + canvasRect.width / 2);

        if (Math.abs(delta) > 2) {
          const currentLeft = parseFloat(framesEl.style.left || '0') || 0;
          framesEl.style.left = `${currentLeft - delta}px`;
        }

        canvasEl.scrollLeft = Math.max(0, (canvasEl.scrollWidth - canvasEl.clientWidth) / 2);
        canvasEl.scrollTop = Math.max(0, (canvasEl.scrollHeight - canvasEl.clientHeight) / 2);
      } catch {
        /* canvas not ready */
      }
    });
  });
}

export function setupEditorWorkspace(
  editor: Editor,
  options: { hasExternalTemplate: boolean; onZoomChange?: (z: number) => void },
): void {
  dropCleanup?.();
  dropCleanup = setupDropIntoHeroStage(editor);

  zoomChangeCallback = options.onZoomChange ?? null;

  if (deviceChangeHandler) {
    editor.off('change:device', deviceChangeHandler);
  }
  deviceChangeHandler = () => syncCanvasFrameDimensions(editor);
  editor.on('change:device', deviceChangeHandler);

  if (!options.hasExternalTemplate) {
    setupEmptyInvitationWorkspace(editor);
  } else {
    syncCanvasFrameDimensions(editor);
  }
}

export function cleanupEditorWorkspace(editor: Editor): void {
  dropCleanup?.();
  dropCleanup = null;
  zoomChangeCallback = null;
  frameMarginObserver?.disconnect();
  frameMarginObserver = null;
  if (deviceChangeHandler) {
    editor.off('change:device', deviceChangeHandler);
    deviceChangeHandler = null;
  }
}

export function getDeviceManagerConfig() {
  return {
    devices: DEVICE_PROFILES.map((d) => ({
      name: d.name,
      width: `${d.width}px`,
      ...(d.name === 'Tablet' ? { widthMedia: '992px' } : {}),
      ...(d.name === 'Mobile' ? { widthMedia: '480px' } : {}),
    })),
  };
}
