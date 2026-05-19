import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
if (!apiKey) {
  console.error("❌ NEXT_PUBLIC_GEMINI_API_KEY not found in .env.local");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function testGemini() {
  console.log("🚀 Testing Gemini 1.5 Flash Prompt Generation...");
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const eventType = "Wedding";
    const groomName = "Shanti";
    const brideName = "Priya";

    const systemPrompt = `Write a highly descriptive, visually stunning, artistic image generation prompt for a ${eventType} celebration of ${groomName} and ${brideName}. The description should focus on the background decor, beautiful traditional Indian floral arrangements (e.g. pastel roses, marigolds, jasmine), elegant lighting (soft pinks, warm golds, and soft bokeh), luxury setup, photo-realistic, cinematic, 16:9 aspect ratio, without any text. Provide ONLY the final prompt text, with no extra text, explanations, or quotes.`;

    const result = await model.generateContent(systemPrompt);
    const text = result.response.text();
    console.log("✅ SUCCESS! Generated Prompt:\n");
    console.log(text);
  } catch (error) {
    console.error("❌ Error occurred during text generation:", error);
  }
}

testGemini();
