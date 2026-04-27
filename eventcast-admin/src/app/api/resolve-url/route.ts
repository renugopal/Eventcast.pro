import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    const res = await fetch(url, { 
      method: 'GET', 
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const resolvedUrl = res.url;
    
    // Fetch the title and description from the page content
    const html = await res.text();
    
    // Try to get og:title first (often more concise: Name, City)
    const ogTitleMatch = html.match(/<meta property="og:title" content="(.*?)"/i);
    const ogDescMatch = html.match(/<meta property="og:description" content="(.*?)"/i);
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);

    let finalName = "";
    if (ogTitleMatch) {
      finalName = ogTitleMatch[1];
    } else if (titleMatch) {
      finalName = titleMatch[1].replace(' - Google Maps', '');
    }

    // If description has more address info, we can append it if needed
    // But usually og:title is perfect
    
    return NextResponse.json({ resolvedUrl, title: finalName.trim() });
  } catch (error) {
    console.error('URL Resolution Error:', error);
    return NextResponse.json({ error: 'Failed to resolve URL' }, { status: 500 });
  }
}
