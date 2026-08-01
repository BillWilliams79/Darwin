import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import MapIcon from '@mui/icons-material/Map';
import HubIcon from '@mui/icons-material/Hub';
import DnsIcon from '@mui/icons-material/Dns';
import PedalBikeIcon from '@mui/icons-material/PedalBike';
import RepeatIcon from '@mui/icons-material/Repeat';
import RouteIcon from '@mui/icons-material/Route';
import FactCheckIcon from '@mui/icons-material/FactCheck';
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
    { path: '/swarm', label: 'Requirements', icon: MapIcon, group: 'swarm' },
    // Req #3114 — Swarm Orchestration: durable multi-requirement execution plans.
    // Sits directly under Requirements because a pipeline is the layer ABOVE them
    // (Epic > Feature > Story, sequenced into steps), and above Sessions because
    // plan views carry no session data at all (req #3080 design rule 9).
    { path: '/swarm/pipelines', label: 'Pipelines', icon: LanIcon, group: 'swarm' },
    // Req #3139 — the Epics editor. An L2 SIBLING of Pipelines, not a child of
    // it: an epic is not a lifecycle record OF a pipeline the way Starts are of
    // a Session (req #3209's nesting rule), it is the tier the plan is composed
    // FROM (design rule 10 walks requirement -> feature -> epic for a step's
    // label). It sits directly under Pipelines because that is where the plan
    // hierarchy is read from, and above Sessions for the same reason Pipelines
    // is — plan views carry no session data at all (req #3080 design rule 9).
    { path: '/swarm/epics', label: 'Epics', icon: LayersIcon, group: 'swarm' },
    // Req #3217 — the Features editor, the last page of feature 37 "Plan Editors".
    // The page itself already existed (/swarm/features, req #2380); what it lacked
    // was a formal entry. It was filed under SWARM VALIDATE, a group gated behind
    // `app_swarm_validate`, which ships DISABLED — so of the three tiers of Epic >
    // Feature > Story, the middle one was the only one whose nav entry sat outside
    // the plan group, behind a toggle a user had to go find before the page existed
    // for them. MOVED here, never duplicated: two rows for one path would both
    // light up as active and appear twice in the mobile bottom nav (the
    // no-duplicate-paths invariant in navConfig.test.js pins it).
    //
    // Between Epics and Steps because the cluster reads top-down as the plan
    // hierarchy — Epic > Feature (design rule 10 walks requirement → feature →
    // epic for a step's label) — and feature 37 enumerates its own pages in that
    // order. Steps therefore moves to Pipelines + 3; Epics keeps the Pipelines + 1
    // slot #3139 pinned. FactCheckIcon is deliberately kept: it is the icon this
    // page has always carried, and the entry moving is not the page changing.
    { path: '/swarm/features', label: 'Features', icon: FactCheckIcon, group: 'swarm' },
    // Req #3140 — the Steps editor, the second page of feature 37 "Plan Editors"
    // to ship. A SIBLING for the same reason Epics is: req #3209's nesting is for
    // lifecycle records OF a thing, and a step is a MEMBER of a plan, not a record
    // about one. It sits after Epics rather than displacing it because the cluster
    // reads top-down as the plan itself (Pipelines) and then what it is composed
    // of — and because #3139 pinned Epics at Pipelines + 1.
    { path: '/swarm/steps', label: 'Steps', icon: LinearScaleIcon, group: 'swarm' },
    // Req #3209 — Sessions is the first L2 item with L3 children. Starts,
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
    { path: '/swarm/machines', label: 'Machines', icon: ComputerIcon, group: 'swarm' },
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
    // Features moved out of this group to the plan-editor cluster above (req
    // #3217). No page below navigates to /swarm/features, so nothing here lost a
    // link.
    //
    // A link belongs to exactly one group, and a group's toggle decides whether it
    // renders at all, so the move is a TRADE and not a pure gain. Measured across
    // the four toggle states: Swarm on / Validate off went from hidden to visible
    // (the case that matters — `app_swarm_validate` ships 0, so before this the
    // entry was dead for anyone who had not gone looking for the toggle), and
    // Swarm OFF / Validate on went the other way, from visible to hidden. Accepted
    // deliberately: this requirement reclassifies Features as a PLAN entity, the
    // middle tier of Epic > Feature > Story, so hiding it with the plan group is
    // the classification behaving correctly rather than a leak. The route still
    // resolves in that state; it is the nav row that is absent.
    // NavBarSidebar.featuresNav.test.jsx pins all four states so the trade cannot
    // be reversed silently.
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
