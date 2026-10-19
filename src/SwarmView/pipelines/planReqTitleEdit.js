// planReqTitleEdit.js — the requirement title's in-place edit on the Plan
// visualizer (req #3661): where its editor sits, and the one write it makes.
//
// The geometry is its own pure function so it can be pinned without a canvas:
// the visualizer imports Konva, which a jsdom test cannot draw.

import call_rest_api from '../../RestApi/RestApi';
import { wrapReqText, reqHangChars, CARD_SEP_CHARS } from './pipelinePlanLayout';

/**
 * PUT one requirement's title — the same gateway write the requirement page's
 * own title field makes (`RequirementDetail.jsx` `saveField`).
 */
export async function updateRequirementTitle(darwinUri, idToken, id, title) {
    const r = await call_rest_api(`${darwinUri}/requirements`, 'PUT',
        [{ id, title }], idToken);
    const status = r?.httpStatus?.httpStatus;
    if (status !== 200 && status !== 204) {
        const error = new Error(`updateRequirement failed: HTTP ${status} `
            + `${r?.httpStatus?.httpMessage || 'unknown'}`);
        error.httpStatus = r?.httpStatus;
        throw error;
    }
    return r.data;
}

// ── THE EDITOR'S LINES ARE THE LAYOUT'S LINES ─────────────────────────────
// The editor does not let the browser wrap. Measured in Chromium against
// `wrapReqText` over 1,500 generated titles, browser wrapping disagreed on 573:
// it breaks after a hyphen (`--dangerously-` / `skip-permissions`), and it
// splits a long first word beside the line-1 indent where the layout moves the
// whole word down. No CSS turns either off. So the editor draws the very lines
// `wrapReqText` produces — one text run per line, joined by explicit breaks —
// and the reader sees, while typing, the lines the row will be drawn on.

/**
 * Where each drawn line of a requirement row's title begins, as offsets into
 * the TITLE. Line `i` holds `title.slice(starts[i], starts[i + 1])`, which
 * includes the space the wrap consumed at the break, so the runs concatenate
 * back to the title exactly. Line 0 may hold no title at all — the layout puts
 * a first word too long for line 1 on line 2, leaving the id alone.
 *
 * Not capped at the row's three lines: the layout truncates the third line with
 * an ellipsis, and an editor has to show what it truncates. Every line before
 * that is the same line the layout draws (same function, same inputs).
 *
 * @param {string} title
 * @param {{reqId:number, idText:string, titleHang:number, titleRoom:number}} label
 *   the layout's `kind: 'req'` label (`idText` is the id plus any pills)
 * @returns {number[]}
 */
export function titleLineStarts(title, label) {
    const text = String(title ?? '');
    const prefix = String(label.idText ?? label.reqId);
    const full = `${prefix}${' '.repeat(CARD_SEP_CHARS)}${text}`;
    const off = full.length - text.length;
    const maxChars = (label.titleHang ?? 0) + (label.titleRoom ?? full.length);
    const indent = String(label.reqId).length + CARD_SEP_CHARS;
    const hang = reqHangChars(maxChars, indent);
    const lines = wrapReqText(full, maxChars, Number.MAX_SAFE_INTEGER, indent);
    const starts = [];
    let p = 0;
    lines.forEach((ln, i) => {
        starts.push(Math.max(0, p - off));
        p += (i === 0 ? ln : ln.slice(hang)).length;
        // A break the wrap made AT a space consumed it; it rides at the end of
        // this line's run.
        if (i < lines.length - 1 && full[p] === ' ') p += 1;
    });
    return starts;
}

/** The offset a Backspace deletes back to — one code point, not half of one. */
export function prevCharIndex(text, i) {
    if (i <= 0) return 0;
    const lo = text.charCodeAt(i - 1);
    return lo >= 0xdc00 && lo <= 0xdfff && i >= 2 ? i - 2 : i - 1;
}

/** The offset a forward Delete deletes up to. */
export function nextCharIndex(text, i) {
    if (i >= text.length) return text.length;
    const hi = text.charCodeAt(i);
    return hi >= 0xd800 && hi <= 0xdbff && i + 2 <= text.length ? i + 2 : i + 1;
}

/** Option/Ctrl+Backspace: back over any spaces, then back over the word. */
export function wordStartBefore(text, i) {
    let j = i;
    while (j > 0 && /\s/.test(text[j - 1])) j--;
    while (j > 0 && !/\s/.test(text[j - 1])) j--;
    return j;
}

/** Option/Ctrl+Delete: forward over any spaces, then over the word. */
export function wordEndAfter(text, i) {
    let j = i;
    while (j < text.length && /\s/.test(text[j])) j++;
    while (j < text.length && !/\s/.test(text[j])) j++;
    return j;
}

/**
 * The screen box of a requirement row's title editor — the title's own room on
 * its card, exactly as the canvas draws it.
 *
 * Everything is DERIVED from what the renderer drew:
 *   - the COLUMN (`left`) is where continuation lines start — the row's x plus
 *     the hanging indent the layout's wrap honoured (`label.titleHang`);
 *   - line 1's title starts where the canvas put it (`indent`): after the id
 *     and its separator, or — on a row carrying pills — after the PACKED pills, whose
 *     tail the renderer redraws flush against the last one (`tail`);
 *   - `width` is the column's characters plus one, for the space a break
 *     consumed, which rides at the end of its line;
 *   - `height` is the lines the row is drawn on — the layout is fed the draft,
 *     so this follows the typing.
 *
 * @param {Object} a
 * @param {Object} a.label     the layout's `kind: 'req'` label for the row
 * @param {string} a.firstLine the row's first drawn line (pre-packing)
 * @param {Function} a.measure (str) -> world px or null (no canvas)
 * @param {number} a.chw       the layout's per-character fallback advance
 * @param {?{x:number,text:string,start:number}} a.tail the packed first-line
 *                             tail, when the renderer drew one
 * @param {{x:number,y:number,k:number}} a.t camera transform
 * @param {number} a.lineH     world line pitch of a requirement row
 * @param {number} a.fontSize  world font size of a requirement row
 * @param {number} [a.insetTop] the overlay layer's own top inset (screen px)
 */
export function reqTitleEditorBox({
    label, firstLine, measure, chw, tail = null, t, lineH, fontSize, insetTop = 0,
}) {
    const adv = (s) => (s ? (measure(s) ?? s.length * chw) : 0);
    const hang = label.titleHang ?? 0;
    const start = label.titleStart ?? hang;
    const colX = label.x + adv(firstLine.slice(0, hang));
    const line1X = tail
        ? tail.x + adv(tail.text.slice(0, Math.max(0, start - tail.start)))
        : label.x + adv(firstLine.slice(0, start));
    const lines = Math.max(1, (label.lines || []).length);
    return {
        left: colX * t.k + t.x,
        top: label.y * t.k + t.y - insetTop,
        width: `${label.titleRoom + 1}ch`,
        height: lines * lineH * t.k,
        fontSize: fontSize * t.k,
        lineHeight: `${lineH * t.k}px`,
        indent: `${Math.max(0, (line1X - colX) * t.k)}px`,
    };
}
