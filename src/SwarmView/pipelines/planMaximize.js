// planMaximize.js — the Plan visualizer's maximize switch: its words and its
// corner (req #3658; placement req #3793). One module because the switch has
// two homes — the plan page's header row (PipelineDetail) while the controls
// are on screen, the canvas's upper-left corner (PipelinePlanVisualizer) while
// maximized — and both must say the same thing and agree where the corner is.

import { FULLSCREEN_SWITCH_SIZE } from '../../Components/fullscreenSwitchGeometry';

/** The switch's accessible names and hover hints, both homes. */
export const PLAN_MAXIMIZE_LABELS = Object.freeze({
    enterLabel: 'Maximize the plan',
    leaveLabel: 'Restore the page',
    enterTitle: 'Maximize — only the plan (Esc to exit)',
    leaveTitle: 'Restore the page (Esc)',
});

/**
 * Maximized, the switch's place on the canvas, screen px from the canvas's
 * top-left. `top + h` (31) stays inside the pinned time ruler's strip, which is
 * never under 36 px (`RULER_H · max(k, 1)`), so the initiative names — clamped below
 * that strip — never reach it. `w`/`h` are FullscreenSwitch's floating size,
 * read from it so the two cannot disagree.
 */
export const MAXIMIZE_SWITCH = Object.freeze({
    left: 8, top: 5,
    w: FULLSCREEN_SWITCH_SIZE.floating.w, h: FULLSCREEN_SWITCH_SIZE.floating.h,
});

/**
 * Above every floating box that can be dragged over the corner — a placed
 * Orchestration Ready box (`UNSEATED_FLOAT_Z`, 1201) and the Active box
 * (AnchoredPanel's default 1250) — and below MUI's modal layer (1300), so a
 * dialog's backdrop still covers it.
 */
export const MAXIMIZE_SWITCH_Z = 1251;

/**
 * The switch's right edge in the plan's WORLD x under transform `t` — where
 * the pinned time ruler's labels must start to clear it (the ruler's x axis is
 * world space; `drawnRulerLabelKeys` thins from here). −∞ for a degenerate
 * transform, which reserves nothing.
 * @param {{x:number,k:number}} t
 * @returns {number}
 */
export function maximizeSwitchWorldRight(t) {
    if (!t || !(t.k > 0) || typeof t.x !== 'number') return -Infinity;
    return (MAXIMIZE_SWITCH.left + MAXIMIZE_SWITCH.w - t.x) / t.k;
}
