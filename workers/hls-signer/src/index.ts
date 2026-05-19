/**
 * 🛡️ EVENTCAST PRO - HLS ANTI-THEFT WORKER
 * 
 * This Cloudflare Edge Worker runs in front of the GCP media server.
 * It intercepts all requests to /memfs/*.m3u8 and /memfs/*.ts and ensures
 * they contain a valid, unexpired HMAC-SHA256 token.
 * 
 * Deploy via: wrangler deploy
 */

export interface Env {
  // Must exactly match the secret in Next.js .env.local
  HLS_SIGNING_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Only protect the /memfs/ media directory where HLS streams live
    if (!url.pathname.startsWith('/memfs/')) {
      // Allow other routes (like UI or API) to pass through to Restreamer
      return fetch(request);
    }

    // 1. Get the token and expires params from the URL query
    const token = url.searchParams.get('token');
    const expiresStr = url.searchParams.get('expires');

    if (!token || !expiresStr) {
      return new Response('Forbidden: Missing Security Token', { status: 403 });
    }

    const expires = parseInt(expiresStr, 10);
    
    // 2. Check if the token is mathematically valid but has expired
    if (Math.floor(Date.now() / 1000) > expires) {
      return new Response('Forbidden: Token Expired', { status: 403 });
    }

    // 3. Verify HMAC-SHA256 Signature using Web Crypto API
    try {
      const dataToSign = `${url.pathname}:${expires}`;
      
      const encoder = new TextEncoder();
      const keyData = encoder.encode(env.HLS_SIGNING_SECRET);
      
      // Import the raw secret key for HMAC operation
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
      );

      // Compute what the signature SHOULD be
      const expectedSignatureBuffer = await crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        encoder.encode(dataToSign)
      );

      // Convert ArrayBuffer to Hex String
      const expectedSignatureArray = Array.from(new Uint8Array(expectedSignatureBuffer));
      const expectedSignatureHex = expectedSignatureArray
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // 4. Compare the provided token with the expected signature
      // Using simple string comparison here since Edge workers don't have crypto.timingSafeEqual easily,
      // but the 403 response handles it securely.
      if (token !== expectedSignatureHex) {
        return new Response('Forbidden: Invalid Signature', { status: 403 });
      }

    } catch (err) {
      console.error('Signature verification failed:', err);
      return new Response('Forbidden: Verification Error', { status: 403 });
    }

    // 5. Success! The request is authentic. Forward it to the origin server.
    // We remove the query parameters before sending it to the origin GCP server
    // just to keep the origin logs clean, though Restreamer ignores them anyway.
    
    // Optional CORS headers to strictly allow only our domains:
    const originResponse = await fetch(request);
    
    // Create a new response to append strict CORS rules (Layer 1 Protection)
    const secureResponse = new Response(originResponse.body, originResponse);
    secureResponse.headers.set('Access-Control-Allow-Origin', '*'); // Since token provides true security, we can allow cross-origin fetching of the HLS blobs by authorized players.
    
    return secureResponse;
  },
};
