// titleBarLock.js — an Action Popup LOCKED INTO A PAGE'S TITLE BAR (req #3857).
// Pattern doc: memory/anchored-collapse-pattern.md § Locked into the title bar.
//
// The user's ask: "lock its view into the title bar. it would drop where the
// user puts and stay there. it cannot move or take precedence over other
// buttons and elements in the toolbar." So:
//   • A TITLE BAR is any element a page marks `data-title-bar` (the Plan page's
//     header row, the shared ViewerHeader row).
//   • Dropped on it, the popup is LOCKED there — `{ side, x }`: its offset from
//     the bar's nearer end, so it keeps its place against what it was dropped
//     beside as the bar widens or narrows. It is drawn at that spot, its head on
//     the bar's line, wherever the bar is drawn.
//   • It never covers the bar's own buttons and text: it sits only in FREE
//     SPACE — the gaps between what the bar draws. Dropped over a control, it
//     goes to the nearest gap; a gap narrower than its content narrows it (to
//     the minimum width), and when no gap is wide enough at all it floats at its
//     own dock until there is room again. The bar's elements never move for it.
//
//   • Several popups may lock into one bar (req #3961 — the requirements views'
//     bar holds the Requirement Filer and the Dev Servers popups); each keeps
//     clear of the others locked there as it does of the bar's own elements.
//
// The pure half is here (unit-tested); the DOM half — finding the bar, what
// it draws and the other popups locked into it — is the functions at the end;
// the live tracking is useTitleBarLock.js.

/** Clear space kept between the popup and the bar's own elements, px — the
 *  bar rows' own `gap: 1`. */
export const TITLE_BAR_MARGIN = 8;

const clampTo = (v, lo, hi) => Math.min(Math.max(lo, v), Math.max(lo, hi));

/** A stored lock, or null when it is not one. */
export function validLock(lock) {
    if (!lock || (lock.side !== 'l' && lock.side !== 'r')) return null;
    return Number.isFinite(lock.x) && lock.x >= 0 ? lock : null;
}

/** The lock a panel drawn at `rect` takes when dropped on `bar`: the nearer
 *  end of the bar (by the panel's centre) and its offset from it. */
export function lockFromDrop(rect, bar) {
    const side = rect.left + rect.width / 2 > (bar.left + bar.right) / 2 ? 'r' : 'l';
    const x = side === 'l' ? rect.left - bar.left : bar.right - (rect.left + rect.width);
    return { side, x: Math.max(0, Math.round(x)) };
}

/**
 * The bar's LINE — the band the popup's head is centred on. A bar that wraps
 * (ViewerHeader's row may) is taller than one line: its first line is the
 * band its top items span.
 *
 * @param {{top, height}} bar
 * @param {{top, bottom}[]} occupied
 * @param {number} headPx
 */
export function titleBarLine(bar, occupied, headPx) {
    if (bar.height <= 2 * headPx) return { top: bar.top, height: bar.height };
    const first = occupied.filter(o => o.top < bar.top + headPx);
    const bottom = first.length ? Math.max(...first.map(o => o.bottom)) : bar.top + headPx;
    return { top: bar.top, height: Math.max(headPx, bottom - bar.top) };
}

/**
 * The bar's FREE SPACE: [left, right] spans between what it draws, each kept
 * `margin` clear of its neighbours (the bar's own ends need none), left to
 * right. Over the bar's WHOLE height — a wrapped bar's later lines included —
 * so an open popup's rows, dropping below its head, never cover them either.
 *
 * @param {{left, right, top, bottom}} bar
 * @param {{left, right, top, bottom}[]} occupied  what the bar draws
 */
export function freeGaps(bar, occupied, margin = TITLE_BAR_MARGIN) {
    const spans = occupied
        .filter(o => o.right > bar.left && o.left < bar.right && o.bottom > bar.top && o.top < bar.bottom)
        .map(o => [Math.max(bar.left, o.left - margin), Math.min(bar.right, o.right + margin)])
        .sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let at = bar.left;
    spans.forEach(([l, r]) => {
        if (l > at) gaps.push({ left: at, right: l });
        at = Math.max(at, r);
    });
    if (bar.right > at) gaps.push({ left: at, right: bar.right });
    return gaps;
}

