// DevServerDashboard.jsx — the Dev Servers dashboard (req #3643): the Plan
// visualizer's "Orchestration Ready" box (UnorchestratedReqBox, req #3583),
// duplicated for dev servers and docked to the Darwin VIEWPORT rather than to a
// canvas pane — so it floats over every page, and the reader moves it,
// reshapes it and collapses it until it sits where they want it.
//
// The floating, docking, reshaping and collapsing are AnchoredPanel's
// (Components/AnchoredPanel, pattern doc memory/anchored-collapse-pattern.md):
// its head row is the Topology visualizer's ▾, the epic card's green count
// badge and the DEV SERVERS title, left-aligned, then × at the far right —
// folded, × follows the title and the panel pulls in tight around them; the
// head is the top row and its ▾ never moves when clicked. By
// default the panel is exactly as big as its rows, on both axes.
//
// ── THE SAME BOX ───────────────────────────────────────────────────────────
// Same dark panel, same strong purple outline. A row reads (user directive):
// terminal and port as ONE two-sided pill (req #3748, the Sessions list's
// Model/Effort pill) · the requirement's title, in fixed columns so they line
// up row to row. No machine colour bar (req #3748): the rows are this
// machine's, so every bar was the same colour and said nothing. No bug #
// (req #3689) — the title already says which requirement it is. At the
// smallest, the title goes too; the pill never does. Which rows appear, and which link, is
// devServerDashboardRows' rule (see devServerDashboardModel.js). The server
// this page is served from is the highlighted row.
//
// Where it sits, its shape, whether it is expanded and whether it is shown at
// all are remembered per browser (useDevServerDashboardStore); × hides it and
// the Dev Servers page's "Show dashboard" chip brings it back.
//
// RACKABLE (req #3720): drag its head onto the Darwin navbar and it locks in
// below the nav buttons at the navbar's width (AnchoredPanel's rack); drag it
// off again to float it. Whether it is racked is the rack's (usePanelRackStore).

import { useContext, useMemo } from 'react';

import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';

import AnchoredPanel from '../Components/AnchoredPanel/AnchoredPanel';
import { ActionPopupBadge, ActionPopupClose } from '../Components/AnchoredPanel/ActionPopupHead';
import {
    ACTION_POPUP_COLORS, ACTION_POPUP_FONT_PX, ACTION_POPUP_HEAD_PX, ACTION_POPUP_SX,
} from '../Components/AnchoredPanel/actionPopupChrome';
import { validDock } from '../Components/AnchoredPanel/anchoredPanelGeometry';
import AuthContext from '../Context/AuthContext';
import { useDevServerRequirementTitles, useDevServerSessionTerminals, useDevServers, useMachines } from '../hooks/useDataQueries';
import { isGroupVisible } from '../NavBar/navConfig';
import { useDevServerDashboardStore } from '../stores/useDevServerDashboardStore';
import { PLAN_VIZ_PALETTE as P } from '../SwarmView/pipelines/pipelinePlanLayout';
import {
    DASH_AUTO_MAX_W, DASH_HOME, DASH_MIN_H, DASH_MIN_W, DASH_PILL_WIDE_W, DASH_RACK_ID,
    DASH_STACK_W, DASH_TINY_W,
    devServerDashboardRows, withRequirementTitles, withTerminalLinks,
} from './devServerDashboardModel';

const FONT_PX = ACTION_POPUP_FONT_PX;
const LIMITS = { minW: DASH_MIN_W, minH: DASH_MIN_H, autoMaxW: DASH_AUTO_MAX_W, headPx: ACTION_POPUP_HEAD_PX };

const HALF_SX = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    whiteSpace: 'nowrap',
};
const HALF_HOVER = { '&:hover': { bgcolor: 'rgba(255,255,255,0.14)' } };

/**
 * The rows' columns. The pills line up row to row because every row lays its
 * cells out on ONE grid (each row and each side-by-side pill is a `subgrid`
 * of it): the terminal half, the seam and the port half are columns as wide
 * as their widest cell, then the title. A per-half minimum width cannot do
 * this — it was measured not to (req #3783): `ch` here is narrower than the
 * mono font's own glyphs (7ch = 50.56px, "Term 10" = 51.63px at 12px), and
 * with Darwin's border-box sizing a minimum that holds the padding too was
 * below every real label, so "Term 10", "Term 3" and "—" drew three widths.
 * Stacked, the pill is one column and the halves stretch across it.
 */
function rowColumns(stacked, tiny) {
    const cols = stacked ? ['auto'] : ['auto', '1px', 'auto'];
    if (!tiny) cols.push('minmax(0, 1fr)');
    return cols.join(' ');
}

