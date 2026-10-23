// pipelineDetailModes.js — the mode registry for /swarm/pipeline/:id (req #3114).
//
// ONE ENTRY SINCE REQ #3641, A SECOND SINCE REQ #3761. It held Table and Plan;
// the user withdrew the Table ("just show the visualizer and it's the only way
// to look at a pipeline for now"), and the page dropped its Table|Plan switcher
// with it. The registry stayed because it is how a second view comes back, and
// the Lock view (req #3761) is that view: a mode is ONE entry here, and its
// switch is a chip on the PLAN TOOLBAR (`PipelinePlanToolbar`'s `viewMode`) rather
// than the header switcher req #3641 removed (see its git history). This is the same split as
// instructionSort.js / normalizeView.js: the vocabulary lives outside the
// component so the component keeps its single job.
//
// Contract for an entry:
//   value      stable string — it is persisted per-tab by useViewPreference, so
//              renaming one silently resets everyone who chose it
//   label      the switcher's tooltip / accessible name, when there is one
//   icon       an @mui/icons-material component (see view-switchable-pages § R3)
//   Component  receives { plan, model, pipeline, timezone, focusEpicId,
//              focusInitiativeId, costError, resetViewNonce, … } and renders the
//              panel. `focusEpicId` / `focusInitiativeId` are the one-shot `?epic=` /
//              `?initiative=` deep links (req #3253 / #3235) — the visualizer centres
//              and zooms on that epic, or fits that initiative's band. A click on a
//              epic is the panel's own business: the visualizer frames it (req
//              #3641 — it used to call an `onEpicFocus` that switched to the
//              Table). `costError` (req #3117) is true when either cost read
//              failed — a mode showing cost must say so rather than print
//              em-dashes; the visualizer shows none and ignores it.
//              `resetViewNonce` (req #3216) is the header's Reset control
//              reaching into the mode's own pan/zoom state, a number that only
//              ever increments.
//   disabled   optional — renders a disabled ToggleButton once there is a
//              switcher (rule V1: a not-yet-built view is disabled, never
//              omitted, so the group holds its width)
//
// NO JSX in this file: it must stay importable by vitest without a DOM, and a
// component file with non-component exports drops out of React Fast Refresh.

import AccountTreeIcon from '@mui/icons-material/AccountTree';
import LockIcon from '@mui/icons-material/Lock';

import PipelinePlanVisualizer from './PipelinePlanVisualizer';
import PipelineLockView from './PipelineLockView';

export const PIPELINE_DETAIL_MODE_STORAGE_KEY = 'darwin-swarm-pipeline-detail-mode';

// ── ONE MODE (req #3641 user directive) ────────────────────────────────────
// *"Remove the option to see the epics in the pipeline in a special viewer.
// Just show the visualizer and it's the only way to look at a pipeline for
// now."* The Table entry is withdrawn, not deleted: `PipelinePlanTable` and its
// tests stay, so restoring it is this one entry plus PipelineDetail's
// Table|Plan switcher and epic-click handshake (both removed in req #3641's
// change; see its git history). A stored
// 'table' preference normalizes to 'plan' — `normalizeView` never writes back.
export const PIPELINE_DETAIL_MODES = [
    {
        // The req #3115 Plan visualizer: initiative bands stacked by
        // `initiatives.sort_order` (req #3430 — the authoritative initiative display order),
        // falling back to derived start for the initiatives carrying none,
        // chain-aware swim lanes, TIME-SLOT columns floored by dependency depth
        // (req #3201 — they were raw dependency depth), and drag-pan +
        // three-level zoom (react-konva + d3-zoom, the Swarm Visualizer's
        // feel). It drew a dashed multi-epic launch rectangle too until req
        // #3371 made the epic the launch unit.
        value: 'plan',
        label: 'Plan',
        icon: AccountTreeIcon,
        Component: PipelinePlanVisualizer,
    },
    {
        // The Lock view (req #3761): the plan condensed to pipeline → initiatives →
        // epics with no requirement drawn — what is locked, what is paused and
        // where each engine is working, on one screen, with the lock / unlock
        // and pause / unpause controls of those tiers. Entered by the Lock chip
        // on the plan toolbar (which writes this value to the per-tab mode
        // preference) or by `?mode=lock`.
        value: 'lock',
        label: 'Lock',
        icon: LockIcon,
        Component: PipelineLockView,
    },
];

export const DEFAULT_PIPELINE_DETAIL_MODE = 'plan';

export const findPipelineDetailMode = (value) =>
    PIPELINE_DETAIL_MODES.find((m) => m.value === value);

export default PIPELINE_DETAIL_MODES;
