// /agents/instructions — the instruction registry (req #2998, editable req #3049,
// edit-in-place req #3063).
//
// The point of this page is BLAST RADIUS. An instruction is a row, and a shared
// instruction is simply a row that many agents link — there is no common flag in
// the schema. Editing one changes the duty for every agent that references it at
// their next boot, so every card shows chips for all referencing agents BEFORE
// anyone edits it.
//
// Req #3049 made the rows editable through a modal. Req #3063 removed the modal:
// name and content are labelled bordered fields that commit on blur,
// membership is edited by the agent chips themselves
// (InstructionAgentChips), and a new row is created through the house template-row
// pattern instead of a button.
//
// Req #3067 added the Table view and, in doing so, retired an argument this comment
// used to make. It said a DataGrid "would either truncate `content` into uselessness
// or need auto row height", and that was a false dichotomy: a FIXED row height
// containing an internally-scrollable four-line field is the third option, and it is
// what InstructionsTableView ships. What survives is the softer and truer claim —
// the CARD is where long prose is composed, because four lines is enough to read an
// instruction and not enough to write one. The Table is for scanning the catalog and
// correcting fields. Both views write the same rows through the same component.
//
// The two views share ONE of everything that can disagree: one `fieldErrors` map,
// one serialized membership queue, one set of graduated close/delete handlers, one
// GhostTextField. That is deliberate and it is the whole point of #3067 — see
// memory/darwin-viewer-pages.md.
//
// The fields started as ghost fields — plain text until hovered — and were
// converted to labelled outlined ones during manual UI review. What survived that
// change is the part that matters: the commit contract. Editing still happens
// where the data lives, with no dialog, no Save button, and one PUT per field.
//
// WHERE THE BLAST-RADIUS WARNING WENT. The modal showed an Alert listing the bound
// agents just before the user committed. That moment went with the modal; a
// focus-time banner replaced it and was then removed during review, along with a
// warning left border on shared rows. Both only restated what is now permanently
// on the card:
//   1. the agent chips, always visible, and also the control;
//   2. the agent-count / `not bound` chips in the card header.
//
// ONE PUT PER FIELD. Each ghost field writes only its own column, so a rejected
// name cannot take an edited body down with it, and a row-field save invalidates
// only the instruction query — no junction row changed.

import '../index.css';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import useMediaQuery from '@mui/material/useMediaQuery';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import GhostTextField from '../Components/GhostField/GhostTextField';
import ViewerHeader from '../Components/ViewerHeader/ViewerHeader';
import { normalizeView } from '../Components/ViewerHeader/normalizeView';
import {
    useInstructions, useAgents, useAgentInstructions,
    instructionKeys, agentInstructionKeys,
} from '../hooks/useDataQueries';
import { useBusyCounts } from '../hooks/useBusyCounts';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useViewPreference } from '../hooks/useViewPreference';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import {
    byId, agentsByInstruction, instructionLinksByAgent,
    nextInstructionSortOrder, restErrorMessage,
    instructionNameError, instructionContentError,
    INSTRUCTION_NAME_MAX, INSTRUCTION_CONTENT_HINT_LENGTH,
} from './agentRegistryUtils';
import {
    createInstruction, updateInstruction, deleteInstruction,
    linkAgentInstruction, linkAgentInstructions, unlinkAgentInstruction,
} from './actions/instructionsApi';
import {
    SORT_MODES, SORT_STORAGE_KEY, readStoredSort, compareInstructionRows,
} from './instructionSort';
import InstructionAgentChips from './InstructionAgentChips';
import InstructionDeleteDialog from './InstructionDeleteDialog';
import InstructionRowMenu from './InstructionRowMenu';
import InstructionUnbindDialog from './InstructionUnbindDialog';
import InstructionsTableView from './InstructionsTableView';

// The page's views, in toggle order. A module constant rather than an inline array:
// `normalizeView` is called with it on every render and a fresh array each time
// would defeat any future memoization of the header.
const VIEWS = [
    { value: 'cards', label: 'Cards view', icon: ViewModuleIcon },
    { value: 'table', label: 'Table view', icon: TableChartIcon },
];

// CardContent adds a 24px bottom pad to its last child on top of its own 16px.
// Pinning both to the old Paper's `p: 2` keeps the card interiors identical to the
// list rows they replaced — the ask was cards, not a different layout inside them.
const CARD_CONTENT_SX = { p: 2, '&:last-child': { pb: 2 } };

