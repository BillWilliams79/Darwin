// GridColDef factory for an always-live edit-in-place text column (req #3067).
//
// The column-shape half of the contract; GhostCell.jsx is the DOM/event half. This
// exists so a table cell and a card field are demonstrably the SAME implementation
// rather than two that happen to agree today — which is the whole thesis of req
// #3067 and the reason the E2E suite can reuse one set of testids across both views.
//
// THE ONE THING EVERY CALLER MUST NOT DO: set `editable`. It is pinned false here.
// DataGrid's own edit mode is a competing state machine — it owns commit timing,
// validation and rollback, all of which GhostTextField already owns and owns
// better (a rejected value stays on screen in red rather than silently reverting).
// Running both would mean two answers to "what is in this cell".

import GhostCell from './GhostCell';
import GhostTextField from './GhostTextField';

/**
 * @param {object}   spec
 * @param {string}   spec.field         row property to read and write
 * @param {string}   spec.headerName    the column header — and, in ghost mode, the
 *                                      field's only label
 * @param {Function} spec.onCommit      (row) => (nextValue) => Promise. Must REJECT
 *                                      on failure so the field can roll back.
 * @param {Function} spec.onErrorChange (row) => (error|null) => void. How the
 *                                      blocked verdict reaches the row-level marker.
 * @param {Function} spec.testId        (row) => string
 * @param {Function} [spec.validate]    (text, row) => error string | null
 */
export const ghostTextColumn = ({
    field,
    headerName,
    width,
    flex,
    minWidth,
    multiline = false,
    maxRows,
    commitOnEnter,
    required = false,
    normalize,
    validate,
    onCommit,
    onErrorChange,
    onEditingChange,
    testId,
    inputProps,
    placeholder,
    sx,
    ...rest
}) => ({
    field,
    headerName,
    ...(width !== undefined && { width }),
    ...(flex !== undefined && { flex }),
    ...(minWidth !== undefined && { minWidth }),
    renderCell: (params) => (
        <GhostCell>
            <GhostTextField
                value={params.row[field]}
                multiline={multiline}
                maxRows={maxRows}
                commitOnEnter={commitOnEnter}
                required={required}
                placeholder={placeholder}
                normalize={normalize}
                // Bound to the ROW so a validator can exclude the row from its own
                // uniqueness check — a name is not a duplicate of itself.
                validate={validate ? (text) => validate(text, params.row) : undefined}
                onCommit={onCommit(params.row)}
                onErrorChange={onErrorChange?.(params.row)}
                onEditingChange={onEditingChange?.(params.row)}
                // The caption has nowhere to go in a fixed-height row. The verdict
                // still fires through onErrorChange; the table hoists it to the
                // row's marker column and tooltip.
                hideMessage
                testId={testId(params.row)}
                inputProps={inputProps}
                // `GhostTextField`'s `ghostBase` sets `lineHeight: 'inherit'` — right
                // for a card, where it picks up the surrounding prose's line height.
                // Inside a DataGrid cell it inherits `.MuiDataGrid-cell`'s own
                // `line-height: calc(var(--height) - 1px)` instead (a DataGrid rule
                // that exists to vertically-center a SINGLE line within the row), so
                // every wrapped line rendered near the full row height rather than a
                // normal text line — the actual cause of req #3396's corrupted
                // columns; capping `maxRows` alone does not fix it. `GhostCell`
                // already centers vertically via flexbox, so this cell owes the grid
                // nothing here and can set its own line height back to the DataGrid's
                // body2 typography (`fontSize: 0.875rem` / `lineHeight: 1.43` — MUI's
                // default, unmodified by `Theme/ThemeWrapper.jsx`).
                //
                // The nested key is merged, not replaced, so a future caller
                // passing its own `'& .MuiInputBase-input'` sx cannot silently drop
                // this and reopen #3396 — `...sx` alone would win the whole nested
                // object and take `lineHeight` with it.
                sx={{
                    width: '100%',
                    lineHeight: 1.43,
                    ...sx,
                    '& .MuiInputBase-input': {
                        lineHeight: 1.43,
                        ...(sx?.['& .MuiInputBase-input'] || {}),
                    },
                }}
            />
        </GhostCell>
    ),
    // Every other GridColDef key a caller passes lands above; `editable` lands
    // BELOW the spread, deliberately, so it cannot be smuggled back on. That
    // ordering is the enforcement — with `editable: false` written above `...rest`
    // a caller passing `editable: true` silently wins, which is how a cell ends up
    // with two competing edit state machines. There is a unit test on exactly this.
    ...rest,
    editable: false,
});

export default ghostTextColumn;
