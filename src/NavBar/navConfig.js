// req #3463 — the plan LIST routes come from the era binding, so the nav
// rail and the router cannot disagree about where a plan list lives.
import { planListPath } from '../SwarmView/pipelines/planEra';
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
import TimelineIcon from '@mui/icons-material/Timeline';
import BusinessIcon from '@mui/icons-material/Business';
import UndoIcon from '@mui/icons-material/Undo';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ComputerIcon from '@mui/icons-material/Computer';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import RuleIcon from '@mui/icons-material/Rule';
import DescriptionIcon from '@mui/icons-material/Description';
import DataUsageIcon from '@mui/icons-material/DataUsage';

export const NAV_GROUPS = [
    { id: 'calendar', label: '' },
    { id: 'tasks', label: 'TASKS' },
    { id: 'maps', label: 'MAPS' },
    ...(import.meta.env.DEV ? [{ id: 'systems', label: 'SYSTEMS' }] : []),
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
    ...(import.meta.env.DEV ? [
        { path: '/systems2', label: 'NVLink', icon: AccountTreeIcon, group: 'systems' },
        { path: '/build-visualizer', label: 'Build Visualizer', icon: TimelineIcon, group: 'systems' },
        { path: '/customers', label: 'Customers', icon: BusinessIcon, group: 'systems' },
        { path: '/customer-releases', label: 'Customer Releases', icon: BusinessIcon, group: 'systems' },
    ] : []),
    // Req #3236 — Epics and Steps are the plan's own entities, sequenced into a
    // pipeline's steps, so they nest as L3 children of Pipelines rather than
    // standing beside it as L2 siblings. Reuses the collapsible L3 mechanism
    // req #3209 shipped for Sessions verbatim — no second mechanism. Order is
    // hierarchy order (Epic, then Step). LayersIcon/LinearScaleIcon are
    // unchanged: the entries moved, not the pages, so each keeps the icon it
    // always carried.
    // Req #3357 — the Feature tier (and its Features entry here, between Epics
    // and Steps) was retired: a step now belongs to its epic directly rather
    // than through an intermediate Feature row, so the plan-editor cluster went
    // from three L3 children to two.
    // Req #3427 — Pipelines leads the SWARM group, ahead of Requirements: the
    // plan is the entry point workers are launched from, so it reads first.
    //
    // ── Req #3356: THE 1.0 ENTRIES ARE GONE AND THE SURVIVORS TOOK THEIR PATHS
    // The `Epics` and `Steps` children pointed at `/swarm/epics` and
    // `/swarm/steps`, whose pages were deleted; the PARENT pointed at
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
            // order (Epic, then Step).
            { path: '/swarm/epics', label: 'Epics', icon: LayersIcon, group: 'swarm' },
            { path: '/swarm/steps', label: 'Steps', icon: LinearScaleIcon, group: 'swarm' },
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
        ],
    },
    { path: '/devservers', label: 'Dev Servers', icon: DnsIcon, group: 'swarm' },
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

export const PROFILE_LINK = { path: '/profile', label: 'Profile', icon: PedalBikeIcon };

// Bicycle menu items (Profile only — editor links are in page-level settings menus)
export const BIKE_MENU_LINKS = [
    PROFILE_LINK,
];

export const SIDEBAR_WIDTH = 180;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
