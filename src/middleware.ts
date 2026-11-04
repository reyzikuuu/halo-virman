import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware((context, next) => {
  const url = new URL(context.request.url);
  const fbclid = url.searchParams.get('fbclid');

  const cookieOptions = {
    path: '/',
    maxAge: 7776000, // 90 days in seconds (90 * 24 * 60 * 60)
    secure: true,
    sameSite: 'lax' as const,
    httpOnly: false,
  };

  const now = Date.now();

  // 1. Intersep request URL: jika parameter fbclid ditemukan, buat cookie _fbc
  if (fbclid) {
    const fbcValue = `fb.1.${now}.${fbclid}`;
    context.cookies.set('_fbc', fbcValue, cookieOptions);
  }

  // 2. Jika cookie _fbp belum ada, buat cookie _fbp
  const existingFbp = context.cookies.get('_fbp')?.value;
  if (!existingFbp) {
    const randomInt = Math.floor(1000000000 + Math.random() * 9000000000);
    const fbpValue = `fb.1.${now}.${randomInt}`;
    context.cookies.set('_fbp', fbpValue, cookieOptions);
  }

  return next();
});

