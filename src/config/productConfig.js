// productConfig.js — resolve THE product configuration from a Vite env (req #4076).
//
// One build, two products. The default (darwin.one) build and the internal
// build (`vite build --mode internal`, Darwin/.env.internal) differ ONLY in the
// values this function returns. Every user-visible name, the API base, the
// database path segments, the auth mode and the application scope come from
// here — nothing else in `src/` names a product, a host or a database.
//
// Pure (no `import.meta`, no DOM): `vite.config.js` calls it at config time and
// injects the result as the `__PRODUCT__` define, so every field is a BUILD-TIME
// CONSTANT. That is the point of the shape — Rollup folds
// `if (__PRODUCT__.apps.maps)` and `__PRODUCT__.authMode === 'proxy'`, so the
// internal bundle does not merely hide Tasks, Maps and the Cognito login: it
// does not contain them. A runtime `scope.includes('maps')` does not fold
// (measured, req #4076), which is why the scope arrives here as booleans.
//
// Defaults are today's darwin.one values verbatim; an env that sets nothing
// gets darwin.one. Design record: memory/enterprise-internal-hosting.md.

export const APP_KEYS = ['tasks', 'maps', 'systems', 'swarm', 'swarm-validate'];
export const AUTH_MODES = ['cognito', 'proxy'];
// Where Roboto comes from: Google Fonts (darwin.one, unchanged) or the
// @fontsource/roboto files bundled into the build (internal: no outside host).
export const FONT_SOURCES = ['google', 'local'];

// darwin.one's values, verbatim from before req #4076.
export const DEFAULTS = Object.freeze({
    productName: 'Darwin',
    productTagline: 'Task Management',
    apiBase: 'https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng',
    opsDatabase: 'darwin',
    buildVizDatabase: 'darwin_dev',
    prodBaseUrl: 'https://www.darwin.one',
});

// `none` disables a database segment outright (internal has no build-viz
// database): its URI is null and every consumer is out of scope anyway.
const NONE = 'none';

function parseAppScope(raw) {
    const named = String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const unknown = named.filter(k => !APP_KEYS.includes(k));
    if (unknown.length) {
        throw new Error(`VITE_APP_SCOPE names unknown application(s): ${unknown.join(', ')} `
            + `(known: ${APP_KEYS.join(', ')})`);
    }
    const all = named.length === 0;
    return {
        // Every application — darwin.one. A scoped product sets this false and
        // lists what it carries; the profile toggles still apply inside it.
        all,
        list: all ? null : APP_KEYS.filter(k => named.includes(k)),
        ...Object.fromEntries(APP_KEYS.map(k => [k, all || named.includes(k)])),
    };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

export function resolveProductConfig(env = {}) {
    const authMode = str(env.VITE_AUTH_MODE) || 'cognito';
    if (!AUTH_MODES.includes(authMode)) {
        throw new Error(`VITE_AUTH_MODE must be one of ${AUTH_MODES.join(' | ')}, got '${authMode}'`);
    }
    const apps = parseAppScope(env.VITE_APP_SCOPE);
    const fontSource = str(env.VITE_FONT_SOURCE) || 'google';
    if (!FONT_SOURCES.includes(fontSource)) {
        throw new Error(`VITE_FONT_SOURCE must be one of ${FONT_SOURCES.join(' | ')}, got '${fontSource}'`);
    }
    // `/api` and `https://host/eng/` both mean the same base; no trailing slash.
    const apiBase = (str(env.VITE_API_BASE) || DEFAULTS.apiBase).replace(/\/+$/, '');
    const db = (v, fallback) => {
        const s = str(v) || fallback;
        return s === NONE ? null : s;
    };
    // An explicitly empty VITE_PROD_BASE_URL means "this product has no
    // separate production site" (internal: a requirement link is same-origin).
    const prodBaseUrl = env.VITE_PROD_BASE_URL === undefined
        ? DEFAULTS.prodBaseUrl : str(env.VITE_PROD_BASE_URL).replace(/\/+$/, '');

    // The app reads the configured user-data database through AppContext's
    // existing truth table (req #2683); only an explicit value is carried here.
    return {
        productName: str(env.VITE_PRODUCT_NAME) || DEFAULTS.productName,
        productTagline: env.VITE_PRODUCT_TAGLINE === undefined
            ? DEFAULTS.productTagline : str(env.VITE_PRODUCT_TAGLINE),
        apiBase,
        opsDatabase: db(env.VITE_OPS_DATABASE, DEFAULTS.opsDatabase),
        buildVizDatabase: db(env.VITE_BUILDVIZ_DATABASE, DEFAULTS.buildVizDatabase),
        authMode,
        apps,
        prodBaseUrl,
        fontSource,
    };
}

// The flat build-time constants (req #4076). `__PRODUCT__` carries the whole
// config, but Rollup does not fold a NESTED read (`__PRODUCT__.apps.tasks`) —
// measured: the internal bundle kept every Tasks and Maps route behind an
// unfolded `HAS_TASKS &&`. A gate therefore reads one of these, each replaced
// by a bare `true`/`false` literal, which always folds.
export const APP_FLAG = Object.freeze(Object.fromEntries(
    ['all', ...APP_KEYS].map(k => [k, `__APP_${k.replace(/-/g, '_').toUpperCase()}__`])));

export function productDefines(product) {
    return {
        __PRODUCT__: JSON.stringify(product),
        __PROXY_AUTH__: JSON.stringify(product.authMode === 'proxy'),
        __LOCAL_FONTS__: JSON.stringify(product.fontSource === 'local'),
        ...Object.fromEntries(Object.entries(APP_FLAG).map(
            ([k, id]) => [id, JSON.stringify(!!product.apps[k])])),
    };
}
