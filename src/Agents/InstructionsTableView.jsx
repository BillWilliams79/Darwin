// /agents/instructions — the Table view (req #3067).
//
// THE POINT IS NOT THE TABLE. It is that this view and the Cards view are the SAME
// EDIT-IN-PLACE IMPLEMENTATION seen twice. Every writable cell here is a
// `GhostTextField` — the identical component the card renders — reached through
// `ghostTextColumn`, with the identical commit contract: no dialog, no Save button,
// one PUT per column, a rejected value kept on screen rather than silently
// reverted. Both views hand their verdicts to ONE `fieldErrors` map in the page and
// their membership writes to ONE serialized queue. That is what makes this a
// pattern rather than a second feature, and it is why the E2E suite can drive both
// views through one set of data-testids.
//
// NOT DataGrid edit mode. `ghostTextColumn` pins `editable: false`. DataGrid's own
// editing state machine owns commit timing, validation and rollback — all of which
// GhostTextField already owns, and owns better (an invalid value stays visible in
// red instead of being discarded). Running both would give the cell two answers to
// "what is in you".
//
// THE PROSE PROBLEM, and why the old header comment on InstructionsPage was a false
// dichotomy. That comment said a DataGrid "would either truncate it into
// uselessness or need auto row height". There is a third option, and it is what
// ships here: a FIXED row containing an INTERNALLY SCROLLABLE field. `multiline
// maxRows={4}` caps the rendered height at four lines and hands the textarea
// `overflow: auto` past that, so the whole of a long instruction stays reachable
// inside its own cell while the row height never moves. `getRowHeight={() =>
// 'auto'}` stays forbidden (it mis-measures on re-sort — memory/table-design.md);
// this makes it unnecessary rather than negotiating with it.
//
// The Cards view is still the place to COMPOSE long prose. The Table is for
// scanning the catalog and correcting fields. Both write the same rows.

import { useMemo, useRef } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import GhostCell from '../Components/GhostField/GhostCell';
import GhostTextField from '../Components/GhostField/GhostTextField';
import { ghostTextColumn } from '../Components/GhostField/ghostTextColumn';
import InstructionAgentChips from './InstructionAgentChips';
import InstructionRowMenu from './InstructionRowMenu';
import { gridSortFromMode, lastTouched, dbTimestamp } from './instructionSort';
import {
    instructionNameError, instructionContentError, INSTRUCTION_NAME_MAX,
} from './agentRegistryUtils';
import { formatDate } from '../utils/dateFormat';

// `rowHeight` is a PRE-DENSITY figure. `useGridDimensions` computes the real row
// height as `Math.floor(rowHeight * densityFactor)`, and `density="compact"` is
// 0.7 — so 132 lands at 92px, which is four lines of the grid's body2 cell type
// (~20px each) plus its 2 × 6px vertical padding. Passing 92 here would give 64px
// and clip the fourth line. The same trap applies to the `rowHeight={52}` figure
// quoted elsewhere in the memory docs; it is likewise pre-density.
const ROW_HEIGHT = 132;
const CONTENT_MAX_ROWS = 4;

