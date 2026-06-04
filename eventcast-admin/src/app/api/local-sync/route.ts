import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
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

    // Extract body content using a greedy match (handles nested tags correctly)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    let bodyContent = bodyMatch ? bodyMatch[1].trim() : html;

    // Remove the loader block (flexible regex for any structure)
    bodyContent = bodyContent.replace(/<div\s+id=["']loader["'][^>]*>[\s\S]*?<div\s+class=["']spinner["'][^>]*><\/div>\s*<\/div>\s*<\/div>/i, '');

    // Remove orphan loader comments
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
  try {
    const { slug, html, css } = await request.json();

    if (!slug) {
      return NextResponse.json({ error: 'Slug is required' }, { status: 400 });
    }

    const eventDir = path.join(process.cwd(), '..', slug);
    const htmlPath = path.join(eventDir, 'index.html');
    const cssPath = path.join(eventDir, 'style.css');

    if (!fs.existsSync(htmlPath)) {
      return NextResponse.json({ error: `index.html not found for slug: ${slug}` }, { status: 404 });
    }

    // Read original HTML to preserve <head> and structural elements
    const originalHtml = fs.readFileSync(htmlPath, 'utf8');

    // ── Preserve HEAD ────────────────────────────────────────────────────────
    const headMatch = originalHtml.match(/<head[\s\S]*?<\/head>/i);
    const headContent = headMatch ? headMatch[0] : '<head><meta charset="UTF-8"></head>';

    // ── Preserve loader block ────────────────────────────────────────────────
    const loaderMatch = originalHtml.match(/<!--\s*Loader\s*-->[\s\S]*?<div\s+id=["']loader["'][^>]*>[\s\S]*?<div\s+class=["']spinner["'][^>]*><\/div>\s*<\/div>\s*<\/div>/i);
    const loaderHtml = loaderMatch ? loaderMatch[0].trim() : `<!-- Loader -->
    <div id="loader">
        <div class="loader-content">
            <h1 class="logo-text">M &amp; A</h1>
            <p class="loader-sub">Nikah Ceremony</p>
            <div class="spinner"></div>
        </div>
    </div>`;

    // ── Preserve script references ───────────────────────────────────────────
    const scriptMatches = originalHtml.match(/<script\b[^>]*src=["'][^"']*["'][^>]*><\/script>/gi) || [];
    const scriptTags = scriptMatches.join('\n    ');

    // ── Strip any <html>, <head>, <body> wrappers GrapesJS may inject ────────
    // GrapesJS getHtml() sometimes wraps content in <body> or <html> tags
    let innerHtml = html || '';
    // Remove <html>...</html> wrapper if present
    const gjsHtmlWrap = innerHtml.match(/<html[^>]*>([\s\S]*)<\/html>/i);
    if (gjsHtmlWrap) innerHtml = gjsHtmlWrap[1].trim();
    // Remove <head>...</head> block if present (keep only body content)
    innerHtml = innerHtml.replace(/<head[\s\S]*?<\/head>/gi, '').trim();
    // Remove <body>...</body> wrapper if present
    const gjsBodyWrap = innerHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (gjsBodyWrap) innerHtml = gjsBodyWrap[1].trim();
    // Remove any leftover loader blocks (they are re-added below)
    innerHtml = innerHtml.replace(/<!--\s*Loader\s*-->[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, '').trim();
    // Remove script tags (they are re-added from originalHtml)
    innerHtml = innerHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').trim();

    // ── Assemble new HTML ────────────────────────────────────────────────────
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

    // ── Backup original before overwriting ───────────────────────────────────
    const backupPath = path.join(eventDir, `index.html.bak`);
    fs.writeFileSync(backupPath, originalHtml, 'utf8');

    // ── Write HTML ───────────────────────────────────────────────────────────
    fs.writeFileSync(htmlPath, newHtml, 'utf8');

    // ── Write CSS — stripping dangerous pixel overrides GrapesJS injects ─────
    if (css && css.trim()) {
      // List of overlay element IDs that must use % positioning, not px.
      // GrapesJS sometimes injects pixel-based top/left overrides for these.
      const overlayIds = ['top-live-badge', 'ifj49', 'i4t7s', 'ivxuo', 'monogram-id', 'i05ra', 'isphc', 'i6n16r'];
      let cleanCss = css;
      for (const id of overlayIds) {
        // Remove pixel-based top overrides like: #id { top: 487px; ... }
        // Replace with a comment marker — the CSS file's own rules take precedence
        cleanCss = cleanCss.replace(
          new RegExp(`(#${id}\\s*\\{[^}]*?)\\btop\\s*:\\s*-?\\d+(?:\\.\\d+)?px\\s*;?`, 'g'),
          '$1'
        );
        cleanCss = cleanCss.replace(
          new RegExp(`(#${id}\\s*\\{[^}]*?)\\bleft\\s*:\\s*-?\\d+(?:\\.\\d+)?px\\s*;?`, 'g'),
          '$1'
        );
        // Also clean up pixel-based positioning for add-to-calendar-btn
        cleanCss = cleanCss.replace(
          /(#add-to-calendar-btn\s*\{[^}]*?)\btop\s*:\s*-?\d+(?:\.\d+)?px\s*;?/g,
          '$1'
        );
        cleanCss = cleanCss.replace(
          /(#add-to-calendar-btn\s*\{[^}]*?)\bleft\s*:\s*-?\d+(?:\.\d+)?px\s*;?/g,
          '$1'
        );
        // Remove position:absolute overrides that GrapesJS adds (already set in class)
      }
      fs.writeFileSync(cssPath, cleanCss, 'utf8');
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
