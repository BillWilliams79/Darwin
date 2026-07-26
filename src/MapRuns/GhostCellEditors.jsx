import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';

import GhostTextField from '../Components/GhostField/GhostTextField';
import { ghostSelectBase, ghostAutocompleteInputBase } from '../utils/ghostFieldStyles';
import { dateTimeField, notesField } from '../utils/ghostFieldParsers';

// Always-editable "ghost" cell editors for the Maps Table (MapRunsView) DataGrid.
// Each editor renders as plain text until clicked, then edits in place and saves on
// blur (text) or change (Select/Autocomplete) — mirroring the map-card design
// (RouteCard). No DataGrid edit-mode; these live in `renderCell` and are always live.
//
// The three TEXT editors are now thin adapters over the shared GhostTextField
// (req #3073). What they used to hand-roll, and what the shared component does
// instead:
//
//   * They skipped the save when a value failed to parse (`if (parsed !== null)`)
//     and left no trace, so a bad value looked saved until the next refetch quietly
//     reverted it. Now it stays on screen in red with the reason beside it, and no
//     write is issued.
//   * They re-seeded from the row on ANY value change, which overwrote in-progress
//     typing whenever a genuinely external change landed. Now a field re-seeds only
//     when it is neither focused NOR dirty.
//   * A rejected write left the failed value on screen. Now `onSave` is awaited and
//     the field reverts when it rejects — so the cell never shows a value the
//     database does not hold. This is why MapRunsView's `saveRunFields` rethrows.
//   * There was no way to abandon an edit. Escape now reverts.
//
// They also stopped writing on every blur: tabbing through a row used to PUT each
// cell unconditionally, which silently rewrote `avg_speed_mph` (DECIMAL(5,2)) with
// its own one-decimal display value. GhostTextField only commits a value the user
// actually changed.
//
// GhostSelectCell and GhostPartnersCell stay hand-rolled: a Select and a multi-value
// Autocomplete are not text fields, and forcing them through a text component would
// model them badly. They share the theme-aware underline and now roll back their
// optimistic state on a failed write, which is the part that was worth having.
//
// Shared contract:
//   - onClick stopPropagation on the wrapper so clicking inside a cell never toggles
//     row selection or column sort.
//   - onKeyDown stopPropagation for the keys an open editor owns — see EDITOR_KEYS.
//
// The verdict caption stays IN FLOW here, unlike the card. `.MuiDataGrid-cell` is
// `overflow: hidden` with no vertical padding, so a caption hung below the field
// would be clipped away and the user would see red text with no reason for it —
// which is only half of the silent-drop fix. Letting the row grow instead costs a
// reflow on the transitions into and out of an invalid value, and that is the
// cheaper of the two.

const cellWrapSx = { width: '100%', py: '2px' };
const stop = (e) => e.stopPropagation();

/**
 * The keys a permanently-open cell editor consumes, which must NOT reach the
 * DataGrid's keyboard navigation: caret movement, selection, commit and abandon.
 *
 * Deliberately not "every key". The DataGrid registers `cellKeyDown` as a React
 * synthetic handler on the cell, so stopping propagation wholesale also takes out
 * PageUp/PageDown paging and the grid's cell-to-cell Tab tracking, neither of which
 * an editor has any use for.
 */
const EDITOR_KEYS = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End', 'Enter', 'Escape', ' ',
]);
const stopEditorKeys = (e) => { if (EDITOR_KEYS.has(e.key)) e.stopPropagation(); };

/**
 * Ghost text field for a numeric / duration cell.
 * @param row    DataGrid row
 * @param field  column on the row to edit
 * @param rule   the column's entry from utils/ghostFieldParsers — owns format,
 *               normalize, validate, toApi and whether an emptied field reverts
 * @param onSave (rowId, {[field]: value}) => Promise, REJECTING on failure
 * @param align  'left' | 'right' (default 'right' to match number columns)
 */
export const GhostInputCell = ({ row, field, rule, onSave, align = 'right' }) => (
    <Box sx={cellWrapSx} onClick={stop} onKeyDown={stopEditorKeys}>
        <GhostTextField
            value={rule.format(row[field])}
            required={rule.required}
            normalize={rule.normalize}
            validate={rule.validate}
            // Returns the promise: GhostTextField awaits it and reverts on rejection.
            // An adapter that forgot to return would resolve instantly and disable
            // the rollback with no visible symptom at all.
            onCommit={(text) => onSave(row.id, { [field]: rule.toApi(text) })}
            testId={`map-run-${field}`}
            sx={{
                width: '100%',
                '& .MuiInputBase-input': { width: '100%', textAlign: align },
            }}
        />
    </Box>
);

/**
 * Ghost datetime-local for the start_time cell.
 * @param row       DataGrid row (uses row.start_time)
 * @param timezone  user's timezone
 * @param onSave    (rowId, { start_time }) => Promise, REJECTING on failure
 */
