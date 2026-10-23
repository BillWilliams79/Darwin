// actionPopupChrome.js — the look of Darwin's Action Popups: the
// windows that float over a page and rack in the navbar (the Dev Servers
// dashboard, req #3643; the navbar's own Dev Server panel, req #3727; the Plan
// visualizer's Active box, req #3721, and Orchestrables box, which racks in this
// type, req #3735; the Requirement Filer and its editor, req #3811). One place,
// so the Action Popups read as one family — and one head row for all of them,
// ActionPopupHead.jsx (req #3821).

import { PLAN_VIZ_PALETTE as P } from '../../SwarmView/pipelines/pipelinePlanLayout';

export const ACTION_POPUP_MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';
/** Type size, px — every dimension inside is in em off it. */
export const ACTION_POPUP_FONT_PX = 12;
/** The head row's height, em — every popup's, so folded popups stack evenly
 *  (req #3821): its tallest item (× at 1.54em) plus 0.6em of padding. */
export const ACTION_POPUP_HEAD_EM = 2.2;
/** …in px, plus the 2px frame top and bottom — unrounded, so a folded
 *  AnchoredPanel is exactly the Orchestrables box's `calc(2.2em + 4px)`. */
export const ACTION_POPUP_HEAD_PX = Math.round(100 * (ACTION_POPUP_HEAD_EM * ACTION_POPUP_FONT_PX + 4)) / 100;
export const ACTION_POPUP_COLORS = {
    // The Orchestration Ready box's outline (req #3605) and panel.
    frame: '#a64dff', background: 'rgba(13, 20, 32, 0.94)', line: P.line, text: P.text,
    // The Topology minimize head's colours (`.tpu3d-head`, req #3570).
    head: '#7bb8de', headHover: '#cfe4f7',
};
/** The panel chrome past AnchoredPanel's own frame. */
export const ACTION_POPUP_SX = {
    borderRadius: '0.8em', backdropFilter: 'blur(2px)',
    boxShadow: '0 0.5em 1.5em rgba(0, 0, 0, 0.45)',
    fontFamily: ACTION_POPUP_MONO,
};
/** A head-row badge's height, and its width for one digit (a circle). */
export const ACTION_POPUP_BADGE_EM = '1.45em';

// ── RESHAPED FROM ANY EDGE OR CORNER — every Action Popup (req #3743, #3833) ──
// Hit zones, px (req #3743: "the activation area is tiny" — they were 5 px /
// 8 px). Below the head row the sides and bottom are wide and the bottom
// corners generous; the head row's own sides, top edge and top corners stay
// slim so they keep clear of the ▾ and ×, which sit 0.7em in. AnchoredPanel and
// the Orchestrables box (which draws its own frame) both draw them from here.
export const ACTION_POPUP_EDGE_PX = 10;
export const ACTION_POPUP_CORNER_PX = 18;
export const ACTION_POPUP_HEAD_EDGE_PX = 5;
export const ACTION_POPUP_HEAD_CORNER_PX = 8;

/** The resize cursor of each edge and corner (`RESIZE_EDGES` ids). */
export const ACTION_POPUP_RESHAPE_CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };

/**
 * One reshape zone's sx: absolutely placed inside the popup's frame, on top of
 * its content, tinted in the frame colour under the pointer.
 *
 * @param {{id, h: ?string, v: ?string}} e  a `RESIZE_EDGES` entry
 * @param {number|string} headPx  the head row's height — px, or a CSS length
 *   (`calc(2.2em + 4px)`) for a popup whose type follows the zoom, so its zones
 *   mint no style rule per zoom value; a side zone is slim beside it
 * @param {string} frame   the popup's frame colour
 */
export function actionPopupReshapeZone(e, headPx, frame) {
    const EDGE_PX = ACTION_POPUP_EDGE_PX;
    const CORNER_PX = ACTION_POPUP_CORNER_PX;
    const HEAD_EDGE_PX = ACTION_POPUP_HEAD_EDGE_PX;
    const HEAD_CORNER_PX = ACTION_POPUP_HEAD_CORNER_PX;
    const z = { position: 'absolute', zIndex: 3, touchAction: 'none', cursor: ACTION_POPUP_RESHAPE_CURSOR[e.id],
        // The zone shows itself under the pointer, so the reader sees what to grab.
        '&:hover': { background: `color-mix(in srgb, ${frame} 40%, transparent)` } };
    const corner = e.h && e.v;
    const top = e.v === 't';
    if (e.v) Object.assign(z, { [top ? 'top' : 'bottom']: 0,
        height: corner ? (top ? HEAD_CORNER_PX : CORNER_PX) : (top ? HEAD_EDGE_PX : EDGE_PX) });
    else Object.assign(z, { top: HEAD_CORNER_PX, bottom: CORNER_PX });
    if (e.h) Object.assign(z, { [e.h === 'l' ? 'left' : 'right']: 0,
        width: corner ? (top ? HEAD_CORNER_PX : CORNER_PX) : EDGE_PX });
    else Object.assign(z, { left: top ? HEAD_CORNER_PX : CORNER_PX, right: top ? HEAD_CORNER_PX : CORNER_PX });
    // A side edge is wide below the head row and slim beside it (clip-path
    // clips hit-testing too).
    if (e.h && !e.v) {
        const l = e.h === 'l';
        const a = HEAD_EDGE_PX;
        const h = typeof headPx === 'number' ? `${Math.max(headPx - HEAD_CORNER_PX, 0)}px`
            : `max(0px, calc(${headPx} - ${HEAD_CORNER_PX}px))`;
        z.clipPath = l
            ? `polygon(0 0, ${a}px 0, ${a}px ${h}, ${EDGE_PX}px ${h}, ${EDGE_PX}px 100%, 0 100%)`
            : `polygon(${EDGE_PX - a}px 0, ${EDGE_PX}px 0, ${EDGE_PX}px 100%, 0 100%, 0 ${h}, ${EDGE_PX - a}px ${h})`;
    }
    return z;
}
