// filerCategoryAim.js — the filer's + aimed at a category card (req #4026): "if
// the requirement creator popup is not in pushpin mode and you are on the
// taskcard view layout, the creator hovers over a category card and by default
// that is the category for the requirement create when you click the plus sign".
//
// The requirements page's Cards view draws each category as a DOM card
// (SwarmView/CategoryCard.jsx) carrying `data-filer-category` (its id),
// `data-filer-project` and `data-filer-db` (the database its page reads). So
// unlike an epic (filerEpicAim.js — Konva shapes only their visualizer can
// hit-test) the aim is the DOM beneath the +: `categoryAimAt` looks through the
// filer itself for the card under a client point, and `highlightCategoryAim`
// marks that card `data-filer-aim` (`ok` | `refused`), which the card outlines.
//
// "NOT IN PUSHPIN MODE": only a FLOATING filer aims. Racked on the navbar (or
// its icon in a minimized bar) or locked into the page's title bar, the filer is
// pinned in the page's chrome, not hovering over it — it files as it always has.
//
// A target is `{ categoryId, projectId, darwinUri, closed }`. A closed category
// (the Cards view's "show closed") takes no new requirement. On a dev server the cards
// are darwin_dev rows while the filer files into production (req #3888), and a
// darwin_dev category id names another row (or none) there — `placeProblem`
// says so, the card is outlined as the refusal it is, and the + files to the
// last place as before.

const CARD = '[data-filer-category]';
const AIM_ATTR = 'data-filer-aim';

let marked = null;

/** Whether the filer panel holding `el` is pinned — racked or title-locked. */
export function filerPinned(el) {
    const panel = el?.closest?.('[data-rack-id]');
    if (!panel) return false;
    return panel.getAttribute('data-racked') === '1' || panel.getAttribute('data-title-locked') === '1';
}

/** The category card beneath a client point, or null (no card there, or the
 *  filer at `from` is pinned). */
export function categoryAimAt(clientX, clientY, from = null) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || filerPinned(from)) return null;
    if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
    for (const el of document.elementsFromPoint(clientX, clientY)) {
        const card = el.closest?.(CARD);
        if (!card) continue;
        const categoryId = Number(card.getAttribute('data-filer-category'));
        const projectId = Number(card.getAttribute('data-filer-project'));
        if (!Number.isInteger(categoryId) || categoryId <= 0 || !Number.isInteger(projectId) || projectId <= 0) return null;
        return { categoryId, projectId, darwinUri: card.getAttribute('data-filer-db') || null,
            closed: card.getAttribute('data-filer-closed') === '1' };
    }
    return null;
}

/** Why a requirement filed through `filerUri` cannot take `target`'s category,
 *  or null when it can: a closed category, or a card read from another database. */
export function placeProblem(target, filerUri) {
    if (!target) return null;
    if (target.closed) return 'closed';
    if (target.darwinUri && filerUri && target.darwinUri !== filerUri) return 'another database';
    return null;
}

/** Outlines `target`'s card — `ok` false as a refusal; null clears it. */
export function highlightCategoryAim(target, ok = true) {
    const card = target && typeof document !== 'undefined'
        ? document.querySelector(`[data-filer-category="${target.categoryId}"][data-filer-project="${target.projectId}"]`)
        : null;
    if (marked && marked !== card) marked.removeAttribute(AIM_ATTR);
    marked = card;
    card?.setAttribute(AIM_ATTR, ok ? 'ok' : 'refused');
}
