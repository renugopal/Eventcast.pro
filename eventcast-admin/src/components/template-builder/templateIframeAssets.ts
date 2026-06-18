import type { Editor } from 'grapesjs';

const BASE_TAG_ID = 'ec-template-asset-base';
const PLACEHOLDER_SRC_PREFIX = 'data:image/svg+xml';

function iframeDocument(editor: Editor): Document | null {
  try {
    return editor.Canvas.getBody()?.ownerDocument ?? null;
  } catch {
    return null;
  }
}

export function assetApiPrefix(syncKey: string): string {
  return `/api/local-sync/assets/${syncKey}/`;
}

/** Convert relative or admin asset paths to persistent local-sync API URLs. */
export function toAbsoluteAssetUrl(src: string, syncKey: string): string {
  if (!src || !syncKey) return src;
  const apiPrefix = assetApiPrefix(syncKey);
  if (src.startsWith(apiPrefix) || src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (/^https?:\/\//i.test(src)) return src;

  const adminMatch = src.match(/\/admin\/assets\/(.+)$/i);
  if (adminMatch) return `${apiPrefix}assets/${adminMatch[1]}`;
  if (src.startsWith('assets/')) return `${apiPrefix}${src}`;
  if (src.startsWith('/assets/')) return `${apiPrefix}${src.slice(1)}`;
  return src;
}

export function isPlaceholderImageSrc(src: unknown): boolean {
  if (typeof src !== 'string' || !src) return true;
  if (src.startsWith(PLACEHOLDER_SRC_PREFIX)) return true;
  if (src.startsWith('<svg')) return true;
  return false;
}

function resolveCanonicalImageSrc(comp: any): string | null {
  const attrs =
    (typeof comp.getAttributes === 'function' ? comp.getAttributes() : comp.get('attributes')) || {};
  const candidates = [attrs.src, comp.get('src')].filter(
    (s): s is string => typeof s === 'string' && !!s,
  );
  for (const candidate of candidates) {
    if (!isPlaceholderImageSrc(candidate) && !candidate.startsWith('blob:')) {
      return candidate;
    }
  }
  return null;
}

/** Force model, attributes, and DOM <img> to use the same src. */
export function applyImageSrcToComponent(comp: any, url: string): void {
  if (!comp || !url) return;

  comp.set('src', url);
  comp.addAttributes({ src: url });

  const el = comp.getEl?.() as HTMLImageElement | null;
  if (el) {
    el.removeAttribute('src');
    el.setAttribute('src', url);
  }

  try {
    comp.view?.render?.();
  } catch {
    /* view may not exist yet */
  }
}

/** Sync every image layer in the live editor to absolute API URLs before save. */
export function syncAllImageComponentSrcForSave(editor: Editor, syncKey: string): void {
  if (!syncKey) return;
  const wrapper = editor.getWrapper();
  if (!wrapper) return;

  wrapper.onAll((comp: any) => {
    const tag = String(comp.get('tagName') || '').toLowerCase();
    if (tag !== 'img' && comp.get('type') !== 'image') return;

    const canonical = resolveCanonicalImageSrc(comp);
    if (!canonical) return;

    const absolute = toAbsoluteAssetUrl(canonical, syncKey);
    if (absolute !== canonical) {
      applyImageSrcToComponent(comp, absolute);
    }
  });
}

/** Deep-normalize image src fields inside serialized GrapesJS project JSON. */
export function normalizeProjectDataAssetUrls(projectData: unknown, syncKey: string): unknown {
  if (!projectData || typeof projectData !== 'object' || !syncKey) return projectData;

  const data = JSON.parse(JSON.stringify(projectData)) as {
    pages?: Array<{ frames?: Array<{ component?: unknown }> }>;
  };

  const walkComponent = (comp: unknown): void => {
    if (!comp || typeof comp !== 'object') return;
    const node = comp as {
      type?: string;
      tagName?: string;
      src?: string;
      attributes?: { src?: string };
      components?: unknown[];
    };

    const isImg = node.type === 'image' || node.tagName === 'img';
    if (isImg) {
      if (node.attributes?.src) {
        node.attributes.src = toAbsoluteAssetUrl(node.attributes.src, syncKey);
      }
      if (typeof node.src === 'string') {
        node.src = toAbsoluteAssetUrl(node.src, syncKey);
      }
    }

    if (Array.isArray(node.components)) {
      node.components.forEach(walkComponent);
    }
  };

  for (const page of data.pages || []) {
    for (const frame of page.frames || []) {
      walkComponent(frame.component);
    }
  }

  return data;
}

/** Inject (or re-inject) the canvas iframe <base> so relative assets/* resolve via local-sync API. */
export function injectIframeAssetBase(editor: Editor, syncKey: string): boolean {
  if (!syncKey) return false;

  const iframeDoc = iframeDocument(editor);
  if (!iframeDoc?.head) return false;

  const iframeHead = iframeDoc.head;
  const href = assetApiPrefix(syncKey);

  let base = iframeHead.querySelector(`#${BASE_TAG_ID}`) as HTMLBaseElement | null;
  if (!base) {
    base = iframeDoc.createElement('base');
    base.id = BASE_TAG_ID;
    iframeHead.prepend(base);
  }
  if (base.getAttribute('href') !== href) {
    base.setAttribute('href', href);
  }

  iframeHead.querySelectorAll('base').forEach((el) => {
    if (el.id !== BASE_TAG_ID) el.remove();
  });

  return true;
}

/** Re-apply model src when GrapesJS swapped failed loads to broken-image SVG placeholders. */
export function restoreComponentImageSources(editor: Editor, onlyComp?: any): void {
  const process = (comp: any) => {
    const tag = String(comp.get('tagName') || '').toLowerCase();
    if (tag !== 'img' && comp.get('type') !== 'image') return;

    const saved = resolveCanonicalImageSrc(comp);
    if (!saved) return;

    const current = String(comp.get('src') || comp.getAttributes?.()?.src || '');
    const needsRestore =
      isPlaceholderImageSrc(current) || current === '' || current !== saved;

    if (!needsRestore) return;

    applyImageSrcToComponent(comp, saved);
  };

  if (onlyComp) {
    process(onlyComp);
    return;
  }

  const wrapper = editor.getWrapper();
  if (!wrapper) return;
  wrapper.onAll(process);
}

/** Rewrite url(assets/...) in template CSS before/after load. */
export function rewriteStylesheetAssetUrls(css: string, syncKey: string): string {
  if (!css || !syncKey) return css;

  return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (_match, raw) => {
    const path = String(raw).trim();
    const fixed = toAbsoluteAssetUrl(path, syncKey);
    return `url("${fixed}")`;
  });
}

export function rewriteComponentAssetStyleUrls(editor: Editor, syncKey: string): void {
  const wrapper = editor.getWrapper();
  if (!wrapper) return;

  wrapper.onAll((comp: any) => {
    const style = comp.getStyle?.() || {};
    const bg = style['background-image'];
    if (typeof bg !== 'string' || !bg.includes('url')) return;

    const rewritten = bg.replace(/url\(([^)]+)\)/gi, (_match, raw) => {
      const inner = String(raw).trim().replace(/^['"]|['"]$/g, '');
      const fixed = toAbsoluteAssetUrl(inner, syncKey);
      return `url("${fixed}")`;
    });

    if (rewritten !== bg) {
      comp.addStyle({ 'background-image': rewritten });
    }
  });
}

/** Call after loadProjectData / setComponents — base tag + image src restoration. */
export function applyLoadedTemplateAssetResolution(editor: Editor, syncKey: string): void {
  injectIframeAssetBase(editor, syncKey);
  restoreComponentImageSources(editor);
  rewriteComponentAssetStyleUrls(editor, syncKey);
  try {
    editor.refresh();
  } catch {
    /* ignore */
  }
}

/** Run after bootstrap/script.js so runtime layers and images are fully resolved. */
export function finalizeProjectLoadAssets(editor: Editor, syncKey: string): void {
  if (!syncKey) return;
  injectIframeAssetBase(editor, syncKey);
  restoreComponentImageSources(editor);
  rewriteComponentAssetStyleUrls(editor, syncKey);
  try {
    editor.refresh();
  } catch {
    /* ignore */
  }
}

/** Apply uploaded asset URL to a newly added image and clear GrapesJS placeholder state. */
export function syncDroppedImageComponent(editor: Editor, comp: any, url: string): void {
  applyImageSrcToComponent(comp, url);
  requestAnimationFrame(() => {
    restoreComponentImageSources(editor, comp);
    try {
      editor.refresh();
    } catch {
      /* ignore */
    }
  });
}
