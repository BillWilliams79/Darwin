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
                sx={{ width: '100%', ...sx }}
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
