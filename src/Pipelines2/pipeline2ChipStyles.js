// pipeline2ChipStyles.js — the Pipeline 2.0 plan-layer chip vocabulary (req #3393).
//
// Own copy of the small set of pure color literals `Darwin/src/SwarmView/
// pipelines/pipelineChipStyles.js` already carries for `pipeline_status` and
// `run`, rather than an import of that file. The vocabularies are identical
// today (pipeline2's `_VALID_PIPELINE2_STATUSES` / `_VALID_RUN2_MODES` in
// darwin-mcp/services/pipelines2.py match 1.0's exactly), but importing from
// a 1.0 module would create a live code edge into a file req #3356 deletes
// at eradication — this file exists so 2.0 never has one. See PLAN.md.
//
// No JSX here, same reason the 1.0 file gives: a pure module can be exercised
// by vitest without pulling MUI into the test environment, and stays out of
// React Fast Refresh's component-file requirement.

// pipeline_status — draft|active|paused|completed|aborted. Verbatim copy of
// pipelineChipStyles.js's `pipelineStatusChipProps` palette.
export const PIPELINE2_STATUS_VALUES =
    ['draft', 'active', 'paused', 'completed', 'aborted'];

export const pipelineStatus2ChipProps = (status) => {
    switch (status) {
        case 'draft':     return { sx: { bgcolor: '#546e7a', color: '#fff' } };
        case 'active':    return { sx: { bgcolor: '#6b4e00', color: '#ffd769' } };
        case 'paused':    return { sx: { bgcolor: '#ff9800', color: '#000' } };
        case 'completed': return { sx: { bgcolor: '#1b5e20', color: '#a5e5ae' } };
        case 'aborted':   return { sx: { bgcolor: '#9e9e9e', color: '#fff' } };
        default:          return { color: 'default' };
    }
};

// run — auto|manual. Verbatim copy of pipelineChipStyles.js's `runChipProps`/
// `runLabel`.
const RUN2_CHIP = {
    auto: { bgcolor: '#1c3a52', color: '#8fd0ff' },
    manual: { bgcolor: '#6a1b6a', color: '#ff9bf5' },
};

export const run2Label = (run) => (run === 'manual' ? 'Manual' : 'Auto');

export const run2ChipProps = (run) => ({ sx: RUN2_CHIP[run] || RUN2_CHIP.auto });

// epic_status — active|paused. NEW in 2.0 (no equivalent editable control
// exists anywhere in 1.0 today — only a derived bubble). Amber-for-paused,
// matching pipeline_status's own `paused` treatment above, so "paused" reads
// as one color across every 2.0 surface.
const EPIC2_STATUS_CHIP = {
    active: { bgcolor: '#1c3a52', color: '#8fd0ff' },
    paused: { bgcolor: '#ff9800', color: '#000' },
};

export const epicStatus2Label = (status) => (status === 'paused' ? 'Paused' : 'Active');

export const epicStatus2ChipProps = (status) => ({
    sx: EPIC2_STATUS_CHIP[status] || EPIC2_STATUS_CHIP.active,
});

// execution_mode — parallel|serial. NEW in 2.0 (req #3388's field; no UI
// anywhere renders or edits it today, in either era). Styled as a two-value
// click-to-toggle chip in the same visual language as the run chip above,
// deliberately a different hue (teal) so it never reads as a run-mode chip
// at a glance.
const EXECUTION_MODE_CHIP = {
    parallel: { bgcolor: '#0d3d3a', color: '#7fe8da' },
    serial: { bgcolor: '#3d2b0d', color: '#e8b87f' },
};

export const executionModeLabel = (mode) => (mode === 'serial' ? 'Serial' : 'Parallel');

export const executionModeChipProps = (mode) => ({
    sx: EXECUTION_MODE_CHIP[mode] || EXECUTION_MODE_CHIP.parallel,
});
