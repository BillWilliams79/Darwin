// DevServerInfoPanel.jsx — the navbar's Dev Server panel (req #3727): what
// this dev server is — its terminal, its database, the requirement it serves
// and its port — as a pop-up information window like the Dev Servers
// dashboard, rather than a box fixed to the bottom of the navbar.
//
// It is an AnchoredPanel (Components/AnchoredPanel) in the dashboard's own
// chrome (infoPanelChrome.js): the ▾ head, an orange port badge and the
// DEV SERVER title, then its rows. RACKED BY DEFAULT — the first time it mounts
// in a browser it is seeded into the navbar's panel rack (usePanelRackStore
// .seed), so it sits docked in the navbar as the old box did, stacked with any
// other racked panel. Drag its head off the navbar and it floats, moves,
// reshapes and collapses like any other; drag it back to rack it again. Where
// the reader leaves it is theirs from then on.
//
// Dev builds only (never drawn in production) and desktop only, as before.

import { useContext, useLayoutEffect, useMemo } from 'react';

import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';

import AnchoredPanel from '../Components/AnchoredPanel/AnchoredPanel';
import { validDock } from '../Components/AnchoredPanel/anchoredPanelGeometry';
import {
    INFO_PANEL_BADGE_EM, INFO_PANEL_COLORS, INFO_PANEL_FONT_PX, INFO_PANEL_HEAD_PX, INFO_PANEL_SX,
} from '../Components/AnchoredPanel/infoPanelChrome';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { useDevServers } from '../hooks/useDataQueries';
import { RACK_NARROW_PX } from '../Components/AnchoredPanel/panelRack';
import { usePanelRackStore } from '../stores/usePanelRackStore';
import { useDevServerInfoStore } from '../stores/useDevServerInfoStore';
import { prodRequirementUrl } from '../utils/prodUrl';
import { SIDEBAR_WIDTH } from './navConfig';

const DEV_ORANGE = '#FF6B35';
const isDev = import.meta.env.MODE === 'development';
const DEV_REQ_ID = isDev ? (import.meta.env.VITE_DEV_REQ_ID || '') : '';
const DEV_REQ_TITLE = isDev ? (import.meta.env.VITE_DEV_REQ_TITLE || '') : '';

/** Its id in the navbar's panel rack. */
export const DEV_INFO_RACK_ID = 'devserver-info';
const MIN_W = 120;
const MIN_H = 64;
const LIMITS = { minW: MIN_W, minH: MIN_H, autoMaxW: 320, headPx: INFO_PANEL_HEAD_PX };
/** Floating home: bottom-left, just clear of the full-width navbar. */
const HOME = Object.freeze({ h: 'l', x: SIDEBAR_WIDTH + 16, v: 'b', y: 16, w: null, ht: null });

