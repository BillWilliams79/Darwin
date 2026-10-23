// planCaretPoint.js — where the caret goes when a long press opens an in-place
// editor on the Plan visualizer (req #3665 review).
//
// User: "Clicking and hold into a text box should not select all the text but
// rather insert the cursor blinking at the point clicked." A press opens the
// editor over the very text that was pressed, so the press point names a place
// in that text; the caret goes there, exactly as a click into a text field
// places it. An editor opened from the KEYS (F2) has no point and keeps the
// select-all a keyboard rename expects.
//
// Two kinds of editor, two ways to find the place:
//   a one-line <input> (step and initiative names) — the browser exposes no position
//     inside an input's text, so the prefixes of its value are measured in the
//     input's own font and the nearest boundary wins (`nearestCaretOffset`);
//   the requirement title, a contenteditable — the browser answers directly
//     (`caretPositionFromPoint` / `caretRangeFromPoint`).

/**
 * The caret offset nearest `x`, given the width of every prefix of the text.
 * `prefixWidths[k]` is the width of the first k characters (so [0] is 0 and
 * the array is one longer than the text); `x` is measured from the text's
 * start. Ties go to the earlier offset; points before the text or past its end
 * clamp to 0 and to the end.
 *
 * @param {number[]} prefixWidths
 * @param {number} x
 * @returns {number}
 */
export function nearestCaretOffset(prefixWidths, x) {
    if (!Array.isArray(prefixWidths) || !prefixWidths.length || !Number.isFinite(x)) return 0;
    let best = 0;
    for (let k = 1; k < prefixWidths.length; k++) {
        if (Math.abs(prefixWidths[k] - x) < Math.abs(prefixWidths[best] - x)) best = k;
    }
    return best;
}

let measureCtx = null;
const measure = () => {
    if (measureCtx === null) {
        try {
            measureCtx = document.createElement('canvas').getContext('2d') || false;
        } catch {
            measureCtx = false;
        }
    }
    return measureCtx || null;
};

/**
 * The caret offset in an <input>'s value under a client point, or null when
 * it cannot be measured (no canvas, no layout).
 *
 * @param {HTMLInputElement} input
 * @param {{x: number, y: number}} at  client px
 */
export function inputCaretAt(input, at) {
    const ctx = measure();
    if (!ctx || !input || !at) return null;
    const cs = getComputedStyle(input);
    ctx.font = cs.font || `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const rect = input.getBoundingClientRect();
    if (!rect.width) return null;
    const x = at.x - rect.left - (parseFloat(cs.borderLeftWidth) || 0)
        - (parseFloat(cs.paddingLeft) || 0) + (input.scrollLeft || 0);
    const { value } = input;
    const widths = [0];
    for (let k = 1; k <= value.length; k++) widths.push(ctx.measureText(value.slice(0, k)).width);
    return nearestCaretOffset(widths, x);
}

/**
 * The DOM position under a client point, as `[node, offset]`, or null.
 *
 * @param {{x: number, y: number}} at  client px
 */
export function domCaretAt(at) {
    if (!at || typeof document === 'undefined') return null;
    if (typeof document.caretPositionFromPoint === 'function') {
        const p = document.caretPositionFromPoint(at.x, at.y);
        return p ? [p.offsetNode, p.offset] : null;
    }
    if (typeof document.caretRangeFromPoint === 'function') {
        const r = document.caretRangeFromPoint(at.x, at.y);
        return r ? [r.startContainer, r.startOffset] : null;
    }
    return null;
}
