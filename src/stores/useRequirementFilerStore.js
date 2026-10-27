import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { database } from '../Context/AppContext';
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
//   • `titleLock` — `{ side, x }`: it is LOCKED INTO THE PAGE'S TITLE BAR
//     where the reader dropped it (req #3857, titleBarLock.js); null = it
//     floats at `dock`. A page with no title bar floats it at `dock`, the lock
//     kept for the next page that has one.
//   • `pinned` — its PUSHPIN, between the title and the × (user ruling
//     2026-10-26, req #3958): pressed, a head drag outlines the element it flies
//     over (filerHover.js) and the + records the place (`filedFrom.pointedAt`);
//     not pressed, neither. Off by default, remembered per browser.
//   • `filed` — `{ id, title }` of each requirement it filed, newest first
//     (FILED_LIMIT), the title as last saved here.
//   • `filedInto` — the database every id here names: production, from every
//     build since req #3888 (FilerDataScope); see migrateFilerState.
//   • `reopened` — the editor holds one of them again (`openFiled`), not a new
//     one: its saves do not move `lastProjectId`/`lastCategoryId`/`defaults`.
//
// THE EDITOR — the popup requirement editor the filer opens.
//   • `editorShow` / `editorOpen` / `editorDock` — the same three, for it.
//   • `draft` — the values in the editor's fields (requirementFilerModel.js);
//     its `seat` is the plan epic the filer's + was aimed at (req #3854,
//     filerEpicAim.js) — never sent with the row, Create seats it after the POST.
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
//   • `creating` — the `draftKey` of a CREATE still being written (its POST,
//     then its debug capture) while the editor it closed is hidden (req #3860);
//     null when none is. A new or reopened requirement waits for it, so it never
//     replaces a draft whose capture is still on its way. Live only.
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
/** Where the ids this store holds were filed (req #3888) — always production now. */
export const FILED_INTO = 'darwin';

/** Brings persisted filer state of `version` up to date in a build reading
 *  `db`. v1 → v2 (req #3815): `defaults` is the last requirement's settings and
 *  the defaults mode is gone. v2 → v3 (req #3888): until v3 a dev build filed
 *  into `darwin_dev`, so its filed list, the draft's saved row and the last
 *  place and machine are darwin_dev ids — which name OTHER rows in production,
 *  where the filer now files. They are dropped (the editor closes on a draft
 *  started anew); window positions and the last enum settings carry over. A
 *  production build's ids were production's all along and are kept.
 *  The `filedInto` mark, not the version alone, says whose ids they are: a
 *  branch older than #3888 sharing a dev port keeps the mark when it writes the
 *  store back as v2, so its round trip does not cost this code a production draft. */
export function migrateFilerState(persisted, version, db) {
    if (!persisted) return persisted;
    let state = persisted;
    if (version < 2) {
        const { editorMode, ...rest } = state;
        // A v1 draft may wait on a check v2 no longer makes ('seat'): keep
        // only the ones it does, or File would wait forever.
        const draft = rest.draft ? { ...rest.draft, defaultsUnchecked:
            (rest.draft.defaultsUnchecked || []).filter(f => f === 'category' || f === 'machine') } : rest.draft;
        state = { ...rest, draft, defaults: carriedSettings(state.defaults || {}) };
    }
    if (version < 3 && db !== 'darwin' && state.filedInto !== FILED_INTO) {
        const { machine_fk, ...defaults } = state.defaults || {};
        state = {
            ...state, filed: [], draft: null, savedId: null, saved: null, editorShow: false,
            reopened: false, orphaned: false, lastProjectId: null, lastCategoryId: null, defaults,
            captureDropped: [], captureSentDropped: null, captureStage: null,
        };
    }
    return { ...state, filedInto: FILED_INTO };
}

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
            titleLock: null,
            setTitleLock: (titleLock) => set({ titleLock }),
            pinned: false,
            setPinned: (pinned) => set({ pinned }),
            filed: [],
            filedInto: FILED_INTO,
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
            creating: null,
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
            // capture, and `seat` is the plan epic the + was aimed at (req #3854,
            // filerEpicAim.js) — Create seats it there. Returns the new draft's key.
            startNew: (withCapture = false, seat = null) => {
                const { lastProjectId, lastCategoryId, defaults } = get();
                const draftKey = get().draftKey + 1;
                set({
                    draft: { ...newRequirementDraft(lastProjectId, lastCategoryId, defaults), seat },
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
            // The trash can (req #3887): every category dropped at once.
            dropAllCaptureCategories: () => {
                const { capture, captureStage, captureSentDropped } = get();
                if (!capture || captureStage !== 'ready' || captureSentDropped != null) return;
                set({ captureDropped: capture.categories.map(c => c.key) });
            },
            setCaptureStage: (key, captureStage) => { if (get().draftKey === key) set({ captureStage }); },
            markCaptureSent: (key, dropped) => {
                if (get().draftKey === key && get().captureSentDropped == null) set({ captureSentDropped: [...dropped] });
            },
            setFields: (patch) => set({ draft: { ...get().draft, ...patch } }),
            // The reader's × on the editor's Epic line: file it in no epic.
            clearSeat: () => { if (get().draft?.seat) set({ draft: { ...get().draft, seat: null } }); },
            clearFocusPending: () => set({ focusPending: false }),
            setCreating: (creating) => set({ creating }),
            endCreating: (key) => { if (get().creating === key) set({ creating: null }); },
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
            // v3 (req #3888): the filer files into production from every build,
            // so a dev build's v2 state names darwin_dev rows — see migrateFilerState.
            version: 3,
            migrate: (persisted, version) => migrateFilerState(persisted, version, database),
            // The capture stays in memory; a reload that loses it before its
            // row is saved says so ('lost') rather than waiting on it forever.
            // A reload mid-create (req #3860) brings its draft back into view —
            // whether it was filed is then for the reader to see.
            partialize: ({ focusPending, creating, capture, ...persisted }) => ({
                ...persisted,
                editorShow: persisted.editorShow || creating != null,
                captureStage: ['capturing', 'ready'].includes(persisted.captureStage) ? 'lost' : persisted.captureStage,
            }),
        }
    )
);
