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

async function testImagen() {
  console.log("🚀 Testing Imagen 3 Image Generation with Gemini API Key...");
  try {
    // Let's use the REST endpoint since Node.js SDK for @google/generative-ai has direct REST calls or model loading
    // In @google/generative-ai, we can call models by using fetch or the SDK.
    // Let's call the REST API directly as it is the most reliable way to check
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: "A beautiful, premium, elegant Indian wedding backdrop with pastel pink flowers, golden accents, soft romantic lighting, 16:9 aspect ratio, cinematic photo-realistic"
          }
        ],
        parameters: {
          sampleCount: 1,
          aspectRatio: "16:9",
          outputMimeType: "image/jpeg"
        }
      })
    });

    const rawText = await response.text();
    console.log("Response Status:", response.status);
    console.log("Raw Response Text length:", rawText.length);
    if (rawText.length > 0) {
      try {
        const data = JSON.parse(rawText);
        console.log("Response Data:", JSON.stringify(data, null, 2));
        if (data.generatedImages && data.generatedImages[0]) {
          console.log("✅ SUCCESS! Image generated successfully!");
          const base64Image = data.generatedImages[0].image.imageBytes;
          console.log("Image bytes received (Base64), length:", base64Image.length);
        } else {
          console.log("❌ Failed to generate image. Check response data above.");
        }
      } catch (err) {
        console.error("❌ Failed to parse response JSON. Raw response is:", rawText);
      }
    } else {
      console.log("❌ Empty response received.");
    }
  } catch (error) {
    console.error("❌ Error occurred during generation:", error);
  }
}

testImagen();
