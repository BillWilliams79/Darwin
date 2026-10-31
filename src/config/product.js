// product.js — THE product configuration, as the app reads it (req #4076).
//
// `__PRODUCT__` is injected by vite.config.js from `resolveProductConfig()`
// (./productConfig.js) over the build's Vite env — for `vite`, `vite build` and
// vitest alike, which reads the same config — so every value below is a
// build-time constant and every `if` on one folds. This module deliberately
// does NOT import productConfig.js: its darwin.one defaults would then ship in
// the internal bundle. A test that needs another product mocks this module.
//
// Rename the product: change VITE_PRODUCT_NAME in the build's .env file. Never
// rename code identifiers (`darwinUri`, …) — see
// memory/enterprise-internal-hosting.md § Naming.

/* global __PRODUCT__, __PROXY_AUTH__, __APP_ALL__, __APP_TASKS__, __APP_MAPS__,
          __APP_SYSTEMS__, __APP_SWARM__, __APP_SWARM_VALIDATE__ */
export const PRODUCT = __PRODUCT__;

export const PRODUCT_NAME = PRODUCT.productName;
export const PRODUCT_TAGLINE = PRODUCT.productTagline;
export const API_BASE = PRODUCT.apiBase;
export const AUTH_MODE = PRODUCT.authMode;
/** Absolute origin of this product's production site; '' = same origin. */
export const PROD_BASE_URL = PRODUCT.prodBaseUrl;

// The gates. Each is a bare boolean literal after `define` (productDefines in
// ./productConfig.js), so `if (HAS_MAPS)` folds and the code behind a false
// one leaves the bundle.
/** `proxy`: the server authenticates (nginx) — no login screen, no token. */
export const PROXY_AUTH = __PROXY_AUTH__;
/** The product's application scope: `.all` (darwin.one) or one boolean per app key. */
export const APP_SCOPE = Object.freeze({
    all: __APP_ALL__,
    tasks: __APP_TASKS__,
    maps: __APP_MAPS__,
    systems: __APP_SYSTEMS__,
    swarm: __APP_SWARM__,
    'swarm-validate': __APP_SWARM_VALIDATE__,
});
export const SCOPE_ALL = __APP_ALL__;
export const HAS_TASKS = __APP_TASKS__;
export const HAS_MAPS = __APP_MAPS__;
export const HAS_SYSTEMS = __APP_SYSTEMS__;
export const HAS_SWARM = __APP_SWARM__;
export const HAS_SWARM_VALIDATE = __APP_SWARM_VALIDATE__;
