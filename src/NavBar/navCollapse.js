// Req #2869 — Navbar group headers collapse/expand.
// Req #3209 — Navbar item expand/collapse for L2 items with L3 children.
// Req #3589 — Dev servers start with every group collapsed except the one
//             owning the area the dev server is working in.
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
//
// Req #3589 — a DEV SERVER inverts the group default: every labelled group
// starts collapsed except the one(s) owning the dev server's working area
// (its default route, and the route the tab first loaded). That seed is a
// FALLBACK, used only when nothing is stored yet; once the user toggles a
// header their choice persists as usual. The dev map lives under its own
// per-session key (devCollapsedGroupsKey) because localStorage is per ORIGIN
// and dev-server ports are reused — without it a new session on a recycled
// port would inherit the previous session's (all-open) map and never see the
// default at all.

export const COLLAPSED_GROUPS_KEY = 'darwin-navbar-collapsed-groups';
export const EXPANDED_ITEMS_KEY = 'darwin-navbar-expanded-items';

// Read a persisted flag map. Always returns a plain object; any storage error
// or malformed JSON degrades to {} rather than throwing into the render path.
// `fallback` is returned only when NOTHING is stored under the key — a stored
// `{}` is a real choice (every flag cleared) and is honoured as such.
function loadFlagMap(storageKey, fallback = {}) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw == null) return fallback;
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
export const loadCollapsedGroups = (storageKey = COLLAPSED_GROUPS_KEY, fallback = {}) =>
    loadFlagMap(storageKey, fallback);
export const persistCollapsedGroups = (state, storageKey = COLLAPSED_GROUPS_KEY) =>
    persistFlagMap(storageKey, state);
export const toggleGroupCollapsed = (state, id) => toggleFlag(state, id);

// ── Item expand (req #3209) — flag set means EXPANDED ──
export const loadExpandedItems = () => loadFlagMap(EXPANDED_ITEMS_KEY);
export const persistExpandedItems = (state) => persistFlagMap(EXPANDED_ITEMS_KEY, state);
export const toggleItemExpanded = (state, id) => toggleFlag(state, id);

// ── Dev-server default (req #3589) ──

// Storage key for a dev server's group map, scoped to the requirement it is
// serving AND its working area, so a recycled port — or the Primary's own dev
// server, which has no requirement id and reuses its origin across every
// session — starts from the dev default rather than whatever the last session
// on that origin left behind.
export const devCollapsedGroupsKey = (reqId, workingRoute) =>
    `${COLLAPSED_GROUPS_KEY}:dev:${reqId || ''}:${workingRoute || ''}`;

// The group owning `route`: the nav link (parent or L3 child) whose path is the
// LONGEST match — equal, or a `/`-delimited prefix — so `/swarm/sessions/7`
// resolves through `/swarm/sessions`, not the `/swarm` index. A query string
// or hash (a deep link like `/swarm/pipeline/2?mode=plan`) is ignored. Null
// when no link owns the route (e.g. `/`).
export function groupForRoute(links, rawRoute) {
    const route = rawRoute?.split(/[?#]/)[0];
    if (!route) return null;
    let best = null;
    for (const link of links.flatMap(l => [l, ...(l.children ?? [])])) {
        const matches = route === link.path || route.startsWith(`${link.path}/`);
        if (matches && (!best || link.path.length > best.path.length)) best = link;
    }
    return best?.group ?? null;
}

// The dev-server seed: every LABELLED group collapsed (an unlabelled group has
// no header to collapse) except those owning one of `focusRoutes`.
export function defaultCollapsedGroups(groups, links, focusRoutes) {
    const open = new Set(focusRoutes.map(r => groupForRoute(links, r)).filter(Boolean));
    return Object.fromEntries(
        groups.filter(g => g.label && !open.has(g.id)).map(g => [g.id, true])
    );
}

// ── Icon-only sidebar (req #3590) ──

// The links the icon-only sidebar shows, in display order: exactly the links
// the full-width sidebar shows, flattened. A collapsed LABELLED group
// contributes nothing (an unlabelled group has no header, so it is never
// collapsed), and an L2 item's L3 children follow it only while that item is
// expanded. Icon mode reflects the user's group/item choices rather than
// flattening every route into view.
export function iconModeLinks(groups, links, collapsedGroups, expandedItems) {
    return groups.flatMap(g => (g.label && collapsedGroups[g.id])
        ? []
        : links
            .filter(l => l.group === g.id)
            .flatMap(l => [l, ...(expandedItems[l.path] ? (l.children ?? []) : [])])
    );
}
