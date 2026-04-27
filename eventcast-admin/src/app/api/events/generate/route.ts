import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function POST(req: Request) {
  try {
    const event = await req.json();
    
    // 1. Define Paths
    const rootDir = 'd:\\Eventcast.pro';
    const templateDir = path.join(rootDir, event.template_id || 'wedding-template-01');
    const slug = `${(event.groom_name || event.celebrant_name).toLowerCase().replace(/\s+/g, '-')}-${(event.bride_name || 'family').toLowerCase().replace(/\s+/g, '-')}-${event.event_type.toLowerCase()}`;
    const targetDir = path.join(rootDir, 'events', slug);

    console.log(`Generating site for ${slug}...`);

    // 2. Create Target Directory
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 3. Read and Update index.html for SEO
    let htmlContent = fs.readFileSync(path.join(templateDir, 'index.html'), 'utf8');
    
    const displayTitle = `${event.groom_name || event.celebrant_name} & ${event.bride_name || 'Family'} ${event.event_type} | ${event.event_date}`;
    const displayDesc = `Join us live for the ${event.event_type} of ${event.groom_name || event.celebrant_name} & ${event.bride_name || 'Family'}. Venue: ${event.venue_name}`;
    
    htmlContent = htmlContent.replace(/<title>.*?<\/title>/g, `<title>${displayTitle}</title>`);
    htmlContent = htmlContent.replace(/<meta property="og:title" content=".*?">/g, `<meta property="og:title" content="${displayTitle}">`);
    htmlContent = htmlContent.replace(/<meta name="description" content=".*?">/g, `<meta name="description" content="${displayDesc}">`);
    htmlContent = htmlContent.replace(/<meta property="og:description" content=".*?">/g, `<meta property="og:description" content="${displayDesc}">`);
    htmlContent = htmlContent.replace(/<meta property="og:image" content=".*?">/g, `<meta property="og:image" content="${event.thumbnail_url}">`);
    htmlContent = htmlContent.replace(/<meta name="twitter:image" content=".*?">/g, `<meta name="twitter:image" content="${event.thumbnail_url}">`);

    // 3b. Update Map & Venue Links
    if (event.venue_map_link || event.venue_name) {
      const query = event.venue_name || event.venue_map_link;
      const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
      htmlContent = htmlContent.replace(/src="https:\/\/www\.google\.com\/maps\/embed.*?"/g, `src="${embedUrl}"`);
      
      if (event.venue_map_link) {
        htmlContent = htmlContent.replace(/href="https:\/\/maps\.app\.goo\.gl\/.*?"/g, `href="${event.venue_map_link}"`);
      }
    }

    // 4. Copy Template Files (except config.js and index.html which we customized)
    const filesToCopy = fs.readdirSync(templateDir);
    filesToCopy.forEach(file => {
      if (file === 'config.js' || file === 'index.html') return; 
      const src = path.join(templateDir, file);
      const dest = path.join(targetDir, file);
      
      if (fs.lstatSync(src).isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest);
        fs.readdirSync(src).forEach(subFile => {
          fs.copyFileSync(path.join(src, subFile), path.join(dest, subFile));
        });
      } else {
        fs.copyFileSync(src, dest);
      }
    });

    // Write the customized index.html
    fs.writeFileSync(path.join(targetDir, 'index.html'), htmlContent);

    // 5. Generate custom config.js
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
    supabaseUrl: "${process.env.NEXT_PUBLIC_SUPABASE_URL}",
    supabaseKey: "${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}",
    eventId: "${event.id}",
    eventType: "${event.event_type}",
    introText: "${event.custom_top_title || ''}",
    photographer: ${JSON.stringify(event.photographer || null)}
};`;

    fs.writeFileSync(path.join(targetDir, 'config.js'), configContent);

    // 5. Git Automation (Add, Commit, Push)
    try {
      console.log("Starting Git Push...");
      // Use execSync to run git commands in the root directory
      execSync(`git add "events/${slug}"`, { cwd: rootDir });
      execSync(`git commit -m "Automated Build: ${slug}"`, { cwd: rootDir });
      execSync(`git push origin main`, { cwd: rootDir });
      console.log("Git Push Successful!");
    } catch (gitErr: any) {
      console.error("Git Push Failed (but files were created):", gitErr.message);
      // We don't fail the whole process because files are local anyway
    }

    return NextResponse.json({ 
      success: true, 
      url: `https://eventcast.pro/events/${slug}`, // Assuming Cloudflare mapping
      slug: slug
    });

  } catch (error: any) {
    console.error("Generator Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
