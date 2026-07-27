// pipelineDetailModes.js — the mode registry for /swarm/pipeline/:id (req #3114).
//
// WHY A REGISTRY FOR TWO ENTRIES. The Plan visualizer is a separate requirement
// (#3115) landing in a later wave, and the epic has more views behind it. Without
// a registry, every new mode edits the switcher, the conditional render and the
// storage-key normalization — three places, in a file that also owns the page
// layout. With it, a new mode is ONE entry appended below and nothing else
// changes. This is the same split as instructionSort.js / normalizeView.js: the
// vocabulary lives outside the component so the component keeps its single job.
//
// Contract for a new entry:
//   value      stable string — it is persisted per-tab by useViewPreference, so
//              renaming one silently resets everyone who chose it
//   label      the switcher's tooltip / accessible name
//   icon       an @mui/icons-material component (see view-switchable-pages § R3)
//   Component  receives { plan, model, pipeline, timezone, focusStepId,
//              onStepFocus, costError } and renders the panel.
//              focusStepId/onStepFocus are the req #3115 cross-mode handshake:
//              the visualizer calls onStepFocus(stepId) on a bead click, the
//              page switches to the table mode, and the table scrolls to +
//              highlights that row. `costError` (req #3117) is true when either
//              cost read failed — a mode showing cost must say so rather than
//              print em-dashes, which read as "no cost recorded". Every plan row
//              already carries its own total on `row.cost`, so a mode needs no
//              cost data of its own.
//   disabled   optional — renders a disabled ToggleButton (rule V1: a
//              not-yet-built view is disabled, never omitted, so the group holds
//              its width)
//
// NO JSX in this file: it must stay importable by vitest without a DOM, and a
// component file with non-component exports drops out of React Fast Refresh.

import TableChartIcon from '@mui/icons-material/TableChart';
import AccountTreeIcon from '@mui/icons-material/AccountTree';

import PipelinePlanTable from './PipelinePlanTable';
import PipelinePlanVisualizer from './PipelinePlanVisualizer';

export const PIPELINE_DETAIL_MODE_STORAGE_KEY = 'darwin-swarm-pipeline-detail-mode';

export const PIPELINE_DETAIL_MODES = [
    {
        value: 'table',
        label: 'Table',
        icon: TableChartIcon,
        Component: PipelinePlanTable,
    },
    {
        // The req #3115 Plan visualizer: epic bands, chain-aware swim lanes,
        // dependency-depth columns, launch-batch boxes, drag-pan + three-level
        // zoom (react-konva + d3-zoom, the Swarm Visualizer's feel).
        value: 'plan',
        label: 'Plan',
        icon: AccountTreeIcon,
        Component: PipelinePlanVisualizer,
    },
];

export const DEFAULT_PIPELINE_DETAIL_MODE = 'table';

export const findPipelineDetailMode = (value) =>
    PIPELINE_DETAIL_MODES.find((m) => m.value === value);

export default PIPELINE_DETAIL_MODES;
