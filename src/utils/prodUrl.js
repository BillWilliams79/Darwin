// Canonical production origin for Darwin. Used to build absolute links that must
// always resolve against production darwin.one, regardless of which database or
// host the current build is pointed at — notably the dev-server NavBar info panel,
// which runs against the darwin_dev debug DB where requirement rows may not exist
// (req #2757).
export const PROD_BASE_URL = 'https://www.darwin.one';

// Absolute URL to a requirement detail page on production darwin.one.
export function prodRequirementUrl(id) {
    return `${PROD_BASE_URL}/swarm/requirement/${id}`;
}
