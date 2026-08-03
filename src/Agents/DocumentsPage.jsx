// /agents/documents — THE architecture-document registry (req #2998,
// editable req #3051).
//
// One row per document, with the reverse-link direction of /agents/:id: there the
// question is "what does this agent own?"; here it is "who owns this file?" —
// the question that had no answer before the registry existed, and the reason
// ownership drifted silently for years.
//
// At most one `owned` link may exist per document; that is enforced by a UNIQUE
// key on a VIRTUAL generated column, not by convention. A row rendering without
// an owner chip therefore means genuinely unowned, not a UI gap.
//
// ---------------------------------------------------------------------------
// REQ #3051 — EVERY FACET OF A DOCUMENT IS NOW EDITABLE, EXCEPT THE DOCUMENT.
// ---------------------------------------------------------------------------
//
// In scope: every column of `architecture_documents` worth editing, and every
// column of the `agent_documents` links. Out of scope, permanently: the FILE
// CONTENTS. This registry stores a `location` and a `url`, never content; the
// browser has no filesystem; and the OpenInNew link out to GitHub or the rendered
// site is the whole content affordance. Also out: `creator_fk` / `create_ts` /
// `update_ts` (server-owned), `architecture_documents.sort_order` (see below),
// and `agent_documents.sort_order` (owned by AgentDetail — this page carries it
// through every write untouched, and never sets it except on a brand-new link).
//
// CARDS, NOT A TABLE, and not merely to match /agents/instructions. The thing
// being edited on each row is a variable-height set of agent relationships — one
// document carries twelve links today, and the edit affordance unfurls the rest
// of the roster as ghost chips. A DataGrid is fixed-row-height by house rule, so
// it structurally cannot host that. Per-link `notes` has nowhere to live in a
// document-per-row table either, and 87 of the 100 live links carry one.
//
// WHICH FIELD IS DANGEROUS IS COUNTER-INTUITIVE, and the UI is shaped around it:
//
//   * `location` LOOKS like a caption and is the riskiest value on the page.
//     Instruction #83 orders all twelve architects to read every `autoload`
//     document from its `location` in full before starting work. The executor is
//     an LLM, so nothing type-checks the path and nothing fails loudly — a wrong
//     one means the agent boots without knowledge it was told to have and reports
//     itself green. Editing it therefore goes through DocumentLocationDialog
//     whenever any agent autoloads the document.
//
//   * `name` LOOKS load-bearing — it is UNIQUE and the registry docs call it "the
//     idempotent-seed key" — and is not. Verified for this requirement: nothing
//     under `scripts/` references either document table, so there is no seed to
//     re-run and no duplicate-row hazard, and `get_architecture_document_by_name`
//     has no caller outside the MCP test suite. A rename is prose, exactly as
//     req #3068 concluded for instruction names. So it is an ordinary
//     commit-on-blur heading.
//
// `architecture_documents.sort_order` IS NOT EDITABLE and is not merely omitted:
// the column is incoherent (thirteen rows share the value 1, one is NULL) and
// nothing reads it — the boot payload orders by relationship rank then the
// junction's own `sort_order`, and this page has always re-sorted by name. The
// server-side default sort was its last consumer, so `devopsQueries` now asks for
// `name:asc` and the browse-sort control below replaces it. That is deliberately
// the same sequence req #3063 ran before migration 072 dropped
// `instructions.sort_order`; a follow-on requirement measures and drops this one.
//
// ONE PUT PER FIELD, CARRYING ONLY THAT FIELD. `rest_put.py` builds its SET
// clause from the body's keys and has no version column, so a whole-row PUT would
// silently revert whatever another tab had just changed. Each ghost field writes
// its own column and nothing else.
//
// THE JUNCTION IS THE OPPOSITE: EVERY COLUMN, EVERY TIME. `agent_documents` has
// no `id`, so Lambda-Rest cannot PUT it and a role change is a DELETE plus a
// fresh INSERT. An INSERT that omits `notes` or `sort_order` does not leave them
// alone — it writes NULL over them. That asymmetry is the likeliest silent defect
// in this area, so it is handled in exactly one place (`linkRow` in
// documentsApi.js) rather than at each call site.

import '../index.css';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CloseIcon from '@mui/icons-material/Close';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import ViewModuleIcon from '@mui/icons-material/ViewModule';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import GhostTextField from '../Components/GhostField/GhostTextField';
import {
    useArchitectureDocuments, useAgents, useAgentDocuments,
    architectureDocumentKeys, agentDocumentKeys,
} from '../hooks/useDataQueries';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useViewPreference } from '../hooks/useViewPreference';
import ViewerHeader from '../Components/ViewerHeader/ViewerHeader';
import { normalizeView } from '../Components/ViewerHeader/normalizeView';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import {
    byId, linksByAgent, linksByDocument, documentOwnerLink,
    relationshipChipProps, docTypeChipProps, documentHref,
    hasRole, isAutoload,
    nextDocumentSortOrder, planOwnerTransfer, restErrorMessage,
    documentNameError, documentLocationError, documentUrlError, docTypeError,
    DOC_TYPES, DOCUMENT_NAME_MAX, DOCUMENT_LOCATION_MAX, DOCUMENT_URL_MAX,
} from './agentRegistryUtils';
import {
    createArchitectureDocument, updateArchitectureDocument,
    deleteArchitectureDocument, linkAgentDocument, linkAgentDocuments,
    applyLinkPlan, setAgentDocumentLink, LinkRollbackError,
} from './actions/documentsApi';
import {
    SORT_MODES, SORT_STORAGE_KEY, readStoredSort, compareDocumentRows,
} from './documentSort';
import { useBusyCounts } from '../hooks/useBusyCounts';
import { CommitModeMarker, CommitModeLegend } from './commitModes';
import DocumentAgentChips from './DocumentAgentChips';
import DocumentTargetChips from './DocumentTargetChips';
import DocumentLinkPopover from './DocumentLinkPopover';
import DocumentOwnerDialog from './DocumentOwnerDialog';
import DocumentUnbindDialog from './DocumentUnbindDialog';
import DocumentDeleteDialog from './DocumentDeleteDialog';
import DocumentLocationDialog from './DocumentLocationDialog';

// Matches InstructionsPage: CardContent adds a 24px bottom pad to its last child
// on top of its own 16px, so both are pinned to `p: 2` to keep the two registry
// pages' card interiors identical.
const CARD_CONTENT_SX = { p: 2, '&:last-child': { pb: 2 } };

// Thrown by the location field to make GhostTextField revert while the
// confirmation dialog decides. Nothing failed, so nothing is reported — see
// `commitLocation`.
class LocationNeedsConfirmation extends Error {}

// One entry, deliberately. `ViewerHeader` always renders the ToggleButtonGroup even
// at length 1, and that is what preserves the far-left anchor and the title's
// x-position against the other viewers until a Table view for this page ships. It
// is NOT a placeholder for a disabled button — see the standing exception in
// memory/darwin-viewer-pages.md.
const VIEWS = [
    { value: 'cards', label: 'Cards view', icon: ViewModuleIcon },
];

