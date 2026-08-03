// PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0 authorization code flow.
// Uses Web Crypto API — no external dependencies.
//
// Only `getAndClearCodeVerifier` has a caller — `LoggedIn/LoggedIn.jsx`, the kept-but-unverified
// `/loggedin` callback (req #3291). The three generator functions were used by `LoginLink`, which
// initiated the authorization redirect and was deleted with the rest of the dead Hosted-UI path.
// They are kept as the matching half of a flow that would have to be restored as a unit if the
// callback ever needs a live initiator again.

const VERIFIER_LENGTH = 128;
const STORAGE_KEY = 'pkce_code_verifier';

// Characters allowed in code_verifier per RFC 7636
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export function generateCodeVerifier() {
    const array = new Uint8Array(VERIFIER_LENGTH);
    crypto.getRandomValues(array);
    return Array.from(array, byte => CHARSET[byte % CHARSET.length]).join('');
}

export async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    // base64url encode (no padding)
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export function storeCodeVerifier(verifier) {
    sessionStorage.setItem(STORAGE_KEY, verifier);
}

export function getAndClearCodeVerifier() {
    const verifier = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    return verifier;
}
