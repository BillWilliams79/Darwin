// Req #2869 — Navbar group headers collapse/expand.
// Req #3209 — Navbar item expand/collapse for L2 items with L3 children.
//
// Pure, localStorage-backed helpers for the per-group and per-item open/closed
// state used by NavBarSidebar. Kept separate from the component so the
// persistence + toggle logic is unit-testable without rendering the whole
// sidebar (mirrors the localStorage pattern in hooks/useViewPreference.js).
// Visual-only feature: routes are unaffected, this only hides/shows links.
//
// State shape (both maps): { [id]: true }. A present truthy value means the
// flag is SET; absent / falsy means it isn't. What "set" means differs by map,
// and each default is chosen so the flag stays absent in the common case:
//   - collapsed groups: set = COLLAPSED, so a fresh user sees every group open.
//   - expanded items:   set = EXPANDED,  so a fresh user sees L3s hidden until
//                       they ask for them (req #3209 — the sub-items are a
//                       drill-down, not part of the default nav surface).

export const COLLAPSED_GROUPS_KEY = 'darwin-navbar-collapsed-groups';
export const EXPANDED_ITEMS_KEY = 'darwin-navbar-expanded-items';

// Read a persisted flag map. Always returns a plain object; any storage error
// or malformed JSON degrades to {} rather than throwing into the render path.
function loadFlagMap(storageKey) {
    try {
        const raw = localStorage.getItem(storageKey);
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

// Persist a flag map. Best-effort: swallows storage errors (quota, private
// mode) so a failed write never breaks navigation.
function persistFlagMap(storageKey, state) {
    try {
        localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
        /* ignore — persistence is a nicety, not a requirement */
    }
}

// Return a NEW map with `id`'s flag flipped. When clearing the flag the key is
// removed entirely so the map stays minimal (absent = the default). Pure —
// does not touch storage.
function toggleFlag(state, id) {
    const next = { ...state };
    if (next[id]) {
        delete next[id];
    } else {
        next[id] = true;
    }
    return next;
}

// ── Group collapse (req #2869) — flag set means COLLAPSED ──
export const loadCollapsedGroups = () => loadFlagMap(COLLAPSED_GROUPS_KEY);
export const persistCollapsedGroups = (state) => persistFlagMap(COLLAPSED_GROUPS_KEY, state);
export const toggleGroupCollapsed = (state, id) => toggleFlag(state, id);

// ── Item expand (req #3209) — flag set means EXPANDED ──
export const loadExpandedItems = () => loadFlagMap(EXPANDED_ITEMS_KEY);
export const persistExpandedItems = (state) => persistFlagMap(EXPANDED_ITEMS_KEY, state);
export const toggleItemExpanded = (state, id) => toggleFlag(state, id);