/**
 * Where a locked popup is drawn: `{ left, top, width }` in viewport px, or null
 * when the bar has no gap at least `minW` wide (it floats meanwhile).
 *
 * It wants its natural width at the lock's spot. The nearest gap that fits the
 * minimum takes it — the gap holding that spot when there is one — at its
 * natural width or the gap's, whichever is less, slid only as far as the gap
 * needs. Its head is centred on the bar's line.
 *
 * @param {{side, x}} lock
 * @param {{left, right, top, height}} bar
 * @param {Object[]} occupied
 * @param {number} naturalW  its content width
 * @param {{minW, headPx}} limits
 */
export function titleBarPlace(lock, bar, occupied, naturalW, { minW, headPx }) {
    const line = titleBarLine(bar, occupied, headPx);
    const gaps = freeGaps(bar, occupied).filter(g => g.right - g.left >= minW);
    if (!gaps.length) return null;
    const want = lock.side === 'r' ? bar.right - lock.x - naturalW : bar.left + lock.x;
    let best = null;
    gaps.forEach((g) => {
        const width = Math.min(naturalW, g.right - g.left);
        const left = clampTo(want, g.left, g.right - width);
        const off = Math.abs(left - want);
        if (!best || off < best.off) best = { left, width, off };
    });
    return {
        left: Math.round(best.left),
        top: Math.round(line.top + (line.height - headPx) / 2),
        width: Math.round(best.width),
    };
}

/** Is the point on the bar? */
export function onTitleBar(x, y, bar) {
    return !!bar && x >= bar.left && x <= bar.right && y >= bar.top && y <= bar.bottom;
}

// ── DOM ────────────────────────────────────────────────────────────────────

/** What a title bar draws that the popup must keep clear of: its controls and
 *  its text runs (a title's text, not the spacer box it sits in). */
const DRAWN = [
    // A page's own mark for anything else its bar draws (a status dot, say).
    '[data-title-bar-item]',
    'button', 'a', 'input', 'select', 'textarea', 'svg', 'img', 'canvas', 'hr',
    '[role="button"]', '[role="switch"]', '[role="separator"]', '[role="img"]', '[role="group"]',
    '.MuiChip-root', '.MuiDivider-root', '.MuiInputBase-root', '.MuiSwitch-root',
].join(', ');

const rectOf = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    width: r.width, height: r.height });

/** The page's title bar as drawn now — the first marked one with a box — or
 *  null. One per page: a second marked bar drawn at once is never a drop zone. */
export function findTitleBar(doc = document) {
    const bars = doc.querySelectorAll('[data-title-bar]');
    for (const el of bars) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { el, rect: rectOf(r) };
    }
    return null;
}

/**
 * The rects of the OTHER popups locked into the bar now (req #3961 — several
 * Action Popups may share one bar, and none may cover another). `self` is the
 * asking popup. With `earlierOnly`, only those before it in document order: a
 * locked popup yields to the ones ahead of it and never to the ones after, so
 * two that want one spot settle — the later one moves, the earlier one stays —
 * rather than both moving and both coming back. A DROP counts them all.
 * Each counts as its HEAD only (`headPx` tall): an open one's rows hang below
 * the bar and must not widen the bar's line (titleBarLine) the others centre on.
 */
export function lockedPopupRects(self, { earlierOnly = false, headPx = Infinity } = {}) {
    const doc = self?.ownerDocument;
    if (!doc) return [];
    const out = [];
    doc.querySelectorAll('[data-title-locked="1"]').forEach((n) => {
        if (n === self) return;
        // eslint-disable-next-line no-bitwise
        if (earlierOnly && !(n.compareDocumentPosition(self) & 4 /* FOLLOWING */)) return;
        const r = n.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return;
        const head = rectOf(r);
        head.bottom = Math.min(head.bottom, head.top + headPx);
        head.height = head.bottom - head.top;
        out.push(head);
    });
    return out;
}

/** The rects of what `el` (a title bar) draws, in viewport px. */
export function titleBarOccupied(el) {
    const out = [];
    const add = (r) => { if (r.width > 0 && r.height > 0) out.push(rectOf(r)); };
    el.querySelectorAll(DRAWN).forEach(n => add(n.getBoundingClientRect()));
    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    const range = doc.createRange();
    if (typeof range.getClientRects !== 'function') return out;
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!t.nodeValue.trim()) continue;
        range.selectNodeContents(t);
        Array.from(range.getClientRects()).forEach(add);
    }
    return out;
}
