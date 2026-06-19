import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(req: Request, { params }: { params: Promise<{ templateId: string; file: string[] }> }) {
  try {
    const resolvedParams = await params;
    const { templateId, file } = resolvedParams;
    
    if (!templateId || !file || file.length === 0) {
      return new NextResponse('Missing parameters', { status: 400 });
    }

    const githubRawUrl = `https://raw.githubusercontent.com/renugopal/Eventcast.pro/main/${templateId}/${file.join('/')}`;
    const res = await fetch(githubRawUrl);
    
    if (!res.ok) {
      return new NextResponse('Not found', { status: 404 });
    }

    const buffer = await res.arrayBuffer();
    
    const ext = file[file.length - 1].split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'css': 'text/css',
      'js': 'application/javascript',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'webp': 'image/webp',
    };
    
    const contentType = mimeTypes[ext || ''] || 'application/octet-stream';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });
    
  } catch (error) {
    console.error('Template asset error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
