import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = 'edge';

// Fallback curated premium watercolor backgrounds (100% clean, no people/couples)
const FALLBACK_BACKGROUNDS: Record<string, string> = {
  wedding: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1280&h=720&fit=crop", // Exquisite gold fluid marble & pastel pink watercolor
  birthday: "https://images.unsplash.com/photo-1513151233558-d860c5398176?q=80&w=1280&h=720&fit=crop", // Elegant, festive abstract gold/pastel confetti art
  ceremony: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?q=80&w=1280&h=720&fit=crop", // Royal traditional gold silk texture canvas
  default: "https://images.unsplash.com/photo-1604871000636-074fa5117945?q=80&w=1280&h=720&fit=crop" // Elegant pastel watercolor abstract
};

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
    const { groomName, brideName, celebrantName, eventType } = await req.json();
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const cldApiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;

    if (!cloudName || !apiSecret || !cldApiKey) {
      throw new Error("Cloudinary credentials missing.");
    }

    const typeKey = (eventType || 'wedding').toLowerCase();
    let fallbackUrl = FALLBACK_BACKGROUNDS.default;
    if (typeKey.includes('birthday')) fallbackUrl = FALLBACK_BACKGROUNDS.birthday;
    else if (typeKey.includes('ceremony') || typeKey.includes('saree') || typeKey.includes('dhoti')) fallbackUrl = FALLBACK_BACKGROUNDS.ceremony;
    else if (typeKey.includes('wedding')) fallbackUrl = FALLBACK_BACKGROUNDS.wedding;

    let base64Image: string | null = null;
    let refinedPrompt = `A premium, elegant, and artistic watercolor backdrop canvas for a traditional ${eventType || 'Event'} celebration featuring delicate floral borders, warm lighting, and a clean blank center space for text overlay, 16:9 aspect ratio, no people.`;

    if (apiKey) {
      try {
        // 1. Refine Prompt using Gemini 2.0 Flash
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const nameDesc = brideName && brideName.toLowerCase() !== 'family' ? `${groomName} & ${brideName}` : groomName;
        const systemPrompt = `Write an exquisite, highly descriptive, artistic image generation prompt for a ${eventType || 'Wedding'} backdrop canvas. 
        CRITICAL RULE: DO NOT include any people, couples, faces, or realistic human figures. It must be an empty, clean, blank background canvas designed specifically to have text written on top of it.
        The style must be a premium artistic watercolor invitation background, with a clean blank center space for text overlay, elegant pastel floral arrangements (like soft pink roses, eucalyptus leaves, or delicate gold outlines) placed only around the borders or in the corners. Use a dreamlike soft color palette (soft pinks, warm golds, cream, and mint greens), luxury traditional wedding style, aesthetic watercolor texture, 16:9 aspect ratio, cinematic high-end invitation card background, with NO text in the image itself. 
        Provide ONLY the final refined prompt string, with no quotes, extra text, or explanations.`;
        
        const textResult = await model.generateContent(systemPrompt);
        const generatedPromptText = textResult.response.text().trim();
        if (generatedPromptText) {
          refinedPrompt = generatedPromptText;
        }

        // 2. Call Vertex AI / Imagen REST API via Gemini Key
        const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: refinedPrompt }],
            parameters: { sampleCount: 1, aspectRatio: "16:9", outputMimeType: "image/jpeg" }
          })
        });

        if (response.ok) {
          const predictData = await response.json();
          if (predictData.predictions?.[0]?.bytesBase64Encoded) {
            base64Image = `data:image/jpeg;base64,${predictData.predictions[0].bytesBase64Encoded}`;
            console.log("✅ Successfully generated image via Imagen 4");
          }
        } else {
          console.warn("⚠️ Imagen generation failed, using beautiful fallback backdrop.");
        }
      } catch (aiErr) {
        console.error("⚠️ AI Generation failed (likely leaked or quota-exceeded key), falling back safely:", aiErr);
      }
    }

    // 3. Upload to Cloudinary (using either base64 or fallbackUrl)
    const fileToUpload = base64Image || fallbackUrl;
    const timestamp = Math.round(Date.now() / 1000).toString();
    const folder = 'events/ai-thumbnails';
    const paramsToSign = { folder, timestamp };
    const signature = await generateCloudinarySignature(paramsToSign, apiSecret);

    const formData = new FormData();
    formData.append('file', fileToUpload);
    formData.append('api_key', cldApiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', folder);

    const cldRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: formData
    });

    const cldData = await cldRes.json();
    if (!cldData.secure_url) {
      throw new Error(cldData.error?.message || "Cloudinary upload failed");
    }

    return NextResponse.json({
      success: true,
      url: cldData.secure_url,
      promptUsed: refinedPrompt,
      isAiGenerated: !!base64Image
    });

  } catch (error: any) {
    console.error("AI Generation Route Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
