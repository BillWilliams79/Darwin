import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { newRequirementDraft } from '../RequirementFiler/requirementFilerModel';

// The Requirement Filer (req #3811) — two Action Popups over every page.
//
// THE FILER — the navbar control opens it; it holds the REQUIREMENT button
//   (req #3813 — it records where it was filed from, filedFromContext.js).
//   • `show` — drawn at all (the navbar control toggles it; × hides it).
//   • `open` — its body is expanded (its ▾ head; folded, the panel is the head).
//   • `dock` — where it floats and its shape (anchoredPanelGeometry.js); null = home.
//
// THE EDITOR — the popup requirement editor REQUIREMENT opens.
//   • `editorShow` / `editorOpen` / `editorDock` — the same three, for it.
//   • `draft` — the values in the editor's fields (requirementFilerModel.js).
//   • `savedId` — the requirement's id once the first Save has POSTed it; null
//     until then. From then on Save PUTs that row.
//   • `saved` — the values as last saved, so Save sends only what changed.
//   • `lastProjectId` / `lastCategoryId` — where the last requirement was filed;
//     a new one starts there, so filing a run of them is one choice, not one each.
//   • `draftKey` — bumped by every `startNew`. A save captures it and lands
//     only if it is unchanged, so a save still in flight when the reader starts
//     another requirement can never stamp its id onto the new draft (whose next
//     Save would then PUT over the first row).
//   • `orphaned` — the POST committed but its id could not be read back: Save is
//     refused until a new requirement is started, so it cannot POST a duplicate.
//   • `focusPending` — focus the title once, for a draft just started; live only.
//   • `editorMode` — 'requirement' (the draft) or 'defaults' (req #3812): the
//     filer's DEFAULTS button opens the same editor on the reader's defaults.
//
// THE DEFAULTS (req #3812) — `defaults` holds only the fields the reader has
//   set (requirementFilerModel.js DEFAULT_FIELDS); `startNew` applies them,
//   falling back to DEFAULT_REQUIREMENT_SPEC for the rest. Edited in place —
//   each change in the Defaults form is the new default, as there is nothing
//   to send anywhere.
//
// Kept here rather than in the editor's own state because racking a panel
// re-mounts its subtree (AnchoredPanel). Persisted per browser — where the
// reader parks the windows, and an unsaved draft, survive a reload.
export const useRequirementFilerStore = create(
    persist(
        (set, get) => ({
            show: false,
            open: true,
            dock: null,
            toggleShow: () => set(get().show ? { show: false } : { show: true, open: true }),
            setShow: (show) => set({ show }),
            toggleOpen: () => set({ open: !get().open }),
            setDock: (dock) => set({ dock }),

            editorShow: false,
            editorOpen: true,
            editorDock: null,
            draft: null,
            savedId: null,
            saved: null,
            lastProjectId: null,
            lastCategoryId: null,
            draftKey: 0,
            orphaned: false,
            focusPending: false,
            editorMode: 'requirement',
            defaults: {},
            setEditorShow: (editorShow) => set({ editorShow }),
            toggleEditorOpen: () => set({ editorOpen: !get().editorOpen }),
            setEditorDock: (editorDock) => set({ editorDock }),
            // A fresh requirement in the editor, shown and unfolded; `filedFrom`
            // — where it was filed from (req #3813) — opens its description.
            startNew: (filedFrom = null) => {
                const { lastProjectId, lastCategoryId, defaults } = get();
                set({
                    draft: newRequirementDraft(lastProjectId, lastCategoryId, defaults, filedFrom),
                    savedId: null, saved: null, editorShow: true, editorOpen: true,
                    editorMode: 'requirement',
                    draftKey: get().draftKey + 1, orphaned: false, focusPending: true,
                });
            },
            setFields: (patch) => set({ draft: { ...get().draft, ...patch } }),
            clearFocusPending: () => set({ focusPending: false }),
            // The editor on the defaults, shown and unfolded; back to the draft.
            openDefaults: () => set({ editorMode: 'defaults', editorShow: true, editorOpen: true }),
            showDraft: () => set({ editorMode: 'requirement', editorShow: true, editorOpen: true }),
            setDefaults: (patch) => set({ defaults: { ...get().defaults, ...patch } }),
            resetDefaults: () => set({ defaults: {} }),
            // A successful save of the draft `key` names: the row's id and the
            // values it now holds. Ignored when another draft has been started.
            markSaved: (key, id, values) => {
                if (get().draftKey !== key) return;
                set({
                    savedId: id, saved: values,
                    lastProjectId: values.projectId ?? null, lastCategoryId: values.category_fk ?? null,
                });
            },
            markOrphaned: (key) => { if (get().draftKey === key) set({ orphaned: true }); },
        }),
        {
            name: 'darwin_requirement_filer',
            version: 1,
            partialize: ({ focusPending, ...persisted }) => persisted,
        }
    )
);
