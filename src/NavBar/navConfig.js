// req #3463 — the plan LIST routes come from the era binding, so the nav
// rail and the router cannot disagree about where a plan list lives.
import { planListPath } from '../SwarmView/pipelines/planEra';
import { ENGINES_PATH } from '../SwarmView/engine/enginePaths';
import { APP_SCOPE, SCOPE_ALL, HAS_SYSTEMS } from '../config/product';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import MapIcon from '@mui/icons-material/Map';
import HubIcon from '@mui/icons-material/Hub';
import DnsIcon from '@mui/icons-material/Dns';
import PedalBikeIcon from '@mui/icons-material/PedalBike';
import RepeatIcon from '@mui/icons-material/Repeat';
import RouteIcon from '@mui/icons-material/Route';
import ChecklistIcon from '@mui/icons-material/Checklist';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import LanIcon from '@mui/icons-material/Lan';
import LayersIcon from '@mui/icons-material/Layers';
import LinearScaleIcon from '@mui/icons-material/LinearScale';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import TimelineIcon from '@mui/icons-material/Timeline';
import BusinessIcon from '@mui/icons-material/Business';
import UndoIcon from '@mui/icons-material/Undo';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ComputerIcon from '@mui/icons-material/Computer';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import RuleIcon from '@mui/icons-material/Rule';
import DescriptionIcon from '@mui/icons-material/Description';
import DataUsageIcon from '@mui/icons-material/DataUsage';

// req #4076 — the SYSTEMS group, and the Topology page in it, exist in a DEV
// build or in a product whose application scope names `systems` (the internal
// product). darwin.one's scope is "all", so `APP_SCOPE.all` keeps it dev-only
// there exactly as before. BUILD_TOOLS_ON (Build Visualizer, Customers) stays
// dev-only in every product.
export const TOPOLOGY_ON = import.meta.env.DEV || (!SCOPE_ALL && HAS_SYSTEMS);
export const BUILD_TOOLS_ON = import.meta.env.DEV && SCOPE_ALL;

export const NAV_GROUPS = [
    { id: 'calendar', label: '' },
    { id: 'tasks', label: 'TASKS' },
    { id: 'maps', label: 'MAPS' },
    ...(TOPOLOGY_ON ? [{ id: 'systems', label: 'SYSTEMS' }] : []),
    { id: 'swarm', label: 'SWARM' },
    { id: 'agents', label: 'AGENTS' },
    { id: 'swarm-validate', label: 'SWARM VALIDATE' },
];

// Maps nav group id → profile column name for app toggle filtering.
// Per-key default lives in GROUP_PROFILE_DEFAULT below — every group that
// names a profile column MUST declare its default there (no implicit fallback).
export const GROUP_PROFILE_KEY = {
    tasks: 'app_tasks',
    maps: 'app_maps',
    swarm: 'app_swarm',
    agents: 'app_swarm', // req #3553 — Agents is part of the Swarm feature
    'swarm-validate': 'app_swarm_validate',
};

// Default value for each profile toggle when the profile row hasn't been
// fetched yet OR the column is missing from the response. Required for every
// key listed in GROUP_PROFILE_KEY — Swarm Validate ships disabled (0); the
// rest historically default to enabled (1) for groups that pre-existed the
// per-key default map.
export const GROUP_PROFILE_DEFAULT = {
    app_tasks: 1,
    app_maps: 1,
    app_swarm: 0,
    app_swarm_validate: 0,
};

