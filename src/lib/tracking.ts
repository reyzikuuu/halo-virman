/**
 * Client-side Tracking Utility (Anti Ad-Block)
 *
 * Menggunakan window._fp dari fp-analytics.js sebagai primary,
 * dengan fallback ke fbq standard jika tersedia.
 *
 * Semua events otomatis dikirim ke:
 * 1. Meta Pixel (client-side, jika tidak diblokir)
 * 2. Image Pixel fallback (jika script diblokir)
 * 3. Server-side CAPI (selalu dikirim, untuk reliability)
 * 4. GTM dataLayer
 */

declare global {
  interface Window {
    _fp?: {
      track: (eventName: string, params?: Record<string, unknown>) => string;
      trackCustom: (eventName: string, params?: Record<string, unknown>) => string;
      isBlocked: () => boolean;
      getCookies: () => { fbp: string | null; fbc: string | null };
    };
    fbq?: (...args: unknown[]) => void;
    dataLayer?: Record<string, unknown>[];
  }
}

/**
 * Track event menggunakan first-party analytics (anti ad-block)
 *
 * @example
 * // Track PageView
 * trackEvent('PageView');
 *
 * // Track Lead dengan custom data
 * trackEvent('Lead', {
 *   value: 100000,
 *   currency: 'IDR',
 *   content_name: 'Contact Form',
 * });
 *
 * // Track ViewContent
 * trackEvent('ViewContent', {
 *   content_name: 'Video Editing Portfolio',
 *   content_category: 'Portfolio',
 * });
 */
export function trackEvent(eventName: string, customData?: Record<string, unknown>): string | null {
  if (typeof window === 'undefined') return null;

  // Gunakan _fp (anti ad-block) jika tersedia
  if (window._fp) {
    return window._fp.track(eventName, customData);
  }

  // Fallback ke fbq standard
  if (window.fbq) {
    const eventId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.fbq('track', eventName, customData || {}, { eventID: eventId });
    return eventId;
  }

  console.warn('[Tracking] No tracking method available');
  return null;
}

/**
 * Track custom event (event yang kamu definisikan sendiri)
 */
export function trackCustomEvent(eventName: string, customData?: Record<string, unknown>): string | null {
  if (typeof window === 'undefined') return null;

  if (window._fp) {
    return window._fp.trackCustom(eventName, customData);
  }

  if (window.fbq) {
    const eventId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.fbq('trackCustom', eventName, customData || {}, { eventID: eventId });
    return eventId;
  }

  return null;
}

/**
 * Cek apakah pixel sedang diblokir ad blocker
 */
export function isPixelBlocked(): boolean {
  if (typeof window === 'undefined') return false;
  return window._fp?.isBlocked() ?? true;
}

/**
 * Mendapatkan cookie _fbp dan _fbc dari browser
 */
export function getMetaCookies(): { fbp: string | null; fbc: string | null } {
  if (typeof window === 'undefined') return { fbp: null, fbc: null };

  if (window._fp) {
    return window._fp.getCookies();
  }

  const cookies = document.cookie.split(';').reduce<Record<string, string>>((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) acc[key] = value;
    return acc;
  }, {});

  return {
    fbp: cookies['_fbp'] || null,
    fbc: cookies['_fbc'] || null,
  };
}

/**
 * Push data ke GTM dataLayer
 */
export function pushToDataLayer(data: Record<string, unknown>): void {
  if (typeof window !== 'undefined') {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(data);
  }
}

/**
 * Standard Meta Pixel Events — shortcut functions
 */
export const MetaEvents = {
  pageView: (data?: Record<string, unknown>) =>
    trackEvent('PageView', data),

  viewContent: (data: { content_name?: string; content_category?: string; content_ids?: string[]; content_type?: string; value?: number; currency?: string }) =>
    trackEvent('ViewContent', data),

  search: (data: { search_string?: string; content_category?: string }) =>
    trackEvent('Search', data),

  addToWishlist: (data?: Record<string, unknown>) =>
    trackEvent('AddToWishlist', data),

  initiateCheckout: (data?: { value?: number; currency?: string; num_items?: number }) =>
    trackEvent('InitiateCheckout', data),

  lead: (data?: { value?: number; currency?: string; content_name?: string }) =>
    trackEvent('Lead', data),

  completeRegistration: (data?: { value?: number; currency?: string; content_name?: string; status?: string }) =>
    trackEvent('CompleteRegistration', data),

  contact: () =>
    trackEvent('Contact'),

  schedule: (data?: Record<string, unknown>) =>
    trackEvent('Schedule', data),
} as const;
