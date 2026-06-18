import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveTemplateDir } from '@/lib/localSyncPaths';

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' || process.env.CF_PAGES === '1') {
    return NextResponse.json(
      { error: 'Asset upload is not available in production' },
      { status: 403 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const slug = formData.get('slug') as string | null;
    const templatePath = formData.get('path') as string | null;
    const templateKey = formData.get('templateKey') as string | null;

    if (!file) {
      return NextResponse.json({ error: '`file` field is required' }, { status: 400 });
    }

    const ref = resolveTemplateDir({ slug, path: templatePath, templateKey });
    const eventDir = ref.dir;
    const assetsDir = path.join(eventDir, 'assets');

    const rawName = file.name || `upload-${Date.now()}`;
    const safeName = rawName
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    if (!fs.existsSync(eventDir)) {
      fs.mkdirSync(eventDir, { recursive: true });
      console.log(`📁 Created template directory: ${eventDir}`);
    }

    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
      console.log(`📁 Created assets directory: ${assetsDir}`);
    }

    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    let filename = safeName;
    let counter = 1;
    while (fs.existsSync(path.join(assetsDir, filename))) {
      filename = `${base}_${counter}${ext}`;
      counter++;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(assetsDir, filename);
    fs.writeFileSync(filePath, buffer);

    console.log(
      `✅ Asset saved: "${rawName}" → "${filename}" (${buffer.length} bytes) [${ref.label}]`,
    );

    const url = `/api/local-sync/assets/${ref.templateKey}/assets/${encodeURIComponent(filename)}`;

    return NextResponse.json({
      url,
      name: rawName,
      filename,
      type: 'image',
      templateKey: ref.templateKey,
    });
  } catch (error: any) {
    console.error('❌ Asset upload error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
