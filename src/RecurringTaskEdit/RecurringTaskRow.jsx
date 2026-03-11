import React, { useState, useEffect, useRef } from 'react';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';

import DeleteIcon from '@mui/icons-material/Delete';
import LayersIcon from '@mui/icons-material/Layers';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import SavingsIcon from '@mui/icons-material/Savings';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';

const RECURRENCE_OPTIONS = ['daily', 'weekly', 'monthly', 'annual'];


const WEEKDAY_OPTIONS = [
    { value: '2025-01-06', label: 'Mon' },
    { value: '2025-01-07', label: 'Tue' },
    { value: '2025-01-08', label: 'Wed' },
    { value: '2025-01-09', label: 'Thu' },
    { value: '2025-01-10', label: 'Fri' },
    { value: '2025-01-11', label: 'Sat' },
    { value: '2025-01-12', label: 'Sun' },
];

const MONTH_OPTIONS = [
    { value: 1,  label: 'Jan', days: 31 }, { value: 2,  label: 'Feb', days: 28 },
    { value: 3,  label: 'Mar', days: 31 }, { value: 4,  label: 'Apr', days: 30 },
    { value: 5,  label: 'May', days: 31 }, { value: 6,  label: 'Jun', days: 30 },
    { value: 7,  label: 'Jul', days: 31 }, { value: 8,  label: 'Aug', days: 31 },
    { value: 9,  label: 'Sep', days: 30 }, { value: 10, label: 'Oct', days: 31 },
    { value: 11, label: 'Nov', days: 30 }, { value: 12, label: 'Dec', days: 31 },
];

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);

const BLANK = {
    description: '',
    recurrence: 'daily',
    anchor_date: '2025-01-06',
    priority: 0,
    accumulate: 1,
    insert_position: 'bottom',
    active: 1,
};

const pad = (n) => String(n).padStart(2, '0');

const parseAnchor = (anchor_date) => ({
    month: parseInt((anchor_date || '2025-01-01').slice(5, 7), 10) || 1,
    day:   parseInt((anchor_date || '2025-01-01').slice(8, 10), 10) || 1,
});

const selectSx   = {
    '& .MuiSelect-icon': { display: 'none' },
    '& .MuiSelect-select': { pr: '8px !important' },
};
const menuItemSx = { py: 0.5 };

// Fixed width for the anchor area — sized for the widest case (annual: month+day)
const ANCHOR_WIDTH = 122;

