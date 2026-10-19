// DevServerDashboard.jsx — the Dev Servers dashboard (req #3643): the Plan
// visualizer's "Orchestration Ready" box (UnorchestratedReqBox, req #3583),
// duplicated for dev servers and docked to the Darwin VIEWPORT rather than to a
// canvas pane — so it floats over every page, and the reader moves it,
// reshapes it and collapses it until it sits where they want it.
//
// The floating, docking, reshaping and collapsing are AnchoredPanel's
// (Components/AnchoredPanel, pattern doc memory/anchored-collapse-pattern.md):
// its head row is the Topology visualizer's ▾, the step card's green count
// badge and the DEV SERVERS title, left-aligned, then × at the far right —
// folded, × follows the title and the panel pulls in tight around them; the
// head is the top row and its ▾ never moves when clicked. By
// default the panel is exactly as big as its rows, on both axes.
//
// ── THE SAME BOX ───────────────────────────────────────────────────────────
// Same dark panel, same strong purple outline, same row anatomy. A row reads
// (user directive): machine colour bar · port (the link) · terminal (T10) ·
// bug # · the requirement's title, in fixed columns so they line up row to row.
// Shaped really narrow, the bug # goes; at the smallest, the title too. Which
// rows appear, and which link, is devServerDashboardRows' rule (see
// devServerDashboardModel.js). The server this page is served from is the
// highlighted row.
//
// Where it sits, its shape, whether it is expanded and whether it is shown at
// all are remembered per browser (useDevServerDashboardStore); × hides it and
// the Dev Servers page's "Show dashboard" chip brings it back.

import { useContext, useMemo } from 'react';

import Box from '@mui/material/Box';
import { lighten } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

import AnchoredPanel from '../Components/AnchoredPanel/AnchoredPanel';
import { validDock } from '../Components/AnchoredPanel/anchoredPanelGeometry';
import AuthContext from '../Context/AuthContext';
import { useDevServerRequirementTitles, useDevServers, useMachines } from '../hooks/useDataQueries';
import { useDevServerDashboardStore } from '../stores/useDevServerDashboardStore';
import { machineChipProps } from '../SwarmView/machineChipStyles';
import { PLAN_VIZ_PALETTE as P } from '../SwarmView/pipelines/pipelinePlanLayout';
import {
    DASH_AUTO_MAX_W, DASH_COMPACT_W, DASH_HOME, DASH_MIN_H, DASH_MIN_W, DASH_TINY_W,
    devServerDashboardRows, withRequirementTitles,
} from './devServerDashboardModel';

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';
/** Type size, px — every dimension inside is in em off it. */
const FONT_PX = 12;
/** The head row's height, px: its tallest item (× at 1.54em) plus 0.6em of
 *  padding, plus the 2px frame top and bottom. */
const HEAD_PX = Math.ceil(2.2 * FONT_PX + 4);
const LIMITS = { minW: DASH_MIN_W, minH: DASH_MIN_H, autoMaxW: DASH_AUTO_MAX_W, headPx: HEAD_PX };
const COLORS = {
    // The Orchestration Ready box's outline (req #3605) and panel.
    frame: '#a64dff', background: 'rgba(13, 20, 32, 0.94)', line: P.line, text: P.text,
    // The Topology minimize head's colours (`.tpu3d-head`, req #3570).
    head: '#7bb8de', headHover: '#cfe4f7',
};
/** The count badge's height, and its width for one digit (a circle). */
const BADGE_EM = '1.45em';

/** The bar's edge: a same-hue lightened shade of its fill (RequirementRow's
 *  rule, req #2752), as the Orchestration Ready box draws it. */