export const GhostDateTimeCell = ({ row, timezone, onSave }) => {
    const rule = dateTimeField(timezone);
    return (
        <Box sx={cellWrapSx} onClick={stop} onKeyDown={stopEditorKeys}>
            <GhostTextField
                type="datetime-local"
                value={rule.format(row.start_time)}
                required={rule.required}
                validate={rule.validate}
                onCommit={(text) => onSave(row.id, { start_time: rule.toApi(text) })}
                testId="map-run-start-time"
                sx={{
                    width: '100%',
                    // Without this Chrome's own picker button opens on click and
                    // swallows the first Escape to close itself, so the field never
                    // sees the abandon key.
                    '& input::-webkit-calendar-picker-indicator': { display: 'none' },
                    '& input::-webkit-inner-spin-button': { display: 'none' },
                    '& .MuiInputBase-input': { width: '100%' },
                }}
            />
        </Box>
    );
};

/**
 * Ghost multiline italic field for the notes cell.
 * @param row     DataGrid row (uses row.notes)
 * @param onSave  (rowId, { notes }) => Promise, REJECTING on failure. '' => 'NULL'.
 */
export const GhostNotesCell = ({ row, onSave }) => (
    <Box sx={cellWrapSx} onClick={stop} onKeyDown={stopEditorKeys}>
        <GhostTextField
            multiline
            value={notesField.format(row.notes)}
            normalize={notesField.normalize}
            onCommit={(text) => onSave(row.id, { notes: notesField.toApi(text) })}
            testId="map-run-notes"
            sx={{
                fontStyle: 'italic',
                color: 'text.secondary',
                '& .MuiInputBase-input': {
                    fontStyle: 'italic',
                    color: 'text.secondary',
                    minHeight: '1.2em',
                },
            }}
        />
    </Box>
);

/**
 * Ghost Select for route / activity cells.
 * @param row       DataGrid row
 * @param value     current selected value
 * @param options   [{ value, label }]
 * @param onSave    (rowId, newValue) => Promise, REJECTING on failure (fires on change)
 */
export const GhostSelectCell = ({ row, value: controlledValue, options, onSave }) => {
    const [value, setValue] = useState(controlledValue);

    useEffect(() => {
        setValue(controlledValue);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.id, controlledValue]);

    // Optimistic, then rolled back if the write is refused — otherwise the cell keeps
    // showing a route the run was never assigned. The catch is also what keeps a
    // rejecting onSave from escaping this void handler as an unhandled rejection.
    const handleChange = async (e) => {
        const previous = value;
        setValue(e.target.value);
        try {
            await onSave(row.id, e.target.value);
        } catch {
            setValue(previous);   // already reported by the caller
        }
    };

    return (
        <Box sx={cellWrapSx} onClick={stop} onKeyDown={stopEditorKeys}>
            <Select
                value={value}
                onChange={handleChange}
                variant="standard"
                IconComponent={() => null}
                sx={(theme) => ({ ...ghostSelectBase(theme), width: '100%' })}
            >
                {options.map((opt) => (
                    <MenuItem key={String(opt.value)} value={opt.value} sx={{ fontSize: '0.8125rem' }}>
                        {opt.label}
                    </MenuItem>
                ))}
            </Select>
        </Box>
    );
};

/**
 * Ghost Autocomplete for the partners cell.
 * @param row          DataGrid row
 * @param partners     all partner records [{ id, name }]
 * @param runPartners  all run-partner links [{ map_run_fk, map_partner_fk }]
 * @param onSave       (rowId, newNames[]) => Promise, REJECTING on failure
 *                     (fires on change; parent diffs add/remove)
 */
export const GhostPartnersCell = ({ row, partners, runPartners, onSave }) => {
    const computeNames = () => {
        const ids = runPartners.filter((rp) => rp.map_run_fk === row.id).map((rp) => rp.map_partner_fk);
        return partners.filter((p) => ids.includes(p.id)).map((p) => p.name);
    };
    const [value, setValue] = useState(computeNames);

    useEffect(() => {
        setValue(computeNames());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.id, runPartners, partners]);

    const handleChange = async (e, newNames) => {
        const previous = value;
        setValue(newNames);
        try {
            await onSave(row.id, newNames);
        } catch {
            setValue(previous);
        }
    };

    return (
        <Box sx={cellWrapSx} onClick={stop} onKeyDown={stopEditorKeys}>
            <Autocomplete
                multiple
                freeSolo
                size="small"
                options={partners.map((p) => p.name)}
                value={value}
                onChange={handleChange}
                disablePortal={false}
                sx={{ width: '100%' }}
                renderTags={(val, getTagProps) =>
                    val.map((option, index) => (
                        <Chip variant="outlined" label={option} size="small" {...getTagProps({ index })} key={option} />
                    ))
                }
                renderInput={(params) => (
                    <TextField
                        {...params}
                        variant="standard"
                        placeholder={value.length === 0 ? 'No partners' : ''}
                        sx={(theme) => ghostAutocompleteInputBase(theme, {
                            placeholderFontSize: '0.8125rem',
                        })}
                    />
                )}
            />
        </Box>
    );
};
