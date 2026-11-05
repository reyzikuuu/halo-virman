export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
}) {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // 1. Lewati file statis & aset CDN agar tidak mengganggu caching Cloudflare
  if (
    pathname.startsWith('/_astro/') ||
    pathname.startsWith('/favicon/') ||
    pathname.startsWith('/api/') ||
    /\.(css|js|png|jpg|jpeg|webp|svg|ico|woff2?|glb|txt|xml|mp4|webm)$/i.test(pathname)
  ) {
    return context.next();
  }

  // 2. Lanjutkan pemrosesan request halaman HTML
  const response = await context.next();

  const fbclid = url.searchParams.get('fbclid');
  const gclid = url.searchParams.get('gclid');
  const cookieOptions = 'Path=/; Max-Age=7776000; SameSite=Lax; Secure';
  const now = Date.now();

  const clonedResponse = new Response(response.body, response);

  // Set-Cookie _fbc jika pengunjung membawa parameter fbclid dari Meta Ads
  if (fbclid) {
    const fbcValue = `fb.1.${now}.${fbclid}`;
    clonedResponse.headers.append('Set-Cookie', `_fbc=${fbcValue}; ${cookieOptions}`);
  }

  // Set-Cookie _gclid jika pengunjung membawa parameter gclid dari Google Ads
  if (gclid) {
    clonedResponse.headers.append('Set-Cookie', `_gclid=${gclid}; ${cookieOptions}`);
  }

  // Set-Cookie _fbp jika belum ada di browser pengunjung
  const cookieHeader = context.request.headers.get('cookie') || '';
  if (!cookieHeader.includes('_fbp=')) {
    const randomInt = Math.floor(1000000000 + Math.random() * 9000000000);
    const fbpValue = `fb.1.${now}.${randomInt}`;
    clonedResponse.headers.append('Set-Cookie', `_fbp=${fbpValue}; ${cookieOptions}`);
  }

  return clonedResponse;
}
