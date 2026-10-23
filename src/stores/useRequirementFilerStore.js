import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
    carriedSettings, draftFromRow, newRequirementDraft, savedValues, withFiled,
} from '../RequirementFiler/requirementFilerModel';

// The Requirement Filer (req #3811) — two Action Popups over every page.
//
// THE FILER — the navbar control opens it; its head's + starts a new
//   requirement, recording where it was filed from (req #3813) and a debug
//   capture (req #3815); its body lists the requirements it filed, each one
//   click from the editor again (req #3830).
//   • `show` — drawn at all (the navbar control toggles it; × hides it).
//   • `open` — its body is expanded (its ▾ head; folded, the panel is the head).
//   • `dock` — where it floats and its shape (anchoredPanelGeometry.js); null = home.
//   • `filed` — `{ id, title }` of each requirement it filed, newest first
//     (FILED_LIMIT), the title as last saved here.
//   • `reopened` — the editor holds one of them again (`openFiled`), not a new
//     one: its saves do not move `lastProjectId`/`lastCategoryId`/`defaults`.
//
// THE EDITOR — the popup requirement editor the filer opens.
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
//
// THE DEBUG CAPTURE (req #3815) — FILE starts a draft and snapshots a debug
//   capture (RequirementFiler/debugBundle.js) for it — where it was filed from
//   among its categories. One button since the user's ruling (2026-10-23,
//   absorbing #3818).
//   • `capture` — the capture, once built; IN MEMORY ONLY (never persisted:
//     up to ~254 K chars, and this store is written on every keystroke).
//   • `captureDropped` — the category keys the reader dropped before Save.
//   • `captureSentDropped` — that selection as the first capture POST sent it;
//     from then on it is fixed, so a retry and the description block match
//     the row (null until a send).
//   • `captureStage` — 'capturing' (being built) → 'ready' → 'posted' (its row
//     is saved, the description block is not yet) → 'done'; 'none' when every
//     category was dropped; 'failed' when the capture itself threw; 'lost' when
//     a reload took the in-memory capture before its row was saved; null for a
//     draft started without one. Each change names the `draftKey` it is for.
//
// THE LAST SETTINGS — `defaults` holds the last saved requirement's settings
//   (requirementFilerModel.js CARRIED_FIELDS), written by every save; `startNew`
//   applies them, SRDOH for any never set (FILER_DEFAULT_SPEC). User ruling
//   2026-10-23 (req #3815) — it replaced #3812's Defaults form.
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
            filed: [],
            reopened: false,
            forgetFiled: (id) => set({ filed: get().filed.filter(f => f.id !== id) }),

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
            defaults: {},
            capture: null,
            captureDropped: [],
            captureSentDropped: null,
            captureStage: null,
            setEditorShow: (editorShow) => set({ editorShow }),
            toggleEditorOpen: () => set({ editorOpen: !get().editorOpen }),
            setEditorDock: (editorDock) => set({ editorDock }),
            // A fresh requirement in the editor, shown and unfolded;
            // `withCapture` (the filer's FILE, req #3815) also awaits its debug
            // capture. Returns the new draft's key.
            startNew: (withCapture = false) => {
                const { lastProjectId, lastCategoryId, defaults } = get();
                const draftKey = get().draftKey + 1;
                set({
                    draft: newRequirementDraft(lastProjectId, lastCategoryId, defaults),
                    savedId: null, saved: null, editorShow: true, editorOpen: true,
                    draftKey, orphaned: false, focusPending: true, reopened: false,
                    capture: null, captureDropped: [], captureSentDropped: null,
                    captureStage: withCapture ? 'capturing' : null,
                });
                return draftKey;
            },
            // A filed requirement back in the editor (req #3830): its row as it
            // is now, already saved — so nothing is sent until it is changed.
            // Returns the new draft's key.
            openFiled: (row, projectId) => {
                const draftKey = get().draftKey + 1;
                const draft = draftFromRow(row, projectId);
                set({
                    draft, savedId: row.id, saved: savedValues(draft), editorShow: true, editorOpen: true,
                    draftKey, orphaned: false, focusPending: false, reopened: true,
                    capture: null, captureDropped: [], captureSentDropped: null, captureStage: null,
                    filed: withFiled(get().filed, row.id, draft.title),
                });
                return draftKey;
            },
            // The debug capture built for the draft `key` names (req #3815);
            // null — the capture threw — files the requirement without one.
            setCapture: (key, capture) => {
                if (get().draftKey !== key || get().captureStage !== 'capturing') return;
                set(capture ? { capture, captureStage: 'ready' } : { capture: null, captureStage: 'failed' });
            },
            toggleCaptureCategory: (category) => {
                const { captureDropped, captureStage, captureSentDropped } = get();
                if (captureStage !== 'ready' || captureSentDropped != null) return;
                set({ captureDropped: captureDropped.includes(category)
                    ? captureDropped.filter(c => c !== category) : [...captureDropped, category] });
            },
            setCaptureStage: (key, captureStage) => { if (get().draftKey === key) set({ captureStage }); },
            markCaptureSent: (key, dropped) => {
                if (get().draftKey === key && get().captureSentDropped == null) set({ captureSentDropped: [...dropped] });
            },
            setFields: (patch) => set({ draft: { ...get().draft, ...patch } }),
            clearFocusPending: () => set({ focusPending: false }),
            // A successful save of the draft `key` names: the row's id and the
            // values it now holds — and, for the next one, where it was filed and
            // its settings. Ignored when another draft has been started.
            // The row joins (or retitles) the filer's list whichever draft is
            // now current — a save that lands after a reopen is still filed. A
            // reopened requirement is not the last one filed: its edits leave
            // the next one's place and settings alone.
            markSaved: (key, id, values) => {
                const filed = withFiled(get().filed, id, values.title);
                if (get().draftKey !== key) { set({ filed }); return; }
                set({
                    savedId: id, saved: values, filed,
                    ...(!get().reopened && {
                        lastProjectId: values.projectId ?? null, lastCategoryId: values.category_fk ?? null,
                        defaults: carriedSettings(values),
                    }),
                });
            },
            markOrphaned: (key) => { if (get().draftKey === key) set({ orphaned: true }); },
        }),
        {
            name: 'darwin_requirement_filer',
            // v2 (req #3815): `defaults` is the last requirement's settings —
            // #3812's Defaults form is gone, and with it a default place, seat or
            // repos nothing could show any more; the defaults mode goes too.
            version: 2,
            migrate: (persisted, version) => {
                if (!persisted || version >= 2) return persisted;
                const { editorMode, ...rest } = persisted;
                // A v1 draft may wait on a check v2 no longer makes ('seat'): keep
                // only the ones it does, or File would wait forever.
                const draft = rest.draft ? { ...rest.draft, defaultsUnchecked:
                    (rest.draft.defaultsUnchecked || []).filter(f => f === 'category' || f === 'machine') } : rest.draft;
                return { ...rest, draft, defaults: carriedSettings(persisted.defaults || {}) };
            },
            // The capture stays in memory; a reload that loses it before its
            // row is saved says so ('lost') rather than waiting on it forever.
            partialize: ({ focusPending, capture, ...persisted }) => ({
                ...persisted,
                captureStage: ['capturing', 'ready'].includes(persisted.captureStage) ? 'lost' : persisted.captureStage,
            }),
        }
    )
);
