import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'edge';

// ─── Hero section dimensions (used for px → % conversion) ──────────────────
// The GrapesJS editor uses the "Mobile" device which is 390px wide.
// The hero section has aspect-ratio 2369:5122.
// So at 390px width: hero height = 390 * 5122 / 2369 ≈ 843px
// At 480px width: hero height = 480 * 5122 / 2369 ≈ 1037px
// We normalise against 480px (the max-width of the card).
const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = Math.round(480 * 5122 / 2369); // ≈ 1037

/**
 * Convert inline px top/left values to percentage for hero overlay elements.
 * When a user drags an element in GrapesJS (absolute drag mode), it adds
 * style="top: Xpx; left: Ypx" as inline HTML attributes. These pixel values
 * are relative to the editor's 480px canvas. Converting to % makes the layout
 * responsive across all screen sizes.
 */
function convertInlinePxToPercent(html: string): string {
  return html.replace(
    /\bstyle="([^"]*)"/g,
    (_match: string, styleStr: string) => {
      let s = styleStr;
      // top: Xpx → top: Y%
      s = s.replace(/\btop\s*:\s*(-?\d+(?:\.\d+)?)px/g, (_m: string, px: string) =>
        `top:${(parseFloat(px) / CANVAS_HEIGHT * 100).toFixed(2)}%`
      );
      // left: Xpx → left: Y%
      s = s.replace(/\bleft\s*:\s*(-?\d+(?:\.\d+)?)px/g, (_m: string, px: string) =>
        `left:${(parseFloat(px) / CANVAS_WIDTH * 100).toFixed(2)}%`
      );
      return `style="${s}"`;
    }
  );
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' || process.env.CF_PAGES === '1') {
    return NextResponse.json({ error: 'Local sync is not available in production' }, { status: 403 });
  }
  const searchParams = request.nextUrl.searchParams;
  const slug = searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'Slug is required' }, { status: 400 });
  }

  const eventDir = path.join(process.cwd(), '..', slug);
  const htmlPath = path.join(eventDir, 'index.html');
  const cssPath = path.join(eventDir, 'style.css');

  if (!fs.existsSync(htmlPath)) {
    return NextResponse.json({ error: `index.html not found for slug: ${slug}` }, { status: 404 });
  }

  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';

    // Extract body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    let bodyContent = bodyMatch ? bodyMatch[1].trim() : html;

    // Remove the loader block so GrapesJS doesn't show it in editor
    bodyContent = bodyContent.replace(/<div\s+id=["']loader["'][^>]*>[\s\S]*?<div\s+class=["']spinner["'][^>]*><\/div>\s*<\/div>\s*<\/div>/i, '');
    bodyContent = bodyContent.replace(/<!--\s*Loader\s*-->/gi, '');

    // Remove script tags (GrapesJS should not execute them in canvas)
    bodyContent = bodyContent.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

    // Clean up excessive blank lines
    bodyContent = bodyContent.replace(/\n{3,}/g, '\n\n').trim();

    return NextResponse.json({ html: bodyContent, css });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' || process.env.CF_PAGES === '1') {
    return NextResponse.json({ error: 'Local sync is not available in production' }, { status: 403 });
  }
  try {
    const { slug, html } = await request.json();
    // NOTE: We intentionally ignore the `css` field from GrapesJS.
    // GrapesJS getCss() output is destructive: it minifies the stylesheet,
    // converts percentage positions to pixels, and mangles background-image
    // URLs to absolute editor paths that break in production.
    // The style.css file is PROTECTED — edited manually or via direct edits only.

    if (!slug) {
      return NextResponse.json({ error: 'Slug is required' }, { status: 400 });
    }

    const eventDir = path.join(process.cwd(), '..', slug);
    const htmlPath = path.join(eventDir, 'index.html');

    if (!fs.existsSync(htmlPath)) {
      return NextResponse.json({ error: `index.html not found for slug: ${slug}` }, { status: 404 });
    }

    // Read original HTML to preserve <head> and structural elements
    const originalHtml = fs.readFileSync(htmlPath, 'utf8');

    // ── Preserve HEAD ────────────────────────────────────────────────────────
    const headMatch = originalHtml.match(/<head[\s\S]*?<\/head>/i);
    const headContent = headMatch ? headMatch[0] : '<head><meta charset="UTF-8"></head>';

    // ── Preserve loader block (always re-inject, even if GrapesJS stripped it)
    const loaderMatch = originalHtml.match(/<!--\s*Loader\s*-->[\s\S]*?<div\s+id=["']loader["'][^>]*>[\s\S]*?<div\s+class=["']spinner["'][^>]*><\/div>\s*<\/div>\s*<\/div>/i);
    const loaderHtml = loaderMatch ? loaderMatch[0].trim() : `<!-- Loader -->
    <div id="loader">
        <div class="loader-content">
            <h1 class="logo-text">M &amp; A</h1>
            <p class="loader-sub">Nikah Ceremony</p>
            <div class="spinner"></div>
        </div>
    </div>`;

    // ── Preserve all <script src="..."> tags ─────────────────────────────────
    const scriptMatches = originalHtml.match(/<script\b[^>]*src=["'][^"']*["'][^>]*><\/script>/gi) || [];
    const scriptTags = scriptMatches.join('\n    ');

    // ── Clean the GrapesJS HTML output ───────────────────────────────────────
    let innerHtml = html || '';

    // Strip any <html>, <head>, <body> wrappers GrapesJS may inject
    const gjsHtmlWrap = innerHtml.match(/<html[^>]*>([\s\S]*)<\/html>/i);
    if (gjsHtmlWrap) innerHtml = gjsHtmlWrap[1].trim();
    innerHtml = innerHtml.replace(/<head[\s\S]*?<\/head>/gi, '').trim();
    const gjsBodyWrap = innerHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (gjsBodyWrap) innerHtml = gjsBodyWrap[1].trim();

    // Remove any loader blocks injected by GrapesJS (re-added below cleanly)
    innerHtml = innerHtml.replace(/<!--\s*Loader\s*-->[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, '').trim();

    // Remove script tags (re-added from original below)
    innerHtml = innerHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').trim();

    // ── Convert inline px positions → percentage ──────────────────────────────
    // GrapesJS absolute drag-mode adds style="top: Xpx; left: Ypx" to dragged
    // elements. Convert these to % so the layout is responsive on all devices.
    innerHtml = convertInlinePxToPercent(innerHtml);

    // ── Assemble clean HTML ──────────────────────────────────────────────────
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

    // ── Backup and write ─────────────────────────────────────────────────────
    const backupPath = path.join(eventDir, 'index.html.bak');
    fs.writeFileSync(backupPath, originalHtml, 'utf8');
    fs.writeFileSync(htmlPath, newHtml, 'utf8');

    // NOTE: style.css is intentionally NOT written here. See comment above.

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
