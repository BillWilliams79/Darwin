// DevServerInfoPanel.jsx — the navbar's Dev Server panel (req #3727): what
// this dev server is — its terminal, its database, the requirement it serves
// and its port — as a pop-up information window like the Dev Servers
// dashboard, rather than a box fixed to the bottom of the navbar.
//
// It is an AnchoredPanel (Components/AnchoredPanel) in the dashboard's own
// chrome (infoPanelChrome.js): the ▾ head and the DEV SERVER title, then its
// rows — the requirement first (req #3788), the terminal pill with the port
// pill below it (req #3748), the database. RACKED BY DEFAULT — the first time it mounts
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
    INFO_PANEL_COLORS, INFO_PANEL_FONT_PX, INFO_PANEL_HEAD_PX, INFO_PANEL_SX,
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

// Half the right padding of the left (req #3748): the title then reads wide
// right up to the frame.
const ROW_SX = { pl: '0.7em', pr: '0.35em', py: '0.15em', lineHeight: 1.45, whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis' };
const HAS_REQ = !!(DEV_REQ_ID || DEV_REQ_TITLE);

/** The info-window chrome, framed in the dev server's own orange rather than
 *  the family purple (req #3748) — the colour of its pills. */
const FRAME_COLORS = { ...INFO_PANEL_COLORS, frame: DEV_ORANGE };

const PILL_SX = { display: 'inline-block', px: '0.75em', py: '0.2em',
    border: `1px solid ${DEV_ORANGE}`, borderRadius: '999px',
    color: DEV_ORANGE, fontWeight: 700, textDecoration: 'none',
    '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' } };

/** The requirement as one line of text, `3748 - title` (req #3748): the id
 *  links to production darwin.one — dev servers run against darwin_dev, where
 *  the requirement may not exist (req #2757). */
function RequirementLine({ sx, lines }) {
    if (!HAS_REQ) return null;
    return (
        <Box data-testid="navbar-dev-req-title"
             title={[DEV_REQ_ID, DEV_REQ_TITLE].filter(Boolean).join(' - ')}
             sx={{ ...sx, whiteSpace: 'normal', overflowWrap: 'anywhere', overflow: 'hidden',
                    // A few lines at most; the tooltip has the rest.
                    display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical' }}>
            {DEV_REQ_ID && (
                <a href={prodRequirementUrl(DEV_REQ_ID)}
                   target="_blank" rel="noopener noreferrer"
                   style={{ color: '#90CAF9', textDecoration: 'none' }}
                   data-testid="navbar-dev-req-link">
                    {DEV_REQ_ID}
                </a>
            )}
            {DEV_REQ_ID && DEV_REQ_TITLE ? ' - ' : ''}{DEV_REQ_TITLE}
        </Box>
    );
}

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
        ? `Terminal ${terminalNumber}`
        : (windowId ? 'Focus terminal' : null);
    const terminalHref = windowId
        ? `darwin-term://focus?window=${encodeURIComponent(windowId)}`
          + `&label=${encodeURIComponent(terminalLabel || 'dev server')}`
        : null;
    const prod = database === 'darwin';
    // req #3748 — the dev server pill: below the terminal pill, opening this
    // dev server in a new tab (the Sessions list's Dev Server chip does the same).
    const portPill = (compact) => (
        <Box component="a" href={`https://localhost:${port}`} target="_blank" rel="noopener noreferrer"
             title={`Open port ${port} in a new tab`} data-testid="navbar-dev-port"
             sx={compact ? { ...PILL_SX, alignSelf: 'flex-start', px: '0.35em', py: 0 } : PILL_SX}>
            {port}
        </Box>
    );

    return (
        <AnchoredPanel dock={dock} onDockChange={setDock}
                       open={open} onToggle={toggleOpen}
                       name="Dev Server" testid="devserver-info"
                       rackId={DEV_INFO_RACK_ID}
                       limits={LIMITS} fontPx={INFO_PANEL_FONT_PX}
                       colors={FRAME_COLORS}
                       sx={INFO_PANEL_SX}>
            {({ shapedWidth }) => (shapedWidth != null && shapedWidth < RACK_NARROW_PX) ? (
                // The icon-only navbar (req #3739): every field the full panel
                // shows — requirement, terminal, port, database — in short form at a
                // smaller size, wrapped rather than clipped, each with its full
                // label as a tooltip.
                <Box data-testid="devserver-info-compact"
                     sx={{ px: '0.4em', py: '0.15em', fontSize: '0.8em', lineHeight: 1.35,
                            display: 'flex', flexDirection: 'column', gap: '0.5em',
                            whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                    <RequirementLine lines={4} />
                    {(terminalNumber != null || terminalHref) && (
                        <Box component={terminalHref ? 'a' : 'span'}
                             {...(terminalHref ? { href: terminalHref } : {})}
                             title={terminalLabel} data-testid="navbar-dev-terminal"
                             sx={{ color: DEV_ORANGE, fontWeight: 700, textDecoration: 'none' }}>
                            T{terminalNumber ?? '↗'}
                        </Box>
                    )}
                    {portPill(true)}
                    {/* The DB last (req #3748). */}
                    <Box data-testid="navbar-dev-database" title={`DB - ${database}${prod ? ' (PROD)' : ''}`}
                         sx={{ color: prod ? DEV_ORANGE : 'inherit', fontWeight: prod ? 700 : 400 }}>
                        {database}{prod ? ' PROD' : ''}
                    </Box>
                </Box>
            ) : (
                <>
                    {/* req #3788 — the requirement leads the window. */}
                    <RequirementLine sx={ROW_SX} lines={3} />
                    {/* req #3455 — a working pill, not a label: clicking focuses
                        the iTerm2 window this dev server runs in. Plain text when
                        no window handle was captured (a dev server started
                        outside iterm-launch.sh), because a pill that cannot be
                        clicked is a worse lie than a label that never promised to. */}
                    {/* req #3788 — white space around the pills. */}
                    <Box sx={{ ...ROW_SX, py: '0.6em', display: 'flex', flexDirection: 'column',
                               alignItems: 'flex-start', gap: '0.6em' }}>
                        {terminalLabel != null && (terminalHref ? (
                            <Box component="a" href={terminalHref}
                                 data-testid="navbar-dev-terminal" sx={PILL_SX}>
                                {terminalLabel}
                            </Box>
                        ) : (
                            <Box component="span" data-testid="navbar-dev-terminal">{terminalLabel}</Box>
                        ))}
                        {portPill(false)}
                    </Box>
                    {/* Active DB — orange + (PROD) when dev points at production
                        (req #2683). Last (req #3748). */}
                    <Box data-testid="navbar-dev-database"
                         sx={{ ...ROW_SX, pb: '0.3em',
                                color: prod ? DEV_ORANGE : 'inherit', fontWeight: prod ? 700 : 400 }}>
                        DB - {database}{prod ? ' (PROD)' : ''}
                    </Box>
                </>
            )}
        </AnchoredPanel>
    );
}
