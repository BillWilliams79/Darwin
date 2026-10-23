// PlanActiveBox.jsx — the Plan visualizer's "Active" box (req #3721): every
// requirement on this plan whose latest session is under way, from `starting`
// to `completing` (which ones is planActiveReqs.js's rule).
//
// ── THE STEP CARD'S ROWS ───────────────────────────────────────────────────
// It replicates rows of the step cards, so each row is drawn the way a card
// draws it (user directive: "replicate the look and feel and widgets
// of the step card"): the id in the reader's colour key (the canvas's own
// resolver, `idStyleOf`), then the Terminal and Dev Server pills in the card's
// own palette (`REQ_PILL_*`, planReqPills.js) — clickable exactly as the card's
// are — then the title, in the id's colour, on ONE line, cut with "…" (req
// #3729). The head is every Action Popup's (req #3741): the ▾ at the upper
// left, the card's green count badge, the title — and the upper right blank,
// since the box has no close (its small-view button went with req #3741,
// user directive). A click on the
// row opens the requirement, with the plan as Back's target, as a click on the
// card's row does.
//
// ── AN ACTION POPUP ────────────────────────────────────────────────────────
// Floating, docking, reshaping and collapsing are AnchoredPanel's — the Dev
// Servers dashboard's type (pattern doc memory/anchored-collapse-pattern.md),
// with its `rackId` so it racks onto the Darwin navbar alongside the other
// Action Popups (req #3720) — floating instead while the page is
// maximized over the navbar (the rack's `covered`, req #3735). It is drawn only
// while the visualizer is.
// Mounted OUTSIDE the canvas pane, so d3-zoom never sees its pointer or wheel.
//
// ── THE SMALL VIEW ─────────────────────────────────────────────────────────
// Shaped narrower than ACTIVE_TINY_W, every title goes: each row is its id
// and pills (the Dev Servers dashboard's rule). Where it sits, its shape and
// whether it is open are remembered per browser (usePlanActiveBoxStore).

import { memo } from 'react';

import Box from '@mui/material/Box';

import AnchoredPanel from '../../Components/AnchoredPanel/AnchoredPanel';
import { validDock } from '../../Components/AnchoredPanel/anchoredPanelGeometry';
import {
    ACTION_POPUP_BADGE_EM, ACTION_POPUP_COLORS, ACTION_POPUP_FONT_PX, ACTION_POPUP_HEAD_PX, ACTION_POPUP_MONO, ACTION_POPUP_SX,
} from '../../Components/AnchoredPanel/actionPopupChrome';
import { SIDEBAR_WIDTH } from '../../NavBar/navConfig';
import { usePlanActiveBoxStore } from '../../stores/usePlanActiveBoxStore';
import { PLAN_VIZ_PALETTE as P } from './pipelinePlanLayout';
import {
    REQ_PILL_FONT, REQ_PILL_FONT_EM, REQ_PILL_H_EM, REQ_PILL_LABEL_PAD_EM, REQ_PILL_STROKE,
    REQ_PILL_STYLE,
} from './planReqPills';

const MONO = ACTION_POPUP_MONO;
/** Smallest panel the edges will shape, px: an id and a pill. */
export const ACTIVE_MIN_W = 120;
export const ACTIVE_MIN_H = 64;
/** Shaped narrower than this, the titles go: the small view. */
export const ACTIVE_TINY_W = 170;
/** Content-sized, the panel is as wide as its rows, up to this, px. */
export const ACTIVE_AUTO_MAX_W = 420;
const LIMITS = { minW: ACTIVE_MIN_W, minH: ACTIVE_MIN_H, autoMaxW: ACTIVE_AUTO_MAX_W, headPx: ACTION_POPUP_HEAD_PX };
/** Home: the viewport's bottom-left, just clear of the full-width navbar —
 *  the plan's free corner (the key is a toolbar popup, the Orchestrables box
 *  top-right, the initiative names and — maximized — the full screen switch
 *  top-left, req #3793) —
 *  sized to its content on both axes until reshaped. Maximized, no navbar. */
export const ACTIVE_HOME = Object.freeze({
    h: 'l', x: SIDEBAR_WIDTH + 16, v: 'b', y: 16, w: null, ht: null,
});
const ACTIVE_HOME_MAXIMIZED = Object.freeze({ ...ACTIVE_HOME, x: 16 });
const BADGE_EM = ACTION_POPUP_BADGE_EM;

const SESSION_LABEL = {
    starting: 'Starting', waiting: 'Waiting', planning: 'Planning', active: 'Implementing',
    review: 'Review', completing: 'Completing',
};

function Pill({ kind, label, title, onActivate, testid }) {
    const style = REQ_PILL_STYLE[kind] || REQ_PILL_STYLE.terminal;
    const act = onActivate ? (e) => { e.preventDefault(); e.stopPropagation(); onActivate(); } : null;
    return (
        <Box component="span" data-testid={testid} title={title || undefined}
             {...(act ? {
                 role: 'link', tabIndex: 0, onClick: act,
                 onKeyDown: (e) => { if (e.key === 'Enter') act(e); },
             } : {})}
             sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, alignSelf: 'center',
                    // In the pill's own em — its label size — so the card's
                    // row-relative height is divided back out.
                    height: `${REQ_PILL_H_EM / REQ_PILL_FONT_EM}em`, boxSizing: 'border-box',
                    px: `${REQ_PILL_LABEL_PAD_EM}em`,
                    borderRadius: '999px', background: style.fill,
                    border: `${REQ_PILL_STROKE}px solid ${style.stroke}`,
                    color: style.text, fontFamily: REQ_PILL_FONT, fontWeight: 600,
                    fontSize: `${REQ_PILL_FONT_EM}em`, lineHeight: 1, whiteSpace: 'nowrap',
                    cursor: act ? 'pointer' : 'inherit',
                    ...(act && { '&:hover': { borderColor: style.text } }) }}>
            {label}
        </Box>
    );
}

