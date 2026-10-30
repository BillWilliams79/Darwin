// PipelineStatusChip.jsx — THE pipeline status editor (req #3965).
//
// "The pipeline editors in every case need to support these states" (user,
// 2026-10-30). One control for every surface a plan is edited on — the
// Pipelines table and cards, the pipeline group view's focus panel and the plan
// page's header: the plan's status chip, in its requirement-mirroring colours,
// which opens a menu of all seven values. Picking one writes it; there is no
// transition table, exactly as a requirement's status is set from any value to
// any value. The caller owns the write (`onChange` resolves when it settled),
// because each surface already has its own write path and re-read.
//
// Timestamps are NOT this control's business: the gateway derives
// started_at/completed_at from the value written (Lambda-Rest
// pipeline_lifecycle.py), for every writer alike.
//
// A status write is allowed on a LOCKED plan (the gateway's lock-free set), so
// the lock never disables this control.
//
// Every click (and the menu's keys) stops propagating: the chip sits inside
// rows and cards whose own click opens the plan or starts a drag or a pan.

import { useState } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import Check from '@mui/icons-material/Check';

import {
    PIPELINE_STATUS_VALUES, pipelineStatusChipProps, pipelineStatusLabel,
} from '../SwarmView/pipelines/pipelineChipStyles';

const stop = (e) => e.stopPropagation();

/**
 * @param {Object} props
 * @param {string} props.status                 the stored `pipeline_status`
 * @param {(next: string) => (Promise|void)} props.onChange   writes the new value
 * @param {string} props.testId                 the chip's test id; options are
 *                                              `<testId>-option-<value>`, the menu `<testId>-menu`
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.disablePortal]       render the menu in place (a full-screen stage
 *                                              shows nothing portalled to <body>)
 * @param {string} [props.tooltip]              defaults to naming what a click does
 * @param {Object} [props.sx]                   merged over the status colours
 */
export default function PipelineStatusChip({ status, onChange, testId, disabled = false,
    disablePortal = false, tooltip, sx }) {
    const [anchor, setAnchor] = useState(null);
    const [saving, setSaving] = useState(false);
    const label = pipelineStatusLabel(status);
    const colours = pipelineStatusChipProps(status);
    const off = disabled || saving || !onChange;

    const open = (e) => {
        e.stopPropagation();
        if (!off) setAnchor(e.currentTarget);
    };
    const pick = async (e, next) => {
        e.stopPropagation();
        setAnchor(null);
        if (next === status) return;
        setSaving(true);
        try {
            await onChange(next);
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <Tooltip title={tooltip ?? (off ? '' : `Status: ${label} — click to change`)}>
                <Chip
                    size="small"
                    label={label}
                    {...colours}
                    clickable={!off}
                    onClick={open}
                    onMouseDown={stop}
                    onPointerDown={stop}
                    onDelete={off ? undefined : open}
                    deleteIcon={<ArrowDropDownIcon />}
                    aria-haspopup="menu"
                    aria-expanded={anchor ? 'true' : 'false'}
                    aria-label={`Pipeline status: ${label}`}
                    data-status={status ?? ''}
                    data-testid={testId}
                    sx={{
                        ...(colours.sx || {}),
                        flexShrink: 0,
                        fontWeight: 600,
                        opacity: saving ? 0.6 : 1,
                        // MUI's clickable chip repaints its fill on hover/focus;
                        // the status colour must survive the pointer landing on it.
                        ...(colours.sx && {
                            '&:hover, &.Mui-focusVisible': { bgcolor: colours.sx.bgcolor, filter: 'brightness(1.1)' },
                        }),
                        '& .MuiChip-deleteIcon': { color: 'inherit', opacity: 0.8, mr: 0.25,
                            '&:hover': { color: 'inherit', opacity: 1 } },
                        ...sx,
                    }}
                />
            </Tooltip>
            <Menu
                anchorEl={anchor}
                open={!!anchor}
                onClose={(e) => { e?.stopPropagation?.(); setAnchor(null); }}
                onClick={stop}
                // A portalled menu's events still bubble through the REACT tree:
                // a DataGrid cell would take the arrow keys for its own
                // navigation. (Modal's own Escape handling runs regardless.)
                onKeyDown={stop}
                disablePortal={disablePortal}
                slotProps={{ list: { dense: true, 'aria-label': 'Pipeline status' } }}
                data-testid={`${testId}-menu`}
            >
                {PIPELINE_STATUS_VALUES.map((value) => {
                    const selected = value === status;
                    const c = pipelineStatusChipProps(value).sx;
                    return (
                        <MenuItem key={value} selected={selected}
                                  onClick={(e) => pick(e, value)}
                                  data-testid={`${testId}-option-${value}`}>
                            <Box component="span" sx={{ width: 12, height: 12, borderRadius: '50%',
                                                        bgcolor: c.bgcolor, mr: 1.25, flexShrink: 0 }} />
                            <ListItemText>{pipelineStatusLabel(value)}</ListItemText>
                            {selected && <Check fontSize="small" sx={{ ml: 1.5 }} />}
                        </MenuItem>
                    );
                })}
            </Menu>
        </>
    );
}
