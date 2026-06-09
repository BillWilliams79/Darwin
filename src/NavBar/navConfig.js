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
import TimelineIcon from '@mui/icons-material/Timeline';
import BusinessIcon from '@mui/icons-material/Business';
import UndoIcon from '@mui/icons-material/Undo';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

export const NAV_GROUPS = [
    { id: 'calendar', label: '' },
    { id: 'tasks', label: 'TASKS' },
    { id: 'maps', label: 'MAPS' },
    ...(import.meta.env.DEV ? [{ id: 'systems', label: 'SYSTEMS' }] : []),
    { id: 'swarm', label: 'SWARM' },
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
    { path: '/swarm/sessions', label: 'Sessions', icon: HubIcon, group: 'swarm' },
    { path: '/swarm/swarm-starts', label: 'Starts', icon: RocketLaunchIcon, group: 'swarm' },
    { path: '/swarm/swarm-completes', label: 'Completes', icon: CheckCircleIcon, group: 'swarm' },
    { path: '/swarm/swarm-undos', label: 'Undos', icon: UndoIcon, group: 'swarm' },
    { path: '/devservers', label: 'Dev Servers', icon: DnsIcon, group: 'swarm' },
    { path: '/swarm/features', label: 'Features', icon: FactCheckIcon, group: 'swarm-validate' },
    { path: '/swarm/testcases', label: 'Test Cases', icon: ChecklistIcon, group: 'swarm-validate' },
    { path: '/swarm/testplans', label: 'Test Plans', icon: PlaylistAddCheckIcon, group: 'swarm-validate' },
    { path: '/swarm/testruns', label: 'Test Runs', icon: PlayCircleIcon, group: 'swarm-validate' },
];

export const PROFILE_LINK = { path: '/profile', label: 'Profile', icon: PedalBikeIcon };

// Bicycle menu items (Profile only — editor links are in page-level settings menus)
export const BIKE_MENU_LINKS = [
    PROFILE_LINK,
];

export const SIDEBAR_WIDTH = 180;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
