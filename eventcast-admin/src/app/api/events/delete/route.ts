import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { google } from 'googleapis';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

    // 2. Delete from YouTube
    if (event.vod_link) {
      try {
        const broadcastId = event.vod_link.split('/').pop();
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );
        oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
        
        await youtube.liveBroadcasts.delete({ id: broadcastId! });
        console.log("YouTube event deleted.");
      } catch (ytErr) {
        console.error("YouTube deletion failed:", ytErr);
      }
    }

    // 3. Delete from Cloudinary
    const assetsToDelete: string[] = [];
    if (event.thumbnail_url) assetsToDelete.push(getPublicId(event.thumbnail_url));
    if (event.invitation_video_url) assetsToDelete.push(getPublicId(event.invitation_video_url));
    if (event.gallery_urls) {
      event.gallery_urls.forEach((url: string) => assetsToDelete.push(getPublicId(url)));
    }

    const validAssets = assetsToDelete.filter(id => id);
    if (validAssets.length > 0) {
      try {
        // Delete images
        const images = validAssets.filter(id => !id.includes('video'));
        if (images.length > 0) await cloudinary.api.delete_resources(images);
        
        // Delete videos
        const videos = validAssets.filter(id => id.includes('video'));
        for (const vid of videos) {
          await cloudinary.uploader.destroy(vid, { resource_type: 'video' });
        }
        console.log("Cloudinary assets deleted.");
      } catch (cldErr) {
        console.error("Cloudinary deletion failed:", cldErr);
      }
    }

    // 4. Delete Physical Folder and Push to Git
    const rootDir = 'd:\\Eventcast.pro';
    const slug = `${(event.groom_name || event.celebrant_name).toLowerCase().replace(/\s+/g, '-')}-${(event.bride_name || 'family').toLowerCase().replace(/\s+/g, '-')}-${event.event_type.toLowerCase()}`;
    const targetDir = path.join(rootDir, 'events', slug);

    if (fs.existsSync(targetDir)) {
      try {
        console.log(`Deleting folder: ${targetDir}`);
        fs.rmSync(targetDir, { recursive: true, force: true });
        
        // Git Automation
        execSync(`git add .`, { cwd: rootDir }); // Add all changes (including deletions)
        execSync(`git commit -m "Automated Cleanup: Deleted ${slug}"`, { cwd: rootDir });
        execSync(`git push origin main`, { cwd: rootDir });
        console.log("Git Push (Cleanup) Successful!");
      } catch (fsErr) {
        console.error("Folder deletion or Git push failed:", fsErr);
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
