// actionPopupChrome.js — the look of Darwin's Action Popups: the
// windows that float over a page and rack in the navbar (the Dev Servers
// dashboard, req #3643; the navbar's own Dev Server panel, req #3727; the Plan
// visualizer's Active box, req #3721, and Orchestrables box, which racks in this
// type, req #3735). One place, so the Action Popups read as one family.

import { PLAN_VIZ_PALETTE as P } from '../../SwarmView/pipelines/pipelinePlanLayout';

export const ACTION_POPUP_MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';
/** Type size, px — every dimension inside is in em off it. */
export const ACTION_POPUP_FONT_PX = 12;
/** The head row's height, px: its tallest item (× at 1.54em) plus 0.6em of
 *  padding, plus the 2px frame top and bottom. */
export const ACTION_POPUP_HEAD_PX = Math.ceil(2.2 * ACTION_POPUP_FONT_PX + 4);
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