/**
 * @param {Object} props
 * @param {Array<{id, title, sessionStatus}>} props.items  planActiveReqs' list
 * @param {?Map} [props.reqPills]   requirement id -> {terminal, devServer}
 * @param {function} props.idStyleOf  (id) -> {fill, bold} — the canvas's resolver
 * @param {boolean} [props.isLoading] the session reads have not settled
 * @param {function} [props.onOpen]   (id) — open the requirement
 * @param {boolean} [props.maximized] the page is maximized (no navbar)
 */
function PlanActiveBox({ items, reqPills = null, idStyleOf, isLoading = false, onOpen, maximized = false }) {
    const open = usePlanActiveBoxStore(s => s.open);
    const storedDock = usePlanActiveBoxStore(s => s.dock);
    const { toggleOpen, setDock } = usePlanActiveBoxStore.getState();
    const dock = validDock(storedDock, ACTIVE_MIN_W, ACTIVE_MIN_H) || (maximized ? ACTIVE_HOME_MAXIMIZED : ACTIVE_HOME);
    const count = items.length;

    return (
        <AnchoredPanel dock={dock} onDockChange={setDock}
                       open={open} onToggle={toggleOpen}
                       name="Active" testid="pipeline-viz-active" rackId="active"
                       limits={LIMITS} fontPx={ACTION_POPUP_FONT_PX} colors={ACTION_POPUP_COLORS}
                       sx={ACTION_POPUP_SX}
                       extras={
                           // The step card's count badge (req #3503).
                           <Box component="span" data-testid="pipeline-viz-active-count"
                                sx={{ display: 'inline-flex', alignItems: 'center',
                                       justifyContent: 'center', flexShrink: 0,
                                       minWidth: BADGE_EM, height: BADGE_EM, px: '0.35em',
                                       boxSizing: 'border-box', borderRadius: '999px',
                                       bgcolor: P.badgeFill, color: P.badgeText,
                                       fontFamily: MONO, fontWeight: 700, lineHeight: 1 }}>
                               {isLoading ? '…' : count}
                           </Box>
                       }>
            {({ shapedWidth }) => {
                // Content-sized (null) is never cut.
                const tiny = shapedWidth != null && shapedWidth < ACTIVE_TINY_W;
                return (
                    <Box data-testid="pipeline-viz-active-list" data-small={tiny ? '1' : '0'}>
                        {!isLoading && count === 0 && (
                            <Box data-testid="pipeline-viz-active-empty"
                                 sx={{ px: '0.7em', py: '0.3em', color: P.dim }}>
                                None running
                            </Box>
                        )}
                        {items.map((r) => {
                            const id = Number(r.id);
                            const rs = idStyleOf ? idStyleOf(id) : { fill: P.req, bold: true };
                            const pills = reqPills?.get?.(id) || null;
                            const term = pills?.terminal?.label ? pills.terminal : null;
                            const ds = pills?.devServer?.port ? pills.devServer : null;
                            const session = SESSION_LABEL[r.sessionStatus] || r.sessionStatus;
                            return (
                                <Box key={id}
                                     data-testid={`pipeline-viz-active-item-${id}`}
                                     data-session={r.sessionStatus}
                                     title={`${id} — ${r.title}${session ? ` · ${session}` : ''}`}
                                     onClick={() => onOpen?.(id)}
                                     {...(onOpen ? {
                                         role: 'link', tabIndex: 0,
                                         onKeyDown: (e) => {
                                             if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(id);
                                         },
                                     } : {})}
                                     sx={{ display: 'flex', alignItems: 'center', gap: '0.5em',
                                            pl: '0.7em', pr: tiny ? '1em' : '0.5em', py: '0.2em',
                                            cursor: onOpen ? 'pointer' : 'default',
                                            fontFamily: MONO, color: rs.fill,
                                            fontWeight: rs.bold ? 700 : 400,
                                            '&:hover': { background: '#16233a' } }}>
                                    <Box component="span" data-testid={`pipeline-viz-active-item-id-${id}`}
                                         sx={{ flexShrink: 0, minWidth: '4ch', lineHeight: `${REQ_PILL_H_EM}em` }}>
                                        {id}
                                    </Box>
                                    {term && (
                                        <Pill kind="terminal" label={term.label} title={term.title}
                                              testid={`pipeline-viz-active-term-${id}`}
                                              onActivate={term.href
                                                  ? () => { window.location.href = term.href; } : null} />
                                    )}
                                    {ds && (
                                        <Pill kind="devserver" label={ds.port} title={ds.title}
                                              testid={`pipeline-viz-active-port-${id}`}
                                              onActivate={ds.local ? () => {
                                                  try { window.open(ds.url, '_blank', 'noopener,noreferrer'); }
                                                  catch (e) { /* popup blocked — no-op */ }
                                              } : null} />
                                    )}
                                    {!tiny && (
                                        // One line, then "…" (req #3729).
                                        <Box component="span" data-testid={`pipeline-viz-active-item-title-${id}`}
                                             sx={{ flex: 1, minWidth: 0, overflow: 'hidden',
                                                    lineHeight: `${REQ_PILL_H_EM}em`,
                                                    whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                            {r.title}
                                        </Box>
                                    )}
                                </Box>
                            );
                        })}
                    </Box>
                );
            }}
        </AnchoredPanel>
    );
}

// The visualizer re-renders on every zoom frame; the box need not.
export default memo(PlanActiveBox);