const ROW_SX = { px: '0.7em', py: '0.15em', lineHeight: 1.45, whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis' };

export default function DevServerInfoPanel() {
    const { profile } = useContext(AuthContext);
    const { database } = useContext(AppContext);
    const isDesktop = useMediaQuery('(min-width:900px)');
    const open = useDevServerInfoStore(s => s.open);
    const storedDock = useDevServerInfoStore(s => s.dock);
    const { toggleOpen, setDock } = useDevServerInfoStore.getState();
    const dock = validDock(storedDock, MIN_W, MIN_H) || HOME;
    const visible = isDev && isDesktop;

    // Docked in the navbar until the reader moves it (before paint, so it
    // never flashes at its floating home first).
    useLayoutEffect(() => {
        if (visible) usePanelRackStore.getState().seed(DEV_INFO_RACK_ID);
    }, [visible]);

    // This dev server's terminal_number, matched by the browser's port. The
    // same user-scoped read the navbar makes (shared cache); the number is
    // effectively immutable for a claim's life, hence the 60s staleTime.
    const { data: devServers } = useDevServers(profile?.userName, {
        enabled: visible && !!profile?.userName,
        staleTime: 60_000,
    });
    // Matched on the REAL port only; '3000' is the display fallback.
    const realPort = parseInt(window.location.port || '0', 10) || null;
    const port = String(realPort ?? 3000);
    const claimTerminal = useMemo(() => {
        if (!devServers || !realPort) return null;
        const row = devServers.find(s => s.port === realPort);
        return row?.terminal_number ?? null;
    }, [devServers, realPort]);

    if (!visible) return null;

    // req #3455 — the window handle comes from the dev server's OWN launching
    // shell, injected by scripts/devserver-start.sh as a Vite env var, NOT from
    // the database: `dev_servers` is pinned to production while sessions follow
    // the dev/prod split, so a DB join would be right only by coincidence.
    // The NUMBER still prefers the dev_servers row (it is the claim of record)
    // and falls back to the env var.
    const windowId = import.meta.env.VITE_DEV_TERMINAL_WINDOW_ID || null;
    const terminalNumber = claimTerminal ?? (import.meta.env.VITE_DEV_TERMINAL_NUMBER || null);
    const terminalLabel = terminalNumber != null
        ? `Terminal - ${terminalNumber}`
        : (windowId ? 'Focus terminal' : null);
    const terminalHref = windowId
        ? `darwin-term://focus?window=${encodeURIComponent(windowId)}`
          + `&label=${encodeURIComponent(terminalLabel || 'dev server')}`
        : null;
    const prod = database === 'darwin';

    return (
        <AnchoredPanel dock={dock} onDockChange={setDock}
                       open={open} onToggle={toggleOpen}
                       name="Dev Server" testid="devserver-info"
                       rackId={DEV_INFO_RACK_ID}
                       limits={LIMITS} fontPx={INFO_PANEL_FONT_PX}
                       colors={INFO_PANEL_COLORS}
                       sx={INFO_PANEL_SX}
                       extras={
                           // The port is what names a dev server everywhere in
                           // Darwin — the badge stays even in the icon-only navbar.
                           <Box component="span" data-testid="devserver-info-port"
                                title={`Port ${port}`}
                                sx={{ display: 'inline-flex', alignItems: 'center',
                                       justifyContent: 'center', flexShrink: 0,
                                       // Tight enough for four digits in the
                                       // icon-only navbar's 64px.
                                       height: INFO_PANEL_BADGE_EM, px: '0.15em', fontSize: '0.9em',
                                       boxSizing: 'border-box', borderRadius: '999px',
                                       border: `1px solid ${DEV_ORANGE}`, color: DEV_ORANGE,
                                       fontWeight: 700, lineHeight: 1 }}>
                               {port}
                           </Box>
                       }>
            {({ shapedWidth }) => (shapedWidth != null && shapedWidth < RACK_NARROW_PX) ? (
                // The icon-only navbar (req #3739): every field the full panel
                // shows — terminal, database, requirement, title, port — in
                // short form at a smaller size, wrapped rather than clipped,
                // each with its full label as a tooltip.
                <Box data-testid="devserver-info-compact"
                     sx={{ px: '0.4em', py: '0.15em', fontSize: '0.8em', lineHeight: 1.35,
                            display: 'flex', flexDirection: 'column', gap: '0.25em',
                            whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                    {(terminalNumber != null || terminalHref) && (
                        <Box component={terminalHref ? 'a' : 'span'}
                             {...(terminalHref ? { href: terminalHref } : {})}
                             title={terminalLabel} data-testid="navbar-dev-terminal"
                             sx={{ color: DEV_ORANGE, fontWeight: 700, textDecoration: 'none' }}>
                            T{terminalNumber ?? '↗'}
                        </Box>
                    )}
                    <Box data-testid="navbar-dev-database" title={`DB - ${database}${prod ? ' (PROD)' : ''}`}
                         sx={{ color: prod ? DEV_ORANGE : 'inherit', fontWeight: prod ? 700 : 400 }}>
                        {database}{prod ? ' PROD' : ''}
                    </Box>
                    {DEV_REQ_ID && (
                        <a href={prodRequirementUrl(DEV_REQ_ID)}
                           target="_blank" rel="noopener noreferrer" title={`Req - ${DEV_REQ_ID}`}
                           style={{ color: '#90CAF9', textDecoration: 'none' }}
                           data-testid="navbar-dev-req-link">
                            #{DEV_REQ_ID}
                        </a>
                    )}
                    {DEV_REQ_TITLE && (
                        <Box data-testid="navbar-dev-req-title" title={DEV_REQ_TITLE}
                             sx={{ overflow: 'hidden',
                                    // Four short lines — about the original
                                    // badge's 35 characters; the tooltip has the rest.
                                    display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
                            {DEV_REQ_TITLE}
                        </Box>
                    )}
                    <Box data-testid="navbar-dev-port" title={`Port - ${port}`}>:{port}</Box>
                </Box>
            ) : (
                <>
                    {/* req #3455 — a working pill, not a label: clicking focuses
                        the iTerm2 window this dev server runs in. Plain text when
                        no window handle was captured (a dev server started
                        outside iterm-launch.sh), because a pill that cannot be
                        clicked is a worse lie than a label that never promised to. */}
                    {terminalLabel != null && (
                        <Box sx={{ ...ROW_SX, py: '0.3em' }}>
                            {terminalHref ? (
                                <Box component="a" href={terminalHref}
                                     data-testid="navbar-dev-terminal"
                                     sx={{ display: 'inline-block', px: '0.6em', py: '0.1em',
                                            border: `1px solid ${DEV_ORANGE}`, borderRadius: '999px',
                                            color: DEV_ORANGE, fontWeight: 700, textDecoration: 'none',
                                            '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' } }}>
                                    {terminalLabel}
                                </Box>
                            ) : (
                                <Box component="span" data-testid="navbar-dev-terminal">{terminalLabel}</Box>
                            )}
                        </Box>
                    )}
                    {/* Active DB — orange + (PROD) when dev points at production (req #2683) */}
                    <Box data-testid="navbar-dev-database"
                         sx={{ ...ROW_SX, color: prod ? DEV_ORANGE : 'inherit', fontWeight: prod ? 700 : 400 }}>
                        DB - {database}{prod ? ' (PROD)' : ''}
                    </Box>
                    {DEV_REQ_ID && (
                        <Box sx={ROW_SX}>
                            {/* Dev servers run against darwin_dev, where this
                                requirement may not exist, so it links to
                                production darwin.one (req #2757). */}
                            <a href={prodRequirementUrl(DEV_REQ_ID)}
                               target="_blank" rel="noopener noreferrer"
                               style={{ color: '#90CAF9', textDecoration: 'none' }}
                               data-testid="navbar-dev-req-link">
                                Req - {DEV_REQ_ID}
                            </a>
                        </Box>
                    )}
                    {DEV_REQ_TITLE && (
                        <Box data-testid="navbar-dev-req-title" title={DEV_REQ_TITLE}
                             sx={{ ...ROW_SX, whiteSpace: 'normal', wordBreak: 'break-word',
                                    // Three lines at most; the tooltip has the rest.
                                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                            {DEV_REQ_TITLE}
                        </Box>
                    )}
                    {/* The original badge's last line (req #3739) — the head
                        badge alone is a bare number. */}
                    <Box data-testid="navbar-dev-port" sx={{ ...ROW_SX, pb: '0.3em' }}>
                        Port - {port}
                    </Box>
                </>
            )}
        </AnchoredPanel>
    );
}
