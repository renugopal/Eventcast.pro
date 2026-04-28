
const API_KEY = "AIzaSyDndzTupHI8B4Rj2Y2-JxM9clRVVBf32uA";
const MODEL = "imagen-4.0-fast-generate-001";

async function testImagen4() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predict?key=${API_KEY}`;
  
  const payload = {
    instances: [
      { prompt: "A premium wedding invitation poster for 'Bhanu Pavani & Nivedh', elegant serif typography, pastel floral background, soft lighting" }
    ],
    parameters: {
      sampleCount: 1,
      aspectRatio: "16:9",
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

testImagen4();
