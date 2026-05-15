import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { RestreamerClient } from '@/lib/restreamer';

export const runtime = 'edge';

// Use admin client if available (bypasses RLS)
const db = supabaseAdmin || supabase;

// Helper for Cloudinary Signature using Web Crypto API
async function generateCloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const sortedKeys = Object.keys(params).sort();
  const stringToSign = sortedKeys.map(k => `${k}=${params[k]}`).join('&') + apiSecret;
  
  const encoder = new TextEncoder();
  const data = encoder.encode(stringToSign);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: Request) {
  try {
    const { id } = await req.json();

    // 1. Fetch Event Details from Supabase
    const { data: event, error: fetchError } = await db
      .from('events')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !event) throw new Error("Event not found.");

    const slug = event.slug;

    // 2. Restreamer Cleanup: delete process config AND all VOD/HLS media files from disk
    try {
      const restreamer = new RestreamerClient({
        url: process.env.RESTREAMER_URL || 'https://media.eventcast.pro',
        username: process.env.RESTREAMER_USERNAME || 'admin',
        password: process.env.RESTREAMER_PASSWORD
      });
      // Step A: remove the process (stops any active stream and removes config)
      await restreamer.deleteChannel(slug);
      // Step B: purge persisted VOD files from the data filesystem
      //         Without this, .m3u8 + .ts segment files accumulate on the media server disk
      const { deleted, errors } = await restreamer.deleteChannelFiles(slug);
      console.log(`VOD cleanup for ${slug}: ${deleted} files removed, ${errors} errors`);
    } catch (rsErr) {
      // Non-fatal: log the error but continue — Supabase/GitHub/Cloudinary deletion must still proceed
      console.error(`Restreamer cleanup failed for ${slug}:`, rsErr);
    }

    // 3. Cloudinary Deletion
    try {
      const assetsToDelete: string[] = [];
      if (event.thumbnail_url) assetsToDelete.push(getPublicId(event.thumbnail_url));
      if (event.invitation_video_url) assetsToDelete.push(getPublicId(event.invitation_video_url));
      if (event.gallery_urls) {
        event.gallery_urls.forEach((url: string) => assetsToDelete.push(getPublicId(url)));
      }
      const validAssets = assetsToDelete.filter(id => id);
      if (validAssets.length > 0) {
        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY!;
        const apiSecret = process.env.CLOUDINARY_API_SECRET!;
        const timestamp = Math.round(new Date().getTime() / 1000).toString();
        const images = validAssets.filter(id => !id.includes('video'));
        if (images.length > 0) {
          const params = { public_ids: images.join(','), timestamp };
          const signature = await generateCloudinarySignature(params, apiSecret);
          const formData = new URLSearchParams();
          formData.append('public_ids', images.join(','));
          formData.append('timestamp', timestamp);
          formData.append('api_key', apiKey);
          formData.append('signature', signature);
          await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
          });
        }
      }
    } catch (cldErr) {
      console.error("Cloudinary cleanup failed:", cldErr);
    }

    // 4. GitHub Folder Deletion
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      const owner = 'renugopal';
      const repo = 'Eventcast.pro';
      const branch = 'main';
      const targetPath = `events/${slug}`;
      if (githubToken) {
        const headers = { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' };
        const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, { headers });
        const refData = await refRes.json();
        const latestCommitSha = refData.object.sha;
        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers });
        const commitData = await commitRes.json();
        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers });
        const treeData = await treeRes.json();
        const newTree = treeData.tree
          .filter((item: any) => !item.path.startsWith(`${targetPath}/`) && item.type === 'blob')
          .map((item: any) => ({ path: item.path, mode: item.mode, type: item.type, sha: item.sha }));
        const createTreeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ tree: newTree })
        });
        const createTreeData = await createTreeRes.json();
        const createCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ message: `Automated Cleanup: Deleted ${slug}`, tree: createTreeData.sha, parents: [latestCommitSha] })
        });
        const createCommitData = await createCommitRes.json();
        await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ sha: createCommitData.sha, force: false })
        });
      }
    } catch (gitErr) {
      console.error("GitHub cleanup failed:", gitErr);
    }

    // 5. FINALLY: Delete from Supabase (using Admin)
    const { error: deleteError } = await db.from('events').delete().eq('id', id);
    if (deleteError) throw new Error(`Supabase Deletion Error: ${deleteError.message}`);

    return NextResponse.json({ success: true, message: "Deleted successfully" });

  } catch (error: any) {
    console.error("Delete Endpoint Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

function getPublicId(url: string) {
  try {
    const parts = url.split('/');
    const lastPart = parts.pop();
    const folder = parts.slice(parts.indexOf('upload') + 2).join('/');
    const publicId = lastPart?.split('.')[0];
    return folder ? `${folder}/${publicId}` : publicId || "";
  } catch {
    return "";
  }
}
