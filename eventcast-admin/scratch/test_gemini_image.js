
const API_KEY = "AIzaSyDndzTupHI8B4Rj2Y2-JxM9clRVVBf32uA";
const MODEL = "imagen-3.0-generate-001";

async function testImageGen() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateImages?key=${API_KEY}`;
  
  const payload = {
    prompt: "A beautiful wedding invitation thumbnail for 'Bhanu Pavani & Nivedh', elegant typography, floral background, premium aesthetic",
    number_of_images: 1,
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

testImageGen();
