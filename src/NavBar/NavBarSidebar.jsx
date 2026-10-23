import React, { useContext, useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthContext from '../Context/AuthContext';
import { useDevServers } from '../hooks/useDataQueries';
import {
    NAV_GROUPS, NAV_LINKS, PROFILE_LINK, flattenNavLinks, DEV_HOME_ROUTE,
    SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH, isGroupVisible,
} from './navConfig';
import {
    loadCollapsedGroups, persistCollapsedGroups, toggleGroupCollapsed,
    loadExpandedItems, persistExpandedItems, toggleItemExpanded,
    devCollapsedGroupsKey, defaultCollapsedGroups, iconModeLinks,
} from './navCollapse';
import ProfileDialog from './ProfileDialog';
import { usePanelRackStore } from '../stores/usePanelRackStore';
import { useRequirementFilerStore } from '../stores/useRequirementFilerStore';
import { RACK_DRAG_Z, RACK_SX, rackGlow } from '../Components/AnchoredPanel/panelRack';

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
import PostAddIcon from '@mui/icons-material/PostAdd';
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
// Req #3589 — a dev server keeps its group map under a per-session key (see
// navCollapse.js) and seeds it collapsed-except-the-working-area.
const COLLAPSED_GROUPS_STORAGE_KEY = isDev ? devCollapsedGroupsKey(DEV_REQ_ID, DEV_HOME_ROUTE) : undefined;

const NavBarSidebar = () => {
    const { idToken, profile } = useContext(AuthContext);
    const location = useLocation();
    const navigate = useNavigate();
    const isDesktop = useMediaQuery('(min-width:900px)');

    const [collapsed, setCollapsed] = useState(false);
    const [profileDialogOpen, setProfileDialogOpen] = useState(false);
    const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

    // The panel rack (req #3720): Action Popups (AnchoredPanel
    // hosts naming a rackId — the Dev Servers dashboard) dragged onto the
    // navbar lock in below the nav buttons, at the navbar's width, stacked in
    // rack order. The navbar publishes its rack slot while it is drawn (before
    // paint, so a racked panel never flashes at its floating dock first). A
    // drag changes nothing here until the panel is over the navbar; then, and
    // only then, its edges glow in the panel's frame colour (req #3728).
    // No text, no landing zone, no outline: the drop lands where the pointer
    // is against the stack (rackDropIndex).
    const [rackNode, setRackNode] = useState(null);
    const setRackSlot = usePanelRackStore(s => s.setSlot);
    useLayoutEffect(() => {
        setRackSlot(rackNode ? { node: rackNode, width: sidebarWidth } : null);
    }, [rackNode, sidebarWidth, setRackSlot]);
    useLayoutEffect(() => () => setRackSlot(null), [setRackSlot]);
    // A page that shows its own toolbar (AI Architecture) takes the rack while
    // it is drawn (req #3792): the navbar is then no drop zone — the drag is
    // that toolbar's to show.
    const rackDrag = usePanelRackStore(s => (s.pageSlot ? null : s.drag));
    const rackOver = !!rackDrag?.over;
    // `?rack=<id>,<id>…` (req #3821): a link that lands with those Action
    // Popups' rack places taken, in that order, at the bottom of the stack —
    // so a page can be opened with its popups racked (a dev server's deep
    // link). It places, it does not show: a popup hidden on the route (the
    // Filer until `?filer=`, a dashboard closed by ×, the Plan's boxes off a
    // plan) stays hidden. Once per landing on the parameter.
    const rackParam = new URLSearchParams(location.search).get('rack');
    useEffect(() => {
        if (!rackParam) return;
        const { rack } = usePanelRackStore.getState();
        rackParam.split(',').map(s => s.trim()).filter(Boolean).forEach(id => rack(id));
    }, [rackParam]);

    // Per-group collapsed state (req #2869). Clicking a group header hides/shows
    // its child links — purely visual, routes are unaffected. Seeded from and
    // persisted to localStorage so the choice survives reloads.
    // A dev server with nothing stored starts with every group collapsed except
    // the one(s) owning its working area and the route this tab opened on
    // (req #3589); production keeps the all-open default.
    const [collapsedGroups, setCollapsedGroups] = useState(() => loadCollapsedGroups(
        COLLAPSED_GROUPS_STORAGE_KEY,
        isDev ? defaultCollapsedGroups(NAV_GROUPS, NAV_LINKS, [DEV_HOME_ROUTE, location.pathname]) : {},
    ));
    // Persist outside the reducer so the localStorage write stays a clean
    // side effect (and doesn't double-fire under StrictMode's reducer replay).
    useEffect(() => {
        persistCollapsedGroups(collapsedGroups, COLLAPSED_GROUPS_STORAGE_KEY);
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

    // Whether the dev-server table is empty, so the Dev Servers nav link can
    // grey out (req #3005) — in ALL environments. Lightweight, user-scoped GET;
    // 60s staleTime keeps it to roughly one refetch per minute. (This dev
    // server's own details are the Dev Server panel's — DevServerActionPopup.)
    const { data: devServersArray } = useDevServers(profile?.userName, {
        enabled: !!profile?.userName,
        staleTime: 60_000,
    });
    // Grey out the Dev Servers link when its table has no rows. Dev-server records
    // are ephemeral (we don't keep history), so an empty table means "nothing
    // running" — the only nav item that behaves this way. `undefined` (loading)
    // is deliberately NOT treated as empty to avoid a grey flash on first paint.
    const devServersEmpty = Array.isArray(devServersArray) && devServersArray.length === 0;

    // Filter nav groups/links by the profile app toggles — or, on a dev server
    // scoped to its session's applications, by that scope (req #3790). One
    // predicate, shared with HomePage and the dev-server dashboard.
    const isGroupEnabled = (id) => isGroupVisible(profile, id);
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
        // Every other link matches itself OR a `/`-delimited sub-route of
        // itself (`/swarm/testruns/42` for the `/swarm/testruns` link) —
        // never a mere STRING prefix. A bare `startsWith` matched
        // `/swarm/initiativesN` against the `/swarm/initiatives` link (code review, req
        // #3393): a plan-layer editor whose path happens to extend another
        // link's path by an unrelated suffix lit up both nav rows, and the
        // mobile bottom nav — which takes the FIRST match in flattened order
        // — selected the wrong one outright.
        return location.pathname === path || location.pathname.startsWith(`${path}/`);
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
    // Full-width sidebar only — icon-only mode renders the flat iconModeLinks
    // list instead (req #3590).
    const renderNavTreeItem = (link, showText) => {
        const children = link.children ?? [];
        if (!children.length) return renderNavItem(link, showText);

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

    // The Requirement Filer's control (req #3811): opens — or closes — the
    // Action Popup that files a requirement from whatever page this is.
    const filerShown = useRequirementFilerStore(s => s.show);
    const toggleFiler = useRequirementFilerStore(s => s.toggleShow);
    const filerLabel = filerShown ? 'Close the Requirement Filer' : 'File a requirement';
    const renderFilerControl = (showText) => (
        <Tooltip title={filerLabel} placement="right">
            <IconButton
                onClick={toggleFiler}
                size="small"
                data-testid="navbar-requirement-filer"
                aria-label={filerLabel}
                aria-pressed={filerShown}
                sx={{
                    p: 0.25,
                    ml: showText ? 'auto' : 0,
                    color: filerShown ? ACCENT : 'rgba(255,255,255,0.7)',
                    '&:hover': { color: 'white', bgcolor: 'rgba(255,255,255,0.08)' },
                }}
            >
                <PostAddIcon sx={{ fontSize: 18 }} />
            </IconButton>
        </Tooltip>
    );

    const renderHeaderCollapse = (showText) => (
        <Tooltip title={collapseLabel} placement="right">
            <IconButton
                onClick={() => setCollapsed(c => !c)}
                size="small"
                data-testid="navbar-collapse-toggle"
                aria-label={collapseLabel}
                sx={{
                    p: 0.25,
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
        const width = sidebarWidth;

        return (
            <>
                {isDev && <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, height: '4px', bgcolor: DEV_ORANGE, zIndex: 1300 }} />}
                <Box
                    className="app-navbar"
                    data-panel-rack-zone=""
                    data-testid="navbar-rack-zone"
                    data-rack-drop={rackDrag ? (rackOver ? 'over' : 'armed') : 'off'}
                    sx={{ width, flexShrink: 0, transition: 'width 0.2s ease', height: '100vh', position: 'sticky', top: 0,
                          // A racked panel dragged out is drawn fixed from in
                          // here: lift the navbar so it stays above the page.
                          ...(rackDrag?.fromRack && { zIndex: RACK_DRAG_Z }) }}
                >
                    <Box sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100vh',
                        bgcolor: 'black',
                        color: 'white',
                        overflow: 'hidden',
                        width,
                        transition: 'width 0.2s ease, box-shadow 0.12s',
                        // The drop glow: a panel over us, eligible to drop.
                        ...(rackOver && {
                            boxShadow: rackGlow(rackDrag.color),
                        }),
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
                                {renderFilerControl(showText)}
                                {renderHeaderCollapse(showText)}
                            </Box>

                            {/* Primary nav links. Icon-only mode has no room for
                                headers or +/- toggles, so it shows the same links
                                the full-width sidebar does — collapsed groups and
                                unexpanded L3s stay hidden — as a flat icon strip
                                (req #3590). */}
                            {/* The nav options come first: the nav list takes all
                                the height it wants and never scrolls on the racked
                                panels' account; the rack gets what is left (req #3751,
                                reversing #3744's 40vh cap). Only a nav list taller than
                                the navbar itself scrolls: this column, with nothing
                                left for the rack. */}
                            <Box data-testid="navbar-body" data-rack-clip=""
                                 sx={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column',
                                       overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin' }}>
                                <List data-testid="navbar-nav-list" sx={{ pt: 0, pb: 0, flex: '0 0 auto' }}>
                                    {!showText && iconModeLinks(visibleGroups, visibleLinks, collapsedGroups, expandedItems)
                                        .map((link) => renderNavItem(link, showText))}
                                    {showText && visibleGroups.map((group) => {
                                        const groupLinks = visibleLinks.filter(l => l.group === group.id);
                                        // A group is collapsible only when it has a header
                                        // (non-empty label). The calendar group has no label,
                                        // so its single link always shows.
                                        const hasHeader = !!group.label;
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

                                {/* The panel rack (req #3720): racked panels portal
                                    into the `display: contents` slot and stack in rack
                                    order, each only as tall as its content (req #3747),
                                    the rack shrinking — it alone — to the height the
                                    nav list leaves (req #3751). RACK_SX: one box for
                                    every rack, a page toolbar's too (req #3792). */}
                                <Box data-testid="navbar-rack" sx={RACK_SX}>
                                    <Box ref={setRackNode} data-testid="navbar-rack-slot" sx={{ display: 'contents' }} />
                                </Box>
                            </Box>

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
