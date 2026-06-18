import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  resolveCssPath,
  resolveTemplateDir,
  type TemplateDirRef,
} from '@/lib/localSyncPaths';

// ─── Hero section dimensions (used for px → % conversion) ──────────────────
const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = Math.round(480 * 5122 / 2369);

function convertInlinePxToPercent(html: string): string {
  return html.replace(
    /\bstyle="([^"]*)"/g,
    (_match: string, styleStr: string) => {
      let s = styleStr;
      s = s.replace(/\btop\s*:\s*(-?\d+(?:\.\d+)?)px/g, (_m: string, px: string) =>
        `top:${(parseFloat(px) / CANVAS_HEIGHT * 100).toFixed(2)}%`,
      );
      s = s.replace(/\bleft\s*:\s*(-?\d+(?:\.\d+)?)px/g, (_m: string, px: string) =>
        `left:${(parseFloat(px) / CANVAS_WIDTH * 100).toFixed(2)}%`,
      );
      return `style="${s}"`;
    },
  );
}

const MANUAL_EDIT_BUFFER_MS = 2000;

function parseLegacyHtmlBody(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let bodyContent = bodyMatch ? bodyMatch[1].trim() : html;

  bodyContent = bodyContent.replace(
    /<div\s+id=["']loader["'][^>]*>[\s\S]*?<div\s+class=["']spinner["'][^>]*><\/div>\s*<\/div>\s*<\/div>/i,
    '',
  );
  bodyContent = bodyContent.replace(/<!--\s*Loader\s*-->/gi, '');
  bodyContent = bodyContent.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  bodyContent = bodyContent.replace(/\n{3,}/g, '\n\n').trim();

  return bodyContent;
}

function loadLegacyMode(htmlPath: string, cssReadPath: string | null) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = cssReadPath && fs.existsSync(cssReadPath) ? fs.readFileSync(cssReadPath, 'utf8') : '';
  const bodyContent = parseLegacyHtmlBody(html);

  return NextResponse.json({
    html: bodyContent,
    css,
    mode: 'legacy',
  });
}

function readTemplateInput(searchParams: URLSearchParams, body?: Record<string, unknown>) {
  return resolveTemplateDir({
    slug: (body?.slug as string) ?? searchParams.get('slug'),
    path: (body?.path as string) ?? searchParams.get('path'),
    templateKey: (body?.templateKey as string) ?? searchParams.get('templateKey'),
  });
}

function withTemplateMeta(ref: TemplateDirRef, payload: Record<string, unknown>) {
  return NextResponse.json({
    templateKey: ref.templateKey,
    label: ref.label,
    templatePath: ref.dir,
    ...payload,
  });
}

