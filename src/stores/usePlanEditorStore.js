// usePlanEditorStore.js — the ONE plan-element editor (req #4133).
//
// A click on a pipeline's title, an initiative, or an epic in the plan page opens
// that element's editor — an AnchoredPanel in the Requirement Editor's chrome
// (SwarmView/pipelines/PlanElementEditor.jsx). Only ONE such editor is open at a
// time: opening another replaces it, and opening this one hides the Requirement
// Editor (and a requirement click, which opens the Requirement Editor, closes
// this one) — the editor rules, not the info/action popups' (those stack).
//
// `current` is `{ key, kind, target, ...ctx }`: `kind` is 'pipeline' | 'epic' |
// 'initiative'; `target` the stored row; `ctx` what that kind's editor needs from
// the opener (options, deletion facts, `onSaved`). `key` changes per open so the
// form seeds afresh. Not persisted: an editor holds live rows of a plan page.
import { create } from 'zustand';

import { useRequirementFilerStore } from './useRequirementFilerStore';

export const usePlanEditorStore = create((set, get) => ({
    current: null,
    dock: null,
    open: true,
    openEditor: (spec) => {
        // One editor at a time: the Requirement Editor steps aside.
        const filer = useRequirementFilerStore.getState();
        // Hidden, not discarded: `restoredDraft` keeps the Filer's draft guard asking
        // before a later open replaces unsaved edits.
        if (filer.editorShow) {
            const hadDraft = filer.draft != null;
            filer.setEditorShow(false);
            if (hadDraft) useRequirementFilerStore.setState({ restoredDraft: true });
        }
        set({ current: { ...spec, key: (get().current?.key || 0) + 1 }, open: true });
    },
    closeEditor: () => set({ current: null }),
    setDock: (dock) => set({ dock }),
    toggleOpen: () => set({ open: !get().open }),
}));

// Opening the Requirement Editor closes a plan editor — the other half of "one".
let wired = false;
export function wirePlanEditorSingleton() {
    if (wired) return;
    wired = true;
    useRequirementFilerStore.subscribe((st, prev) => {
        if (st.editorShow && !prev.editorShow && usePlanEditorStore.getState().current) {
            usePlanEditorStore.setState({ current: null });
        }
    });
}
wirePlanEditorSingleton();
