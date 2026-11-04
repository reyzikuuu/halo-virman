import type { APIRoute } from 'astro';

export const prerender = false;

function getEnv(key: string, cfContext?: { env?: Record<string, string | undefined> }): string | undefined {
  // 1. context.locals.cfContext?.env?.[KEY] (Cloudflare Worker production runtime)
  if (cfContext?.env?.[key]) {
    return cfContext.env[key]?.trim();
  }
  // 2. process.env (Node environment)
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key]?.trim();
  }
  // 3. import.meta.env (Astro build/Vite environment)
  const metaVal = (import.meta.env as Record<string, string | undefined>)?.[key];
  if (metaVal) {
    return metaVal.trim();
  }
  return undefined;
}

async function sendToMetaCAPI(params: {
  pixelId: string;
  accessToken: string;
  eventId: string;
  sourceUrl: string;
  clientIp: string;
  userAgent: string;
  fbc?: string;
  fbp?: string;
  refCode: string;
  testEventCode?: string;
}): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${params.pixelId}/events?access_token=${params.accessToken}`;

  const userData: Record<string, string> = {
    client_ip_address: params.clientIp,
    client_user_agent: params.userAgent,
  };
  if (params.fbc) userData.fbc = params.fbc;
  if (params.fbp) userData.fbp = params.fbp;

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: 'Contact',
        event_time: Math.floor(Date.now() / 1000),
        event_id: params.eventId,
        event_source_url: params.sourceUrl,
        action_source: 'website',
        user_data: userData,
        custom_data: {
          ref_code: params.refCode,
        },
      },
    ],
  };

  if (params.testEventCode) {
    payload.test_event_code = params.testEventCode;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const responseText = await res.text();
  if (!res.ok) {
    console.error('[Meta CAPI Contact] Error response:', responseText);
  } else {
    console.log('[Meta CAPI Contact] Sent successfully:', responseText);
  }
}

async function sendToGoogleSheets(webhookUrl: string, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const responseText = await res.text();
  if (!res.ok) {
    console.error('[Google Sheets Webhook] Error response:', responseText);
  } else {
    console.log('[Google Sheets Webhook] Sent successfully:', responseText);
  }
}

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json().catch(() => ({}));
    const cfContext = (context.locals as {
      cfContext?: {
        env?: Record<string, string | undefined>;
        waitUntil?: (p: Promise<unknown>) => void;
      };
    })?.cfContext;

    const refCode = body.refCode || '';
    const eventId = body.eventId || `contact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fbc = context.cookies.get('_fbc')?.value || body.fbc || undefined;
    const fbp = context.cookies.get('_fbp')?.value || body.fbp || undefined;
    const gclid = context.cookies.get('_gclid')?.value || body.gclid || undefined;
    const sourceUrl = body.sourceUrl || context.request.headers.get('referer') || context.url.href;

    const clientIp =
      context.request.headers.get('cf-connecting-ip') ||
      context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      '127.0.0.1';
    const userAgent = context.request.headers.get('user-agent') || '';

    const pixelId = getEnv('META_PIXEL_ID', cfContext) || '864721303383684';
    const accessToken = getEnv('META_ACCESS_TOKEN', cfContext);
    const googleSheetWebhookUrl = getEnv('GOOGLE_SHEET_WEBHOOK_URL', cfContext);
    const testEventCode = getEnv('META_TEST_EVENT_CODE', cfContext);

    const tasks: Promise<void>[] = [];

    // 1. Kirim event Contact ke Meta CAPI
    if (pixelId && accessToken) {
      tasks.push(
        sendToMetaCAPI({
          pixelId,
          accessToken,
          eventId,
          sourceUrl,
          clientIp,
          userAgent,
          fbc,
          fbp,
          refCode,
          testEventCode,
        }).catch((err) => {
          console.error('[Meta CAPI Contact Exception]', err);
        })
      );
    } else {
      console.warn('[Track Contact] META_ACCESS_TOKEN belum diset di .env');
    }

    // 2. Kirim metadata awal ke Webhook Google Sheets
    if (googleSheetWebhookUrl) {
      tasks.push(
        sendToGoogleSheets(googleSheetWebhookUrl, {
          action: 'contact',
          timestamp: new Date().toISOString(),
          refCode,
          eventId,
          fbc: fbc || '',
          fbp: fbp || '',
          gclid: gclid || '',
          clientIp,
          userAgent,
          sourceUrl,
          status: 'Contact',
        }).catch((err) => {
          console.error('[Google Sheets Webhook Exception]', err);
        })
      );
    }

    // 3. Non-blocking execution di Edge runtime via waitUntil
    const backgroundPromise = Promise.all(tasks).then(() => { });

    if (cfContext && typeof cfContext.waitUntil === 'function') {
      cfContext.waitUntil(backgroundPromise);
    } else {
      // Fallback saat development lokal (Node.js) di mana cfContext tidak ada
      await backgroundPromise;
    }

    return new Response(
      JSON.stringify({
        success: true,
        refCode,
        eventId,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('[Track Contact API Error]', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