export const NAV_LINKS = [
    { path: '/taskcards', label: 'Plan', icon: ViewKanbanIcon, group: 'tasks' },
    { path: '/recurring', label: 'Recurring', icon: RepeatIcon, group: 'tasks' },
    { path: '/calview', label: 'Calendar', icon: CalendarMonthIcon, group: 'calendar' },
    { path: '/maps', label: 'Maps', icon: RouteIcon, group: 'maps' },
    ...(TOPOLOGY_ON ? [
        { path: '/systems2', label: 'AI Architecture', icon: AccountTreeIcon, group: 'systems' },
    ] : []),
    ...(BUILD_TOOLS_ON ? [
        { path: '/build-visualizer', label: 'Build Visualizer', icon: TimelineIcon, group: 'systems' },
        { path: '/customers', label: 'Customers', icon: BusinessIcon, group: 'systems' },
        { path: '/customer-releases', label: 'Customer Releases', icon: BusinessIcon, group: 'systems' },
    ] : []),
    // Req #3236 — Initiatives and Epics are the plan's own entities, sequenced into a
    // pipeline's epics, so they nest as L3 children of Pipelines rather than
    // standing beside it as L2 siblings. Reuses the collapsible L3 mechanism
    // req #3209 shipped for Sessions verbatim — no second mechanism. Order is
    // hierarchy order (Initiative, then Epic). LayersIcon/LinearScaleIcon are
    // unchanged: the entries moved, not the pages, so each keeps the icon it
    // always carried.
    // Req #3357 — the retired middle tier (and its nav entry here, between
    // Initiatives and Epics) was removed: an epic now belongs to its initiative directly
    // rather than through an intermediate row, so the plan-editor cluster went
    // from three L3 children to two.
    // Req #3427 — Pipelines leads the SWARM group, ahead of Requirements: the
    // plan is the entry point workers are launched from, so it reads first.
    //
    // ── Req #3356: THE 1.0 ENTRIES ARE GONE AND THE SURVIVORS TOOK THEIR PATHS
    // The `Initiatives` and `Epics` children pointed at `/swarm/initiatives` and
    // `/swarm/epics`, whose pages were deleted; the PARENT pointed at
    // `/swarm/pipelines`, the deleted 1.0 plan list. A nav entry to a deleted
    // route renders a link that 404s, so the surviving pages moved onto those
    // now-vacant paths and dropped their `2` suffixes — both the route segments
    // and the visible labels, which no longer have a second era to distinguish
    // themselves from.
    //
    // THE FORMER `Pipelines 2.0` CHILD IS GONE, and not as a label decision: it
    // held the SAME path the parent now does, and `path` is this config's
    // identity — `NavBarSidebar` uses it as the React `key`, as the
    // expand/collapse key (`expandedItems[link.path]`) and as the testid slug,
    // and `flattenNavLinks()` feeds the mobile bottom nav, which resolves the
    // active item by `findIndex(l => isActive(l.path))`. Two entries sharing one
    // path is a duplicate key and an ambiguous lookup, not a redundant label.
    {
        path: planListPath(), label: 'Pipelines', icon: LanIcon, group: 'swarm',
        children: [
            // req #3393 — the plan-layer editors, children of the Pipelines
            // parent rather than a second top-level group, because
            // NavBarSidebar renders only two levels (no L4). Order is hierarchy
            // order (Initiative, then Epic).
            { path: '/swarm/initiatives', label: 'Initiatives', icon: LayersIcon, group: 'swarm' },
            { path: '/swarm/epics', label: 'Epics', icon: LinearScaleIcon, group: 'swarm' },
            // req #3760 — the orchestration engines that run these plans:
            // what each one decided, its health, where it runs, its limits.
            { path: ENGINES_PATH, label: 'Engines', icon: PrecisionManufacturingIcon, group: 'swarm' },
        ],
    },
    // Req #3238 — Machines nests as an L3 child of Requirements rather than
    // standing beside it as an L2 sibling (reuses the collapsible L3 mechanism
    // req #3209 shipped for Sessions verbatim — no second mechanism). Requirements
    // is the first parent to carry this shape rather than the last, so future L3s
    // (this one included) generalise onto the same field.
    //
    // Requirements is DELIBERATELY SECOND in the swarm group (req #3427's own
    // test pins it) — the plan-layer block below sits AFTER it rather than
    // between Pipelines and Requirements, so that invariant stays true.
    {
        path: '/swarm', label: 'Requirements', icon: MapIcon, group: 'swarm',
        children: [
            { path: '/swarm/machines', label: 'Machines', icon: ComputerIcon, group: 'swarm' },
        ],
    },
    // Req #3209 — Sessions is an L2 item with L3 children. Starts,
    // Completes and Undos are lifecycle records OF a session, not peers of it,
    // so they nest underneath rather than sitting as siblings. They keep their
    // own routes; only their position in the nav tree changed.
    {
        path: '/swarm/sessions', label: 'Sessions', icon: HubIcon, group: 'swarm',
        children: [
            { path: '/swarm/swarm-starts', label: 'Starts', icon: RocketLaunchIcon, group: 'swarm' },
            { path: '/swarm/swarm-completes', label: 'Completes', icon: CheckCircleIcon, group: 'swarm' },
            { path: '/swarm/swarm-undos', label: 'Undos', icon: UndoIcon, group: 'swarm' },
            // Req #3771 — Dev Servers nests last, after Undos. Route unchanged.
            { path: '/devservers', label: 'Dev Servers', icon: DnsIcon, group: 'swarm' },
        ],
    },
    // Agents is its own top-level group (req #3005), not nested under SWARM.
    // Instructions + Documents listings live under AGENTS (req #3013) — the same
    // icons the Agents page header chips used, kept in that order (Instructions
    // then Documents).
    { path: '/agents', label: 'Agents', icon: SmartToyIcon, group: 'agents' },
    { path: '/agents/instructions', label: 'Instructions', icon: RuleIcon, group: 'agents' },
    { path: '/agents/documents', label: 'Documents', icon: DescriptionIcon, group: 'agents' },
    // Req #3031 — persisted actual-token telemetry of the agents pattern;
    // labelled "Telemetry" (renamed from "Context" req #3065).
    { path: '/agents/context', label: 'Telemetry', icon: DataUsageIcon, group: 'agents' },
    { path: '/swarm/testcases', label: 'Test Cases', icon: ChecklistIcon, group: 'swarm-validate' },
    { path: '/swarm/testplans', label: 'Test Plans', icon: PlaylistAddCheckIcon, group: 'swarm-validate' },
    { path: '/swarm/testruns', label: 'Test Runs', icon: PlayCircleIcon, group: 'swarm-validate' },
];

