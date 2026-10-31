// Canonical production origin for this product. Used to build absolute links that must
// always resolve against production, regardless of which database or host the
// current build is pointed at — notably the dev-server NavBar Action Popup, which
// runs against the darwin_dev debug DB where requirement rows may not exist
// (req #2757). req #4076: the origin is the product config's (config/product.js):
// darwin.one by default; '' for a product with no separate production site (the
// internal build), which makes the link same-origin.
import { PROD_BASE_URL } from '../config/product';

export { PROD_BASE_URL };

/** The production host as a reader sees it (`darwin.one`), or '' when same-origin. */
export const PROD_HOST = PROD_BASE_URL.replace(/^https?:\/\/(www\.)?/, '');

// Absolute URL to a requirement detail page on production.
export function prodRequirementUrl(id) {
    return `${PROD_BASE_URL}/swarm/requirement/${id}`;
}
