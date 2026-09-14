/**
 * Meta Conversions API (CAPI) Helper
 *
 * Konfigurasi:
 * 1. Ganti YOUR_META_PIXEL_ID dengan Pixel ID kamu
 * 2. Ganti YOUR_META_ACCESS_TOKEN dengan Access Token dari Meta Events Manager
 *
 * Cara mendapatkan Access Token:
 * - Buka Meta Events Manager → Settings → Generate Access Token
 *
 * PENTING: File ini dirancang untuk digunakan di server-side (API route / serverless function).
 * JANGAN pernah expose access token di client-side!
 */

// ============================================================
// KONFIGURASI — Ganti nilai di bawah ini
// ============================================================
const META_PIXEL_ID = '1055596653921923';
const META_ACCESS_TOKEN = 'YOUR_META_ACCESS_TOKEN';
const META_API_VERSION = 'v21.0';
// ============================================================

export interface MetaUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  externalId?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbc?: string; // Facebook click ID (dari cookie _fbc)
  fbp?: string; // Facebook browser ID (dari cookie _fbp)
}

export interface MetaCustomData {
  value?: number;
  currency?: string;
  contentName?: string;
  contentCategory?: string;
  contentIds?: string[];
  contentType?: string;
  numItems?: number;
  status?: string;
  [key: string]: unknown;
}

export interface MetaEvent {
  eventName: string;
  eventId?: string;       // Untuk deduplication dengan client-side Pixel
  eventTime?: number;     // Unix timestamp (detik)
  eventSourceUrl?: string;
  actionSource?: 'website' | 'email' | 'app' | 'phone_call' | 'chat' | 'physical_store' | 'system_generated' | 'other';
  userData: MetaUserData;
  customData?: MetaCustomData;
}

/**
 * Hash data menggunakan SHA-256 (diperlukan oleh Meta CAPI)
 */
async function hashData(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Proses dan hash user data sesuai standar Meta
 */
async function processUserData(userData: MetaUserData): Promise<Record<string, unknown>> {
  const processed: Record<string, unknown> = {};

  if (userData.email) processed.em = [await hashData(userData.email)];
  if (userData.phone) processed.ph = [await hashData(userData.phone)];
  if (userData.firstName) processed.fn = [await hashData(userData.firstName)];
  if (userData.lastName) processed.ln = [await hashData(userData.lastName)];
  if (userData.city) processed.ct = [await hashData(userData.city)];
  if (userData.state) processed.st = [await hashData(userData.state)];
  if (userData.zip) processed.zp = [await hashData(userData.zip)];
  if (userData.country) processed.country = [await hashData(userData.country)];
  if (userData.externalId) processed.external_id = [await hashData(userData.externalId)];

  // Tidak perlu di-hash
  if (userData.clientIpAddress) processed.client_ip_address = userData.clientIpAddress;
  if (userData.clientUserAgent) processed.client_user_agent = userData.clientUserAgent;
  if (userData.fbc) processed.fbc = userData.fbc;
  if (userData.fbp) processed.fbp = userData.fbp;

  return processed;
}

/**
 * Proses custom data sesuai format Meta
 */
function processCustomData(customData: MetaCustomData): Record<string, unknown> {
  const processed: Record<string, unknown> = {};

  if (customData.value !== undefined) processed.value = customData.value;
  if (customData.currency) processed.currency = customData.currency;
  if (customData.contentName) processed.content_name = customData.contentName;
  if (customData.contentCategory) processed.content_category = customData.contentCategory;
  if (customData.contentIds) processed.content_ids = customData.contentIds;
  if (customData.contentType) processed.content_type = customData.contentType;
  if (customData.numItems !== undefined) processed.num_items = customData.numItems;
  if (customData.status) processed.status = customData.status;

  // Copy extra fields
  for (const [key, value] of Object.entries(customData)) {
    if (!(key in processed) && !['value', 'currency', 'contentName', 'contentCategory', 'contentIds', 'contentType', 'numItems', 'status'].includes(key)) {
      processed[key] = value;
    }
  }

  return processed;
}

/**
 * Kirim event ke Meta Conversions API
 *
 * @example
 * // Kirim PageView event
 * await sendMetaEvent({
 *   eventName: 'PageView',
 *   eventSourceUrl: 'https://halovirman.my.id',
 *   actionSource: 'website',
 *   userData: {
 *     clientIpAddress: request.headers.get('x-forwarded-for'),
 *     clientUserAgent: request.headers.get('user-agent'),
 *     fbp: getCookie('_fbp'),
 *     fbc: getCookie('_fbc'),
 *   },
 * });
 *
 * // Kirim Lead event
 * await sendMetaEvent({
 *   eventName: 'Lead',
 *   eventId: 'unique-lead-id-123', // Untuk deduplication
 *   eventSourceUrl: 'https://halovirman.my.id/contact',
 *   actionSource: 'website',
 *   userData: {
 *     email: 'user@example.com',
 *     phone: '081234567890',
 *     clientIpAddress: '127.0.0.1',
 *     clientUserAgent: 'Mozilla/5.0...',
 *   },
 *   customData: {
 *     value: 100000,
 *     currency: 'IDR',
 *   },
 * });
 */
export async function sendMetaEvent(event: MetaEvent): Promise<{ success: boolean; response?: unknown; error?: string }> {
  try {
    const processedUserData = await processUserData(event.userData);

    const eventData: Record<string, unknown> = {
      event_name: event.eventName,
      event_time: event.eventTime || Math.floor(Date.now() / 1000),
      action_source: event.actionSource || 'website',
      user_data: processedUserData,
    };

    if (event.eventId) eventData.event_id = event.eventId;
    if (event.eventSourceUrl) eventData.event_source_url = event.eventSourceUrl;
    if (event.customData) eventData.custom_data = processCustomData(event.customData);

    const payload = {
      data: [eventData],
    };

    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[Meta CAPI] Error:', result);
      return { success: false, error: JSON.stringify(result) };
    }

    console.log('[Meta CAPI] Event sent successfully:', event.eventName);
    return { success: true, response: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Meta CAPI] Exception:', message);
    return { success: false, error: message };
  }
}

/**
 * Kirim multiple events sekaligus (batch)
 */
export async function sendMetaEvents(events: MetaEvent[]): Promise<{ success: boolean; response?: unknown; error?: string }> {
  try {
    const processedEvents = await Promise.all(
      events.map(async (event) => {
        const processedUserData = await processUserData(event.userData);

        const eventData: Record<string, unknown> = {
          event_name: event.eventName,
          event_time: event.eventTime || Math.floor(Date.now() / 1000),
          action_source: event.actionSource || 'website',
          user_data: processedUserData,
        };

        if (event.eventId) eventData.event_id = event.eventId;
        if (event.eventSourceUrl) eventData.event_source_url = event.eventSourceUrl;
        if (event.customData) eventData.custom_data = processCustomData(event.customData);

        return eventData;
      })
    );

    const payload = {
      data: processedEvents,
    };

    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[Meta CAPI] Batch Error:', result);
      return { success: false, error: JSON.stringify(result) };
    }

    console.log(`[Meta CAPI] ${events.length} events sent successfully`);
    return { success: true, response: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Meta CAPI] Batch Exception:', message);
    return { success: false, error: message };
  }
}