const InstructionsTableView = ({
    // Already filtered and sorted by the page — the table re-sorts through its own
    // column headers, but the row SET is the page's decision (R5).
    rows,
    // The whole catalog, for the uniqueness check. NOT `rows`: a name colliding
    // with a filtered-out closed row is still a collision.
    instructions,
    fieldErrors,
    agentIndex,
    openAgents,
    slotOf,
    // (rowId) => boolean. A FUNCTION rather than the Set it used to be (req #3101):
    // the page now counts in-flight writes per row instead of holding one boolean
    // per busy row, so "is this row busy?" is a question rather than a membership
    // test. `useBusyCounts` re-creates the function whenever any count moves, which
    // is exactly what `gridRows` below needs to re-run on.
    isMembershipBusy,
    timezone,
    sortMode,
    sortDesc,
    // --- callbacks, all owned by the page ---
    commitField,
    noteFieldError,
    onBind,
    onBindAll,
    onRequestUnbind,
    onOpenAgent,
    onCloseInstruction,
    onReopen,
    onDelete,
    // --- template row ---
    draftName,
    setDraftName,
    draftContent,
    setDraftContent,
    creating,
    onMaybeCreate,
    templateNameRef,
    // The card view renders this advisory inside the renamed row. A grid row has
    // nowhere to put an Alert, so the table shows it above the grid — but it MUST
    // show it somewhere: `commitField` raises the notice on any rename of a row
    // bound to two or more agents, and without a renderer here the advice is
    // silently dropped and then reappears, out of context, if the user later
    // switches to Cards.
    renameNotice,
    onDismissRenameNotice,
}) => {
    // EVERY page-supplied callback read through this ref, and `columns` memoized on
    // an EMPTY dep array.
    //
    // This is not a micro-optimization; without it a user's column RESIZE is
    // silently discarded. `commitField`, `noteFieldError`, `bindAgent`, `slotOf`
    // and the rest are plain function declarations in InstructionsPage, so they are
    // new values on every render — which means a dep array listing them can never
    // hit, and `columns` is a fresh array each time. DataGrid's `useGridColumns`
    // effect only short-circuits on `props.columns === lastColumnsProp`, so a fresh
    // array rebuilds the column state, and `resolveProps` lets the colDef's literal
    // `width: 260` win over the width the user dragged to. Opening any row menu,
    // binding an agent or typing a character that crosses a validity boundary would
    // snap every resized column back.
    //
    // `renderCell` runs DURING render, so reading `live.current` inside it always
    // sees this render's values — the definitions are stable while the data they
    // close over is not.
    //
    // THE INVARIANT THAT MAKES THAT TRUE, and it is not obvious: `renderCell` only
    // re-runs when the DataGrid re-renders, and DataGrid is `React.memo`'d. It
    // re-renders on every parent render today ONLY because `slots`, `slotProps`,
    // `initialState`, `sx`, `getRowClassName` and `pageSizeOptions` below are fresh
    // literals each time, so the memo can never bail out. Hoisting any of them to
    // module scope is an obvious-looking optimization — the same instinct that
    // produced the broken `useMemo` this ref replaced — and it would freeze every
    // cell on the last-rendered snapshot with no error and no failing test.
    // If you ever need to stabilize those props, put the changing values in the dep
    // array instead of in this ref.
    const live = useRef();
    live.current = {
        instructions, agentIndex, openAgents, slotOf, timezone,
        commitField, noteFieldError,
        onBind, onBindAll, onRequestUnbind, onOpenAgent,
        onCloseInstruction, onReopen, onDelete,
    };

    // Per-row STATE is hoisted onto the row instead, because that is what DataGrid
    // reconciles on: a changed row object re-renders its cells without touching the
    // column definitions. `noteFieldError` returns the previous state object when
    // nothing changed, so this memo churns only when a field genuinely enters or
    // leaves an error — exactly when the marker must move.
    const gridRows = useMemo(() => rows.map(row => ({
        ...row,
        blockedMessages: Object.entries(fieldErrors)
            .filter(([key]) => key.startsWith(`${row.id}:`))
            .map(([, message]) => message),
        membershipBusy: isMembershipBusy(row.id),
    })), [rows, fieldErrors, isMembershipBusy]);

    const columns = useMemo(() => [
        {
            // THE UNSAVED SIGNAL. With no Save button, "blocked" has no natural
            // affordance — the card uses a chip, and a table needs an equivalent
            // that is visible without hovering, or the user navigates away
            // believing the value was written. This marker plus the row tint below
            // plus the field's own red text are the three that replace it.
            field: 'blocked',
            headerName: '',
            width: 44,
            sortable: false,
            filterable: false,
            disableColumnMenu: true,
            disableExport: true,
            // NOT hideable. It is the only always-visible blocked signal, and the
            // toolbar's Columns button would otherwise let a user turn it off and
            // then silently lose edits.
            hideable: false,
            align: 'center',
            renderCell: (p) => (p.row.blockedMessages.length === 0 ? null : (
                <GhostCell align="center">
                    <Tooltip title={p.row.blockedMessages.join(' · ')}>
                        <ErrorOutlineIcon color="error" fontSize="small"
                                          data-testid={`instruction-unsaved-${p.row.id}`} />
                    </Tooltip>
                </GhostCell>
            )),
        },
        ghostTextColumn({
            field: 'name',
            headerName: 'Name',
            width: 260,
            required: true,
            // WRAPS but does not accept newlines — `commitOnEnter` defaults to
            // `!multiline`, so adding `multiline` without keeping this explicit
            // would silently turn Enter into a newline inside a name.
            multiline: true,
            commitOnEnter: true,
            maxRows: 3,
            // MySQL 8's collation is NO PAD, so "  x  " and "x" are DIFFERENT rows
            // under the unique key — a padded name would block the clean one as a
            // collision the user cannot see. Collapses newlines too, so a pasted
            // two-line string cannot store an invisible \n in a name.
            normalize: (text) => text.replace(/\s+/g, ' ').trim(),
            validate: (text, row) => instructionNameError(text, live.current.instructions, row.id),
            onCommit: (row) => live.current.commitField(row, 'name', 'instruction name'),
            onErrorChange: (row) => live.current.noteFieldError(row.id, 'name'),
            inputProps: { maxLength: INSTRUCTION_NAME_MAX },
            testId: (row) => `instruction-name-input-${row.id}`,
        }),
        ghostTextColumn({
            field: 'content',
            headerName: 'Instruction text',
            // The single column that absorbs the slack, per table-design.md.
            flex: 1,
            minWidth: 420,
            required: true,
            multiline: true,
            maxRows: CONTENT_MAX_ROWS,
            validate: (text) => instructionContentError(text),
            onCommit: (row) => live.current.commitField(row, 'content', 'instruction content'),
            onErrorChange: (row) => live.current.noteFieldError(row.id, 'content'),
            testId: (row) => `instruction-content-input-${row.id}`,
        }),
        {
            // What makes the gear's "Agent Count" mode reachable as a column sort,
            // and the blast radius legible at a glance — the read this whole page
            // exists for.
            field: 'agent_count',
            headerName: 'Agents',
            width: 90,
            type: 'number',
            valueGetter: (_value, row) => row.refs.length,
            renderCell: (p) => (
                <GhostCell align="flex-end">
                    <Typography variant="body2"
                                color={p.row.refs.length === 0 ? 'warning.main' : 'text.primary'}
                                data-testid={`instruction-agent-count-${p.row.id}`}>
                        {p.row.refs.length}
                    </Typography>
                </GhostCell>
            ),
        },
        {
            field: 'agents',
            headerName: 'Bound to',
            width: 300,
            // There is no total order over a chip set worth offering, and the
            // adjacent count column is the sortable form of the same question.
            sortable: false,
            filterable: false,
            // Not exported: a chip set has no total order worth offering, and the
            // CSV would carry an empty column.
            disableExport: true,
            renderCell: (p) => {
                const l = live.current;
                const boundSet = new Set(p.row.refs);
                return (
                    <GhostCell>
                        <InstructionAgentChips
                            variant="compact"
                            boundAgentIds={p.row.refs}
                            agentIndex={l.agentIndex}
                            bindableAgents={l.openAgents.filter(a => !boundSet.has(a.id))}
                            slotOf={l.slotOf(p.row.id)}
                            onBind={(agentId) => l.onBind(p.row, agentId)}
                            onBindAll={(agentsToBind) => l.onBindAll(p.row, agentsToBind)}
                            onRequestUnbind={(agent, slot) => l.onRequestUnbind(p.row, agent, slot)}
                            onOpenAgent={l.onOpenAgent}
                            busy={p.row.membershipBusy}
                            testIdPrefix={`instruction-${p.row.id}`}
                        />
                    </GhostCell>
                );
            },
        },
        {
            // THE MOST IMPORTANT CORRECTNESS POINT IN THIS FILE.
            //
            // This checkbox is an AFFORDANCE FOR THE PAGE'S EXISTING HANDLER, never
            // a write path of its own. Closing an instruction drops it out of every
            // bound agent's boot payload, so the page graduates the action on blast
            // radius: an unbound row closes immediately, a BOUND row goes through
            // InstructionDeleteDialog where the agent chips are. A checkbox that
            // PUT `closed` directly would put that silent unloading one stray click
            // from every row in the catalog — the single worst regression this
            // requirement could ship. It calls the same two functions the menu
            // does, and gains nothing of its own.
            field: 'closed',
            headerName: 'Closed',
            width: 90,
            type: 'boolean',
            renderCell: (p) => (
                <GhostCell align="center">
                    <Tooltip title={p.row.closed
                        ? 'Reopen — restores this instruction to every bound agent’s boot payload'
                        : 'Close — drops this instruction from every bound agent’s boot payload'}>
                        <Checkbox
                            size="small"
                            checked={!!p.row.closed}
                            onChange={() => (p.row.closed
                                ? live.current.onReopen(p.row)
                                : live.current.onCloseInstruction(p.row))}
                            inputProps={{ 'data-testid': `instruction-closed-toggle-${p.row.id}` }}
                        />
                    </Tooltip>
                </GhostCell>
            ),
        },
        {
            field: 'update_ts',
            headerName: 'Last updated',
            width: 150,
            type: 'dateTime',
            // `lastTouched` falls back to `create_ts` when a row has never been
            // edited. Reused from instructionSort.js rather than re-derived, so the
            // column and the gear's Last-updated mode can never disagree about what
            // "last touched" means.
            valueGetter: (_value, row) => {
                const ms = lastTouched(row);
                return ms ? new Date(ms) : null;
            },
            valueFormatter: (value) => (value ? formatDate(value, live.current.timezone) : '—'),
        },
        {
            // Hidden by default: two date columns cost 300px and only one of them is
            // ever the question. The toolbar's Columns button reveals it.
            field: 'create_ts',
            headerName: 'Created',
            width: 150,
            type: 'dateTime',
            // Routed through the SAME parser as `update_ts` above. These two columns
            // sit side by side, so any disagreement about how a bare MySQL DATETIME
            // is interpreted shows up as one row printing two different days.
            valueGetter: (value) => {
                const ms = dbTimestamp(value);
                return ms ? new Date(ms) : null;
            },
            valueFormatter: (value) => (value ? formatDate(value, live.current.timezone) : '—'),
        },
        {
            field: 'actions',
            headerName: '',
            width: 56,
            sortable: false,
            filterable: false,
            disableColumnMenu: true,
            disableExport: true,
            hideable: false,
            align: 'center',
            renderCell: (p) => (
                <GhostCell align="center">
                    {/* The menu owns its own anchor, so it cannot outlive its row —
                        and the column definitions do not depend on menu state. */}
                    <InstructionRowMenu
                        row={p.row}
                        onCloseInstruction={live.current.onCloseInstruction}
                        onReopen={live.current.onReopen}
                        onDelete={live.current.onDelete}
                    />
                </GhostCell>
            ),
        },
        // EMPTY, deliberately — see the `live` ref above. Every value these columns
        // need is read at render time through that ref, so the definitions never have
        // to be rebuilt, and DataGrid keeps the user's column widths.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], []);

    return (
        <>
            {renameNotice && (
                <Alert severity="info" sx={{ mb: 1.5, py: 0 }}
                       onClose={onDismissRenameNotice}
                       data-testid="instruction-rename-warning">
                    Renamed <code>{renameNotice.from}</code> →{' '}
                    <code>{renameNotice.to}</code>. Safe: nothing resolves an
                    instruction by name, and the charter stubs and memory docs cite
                    it as <code>instruction #{renameNotice.id}</code> rather than by
                    title (req #3068).
                </Alert>
            )}

            <Box sx={{ width: '100%' }} data-testid="instructions-datagrid">
                <DataGrid
                    // NOT COSMETIC. `autoHeight` makes the virtualizer render every
                    // row on the page (`lastRowIndex = firstRowIndex + rows.length`)
                    // instead of only the visible window — so a row cannot be
                    // unmounted out from under a field the user is still typing in.
                    // GhostTextField's re-seed guard protects against an external
                    // value landing mid-edit; it cannot protect against its own
                    // unmount, and nothing inside the component could.
                    autoHeight
                    rows={gridRows}
                    columns={columns}
                    rowHeight={ROW_HEIGHT}
                    density="compact"
                    slots={{ toolbar: GridToolbar }}
                    slotProps={{ toolbar: { showQuickFilter: true } }}
                    initialState={{
                        pagination: { paginationModel: { pageSize: 25 } },
                        // Seeded ONCE from the persisted gear mode so switching from
                        // Cards is not a jump to an unrelated order. The grid is the
                        // sort authority from here on and never writes back.
                        sorting: { sortModel: [gridSortFromMode(sortMode, sortDesc)] },
                        columns: { columnVisibilityModel: { create_ts: false } },
                    }}
                    pageSizeOptions={[25, 50, 100]}
                    // No row-click navigation and no row selection: in an
                    // edit-in-place table a click on a cell means "edit this", and a
                    // second meaning for the same gesture is how a user loses an
                    // edit to an accidental navigation.
                    disableRowSelectionOnClick
                    getRowClassName={(p) => (p.row.blockedMessages.length
                        ? 'instruction-row--blocked'
                        : (p.row.closed ? 'instruction-row--closed' : ''))}
                    sx={(theme) => ({
                        // The second half of the unsaved signal: findable after the
                        // marker column has been scrolled past horizontally.
                        '& .instruction-row--blocked': {
                            boxShadow: `inset 3px 0 0 ${theme.palette.error.main}`,
                        },
                        // Matches the card grid's `opacity: 0.55` on a closed row.
                        // Applied to the CELLS rather than the row so the row's own
                        // hover/selection background is not dimmed with it.
                        '& .instruction-row--closed .MuiDataGrid-cell': { opacity: 0.55 },
                        // The cells host live inputs, so the grid's own cell focus
                        // ring is noise on top of the field's focus underline.
                        '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': {
                            outline: 'none',
                        },
                    })}
                />
            </Box>

            {/* THE TEMPLATE ROW, deliberately BELOW the grid rather than inside it.
                Per instruction #41 an inline-editable list ends with a blank item
                the user fills in place — but a blank row inside a SORTABLE grid does
                not stay at the end: it scatters to wherever an empty name sorts, and
                the MIT DataGrid has no pinned rows to stop it. Rendered here it is
                still literally the last row of the list, still fills in place, and
                the fixed-row-height invariant above survives.

                Same state, same predicate, same testids as the card view's
                template: `maybeCreate` fires on every blur of either field and is
                idempotent, which is what makes a failed create retryable by
                clicking back in and out. */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 2,
                    mt: 1,
                    p: 1.5,
                    border: '1px dashed',
                    borderColor: 'divider',
                    borderRadius: 1,
                }}
                data-testid="instruction-row-template"
            >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, width: 260, flexShrink: 0 }}>
                    <GhostTextField
                        value={draftName}
                        onChangeText={setDraftName}
                        outlined
                        label="Name"
                        fullWidth
                        commitOnEnter
                        placeholder="New instruction name"
                        validate={(text) => instructionNameError(text, instructions, null)}
                        onCommit={onMaybeCreate}
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
                    onCommit={onMaybeCreate}
                    testId="instruction-content-input-template"
                />
            </Box>
        </>
    );
};

export default InstructionsTableView;
