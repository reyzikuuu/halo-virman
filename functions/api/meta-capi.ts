/**
 * Cloudflare Pages Function: Meta Conversions API (CAPI) Endpoint
 *
 * File ini berjalan otomatis di Cloudflare Pages sebagai serverless endpoint
 * di URL: /api/meta-capi
 *
 * Keuntungan Cloudflare Pages Functions:
 * 1. Astro tetap 100% static output di dist/index.html (tidak akan error 404!)
 * 2. Environment variables META_ACCESS_TOKEN & META_PIXEL_ID dibaca langsung dari context.env
 * 3. Tidak memerlukan adapter tambahan yang merusak routing static
 */

interface Env {
  META_ACCESS_TOKEN?: string;
  META_PIXEL_ID?: string;
}

interface CAPIRequestBody {
  eventName: string;
  eventId?: string;
  eventSourceUrl?: string;
  referrer?: string;
  fbp?: string | null;
  fbc?: string | null;
  fbclid?: string | null;
  testEventCode?: string | null;
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

const META_API_VERSION = 'v21.0';

/**
 * SHA-256 hash untuk PII (email, phone, etc.)
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
 * Deteksi bot sederhana
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
 * Ambil client IP dari header Cloudflare
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
 */
function buildFbc(fbclid: string): string {
  return `fb.1.${Date.now()}.${fbclid}`;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://halovirman.my.id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Handle OPTIONS preflight
export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

// Handle POST event
export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  try {
    const body: CAPIRequestBody = await request.json();

    if (!body.eventName) {
      return new Response(
        JSON.stringify({ success: false, error: 'eventName is required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const META_PIXEL_ID = env.META_PIXEL_ID || '1055596653921923';
    const META_ACCESS_TOKEN = env.META_ACCESS_TOKEN || '';

    if (!META_ACCESS_TOKEN) {
      console.error('[CAPI] META_ACCESS_TOKEN belum dikonfigurasi di Cloudflare');
      return new Response(
        JSON.stringify({ success: false, error: 'Server configuration incomplete: missing META_ACCESS_TOKEN' }),
        { status: 500, headers: corsHeaders }
      );
    }

    const clientIP = getClientIP(request);
    const clientUserAgent = request.headers.get('user-agent') || '';

    if (isBot(clientUserAgent)) {
      return new Response(
        JSON.stringify({ success: true, filtered: 'bot' }),
        { status: 200, headers: corsHeaders }
      );
    }

    const userData: Record<string, unknown> = {
      client_ip_address: clientIP,
      client_user_agent: clientUserAgent,
    };

    if (body.fbp) userData.fbp = body.fbp;

    if (body.fbclid) {
      userData.fbc = buildFbc(body.fbclid);
    } else if (body.fbc) {
      userData.fbc = body.fbc;
    }

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

    const eventPayload: Record<string, unknown> = {
      event_name: body.eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: body.eventSourceUrl || request.headers.get('referer') || 'https://halovirman.my.id',
      user_data: userData,
    };

    if (body.eventId) {
      eventPayload.event_id = body.eventId;
    }

    if (body.customData && Object.keys(body.customData).length > 0) {
      eventPayload.custom_data = body.customData;
    }

    const capiUrl = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

    const requestPayload: Record<string, unknown> = {
      data: [eventPayload],
    };

    const testEventCode = body.testEventCode || (env as any).META_TEST_EVENT_CODE;
    if (testEventCode) {
      requestPayload.test_event_code = testEventCode;
    }

    const metaResponse = await fetch(capiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    const metaResult = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error('[CAPI] Meta API error:', metaResult);
      return new Response(
        JSON.stringify({ success: false, error: metaResult }),
        { status: 502, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        events_received: (metaResult as any).events_received,
        fbtrace_id: (metaResult as any).fbtrace_id,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('[CAPI] Internal error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: corsHeaders }
    );
  }
};