const DocumentsPage = () => {
    const navigate = useNavigate();
    const { profile, idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const isMobile = useMediaQuery('(max-width:899px)');
    const creatorFk = profile?.userName;

    const { data: documents, isLoading } = useArchitectureDocuments(creatorFk);
    const { data: agents } = useAgents(creatorFk);
    const { data: agentDocs } = useAgentDocuments(creatorFk);

    // EVERY destructive decision on this page reads the junction. It decides
    // whether closing a row goes straight through or via the dialog, it drives
    // the delete dialog's agent list and its typed-name challenge, and it is the
    // entire owner column. An UNRESOLVED junction query makes every document look
    // unowned — so a document twelve architects reference would delete with no
    // challenge and a dialog claiming zero blast radius.
    //
    // `isLoading` covers only `useArchitectureDocuments`, and `fetchEntity` maps
    // 404 to [] but RETHROWS every other status — so a 500 on /agent_documents
    // leaves this undefined permanently, not briefly. Treat missing relationship
    // data as a hard stop, not as "no relationships".
    const relationshipsReady = !!agents && !!agentDocs;

    const [showClosed, setShowClosed] = useState(false);
    const [showUnownedOnly, setShowUnownedOnly] = useState(false);
    const [view, setView] = useViewPreference('darwin-documents-view', 'cards');
    // Cards is the only view built here; a Table view for this page is a later
    // requirement. The normalization is no longer hand-rolled — `normalizeView` is
    // the generic form, and it does the same job for the same reason: a 'table'
    // value can still be sitting in this browser's storage, and an unmatched
    // ToggleButtonGroup value selects nothing, so the toggle would render with no
    // active state at all.
    const activeView = normalizeView(view, VIEWS);

    const [sortMode, setSortMode] = useState(readStoredSort);
    const [sortDesc, setSortDesc] = useState(
        () => SORT_MODES.find(m => m.value === readStoredSort())?.defaultDesc ?? false);

    const [deleteTarget, setDeleteTarget] = useState(null);
    const [dialogIntent, setDialogIntent] = useState('delete');
    // Per-card options menu. Stores the ROW ID plus the anchor element, never the
    // row object: a refetch can land while the menu is open (every chip click
    // invalidates these queries), and a snapshotted row would make the
    // graduated-close decision from a stale link count.
    const [menuAnchor, setMenuAnchor] = useState(null);
    const [busy, setBusy] = useState(false);
    // Membership writes are pessimistic and scoped to one card, so the spinner is
    // too. A per-row COUNTER rather than a single id or a set of ids: two cards can
    // legitimately be mid-write (a single id would let the first to finish clear
    // the second's spinner), and so can two writes against the SAME card — which a
    // boolean-via-Set got wrong, releasing the flag when the first of the two
    // finished (req #3101, closing finding 3c). See useBusyCounts.
    const { mark: markMembershipBusy, isBusy: isMembershipBusy } = useBusyCounts();
    // `${rowId}:${field}` -> error message, for rows holding a blocked value.
    const [fieldErrors, setFieldErrors] = useState({});
    // Which non-owner link is being edited, and where to anchor its popover.
    const [linkEditor, setLinkEditor] = useState(null);
    // Owner-row roster palettes, by document id.
    const [ownerPaletteId, setOwnerPaletteId] = useState(null);
    // Persistent per-document notice that a transfer left the document unowned.
    // Keyed by id and rendered ONLY while the card really is unowned, so a resync
    // that reveals a different owner retires it without any extra bookkeeping.
    const [ownerAlerts, setOwnerAlerts] = useState({});
    const [keepOutgoing, setKeepOutgoing] = useState(true);

    // Template-row drafts. All CONTROLLED, so clearing them after a successful
    // create empties the fields even while one still holds focus.
    const [draftName, setDraftName] = useState('');
    const [draftLocation, setDraftLocation] = useState('');
    const [draftUrl, setDraftUrl] = useState('');
    const [draftType, setDraftType] = useState('markdown');
    const [creating, setCreating] = useState(false);
    const templateNameRef = useRef(null);

    // AgentDetail's relationship chip drills through to `#document-<id>`. A
    // client-side route change does not make the browser honour a hash, so the
    // scroll is explicit — and it waits for the rows, which do not exist on the
    // first render after the navigation.
    //
    // ONCE PER HASH, and only once the row is actually on screen. The dependency
    // list has to include the data, but every field save refetches and hands back
    // a new `documents` identity — so without the latch, saving anything would
    // smooth-scroll the viewport back to the drill-through target for as long as
    // the hash sat in the URL.
    const scrolledToHash = useRef(null);
    useEffect(() => {
        if (isLoading) return;
        const hash = window.location.hash;
        if (!hash || scrolledToHash.current === hash) return;

        // The target may be a CLOSED row, which the list filters out by default —
        // then the drill-through would land on nothing at all and look broken.
        const targetId = Number(hash.replace('#document-', ''));
        if (Number.isFinite(targetId) && !showClosed
            && (documents || []).some(d => d.id === targetId && d.closed)) {
            setShowClosed(true);
            return;                        // re-runs once the row is rendered
        }

        const el = document.getElementById(hash.slice(1));
        if (!el) return;
        scrolledToHash.current = hash;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [isLoading, documents, showClosed]);

    // Only the MODE persists. Direction resets to the mode's natural end on
    // reload, so a user who flipped to "fewest agents" once does not silently come
    // back tomorrow to a page that buries its own headline rows.
    useEffect(() => {
        try { localStorage.setItem(SORT_STORAGE_KEY, sortMode); } catch { /* private mode */ }
    }, [sortMode]);

    // CategoryCard's shipped idiom: picking the ACTIVE mode flips its direction
    // and keeps the menu open so the arrow change is visible; picking a new mode
    // adopts that mode's natural direction and closes.
    const chooseSort = (value, defaultDesc, close) => {
        if (sortMode === value) { setSortDesc(d => !d); return; }
        setSortMode(value);
        setSortDesc(defaultDesc);
        // `close` is handed in by ViewerHeader, which owns the menu anchor. It is
        // deliberately not called on the direction-flip path above.
        close?.();
    };

    const agentIndex = useMemo(() => byId(agents || []), [agents]);
    const byDocument = useMemo(() => linksByDocument(agentDocs || []), [agentDocs]);
    // NOTE: there is deliberately no render-time `linksByAgent` memo here. Every
    // consumer of it computes per-agent slots INSIDE a queued write, from
    // `freshAgentDocuments()` — a render-time index would be exactly the stale
    // snapshot those thunks exist to avoid.

    const openAgents = useMemo(
        () => (agents || []).filter(a => !a.closed)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        [agents]);

    const hasClosed = useMemo(
        () => (documents || []).some(d => d.closed), [documents]);

    // Every document, decorated with its links and its owner. Built over the FULL
    // catalog (not the filtered view) so the accounting line and the filter
    // predicates read from one place.
    const allRows = useMemo(() => {
        if (!documents) return [];
        return documents.map(d => {
            const links = byDocument.get(d.id) || [];
            const owner = documentOwnerLink(links);
            return {
                ...d,
                links,
                owner,
                ownerName: owner ? (agentIndex.get(owner.agent_fk)?.name || '') : '',
                others: links.filter(l => !hasRole(l.relationship, 'owned')),
            };
        });
    }, [documents, byDocument, agentIndex]);

    const hasUnowned = useMemo(
        () => allRows.some(r => !r.closed && !r.owner), [allRows]);

    const rows = useMemo(() => allRows
        .filter(r => (showClosed || !r.closed) && (!showUnownedOnly || !r.owner))
        .sort(compareDocumentRows(sortMode, sortDesc)),
    [allRows, showClosed, showUnownedOnly, sortMode, sortDesc]);

    // A row edit touches no junction row, so it invalidates the row query only.
    const invalidateRows = () => queryClient.invalidateQueries(
        { queryKey: architectureDocumentKeys.all(creatorFk) });

    // A link edit changes the junction AND the owner chip / accounting line
    // derived from it, so both caches go.
    const invalidateAll = () => Promise.all([
        invalidateRows(),
        queryClient.invalidateQueries({ queryKey: agentDocumentKeys.all(creatorFk) }),
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
        // Nullable columns store NULL rather than '' when cleared: an empty
        // string would make `documentHref` return a dead link instead of falling
        // back to the constructed GitHub blob URL.
        const nullable = field === 'location' || field === 'url';
        const value = nullable ? ((raw || '').trim() || null) : raw;
        try {
            await updateArchitectureDocument(darwinUri, idToken, row.id, { [field]: value });
            await invalidateRows();
        } catch (err) {
            await invalidateRows();
            showError(err, restErrorMessage(err, `Could not save the ${label}`));
            throw err;
        }
    };

    /** Open agents that read this document in full at boot. */
    const autoloadReaders = (row) => row.links
        .filter(l => isAutoload(l.relationship))
        .map(l => agentIndex.get(l.agent_fk))
        .filter(a => a && !a.closed);

    const locationConfirm = useConfirmDialog({
        onConfirm: async ({ document: row, next }) => {
            if (!row) return;
            try {
                await updateArchitectureDocument(darwinUri, idToken, row.id,
                    { location: next });
                await invalidateRows();
            } catch (err) {
                await invalidateRows();
                showError(err, restErrorMessage(err, 'Could not save the location'));
            }
        },
        defaultInfo: {},
    });

    /**
     * `location` is the one field whose commit can be intercepted.
     *
     * See DocumentLocationDialog's header for why. Graduated: a document nothing
     * autoloads has no boot to break, and ceremony with nothing to disclose trains
     * people to click past ceremony that does.
     *
     * The throw is not an error report — it is how GhostTextField is told to put
     * the STORED value back on screen, which is honest, because at that moment
     * nothing has been written. Deliberately not routed through `commitField`,
     * whose catch would surface a snackbar for a write that was merely deferred.
     */
    const commitLocation = (row) => async (raw) => {
        const next = (raw || '').trim() || null;
        if (next === (row.location || null)) return;
        const readers = autoloadReaders(row);
        if (readers.length === 0) {
            await commitField(row, 'location', 'location')(raw);
            return;
        }
        locationConfirm.openDialog({ document: row, next, readers });
        throw new LocationNeedsConfirmation();
    };

    const setDocType = async (row, docType) => {
        if (docType === row.doc_type) return;
        const invalid = docTypeError(docType);
        if (invalid) { showError(null, invalid); return; }
        try {
            await updateArchitectureDocument(darwinUri, idToken, row.id,
                { doc_type: docType });
            await invalidateRows();
        } catch (err) {
            await invalidateRows();
            showError(err, restErrorMessage(err, 'Could not change the document type'));
        }
    };

    // ---------- membership ----------

    // The freshest junction rows, for work that runs LATER than the render that
    // scheduled it. Read from the CACHE, not from a ref holding the last rendered
    // value: the cache updates synchronously when a refetch resolves, whereas a
    // ref only catches up once React has re-rendered, and nothing guarantees that
    // has happened by the time the next queued task starts. The key is matched by
    // PREFIX because the query factory appends a `{fields}` segment.
    const agentDocsRef = useRef(agentDocs);
    agentDocsRef.current = agentDocs;

    const freshAgentDocuments = () => {
        const entries = queryClient.getQueriesData(
            { queryKey: agentDocumentKeys.all(creatorFk) });
        for (const [, data] of entries) if (Array.isArray(data)) return data;
        return agentDocsRef.current || [];
    };

    /**
     * Membership writes run ONE AT A TIME across the whole page.
     *
     * Not for the user's benefit — for correctness, and more so here than on the
     * instructions page. A new link's slot is max(existing)+1 for that agent,
     * computed from the junction cache, so two concurrent writes would both read
     * the pre-write cache and claim the same slot. Worse, ownership is
     * DB-unique: two overlapping owner claims on one document race the unique
     * key, and the loser's error is meaningless without an order to attribute it
     * to.
     *
     * Serializing means the second write is planned only after the first one's
     * refetch has landed, and slots are read at EXECUTION time.
     */
    const membershipQueue = useRef(Promise.resolve());

    /**
     * RESOLVES `{ ok }` — it never rejects.
     *
     * Deliberately not the rethrowing shape. Most callers here are fire-and-forget
     * from a chip's onClick, so a rejecting promise nobody awaits is an unhandled
     * rejection on every failed bind — and the one caller that DOES need to know
     * (the ownership path, which must raise a standing notice when a transfer
     * strands a document unowned) needs a verdict rather than an exception. A
     * resolved verdict serves both without a `.catch()` at every call site, which
     * is the kind of thing that gets forgotten at the fourth one.
     */
    const runMembership = (rowId, fn, fallback) => {
        markMembershipBusy(rowId, true);
        const task = membershipQueue.current.then(async () => {
            try {
                await fn();
                await invalidateAll();
                return { ok: true };
            } catch (err) {
                // Resync BEFORE reporting: a display failure must never be able to
                // skip it, because the caches now disagree with the database.
                await invalidateAll();
                // A rollback failure outranks the error that caused it. "Your edit
                // was rejected" and "a link you did not touch is now missing" are
                // different things to tell a user, and the second one wins.
                showError(err, err instanceof LinkRollbackError
                    ? err.message
                    : restErrorMessage(err, fallback));
                return { ok: false, error: err };
            } finally {
                markMembershipBusy(rowId, false);
            }
        });
        // The queue must survive a failed task, or one error would wedge every
        // later write on the page. `task` cannot reject, but the guard stays: it
        // costs nothing and it is what stops a future edit to the body above from
        // silently wedging the page.
        membershipQueue.current = task.catch(() => {});
        return task;
    };

    /** Link an agent as `referenced` — the fast path, and the only one used by 32 of 32 live non-owner links. */
    const bindAgent = (row, agentId) => runMembership(row.id,
        () => linkAgentDocument(darwinUri, idToken, {
            agent_fk: agentId,
            document_fk: row.id,
            relationship: ['referenced'],
            notes: null,
            sort_order: nextDocumentSortOrder(agentId,
                linksByAgent(freshAgentDocuments())),
        }),
        `Could not link ${agentIndex.get(agentId)?.name || 'that agent'} to "${row.name}"`);

    /**
     * Link every remaining agent in ONE round trip.
     *
     * An array-body POST is a single multi-value INSERT — it either lands or it
     * does not — where a loop of single binds is exactly the half-applied-set
     * failure mode the one-chip-one-write rule exists to avoid.
     *
     * Slots are computed per agent from the SAME fresh snapshot, which is safe
     * here where a loop would not be: every row targets a different `agent_fk`,
     * so no two compete for one agent's next slot.
     */
    const bindAllAgents = (row, agentsToBind) => runMembership(row.id,
        () => {
            const fresh = freshAgentDocuments();
            const links = linksByAgent(fresh);
            // RE-FILTER at execution time, not just re-compute the slots. The list
            // came from a click on a render that may be seconds old, and a link
            // created meanwhile in another tab or by the MCP tool would put an
            // already-present pair in the body. This is ONE multi-value INSERT,
            // not an upsert, so a single composite-PK collision fails the WHOLE
            // batch — none of them land, for a document that was already partly
            // correct.
            const alreadyLinked = new Set(fresh
                .filter(l => l.document_fk === row.id)
                .map(l => l.agent_fk));
            const rowsToInsert = agentsToBind
                .filter(a => !alreadyLinked.has(a.id))
                .map(a => ({
                    agent_fk: a.id,
                    document_fk: row.id,
                    relationship: ['referenced'],
                    notes: null,
                    sort_order: nextDocumentSortOrder(a.id, links),
                }));
            // linkAgentDocuments no-ops on an empty list, so a fully-raced click
            // is a clean nothing rather than an error.
            return linkAgentDocuments(darwinUri, idToken, rowsToInsert);
        },
        `Could not link the remaining agents to "${row.name}"`);

    const unbindConfirm = useConfirmDialog({
        onConfirm: ({ document: row, agent, link }) => {
            if (!row || !link) return;
            runMembership(row.id,
                () => applyLinkPlan(darwinUri, idToken, [{
                    agent_fk: link.agent_fk,
                    document_fk: row.id,
                    prev: link,
                    next: null,
                }]),
                `Could not unlink ${agent?.name || 'that agent'} from "${row.name}"`);
        },
        defaultInfo: {},
    });

    /** Save the roles + notes staged in the link popover. */
    const saveLink = (row, next) => {
        const prev = row.links.find(
            l => l.agent_fk === next.agent_fk && l.document_fk === row.id);
        if (!prev) return;
        setLinkEditor(null);
        return runMembership(row.id,
            () => setAgentDocumentLink(darwinUri, idToken, { prev, next }),
            `Could not save the relationship for "${row.name}"`);
    };

    // ---------- ownership ----------

    /**
     * Run an ownership change.
     *
     * `buildSteps` is a THUNK, not a step list, so the plan is built when the
     * queue reaches this write rather than when the chip was clicked. That matters
     * for the same reason it matters on the bind path: a new link's `sort_order` is
     * max+1 read from the junction cache, and a plan built at click time would read
     * a cache that a previous queued write has since moved. It also means the plan
     * sees the CURRENT owner, so a transfer queued behind another transfer of the
     * same document releases whoever actually holds it.
     *
     * ROLLING BACK IS ATTEMPTED. `applyLinkPlan` unwinds in reverse order if a step
     * fails — because in the case that genuinely strands a document (a transient
     * failure on the claim) restoring the incumbent is exactly right, and is the
     * only thing that repairs it.
     *
     * The case where a rollback would be WRONG — someone else claimed ownership in
     * the window — takes care of itself rather than needing a special path: their
     * claim makes our restore fail on the same unique key, the resync repaints the
     * card with the real owner, and the standing alert below is then not rendered
     * at all, because it is conditioned on the card STILL BEING UNOWNED rather than
     * on what we believed happened. That is why the alert is keyed by document id
     * and evaluated at render time instead of being a message we compose here.
     */
    const runOwnerChange = async ({ document: row, fromAgent, toAgent, buildSteps }) => {
        if (!row) return;
        const { ok } = await runMembership(row.id,
            () => {
                const steps = buildSteps();
                if (!steps.length) return null;
                return applyLinkPlan(darwinUri, idToken, steps);
            },
            toAgent
                ? `Could not transfer "${row.name}" to ${toAgent.name}`
                : `Could not release ownership of "${row.name}"`);

        if (ok) {
            setOwnerAlerts(prev => {
                if (!(row.id in prev)) return prev;
                const next = { ...prev };
                delete next[row.id];
                return next;
            });
            return;
        }

        // A TRANSFER that failed may have left the document unowned; a RELEASE that
        // failed changed nothing. Only the first needs a standing notice.
        if (toAgent) {
            setOwnerAlerts(prev => ({
                ...prev,
                [row.id]: { from: fromAgent?.name, to: toAgent.name, toId: toAgent.id },
            }));
        }
    };

    /**
     * The freshest view of one document's links, for a plan built at execution
     * time. Reads the same cache `freshAgentDocuments` does, for the same reason.
     */
    const freshLinksFor = (documentId) => freshAgentDocuments()
        .filter(l => l.document_fk === documentId);

    const ownerConfirm = useConfirmDialog({
        onConfirm: (info) => {
            if (!info?.document) return;
            // The radio's value is read HERE, at confirm time, not inside the
            // thunk — it is the user's decision about this dialog and must not be
            // re-read from state that the next dialog has already reset.
            const keep = keepOutgoing;
            runOwnerChange({
                ...info,
                buildSteps: () => {
                    // Re-read the links at execution time: the incumbent may have
                    // changed while this write sat in the queue, and releasing an
                    // agent that no longer owns the document would delete a link
                    // nobody asked to remove.
                    const links = freshLinksFor(info.document.id);
                    const fromLink = documentOwnerLink(links);
                    const toLink = info.toAgent
                        ? links.find(l => l.agent_fk === info.toAgent.id) || null
                        : null;
                    const steps = planOwnerTransfer({
                        documentId: info.document.id,
                        fromLink,
                        toLink,
                        toAgentId: info.toAgent?.id ?? null,
                        keepOutgoing: keep,
                    });
                    // A brand-new link needs a slot; an existing one keeps its own.
                    const claim = steps[steps.length - 1];
                    if (info.toAgent && !toLink && claim?.next) {
                        claim.next.sort_order = nextDocumentSortOrder(
                            info.toAgent.id, linksByAgent(freshAgentDocuments()));
                    }
                    return steps;
                },
            });
        },
        defaultInfo: {},
    });

    // `useConfirmDialog` clears `infoObject` in the SAME effect pass that fires
    // the callback, so these hold the last real value for the dialog's closing
    // frames. `open` is what controls visibility.
    const lastOwnerInfo = useRef(null);
    if (ownerConfirm.infoObject?.document) lastOwnerInfo.current = ownerConfirm.infoObject;
    const lastUnbindInfo = useRef(null);
    if (unbindConfirm.infoObject?.document) lastUnbindInfo.current = unbindConfirm.infoObject;
    const lastLocationInfo = useRef(null);
    if (locationConfirm.infoObject?.document) lastLocationInfo.current = locationConfirm.infoObject;

    const linkFor = (row, agentId) => row.links.find(l => l.agent_fk === agentId) || null;

    const requestOwnerChange = (row, toAgent) => {
        // Reset the radio each time: it is a per-decision choice, not a setting.
        setKeepOutgoing(true);
        setOwnerPaletteId(null);
        ownerConfirm.openDialog({
            document: row,
            fromAgent: row.owner ? agentIndex.get(row.owner.agent_fk) : null,
            fromLink: row.owner,
            toAgent: toAgent || null,
            toLink: toAgent ? linkFor(row, toAgent.id) : null,
        });
    };

    /**
     * Claiming an UNOWNED document needs no dialog.
     *
     * It is one write, it is additive, and it repairs a state the page renders in
     * red. Ceremony belongs on the paths that can lose something — transfer (two
     * writes, an unowned window) and release (creates the red state).
     */
    const claimOwnership = (row, agentId) => {
        setOwnerPaletteId(null);
        return runOwnerChange({
            document: row,
            toAgent: agentIndex.get(agentId),
            buildSteps: () => {
                const links = freshLinksFor(row.id);
                // Re-read at execution time. If somebody claimed the document while
                // this sat in the queue, `fromLink` is no longer null and the plan
                // becomes a transfer — which the unique key would otherwise reject
                // as a second owner.
                const fromLink = documentOwnerLink(links);
                const toLink = links.find(l => l.agent_fk === agentId) || null;
                const steps = planOwnerTransfer({
                    documentId: row.id,
                    fromLink,
                    toLink,
                    toAgentId: agentId,
                });
                const claim = steps[steps.length - 1];
                if (!toLink && claim?.next) {
                    claim.next.sort_order = nextDocumentSortOrder(
                        agentId, linksByAgent(freshAgentDocuments()));
                }
                return steps;
            },
        });
    };

    const retryOwnerClaim = (row) => {
        const alert = ownerAlerts[row.id];
        if (!alert) return;
        return claimOwnership(row, alert.toId);
    };

    // ---------- create (template card) ----------

    /**
     * POST as soon as the required columns are filled and the name is free.
     *
     * Called on EVERY blur of either required field, not only when one changed —
     * which is what makes a failed POST retryable by clicking back into a field
     * and out again. It is idempotent by the guards below.
     *
     * `location` is required HERE even though the column is nullable: a
     * registration with no path registers nothing anyone can find, and every one
     * of the live rows has one. The UI is deliberately stricter than the schema.
     *
     * No `sort_order` is sent. The column is not driving anything the UI shows and
     * inventing a slot would perpetuate the artifact this requirement is retiring.
     *
     * NO AGENT LINKS. The junction needs a document id, which does not exist until
     * this returns — so a new card appears with a red `unowned` chip, which is
     * itself the prompt to assign an owner. That ordering is what retires the
     * two-phase create-then-link failure mode, where a successful POST followed by
     * a failed link left a row owned by nobody and a dialog reporting an error.
     */
    const maybeCreate = async () => {
        const name = draftName.trim();
        const location = draftLocation.trim();
        const url = draftUrl.trim();
        if (creating || !name || !location) return;
        if (documentNameError(name, documents || [], null)) return;
        if (documentLocationError(location)) return;
        if (documentUrlError(url)) return;
        if (docTypeError(draftType)) return;

        setCreating(true);
        try {
            await createArchitectureDocument(darwinUri, idToken, {
                name, doc_type: draftType, location, url: url || null, creator_fk: creatorFk,
            });
            setDraftName('');
            setDraftLocation('');
            setDraftUrl('');
            setDraftType('markdown');
            await invalidateRows();
            // Put the caret back in the blank template so a second row can be
            // typed without reaching for the mouse — but ONLY if the user has not
            // already moved on. This runs a full round trip after their blur, and
            // stealing focus out of another row would fire that row's blur and
            // commit whatever half-typed text was in it.
            setTimeout(() => {
                const active = window.document.activeElement;
                const nobodyHasIt = !active || active === window.document.body;
                if (nobodyHasIt) templateNameRef.current?.focus();
            }, 0);
        } catch (err) {
            // Deliberately NOT rethrown: the draft must survive so the user can
            // retry. Their next blur of either field calls this again.
            await invalidateRows();
            showError(err, restErrorMessage(err, 'Could not register the document'));
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
            await updateArchitectureDocument(darwinUri, idToken, target.id, { closed });
            await invalidateRows();
            setDeleteTarget(null);
        } catch (err) {
            await invalidateRows();
            showError(err, restErrorMessage(err,
                closed ? 'Could not close the document' : 'Could not reopen the document'));
        } finally {
            setBusy(false);
        }
    };

    const closeMenu = () => setMenuAnchor(null);

    /**
     * CLOSE IS GRADUATED ON BLAST RADIUS, the same rule the instruction list uses.
     *
     * Closing drops the document out of every linked agent's boot payload, which
     * is the exact silent unloading the delete dialog exists to make visible — so
     * a LINKED row still goes through the dialog, where the agent chips are. An
     * UNLINKED row has no blast radius at all, and ceremony with nothing to
     * disclose trains people to click past ceremony that does. The trailing
     * ellipsis on the menu label is what tells the two apart.
     */
    const menuCloseDocument = (row) => {
        closeMenu();
        if (row.links.length === 0) { setClosedFlag(row, 1); return; }
        setDialogIntent('close');
        setDeleteTarget(row);
    };

    const menuReopenDocument = (row) => { closeMenu(); setClosedFlag(row, 0); };

    const menuDeleteDocument = (row) => {
        closeMenu();
        setDialogIntent('delete');
        setDeleteTarget(row);
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setBusy(true);
        try {
            await deleteArchitectureDocument(darwinUri, idToken, deleteTarget.id);
            // A hard delete CASCADEs the junction rows, so both caches are stale.
            await invalidateAll();
            setDeleteTarget(null);
        } catch (err) {
            await invalidateAll();
            showError(err, restErrorMessage(err, 'Could not delete the document'));
        } finally {
            setBusy(false);
        }
    };

    if (isLoading || !documents || !relationshipsReady) {
        return (
            <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
                {documents && !relationshipsReady ? (
                    <Alert severity="error" data-testid="documents-relationships-error">
                        The agent links could not be loaded, so this page cannot show who owns each
                        document. Editing is disabled rather than shown without ownership — every
                        row would render as unowned, and closing or deleting one from here would
                        silently change what the linked agents read at boot. Reload to retry.
                    </Alert>
                ) : <CircularProgress />}
            </Box>
        );
    }

    // Counted over the WHOLE catalog, not the filtered `rows` — an accounting line
    // that changed when you toggled a view filter would not be an accounting line.
    const openRows = allRows.filter(r => !r.closed);
    const closedCount = allRows.length - openRows.length;
    const unownedCount = openRows.filter(r => !r.owner).length;

    const editorRow = linkEditor
        ? rows.find(r => r.id === linkEditor.docId)
            || allRows.find(r => r.id === linkEditor.docId)
        : null;

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            {/* The canonical viewer header, now the shared component
                (Components/ViewerHeader, req #3067). This page was the third
                hand-rolled copy of it. */}
            <ViewerHeader
                title="Architecture Documents"
                views={VIEWS}
                view={activeView}
                onViewChange={setView}
                testIdPrefix="documents"
                filters={<>
                    {/* The highest-value filter on this page: it isolates exactly
                        the drift the registry was built to catch. Rendered only when
                        there is drift to isolate. */}
                    {hasUnowned && (
                        <Tooltip title={showUnownedOnly
                            ? 'Show every document'
                            : 'Show only documents with no owner'}>
                            <Chip
                                label="Unowned"
                                size="small"
                                color={showUnownedOnly ? 'error' : 'default'}
                                variant={showUnownedOnly ? 'filled' : 'outlined'}
                                onClick={() => setShowUnownedOnly(v => !v)}
                                sx={{ cursor: 'pointer', flexShrink: 0 }}
                                data-testid="documents-show-unowned"
                            />
                        </Tooltip>
                    )}
                    {hasClosed && (
                        <Tooltip title={showClosed ? 'Hide closed documents' : 'Show closed documents'}>
                            <Chip
                                label="Closed"
                                size="small"
                                color={showClosed ? 'primary' : 'default'}
                                variant={showClosed ? 'filled' : 'outlined'}
                                onClick={() => setShowClosed(v => !v)}
                                sx={{ cursor: 'pointer', flexShrink: 0 }}
                                data-testid="documents-show-closed"
                            />
                        </Tooltip>
                    )}
                </>}
                settingsItems={[{
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
                }]}
                accounting={<>
                    {[
                        `${openRows.length} registered document${openRows.length === 1 ? '' : 's'}`,
                        unownedCount > 0
                            ? `${unownedCount} with no owner`
                            : 'every one has exactly one owner',
                        closedCount > 0 && `${closedCount} closed`,
                    ].filter(Boolean).join(' · ')}
                    . At most one owner per document is enforced by the database.
                    {/* THE REGISTRATION SENTENCE (req #3101, § 2). Stated once, on
                        the page, rather than only inside the delete and location
                        dialogs — which is to say, only to somebody already
                        mid-destruction. Every card carries the per-row half of this
                        in its "Points at" row. */}
                    {' '}These rows are <strong>registrations</strong>: Darwin stores a path or a
                    URL and never the file, never checks that either resolves, and deleting a row
                    never deletes a file.
                    {/* THE COMMIT-MODE KEY (req #3101, § 1). Inline spans only —
                        ViewerHeader wraps this node in a <p>. */}
                    <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                        <CommitModeLegend testIdPrefix="documents" />
                    </Box>
                </>}
            />

            <Box
                data-testid="documents-registry"
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
                    const href = documentHref(row);
                    const ownerAgent = row.owner ? agentIndex.get(row.owner.agent_fk) : null;
                    const linkedIds = new Set(row.links.map(l => l.agent_fk));
                    const ownerAlert = ownerAlerts[row.id];
                    // Computed ONCE per row: it drives both the location field's
                    // standing caption and the decision to route that field's
                    // commit through the confirmation dialog, and calling it from
                    // inside a `hint` callback would re-walk the links on every
                    // keystroke.
                    const readers = autoloadReaders(row);

                    return (
                        <Card key={row.id} variant="outlined"
                              id={`document-${row.id}`}
                              sx={{
                                  scrollMarginTop: 16,
                                  ...(row.closed && { opacity: 0.55 }),
                              }}
                              data-testid={`document-row-${row.id}`}>
                          <CardContent sx={CARD_CONTENT_SX}>
                            {/* CARD HEADER, in the TaskCard / CategoryCard idiom:
                                the record's identity as an always-editable
                                BORDERLESS heading, with the actions to its right.
                                The title alone drops its border and label — a
                                heading IS the record's identity and is
                                self-describing, so a label above it is a tautology;
                                every other field on the card keeps outlined+label.

                                THE OPEN-LINK ICON IS A REGRESSION GUARD, not
                                decoration. The document NAME used to be the
                                external link. Making it an editable heading would
                                have silently removed the page's most-used
                                affordance, so the drill-out moves here. */}
                            <Box className="card-header" sx={{ mb: 1 }}>
                                <GhostTextField
                                    value={row.name}
                                    required
                                    // WRAPS but does not accept newlines. `commitOnEnter`
                                    // DEFAULTS to `!multiline`, so adding `multiline`
                                    // without keeping this explicit would silently turn
                                    // Enter into a newline inside a name.
                                    multiline
                                    commitOnEnter
                                    maxRows={2}
                                    placeholder="Document name"
                                    // MySQL 8's collation is NO PAD, so "  x  " and "x"
                                    // are DIFFERENT rows under the unique key — a padded
                                    // name would then block the clean one as a collision
                                    // the user cannot see. Collapses newlines too: the
                                    // field is `multiline` so a pasted two-line string
                                    // would otherwise store an embedded \n.
                                    normalize={(text) => text.replace(/\s+/g, ' ').trim()}
                                    validate={(text) => documentNameError(text, documents, row.id)}
                                    onCommit={commitField(row, 'name', 'document name')}
                                    onErrorChange={noteFieldError(row.id, 'name')}
                                    inputProps={{ maxLength: DOCUMENT_NAME_MAX }}
                                    sx={{
                                        fontSize: '1.4rem',
                                        fontWeight: 500,
                                        '& .MuiInputBase-input': {
                                            fontSize: '1.4rem',
                                            fontWeight: 500,
                                        },
                                    }}
                                    testId={`document-name-input-${row.id}`}
                                />
                                {/* The heading is the ONLY control on the card that
                                    advertises nothing about itself — it renders as
                                    plain text and carries no label, by design. So it
                                    is also the one that most needs the marker. */}
                                <CommitModeMarker
                                    mode="blur"
                                    note="The name is prose: nothing in production resolves a document by it."
                                    testId={`document-commit-name-${row.id}`}
                                    sx={{ mt: 0.75 }}
                                />
                                {href && (
                                    <Tooltip title="Open the document in a new tab">
                                        <IconButton
                                            size="small"
                                            component="a"
                                            href={href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            sx={{ maxWidth: '25px', maxHeight: '25px' }}
                                            data-testid={`document-open-link-${row.id}`}
                                        >
                                            <OpenInNewIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                <Tooltip title="Document options">
                                    <IconButton
                                        size="small"
                                        onClick={(e) => setMenuAnchor({ id: row.id, el: e.currentTarget })}
                                        sx={{ maxWidth: '25px', maxHeight: '25px' }}
                                        data-testid={`document-card-menu-${row.id}`}
                                    >
                                        <MoreVertIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                                <Menu
                                    anchorEl={menuAnchor?.el}
                                    open={menuAnchor?.id === row.id}
                                    onClose={closeMenu}
                                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                                    slotProps={{ list: { 'data-testid': `document-card-menu-popup-${row.id}` } }}
                                >
                                    {row.closed ? (
                                        <MenuItem onClick={() => menuReopenDocument(row)}
                                                  data-testid={`document-menu-reopen-${row.id}`}>
                                            <ListItemIcon><UnarchiveIcon fontSize="small" /></ListItemIcon>
                                            <ListItemText>Reopen document</ListItemText>
                                        </MenuItem>
                                    ) : (
                                        <MenuItem onClick={() => menuCloseDocument(row)}
                                                  data-testid={`document-menu-close-${row.id}`}>
                                            <ListItemIcon><CloseIcon fontSize="small" /></ListItemIcon>
                                            {/* Ellipsis = opens the dialog, because
                                                this row is linked and the agents it
                                                would unload from must be shown. */}
                                            <ListItemText>
                                                {row.links.length === 0
                                                    ? 'Close document'
                                                    : 'Close document…'}
                                            </ListItemText>
                                        </MenuItem>
                                    )}
                                    <Divider />
                                    <MenuItem onClick={() => menuDeleteDocument(row)}
                                              sx={{ color: 'error.main' }}
                                              data-testid={`document-menu-delete-${row.id}`}>
                                        <ListItemIcon>
                                            <DeleteForeverIcon fontSize="small" sx={{ color: 'error.main' }} />
                                        </ListItemIcon>
                                        <ListItemText>Delete registration…</ListItemText>
                                    </MenuItem>
                                </Menu>
                            </Box>

                            {/* Type + accounting. The doc_type chips are Darwin's
                                shipped in-place editor for a short closed
                                vocabulary (RequirementDetail's Model / Effort /
                                Machine): selected is filled, unselected is
                                outlined and faded, one click writes.

                                A CHIP ROW RATHER THAN A SELECT is a correctness
                                choice, not a stylistic one. `doc_type` is
                                VARCHAR(16) with no DB constraint and the MCP's
                                VALID_DOC_TYPES never runs for a browser write — so
                                the client is the only guard, and a chip row makes
                                an illegal value structurally unreachable. Writing
                                on click is safe here (unlike the link roles): it is
                                a single-column PUT on a row that HAS an id, and it
                                is undone by clicking the previous chip. */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5,
                                       flexWrap: 'wrap', mb: 1 }}>
                                <CommitModeMarker
                                    mode="click"
                                    note="Clicking the previous type is the undo."
                                    testId={`document-commit-type-${row.id}`}
                                    sx={{ mr: 0.25 }}
                                />
                                {DOC_TYPES.map(t => {
                                    const on = row.doc_type === t;
                                    return (
                                        <Chip
                                            key={t}
                                            label={t}
                                            size="small"
                                            clickable
                                            onClick={() => setDocType(row, t)}
                                            {...(on
                                                ? docTypeChipProps(t)
                                                : { variant: 'outlined', sx: { opacity: 0.55 } })}
                                            data-testid={`document-type-${row.id}-${t}`}
                                        />
                                    );
                                })}
                                {/* A stored value outside the vocabulary can only
                                    have come from outside this UI, and it would
                                    otherwise render as three unselected chips with
                                    no hint that anything is wrong. */}
                                {row.doc_type && !DOC_TYPES.includes(row.doc_type) && (
                                    <Chip label={`unknown: ${row.doc_type}`} size="small"
                                          color="warning" variant="outlined"
                                          data-testid={`document-type-unknown-${row.id}`} />
                                )}
                                <Box sx={{ flex: 1 }} />
                                {/* `!!` is load-bearing: `closed` is a MySQL
                                    TINYINT, so it arrives as the NUMBER 0, and
                                    `0 && <Chip/>` evaluates to 0 — which React
                                    renders as a literal "0". */}
                                {!!row.closed && (
                                    <Chip label="closed" size="small"
                                          data-testid={`document-closed-${row.id}`} />
                                )}
                                {/* With no Save button, "blocked" has no natural
                                    signal — without this chip the user navigates
                                    away believing the value was written. */}
                                {blocked && (
                                    <Chip label="unsaved" size="small" color="error"
                                          variant="outlined"
                                          data-testid={`document-unsaved-${row.id}`} />
                                )}
                            </Box>

                            {/* OWNER — its own row, above location and url, because
                                "who owns this file?" is the question this page
                                exists to answer. */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5,
                                       flexWrap: 'wrap', rowGap: 0.75, mb: 1.5 }}>
                                <Typography variant="caption" color="text.secondary"
                                            sx={{ mr: 0.5 }}>
                                    Owner
                                </Typography>
                                {/* THE OWNER ROW GENUINELY HAS TWO COMMIT MODES and
                                    the marker says which one is live rather than
                                    averaging them. Claiming an UNOWNED document is
                                    one additive write and goes straight through;
                                    transferring or releasing an owned one is a
                                    two-write plan with an unowned window, so it
                                    opens DocumentOwnerDialog. Which of the two a
                                    click will do depends entirely on whether this
                                    card currently has an owner. */}
                                <CommitModeMarker
                                    mode={row.owner ? 'confirm' : 'click'}
                                    note={row.owner
                                        ? 'Transfer and release are two writes with a window in '
                                          + 'which nothing owns the document, so both are confirmed.'
                                        : 'Claiming an unowned document is one additive write, '
                                          + 'so it needs no confirmation.'}
                                    testId={`document-commit-owner-${row.id}`}
                                    sx={{ mr: 0.5 }}
                                />

                                {ownerAgent ? (
                                    <Tooltip title={`${ownerAgent.name} owns this document — click to open its page, ✕ to release`}>
                                        <Chip
                                            label={ownerAgent.closed
                                                ? `${ownerAgent.name} (closed)`
                                                : ownerAgent.name}
                                            size="small"
                                            clickable
                                            {...relationshipChipProps('owned')}
                                            onClick={() => navigate(`/agents/${ownerAgent.id}#documents`)}
                                            onDelete={() => requestOwnerChange(row, null)}
                                            data-testid={`document-owner-${row.id}`}
                                            data-agent-closed={ownerAgent.closed ? '1' : '0'}
                                        />
                                    </Tooltip>
                                ) : (
                                    <Chip label="unowned" size="small" color="error"
                                          variant="outlined"
                                          data-testid={`document-unowned-${row.id}`} />
                                )}

                                {ownerPaletteId === row.id && openAgents
                                    .filter(a => a.id !== row.owner?.agent_fk)
                                    .map(a => (
                                        <Tooltip key={a.id} title={row.owner
                                            ? `Transfer ownership to ${a.name}`
                                            : `Make ${a.name} the owner`}>
                                            <Chip
                                                label={a.name}
                                                size="small"
                                                clickable
                                                variant="outlined"
                                                sx={{ borderStyle: 'dashed', opacity: 0.55,
                                                      '&:hover': { opacity: 1 } }}
                                                disabled={membershipBusy}
                                                onClick={() => (row.owner
                                                    ? requestOwnerChange(row, a)
                                                    : claimOwnership(row, a.id))}
                                                data-testid={`document-owner-claim-${row.id}-${a.id}`}
                                            />
                                        </Tooltip>
                                    ))}

                                <Tooltip title={ownerPaletteId === row.id
                                    ? 'Hide the roster'
                                    : (row.owner ? 'Transfer ownership' : 'Assign an owner')}>
                                    <Chip
                                        size="small"
                                        variant="outlined"
                                        color={ownerPaletteId === row.id ? 'primary' : 'default'}
                                        icon={ownerPaletteId === row.id
                                            ? <CloseIcon fontSize="small" />
                                            : <AddIcon fontSize="small" />}
                                        label={ownerPaletteId === row.id ? 'done' : 'assign'}
                                        onClick={() => setOwnerPaletteId(
                                            id => (id === row.id ? null : row.id))}
                                        data-testid={`document-owner-add-${row.id}`}
                                    />
                                </Tooltip>
                            </Box>

                            {/* Rendered only while the card really IS unowned, so a
                                resync that reveals somebody else took it retires
                                this notice without any extra bookkeeping. A
                                transient snackbar would be wrong here: the user may
                                have looked away, and the document stays broken. */}
                            {ownerAlert && !row.owner && (
                                <Alert severity="error" sx={{ mb: 1.5, py: 0 }}
                                       onClose={() => setOwnerAlerts(prev => {
                                           const next = { ...prev };
                                           delete next[row.id];
                                           return next;
                                       })}
                                       action={(
                                           <Chip size="small" color="error" variant="outlined"
                                                 label={`Retry — give it to ${ownerAlert.to}`}
                                                 onClick={() => retryOwnerClaim(row)}
                                                 disabled={membershipBusy}
                                                 data-testid={`document-owner-retry-${row.id}`} />
                                       )}
                                       data-testid={`document-owner-alert-${row.id}`}>
                                    Ownership was released from {ownerAlert.from || 'the previous owner'},
                                    but {ownerAlert.to} could not claim it. This document is currently
                                    unowned.
                                </Alert>
                            )}

                            {/* The two location/url fields are wrapped in a flex row
                                with their marker so the marker sits on the field's
                                own line rather than stealing a row from the card.
                                `alignItems: flex-start` keeps it pinned to the top
                                of the box while the helper text grows underneath. */}
                            <Box sx={{ display: 'flex', alignItems: 'flex-start',
                                       gap: 0.5, mb: 1 }}>
                                <GhostTextField
                                    value={row.location || ''}
                                    outlined
                                    label="Location"
                                    fullWidth
                                    // `required` in the UI although the column is
                                    // nullable: a registration with no path
                                    // registers nothing anyone can find, and every
                                    // live row has one. Deliberately stricter than
                                    // the schema.
                                    required
                                    commitOnEnter
                                    placeholder="memory/example.md"
                                    normalize={(text) => text.trim()}
                                    validate={documentLocationError}
                                    // A STANDING caption, not an on-focus one: the
                                    // fact that agents execute this path is true
                                    // whether or not anyone is editing it, and it
                                    // is the reason the commit is gated.
                                    hint={() => (readers.length
                                        ? `${readers.length} agent${readers.length === 1 ? '' : 's'} read this file in full at boot — a wrong path fails silently.`
                                        : null)}
                                    onCommit={commitLocation(row)}
                                    onErrorChange={noteFieldError(row.id, 'location')}
                                    inputProps={{ maxLength: DOCUMENT_LOCATION_MAX }}
                                    sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.8125rem' } }}
                                    testId={`document-location-input-${row.id}`}
                                />
                                {/* THE ONE FIELD ON THE PAGE WHOSE COMMIT MODE
                                    CHANGES ROW BY ROW. A document nothing autoloads
                                    has no boot to break, so its location commits on
                                    blur like any other text; one that IS autoloaded
                                    routes through DocumentLocationDialog. Reading
                                    `readers`, which the card already computed. */}
                                <CommitModeMarker
                                    mode={readers.length ? 'confirm' : 'blur'}
                                    note={readers.length
                                        ? `${readers.length} agent${readers.length === 1 ? '' : 's'} `
                                          + 'read this file at boot, so the change is confirmed first.'
                                        : 'No agent autoloads this document, so there is no boot to break.'}
                                    testId={`document-commit-location-${row.id}`}
                                    sx={{ mt: 1.25 }}
                                />
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'flex-start',
                                       gap: 0.5, mb: 1.5 }}>
                                <GhostTextField
                                    value={row.url || ''}
                                    outlined
                                    label="URL"
                                    fullWidth
                                    commitOnEnter
                                    placeholder="Blank falls back to the GitHub blob URL"
                                    normalize={(text) => text.trim()}
                                    validate={documentUrlError}
                                    onCommit={commitField(row, 'url', 'URL')}
                                    onErrorChange={noteFieldError(row.id, 'url')}
                                    inputProps={{ maxLength: DOCUMENT_URL_MAX }}
                                    sx={{ '& .MuiInputBase-input': { fontSize: '0.8125rem' } }}
                                    testId={`document-url-input-${row.id}`}
                                />
                                <CommitModeMarker
                                    mode="blur"
                                    note="Only http and https values are stored as links."
                                    testId={`document-commit-url-${row.id}`}
                                    sx={{ mt: 1.25 }}
                                />
                            </Box>

                            {/* WHAT THE ROW ACTUALLY POINTS AT (req #3101, § 2).
                                Directly under the two fields it derives from, so
                                the reading order is "here is the path, here is the
                                URL, here is which one is real and which one opens". */}
                            <DocumentTargetChips
                                document={row}
                                testIdPrefix={`document-${row.id}`}
                            />

                            <DocumentAgentChips
                                links={row.others}
                                agentIndex={agentIndex}
                                bindableAgents={openAgents.filter(a => !linkedIds.has(a.id))}
                                onBind={(agentId) => bindAgent(row, agentId)}
                                onBindAll={(agentsToBind) => bindAllAgents(row, agentsToBind)}
                                onRequestUnbind={(link, agent) => unbindConfirm.openDialog(
                                    { document: row, agent, link })}
                                onOpenLink={(link, agent, anchorEl) => setLinkEditor(
                                    { docId: row.id, agentId: agent.id, anchorEl })}
                                busy={membershipBusy}
                                testIdPrefix={`document-${row.id}`}
                                commitMarker={(
                                    // `click` is the mode of the chips themselves —
                                    // the gesture a user makes here most often, and
                                    // by a wide margin. The note carries the other
                                    // two, which belong to controls this row owns
                                    // but does not visually lead with.
                                    <CommitModeMarker
                                        mode="click"
                                        note={'Removing a link (✕) asks first, and a chip\'s roles '
                                            + 'and notes are staged behind Save in the popover it opens.'}
                                        testId={`document-commit-agents-${row.id}`}
                                    />
                                )}
                            />
                          </CardContent>
                        </Card>
                    );
                })}

                {/* The template card. Per instruction #41 an inline-editable list
                    ends with a blank item the user fills in place — never an
                    explicit add button. It carries no agent chips: membership needs
                    a row id, so a new document is linked with its own chips once it
                    exists, and it appears carrying the red `unowned` badge that
                    prompts for an owner. */}
                <Card variant="outlined" sx={{ borderStyle: 'dashed' }}
                      data-testid="document-row-template">
                  <CardContent sx={CARD_CONTENT_SX}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                        <GhostTextField
                            value={draftName}
                            onChangeText={setDraftName}
                            outlined
                            label="Name"
                            fullWidth
                            commitOnEnter
                            placeholder="New document name"
                            validate={(text) => documentNameError(text, documents, null)}
                            onCommit={maybeCreate}
                            inputProps={{ maxLength: DOCUMENT_NAME_MAX }}
                            inputRef={templateNameRef}
                            testId="document-name-input-template"
                        />
                        {/* The template card's commit model is its own: it is not a
                            column write but a CREATE, fired on every blur once both
                            required fields hold a legal value. Marked with the same
                            vocabulary as everything else so the one control that
                            behaves differently is not the one control with no
                            marker. */}
                        <CommitModeMarker
                            mode="blur"
                            note={'This card registers the document as soon as both the name and '
                                + 'the location hold a legal value — there is no Add button.'}
                            testId="document-commit-template"
                            sx={{ mt: 1.5 }}
                        />
                        {creating && <CircularProgress size={14} sx={{ mt: 1.5 }} />}
                    </Box>

                    <Stack direction="row" spacing={0.5} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                        {DOC_TYPES.map(t => (
                            <Chip
                                key={t}
                                label={t}
                                size="small"
                                clickable
                                onClick={() => setDraftType(t)}
                                {...(draftType === t
                                    ? docTypeChipProps(t)
                                    : { variant: 'outlined', sx: { opacity: 0.55 } })}
                                data-testid={`document-type-template-${t}`}
                            />
                        ))}
                    </Stack>

                    <Box sx={{ mb: 1 }}>
                        <GhostTextField
                            value={draftLocation}
                            onChangeText={setDraftLocation}
                            outlined
                            label="Location"
                            fullWidth
                            commitOnEnter
                            placeholder="memory/new-document.md — the file must already exist"
                            validate={documentLocationError}
                            hint={(text) => (draftName.trim() && !text.trim()
                                ? 'Fill both fields — the row is created when the second one is filled.'
                                : null)}
                            onCommit={maybeCreate}
                            inputProps={{ maxLength: DOCUMENT_LOCATION_MAX }}
                            sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.8125rem' } }}
                            testId="document-location-input-template"
                        />
                    </Box>

                    <GhostTextField
                        value={draftUrl}
                        onChangeText={setDraftUrl}
                        outlined
                        label="URL (optional)"
                        fullWidth
                        commitOnEnter
                        placeholder="Blank falls back to the GitHub blob URL"
                        validate={documentUrlError}
                        onCommit={maybeCreate}
                        inputProps={{ maxLength: DOCUMENT_URL_MAX }}
                        sx={{ '& .MuiInputBase-input': { fontSize: '0.8125rem' } }}
                        testId="document-url-input-template"
                    />
                  </CardContent>
                </Card>
            </Box>

            <DocumentLinkPopover
                open={!!linkEditor}
                anchorEl={linkEditor?.anchorEl}
                onClose={() => setLinkEditor(null)}
                document={editorRow}
                agent={linkEditor ? agentIndex.get(linkEditor.agentId) : null}
                link={editorRow && linkEditor
                    ? editorRow.links.find(l => l.agent_fk === linkEditor.agentId)
                    : null}
                onSave={(next) => saveLink(editorRow, next)}
                onOpenAgent={(agentId) => navigate(`/agents/${agentId}#documents`)}
                busy={editorRow ? isMembershipBusy(editorRow.id) : false}
            />

            <DocumentOwnerDialog
                open={ownerConfirm.dialogOpen}
                setOpen={ownerConfirm.setDialogOpen}
                setConfirmed={ownerConfirm.setConfirmed}
                info={ownerConfirm.infoObject?.document
                    ? ownerConfirm.infoObject
                    : lastOwnerInfo.current}
                keepOutgoing={keepOutgoing}
                setKeepOutgoing={setKeepOutgoing}
            />

            <DocumentUnbindDialog
                open={unbindConfirm.dialogOpen}
                setOpen={unbindConfirm.setDialogOpen}
                setConfirmed={unbindConfirm.setConfirmed}
                info={unbindConfirm.infoObject?.document
                    ? unbindConfirm.infoObject
                    : lastUnbindInfo.current}
            />

            <DocumentLocationDialog
                open={locationConfirm.dialogOpen}
                setOpen={locationConfirm.setDialogOpen}
                setConfirmed={locationConfirm.setConfirmed}
                info={locationConfirm.infoObject?.document
                    ? locationConfirm.infoObject
                    : lastLocationInfo.current}
            />

            <DocumentDeleteDialog
                open={!!deleteTarget}
                onClose={() => { setDeleteTarget(null); setDialogIntent('delete'); }}
                onCloseDocument={() => setClosedFlag(deleteTarget, 1)}
                onReopen={() => setClosedFlag(deleteTarget, 0)}
                onDelete={handleDelete}
                intent={dialogIntent}
                document={deleteTarget}
                // EVERY link, including closed agents' — a hard delete cascades all
                // of them away, so all of them belong in the warning. The dialog
                // counts the open autoload ones separately for the "reads it at
                // boot" wording; data loss and boot impact are different questions.
                linkedAgents={deleteTarget
                    ? (byDocument.get(deleteTarget.id) || [])
                        .map(l => ({ agent: agentIndex.get(l.agent_fk), link: l }))
                        .filter(x => x.agent)
                        .map(({ agent, link }) => ({
                            name: agent.name,
                            closed: !!agent.closed,
                            autoload: isAutoload(link.relationship),
                            owner: hasRole(link.relationship, 'owned'),
                        }))
                    : []}
                busy={busy}
            />
        </Box>
    );
};

export default DocumentsPage;