function barEdge(color) {
    try { return lighten(color, 0.45); } catch { return 'rgba(128,128,128,0.5)'; }
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
    // (navConfig's GROUP_PROFILE_KEY/DEFAULT — `app_swarm`, default off).
    const swarmOn = Number(profile?.app_swarm ?? 0) === 1;
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
    const rows = useMemo(() => withRequirementTitles(baseRows, reqTitles), [baseRows, reqTitles]);

    if (!visible) return null;
    const count = rows.length;

    return (
        <AnchoredPanel dock={dock} onDockChange={setDock}
                       open={open} onToggle={toggleOpen}
                       name="Dev Servers" testid="devserver-dashboard"
                       limits={LIMITS} fontPx={FONT_PX} colors={COLORS}
                       sx={{ borderRadius: '0.8em', backdropFilter: 'blur(2px)',
                              boxShadow: '0 0.5em 1.5em rgba(0, 0, 0, 0.45)',
                              fontFamily: MONO }}
                       extras={
                           // The step card's count badge (req #3503): the green
                           // pill, a circle for one digit, a capsule past it.
                           <Box component="span" data-testid="devserver-dashboard-count"
                                sx={{ display: 'inline-flex', alignItems: 'center',
                                       justifyContent: 'center', flexShrink: 0,
                                       minWidth: BADGE_EM, height: BADGE_EM, px: '0.35em',
                                       boxSizing: 'border-box', borderRadius: '999px',
                                       bgcolor: P.badgeFill, color: P.badgeText,
                                       fontFamily: MONO, fontWeight: 700, lineHeight: 1 }}>
                               {failed ? '!' : (isLoading ? '…' : count)}
                           </Box>
                       }
                       actions={
                           <Box component="button" type="button"
                                onClick={() => setShow(false)}
                                aria-label="Hide the dashboard" title="Hide the dashboard"
                                data-testid="devserver-dashboard-close"
                                sx={{ width: '1.4em', height: '1.4em', p: 0, display: 'flex',
                                       alignItems: 'center', justifyContent: 'center',
                                       background: 'transparent', border: 'none',
                                       borderRadius: '0.4em', color: P.text, cursor: 'pointer',
                                       fontFamily: MONO, fontSize: '1.1em', lineHeight: 1,
                                       '&:hover': { color: P.accent } }}>
                               ×
                           </Box>
                       }>
            {({ shapedWidth }) => {
                // Cut really small, the bug # goes and the title keeps the
                // room; at the smallest, the title goes too — bar, port and
                // terminal. Content-sized (null) is never cut.
                const compact = shapedWidth != null && shapedWidth < DASH_COMPACT_W;
                const tiny = shapedWidth != null && shapedWidth < DASH_TINY_W;
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
                        {rows.map((r) => {
                            const barColor = r.machineId != null
                                ? machineChipProps(r.machineId).sx.bgcolor : null;
                            return (
                                <Box key={r.key}
                                     component={r.href ? 'a' : 'div'}
                                     {...(r.href ? { href: r.href, target: '_blank', rel: 'noopener' } : {})}
                                     title={r.title}
                                     data-testid={`devserver-dashboard-item-${r.key}`}
                                     data-current={r.current ? '1' : '0'}
                                     sx={{ display: 'flex', alignItems: 'baseline', gap: '0.6em',
                                            // A little trailing space, nothing more:
                                            // it is the panel's only slack when it
                                            // sizes to its rows.
                                            pl: '0.7em', pr: '1em', py: '0.15em',
                                            color: 'inherit', textDecoration: 'none',
                                            cursor: r.href ? 'pointer' : 'default',
                                            opacity: r.href ? 1 : 0.6,
                                            background: r.current ? '#16233a' : 'transparent',
                                            '&:hover': { background: '#16233a' } }}>
                                    <Box component="span"
                                         data-testid={`devserver-dashboard-bar-${r.key}`}
                                         sx={{ width: '0.45em', alignSelf: 'stretch',
                                                minHeight: '1.1em', flexShrink: 0,
                                                borderRadius: '0.25em', boxSizing: 'border-box',
                                                bgcolor: barColor || 'transparent',
                                                ...(barColor && {
                                                    border: '0.1em solid',
                                                    borderColor: barEdge(barColor),
                                                }) }} />
                                    {/* Fixed columns, so ports, terminals and
                                        bug numbers line up row to row; an
                                        absent one keeps its slot. */}
                                    <Box component="span"
                                         sx={{ color: P.req, fontWeight: 700, flexShrink: 0,
                                                minWidth: '4ch' }}>
                                        {r.port}
                                    </Box>
                                    <Box component="span" data-testid={`devserver-dashboard-term-${r.key}`}
                                         sx={{ color: P.dim, flexShrink: 0, minWidth: '3ch' }}>
                                        {r.terminal != null ? `T${r.terminal}` : ''}
                                    </Box>
                                    {!compact && (
                                        <Box component="span" data-testid={`devserver-dashboard-req-${r.key}`}
                                             sx={{ color: P.dim, flexShrink: 0, minWidth: '5ch' }}>
                                            {r.reqId != null ? `#${r.reqId}` : ''}
                                        </Box>
                                    )}
                                    {!tiny && (
                                        <Box component="span"
                                             sx={{ flex: 1, minWidth: 0, overflow: 'hidden',
                                                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {r.label}
                                        </Box>
                                    )}
                                </Box>
                            );
                        })}
                    </>
                );
            }}
        </AnchoredPanel>
    );
}
