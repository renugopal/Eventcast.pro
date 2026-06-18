import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { decodeTemplateKey, resolveTemplateDir } from '@/lib/localSyncPaths';

function resolveAssetTemplateDir(templateKeyOrSlug: string, pathParam: string | null) {
  if (pathParam) {
    return resolveTemplateDir({ path: pathParam });
  }

  try {
    const decoded = decodeTemplateKey(templateKeyOrSlug);
    if (fs.existsSync(decoded)) {
      return resolveTemplateDir({ templateKey: templateKeyOrSlug });
    }
  } catch {
    // Fall through to slug lookup
  }

  return resolveTemplateDir({ slug: templateKeyOrSlug });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathSegments } = await params;
    const url = new URL(request.url);

    const templateKeyOrSlug = pathSegments[0];
    const filename = pathSegments.slice(1).join('/');

    if (!templateKeyOrSlug || !filename) {
      return new NextResponse('Bad Request: Missing template key or filename', { status: 400 });
    }

    const { dir: eventDir } = resolveAssetTemplateDir(
      templateKeyOrSlug,
      url.searchParams.get('path'),
    );

    const filePath = path.join(eventDir, decodeURIComponent(filename));

    if (!fs.existsSync(filePath)) {
      return new NextResponse(`File not found: ${filename}`, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);

    let contentType = 'application/octet-stream';
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.svg') contentType = 'image/svg+xml';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.js') contentType = 'application/javascript';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, must-revalidate',
      },
    });
  } catch (error: any) {
    return new NextResponse(`Error serving file: ${error.message}`, { status: 500 });
  }
}
