/** Default slug when opening /admin/template-builder without ?slug= or ?path= */
export const BUILDER_WORKSPACE_SLUG = 'template-builder-workspace';

export type BuilderTemplateRef = {
  slug: string | null;
  path: string | null;
  templateKey: string | null;
  label: string;
};

export function getBuilderTemplateRef(): BuilderTemplateRef {
  if (typeof window === 'undefined') {
    return {
      slug: null,
      path: null,
      templateKey: null,
      label: BUILDER_WORKSPACE_SLUG,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  const pathParam = params.get('path');
  const templateKey = params.get('key');

  let label = BUILDER_WORKSPACE_SLUG;
  if (pathParam) {
    const parts = pathParam.split(/[/\\]/).filter(Boolean);
    label = parts[parts.length - 1] || pathParam;
  } else if (slug) {
    label = slug;
  } else if (templateKey) {
    label = 'template';
  }

  return { slug, path: pathParam, templateKey, label };
}

export function hasBuilderTemplateTarget(ref: BuilderTemplateRef): boolean {
  return !!(ref.slug || ref.path || ref.templateKey);
}

export function buildSyncQuery(ref: BuilderTemplateRef): string {
  if (ref.templateKey) return `templateKey=${encodeURIComponent(ref.templateKey)}`;
  if (ref.path) return `path=${encodeURIComponent(ref.path)}`;
  if (ref.slug) return `slug=${encodeURIComponent(ref.slug)}`;
  return '';
}

export function buildSyncPayload(
  ref: BuilderTemplateRef,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (ref.templateKey) return { ...data, templateKey: ref.templateKey };
  if (ref.path) return { ...data, path: ref.path };
  if (ref.slug) return { ...data, slug: ref.slug };
  return data;
}

/** Slug from URL query, templateKey, or workspace folder for unsaved draft sessions */
export function getBuilderSlug(): string {
  const ref = getBuilderTemplateRef();
  return ref.templateKey || ref.slug || BUILDER_WORKSPACE_SLUG;
}

export function getBuilderUploadFormFields(ref: BuilderTemplateRef): Record<string, string> {
  if (ref.templateKey) return { templateKey: ref.templateKey };
  if (ref.path) return { path: ref.path };
  if (ref.slug) return { slug: ref.slug };
  return { slug: BUILDER_WORKSPACE_SLUG };
}

/**
 * Safe wrapper for editor.getSelected() — GrapesJS throws if called before
 * the selector is initialized (e.g. Style Manager render on editor load).
 */
export function safeGetSelected(editorInst: any): any | null {
  try {
    const comp = editorInst?.getSelected?.();
    return comp ?? null;
  } catch {
    return null;
  }
}
