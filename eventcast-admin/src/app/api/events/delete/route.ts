import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'edge';

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
    const { eventId } = await req.json();

    // 1. Fetch Event Details from Supabase
    const { data: event, error: fetchError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (fetchError || !event) throw new Error("Event not found.");

    // 2. Delete from YouTube (via Edge fetch)
    if (event.vod_link) {
      try {
        const broadcastId = event.vod_link.split('/').pop();
        
        // Refresh Token
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
            grant_type: "refresh_token",
          }),
        });
        const tokenData = await tokenRes.json();
        
        if (tokenData.access_token && broadcastId) {
          await fetch(`https://youtube.googleapis.com/youtube/v3/liveBroadcasts?id=${broadcastId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${tokenData.access_token}` }
          });
          console.log("YouTube event deleted.");
        }
      } catch (ytErr) {
        console.error("YouTube deletion failed:", ytErr);
      }
    }

    // 3. Delete from Cloudinary (via REST API)
    const assetsToDelete: string[] = [];
    if (event.thumbnail_url) assetsToDelete.push(getPublicId(event.thumbnail_url));
    if (event.invitation_video_url) assetsToDelete.push(getPublicId(event.invitation_video_url));
    if (event.gallery_urls) {
      event.gallery_urls.forEach((url: string) => assetsToDelete.push(getPublicId(url)));
    }

    const validAssets = assetsToDelete.filter(id => id);
    if (validAssets.length > 0) {
      try {
        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY!;
        const apiSecret = process.env.CLOUDINARY_API_SECRET!;
        const timestamp = Math.round(new Date().getTime() / 1000).toString();

        // Delete Images
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
      } catch (cldErr) {
        console.error("Cloudinary deletion failed:", cldErr);
      }
    }

    // 4. Delete Physical Folder from GitHub API
    const slug = `${(event.groom_name || event.celebrant_name).toLowerCase().replace(/\\s+/g, '-')}-${(event.bride_name || 'family').toLowerCase().replace(/\\s+/g, '-')}-${event.event_type.toLowerCase()}`;
    const targetPath = `events/${slug}`;
    const githubToken = process.env.GITHUB_TOKEN;
    const owner = 'renugopal';
    const repo = 'Eventcast.pro';
    const branch = 'main';

    if (githubToken) {
      try {
        const headers = {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        };

        const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, { headers });
        const refData = await refRes.json();
        const latestCommitSha = refData.object.sha;

        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers });
        const commitData = await commitRes.json();
        const baseTreeSha = commitData.tree.sha;

        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers });
        const treeData = await treeRes.json();

        // Create a new tree excluding the deleted folder
        const newTree = treeData.tree
          .filter((item: any) => !item.path.startsWith(`${targetPath}/`) && item.type === 'blob')
          .map((item: any) => ({
            path: item.path,
            mode: item.mode,
            type: item.type,
            sha: item.sha
          }));

        const createTreeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ tree: newTree })
        });
        const createTreeData = await createTreeRes.json();

        const createCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: `Automated Cleanup: Deleted ${slug}`,
            tree: createTreeData.sha,
            parents: [latestCommitSha]
          })
        });
        const createCommitData = await createCommitRes.json();

        await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ sha: createCommitData.sha, force: false })
        });

        console.log("GitHub folder deleted successfully.");
      } catch (gitErr) {
        console.error("GitHub deletion failed:", gitErr);
      }
    }

    // 5. Delete from Supabase
    await supabase.from('events').delete().eq('id', eventId);

    return NextResponse.json({ success: true, message: "Everything deleted successfully!" });

  } catch (error: any) {
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
