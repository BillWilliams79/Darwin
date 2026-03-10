import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CategoryIcon from '@mui/icons-material/Category';
import MapIcon from '@mui/icons-material/Map';
import HubIcon from '@mui/icons-material/Hub';
import DnsIcon from '@mui/icons-material/Dns';
import PedalBikeIcon from '@mui/icons-material/PedalBike';
import RepeatIcon from '@mui/icons-material/Repeat';

export const NAV_GROUPS = [
    { id: 'tasks', label: 'TASKS' },
    { id: 'swarm', label: 'SWARM' },
];

export const NAV_LINKS = [
    { path: '/taskcards', label: 'Plan', icon: ViewKanbanIcon, group: 'tasks' },
    { path: '/calview', label: 'Calendar', icon: CalendarMonthIcon, group: 'tasks' },
    { path: '/recurring', label: 'Recurring', icon: RepeatIcon, group: 'tasks' },
    { path: '/swarm', label: 'Roadmap', icon: MapIcon, group: 'swarm' },
    { path: '/swarm/sessions', label: 'Sessions', icon: HubIcon, group: 'swarm' },
    { path: '/devservers', label: 'Dev Servers', icon: DnsIcon, group: 'swarm' },
];

// Secondary links — accessed via bicycle menu
export const MORE_LINKS = [
    { path: '/domainedit', label: 'Domains', icon: AccountTreeIcon },
    { path: '/areaedit', label: 'Areas', icon: CategoryIcon },
];

export const PROFILE_LINK = { path: '/profile', label: 'Profile', icon: PedalBikeIcon };

// Bicycle menu items (Profile + secondary links)
export const BIKE_MENU_LINKS = [
    PROFILE_LINK,
    ...MORE_LINKS,
];

export const SIDEBAR_WIDTH = 180;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
