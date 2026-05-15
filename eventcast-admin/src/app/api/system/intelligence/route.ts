import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return NextResponse.json({ success: false, error: "Missing Cloudinary Credentials" });
    }

    // btoa() is available in Edge Runtime; Buffer.from() is Node.js-only and throws in V8 isolates
    const auth = btoa(`${apiKey}:${apiSecret}`);

    // Fetch Usage from Cloudinary
    const cloudinaryRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/usage`, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    });

    const cloudinaryData = await cloudinaryRes.json();

    // Analyze Health
    const health: any = {
      status: 'healthy',
      messages: [],
      score: 100
    };

    // 1. Cloudinary Checks
    if (cloudinaryData) {
      const transUsage = (cloudinaryData.transformations?.used / cloudinaryData.transformations?.limit) * 100;
      const bwUsage = (cloudinaryData.bandwidth?.used / cloudinaryData.bandwidth?.limit) * 100;

      if (transUsage > 80 || bwUsage > 80) {
        health.status = 'warning';
        health.score -= 20;
        health.messages.push(`High Cloudinary usage detected: ${Math.round(Math.max(transUsage, bwUsage))}%`);
      }

      if (transUsage > 95 || bwUsage > 95) {
        health.status = 'critical';
        health.score -= 50;
        health.messages.push(`Cloudinary limits almost reached! Action required.`);
      }
    }

    return NextResponse.json({
      success: true,
      health,
      timestamp: new Date().toISOString(),
      raw: {
        cloudinary: {
          transformations: cloudinaryData.transformations,
          bandwidth: cloudinaryData.bandwidth,
          storage: cloudinaryData.storage
        }
      }
    });

  } catch (error: any) {
    console.error("System Intelligence Error:", error);
    return NextResponse.json({ success: false, error: error.message });
  }
}
