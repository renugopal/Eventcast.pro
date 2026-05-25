import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(req: Request, { params }: { params: Promise<{ templateId: string; file: string[] }> }) {
  try {
    const resolvedParams = await params;
    const { templateId, file } = resolvedParams;
    
    if (!templateId || !file || file.length === 0) {
      return new NextResponse('Missing parameters', { status: 400 });
    }

    const projectRoot = process.cwd().replace(/eventcast-admin[\\/]?$/, '');
    const relativePath = path.join(...file);
    const filePath = path.join(projectRoot, templateId, relativePath);

    // Prevent directory traversal attacks
    const normalizedFilePath = path.normalize(filePath);
    if (!normalizedFilePath.startsWith(path.join(projectRoot, templateId))) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    if (!fs.existsSync(normalizedFilePath)) {
      return new NextResponse('Not found', { status: 404 });
    }

    const buffer = fs.readFileSync(normalizedFilePath);
    
    const ext = path.extname(normalizedFilePath).toLowerCase();
    let contentType = 'text/plain';
    if (ext === '.css') contentType = 'text/css';
    else if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.svg') contentType = 'image/svg+xml';
    else if (ext === '.woff2') contentType = 'font/woff2';
    else if (ext === '.woff') contentType = 'font/woff';
    else if (ext === '.ttf') contentType = 'font/ttf';
    else if (ext === '.mp4') contentType = 'video/mp4';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000'
      }
    });
  } catch (error) {
    console.error('Template asset error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
