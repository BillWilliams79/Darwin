import React, { useContext, useState, useMemo, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { useDevServers } from '../hooks/useDataQueries';
import {
    NAV_GROUPS, NAV_LINKS, PROFILE_LINK,
    SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH, GROUP_PROFILE_KEY, GROUP_PROFILE_DEFAULT,
} from './navConfig';
import {
    loadCollapsedGroups, persistCollapsedGroups, toggleGroupCollapsed,
} from './navCollapse';
import ProfileDialog from './ProfileDialog';
import { prodRequirementUrl } from '../utils/prodUrl';

import AppBar from '@mui/material/AppBar';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Paper from '@mui/material/Paper';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const ACCENT = '#E91E63';
const BG_ACTIVE = 'rgba(233, 30, 99, 0.12)';
const DEV_ORANGE = '#FF6B35';

const isDev = import.meta.env.MODE === 'development';
const DEV_BORDER = isDev ? `4px solid ${DEV_ORANGE}` : 'none';
const DEV_REQ_ID = isDev ? (import.meta.env.VITE_DEV_REQ_ID || '') : '';
const DEV_REQ_TITLE = isDev ? (import.meta.env.VITE_DEV_REQ_TITLE || '') : '';

const NavBarSidebar = () => {
    const { idToken, profile } = useContext(AuthContext);
    const { database } = useContext(AppContext);
    const location = useLocation();
    const navigate = useNavigate();
    const isDesktop = useMediaQuery('(min-width:900px)');

    const [collapsed, setCollapsed] = useState(false);
    const [profileDialogOpen, setProfileDialogOpen] = useState(false);

    // Per-group collapsed state (req #2869). Clicking a group header hides/shows
    // its child links — purely visual, routes are unaffected. Seeded from and
    // persisted to localStorage so the choice survives reloads.
    const [collapsedGroups, setCollapsedGroups] = useState(loadCollapsedGroups);
    // Persist outside the reducer so the localStorage write stays a clean
    // side effect (and doesn't double-fire under StrictMode's reducer replay).
    useEffect(() => {
        persistCollapsedGroups(collapsedGroups);
    }, [collapsedGroups]);
    const toggleGroup = (id) => {
        setCollapsedGroups((prev) => toggleGroupCollapsed(prev, id));
    };

    // Dev-only: surface this dev server's terminal_number in the sidebar InfoBlock.
    // Match by current browser port; works in both worker and primary dev sessions.
    // staleTime: terminal_number is effectively immutable for the lifetime of a
    // dev server claim, so a 60s staleTime trades immediate freshness for one
    // refetch per minute instead of one per render (req #2419 W2 polish).
    // Enabled in ALL environments (not just dev): production also needs to know
    // whether the dev-server table is empty so the Dev Servers nav link can grey
    // out (req #3005). Lightweight, user-scoped GET; 60s staleTime keeps it to
    // roughly one refetch per minute.
    const { data: devServersArray } = useDevServers(profile?.userName, {
        enabled: !!profile?.userName,
        staleTime: 60_000,
    });
    // Grey out the Dev Servers link when its table has no rows. Dev-server records
    // are ephemeral (we don't keep history), so an empty table means "nothing
    // running" — the only nav item that behaves this way. `undefined` (loading)
    // is deliberately NOT treated as empty to avoid a grey flash on first paint.
    const devServersEmpty = Array.isArray(devServersArray) && devServersArray.length === 0;
    const currentDevTerminal = useMemo(() => {
        if (!isDev || !devServersArray) return null;
        const port = parseInt(window.location.port || '0', 10);
        if (!port) return null;
        const row = devServersArray.find(s => s.port === port);
        return row?.terminal_number ?? null;
    }, [devServersArray]);

    // Filter nav groups/links based on profile app toggle settings. Per-key
    // default lives in GROUP_PROFILE_DEFAULT so Swarm Validate (default 0)
    // doesn't accidentally light up when the profile row hasn't loaded yet.
    const isGroupEnabled = (id) => {
        const key = GROUP_PROFILE_KEY[id];
        if (!key) return true;
        const fallback = GROUP_PROFILE_DEFAULT[key] ?? 1;
        return Number(profile?.[key] ?? fallback) === 1;
    };
    const visibleGroups = useMemo(() =>
        NAV_GROUPS.filter(g => isGroupEnabled(g.id)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [profile]
    );
    const visibleLinks = useMemo(() =>
        NAV_LINKS.filter(l => isGroupEnabled(l.group)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [profile]
    );

    const isActive = (path) => {
        if (path === '/swarm') return location.pathname === '/swarm';
        return location.pathname.startsWith(path);
    };

    const handleBikeClick = () => setProfileDialogOpen(true);
    const handleProfileDialogClose = () => setProfileDialogOpen(false);

    const profileDialog = (
        <ProfileDialog open={profileDialogOpen} onClose={handleProfileDialogClose} />
    );

    const renderNavItem = (link, showText) => {
        const Icon = link.icon;
        const active = isActive(link.path);
        // Dev Servers greys out when its (ephemeral) table is empty — visual only,
        // the link stays clickable so the empty grid is still reachable (req #3005).
        const greyed = link.path === '/devservers' && devServersEmpty;
        const button = (
            <ListItemButton
                key={link.path}
                component={Link}
                to={link.path}
                sx={{
                    bgcolor: active ? BG_ACTIVE : 'transparent',
                    borderRight: active ? `3px solid ${ACCENT}` : '3px solid transparent',
                    py: 0.6,
                    px: showText ? 1.5 : 1,
                    minHeight: 36,
                    opacity: greyed ? 0.4 : 1,
                    justifyContent: showText ? 'initial' : 'center',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
                }}
            >
                <ListItemIcon sx={{
                    color: active ? ACCENT : 'rgba(255,255,255,0.7)',
                    minWidth: showText ? 32 : 'auto',
                    justifyContent: 'center',
                }}>
                    <Icon sx={{ fontSize: 18 }} />
                </ListItemIcon>
                {showText && (
                    <ListItemText
                        primary={link.label}
                        primaryTypographyProps={{
                            fontSize: 15,
                            color: active ? 'white' : 'rgba(255,255,255,0.7)',
                            fontWeight: active ? 600 : 400,
                        }}
                    />
                )}
            </ListItemButton>
        );
        return showText ? button : (
            <Tooltip key={link.path} title={link.label} placement="right">
                {button}
            </Tooltip>
        );
    };

    // Collapse/expand control — a compact chevron IconButton living in the
    // sidebar header row (req #2872: the header/footer placement option was removed;
    // the control is always in the header).
    const collapseChevron = collapsed
        ? <ChevronRightIcon sx={{ fontSize: 18 }} />
        : <ChevronLeftIcon sx={{ fontSize: 18 }} />;
    const collapseLabel = collapsed ? 'Expand' : 'Collapse';

    const renderHeaderCollapse = (showText) => (
        <Tooltip title={collapseLabel} placement="right">
            <IconButton
                onClick={() => setCollapsed(c => !c)}
                size="small"
                data-testid="navbar-collapse-toggle"
                aria-label={collapseLabel}
                sx={{
                    p: 0.25,
                    ml: showText ? 'auto' : 0,
                    color: 'rgba(255,255,255,0.7)',
                    '&:hover': { color: 'white', bgcolor: 'rgba(255,255,255,0.08)' },
                }}
            >
                {collapseChevron}
            </IconButton>
        </Tooltip>
    );

    // ── Desktop: sidebar with in-navbar collapse control ──
    if (isDesktop) {
        const showText = !collapsed;
        const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

        return (
            <>
                {isDev && <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, height: '4px', bgcolor: DEV_ORANGE, zIndex: 1300 }} />}
                <Box
                    className="app-navbar"
                    sx={{ width, flexShrink: 0, transition: 'width 0.2s ease', height: '100vh', position: 'sticky', top: 0 }}
                >
                    <Box sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100vh',
                        bgcolor: 'black',
                        color: 'white',
                        overflow: 'hidden',
                        width,
                        transition: 'width 0.2s ease',
                    }}>
                            {/* Bicycle menu trigger + Darwin title (+ header collapse chevron) */}
                            <Box sx={{
                                px: 1.5,
                                py: 1.5,
                                display: 'flex',
                                flexDirection: showText ? 'row' : 'column',
                                alignItems: 'center',
                                gap: 0.75,
                            }}>
                                <IconButton
                                    onClick={handleBikeClick}
                                    size="small"
                                    data-testid="bike-menu-button"
                                    sx={{
                                        p: 0.25,
                                        color: ACCENT,
                                        '&:hover': { bgcolor: 'rgba(233,30,99,0.12)' },
                                    }}
                                >
                                    <PROFILE_LINK.icon sx={{ fontSize: 20 }} />
                                </IconButton>
                                {showText && (
                                    <Link to="/" style={{ textDecoration: 'none' }}>
                                        <Typography sx={{ color: 'white', fontSize: 19, fontFamily: 'Roboto', fontWeight: 500 }}>
                                            Darwin
                                        </Typography>
                                    </Link>
                                )}
                                {renderHeaderCollapse(showText)}
                            </Box>

                            {/* Primary nav links */}
                            <List sx={{ pt: 0, pb: 0 }}>
                                {visibleGroups.map((group) => {
                                    const groupLinks = visibleLinks.filter(l => l.group === group.id);
                                    // A group is collapsible only when its header is visible
                                    // (expanded sidebar + non-empty label). The calendar group
                                    // has no label, so its single link always shows.
                                    const hasHeader = showText && !!group.label;
                                    const isCollapsed = hasHeader && !!collapsedGroups[group.id];
                                    return (
                                        <React.Fragment key={group.id}>
                                            {hasHeader && (
                                                <ListSubheader
                                                    onClick={() => toggleGroup(group.id)}
                                                    data-testid={`nav-group-header-${group.id}`}
                                                    role="button"
                                                    aria-expanded={!isCollapsed}
                                                    sx={{
                                                        bgcolor: 'transparent',
                                                        color: 'rgba(255,255,255,0.5)',
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                        letterSpacing: 1.5,
                                                        lineHeight: '28px',
                                                        pl: 1.5,
                                                        pr: 1,
                                                        mt: 0.5,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        cursor: 'pointer',
                                                        userSelect: 'none',
                                                        '&:hover': { color: 'rgba(255,255,255,0.85)' },
                                                    }}
                                                >
                                                    {group.label}
                                                    {isCollapsed
                                                        ? <ExpandMoreIcon sx={{ fontSize: 16 }} />
                                                        : <ExpandLessIcon sx={{ fontSize: 16 }} />
                                                    }
                                                </ListSubheader>
                                            )}
                                            {hasHeader ? (
                                                <Collapse in={!isCollapsed} timeout="auto" unmountOnExit>
                                                    {groupLinks.map((link) => renderNavItem(link, showText))}
                                                </Collapse>
                                            ) : (
                                                groupLinks.map((link) => renderNavItem(link, showText))
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </List>

                            {/* Dev server indicator — dev builds only, never included in production */}
                            {isDev && showText && (
                                <Box sx={{
                                    mx: 1.5,
                                    mb: 1.5,
                                    mt: 1,
                                    px: 1.25,
                                    py: 0.75,
                                    border: `1px solid ${DEV_ORANGE}`,
                                    borderRadius: 1,
                                    flexShrink: 0,
                                }}>
                                    <Typography sx={{
                                        fontSize: 15,
                                        fontWeight: 700,
                                        color: DEV_ORANGE,
                                        letterSpacing: 0.5,
                                        textTransform: 'uppercase',
                                        lineHeight: 1.4,
                                    }}>
                                        Dev Server
                                    </Typography>
                                    {currentDevTerminal != null && (
                                        <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', lineHeight: 1.4 }}
                                                    data-testid="navbar-dev-terminal">
                                            Terminal - {currentDevTerminal}
                                        </Typography>
                                    )}
                                    {/* Active DB — orange + (PROD) suffix when dev is pointing at production (req #2683) */}
                                    <Typography sx={{
                                        fontSize: 12,
                                        color: database === 'darwin' ? DEV_ORANGE : 'rgba(255,255,255,0.9)',
                                        fontWeight: database === 'darwin' ? 700 : 400,
                                        lineHeight: 1.4,
                                    }} data-testid="navbar-dev-database">
                                        DB - {database}{database === 'darwin' ? ' (PROD)' : ''}
                                    </Typography>
                                    {DEV_REQ_ID && (
                                        <Typography sx={{ fontSize: 12, lineHeight: 1.4 }}>
                                            {/* Dev servers run against the darwin_dev debug DB where this
                                                requirement may not exist, so link to production darwin.one
                                                (req #2757) instead of the relative — local — origin. */}
                                            <a href={prodRequirementUrl(DEV_REQ_ID)}
                                               target="_blank" rel="noopener noreferrer"
                                               style={{ color: '#90CAF9', textDecoration: 'none' }}
                                               data-testid="navbar-dev-req-link">
                                                Req - {DEV_REQ_ID}
                                            </a>
                                        </Typography>
                                    )}
                                    {DEV_REQ_TITLE && (
                                        <Typography sx={{
                                            fontSize: 12,
                                            color: 'rgba(255,255,255,0.9)',
                                            lineHeight: 1.4,
                                            whiteSpace: 'normal',
                                            wordBreak: 'break-word',
                                            mt: 1.4,
                                            mb: 1.4,
                                            px: 0.5,
                                        }}>
                                            {DEV_REQ_TITLE.slice(0, 35)}
                                        </Typography>
                                    )}
                                    <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', lineHeight: 1.4 }}>
                                        Port - {window.location.port || '3000'}
                                    </Typography>
                                </Box>
                            )}

                    </Box>
                </Box>
                {profileDialog}
            </>
        );
    }

    // ── Mobile: top bar with bicycle + bottom nav ──
    const bottomNavValue = visibleLinks.findIndex(l => isActive(l.path));

    return (
        <>
            {/* Slim top bar */}
            <AppBar
                position="static"
                className="app-navbar"
                sx={{ bgcolor: 'black', borderTop: DEV_BORDER }}
            >
                <Toolbar variant="dense" sx={{ minHeight: 48 }}>
                    <IconButton
                        edge="start"
                        onClick={handleBikeClick}
                        data-testid="bike-menu-button"
                        sx={{ color: ACCENT }}
                    >
                        <PROFILE_LINK.icon />
                    </IconButton>
                    <Link to="/" style={{ textDecoration: 'none', marginLeft: 8 }}>
                        <Typography sx={{ color: 'white', fontSize: 18, fontFamily: 'Roboto', fontWeight: 500 }}>
                            Darwin
                        </Typography>
                    </Link>
                </Toolbar>
            </AppBar>

            {/* Profile dialog */}
            {profileDialog}

            {/* Bottom navigation — all 5 primary links */}
            <Paper
                sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1200 }}
                elevation={3}
            >
                <BottomNavigation
                    value={bottomNavValue >= 0 ? bottomNavValue : false}
                    onChange={(_, newValue) => {
                        navigate(visibleLinks[newValue].path);
                    }}
                    sx={{
                        bgcolor: '#111',
                        '& .MuiBottomNavigationAction-root': {
                            color: 'rgba(255,255,255,0.5)',
                            minWidth: 'auto',
                            px: 0.5,
                        },
                        '& .Mui-selected': {
                            color: ACCENT,
                        },
                    }}
                >
                    {visibleLinks.map((link) => {
                        const Icon = link.icon;
                        // Mirror the desktop grey-out for an empty Dev Servers table (req #3005).
                        const greyed = link.path === '/devservers' && devServersEmpty;
                        return (
                            <BottomNavigationAction
                                key={link.path}
                                label={link.label}
                                icon={<Icon />}
                                sx={greyed ? { opacity: 0.4 } : undefined}
                            />
                        );
                    })}
                </BottomNavigation>
            </Paper>
        </>
    );
};

export default NavBarSidebar;
