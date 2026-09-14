/**
 * First-party Analytics Loader (Anti Ad-Block + Meta CAPI Compliant)
 *
 * Sesuai rekomendasi Meta:
 * 1. Redundant dual-tracking (Pixel + CAPI)
 * 2. Event deduplication via event_id
 * 3. fbclid capture & _fbc cookie management
 * 4. fbp cookie forwarding
 * 5. Bot-resistant (anti ad-block fallback)
 * 6. client_user_agent dikirim ke CAPI
 *
 * Teknik anti ad-block:
 * 1. Self-hosted script (bukan dari connect.facebook.net langsung)
 * 2. Generic filename & attributes
 * 3. Fallback ke image pixel + CAPI jika script diblokir
 */

(function () {
  'use strict';

  // ============================================================
  // KONFIGURASI
  // ============================================================
  var _pId = '1055596653921923'; // Halo Virman Dataset ID
  var _src = 'https://connect.facebook.net/en_US/fbevents.js';
  var _capiEndpoint = '/api/meta-capi';
  // Jika sudah setup proxy, ganti _src:
  // var _src = '/js/f-events.js';  // Self-hosted
  // var _src = 'https://gtm.halovirman.my.id/fbevents.js'; // Proxy via subdomain
  // ============================================================

  var w = window;
  var d = document;

  // Cek apakah sudah dimuat
  if (w._fpLoaded) return;
  w._fpLoaded = true;

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  /**
   * Generate event ID untuk deduplication (UUID v4)
   */
  function genId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
  }

  /**
   * Mendapatkan cookie by name
   */
  function getCk(name) {
    var match = d.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
  }

  /**
   * Set cookie
   */
  function setCk(name, value, days) {
    var expires = '';
    if (days) {
      var date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      expires = '; expires=' + date.toUTCString();
    }
    d.cookie = name + '=' + value + expires + '; path=/; SameSite=Lax';
  }

  /**
   * Ambil parameter dari URL query string
   */
  function getUrlParam(name) {
    try {
      var url = new URL(w.location.href);
      return url.searchParams.get(name);
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // FBCLID CAPTURE (Rekomendasi Meta)
  // ============================================================

  /**
   * Capture fbclid dari URL dan simpan sebagai _fbc cookie
   * Format _fbc: fb.1.{timestamp}.{fbclid}
   */
  function captureFbclid() {
    var fbclid = getUrlParam('fbclid');
    if (fbclid) {
      var fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      setCk('_fbc', fbc, 90); // Simpan 90 hari
      return { fbclid: fbclid, fbc: fbc };
    }
    return { fbclid: null, fbc: getCk('_fbc') };
  }

  // Capture fbclid saat halaman dimuat
  var fbcData = captureFbclid();

  // ============================================================
  // PIXEL INIT
  // ============================================================

  function initPixel() {
    if (w.fbq) return true;

    var n = w.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!w._fbq) w._fbq = n;
    n.push = n;
    n.loaded = false;
    n.version = '2.0';
    n.queue = [];

    return false;
  }

  // ============================================================
  // SENDING METHODS
  // ============================================================

  /**
   * Load script secara stealth
   */
  function loadScript(src, onLoad, onError) {
    var s = d.createElement('script');
    s.async = true;
    s.defer = true;
    s.src = src;
    s.setAttribute('data-type', 'analytics');
    s.setAttribute('data-purpose', 'measurement');

    s.onload = function () { if (onLoad) onLoad(); };
    s.onerror = function () { if (onError) onError(); };

    var scripts = d.getElementsByTagName('script');
    if (scripts.length > 1) {
      var idx = Math.min(Math.floor(Math.random() * scripts.length), scripts.length - 1);
      scripts[idx].parentNode.insertBefore(s, scripts[idx]);
    } else {
      (d.head || d.documentElement).appendChild(s);
    }
    return s;
  }

  /**
   * Kirim event via Image pixel (fallback)
   */
  function sendViaImage(eventName, params) {
    try {
      var queryParts = [
        'id=' + encodeURIComponent(_pId),
        'ev=' + encodeURIComponent(eventName),
        'dl=' + encodeURIComponent(w.location.href),
        'rl=' + encodeURIComponent(d.referrer || ''),
        'ts=' + Date.now(),
        'cd[noscript]=1'
      ];

      if (params) {
        for (var key in params) {
          if (params.hasOwnProperty(key)) {
            queryParts.push('cd[' + encodeURIComponent(key) + ']=' + encodeURIComponent(params[key]));
          }
        }
      }

      var img = new Image(1, 1);
      img.src = 'https://www.facebook.com/tr?' + queryParts.join('&');
      img.style.display = 'none';

      setTimeout(function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      }, 5000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Kirim event via server-side CAPI endpoint (paling reliable)
   *
   * Data yang dikirim ke server:
   * - eventName, eventId (untuk deduplication)
   * - eventSourceUrl (WAJIB menurut Meta)
   * - fbp, fbc, fbclid (untuk EMQ score tinggi)
   * - customData (value, currency, dll)
   *
   * Server akan menambahkan:
   * - client_ip_address (dari CF-Connecting-IP header)
   * - client_user_agent (dari User-Agent header)
   * - SHA-256 hashing untuk PII
   * - Bot detection
   */
  function sendViaCAPI(eventName, eventId, params, userData) {
    try {
      var payload = {
        eventName: eventName,
        eventId: eventId,
        eventSourceUrl: w.location.href,
        referrer: d.referrer || '',
        fbp: getCk('_fbp'),
        fbc: fbcData.fbc || getCk('_fbc'),
        fbclid: fbcData.fbclid,
        customData: params || {}
      };

      // Check test_event_code from URL or sessionStorage (untuk Meta Test Events)
      var testCode = getUrlParam('test_event_code');
      if (testCode) {
        try { w.sessionStorage.setItem('_meta_test_code', testCode); } catch (e) {}
      } else {
        try { testCode = w.sessionStorage.getItem('_meta_test_code'); } catch (e) {}
      }
      if (testCode) {
        payload.testEventCode = testCode;
      }

      // Tambahkan user data jika ada (email, phone, dll)
      if (userData) {
        payload.userData = userData;
      }

      if (w.fetch) {
        w.fetch(_capiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        }).catch(function () { /* silent fail */ });
      } else {
        // Fallback untuk browser lama: XHR
        try {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', _capiEndpoint, true);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.send(JSON.stringify(payload));
        } catch (e) { /* silent fail */ }
      }
    } catch (e) {
      // Silent fail
    }
  }

  // ============================================================
  // MAIN EXECUTION
  // ============================================================

  var alreadyLoaded = initPixel();
  var pixelBlocked = false;
  var pageViewEventId = genId();

  if (!alreadyLoaded) {
    // Attempt: Load fbevents.js
    loadScript(_src,
      function onSuccess() {
        w.fbq.loaded = true;
        w.fbq('init', _pId);
        w.fbq('track', 'PageView', {}, { eventID: pageViewEventId });

        // SELALU kirim ke CAPI juga (redundant dual-tracking)
        sendViaCAPI('PageView', pageViewEventId);
      },
      function onError() {
        pixelBlocked = true;

        // Fallback 1: Image pixel
        sendViaImage('PageView');

        // Fallback 2: CAPI (paling reliable, tidak bisa diblokir)
        sendViaCAPI('PageView', pageViewEventId);
      }
    );

    // Timeout safety net
    setTimeout(function () {
      if (!w.fbq || !w.fbq.loaded) {
        pixelBlocked = true;
        sendViaCAPI('PageView', pageViewEventId);
      }
    }, 3000);
  }

  // ============================================================
  // PUBLIC API — window._fp
  // ============================================================
  w._fp = {
    /**
     * Track standard event dengan redundant dual-tracking
     *
     * @param {string} eventName - Nama event (PageView, Lead, Contact, dll)
     * @param {object} [params] - Custom data (value, currency, content_name, dll)
     * @param {object} [userData] - User PII data (email, phone — akan di-hash server-side)
     * @returns {string} eventId untuk deduplication
     *
     * @example
     * window._fp.track('Lead', { value: 100000, currency: 'IDR' });
     * window._fp.track('Contact');
     * window._fp.track('ViewContent', { content_name: 'Portfolio' });
     *
     * // Dengan user data (untuk EMQ score tinggi)
     * window._fp.track('Lead',
     *   { value: 100000, currency: 'IDR' },
     *   { email: 'user@example.com', phone: '081234567890' }
     * );
     */
    track: function (eventName, params, userData) {
      var eventId = genId();

      // 1. Client-side Pixel (jika tidak diblokir)
      if (w.fbq && !pixelBlocked) {
        try {
          w.fbq('track', eventName, params || {}, { eventID: eventId });
        } catch (e) {
          pixelBlocked = true;
        }
      }

      // 2. Image pixel fallback
      if (pixelBlocked) {
        sendViaImage(eventName, params);
      }

      // 3. SELALU kirim ke CAPI (server-side) — redundant dual-tracking
      sendViaCAPI(eventName, eventId, params, userData);

      // 4. Push ke GTM dataLayer
      w.dataLayer = w.dataLayer || [];
      w.dataLayer.push({
        event: 'meta_' + eventName.toLowerCase(),
        eventName: eventName,
        eventId: eventId,
        eventParams: params || {}
      });

      return eventId;
    },

    /**
     * Track custom event
     */
    trackCustom: function (eventName, params, userData) {
      var eventId = genId();

      if (w.fbq && !pixelBlocked) {
        try {
          w.fbq('trackCustom', eventName, params || {}, { eventID: eventId });
        } catch (e) {
          pixelBlocked = true;
        }
      }

      if (pixelBlocked) {
        sendViaImage(eventName, params);
      }

      sendViaCAPI(eventName, eventId, params, userData);

      return eventId;
    },

    /**
     * Check apakah pixel sedang diblokir
     */
    isBlocked: function () {
      return pixelBlocked;
    },

    /**
     * Get Meta cookies
     */
    getCookies: function () {
      return {
        fbp: getCk('_fbp'),
        fbc: fbcData.fbc || getCk('_fbc'),
        fbclid: fbcData.fbclid
      };
    }
  };
})();
