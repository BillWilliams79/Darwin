import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';

import { ghostBase } from '../utils/ghostFieldStyles';
import { toDateTimeLocalValue, fromDateTimeLocalValue } from '../utils/dateFormat';

// Always-editable "ghost" cell editors for the Maps Table (MapRunsView) DataGrid.
// Each editor renders as plain text until clicked, then edits in place and saves on
// blur (text) or change (Select/Autocomplete) — mirroring the map-card design
// (RouteCard). No DataGrid edit-mode; these live in `renderCell` and are always live.
//
// Shared contract:
//   - local state seeded from the row, reset via useEffect on [row.id, <value>] so an
//     external data change (query invalidation, another session) refreshes the cell
//     without clobbering in-progress typing (the saved value round-trips unchanged).
//   - onClick stopPropagation on the wrapper so clicking inside a cell never toggles
//     row selection or column sort.

const cellWrapSx = { width: '100%', py: '2px' };
const stop = (e) => e.stopPropagation();

/**
 * Ghost InputBase for numeric / duration cells.
 * @param row      DataGrid row
 * @param field    field name on the row to edit
 * @param format   (rawValue) => display string
 * @param parse    (displayString) => API value, or null to skip the save
 * @param validate (displayString) => boolean; false renders the text red (optional)
 * @param onSave   (rowId, {[field]: value}) => void
 * @param align    'left' | 'right' (default 'right' to match number columns)
 */
export const GhostInputCell = ({ row, field, format, parse, validate, onSave, align = 'right' }) => {
    const rawValue = row[field];
    const [value, setValue] = useState(() => format(rawValue));

    useEffect(() => {
        setValue(format(rawValue));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.id, rawValue]);

    const handleBlur = () => {
        const parsed = parse(value);
        if (parsed !== null) onSave(row.id, { [field]: parsed });
    };

    const isInvalid = validate ? !validate(value) : false;

    return (
        <Box sx={cellWrapSx} onClick={stop}>
            <InputBase
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                sx={{
                    ...ghostBase,
                    width: '100%',
                    '& .MuiInputBase-input': {
                        ...ghostBase['& .MuiInputBase-input'],
                        width: '100%',
                        textAlign: align,
                        ...(isInvalid && { color: 'error.main' }),
                    },
                }}
            />
        </Box>
    );
};

/**
 * Ghost Select for route / activity cells.
 * @param row       DataGrid row
 * @param value     current selected value
 * @param options   [{ value, label }]
 * @param onSave    (rowId, newValue) => void  (fires on change)
 */
export const GhostSelectCell = ({ row, value: controlledValue, options, onSave }) => {
    const [value, setValue] = useState(controlledValue);

    useEffect(() => {
        setValue(controlledValue);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.id, controlledValue]);

    const handleChange = (e) => {
        const newVal = e.target.value;
        setValue(newVal);
        onSave(row.id, newVal);
    };

    return (
        <Box sx={cellWrapSx} onClick={stop}>
            <Select
                value={value}
                onChange={handleChange}
                variant="standard"
                IconComponent={() => null}
                sx={{
                    width: '100%',
                    fontSize: 'inherit',
                    '& .MuiSelect-select': { py: 0, pr: '0 !important' },
                    '&:before': { borderBottomColor: 'transparent' },
                    '&:hover:not(.Mui-disabled):before': { borderBottomColor: 'rgba(0,0,0,0.3)' },
                }}
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
 * Ghost datetime-local for the start_time cell.
 * @param row       DataGrid row (uses row.start_time)
 * @param timezone  user's timezone
 * @param onSave    (rowId, { start_time }) => void  (fires on blur)
 */
export const GhostDateTimeCell = ({ row, timezone, onSave }) => {
    const [value, setValue] = useState(() => toDateTimeLocalValue(row.start_time, timezone));

    useEffect(() => {
        setValue(toDateTimeLocalValue(row.start_time, timezone));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.id, row.start_time, timezone]);

    const handleBlur = () => {
        const parsed = fromDateTimeLocalValue(value, timezone);
        if (parsed) onSave(row.id, { start_time: parsed });
    };

    return (
        <Box sx={cellWrapSx} onClick={stop}>
            <InputBase
                type="datetime-local"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                sx={{
                    ...ghostBase,
                    width: '100%',
                    '& input::-webkit-calendar-picker-indicator': { display: 'none' },
                    '& input::-webkit-inner-spin-button': { display: 'none' },
                    '& .MuiInputBase-input': {
                        ...ghostBase['& .MuiInputBase-input'],
                        width: '100%',
                    },
                }}
            />
        </Box>
    );
};

/**
 * Ghost multiline italic InputBase for the notes cell.
 * @param row     DataGrid row (uses row.notes)
 * @param onSave  (rowId, { notes }) => void  (fires on blur; '' => 'NULL')
 */
export const GhostNotesCell = ({ row, onSave }) => {
    const [value, setValue] = useState(row.notes || '');

    useEffect(() => {
        setValue(row.notes || '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.id, row.notes]);

    const handleBlur = () => {
        onSave(row.id, { notes: value.trim() || 'NULL' });
    };

    return (
        <Box sx={cellWrapSx} onClick={stop}>
            <InputBase
                fullWidth
                multiline
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                sx={{
                    ...ghostBase,
                    display: 'flex',
                    width: '100%',
                    fontStyle: 'italic',
                    color: 'text.secondary',
                    '& .MuiInputBase-input': {
                        ...ghostBase['& .MuiInputBase-input'],
                        fontStyle: 'italic',
                        color: 'text.secondary',
                        minHeight: '1.2em',
                    },
                }}
            />
        </Box>
    );
};

/**
 * Ghost Autocomplete for the partners cell.
 * @param row          DataGrid row
 * @param partners     all partner records [{ id, name }]
 * @param runPartners  all run-partner links [{ map_run_fk, map_partner_fk }]
 * @param onSave       (rowId, newNames[]) => void  (fires on change; parent diffs add/remove)
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

    const handleChange = (e, newNames) => {
        setValue(newNames);
        onSave(row.id, newNames);
    };

    return (
        <Box sx={cellWrapSx} onClick={stop}>
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
                        sx={{
                            '& .MuiInput-underline:before': { borderBottomColor: 'transparent' },
                            '& .MuiInput-underline:hover:not(.Mui-disabled, .Mui-error):before': {
                                borderBottomColor: 'rgba(0,0,0,0.3)',
                            },
                            '& .MuiInputBase-input::placeholder': {
                                color: 'text.disabled', opacity: 1, fontSize: '0.8125rem',
                            },
                            '& .MuiInputBase-root': { flexWrap: 'wrap', gap: 0.5 },
                        }}
                    />
                )}
            />
        </Box>
    );
};