const InstructionsPage = () => {
    const navigate = useNavigate();
    const { profile, idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const isMobile = useMediaQuery('(max-width:899px)');
    const creatorFk = profile?.userName;
    // Only the Table view renders dates, but it is read here so the page stays the
    // single place profile is consumed.
    const timezone = profile?.timezone;

    const { data: instructions, isLoading } = useInstructions(creatorFk);
    const { data: agents } = useAgents(creatorFk);
    const { data: agentInstrs } = useAgentInstructions(creatorFk);

    // EVERY destructive decision on this page reads the junction. `refs.length`
    // decides whether closing a row goes straight through or via the dialog, and
    // it drives the delete dialog's agent list, its "affects nothing at boot"
    // copy, and whether the typed-name challenge appears at all. An UNRESOLVED
    // junction query makes every row look unbound — so a row twelve architects
    // load would close with no dialog, and delete with no challenge.
    //
    // `isLoading` covers only `useInstructions`, and `fetchEntity` maps 404 to []
    // but RETHROWS every other status — so a 500 on /agent_instructions leaves
    // this undefined permanently, not briefly. Treat missing relationship data as
    // a hard stop, not as "no relationships".
    const relationshipsReady = !!agents && !!agentInstrs;

    const [showClosed, setShowClosed] = useState(false);
    const [view, setView] = useViewPreference('darwin-instructions-view', 'cards');
    // The page-level normalization. `ViewerHeader` normalizes internally too, but
    // the CONDITIONAL RENDER below has to branch on the same value or the header
    // would show one view selected while the body rendered another. Req #3063's
    // hand-rolled `view === 'table' ? 'cards' : view` line is gone: with a real
    // Table button that mapping is actively wrong — it would pin the page to Cards
    // forever — and every browser still holding 'table' in storage from before the
    // button was pulled now gets the view it originally asked for.
    const activeView = normalizeView(view, VIEWS);

    const [sortMode, setSortMode] = useState(readStoredSort);
    const [sortDesc, setSortDesc] = useState(
        () => SORT_MODES.find(m => m.value === readStoredSort())?.defaultDesc ?? true);
    const [deleteTarget, setDeleteTarget] = useState(null);
    // The per-row options menu owns its own anchor (InstructionRowMenu). It used to
    // live here as `{ id, el }`, which nothing cleared when a ROW disappeared on its
    // own — in the table that happens with no user gesture at all, and the menu
    // remounted open against a detached element. Anchor state belongs inside the row.
    // WHY the dialog was opened. `deleteTarget` alone cannot say, and a dialog
    // titled "Delete …" opened from a menu item labelled Close is a lie.
    const [dialogIntent, setDialogIntent] = useState('delete');
    const [busy, setBusy] = useState(false);
    // Membership writes are pessimistic and scoped to one card, so the spinner and
    // the disabled controls are scoped to that card too. A per-row COUNTER rather
    // than a single id or a set of ids: two cards can legitimately be mid-write at
    // once (a single id would let the first one to finish clear the second card's
    // spinner), and so can two writes against the SAME card — which a
    // boolean-via-Set got wrong, releasing the flag when the first of the two
    // finished (req #3101, closing finding 3c). See useBusyCounts.
    const { mark: markMembershipBusy, isBusy: isMembershipBusy } = useBusyCounts();
    // The row whose CONTENT field is focused, so its hints show only while that
    // field is in use. Deliberately per-field, not per-row: keying it off the row
    // would pop "check this does not contradict…" under the body while the user
    // is editing the name.
    const [contentEditingId, setContentEditingId] = useState(null);
    // `${rowId}:${field}` -> error message, for rows holding a blocked value.
    const [fieldErrors, setFieldErrors] = useState({});
    // Renaming is commit-first now, so its advice is delivered afterwards.
    const [renameNotice, setRenameNotice] = useState(null);

    // The template row is a local-only construct with no query source, so its two
    // fields live here rather than in the derived `rows`.
    const [draftName, setDraftName] = useState('');
    const [draftContent, setDraftContent] = useState('');
    const [creating, setCreating] = useState(false);
    const templateNameRef = useRef(null);
    const templateRef = useRef(null);

    // AgentDetail's pencil drills through to `#instruction-<id>`. A client-side
    // route change does not make the browser honour a hash, so the scroll is
    // explicit — and it waits for the rows, which do not exist on the first render
    // after the navigation.
    //
    // ONCE PER HASH, and only once the row is actually on screen. The dependency
    // list has to include the data (the target row does not exist on the first
    // render), but every field save refetches and hands back a new `instructions`
    // identity — so without the latch, saving anything would smooth-scroll the
    // viewport back to the drill-through target for as long as the hash sat in the
    // URL. The latch is set only when the scroll really happened, so a row that
    // has not rendered yet still gets its turn on a later pass.
    const scrolledToHash = useRef(null);
    useEffect(() => {
        if (isLoading) return;
        const hash = window.location.hash;
        if (!hash || scrolledToHash.current === hash) return;

        // The target may be a CLOSED row, which the list filters out by default —
        // then the drill-through would land on nothing at all and look broken.
        const targetId = Number(hash.replace('#instruction-', ''));
        if (Number.isFinite(targetId) && !showClosed
            && (instructions || []).some(i => i.id === targetId && i.closed)) {
            setShowClosed(true);
            return;                        // re-runs once the row is rendered
        }

        const el = document.getElementById(hash.slice(1));
        if (!el) return;
        scrolledToHash.current = hash;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [isLoading, instructions, showClosed]);

    // Only the MODE persists. Direction resets to the mode's natural end on
    // reload, so a user who flipped to "fewest agents" once does not silently come
    // back tomorrow to a page that buries its own headline rows.
    useEffect(() => {
        try { localStorage.setItem(SORT_STORAGE_KEY, sortMode); } catch { /* private mode */ }
    }, [sortMode]);

    // CategoryCard's shipped idiom: picking the ACTIVE mode flips its direction and
    // keeps the menu open so the arrow change is visible; picking a new mode adopts
    // that mode's natural direction and closes.
    //
    // `close` is handed in by ViewerHeader rather than owned here. The component
    // cannot infer which of its menu items should dismiss the menu, so it delegates
    // — and this is exactly the item that must NOT dismiss on one of its two paths.
    const chooseSort = (value, defaultDesc, close) => {
        if (sortMode === value) { setSortDesc(d => !d); return; }
        setSortMode(value);
        setSortDesc(defaultDesc);
        close?.();
    };

    const agentIndex = useMemo(() => byId(agents || []), [agents]);
    const byInstruction = useMemo(
        () => agentsByInstruction(agentInstrs || []), [agentInstrs]);
    const instrLinks = useMemo(
        () => instructionLinksByAgent(agentInstrs || []), [agentInstrs]);

    const openAgents = useMemo(
        () => (agents || []).filter(a => !a.closed)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        [agents]);

    const hasClosed = useMemo(
        () => (instructions || []).some(i => i.closed), [instructions]);

    const rows = useMemo(() => {
        if (!instructions) return [];
        return instructions
            .filter(i => showClosed || !i.closed)
            .map(i => ({ ...i, refs: byInstruction.get(i.id) || [] }))
            .sort(compareInstructionRows(sortMode, sortDesc));
    }, [instructions, byInstruction, showClosed, sortMode, sortDesc]);

    // A row edit touches no junction row, so it invalidates the row query only.
    const invalidateRows = () => queryClient.invalidateQueries(
        { queryKey: instructionKeys.all(creatorFk) });

    // A membership edit changes the junction AND the derived count / `common`
    // chips that read from it, so both caches go.
    const invalidateAll = () => Promise.all([
        invalidateRows(),
        queryClient.invalidateQueries({ queryKey: agentInstructionKeys.all(creatorFk) }),
    ]);

    // ---------- per-field row edits ----------

    const noteFieldError = (rowId, field) => (error) => setFieldErrors(prev => {
        const key = `${rowId}:${field}`;
        if (!error) {
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        }
        if (prev[key] === error) return prev;
        return { ...prev, [key]: error };
    });

    const rowBlocked = (rowId) => Object.keys(fieldErrors)
        .some(k => k.startsWith(`${rowId}:`));

    /**
     * Commit one column of one row. RETHROWS on failure so GhostTextField
     * reverts — the field must never keep displaying a value the database
     * rejected. The resync runs BEFORE the error is reported, because a display
     * failure must not be able to skip it.
     */
    const commitField = (row, field, label) => async (raw) => {
        // `content` is stored verbatim — it is prose an agent loads as-is, and its
        // leading whitespace can be deliberate. `name` is normalized to the trimmed
        // value by the field itself, so `raw` already arrives trimmed here.
        const value = raw;
        // A new edit supersedes the previous rename advice; leaving it up would
        // attach a stale message to whatever the user is doing now.
        setRenameNotice(prev => (prev && prev.id !== row.id ? null : prev));
        try {
            await updateInstruction(darwinUri, idToken, row.id, { [field]: value });
            await invalidateRows();
            if (field === 'name' && row.refs.length >= 2) {
                setRenameNotice({ id: row.id, from: row.name, to: raw.trim() });
            }
        } catch (err) {
            await invalidateRows();
            showError(err, restErrorMessage(err, `Could not save the ${label}`));
            throw err;
        }
    };

    // ---------- membership ----------

    // The freshest junction rows, for work that runs LATER than the render that
    // scheduled it — see the queue below.
    //
    // Read from the CACHE, not from a ref holding the last rendered value. The
    // cache is updated synchronously when a refetch resolves, whereas a ref only
    // catches up once React has re-rendered — and nothing guarantees that has
    // happened by the time the next queued task starts. The key is matched by
    // PREFIX because the query factory appends a `{fields}` segment.
    const agentInstrsRef = useRef(agentInstrs);
    agentInstrsRef.current = agentInstrs;

    const freshAgentInstructions = () => {
        const entries = queryClient.getQueriesData(
            { queryKey: agentInstructionKeys.all(creatorFk) });
        for (const [, data] of entries) if (Array.isArray(data)) return data;
        return agentInstrsRef.current || [];
    };

    /**
     * Membership writes run ONE AT A TIME across the whole page.
     *
     * Not for the user's benefit — for correctness. A new binding's load-order slot
     * is max(existing)+1 for that agent, computed from the junction cache. Two
     * cards binding the SAME agent concurrently both read the pre-write cache, both
     * compute the same slot, and both inserts succeed (the junction PK is
     * (agent_fk, instruction_fk), so nothing rejects them) — leaving that agent
     * loading two different instructions at the same position, in arbitrary order.
     *
     * Serializing means the second write is planned only after the first one's
     * refetch has landed, and the slot is read at EXECUTION time (see
     * `freshAgentInstructions`) rather than from the render that queued it.
     */
    const membershipQueue = useRef(Promise.resolve());

    const runMembership = (row, fn, fallback) => {
        markMembershipBusy(row.id, true);
        const task = membershipQueue.current.then(async () => {
            try {
                await fn();
                await invalidateAll();
            } catch (err) {
                // Resync BEFORE reporting: a display failure must never be able to
                // skip it, because the caches now disagree with the database.
                await invalidateAll();
                showError(err, restErrorMessage(err, fallback));
            } finally {
                markMembershipBusy(row.id, false);
            }
        });
        // The queue must survive a failed task, or one error would wedge every
        // later bind on the page.
        membershipQueue.current = task.catch(() => {});
        return task;
    };

    const bindAgent = (row, agentId) => runMembership(row,
        // A THUNK, so the slot is computed when the queue reaches this write, not
        // when the chip was clicked.
        () => linkAgentInstruction(darwinUri, idToken, agentId, row.id,
            nextInstructionSortOrder(agentId,
                instructionLinksByAgent(freshAgentInstructions()))),
        `Could not bind "${row.name}" to ${agentIndex.get(agentId)?.name || 'that agent'}`);

    /**
     * Bind every remaining agent in ONE round trip.
     *
     * Uses the array-body POST (`linkAgentInstructions` -> _rest_post_bulk), not a
     * loop of single binds. Two reasons: eleven sequential Lambda invocations behind
     * one click is slow enough to feel broken, and a loop is exactly the
     * half-applied-set failure mode the one-chip-one-write rule was adopted to
     * avoid — a single multi-value INSERT either lands or does not.
     *
     * Slots are computed per agent from the SAME fresh snapshot. That is safe where
     * a loop would not be: every row targets a different `agent_fk`, so no two of
     * them can compete for one agent's next slot.
     */
    const bindAllAgents = (row, agentsToBind) => runMembership(row,
        () => {
            const fresh = freshAgentInstructions();
            const links = instructionLinksByAgent(fresh);
            // RE-FILTER at execution time, not just re-compute the slots. The list
            // arrived from a click on a render that may be seconds old, and a link
            // created meanwhile in another tab, by the MCP tool, or by another user
            // would put an already-present (agent_fk, instruction_fk) pair in the
            // body. This is ONE multi-value INSERT, not an upsert, so a single
            // composite-PK collision fails the WHOLE batch — none of the eleven
            // land, for a row that was already partly correct.
            const alreadyBound = new Set(fresh
                .filter(l => l.instruction_fk === row.id)
                .map(l => l.agent_fk));
            const rows = agentsToBind
                .filter(a => !alreadyBound.has(a.id))
                .map(a => ({
                    agent_fk: a.id,
                    instruction_fk: row.id,
                    sort_order: nextInstructionSortOrder(a.id, links),
                }));
            // linkAgentInstructions no-ops on an empty list, so a fully-raced
            // click is a clean nothing rather than an error.
            return linkAgentInstructions(darwinUri, idToken, rows);
        },
        `Could not bind "${row.name}" to all remaining agents`);

    const unbindAgent = (row, agentId) => runMembership(row,
        () => unlinkAgentInstruction(darwinUri, idToken, agentId, row.id),
        `Could not unbind "${row.name}" from ${agentIndex.get(agentId)?.name || 'that agent'}`);

    /**
     * Unbind confirmation, in the house parent-owns-state shape: the dialog only
     * sets `confirmed`, and this effect-driven callback performs the write. Replaces
     * a `window.confirm`, which was the one confirmation on this page that did not
     * look like Darwin and which no Playwright run could answer.
     */
    const unbindConfirm = useConfirmDialog({
        onConfirm: ({ row, agent }) => {
            if (row && agent) unbindAgent(row, agent.id);
        },
        defaultInfo: {},
    });

    // Both views raise the unbind through here, so the slot the dialog warns about
    // is captured the same way in each. `slot` rides on the agent object because
    // that is the shape InstructionUnbindDialog already reads.
    const requestUnbind = (row, agent, slot) =>
        unbindConfirm.openDialog({ row, agent: { ...agent, slot } });

    /** The junction slot an agent currently loads this row at. */
    const slotOf = (rowId) => (agentId) => (instrLinks.get(agentId) || [])
        .find(l => l.instruction_fk === rowId)?.sort_order;

    // ---------- create (template row) ----------

    /**
     * POST as soon as both required columns are filled and the name is free.
     *
     * The template pattern normally fires on one field's blur; a row with two NOT
     * NULL columns needs a two-field predicate instead. Both template fields are
     * CONTROLLED, so the draft state is current on every keystroke and this reads
     * it directly rather than being handed a pending value.
     *
     * Called on EVERY blur of either field, not only when one changed — which is
     * what makes a failed POST retryable by clicking back into a field and out
     * again. It is idempotent by the guards below.
     */
    const maybeCreate = async () => {
        const name = draftName.trim();
        const content = draftContent;
        if (creating || !name || !content.trim()) return;
        if (instructionNameError(name, instructions || [], null)) return;
        if (instructionContentError(content)) return;

        setCreating(true);
        try {
            await createInstruction(darwinUri, idToken,
                { name, content, creator_fk: creatorFk });
            setDraftName('');
            setDraftContent('');
            await invalidateRows();
            // Put the caret back in the blank template so a second row can be
            // typed without reaching for the mouse — but ONLY if the user has not
            // already moved on. This runs a full round trip after their blur, and
            // stealing focus out of another row would fire that row's blur and
            // commit whatever half-typed text was in it.
            setTimeout(() => {
                const active = document.activeElement;
                // Only reclaim focus when nothing else holds it. Previously this
                // also fired when focus was elsewhere INSIDE the template, so
                // filling content, clicking into name, then clicking back into
                // content would yank the caret back to name after the create.
                const nobodyHasIt = !active || active === document.body;
                if (nobodyHasIt) templateNameRef.current?.focus();
            }, 0);
        } catch (err) {
            // Deliberately NOT rethrown: the draft must survive so the user can
            // retry. Their next blur of either field calls this again.
            await invalidateRows();
            showError(err, restErrorMessage(err, 'Could not create the instruction'));
        } finally {
            setCreating(false);
        }
    };

    // ---------- retire / delete ----------

    const setClosedFlag = async (row, closed) => {
        const target = row || deleteTarget;
        if (!target) return;
        setBusy(true);
        try {
            await updateInstruction(darwinUri, idToken, target.id, { closed });
            await invalidateRows();
            setDeleteTarget(null);
        } catch (err) {
            await invalidateRows();
            showError(err, restErrorMessage(err,
                closed ? 'Could not close the instruction'
                       : 'Could not reopen the instruction'));
        } finally {
            setBusy(false);
        }
    };

    /**
     * CLOSE IS GRADUATED ON BLAST RADIUS.
     *
     * Closing drops the row out of every bound agent's boot payload, which is the
     * exact silent unloading InstructionDeleteDialog exists to make visible — so a
     * BOUND row still goes through the dialog, where the agent chips are. An UNBOUND
     * row has no blast radius at all; the dialog's own copy for that case reads "No
     * agent is bound to this instruction, so deleting it affects nothing at boot."
     * Ceremony with nothing to disclose trains people to click past ceremony that
     * does. The trailing ellipsis on the menu label is what tells the two apart.
     */
    const menuCloseInstruction = (row) => {
        if (row.refs.length === 0) { setClosedFlag(row, 1); return; }
        setDialogIntent('close');
        setDeleteTarget(row);
    };

    // Reopening RESTORES a duty rather than removing one, so there is nothing to
    // disclose and no dialog — the worst case is an agent loading an instruction it
    // used to load. Closed rows are only visible with the Closed filter on, so the
    // user is already in a deliberate mode when they can reach this.
    const menuReopenInstruction = (row) => setClosedFlag(row, 0);

    // Delete ALWAYS goes through the dialog. `agent_instructions` CASCADEs on both
    // FKs; the chip list and the typed-name challenge are the only guardrail.
    const menuDeleteInstruction = (row) => {
        setDialogIntent('delete');
        setDeleteTarget(row);
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setBusy(true);
        try {
            await deleteInstruction(darwinUri, idToken, deleteTarget.id);
            // A hard delete CASCADEs the junction rows, so both caches are stale.
            await invalidateAll();
            setDeleteTarget(null);
        } catch (err) {
            await invalidateAll();
            showError(err, restErrorMessage(err, 'Could not delete the instruction'));
        } finally {
            setBusy(false);
        }
    };

    if (isLoading || !instructions || !relationshipsReady) {
        return (
            <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
                {instructions && !relationshipsReady ? (
                    <Alert severity="error" data-testid="instructions-relationships-error">
                        The agent bindings could not be loaded, so this page cannot show which
                        agents each instruction binds. Editing is disabled rather than shown
                        without its blast radius — closing or deleting a row from here would
                        silently change what every bound agent loads at boot. Reload to retry.
                    </Alert>
                ) : <CircularProgress />}
            </Box>
        );
    }

    // Counted over the WHOLE catalog, not the filtered `rows` — an accounting line
    // that changed when you toggled a view filter would not be an accounting line.
    const openCount = instructions.filter(i => !i.closed).length;
    const closedCount = instructions.length - openCount;
    const unboundCount = instructions.filter(
        i => !i.closed && (byInstruction.get(i.id) || []).length === 0).length;

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            {/* The canonical viewer header, now a shared component
                (Components/ViewerHeader, req #3067). The reading order it enforces —
                [toggle][title flex:1][filters][settings][actions] — used to be three
                hand-rolled copies across /agents, /agents/instructions and
                /agents/documents, which is precisely how they drifted. */}
            <ViewerHeader
                title="Instructions"
                views={VIEWS}
                view={activeView}
                onViewChange={setView}
                testIdPrefix="instructions"
                filters={hasClosed && (
                    <Tooltip title={showClosed ? 'Hide closed instructions' : 'Show closed instructions'}>
                        <Chip
                            label="Closed"
                            size="small"
                            color={showClosed ? 'primary' : 'default'}
                            variant={showClosed ? 'filled' : 'outlined'}
                            onClick={() => setShowClosed(v => !v)}
                            sx={{ cursor: 'pointer', flexShrink: 0 }}
                            data-testid="instructions-show-closed"
                        />
                    </Tooltip>
                )}
                // THE GEAR IS CARDS-ONLY. The Table view sorts through its own column
                // headers — that is what a DataGrid header is for, and a grid whose
                // headers do nothing reads as broken. Offering both at once would be
                // two sort UIs on one page that can disagree with each other. The
                // grid is SEEDED from this mode when it mounts (see
                // `gridSortFromMode`), so switching views is continuous rather than a
                // jump.
                settingsItems={activeView === 'cards' ? [{
                    id: 'sort',
                    heading: 'Sort by',
                    items: SORT_MODES.map(({ value, label, icon: Icon, defaultDesc }) => ({
                        id: value,
                        label,
                        icon: <Icon fontSize="small" />,
                        selected: sortMode === value,
                        // The arrow is the only affordance telling the user that
                        // re-picking the active mode reverses it — without it the
                        // second click looks broken.
                        trailing: sortMode === value
                            ? (sortDesc
                                ? <ArrowDownwardIcon fontSize="small" sx={{ ml: 2, opacity: 0.7 }} />
                                : <ArrowUpwardIcon fontSize="small" sx={{ ml: 2, opacity: 0.7 }} />)
                            : null,
                        onClick: (close) => chooseSort(value, defaultDesc, close),
                    })),
                }] : undefined}
                // Accounting only. The prose that used to live here explained the
                // interaction, which the views now demonstrate on their own.
                accounting={[
                    `${openCount} instruction${openCount === 1 ? '' : 's'}`,
                    unboundCount > 0 && `${unboundCount} not bound`,
                    closedCount > 0 && `${closedCount} closed`,
                ].filter(Boolean).join(' · ')}
            />

            {activeView === 'table' ? (
                <InstructionsTableView
                    rows={rows}
                    instructions={instructions}
                    fieldErrors={fieldErrors}
                    agentIndex={agentIndex}
                    openAgents={openAgents}
                    slotOf={slotOf}
                    isMembershipBusy={isMembershipBusy}
                    timezone={timezone}
                    sortMode={sortMode}
                    sortDesc={sortDesc}
                    commitField={commitField}
                    noteFieldError={noteFieldError}
                    onBind={bindAgent}
                    onBindAll={bindAllAgents}
                    onRequestUnbind={requestUnbind}
                    onOpenAgent={(agentId) => navigate(`/agents/${agentId}#instructions`)}
                    onCloseInstruction={menuCloseInstruction}
                    onReopen={menuReopenInstruction}
                    onDelete={menuDeleteInstruction}
                    draftName={draftName}
                    setDraftName={setDraftName}
                    draftContent={draftContent}
                    setDraftContent={setDraftContent}
                    creating={creating}
                    onMaybeCreate={maybeCreate}
                    templateNameRef={templateNameRef}
                    renameNotice={renameNotice}
                    onDismissRenameNotice={() => setRenameNotice(null)}
                />
            ) : (
            /* Card grid, matching the /agents index. `alignItems: start` so a card
               with long content grows on its own instead of stretching every card in
               its row to match. Cards remain the place to COMPOSE long prose: the
               Table view fits four lines per row and scrolls the rest inside the
               cell, which is right for scanning and correcting but not for writing.
               One column on small screens keeps the cards readable. */
            <Box
                data-testid="instructions-registry"
                sx={{
                    display: 'grid',
                    gap: 2,
                    alignItems: 'start',
                    gridTemplateColumns: {
                        xs: '1fr',
                        lg: 'repeat(2, minmax(0, 1fr))',
                        xl: 'repeat(3, minmax(0, 1fr))',
                    },
                }}
            >
                {rows.map(row => {
                    const blocked = rowBlocked(row.id);
                    const membershipBusy = isMembershipBusy(row.id);
                    const boundSet = new Set(row.refs);

                    return (
                        <Card key={row.id} variant="outlined"
                               id={`instruction-${row.id}`}
                               sx={{
                                   scrollMarginTop: 16,
                                   ...(row.closed && { opacity: 0.55 }),
                               }}
                               data-testid={`instruction-row-${row.id}`}>
                          <CardContent sx={CARD_CONTENT_SX}>
                            {/* Row 1 is the name plus the retire action. The
                                bordered field cannot share a line with the chips the
                                way bare text could, so the chips get their own row.
                                NOTE: there is deliberately no catalog-order control
                                here. `instructions.sort_order` was verified byte-
                                identical to `agent_instructions.sort_order` on all 78
                                live rows, and since the sort menu shipped it only
                                acts as a tiebreak — so editing it changed nothing
                                observable while inviting exactly the catalog-vs-load
                                confusion agentRegistryUtils warns about. The column
                                remains; the control is gone. */}
                            {/* CARD HEADER, in the TaskCard / CategoryCard idiom:
                                the record's identity as an always-editable
                                BORDERLESS heading in a `1fr auto` grid, with an
                                overflow menu holding the row's actions.
                                `.card-header` is the shared class those two cards
                                use — the pattern is a CSS class, not a component,
                                and this is its third instantiation.

                                THE TITLE ALONE DROPS ITS BORDER AND LABEL; every
                                other field on this card keeps outlined+label. That
                                is a category distinction, not a compromise: a form
                                field is a labelled slot you fill and needs a label
                                because the value alone does not say what it is; a
                                heading IS the record's identity and is
                                self-describing, so a label above it is a tautology
                                and an outline boxes the one element that should read
                                as the card's title. TaskCard and CategoryCard both
                                ship a bare editable heading over outlined content,
                                so this is Darwin's existing resolution of the same
                                collision. The commit contract is untouched.

                                No monospace: that was right when names were
                                kebab-case slugs, and req #3068 made them English
                                prose. Monospace prose in a heading looks like a bug. */}
                            <Box className="card-header" sx={{ mb: 1 }}>
                                <GhostTextField
                                    value={row.name}
                                    required
                                    // WRAPS but does not accept newlines. Note
                                    // `commitOnEnter` DEFAULTS to `!multiline`, so
                                    // adding `multiline` without keeping this prop
                                    // explicit would silently turn Enter into a
                                    // newline inside a name.
                                    multiline
                                    commitOnEnter
                                    // Bounds the pathological case. The longest live
                                    // name is 50 chars (wraps to 2 lines in a
                                    // one-third-width card) but the column is
                                    // VARCHAR(256): uncapped, one name could stand a
                                    // card ~8 lines taller than its row.
                                    maxRows={3}
                                    // An emptied required field reverts on blur, but
                                    // between the clear and the blur a ghost heading
                                    // with no text is invisible. The placeholder keeps
                                    // the row occupying space and self-describing.
                                    placeholder="Instruction name"
                                    // Trimmed before it is validated, displayed or
                                    // stored. MySQL 8's collation is NO PAD, so
                                    // "  x  " and "x" are DIFFERENT rows under the
                                    // unique key — a padded name would then block the
                                    // clean one as a collision the user cannot see.
                                    // Collapses newlines, not just outer space. The
                                    // field is `multiline` so it WRAPS rather than
                                    // clipping, which also means a pasted two-line
                                    // string would otherwise store a name with an
                                    // embedded \n — invisible in the UI and in every
                                    // doc that cites the row.
                                    normalize={(text) => text.replace(/\s+/g, ' ').trim()}
                                    validate={(text) => instructionNameError(
                                        text, instructions, row.id)}
                                    onCommit={commitField(row, 'name', 'instruction name')}
                                    onErrorChange={noteFieldError(row.id, 'name')}
                                    inputProps={{ maxLength: INSTRUCTION_NAME_MAX }}
                                    // Type scale matched to the /agents card heading,
                                    // the sibling card grid this page copied — NOT to
                                    // TaskCard's 24px, which suits a 32-char area name
                                    // in a wide single-column card. Set on the INPUT
                                    // rather than inherited from `.card-header`'s
                                    // font-size: ghostBase declares `fontSize:
                                    // inherit`, and the load order of index.css versus
                                    // emotion's injected sheet is not guaranteed, so
                                    // an inherited value could lose to the class.
                                    // 1.4rem — the /agents card heading scale (1.05rem)
                                    // taken up 33% by user direction. Still well below
                                    // TaskCard's 24px, which the architect ruled out
                                    // for a prose title in a one-third-width card.
                                    sx={{
                                        fontSize: '1.4rem',
                                        fontWeight: 500,
                                        '& .MuiInputBase-input': {
                                            fontSize: '1.4rem',
                                            fontWeight: 500,
                                        },
                                    }}
                                    testId={`instruction-name-input-${row.id}`}
                                />
                                {/* The same component the table's actions column
                                    renders, so the two views cannot drift on the
                                    graduated-close affordance or on their testids. */}
                                <InstructionRowMenu
                                    row={row}
                                    onCloseInstruction={menuCloseInstruction}
                                    onReopen={menuReopenInstruction}
                                    onDelete={menuDeleteInstruction}
                                />
                            </Box>

                            {/* mb: 2 — the pills need visible air between them and the
                                instruction text below, or the row reads as a caption
                                belonging to the description. */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                                {row.refs.length === 0 ? (
                                    <Chip label="0 agents — not bound" size="small" color="warning"
                                          variant="outlined"
                                          data-testid={`instruction-unbound-${row.id}`} />
                                ) : (
                                    <Chip label={`${row.refs.length} agent${row.refs.length === 1 ? '' : 's'}`}
                                          size="small" variant="outlined" />
                                )}
                                {/* `!!` is load-bearing: `closed` is a MySQL TINYINT,
                                    so it arrives as the NUMBER 0, and `0 && <Chip/>`
                                    evaluates to 0 — which React renders as a literal
                                    "0" next to the chips rather than nothing. */}
                                {!!row.closed && (
                                    <Chip label="closed" size="small"
                                          data-testid={`instruction-closed-${row.id}`} />
                                )}
                                {/* With no Save button, "blocked" has no natural
                                    signal — without this chip the user navigates away
                                    believing the value was written. */}
                                {blocked && (
                                    <Chip label="unsaved" size="small" color="error" variant="outlined"
                                          data-testid={`instruction-unsaved-${row.id}`} />
                                )}
                            </Box>

                            {/* No focus-time blast-radius alert and no warning
                                border (both removed by user direction). The blast
                                radius is carried by the agent chips at the foot of
                                the card and the count chip above — always on, never
                                waiting for you to touch a field. */}
                            <Box sx={{ mb: 1.5 }}>
                                <GhostTextField
                                    value={row.content}
                                    outlined
                                    label="Instruction text"
                                    fullWidth
                                    required
                                    multiline
                                    validate={instructionContentError}
                                    // Hints only while the field is in use: a
                                    // permanent caption under every card would be
                                    // noise, and neither of these is a block.
                                    hint={contentEditingId === row.id ? (text) => (
                                        text.length > INSTRUCTION_CONTENT_HINT_LENGTH
                                            ? 'Long content usually belongs in an architecture document — instructions are short binding rules.'
                                            : null
                                    ) : undefined}
                                    onCommit={commitField(row, 'content', 'instruction content')}
                                    onEditingChange={(on) => setContentEditingId(on ? row.id : null)}
                                    onErrorChange={noteFieldError(row.id, 'content')}
                                    testId={`instruction-content-input-${row.id}`}
                                />
                            </Box>

                            {renameNotice?.id === row.id && (
                                <Alert severity="info" sx={{ mb: 1.5, py: 0 }}
                                       onClose={() => setRenameNotice(null)}
                                       data-testid="instruction-rename-warning">
                                    Renamed <code>{renameNotice.from}</code> →{' '}
                                    <code>{renameNotice.to}</code>. Safe: nothing resolves an
                                    instruction by name, and the charter stubs and memory docs cite
                                    it as <code>instruction #{renameNotice.id}</code> rather than by
                                    title (req #3068).
                                </Alert>
                            )}

                            <InstructionAgentChips
                                boundAgentIds={row.refs}
                                agentIndex={agentIndex}
                                bindableAgents={openAgents.filter(a => !boundSet.has(a.id))}
                                slotOf={slotOf(row.id)}
                                onBind={(agentId) => bindAgent(row, agentId)}
                                onBindAll={(agentsToBind) => bindAllAgents(row, agentsToBind)}
                                onRequestUnbind={(agent, slot) => requestUnbind(row, agent, slot)}
                                onOpenAgent={(agentId) => navigate(`/agents/${agentId}#instructions`)}
                                busy={membershipBusy}
                                testIdPrefix={`instruction-${row.id}`}
                            />
                          </CardContent>
                        </Card>
                    );
                })}

                {/* The template row. Per instruction #41 (the frontend
                    template-row rule) an inline-editable list ends with a blank item the
                    user fills in place — never an explicit add button. It carries
                    no chips and no delete: membership needs a row id, so a new row
                    is bound with its own chips once it exists. That is also what
                    retires the old two-phase create-then-link failure mode, where a
                    successful POST followed by a failed link left a row bound to
                    nobody and a dialog reporting an error. */}
                <Card variant="outlined" ref={templateRef}
                       sx={{ borderStyle: 'dashed' }}
                       data-testid="instruction-row-template">
                  <CardContent sx={CARD_CONTENT_SX}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                        {/* CONTROLLED: the draft lives in the page, so clearing it
                            after a successful create empties the field even if it
                            still holds focus. With a local copy, a create triggered
                            by tabbing OUT of this field would leave the other one
                            holding the row's text and the next row would silently
                            inherit it. */}
                        <GhostTextField
                            value={draftName}
                            onChangeText={setDraftName}
                            outlined
                            label="Name"
                            fullWidth
                            commitOnEnter
                            placeholder="New instruction name"
                            validate={(text) => instructionNameError(
                                text, instructions, null)}
                            onCommit={maybeCreate}
                            inputProps={{ maxLength: INSTRUCTION_NAME_MAX }}
                            inputRef={templateNameRef}
                            testId="instruction-name-input-template"
                        />
                        {creating && <CircularProgress size={14} sx={{ mt: 1.5 }} />}
                    </Box>
                    <GhostTextField
                        value={draftContent}
                        onChangeText={setDraftContent}
                        outlined
                        label="Instruction text"
                        fullWidth
                        multiline
                        placeholder="Binding text — loaded verbatim into every agent bound to it."
                        validate={instructionContentError}
                        hint={(text) => (draftName.trim() && !text.trim()
                            ? 'Fill both fields — the row is created when the second one is filled.'
                            : null)}
                        onCommit={maybeCreate}
                        testId="instruction-content-input-template"
                    />
                  </CardContent>
                </Card>
            </Box>
            )}

            <InstructionUnbindDialog
                open={unbindConfirm.dialogOpen}
                setOpen={unbindConfirm.setDialogOpen}
                setConfirmed={unbindConfirm.setConfirmed}
                instruction={unbindConfirm.infoObject?.row}
                agent={unbindConfirm.infoObject?.agent}
            />

            <InstructionDeleteDialog
                open={!!deleteTarget}
                onClose={() => { setDeleteTarget(null); setDialogIntent('delete'); }}
                onClose_Instruction={() => setClosedFlag(deleteTarget, 1)}
                onReopen={() => setClosedFlag(deleteTarget, 0)}
                intent={dialogIntent}
                onDelete={handleDelete}
                instruction={deleteTarget}
                // EVERY binding, including closed agents': a hard delete cascades
                // all of them away, so all of them belong in the warning. The
                // dialog counts the open ones separately for the "load at boot"
                // wording — data loss and boot impact are different questions.
                boundAgents={deleteTarget
                    ? (byInstruction.get(deleteTarget.id) || [])
                        .map(aid => agentIndex.get(aid))
                        .filter(Boolean)
                        .map(a => ({ name: a.name, closed: !!a.closed }))
                    : []}
                busy={busy}
            />
        </Box>
    );
};

export default InstructionsPage;
