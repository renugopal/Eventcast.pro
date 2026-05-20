
async function testLiveApi() {
  console.log("📡 Sending perfectly formatted diagnostic request to Cloudflare Live API...");
  try {
    const res = await fetch('https://eventcast-admin.pages.dev/api/ai/sales-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'hi' }
        ]
      })
    });

    const data = await res.json();
    console.log("📬 Live API Diagnostic Response:\n", JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("❌ Diagnostic Script Failed:", error);
  }
}

testLiveApi();
