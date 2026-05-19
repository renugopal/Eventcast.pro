import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'edge';

// 🤖 EVENTCAST PRO - AI SALES BOT (THE RAINMAKER)
// This endpoint powers the interactive chat widget on the landing page.

const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY || '');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Handle CORS Preflight OPTIONS requests
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: CORS_HEADERS
  });
}

const SYSTEM_PROMPT = `
You are 'Eventcast AI', the official sales and consulting assistant for Eventcast.pro.
Eventcast.pro is India's most reliable and premium B2B SaaS platform for live streaming weddings, sangeeths, and corporate events.

Your goal is to convince freelance photographers and live-streaming studios to switch from expensive traditional CDNs or unreliable free platforms to Eventcast.pro.

KEY SELLING POINTS TO HIGHLIGHT:
1. Cost-Savings: We offer a prepaid wallet model. 100% predictable pricing (₹499 - ₹1,499 per event based on quality).
2. Reliability: True multi-CDN HLS edge streaming. No buffering, no dropouts, even with thousands of viewers.
3. White-label Custom Domains: Pro studios can connect their own domain (e.g., live.yourstudio.com).
4. Auto-Recovery: Our Stream Health Bot automatically restarts crashed streams in the background.

CONVERSATION RULES:
- Be incredibly polite, professional, and enthusiastic. Use a premium, welcoming tone.
- Keep responses short, readable, and punchy (max 2-3 short paragraphs).
- Use relevant emojis.
- If they mention costs, remind them about the 'Cost-Savings Calculator' above the chat input!
- ALWAYS steer the conversation towards encouraging them to "Book a Free Demo" or "Sign up now".
- If they ask a technical question, explain it simply but emphasize that Eventcast handles all the complex tech for them.
`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages array' }, { status: 400, headers: CORS_HEADERS });
    }

    if (!process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
      return NextResponse.json({ error: 'AI API Key not configured' }, { status: 500, headers: CORS_HEADERS });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Format history for Gemini
    const chat = model.startChat({
      systemInstruction: {
        role: 'system',
        parts: [{ text: SYSTEM_PROMPT }]
      },
      history: messages.slice(0, -1).map((msg: any) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }))
    });

    const latestMessage = messages[messages.length - 1].content;
    const result = await chat.sendMessage(latestMessage);
    const responseText = result.response.text();

    return NextResponse.json({
      success: true,
      reply: responseText
    }, {
      headers: CORS_HEADERS
    });

  } catch (err: any) {
    console.error('AI Sales Chat API Error:', err);
    return NextResponse.json({ error: 'Failed to generate AI response' }, { status: 500, headers: CORS_HEADERS });
  }
}
