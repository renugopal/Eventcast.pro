import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const event = await req.json();
    
    // 1. Define Paths and Slug
    const groom = event.groom_name || event.groomName || event.celebrant_name || event.celebrantName || 'event';
    const bride = event.bride_name || event.brideName || 'family';
    const type = event.event_type || event.eventType || 'wedding';

    const slug = `${groom.toLowerCase().replace(/\s+/g, '-')}-${bride.toLowerCase().replace(/\s+/g, '-')}-${type.toLowerCase()}`;
    const targetPath = `events/${slug}`;
    const templatePath = event.template_id || 'wedding-template-01';

    // 2. Setup GitHub API Config
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      throw new Error("GITHUB_TOKEN is missing in environment variables.");
    }

    const owner = 'renugopal';
    const repo = 'Eventcast.pro';
    const branch = 'main';
    
    const headers = {
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Eventcast-Admin'
    };

    // --- NEW: Database First to get Event ID ---
    let eventId = event.editingId;
    const dbPayload = {
      event_type: event.event_type || event.eventType,
      groom_name: event.groom_name || event.groomName,
      bride_name: event.bride_name || event.brideName,
      celebrant_name: event.celebrant_name || event.celebrantName,
      custom_top_title: event.custom_top_title || event.customTopTitle,
      event_date: event.event_date || event.eventDate,
      event_time: event.event_time || event.eventTime,
      timer_target_time: event.timer_target_time || event.timerTargetTime,
      show_timer: event.show_timer ?? event.showTimer ?? true,
      venue_name: event.venue_name || event.venueName,
      venue_map_link: event.venue_map_link || event.venueMapLink,
      invitation_video_url: (() => {
        // Support both single URL and multi-URL (newline separated)
        const raw = event.invitation_video_url || event.invitationVideoUrl || event.invitationVideoUrls || '';
        if (Array.isArray(raw)) return raw[0] || null;
        if (typeof raw === 'string') return raw.split('\n').map((u: string) => u.trim()).filter(Boolean)[0] || null;
        return null;
      })(),
      thumbnail_url: event.thumbnail_url || event.thumbnailUrl,
      privacy_status: event.privacy_status || event.privacyStatus,
      gallery_urls: (() => {
        const raw = event.gallery_urls || event.galleryUrls || [];
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') return raw.split('\n').map((u: string) => u.trim()).filter((u: string) => u);
        return [];
      })(),
      vod_link: event.vod_link || event.vodLink,
      template_id: event.template_id || event.templateId,
      slug: slug,
      photographer_id: event.photographer_id || event.photographerId || null,
      // base_design is optional - ensure column exists in Supabase
      ...(event.base_design || event.baseDesign ? { base_design: event.base_design || event.baseDesign } : {}),
      ...(event.youtube_broadcast_id ? { youtube_broadcast_id: event.youtube_broadcast_id } : {}),
      ...(event.youtube_stream_key ? { youtube_stream_key: event.youtube_stream_key } : {}),
      ...(event.youtube_url ? { youtube_url: event.youtube_url } : {})
    };

    if (event.isEditing && event.editingId) {
      const { error: dbError } = await supabase
        .from('events')
        .update(dbPayload)
        .eq('id', event.editingId);
      if (dbError) throw new Error("Database Update Error: " + dbError.message);
    } else {
      const { data: dbData, error: dbError } = await supabase
        .from('events')
        .insert([dbPayload])
        .select();
      if (dbError) throw new Error("Database Insert Error: " + dbError.message);
      eventId = dbData[0].id;
    }
    // -------------------------------------------

    console.log(`Generating site for ${slug} via GitHub API...`);

    // 3. Get latest commit SHA & Base Tree
    const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, { headers });
    const refData = await refRes.json();
    if (!refRes.ok) throw new Error("Failed to get branch ref: " + JSON.stringify(refData));
    const latestCommitSha = refData.object.sha;

    const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers });
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    // 4. Fetch the entire tree recursively to find template files
    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers });
    const treeData = await treeRes.json();
    
    const templateFiles = treeData.tree.filter((item: any) => item.path.startsWith(`${templatePath}/`) && item.type === 'blob');
    
    if (templateFiles.length === 0) {
      throw new Error(`Template directory ${templatePath} not found in repository.`);
    }

    // 5. Fetch index.html content to modify it
    const indexHtmlRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${templatePath}/index.html`);
    let htmlContent = await indexHtmlRes.text();

    // --- NEW: Fetch Photographer Details ---
    let photographerData = null;
    const photographerId = event.photographer_id || event.photographerId;
    if (photographerId) {
      const { data: pData } = await supabase
        .from('photographers')
        .select('*')
        .eq('id', photographerId)
        .single();
      photographerData = pData;
    }
    // ----------------------------------------

    // 6. Modify index.html content (SEO & Maps)
    // Note: formattedDate/formattedTime computed BEFORE displayTitle so we can use them in SEO
    const rawDate = event.event_date || event.eventDate;
    const rawTime = event.event_time || event.eventTime;
    const rawTimerTime = event.timer_target_time || event.timerTargetTime; // Live start time
    const thumbnailUrl = dbPayload.thumbnail_url || '';

    let formattedDate = rawDate || '';
    if (rawDate) {
      // Use UTC date parsing to avoid timezone shift
      const [y, m, d] = rawDate.split('-').map(Number);
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      formattedDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(dateObj);
      const day = dateObj.getUTCDate();
      const suffix = (day % 10 === 1 && day !== 11) ? 'st' : (day % 10 === 2 && day !== 12) ? 'nd' : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
      formattedDate = formattedDate.replace(String(day), day + suffix);
    }

    let formattedTime = rawTime || '';
    if (rawTime) {
      const [hours, minutes] = rawTime.split(':');
      const h = parseInt(hours);
      const ampm = h >= 12 ? 'PM' : 'AM';
      formattedTime = `${h % 12 || 12}:${minutes} ${ampm}`;
    }

    const heart = type.toLowerCase().includes('wedding') ? '❤️' : '✨';
    const displayTitle = `${groom} ${heart} ${bride} ${type.charAt(0).toUpperCase() + type.slice(1)} | ${formattedDate}`;
    const displayDesc = `Join us live and be part of this beautiful ${type.toLowerCase()} celebration filled with love and joy.`;
    
    htmlContent = htmlContent.replace(/<title>.*?<\/title>/g, `<title>${displayTitle}</title>`);
    htmlContent = htmlContent.replace(/<meta property="og:title" content=".*?">/g, `<meta property="og:title" content="${displayTitle}">`);
    htmlContent = htmlContent.replace(/<meta name="description" content=".*?">/g, `<meta name="description" content="${displayDesc}">`);
    htmlContent = htmlContent.replace(/<meta property="og:description" content=".*?">/g, `<meta property="og:description" content="${displayDesc}">`);
    htmlContent = htmlContent.replace(/<meta property="og:image" content=".*?">/g, `<meta property="og:image" content="${thumbnailUrl}">`);
    htmlContent = htmlContent.replace(/<meta name="twitter:image" content=".*?">/g, `<meta name="twitter:image" content="${thumbnailUrl}">`);

    // --- Extract gallery directly from form data (bypass Supabase column type issues) ---
    const galleryArray = (() => {
      const raw = event.gallery_urls || event.galleryUrls || [];
      if (Array.isArray(raw)) return (raw as string[]).filter(u => u && u.trim());
      if (typeof raw === 'string') return (raw as string).split('\n').map(u => u.trim()).filter(Boolean);
      return [];
    })();

    if (event.venue_map_link || event.venueMapLink || event.venue_name || event.venueName) {
      const vName = event.venue_name || event.venueName;
      const vMap = event.venue_map_link || event.venueMapLink;
      const query = vName || vMap;
      const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
      const navigateUrl = vMap || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(vName || query)}`;
      
      htmlContent = htmlContent.replace(/src="https:\/\/www\.google\.com\/maps\/embed.*?"/g, `src="${embedUrl}"`);
      // Update any existing maps links in the template to our new navigateUrl
      htmlContent = htmlContent.replace(/href="https:\/\/(www\.)?google\.com\/maps[^"]*"/g, `href="${navigateUrl}"`);
      htmlContent = htmlContent.replace(/href="https:\/\/maps\.app\.goo\.gl[^"]*"/g, `href="${navigateUrl}"`);
    }


    // 7. Generate custom config.js content
    // timerTarget = Live Start Time (timer_target_time), NOT muhurtham time
    const timerTime = rawTimerTime || rawTime || '09:00';
    const youtubeId = (dbPayload.vod_link || '') ? (dbPayload.vod_link || '').split('/').pop() : '';
    // Escape newlines in introText so config.js doesn't have multi-line string syntax error
    const safeIntroText = (dbPayload.custom_top_title || '').replace(/"/g, '\\"').replace(/\n/g, '\\n');

    // Parse invitation videos array
    const invitationVideosArray = (() => {
      const raw = event.invitation_video_url || event.invitationVideoUrl || event.invitationVideoUrls || '';
      if (Array.isArray(raw)) return (raw as string[]).filter(Boolean);
      if (typeof raw === 'string') return (raw as string).split('\n').map((u: string) => u.trim()).filter(Boolean);
      return [];
    })();

    const configContent = `window.WEDDING_CONFIG = {
    groom: "${dbPayload.groom_name || dbPayload.celebrant_name || ''}",
    bride: "${dbPayload.bride_name || 'Family'}",
    date: "${formattedDate}",
    time: "${formattedTime}",
    timeLabel: "${event.time_label || event.timeLabel || type || 'Wedding'}",
    timeSubtext: "",
    timerTarget: "${rawDate}T${timerTime}",
    venue: "${dbPayload.venue_name || ''}",
    venueSubtext: "",
    youtubeId: "${youtubeId}",
    invitationVideo: "${invitationVideosArray[0] || ''}",
    invitationVideos: ${JSON.stringify(invitationVideosArray)},
    thumbnail: "${thumbnailUrl}",
    gallery: ${JSON.stringify(galleryArray)},
    supabaseUrl: "${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}",
    supabaseKey: "${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}",
    eventId: "${eventId}",
    eventType: "${type}",
    introText: "${safeIntroText}",
    photographer: ${JSON.stringify(photographerData)}
};`;

    // 8. Prepare the new Git Tree
    const newTree = [];
    
    for (const file of templateFiles) {
      const relativePath = file.path.substring(templatePath.length + 1); // remove 'wedding-template-01/'
      const newPath = `${targetPath}/${relativePath}`;
      
      if (relativePath === 'index.html') {
        newTree.push({ path: newPath, mode: '100644', type: 'blob', content: htmlContent });
      } else if (relativePath === 'config.js') {
        newTree.push({ path: newPath, mode: '100644', type: 'blob', content: configContent });
      } else {
        // Link to the existing blob hash without re-uploading the file! Extremely fast & efficient.
        newTree.push({ path: newPath, mode: file.mode, type: 'blob', sha: file.sha });
      }
    }

    // 9. Post the new Tree to GitHub
    const createTreeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ base_tree: baseTreeSha, tree: newTree })
    });
    const createTreeData = await createTreeRes.json();
    if (!createTreeRes.ok) throw new Error("Failed to create tree: " + JSON.stringify(createTreeData));
    const newTreeSha = createTreeData.sha;

    // 10. Create a Commit
    const createCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: `Automated Build: Generated site for ${slug}`,
        tree: newTreeSha,
        parents: [latestCommitSha]
      })
    });
    const createCommitData = await createCommitRes.json();
    if (!createCommitRes.ok) throw new Error("Failed to create commit: " + JSON.stringify(createCommitData));
    const newCommitSha = createCommitData.sha;

    // 11. Update the Reference (Push to main)
    const updateRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: newCommitSha, force: false })
    });
    const updateRefData = await updateRefRes.json();
    if (!updateRefRes.ok) throw new Error("Failed to update ref: " + JSON.stringify(updateRefData));

    console.log("Git Push via API Successful!");

    return NextResponse.json({ 
      success: true, 
      url: `https://eventcast.pro/events/${slug}`, 
      slug: slug,
      id: eventId
    });

  } catch (error: any) {
    console.error("Generator Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