// Flatten a nav-link list to parent-then-children order (req #3209). Any
// consumer that needs "every reachable link" — the mobile bottom nav, a route
// audit — must go through this rather than reading NAV_LINKS directly, or it
// silently loses the L3s. Depth is deliberately one level: the nav tree is
// Group > Item > Sub-item and nothing calls for a third.
export function flattenNavLinks(links) {
    return links.flatMap(link => (
        link.children?.length ? [link, ...link.children] : [link]
    ));
}

// ── Req #3790: a dev server shows only its session's applications ──────────
// The applications a dev server can be scoped to, each owning the nav groups
// it draws. The keys are the Profile "Applications" toggles' own keys plus the
// dev-only `systems`; Calendar rides with Tasks and Agents with Swarm (req
// #3553), exactly as their profile columns do. `scripts/devserver-start.sh`
// validates its APPS argument against these keys — keep the two in step.
export const DEV_APP_GROUPS = {
    tasks: ['tasks', 'calendar'],
    maps: ['maps'],
    systems: ['systems'],
    swarm: ['swarm', 'agents'],
    'swarm-validate': ['swarm-validate'],
};

// Display names — the Profile toggles' own labels, plus Systems.
export const DEV_APP_LABELS = {
    tasks: 'Tasks', maps: 'Maps', systems: 'Systems', swarm: 'Swarm', 'swarm-validate': 'Validate',
};

const GROUP_DEV_APP = Object.fromEntries(
    Object.entries(DEV_APP_GROUPS).flatMap(([app, groups]) => groups.map(g => [g, app]))
);

// Pages an application owns that have no nav link of their own — the editors
// its pages link out to. Same shape as a nav link, so one lookup serves both.
export const ROUTE_OWNERS_OFF_NAV = [
    { path: '/areaedit', group: 'tasks' },
    { path: '/domainedit', group: 'tasks' },
    { path: '/projectedit', group: 'swarm' },
    { path: '/categoryedit', group: 'swarm' },
];

