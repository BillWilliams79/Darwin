// Req #2869 — Navbar group headers collapse/expand.
//
// Pure, localStorage-backed helpers for the per-group collapsed state used by
// NavBarSidebar. Kept separate from the component so the persistence + toggle
// logic is unit-testable without rendering the whole sidebar (mirrors the
// localStorage pattern in hooks/useViewPreference.js). Visual-only feature:
// routes are unaffected, this only hides/shows a group's links.
//
// State shape: { [groupId]: true } where a present truthy value means that
// group is COLLAPSED. Absent / falsy means expanded (the default), so a fresh
// user sees every group open.

export const COLLAPSED_GROUPS_KEY = 'darwin-navbar-collapsed-groups';

// Read the persisted collapsed-group map. Always returns a plain object; any
// storage error or malformed JSON degrades to {} (all groups expanded) rather
// than throwing into the render path.
export function loadCollapsedGroups() {
    try {
        const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        // Guard against a non-object payload (e.g. a stray array or string).
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
        return {};
    } catch {
        return {};
    }
}

// Persist the collapsed-group map. Best-effort: swallows storage errors (quota,
// private mode) so a failed write never breaks navigation.
export function persistCollapsedGroups(state) {
    try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(state));
    } catch {
        /* ignore — persistence is a nicety, not a requirement */
    }
}

// Return a NEW map with `id`'s collapsed flag flipped. When toggling back to
// expanded the key is removed entirely so the map stays minimal (default =
// expanded). Pure — does not touch storage.
export function toggleGroupCollapsed(state, id) {
    const next = { ...state };
    if (next[id]) {
        delete next[id];
    } else {
        next[id] = true;
    }
    return next;
}
