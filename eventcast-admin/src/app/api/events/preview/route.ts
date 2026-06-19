import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const event = await req.json();
    const templateId = event.templateId || 'wedding-template-01';

    // In Cloudflare Pages Edge Runtime, we cannot use fs or path.
    // We fetch the template directly from the GitHub repository.
    const githubRawUrl = `https://raw.githubusercontent.com/renugopal/Eventcast.pro/main/${templateId}/index.html`;
    const res = await fetch(githubRawUrl);
    
    if (!res.ok) {
      return NextResponse.json({ html: `<div style="color:red; padding: 20px;">Template ${templateId} not found at ${githubRawUrl}</div>` });
    }

    let html = await res.text();

    // ─── Do basic replacements for live preview ───
    const groom = event.groomName || event.celebrantName || 'Arjun';
    const bride = event.brideName || 'Nithya';
    const type = event.eventType || 'Wedding';
    const initials = event.customInitials || `${groom[0] || ''} & ${bride[0] || ''}`;

    html = html.replace(/<h1 class="logo-text">.*?<\/h1>/gs, `<h1 class="logo-text">${initials}</h1>`);
    html = html.replace(/<div class="initials">.*?<\/div>/gs, `<div class="initials">${initials}</div>`);
    
    // Replace names in full-names-container
    if (html.includes('couple-full-names')) {
      html = html.replace(
        /<h1 class="couple-full-names">[\s\S]*?<\/h1>/,
        `<h1 class="couple-full-names"><span class="first-name">${groom}</span><span class="weds">&amp;</span><span class="second-name">${bride}</span></h1>`
      );
    } else {
      // Fallback naive replacement
      html = html.replace(/Arjun/g, groom).replace(/Nithya/g, bride);
    }

    html = html.replace(/<span class="info-text">.*?<\/span>/g, `<span class="info-text">Live Preview</span>`);
    
    if (event.venue) {
      // Very naive replacement for venue
      html = html.replace(/Sri Prasannanjaneya Swamy Vari Kalyanamandapam/g, event.venue);
    }

    if (event.thumbnailUrl) {
      html = html.replace(/assets\/gallery_1\.png/g, event.thumbnailUrl);
    }

    // Inject a small script to auto-scroll to top and disable scrolling to prevent iframe jumping
    const previewScript = `<script>
      document.addEventListener('DOMContentLoaded', () => {
        document.body.style.overflow = 'hidden';
      });
    </script>`;
    html = html.replace('</head>', `${previewScript}</head>`);

    // Inject base tag so relative assets load via our local proxy API
    const baseTag = `<base href="/api/template-asset/${templateId}/" />`;
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n    ${baseTag}`);
    } else {
      html = html.replace('<html>', `<html>\n  <head>\n    ${baseTag}\n  </head>`);
    }

    return NextResponse.json({ html });
  } catch (err: any) {
    console.error("Preview Error:", err);
    return NextResponse.json({ html: `<div style="color:red;">Error generating preview: ${err.message}</div>` });
  }
}
