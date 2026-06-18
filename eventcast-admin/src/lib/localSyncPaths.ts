import fs from 'fs';
import path from 'path';

export type TemplateDirRef = {
  dir: string;
  templateKey: string;
  label: string;
};

function repoRoot(): string {
  return path.resolve(process.cwd(), '..');
}

function templatesRoot(): string | null {
  const configured = process.env.EVENTCAST_TEMPLATES_DIR?.trim();
  if (configured) return path.resolve(configured);

  // Dev default for external template libraries on Windows workstations
  if (process.platform === 'win32') {
    const defaultRoot = 'D:\\Templates';
    if (fs.existsSync(defaultRoot)) return defaultRoot;
  }

  return null;
}

/** URL-safe key that maps to an absolute template directory on disk */
export function encodeTemplateKey(absDir: string): string {
  return Buffer.from(path.resolve(absDir), 'utf8').toString('base64url');
}

export function decodeTemplateKey(templateKey: string): string {
  return Buffer.from(templateKey, 'base64url').toString('utf8');
}

function isUnderRoot(candidate: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  const rel = path.relative(normalizedRoot, normalizedCandidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function assertAllowedTemplateDir(dir: string): string {
  const resolved = path.resolve(dir);
  const allowedRoots = [repoRoot()];
  const externalRoot = templatesRoot();
  if (externalRoot) allowedRoots.push(externalRoot);

  const ok = allowedRoots.some((root) => isUnderRoot(resolved, root));
  if (!ok) {
    throw new Error(
      `Template path is outside allowed roots. Set EVENTCAST_TEMPLATES_DIR in .env.local or use a folder under the Eventcast repo.`,
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Template directory not found: ${resolved}`);
  }

  return resolved;
}

export function resolveCssPath(eventDir: string): { readPath: string | null; writePath: string } {
  const styleCss = path.join(eventDir, 'style.css');
  const stylesCss = path.join(eventDir, 'styles.css');

  if (fs.existsSync(styleCss)) return { readPath: styleCss, writePath: styleCss };
  if (fs.existsSync(stylesCss)) return { readPath: stylesCss, writePath: stylesCss };
  return { readPath: null, writePath: styleCss };
}

export function resolveTemplateDir(input: {
  slug?: string | null;
  path?: string | null;
  templateKey?: string | null;
}): TemplateDirRef {
  let dir: string;
  let label: string;

  if (input.templateKey) {
    dir = decodeTemplateKey(input.templateKey);
    label = path.basename(dir);
  } else if (input.path?.trim()) {
    const raw = input.path.trim();
    dir = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(templatesRoot() ?? repoRoot(), raw);
    label = path.basename(dir);
  } else if (input.slug?.trim()) {
    const slug = input.slug.trim();
    const externalRoot = templatesRoot();
    if (externalRoot && (slug.includes('/') || slug.includes('\\'))) {
      dir = path.resolve(externalRoot, slug);
    } else {
      dir = path.resolve(repoRoot(), slug);
    }
    label = slug;
  } else {
    throw new Error('Template location is required (slug, path, or templateKey)');
  }

  const resolvedDir = assertAllowedTemplateDir(dir);
  return {
    dir: resolvedDir,
    templateKey: encodeTemplateKey(resolvedDir),
    label,
  };
}
