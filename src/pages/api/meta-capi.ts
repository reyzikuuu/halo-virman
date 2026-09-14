/**
 * Meta Conversions API (CAPI) — Server-Side Endpoint
 *
 * Endpoint ini berjalan di Cloudflare Workers (server-side).
 * Menerima events dari client dan meneruskan ke Meta Graph API.
 *
 * Sesuai rekomendasi Meta:
 * - Mengirim event_name, event_time, event_id (deduplication)
 * - Mengirim client_ip_address dan client_user_agent (WAJIB untuk website events)
 * - Mengirim event_source_url (WAJIB untuk website events)
 * - Mengirim fbp, fbc untuk EMQ score tinggi
 * - SHA-256 hashing untuk PII (email, phone, dll)
 * - Bot detection sederhana
 *
 * Environment Variables yang perlu di-set di Cloudflare:
 * - META_PIXEL_ID: Pixel ID dari Meta Events Manager
 * - META_ACCESS_TOKEN: Access Token dari Meta Events Manager
 */

import type { APIRoute } from 'astro';

// ============================================================
// TYPES
// ============================================================

interface CAPIRequestBody {
  eventName: string;
  eventId?: string;
  eventSourceUrl?: string;
  referrer?: string;
  fbp?: string | null;
  fbc?: string | null;
  fbclid?: string | null;
  customData?: Record<string, unknown>;
  userData?: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    externalId?: string;
  };
}

// ============================================================
// HELPERS
// ============================================================

const META_API_VERSION = 'v21.0';

/**
 * SHA-256 hash (diperlukan oleh Meta CAPI untuk PII)
 */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Deteksi bot sederhana berdasarkan user-agent
 */
function isBot(userAgent: string): boolean {
  if (!userAgent) return true;
  const botPatterns = [
    /bot/i, /crawler/i, /spider/i, /crawling/i,
    /headless/i, /phantomjs/i, /selenium/i,
    /puppeteer/i, /playwright/i,
    /googlebot/i, /bingbot/i, /yandexbot/i, /baiduspider/i,
    /facebookexternalhit/i, /twitterbot/i,
    /slurp/i, /duckduckbot/i,
    /curl/i, /wget/i, /httpie/i,
    /python-requests/i, /axios/i, /node-fetch/i,
    /lighthouse/i, /pagespeed/i,
  ];
  return botPatterns.some(pattern => pattern.test(userAgent));
}

/**
 * Ambil IP address dari request headers (Cloudflare)
 */
function getClientIP(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

/**
 * Buat _fbc cookie value dari fbclid
 * Format: fb.1.{timestamp}.{fbclid}
 */
function buildFbc(fbclid: string): string {
  return `fb.1.${Date.now()}.${fbclid}`;
}

// ============================================================
// API ENDPOINT
// ============================================================

export const prerender = false; // Server-side only

export const POST: APIRoute = async ({ request, locals }) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://halovirman.my.id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    // Parse body
    const body: CAPIRequestBody = await request.json();

    // Validasi required fields
    if (!body.eventName) {
      return new Response(
        JSON.stringify({ success: false, error: 'eventName is required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Ambil environment variables (support Cloudflare Workers runtime env, Astro .env, dan process.env)
    const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.cloudflare?.env || (locals as any)?.env || {};
    const META_PIXEL_ID = runtimeEnv.META_PIXEL_ID || import.meta.env.META_PIXEL_ID || '1055596653921923';
    const META_ACCESS_TOKEN =
      runtimeEnv.META_ACCESS_TOKEN ||
      import.meta.env.META_ACCESS_TOKEN ||
      (typeof process !== 'undefined' && process.env ? process.env.META_ACCESS_TOKEN : '') ||
      '';

    if (!META_ACCESS_TOKEN || META_ACCESS_TOKEN === 'YOUR_META_ACCESS_TOKEN') {
      console.error('[CAPI] META_ACCESS_TOKEN belum dikonfigurasi');
      return new Response(
        JSON.stringify({ success: false, error: 'Server configuration incomplete: missing META_ACCESS_TOKEN' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Ambil data dari request headers (WAJIB menurut Meta)
    const clientIP = getClientIP(request);
    const clientUserAgent = request.headers.get('user-agent') || '';

    // Bot detection — jangan kirim bot traffic ke Meta
    if (isBot(clientUserAgent)) {
      return new Response(
        JSON.stringify({ success: true, filtered: 'bot' }),
        { status: 200, headers: corsHeaders }
      );
    }

    // ============================================================
    // Build user_data sesuai standar Meta
    // ============================================================
    const userData: Record<string, unknown> = {
      // WAJIB untuk website events (tidak di-hash)
      client_ip_address: clientIP,
      client_user_agent: clientUserAgent,
    };

    // Facebook cookies (tidak di-hash, sangat penting untuk EMQ)
    if (body.fbp) userData.fbp = body.fbp;

    // fbc: prioritas fbclid > cookie _fbc
    if (body.fbclid) {
      userData.fbc = buildFbc(body.fbclid);
    } else if (body.fbc) {
      userData.fbc = body.fbc;
    }

    // Hash PII jika tersedia
    if (body.userData) {
      if (body.userData.email) userData.em = [await sha256(body.userData.email)];
      if (body.userData.phone) userData.ph = [await sha256(body.userData.phone)];
      if (body.userData.firstName) userData.fn = [await sha256(body.userData.firstName)];
      if (body.userData.lastName) userData.ln = [await sha256(body.userData.lastName)];
      if (body.userData.city) userData.ct = [await sha256(body.userData.city)];
      if (body.userData.state) userData.st = [await sha256(body.userData.state)];
      if (body.userData.zip) userData.zp = [await sha256(body.userData.zip)];
      if (body.userData.country) userData.country = [await sha256(body.userData.country)];
      if (body.userData.externalId) userData.external_id = [await sha256(body.userData.externalId)];
    }

    // ============================================================
    // Build event data sesuai standar Meta
    // ============================================================
    const eventData: Record<string, unknown> = {
      event_name: body.eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: userData,
    };

    // Event ID untuk deduplication (WAJIB)
    if (body.eventId) eventData.event_id = body.eventId;

    // Event source URL (WAJIB untuk website events)
    if (body.eventSourceUrl) eventData.event_source_url = body.eventSourceUrl;

    // Custom data (value, currency, content_name, dll)
    if (body.customData && Object.keys(body.customData).length > 0) {
      eventData.custom_data = body.customData;
    }

    // ============================================================
    // Kirim ke Meta Graph API
    // ============================================================
    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

    const metaResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [eventData] }),
    });

    const result = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error('[CAPI] Meta API error:', JSON.stringify(result));
      return new Response(
        JSON.stringify({ success: false, error: 'Meta API error', detail: result }),
        { status: 502, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ success: true, events_received: (result as any).events_received }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CAPI] Exception:', message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: corsHeaders }
    );
  }
};

// Handle CORS preflight
export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://halovirman.my.id',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
};
