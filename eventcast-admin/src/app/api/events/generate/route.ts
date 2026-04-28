import { NextResponse } from 'next/server';

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

    // 6. Modify index.html content (SEO & Maps)
    const displayTitle = `${event.groom_name || event.celebrant_name} & ${event.bride_name || 'Family'} ${event.event_type} | ${event.event_date}`;
    const displayDesc = `Join us live for the ${event.event_type} of ${event.groom_name || event.celebrant_name} & ${event.bride_name || 'Family'}. Venue: ${event.venue_name}`;
    
    htmlContent = htmlContent.replace(/<title>.*?<\/title>/g, `<title>${displayTitle}</title>`);
    htmlContent = htmlContent.replace(/<meta property="og:title" content=".*?">/g, `<meta property="og:title" content="${displayTitle}">`);
    htmlContent = htmlContent.replace(/<meta name="description" content=".*?">/g, `<meta name="description" content="${displayDesc}">`);
    htmlContent = htmlContent.replace(/<meta property="og:description" content=".*?">/g, `<meta property="og:description" content="${displayDesc}">`);
    htmlContent = htmlContent.replace(/<meta property="og:image" content=".*?">/g, `<meta property="og:image" content="${event.thumbnail_url}">`);
    htmlContent = htmlContent.replace(/<meta name="twitter:image" content=".*?">/g, `<meta name="twitter:image" content="${event.thumbnail_url}">`);

    if (event.venue_map_link || event.venue_name) {
      const query = event.venue_name || event.venue_map_link;
      const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
      const navigateUrl = event.venue_map_link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue_name || query)}`;
      
      htmlContent = htmlContent.replace(/src="https:\/\/www\.google\.com\/maps\/embed.*?"/g, `src="${embedUrl}"`);
      // Update any existing maps links in the template to our new navigateUrl
      htmlContent = htmlContent.replace(/href="https:\/\/(www\.)?google\.com\/maps[^"]*"/g, `href="${navigateUrl}"`);
      htmlContent = htmlContent.replace(/href="https:\/\/maps\.app\.goo\.gl[^"]*"/g, `href="${navigateUrl}"`);
    }

    // 7. Generate custom config.js content
    const configContent = `window.WEDDING_CONFIG = {
    groom: "${event.groom_name || event.celebrant_name}",
    bride: "${event.bride_name || 'Family'}",
    date: "${event.event_date}",
    time: "${event.event_time}",
    timeSubtext: "",
    timerTarget: "${event.event_date}T${event.timer_target_time || '09:00'}",
    venue: "${event.venue_name}",
    venueSubtext: "",
    youtubeId: "${event.vod_link ? event.vod_link.split('/').pop() : ''}",
    invitationVideo: "${event.invitation_video_url}",
    thumbnail: "${event.thumbnail_url}",
    gallery: ${JSON.stringify(event.gallery_urls || [])},
    supabaseUrl: "${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}",
    supabaseKey: "${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}",
    eventId: "${event.id}",
    eventType: "${event.event_type}",
    introText: "${event.custom_top_title || ''}",
    photographer: ${JSON.stringify(event.photographer || null)}
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
      slug: slug
    });

  } catch (error: any) {
    console.error("Generator Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
