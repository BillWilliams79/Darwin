// pipelineDetailModes.js — the mode registry for /swarm/pipeline/:id (req #3114).
//
// THREE ENTRIES: Plan, the Lock view (req #3761) and the Engine view (req
// #3760). Req #3641 had cut the registry to one — the user withdrew the Table
// ("just show the visualizer and it's the only way to look at a pipeline for
// now") — and it stayed because it is how another view comes back: a mode is
// ONE entry here. Two switches write it. The header row's Plan | Engine switch
// (PipelineDetail) draws one chip per entry that is not `planToolbarToggle`;
// the Lock view IS such a toggle — a condensed reading of the plan, switched by
// the Lock chip on the PLAN TOOLBAR (`PipelinePlanToolbar`'s `viewMode`), so the
// header's Plan chip stays lit while it shows. This is the same split as
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
//   planToolbarToggle  optional — a reading OF the plan switched by its own
//              chip on the plan toolbar (req #3761's Lock), not a sibling of the
//              Plan on the header switch; the plan toolbar stays on screen
//   needsPlan  optional, default true — false for a panel that does not draw
//              the composed plan read (req #3760's Engine mode reads the engine
//              tables only), so it renders while the plan's derivation is
//              withheld instead of disappearing behind the diagnostic
//
// NO JSX in this file: it must stay importable by vitest without a DOM, and a
// component file with non-component exports drops out of React Fast Refresh.

import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import LockIcon from '@mui/icons-material/Lock';

import EngineScopeView from '../engine/EngineScopeView';
import PipelinePlanVisualizer from './PipelinePlanVisualizer';
import PipelineLockView from './PipelineLockView';

export const PIPELINE_DETAIL_MODE_STORAGE_KEY = 'darwin-swarm-pipeline-detail-mode';

// ── THE PLAN MODE, AND NO TABLE (req #3641 user directive) ─────────────────
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
        planToolbarToggle: true,
    },
    {
        // req #3760 — the engines working this plan: what each decided this
        // cycle (the launch queue with its cut line, every epic's hold in
        // plain words, the executor's outcome per launch), its health,
        // location and limits, and a history strip to scrub back through.
        // The same panels as /swarm/engines, scoped to this plan.
        value: 'engine',
        label: 'Engine',
        icon: PrecisionManufacturingIcon,
        Component: EngineScopeView,
        needsPlan: false,
    },
];

export const DEFAULT_PIPELINE_DETAIL_MODE = 'plan';

export const findPipelineDetailMode = (value) =>
    PIPELINE_DETAIL_MODES.find((m) => m.value === value);

export default PIPELINE_DETAIL_MODES;
