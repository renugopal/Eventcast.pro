import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { RestreamerClient } from '@/lib/restreamer';
import { requireAdmin } from '@/lib/auth';

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
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

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
    // Track images and videos separately by their source field — never infer from public_id string
    try {
      const imagePublicIds: string[] = [];
      const videoPublicIds: string[] = [];

      if (event.thumbnail_url) imagePublicIds.push(getPublicId(event.thumbnail_url));
      // invitation_video_url is always a video resource in Cloudinary
      if (event.invitation_video_url) videoPublicIds.push(getPublicId(event.invitation_video_url));
      // gallery_urls are always image resources
      if (event.gallery_urls) {
        event.gallery_urls.forEach((url: string) => imagePublicIds.push(getPublicId(url)));
      }

      const validImages = imagePublicIds.filter(id => id);
      const validVideos = videoPublicIds.filter(id => id);

      if (validImages.length > 0 || validVideos.length > 0) {
        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY!;
        const apiSecret = process.env.CLOUDINARY_API_SECRET!;
        const timestamp = Math.round(new Date().getTime() / 1000).toString();

        const cloudinaryDelete = async (publicIds: string[], resourceType: 'image' | 'video') => {
          const params = { public_ids: publicIds.join(','), timestamp };
          const signature = await generateCloudinarySignature(params, apiSecret);
          const body = new URLSearchParams();
          body.append('public_ids', publicIds.join(','));
          body.append('timestamp', timestamp);
          body.append('api_key', apiKey);
          body.append('signature', signature);
          await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          });
        };

        if (validImages.length > 0) await cloudinaryDelete(validImages, 'image');
        if (validVideos.length > 0) await cloudinaryDelete(validVideos, 'video');
      }
    } catch (cldErr) {
      console.error("Cloudinary cleanup failed:", cldErr);
    }

    // 4. GitHub Folder Deletion
    //    Strategy: use Contents API to list only the target event folder's files, then
    //    create a new tree with base_tree (inheriting the full repo unchanged) and mark
    //    each event file for removal with sha:null.  Never fetches the full recursive tree.
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      const owner = 'renugopal';
      const repo = 'Eventcast.pro';
      const branch = 'main';
      const targetPath = `events/${slug}`;

      if (githubToken) {
        const headers = {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Eventcast-Admin',
        };

        // Step A: get latest commit SHA and its root tree SHA
        const refRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
          { headers }
        );
        const refData = await refRes.json();
        if (!refRes.ok) throw new Error(`GitHub ref fetch failed: ${JSON.stringify(refData)}`);
        const latestCommitSha: string = refData.object.sha;

        const commitRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
          { headers }
        );
        const commitData = await commitRes.json();
        if (!commitRes.ok) throw new Error(`GitHub commit fetch failed: ${JSON.stringify(commitData)}`);
        const rootTreeSha: string = commitData.tree.sha;

        // Step B: list only the files inside events/{slug}/ using the Contents API
        //         This is O(files_in_event) — typically 3 files — not O(repo_size)
        const contentsRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${targetPath}?ref=${branch}`,
          { headers }
        );

        if (contentsRes.status === 404) {
          // Folder never existed on GitHub (e.g. event was created but publishing failed)
          console.warn(`GitHub: folder ${targetPath} not found — skipping tree update`);
        } else {
          const contentsData = await contentsRes.json();
          if (!contentsRes.ok) throw new Error(`GitHub contents fetch failed: ${JSON.stringify(contentsData)}`);

          // Step C: build deletion entries — sha:null removes the file from the tree
          const deletionEntries = (contentsData as any[])
            .filter((item: any) => item.type === 'file')
            .map((item: any) => ({
              path: `${targetPath}/${item.name}`,
              mode: '100644' as const,
              type: 'blob' as const,
              sha: null,
            }));

          if (deletionEntries.length > 0) {
            // Step D: create a new tree that inherits everything via base_tree,
            //         then removes only the event's files — POST body is tiny (3-4 entries)
            const createTreeRes = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/git/trees`,
              {
                method: 'POST',
                headers,
                body: JSON.stringify({ base_tree: rootTreeSha, tree: deletionEntries }),
              }
            );
            const createTreeData = await createTreeRes.json();
            if (!createTreeRes.ok) throw new Error(`GitHub tree creation failed: ${JSON.stringify(createTreeData)}`);

            // Step E: create commit
            const createCommitRes = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/git/commits`,
              {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  message: `Automated Cleanup: Deleted ${slug}`,
                  tree: createTreeData.sha,
                  parents: [latestCommitSha],
                }),
              }
            );
            const createCommitData = await createCommitRes.json();
            if (!createCommitRes.ok) throw new Error(`GitHub commit creation failed: ${JSON.stringify(createCommitData)}`);

            // Step F: fast-forward the branch ref
            const updateRefRes = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
              {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ sha: createCommitData.sha, force: false }),
              }
            );
            const updateRefData = await updateRefRes.json();
            if (!updateRefRes.ok) throw new Error(`GitHub ref update failed: ${JSON.stringify(updateRefData)}`);
          }
        }
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