/**
 * GET /api/local-sync?slug=... | ?path=... | ?templateKey=...
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' || process.env.CF_PAGES === '1') {
    return NextResponse.json({ error: 'Local sync is not available in production' }, { status: 403 });
  }

  try {
    const ref = readTemplateInput(request.nextUrl.searchParams);
    const htmlPath = path.join(ref.dir, 'index.html');
    const projectPath = path.join(ref.dir, 'gjs-project.json');
    const { readPath: cssReadPath } = resolveCssPath(ref.dir);

    if (!fs.existsSync(htmlPath)) {
      return NextResponse.json({ error: `index.html not found at: ${ref.dir}` }, { status: 404 });
    }

    const hasProject = fs.existsSync(projectPath);

    if (hasProject) {
      const projectStats = fs.statSync(projectPath);
      const htmlStats = fs.statSync(htmlPath);
      const cssStats = cssReadPath && fs.existsSync(cssReadPath) ? fs.statSync(cssReadPath) : null;

      const htmlManuallyEdited =
        htmlStats.mtimeMs > projectStats.mtimeMs + MANUAL_EDIT_BUFFER_MS;
      const cssManuallyEdited =
        cssStats != null &&
        cssStats.mtimeMs > projectStats.mtimeMs + MANUAL_EDIT_BUFFER_MS;

      if (htmlManuallyEdited || cssManuallyEdited) {
        console.log(
          `🔄 Manual filesystem edits detected for "${ref.label}", loading HTML/CSS fallback`,
        );
        const legacy = await loadLegacyMode(htmlPath, cssReadPath);
        const legacyData = await legacy.json();
        return withTemplateMeta(ref, legacyData);
      }

      const projectData = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
      const css = cssReadPath && fs.existsSync(cssReadPath) ? fs.readFileSync(cssReadPath, 'utf8') : '';

      console.log(`✅ Loaded template "${ref.label}" in LOSSLESS mode (gjs-project.json is current)`);

      return withTemplateMeta(ref, {
        projectData,
        css,
        mode: 'lossless',
      });
    }

    console.log(`⚠️  Loaded template "${ref.label}" in LEGACY mode (gjs-project.json not found)`);
    const legacy = await loadLegacyMode(htmlPath, cssReadPath);
    const legacyData = await legacy.json();
    return withTemplateMeta(ref, legacyData);
  } catch (error: any) {
    console.error('❌ Error loading template:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/local-sync
 * Body: { slug | path | templateKey, html, css, projectData }
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' || process.env.CF_PAGES === '1') {
    return NextResponse.json({ error: 'Local sync is not available in production' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const ref = readTemplateInput(new URLSearchParams(), body);
    const htmlPath = path.join(ref.dir, 'index.html');
    const projectPath = path.join(ref.dir, 'gjs-project.json');
    const { writePath: cssWritePath } = resolveCssPath(ref.dir);
    const { html, css, projectData } = body;

    if (!fs.existsSync(htmlPath)) {
      return NextResponse.json({ error: `index.html not found at: ${ref.dir}` }, { status: 404 });
    }

    if (css) {
      fs.writeFileSync(cssWritePath, css, 'utf8');
      console.log(`✅ Saved ${path.basename(cssWritePath)} for "${ref.label}"`);
    }

    const originalHtml = fs.readFileSync(htmlPath, 'utf8');

    const headMatch = originalHtml.match(/<head[\s\S]*?<\/head>/i);
    const headContent = headMatch ? headMatch[0] : '<head><meta charset="UTF-8"></head>';

    const loaderMatch = originalHtml.match(/<!--\s*Loader\s*-->[\s\S]*?<div\s+id=["']loader["'][^>]*>[\s\S]*?<div\s+class=["']spinner["'][^>]*><\/div>\s*<\/div>\s*<\/div>/i);
    const loaderHtml = loaderMatch ? loaderMatch[0].trim() : `<!-- Loader -->
    <div id="loader">
        <div class="loader-content">
            <h1 class="logo-text">M &amp; A</h1>
            <p class="loader-sub">Nikah Ceremony</p>
            <div class="spinner"></div>
        </div>
    </div>`;

    const scriptMatches = originalHtml.match(/<script\b[^>]*src=["'][^"']*["'][^>]*><\/script>/gi) || [];
    const scriptTags = scriptMatches.join('\n    ');

    let innerHtml = html || '';

    const gjsHtmlWrap = innerHtml.match(/<html[^>]*>([\s\S]*)<\/html>/i);
    if (gjsHtmlWrap) innerHtml = gjsHtmlWrap[1].trim();
    innerHtml = innerHtml.replace(/<head[\s\S]*?<\/head>/gi, '').trim();
    const gjsBodyWrap = innerHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (gjsBodyWrap) innerHtml = gjsBodyWrap[1].trim();

    innerHtml = innerHtml.replace(/<!--\s*Loader\s*-->[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, '').trim();
    innerHtml = innerHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').trim();
    innerHtml = convertInlinePxToPercent(innerHtml);

    const newHtml = `<!DOCTYPE html>
<html lang="en">
${headContent}

<body>
    <!-- Loader -->
    ${loaderHtml}

    ${innerHtml}

    ${scriptTags}
</body>

</html>`;

    const backupPath = path.join(ref.dir, 'index.html.bak');
    fs.writeFileSync(backupPath, originalHtml, 'utf8');
    fs.writeFileSync(htmlPath, newHtml, 'utf8');

    console.log(`✅ Saved index.html for "${ref.label}" (backup created)`);

    if (projectData) {
      fs.writeFileSync(projectPath, JSON.stringify(projectData, null, 2), 'utf8');
      console.log(`✅ Saved gjs-project.json for "${ref.label}"`);
    }

    return NextResponse.json({
      success: true,
      templateKey: ref.templateKey,
      label: ref.label,
      saved: {
        html: true,
        css: !!css,
        projectData: !!projectData,
      },
    });
  } catch (error: any) {
    console.error('❌ Error saving template:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
