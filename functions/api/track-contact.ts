interface Env {
  META_PIXEL_ID?: string;
  META_ACCESS_TOKEN?: string;
  META_TEST_EVENT_CODE?: string;
  GOOGLE_SHEET_WEBHOOK_URL?: string;
}

function getCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : undefined;
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

export const onRequestPost = async (context: {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}) => {
  try {
    const { request, env, waitUntil } = context;
    const body = (await request.json().catch(() => ({}))) as Record<string, any>;
    const { gclid: bodyGclid, ...rest } = body;
    const cookieHeader = request.headers.get('cookie');

    const refCode = rest.refCode || '';
    const eventId = rest.eventId || `contact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fbc = rest.fbc || getCookie(cookieHeader, '_fbc') || undefined;
    const fbp = rest.fbp || getCookie(cookieHeader, '_fbp') || undefined;
    const sourceUrl = rest.sourceUrl || request.headers.get('referer') || request.url;

    let gclid = bodyGclid || getCookie(cookieHeader, '_gclid') || '';
    if (!gclid && sourceUrl) {
      try {
        const parsedUrl = new URL(sourceUrl, 'https://halovirman.my.id');
        gclid = parsedUrl.searchParams.get('gclid') || '';
      } catch (_) {}
    }
    if (!gclid) {
      try {
        const referer = request.headers.get('referer');
        if (referer) {
          const parsedReferer = new URL(referer);
          gclid = parsedReferer.searchParams.get('gclid') || '';
        }
      } catch (_) {}
    }

    const clientIp =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      '127.0.0.1';
    const userAgent = request.headers.get('user-agent') || '';

    const pixelId = env.META_PIXEL_ID || '864721303383684';
    const accessToken = env.META_ACCESS_TOKEN;
    const googleSheetWebhookUrl = env.GOOGLE_SHEET_WEBHOOK_URL;
    const testEventCode = env.META_TEST_EVENT_CODE;

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
      console.warn('[Track Contact] META_ACCESS_TOKEN belum diset di Cloudflare Pages');
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
    const backgroundPromise = Promise.all(tasks).then(() => {});
    if (typeof waitUntil === 'function') {
      waitUntil(backgroundPromise);
    } else {
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
          'Access-Control-Allow-Origin': '*',
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

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};

