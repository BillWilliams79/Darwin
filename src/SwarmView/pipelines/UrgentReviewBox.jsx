// UrgentReviewBox.jsx — the Plan visualizer's "Urgent Review" box (req #3622).
//
// The Orchestration Ready box's panel (`UnorchestratedReqBox.jsx` — moved by
// its title bar, remembered per browser, typed at the requirement ids'
// on-screen size) over a different list: every requirement whose latest
// session is stopped on the user, `review` or `waiting`
// (`pipelineUrgentReview.js`). It is as WIDE AS A STEP CARD ON SCREEN — the
// live Step Width rung through the live zoom (`urgentBoxWidthPx`) — and never
// narrower than a step card's line at its own clamped type size, so zoomed out
// to the plan overview it is a step card scaled to legible type, not a sliver.
// The panel is sized in em of that type, so the px width is handed over as em.
//
// ── DOCKED BESIDE ORCHESTRATION READY (user directive) ─────────────────────
// *"dock this by default to the left edge of the Orchestration Ready's default
// spot so they are side by side"*. Its home is the top edge, its right side one
// inset clear of that box's home left edge — `23em + 2 × inset` from the
// pane's right. Both boxes take the SAME `fontPx`, so their em is the same em
// and the gap holds at every zoom. Clamped to the pane: on a pane too narrow
// for both it slides over rather than off the left edge.
//
// ── A ROW IS THE ID, THE TITLE AND WHERE TO REACH IT (user directive) ──────
// *"Don't put the status as words into the dashboard. just list the title and
// # and show the terminal and dev server badges"*. The id still wears the live
// palette's Session colour (what that id wears on the canvas under the Session
// key) — colour, not words. The pills are the cards' own (`planReqPills.js`'s
// join, `REQ_PILL_STYLE`'s palette) and do what the cards' do: a terminal on
// this machine is brought to the front, a dev server on this machine opens. A
// pill that can do neither still draws, with the reason in its tooltip, and a
// click on it opens the requirement like the rest of the row.

import Box from '@mui/material/Box';

import UnorchestratedReqBox from './UnorchestratedReqBox';
import { urgentBoxWidthPx } from './pipelineUrgentReview';
import { PLAN_VIZ_PALETTE as P } from './pipelinePlanLayout';
import { UNSEATED_BOX_WIDTH_EM, UNSEATED_BOX_INSET_PX } from './pipelineUnseated';
import { REQ_PILL_STYLE } from './planReqPills';

/** The box's outline: an urgent orange, apart from Orchestration Ready's purple. */
const OUTLINE = '#ff8a1f';
// `-docked`: the first build's home was the top-LEFT corner, and a spot
// remembered against that home would hide the docked one the directive asks for.
const POS_STORAGE_KEY = 'darwin-plan-urgent-box-pos-docked';
const PILL_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

function Pill({ kind, label, title, href, newTab, testId }) {
    const style = REQ_PILL_STYLE[kind] || REQ_PILL_STYLE.terminal;
    const action = href ? {
        component: 'a', href,
        ...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        // The row opens the requirement; a pill that acts does only its act.
        onClick: (e) => e.stopPropagation(),
    } : { component: 'span' };
    return (
        <Box {...action} title={title || undefined} data-testid={testId}
             data-pill-kind={kind}
             sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                    height: '1.3em', px: '0.6em', borderRadius: '0.65em',
                    background: style.fill, border: `1px solid ${style.stroke}`,
                    color: style.text, fontFamily: PILL_FONT, fontSize: '0.78em',
                    fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap',
                    textDecoration: 'none', cursor: href ? 'pointer' : 'inherit' }}>
            {label}
        </Box>
    );
}

export default function UrgentReviewBox({
    items, isLoading = false, isError = false, fontPx = 12,
    stepWidthLevel, zoom = 1, sessionColors = null, reqPills = null, onOpen,
}) {
    const widthEm = urgentBoxWidthPx(stepWidthLevel, zoom, fontPx) / fontPx;
    const dockedRight = `calc(${UNSEATED_BOX_WIDTH_EM}em + ${2 * UNSEATED_BOX_INSET_PX}px)`;
    const colorOf = (r) => sessionColors?.[r.sessionStatus] || P.text;
    const pillsOf = (r) => {
        const p = reqPills?.get?.(r.id);
        if (!p) return null;
        const tid = `pipeline-viz-urgent-item-${r.id}`;
        return (
            <Box component="span"
                 sx={{ display: 'inline-flex', gap: '0.35em', flexShrink: 0,
                        alignSelf: 'center' }}>
                {p.terminal?.label && (
                    <Pill kind="terminal" label={p.terminal.label}
                          title={p.terminal.title} href={p.terminal.href || null}
                          testId={`${tid}-terminal`} />
                )}
                {p.devServer?.port && (
                    <Pill kind="devserver" label={p.devServer.port}
                          title={p.devServer.title}
                          href={p.devServer.local ? p.devServer.url : null} newTab
                          testId={`${tid}-devserver`} />
                )}
            </Box>
        );
    };
    return (
        <UnorchestratedReqBox
            items={items} isLoading={isLoading} isError={isError}
            fontPx={fontPx} statusColor={OUTLINE}
            onOpen={onOpen}
            title="Urgent Review"
            outline={OUTLINE}
            testId="pipeline-viz-urgent"
            chrome="urgent"
            posStorageKey={POS_STORAGE_KEY}
            homeOffset={`clamp(0px, ${dockedRight}, calc(100% - ${widthEm}em))`}
            widthEm={widthEm}
            emptyText="None — no session is waiting on you."
            errorText="Could not load session status."
            itemColor={colorOf}
            renderItemEnd={pillsOf}
            showCategoryBar={false}
            seatable={false} />
    );
}
