/**
 * Shared Photos proxy URL configuration.
 *
 * In development: empty string — Vite proxies /photos → http://localhost:8091
 * In production:  http://localhost:8091 — browser fetches directly from local service
 *
 * fetch() from HTTPS to http://localhost is explicitly allowed by browsers.
 * Avoid using this URL in <img src> or <video src> directly from HTTPS pages
 * (mixed content) — use fetch+blob+objectURL instead.
 */
export const PHOTOS_PROXY_URL = import.meta.env.DEV ? '' : 'http://localhost:8091';

/** Photo browser requires macOS (Photos.sqlite, .photoslibrary, osascript/JXA) */
export const IS_MACOS = typeof navigator !== 'undefined' &&
    (navigator.platform?.startsWith('Mac') || navigator.userAgent?.includes('Macintosh'));