// The application that owns `route`: the group of the nav link (or off-nav
// page) with the LONGEST path the route equals or extends at a `/` boundary
// (so `/swarm/testcases/7` is Swarm Validate's, not the `/swarm` index's).
// Query and hash are ignored. null when nothing owns the route (`/profile`).
export function appForRoute(route, links = NAV_LINKS) {
    if (!route) return null;
    const path = route.split(/[?#]/)[0];
    let best = null;
    for (const link of [...flattenNavLinks(links), ...ROUTE_OWNERS_OFF_NAV]) {
        if ((path === link.path || path.startsWith(`${link.path}/`))
                && (!best || link.path.length > best.path.length)) {
            best = link;
        }
    }
    return best ? (GROUP_DEV_APP[best.group] ?? null) : null;
}

// The set of applications this dev server shows, or null for "no override —
// the profile toggles decide". `devserver-start.sh` writes both inputs into
// the session's own .env.development.local: an explicit APPS list wins (the
// calling Claude named the impacted areas), else the app that owns the
// session's deep-link route. A session that passed neither — and production,
// always — gets null. Unknown names are dropped; a list with nothing known
// left falls back to the route rather than hiding every application.
export function resolveDevApps({ dev, apps, route }) {
    if (!dev) return null;
    const named = (apps || '').split(',').map(a => a.trim()).filter(a => DEV_APP_GROUPS[a]);
    if (named.length) return new Set(named);
    const owner = appForRoute(route);
    return owner ? new Set([owner]) : null;
}

// The session's scope, whether or not it is being applied.
export const DEV_APPS_SCOPE = resolveDevApps({
    dev: import.meta.env.DEV,
    apps: import.meta.env.VITE_DEV_APPS,
    route: import.meta.env.VITE_DEV_DEFAULT_ROUTE,
});

// The way back to every application on a scoped dev server. localStorage is
// per ORIGIN and a port outlives its session, so the flag stores WHICH scope
// it switched off — session, route and apps — and a later session reusing the
// port is scoped again. `*` switches off every scope on the origin: the E2E
// auth setup writes it, because specs click through every group.
export const DEV_APPS_OFF_KEY = 'darwin-dev-apps-off';
export const DEV_APPS_OFF_ALL = '*';
export const DEV_APPS_SIGNATURE = [
    import.meta.env.VITE_DEV_REQ_ID || '',
    import.meta.env.VITE_DEV_DEFAULT_ROUTE || '',
    [...(DEV_APPS_SCOPE ?? [])].join(','),
].join('|');

export function devAppsOptedOut(signature = DEV_APPS_SIGNATURE) {
    try {
        const off = localStorage.getItem(DEV_APPS_OFF_KEY);
        return off === DEV_APPS_OFF_ALL || off === signature;
    } catch {
        return false;
    }
}

// Switch this dev server's scope off (true) or back on (false). Takes effect
// on the next load — DEV_APPS is read once, at module evaluation.
export function setDevAppsOptOut(off, signature = DEV_APPS_SIGNATURE) {
    try {
        if (off) localStorage.setItem(DEV_APPS_OFF_KEY, signature);
        else localStorage.removeItem(DEV_APPS_OFF_KEY);
    } catch { /* storage blocked — nothing to switch */ }
}

// The scope actually applied — null when there is none or it is switched off.
export const DEV_APPS = DEV_APPS_SCOPE && !devAppsOptedOut() ? DEV_APPS_SCOPE : null;

// The dev server's working area (req #3589): the route its session deep-links
// to (req #3242 — devserver-start.sh writes VITE_DEV_DEFAULT_ROUTE into the
// session's own .env.development.local), else the first page of its
// application scope (req #3790 — an apps list with no route must not land on
// a hidden app), else the long-standing /systems2. HomePage lands on it;
// NavBarSidebar opens the group that owns it.
export const DEV_HOME_ROUTE = import.meta.env.VITE_DEV_DEFAULT_ROUTE
    || (DEV_APPS && NAV_LINKS.find(l => DEV_APPS.has(GROUP_DEV_APP[l.group]))?.path)
    || '/systems2';

// req #4076 — where a scoped product's home route lands: Topology when the
// product carries it, else its first in-scope page. null for darwin.one,
// whose home is the first group the profile enables (HomePage).
export const PRODUCT_HOME_ROUTE = APP_SCOPE.all ? null
    : (APP_SCOPE.systems ? '/systems2'
        : NAV_LINKS.find(l => APP_SCOPE[GROUP_DEV_APP[l.group]])?.path ?? '/profile');

// THE visibility predicate for a nav group — the sidebar, the home redirect
// and any app-scoped widget all ask this one function. Under a dev-server
// override the session's apps are shown and nothing else, whatever the
// profile says (darwin_dev's profile row is shared by every dev server, so it
// cannot carry one session's scope). Otherwise the profile toggle decides,
// with the per-key default while the row is loading.
//
// req #4076 — a PRODUCT scope (the internal build: Topology + Swarm) is the
// outer bound: a group outside it is never shown, whatever the dev scope or
// profile says. Same app vocabulary as the dev scope, same predicate — no
// third visibility mechanism. darwin.one's scope is "all", a no-op.
export function isGroupVisible(profile, groupId, devApps = DEV_APPS, productScope = APP_SCOPE) {
    const app = GROUP_DEV_APP[groupId];
    if (!productScope.all && !productScope[app]) return false;
    // Inside a scoped product its applications are the product, not optional
    // extras: the profile's darwin.one toggles (Swarm defaults OFF) do not
    // hide them. A dev scope still narrows.
    if (devApps) return devApps.has(app);
    if (!productScope.all) return true;
    const key = GROUP_PROFILE_KEY[groupId];
    if (!key) return true;
    const fallback = GROUP_PROFILE_DEFAULT[key] ?? 1;
    return Number(profile?.[key] ?? fallback) === 1;
}

export const PROFILE_LINK = { path: '/profile', label: 'Profile', icon: PedalBikeIcon };

// Bicycle menu items (Profile only — editor links are in page-level settings menus)
export const BIKE_MENU_LINKS = [
    PROFILE_LINK,
];

export const SIDEBAR_WIDTH = 180;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