/**
 * Terminal and port as ONE pill in two halves (req #3748) — the Sessions
 * list's Model/Effort pill (ModelEffortPill), outlined for this dark panel.
 * BOTH halves work: the terminal half focuses its iTerm2 window (req #3668)
 * and the port half is the row's own link, so it opens the dev server.
 *
 * `size` — 'wide' spells "Term 2" (content-sized, or shaped wide enough to
 * show it beside the title); 'short' says "T2" (shaped narrower); 'stacked'
 * puts the halves one over the other at a smaller size, for widths too narrow
 * for them side by side — the icon-only navbar rack among them. Side by side,
 * the pill is a subgrid of the rows' columns (rowColumns), so its halves line
 * up row to row; an absent terminal is a dim dash rather than an empty half.
 */
function TerminalPortPill({ r, size }) {
    const stacked = size === 'stacked';
    const wide = size === 'wide';
    const pad = stacked ? '0.25em' : '0.5em';
    const termText = r.terminal != null ? `${wide ? 'Term ' : 'T'}${r.terminal}` : '—';
    const focus = (e) => {
        e.preventDefault(); e.stopPropagation();
        window.location.assign(r.terminalHref);
    };
    return (
        <Box component="span" data-testid={`devserver-dashboard-pill-${r.key}`}
             data-size={size}
             sx={{ ...(stacked
                        ? { display: 'flex', flexDirection: 'column', alignItems: 'stretch',
                            gridColumn: '1', fontSize: '0.8em' }
                        : { display: 'grid', gridColumn: '1 / span 3',
                            gridTemplateColumns: 'subgrid' }),
                    border: `1px solid ${P.dim}`, borderRadius: stacked ? '0.6em' : '999px',
                    overflow: 'hidden', lineHeight: 1.35 }}>
            <Box component="span" data-testid={`devserver-dashboard-term-${r.key}`}
                 {...(r.terminalHref ? {
                     role: 'link', tabIndex: 0, title: r.terminalTitle,
                     'data-terminal-href': r.terminalHref,
                     // Inside the row's own <a>, so a click here
                     // must not also open the port.
                     onClick: focus,
                     onKeyDown: (e) => { if (e.key === 'Enter') focus(e); },
                 } : {})}
                 sx={{ ...HALF_SX, px: pad,
                        color: r.terminalHref ? P.accent : P.dim,
                        ...(r.terminalHref && { cursor: 'pointer', ...HALF_HOVER }) }}>
                {termText}
            </Box>
            {/* The seam: a hairline, not a gap — a gap reads as two pills. */}
            <Box component="span" sx={{ ...(stacked && { height: '1px' }), flexShrink: 0,
                                         bgcolor: P.dim }} />
            <Box component="span" data-testid={`devserver-dashboard-port-${r.key}`}
                 sx={{ ...HALF_SX, px: pad,
                        color: P.req, fontWeight: 700, ...(r.href && HALF_HOVER) }}>
                {r.port}
            </Box>
        </Box>
    );
}

