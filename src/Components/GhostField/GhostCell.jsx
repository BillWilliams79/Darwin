// The DataGrid cell wrapper for always-live edit-in-place content (req #3067).
//
// Wraps ANY editable cell content — a GhostTextField, a chip row, a checkbox, a
// menu button — and owns the event contract that makes an interactive control
// survive inside a DataGrid cell. DataGrid edit mode is NOT involved: no column
// using this sets `editable`, so the grid's own editing state machine never starts.
//
// WHY THE KEYDOWN STOP IS THE LOAD-BEARING PART. The Maps precedent
// (MapRuns/GhostCellEditors.jsx) stops `onClick` only, and that is not enough.
// Verified against the installed @mui/x-data-grid@8.27.3:
//
//   * `components/cell/GridCell.js` publishes `cellKeyDown` from the cell's own
//     `onKeyDown` with NO input-target guard — it does not care that the event came
//     from inside a text field.
//   * `utils/keyboardUtils.js` classifies the SPACE CHARACTER as a navigation key,
//     alongside Arrow*, Page*, Home and End.
//   * `hooks/features/keyboardNavigation/useGridKeyboardNavigation.js` responds to
//     every navigation key with `goToCell(...)` + `event.preventDefault()`.
//
// The consequences, in order of how badly they break the feature:
//   1. A SPACE CANNOT BE TYPED into the cell at all. Not degraded — impossible.
//   2. An arrow key moves grid focus instead of the caret, which blurs the field
//      and therefore COMMITS the half-typed value on its way out.
//   3. Tab traverses grid cells rather than fields.
//
// Tab is stopped deliberately rather than reluctantly: native tab order (name →
// content → next row) is the right traversal for an edit-in-place table, and each
// hop blurs and commits exactly as a click away would.
//
// Enter and Escape are NOT intercepted by the grid — they are not navigation keys,
// and `useGridCellEditing` gates all of its Enter/printable/Delete handling behind
// `params.isEditable`, which is false because no column sets `editable`. They are
// covered by this stop anyway, harmlessly: GhostTextField's own handler sits on the
// input, deeper in the tree, so it runs first and the stop happens on the way up.
//
// WHAT IS DELIBERATELY NOT STOPPED: mousedown and mouseup. `useGridFocus` registers
// its document handler on mouseup and `cellMouseDown` records `lastClickedCell`, and
// the grid keeps the FOCUSED cell rendered even when it falls outside the render
// context. Stopping those would forfeit that protection to prevent nothing.

import Box from '@mui/material/Box';

const stop = (e) => e.stopPropagation();

const GhostCell = ({
    children,
    // Cross-axis placement of the content within the cell. `flex-end` for a number
    // column, so the digits line up with the header the grid right-aligns.
    align = 'flex-start',
    sx = {},
}) => (
    <Box
        // Keep a click inside the cell from reaching the row: row click navigation,
        // row selection and column sort all live above this. The Maps precedent.
        onClick={stop}
        // See the header comment. This one is not optional.
        onKeyDown={stop}
        sx={{
            width: '100%',
            height: '100%',
            // Without this a long unbroken value forces the flex item wider than its
            // column and the grid scrolls horizontally by a cell rather than
            // wrapping or clipping.
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: align,
            py: '2px',
            ...sx,
        }}
    >
        {children}
    </Box>
);

export default GhostCell;
