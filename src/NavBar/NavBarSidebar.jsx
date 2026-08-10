import React, { useContext, useState, useMemo, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { useDevServers } from '../hooks/useDataQueries';
import {
    NAV_GROUPS, NAV_LINKS, PROFILE_LINK, flattenNavLinks,
    SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH, GROUP_PROFILE_KEY, GROUP_PROFILE_DEFAULT,
} from './navConfig';
import {
    loadCollapsedGroups, persistCollapsedGroups, toggleGroupCollapsed,
    loadExpandedItems, persistExpandedItems, toggleItemExpanded,
} from './navCollapse';
import ProfileDialog from './ProfileDialog';
import { prodRequirementUrl } from '../utils/prodUrl';

import AppBar from '@mui/material/AppBar';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
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
// Req #3209 — boxed +/- marks an ITEM that expands. Deliberately not the
// ExpandLess/ExpandMore chevrons above: those already mean "group header", and
// reusing them would make the two nav levels indistinguishable at a glance.
import AddBoxOutlinedIcon from '@mui/icons-material/AddBoxOutlined';
import IndeterminateCheckBoxOutlinedIcon from '@mui/icons-material/IndeterminateCheckBoxOutlined';

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

    // Per-item expanded state (req #3209). An L2 nav item that declares
    // `children` starts CLOSED and reveals its L3s when the +/- is clicked.
    // Same persistence shape as the group map, separate storage key.
    const [expandedItems, setExpandedItems] = useState(loadExpandedItems);
    useEffect(() => {
        persistExpandedItems(expandedItems);
    }, [expandedItems]);
    const toggleItem = (path) => {
        setExpandedItems((prev) => toggleItemExpanded(prev, path));
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

    // req #3455 — the window handle comes from the dev server's OWN launching
    // shell, injected by scripts/devserver-start.sh as a Vite env var, NOT from
    // the database: `dev_servers` is pinned to production while sessions follow
    // the dev/prod split, so a DB join would be right only by coincidence.
    // The NUMBER still prefers the dev_servers row (it is the claim of record)
    // and falls back to the env var.
    const devTerminalWindowId = import.meta.env.VITE_DEV_TERMINAL_WINDOW_ID || null;
    const devTerminalNumber = currentDevTerminal
        ?? (import.meta.env.VITE_DEV_TERMINAL_NUMBER || null);
    const devTerminalLabel = devTerminalNumber != null
        ? `Terminal - ${devTerminalNumber}`
        : (devTerminalWindowId ? 'Focus terminal' : null);
    const devTerminalHref = (isDev && devTerminalWindowId)
        ? `darwin-term://focus?window=${encodeURIComponent(devTerminalWindowId)}`
          + `&label=${encodeURIComponent(devTerminalLabel || 'dev server')}`
        : null;

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
    // The nav TREE: top-level items only, each possibly carrying `children`.
    // A child is visible exactly when its parent is, so filtering the top level
    // is sufficient (req #3209).
    const visibleLinks = useMemo(() =>
        NAV_LINKS.filter(l => isGroupEnabled(l.group)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [profile]
    );
    // The same links FLATTENED — used wherever every reachable route must
    // appear in one sequence (mobile bottom nav, active-index lookup).
    const flatVisibleLinks = useMemo(() => flattenNavLinks(visibleLinks), [visibleLinks]);

    const isActive = (path) => {
        // Group-index links (/swarm, /agents) own sub-routes that share their
        // prefix (/swarm/sessions, /agents/instructions, ...). Match them EXACTLY
        // so a child route highlights only its own nav item, not the parent index
        // too (req #3013 added /agents/instructions + /agents/documents).
        if (path === '/swarm' || path === '/agents') return location.pathname === path;
        return location.pathname.startsWith(path);
    };

    // Landing on an L3 route (a bookmark, a redirect, a page link) opens its
    // parent once, so the active item is never invisible. Done as a state write
    // rather than a derived force-open so the +/- stays user-controlled
    // afterwards — closing the parent while sitting on a child page is a
    // legitimate thing to want.
    //
    // The trigger is ARRIVAL in a subtree, not every pathname change inside it.
    // Detail routes like /swarm/swarm-starts/:id are ordinary navigation (click
    // a row in the Starts grid), and keying purely on pathname would re-open a
    // parent the user had just deliberately closed. The ref remembers which
    // parent was last auto-opened; re-entering after leaving opens it again.
    const autoOpenedParentRef = useRef(null);
    useEffect(() => {
        const parent = NAV_LINKS.find(l =>
            l.children?.some(c => location.pathname.startsWith(c.path))
        );
        const parentPath = parent?.path ?? null;
        if (autoOpenedParentRef.current === parentPath) return;
        autoOpenedParentRef.current = parentPath;
        if (!parentPath) return;
        // Returning `prev` unchanged when the flag is already set keeps the
        // persist effect from re-firing (req #3209).
        setExpandedItems(prev => (prev[parentPath] ? prev : { ...prev, [parentPath]: true }));
    }, [location.pathname]);

    const handleBikeClick = () => setProfileDialogOpen(true);
    const handleProfileDialogClose = () => setProfileDialogOpen(false);

    const profileDialog = (
        <ProfileDialog open={profileDialogOpen} onClose={handleProfileDialogClose} />
    );

    // `indent` shifts an L3 child in under its parent; `reserveRight` leaves
    // room for the absolutely-positioned +/- toggle on a parent row (req #3209).
    const renderNavItem = (link, showText, { indent = false, reserveRight = false } = {}) => {
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
                    pl: showText ? (indent ? 3.5 : 1.5) : 1,
                    pr: showText ? (reserveRight ? 4 : 1.5) : 1,
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

    // Render one L2 item, plus its L3 children when it has any (req #3209).
    //
    // Icon-only mode has no room for a label, let alone a toggle, so children
    // render flat right after the parent — the same way group headers vanish
    // and their links flatten when the sidebar collapses. Every route stays
    // one click away in both modes.
    const renderNavTreeItem = (link, showText) => {
        const children = link.children ?? [];
        if (!children.length) return renderNavItem(link, showText);
        if (!showText) {
            return (
                <React.Fragment key={link.path}>
                    {renderNavItem(link, showText)}
                    {children.map(child => renderNavItem(child, showText))}
                </React.Fragment>
            );
        }

        const expanded = !!expandedItems[link.path];
        const toggleLabel = `${expanded ? 'Collapse' : 'Expand'} ${link.label}`;
        const slug = link.path.split('/').filter(Boolean).join('-');
        const subListId = `nav-sublist-${slug}`;
        return (
            <React.Fragment key={link.path}>
                {/* The toggle is a SIBLING of the link, positioned over the row's
                    right edge, not a descendant of it: a <button> nested inside
                    the ListItemButton's <a> is invalid markup and swallows the
                    click ambiguously. Overlaying keeps the active row's tint and
                    accent edge-border unbroken across the full width.
                    The trade-off is that the row's own :hover stops firing once
                    the pointer is over the toggle (it isn't an ancestor of it),
                    so the wrapper re-applies the highlight — otherwise the row
                    visibly un-highlights as you reach for the control. */}
                <Box sx={{
                    position: 'relative',
                    '&:hover .MuiListItemButton-root': { bgcolor: 'rgba(255,255,255,0.08)' },
                }}>
                    {renderNavItem(link, showText, { reserveRight: true })}
                    <Tooltip title={toggleLabel} placement="right">
                        <IconButton
                            onClick={() => toggleItem(link.path)}
                            size="small"
                            data-testid={`nav-expand-toggle-${slug}`}
                            aria-label={toggleLabel}
                            aria-expanded={expanded}
                            aria-controls={subListId}
                            sx={{
                                position: 'absolute',
                                right: 6,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                p: 0.25,
                                color: ACCENT,
                                '&:hover': { bgcolor: 'rgba(233,30,99,0.12)' },
                            }}
                        >
                            {expanded
                                ? <IndeterminateCheckBoxOutlinedIcon sx={{ fontSize: 16 }} />
                                : <AddBoxOutlinedIcon sx={{ fontSize: 16 }} />
                            }
                        </IconButton>
                    </Tooltip>
                </Box>
                <Collapse in={expanded} timeout="auto" unmountOnExit>
                    {/* `unmountOnExit` means the region only exists while open,
                        so `aria-controls` resolves exactly when there is
                        something to point at. */}
                    <List id={subListId} disablePadding component="div">
                        {children.map(child => renderNavItem(child, showText, { indent: true }))}
                    </List>
                </Collapse>
            </React.Fragment>
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
                                    aria-label="Profile"
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
                                                    {groupLinks.map((link) => renderNavTreeItem(link, showText))}
                                                </Collapse>
                                            ) : (
                                                groupLinks.map((link) => renderNavTreeItem(link, showText))
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
                                    {/* req #3455 — a working pill, not a label.
                                        This card already knew WHICH terminal the
                                        dev server runs in; it just could not take
                                        you there. Clicking focuses that iTerm2
                                        window. Falls back to plain text when no
                                        window handle was captured (a dev server
                                        started outside iterm-launch.sh), because
                                        a pill that cannot be clicked is a worse
                                        lie than a label that never promised to. */}
                                    {devTerminalLabel != null && (
                                        devTerminalHref ? (
                                            <Chip
                                                component="a"
                                                href={devTerminalHref}
                                                clickable
                                                size="small"
                                                label={devTerminalLabel}
                                                data-testid="navbar-dev-terminal"
                                                variant="outlined"
                                                sx={{
                                                    alignSelf: 'flex-start',
                                                    height: 22,
                                                    // 13px — one point up from the 12px the
                                                    // surrounding card text uses, so the one
                                                    // interactive line in the block reads as
                                                    // the primary one.
                                                    fontSize: 13,
                                                    fontWeight: 700,
                                                    // CLEAR in the centre: the ring and the
                                                    // label carry the orange, the fill stays
                                                    // transparent so the pill sits ON the dark
                                                    // card instead of punching a block out of it.
                                                    color: DEV_ORANGE,
                                                    bgcolor: 'transparent',
                                                    borderColor: DEV_ORANGE,
                                                    '& .MuiChip-label': { px: 1 },
                                                    '&:hover': {
                                                        bgcolor: 'rgba(255,255,255,0.08)',
                                                        borderColor: DEV_ORANGE,
                                                    },
                                                }}
                                            />
                                        ) : (
                                            <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', lineHeight: 1.4 }}
                                                        data-testid="navbar-dev-terminal">
                                                {devTerminalLabel}
                                            </Typography>
                                        )
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

    // ── Mobile: top bar with bottom nav ──
    // Bottom nav is a flat strip with no room for a disclosure control, so it
    // uses the FLATTENED link list — L3 items sit alongside their parent rather
    // than hiding behind it (req #3209).
    const bottomNavValue = flatVisibleLinks.findIndex(l => isActive(l.path));

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
                        aria-label="Profile"
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

            {/* Bottom navigation — every enabled nav link (count varies with the
                profile app toggles and the AGENTS group's Instructions/Documents). */}
            <Paper
                sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1200 }}
                elevation={3}
            >
                <BottomNavigation
                    value={bottomNavValue >= 0 ? bottomNavValue : false}
                    onChange={(_, newValue) => {
                        navigate(flatVisibleLinks[newValue].path);
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
                    {flatVisibleLinks.map((link) => {
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
