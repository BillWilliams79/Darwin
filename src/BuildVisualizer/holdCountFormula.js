// Hold-to-count quantity formula (req #2737, #2741).
//
// Extracted from HoldCountButton for testability. The component's animation
// tick calls this on every frame to map elapsed time → discrete count.
//
// Quick click (elapsed < startDelayMs) → 1
// Hold       → count = min(maxQty, 2 + floor((elapsed - startDelayMs) / dwellMs))

/**
 * @param {number} elapsed     — ms since mousedown
 * @param {number} startDelayMs — hold threshold before count leaves 1
 * @param {number} dwellMs      — ms per subsequent count step
 * @param {number} maxQty       — ceiling
 * @returns {number}            — the discrete count (1..maxQty)
 */
export function holdCount(elapsed, startDelayMs, dwellMs, maxQty) {
    if (elapsed < startDelayMs) return 1;
    const held = elapsed - startDelayMs;
    return Math.min(maxQty, 2 + Math.floor(held / dwellMs));
}