const RecurringTaskRow = ({ def, areaId, isTemplate, onSave, onUpdate, onDelete }) => {
    const [local, setLocal] = useState(def ? { ...def } : { ...BLANK });
    const descRef = useRef(null);

    useEffect(() => {
        if (def) setLocal({ ...def });
        else setLocal({ ...BLANK });
    }, [def]);

    const commit = (patch) => {
        if (!isTemplate) onUpdate({ id: local.id, ...patch });
    };

    const handleField = (field) => (value) => {
        setLocal(prev => ({ ...prev, [field]: value }));
        commit({ [field]: value });
    };

    const handleRecurrenceChange = (e) => {
        const rec = e.target.value;
        const anchor =
            rec === 'weekly'  ? '2025-01-06' :
            rec === 'monthly' ? '2025-01-01' :
            rec === 'annual'  ? '2025-01-01' :
            local.anchor_date;
        setLocal(prev => ({ ...prev, recurrence: rec, anchor_date: anchor }));
        commit({ recurrence: rec, anchor_date: anchor });
    };

    const handleDescKeyDown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); descRef.current?.blur(); }
    };

    const handleDescBlur = () => {
        if (!local.description.trim()) return;
        if (isTemplate) {
            onSave({ ...local, area_fk: areaId });
            setLocal({ ...BLANK });
        } else {
            commit({ description: local.description });
        }
    };

    const { month: anchorMonth, day: anchorDay } = parseAnchor(local.anchor_date);
    const daysInMonth = (MONTH_OPTIONS.find(m => m.value === anchorMonth) || MONTH_OPTIONS[0]).days;

    const handleAnnualMonth = (e) => {
        const m = parseInt(e.target.value, 10);
        const d = Math.min(anchorDay, (MONTH_OPTIONS.find(x => x.value === m) || MONTH_OPTIONS[0]).days);
        const anchor = `2025-${pad(m)}-${pad(d)}`;
        setLocal(prev => ({ ...prev, anchor_date: anchor }));
        commit({ anchor_date: anchor });
    };

    const handleAnnualDay = (e) => {
        const anchor = `2025-${pad(anchorMonth)}-${pad(parseInt(e.target.value, 10))}`;
        setLocal(prev => ({ ...prev, anchor_date: anchor }));
        commit({ anchor_date: anchor });
    };

    const needsWeekday  = local.recurrence === 'weekly';
    const needsDay      = local.recurrence === 'monthly';
    const needsMonthDay = local.recurrence === 'annual';

    const hasText    = local.description.trim().length > 0;
    const rowOpacity = (!isTemplate && !local.active) ? 0.45 : 1;

    return (
        <Box
            data-testid={isTemplate ? 'recurring-template' : `recurring-${local.id}`}
            sx={{
                // Col:  [priority] [accumulate] [active]  [description] [recurrence] [anchor]      [action]
                display: 'grid',
                gridTemplateColumns: `28px 28px 28px 1fr 105px ${ANCHOR_WIDTH}px 32px`,
                alignItems: 'center',
                opacity: rowOpacity,
                background: 'white',
            }}
        >
            {/* 1. Priority — ReportGmailerrorredOutlinedIcon / ReportIcon (same as TaskEdit) */}
            <Checkbox
                checked={!!local.priority}
                onClick={() => handleField('priority')(local.priority ? 0 : 1)}
                icon={<ReportGmailerrorredOutlinedIcon sx={{ fontSize: 20 }} />}
                checkedIcon={<ReportIcon sx={{ fontSize: 20 }} />}
                sx={{ maxWidth: 28, maxHeight: 28, mr: '2px' }}
            />

            {/* 2. Accumulate — moved between priority and active */}
            <Tooltip title={local.accumulate ? 'Stacks tasks' : 'Replaces unfinished'}>
                <IconButton
                    size="small"
                    onClick={() => handleField('accumulate')(local.accumulate ? 0 : 1)}
                    color={local.accumulate ? 'default' : 'warning'}
                    sx={{ maxWidth: 28, maxHeight: 28, mr: '2px', p: 0 }}
                >
                    {local.accumulate
                        ? <LayersIcon sx={{ fontSize: 20 }} />
                        : <SwapHorizIcon sx={{ fontSize: 20 }} />}
                </IconButton>
            </Tooltip>

            {/* 3. Active/pause — greyed on template until text entered */}
            <Checkbox
                checked={!!local.active}
                onClick={() => { if (!isTemplate) handleField('active')(local.active ? 0 : 1); }}
                disabled={isTemplate && !hasText}
                icon={<PauseCircleOutlineIcon sx={{ fontSize: 20 }} />}
                checkedIcon={<PlayCircleOutlineIcon color={isTemplate ? 'disabled' : 'success'} sx={{ fontSize: 20 }} />}
                sx={{ maxWidth: 28, maxHeight: 28, mr: '2px' }}
            />

            {/* 4. Description — identical to TaskEdit */}
            <TextField
                inputRef={descRef}
                variant="outlined"
                value={local.description || ''}
                name="description"
                placeholder={isTemplate ? 'Add recurring task…' : ''}
                onChange={(e) => setLocal(prev => ({ ...prev, description: e.target.value }))}
                onKeyDown={handleDescKeyDown}
                onBlur={handleDescBlur}
                multiline
                autoComplete="off"
                size="small"
                sx={{ width: '100%' }}
                slotProps={{ htmlInput: { maxLength: 1024 } }}
            />

            {/* 5. Recurrence select */}
            <Select
                value={local.recurrence}
                onChange={handleRecurrenceChange}
                size="small"
                variant="outlined"
                sx={{ ...selectSx, width: 105 }}
            >
                {RECURRENCE_OPTIONS.map(opt => (
                    <MenuItem key={opt} value={opt} sx={menuItemSx}>
                        {opt === 'annual' ? 'Yearly' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </MenuItem>
                ))}
            </Select>

            {/* 6. Anchor — direct grid child for single selects; Box only for annual pair */}
            {needsWeekday && (
                <Select value={local.anchor_date} onChange={(e) => handleField('anchor_date')(e.target.value)}
                    size="small" variant="outlined" sx={{ ...selectSx, width: ANCHOR_WIDTH }}>
                    {WEEKDAY_OPTIONS.map(o => <MenuItem key={o.value} value={o.value} sx={menuItemSx}>{o.label}</MenuItem>)}
                </Select>
            )}
            {needsDay && (
                <Select value={local.anchor_date} onChange={(e) => handleField('anchor_date')(e.target.value)}
                    size="small" variant="outlined" sx={{ ...selectSx, width: ANCHOR_WIDTH }}>
                    {DAY_OPTIONS.map(d => <MenuItem key={d} value={`2025-01-${pad(d)}`} sx={menuItemSx}>{d}</MenuItem>)}
                </Select>
            )}
            {needsMonthDay && (
                <Box sx={{ width: ANCHOR_WIDTH, display: 'flex', gap: 0.5 }}>
                    <Select value={anchorMonth} onChange={handleAnnualMonth}
                        size="small" variant="outlined" sx={{ ...selectSx, width: 65 }}>
                        {MONTH_OPTIONS.map(m => <MenuItem key={m.value} value={m.value} sx={menuItemSx}>{m.label}</MenuItem>)}
                    </Select>
                    <Select value={anchorDay} onChange={handleAnnualDay}
                        size="small" variant="outlined" sx={{ ...selectSx, width: 53 }}>
                        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d =>
                            <MenuItem key={d} value={d} sx={menuItemSx}>{d}</MenuItem>)}
                    </Select>
                </Box>
            )}
            {/* daily: no anchor — placeholder keeps grid column count correct */}
            {!needsWeekday && !needsDay && !needsMonthDay && (
                <Box sx={{ width: ANCHOR_WIDTH }} />
            )}

            {/* 7. Save (template) or Delete (existing) — always in same column */}
            {isTemplate ? (
                <Tooltip title="Save">
                    <span style={{ display: 'flex', justifyContent: 'center' }}>
                        <IconButton
                            size="small"
                            disabled={!hasText}
                            onClick={() => { if (hasText) { descRef.current?.blur(); } }}
                            sx={{ maxWidth: 32, maxHeight: 32, p: 0 }}
                        >
                            <SavingsIcon sx={{ fontSize: 20, opacity: hasText ? 1 : 0.35 }} />
                        </IconButton>
                    </span>
                </Tooltip>
            ) : (
                <Tooltip title="Delete">
                    <IconButton size="small" onClick={() => onDelete(local)} sx={{ maxWidth: 32, maxHeight: 32, p: 0 }}>
                        <DeleteIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                </Tooltip>
            )}
        </Box>
    );
};

export default RecurringTaskRow;
