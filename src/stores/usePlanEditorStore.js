// usePlanEditorStore.js — the ONE plan-element editor (req #4133).
//
// A click on a pipeline's title, an initiative, or an epic in the plan page opens
// that element's editor — an AnchoredPanel in the Requirement Editor's chrome
// (SwarmView/pipelines/PlanElementEditor.jsx). Only ONE plan-element editor is
// open at a time: opening another replaces it.
//
// The Requirement Editor works ATOP these (req #4116): a requirement click from
// an epic or initiative editor's context opens the Requirement Editor while the
// plan editor stays open beneath it — the two never close or hide one another.
// The stacking is z-order alone (RequirementFiler/filerHover.js: PLAN_EDITOR_Z
// under EDITOR_Z).
//
// `current` is `{ key, kind, target, ...ctx }`: `kind` is 'pipeline' | 'epic' |
// 'initiative'; `target` the stored row; `ctx` what that kind's editor needs from
// the opener (options, deletion facts, `onSaved`). `key` changes per open so the
// form seeds afresh. Not persisted: an editor holds live rows of a plan page.
import { create } from 'zustand';

export const usePlanEditorStore = create((set, get) => ({
    current: null,
    dock: null,
    open: true,
    openEditor: (spec) => set({ current: { ...spec, key: (get().current?.key || 0) + 1 }, open: true }),
    closeEditor: () => set({ current: null }),
    setDock: (dock) => set({ dock }),
    toggleOpen: () => set({ open: !get().open }),
}));