export default function DevServerDashboard() {
    const { profile } = useContext(AuthContext);
    const isMobile = useMediaQuery('(max-width:899px)');
    const show = useDevServerDashboardStore(s => s.show);
    const open = useDevServerDashboardStore(s => s.open);
    const storedDock = useDevServerDashboardStore(s => s.dock);
    const { setShow, toggleOpen, setDock } = useDevServerDashboardStore.getState();
    const dock = validDock(storedDock, DASH_MIN_W, DASH_MIN_H) || DASH_HOME;

    // Dev servers are part of the Swarm app: drawn only where its nav item is
    // (navConfig's isGroupVisible — `app_swarm`, default off, or the dev
    // server's own application scope, req #3790).
    const swarmOn = isGroupVisible(profile, 'swarm');
    const visible = show && swarmOn && !isMobile && !!profile?.userName;
    const { data: devServers, isLoading: serversLoading, isError } = useDevServers(profile?.userName, {
        enabled: visible, staleTime: 30_000,
    });
    const { data: machines, isError: machinesError } = useMachines(profile?.userName, { enabled: visible });
    // The rows wait for the machines read too (devServerDashboardRows draws none
    // until it settles), so until then this is loading, never "None running".
    const isLoading = serversLoading || (machines === undefined && !machinesError);
    // A failed REFETCH keeps the rows it already has; only no data is an error.
    const failed = isError && !devServers;
    const currentPort = parseInt(window.location.port || '0', 10) || null;
    const baseRows = useMemo(
        () => devServerDashboardRows(devServers, machinesError ? [] : machines,
            undefined, currentPort),
        [devServers, machines, machinesError, currentPort]);
    // Each row's description is its requirement's title (production — see the
    // hook); the task name stands in until it arrives or if it cannot.
    const { data: reqTitles } = useDevServerRequirementTitles(
        profile?.userName, baseRows.map(r => r.reqId).filter(id => id != null),
        { enabled: visible });
    // The terminal is a link to its window (req #3668) when the row's session
    // has a handle on this machine.
    const { data: sessionTerms } = useDevServerSessionTerminals(
        profile?.userName, baseRows.map(r => r.sessionId).filter(id => id != null),
        { enabled: visible });
    const rows = useMemo(
        () => withTerminalLinks(withRequirementTitles(baseRows, reqTitles), sessionTerms,
            machinesError ? [] : machines),
        [baseRows, reqTitles, sessionTerms, machines, machinesError]);

    if (!visible) return null;
    const count = rows.length;

    return (
        <AnchoredPanel dock={dock} onDockChange={setDock}
                       open={open} onToggle={toggleOpen}
                       name="Dev Servers" testid="devserver-dashboard"
                       rackId={DASH_RACK_ID}
                       limits={LIMITS} fontPx={FONT_PX} colors={ACTION_POPUP_COLORS}
                       sx={ACTION_POPUP_SX}
                       extras={
                           <ActionPopupBadge testid="devserver-dashboard-count">
                               {failed ? '!' : (isLoading ? '…' : count)}
                           </ActionPopupBadge>
                       }
                       actions={<ActionPopupClose onClick={() => setShow(false)}
                                                  label="Hide the dashboard"
                                                  testid="devserver-dashboard-close" />                       }>
            {({ shapedWidth }) => {
                // At the smallest, the title goes — the pill alone.
                // Content-sized (null) is never cut.
                const tiny = shapedWidth != null && shapedWidth < DASH_TINY_W;
                // The pill (req #3748): "Term 4" content-sized — the panel
                // then sizes to show both halves in full — or shaped wide;
                // "T4" shaped narrower; stacked where even that would not fit
                // side by side (the icon-only navbar rack among them).
                const pillSize = (shapedWidth == null || shapedWidth >= DASH_PILL_WIDE_W) ? 'wide'
                    : (shapedWidth < DASH_STACK_W ? 'stacked' : 'short');
                const stacked = pillSize === 'stacked';
                return (
                    <>
                        {failed && (
                            <Box sx={{ px: '0.7em', py: '0.3em', color: '#ff8a80' }}>
                                Could not load dev servers.
                            </Box>
                        )}
                        {!failed && !isLoading && count === 0 && (
                            <Box data-testid="devserver-dashboard-empty"
                                 sx={{ px: '0.7em', py: '0.3em', color: P.dim }}>
                                None running
                            </Box>
                        )}
                        {count > 0 && (
                        // One grid for every row, so the pill halves line up
                        // row to row (rowColumns).
                        <Box data-testid="devserver-dashboard-rows"
                             sx={{ display: 'grid', gridTemplateColumns: rowColumns(stacked, tiny) }}>
                        {rows.map((r) => {
                            return (
                                <Box key={r.key}
                                     component={r.href ? 'a' : 'div'}
                                     {...(r.href ? { href: r.href, target: '_blank', rel: 'noopener' } : {})}
                                     title={r.title}
                                     data-testid={`devserver-dashboard-item-${r.key}`}
                                     data-current={r.current ? '1' : '0'}
                                     sx={{ display: 'grid', gridColumn: '1 / -1',
                                            gridTemplateColumns: 'subgrid', alignItems: 'baseline',
                                            // A little trailing space, nothing more:
                                            // it is the panel's only slack when it
                                            // sizes to its rows. Behind the title it
                                            // is cut 66% (req #3718).
                                            pl: stacked ? '0.3em' : '0.7em',
                                            pr: stacked ? '0.15em' : (tiny ? '1em' : '0.34em'),
                                            py: '0.15em',
                                            color: 'inherit', textDecoration: 'none',
                                            cursor: r.href ? 'pointer' : 'default',
                                            opacity: r.href ? 1 : 0.6,
                                            background: r.current ? '#16233a' : 'transparent',
                                            '&:hover': { background: '#16233a' } }}>
                                    <TerminalPortPill r={r} size={pillSize} />
                                    {!tiny && (
                                        // The gap before the title is halved
                                        // (req #3718): 0.3em, not 0.6em.
                                        <Box component="span"
                                             sx={{ minWidth: 0, ml: '0.3em', overflow: 'hidden',
                                                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {r.label}
                                        </Box>
                                    )}
                                </Box>
                            );
                        })}
                        </Box>
                        )}
                    </>
                );
            }}
        </AnchoredPanel>
    );
}
