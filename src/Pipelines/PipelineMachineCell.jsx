// PipelineMachineCell.jsx — the Table view's Machine column as an in-place
// control (req #4170): the machine's name, a click on it opens the same list
// the Cards view's card menu offers ("Any" plus every open machine), and a pick
// writes it. `onPick(machineFk | null)` resolves true when the write landed.
// A locked plan takes no authoring write (the gateway answers 423), so the
// control is read-only there, as the card's menu item is disabled.

import { useState } from 'react';

import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import Check from '@mui/icons-material/Check';
import Box from '@mui/material/Box';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';

import GhostCell from '../Components/GhostField/GhostCell';
import { machineTitle } from '../SwarmView/pipelines/pipelineViewModel';

export default function PipelineMachineCell({ row, machines, locked, onPick }) {
    const [anchor, setAnchor] = useState(null);
    const [saving, setSaving] = useState(false);
    const options = [{ id: null, title: 'Any' },
        ...(machines || []).filter((m) => !m.closed || m.id === row.machine_fk)];
    const label = machineTitle(row.machine_fk, machines);
    const off = locked || saving;

    const pick = async (machineFk) => {
        setAnchor(null);
        if ((row.machine_fk ?? null) === machineFk) return;
        setSaving(true);
        try {
            await onPick(machineFk);
        } finally {
            setSaving(false);
        }
    };

    return (
        <GhostCell>
            <Tooltip title={locked ? 'Locked — unlock to change the machine' : 'Machine — click to change'}>
                <Box
                    component="span"
                    role="button"
                    tabIndex={off ? -1 : 0}
                    aria-haspopup="menu"
                    aria-disabled={off}
                    onClick={(e) => { e.stopPropagation(); if (!off) setAnchor(e.currentTarget); }}
                    onKeyDown={(e) => {
                        if (off || (e.key !== 'Enter' && e.key !== ' ')) return;
                        e.preventDefault();
                        setAnchor(e.currentTarget);
                    }}
                    data-testid={`pipelines-machine-${row.id}`}
                    sx={{
                        display: 'inline-flex', alignItems: 'center', maxWidth: '100%',
                        borderRadius: 0.5, pl: 0.5, opacity: saving ? 0.6 : 1,
                        cursor: off ? 'default' : 'pointer',
                        ...(!off && { '&:hover': { bgcolor: 'action.hover' } }),
                    }}
                >
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label}
                    </Box>
                    {!off && <ArrowDropDownIcon fontSize="small" sx={{ opacity: 0.6, flexShrink: 0 }} />}
                </Box>
            </Tooltip>
            <Menu anchorEl={anchor} open={!!anchor}
                  onClose={(e) => { e?.stopPropagation?.(); setAnchor(null); }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  slotProps={{ list: { dense: true, 'aria-label': 'Machine' } }}>
                {options.map((m) => {
                    const selected = (row.machine_fk ?? null) === m.id;
                    return (
                        <MenuItem key={m.id ?? 'any'} selected={selected}
                                  onClick={(e) => { e.stopPropagation(); pick(m.id); }}
                                  data-testid={`pipelines-machine-option-${row.id}-${m.id ?? 'any'}`}>
                            <ListItemText>{m.title || `Machine ${m.id}`}</ListItemText>
                            {selected && <Check fontSize="small" sx={{ ml: 1 }} />}
                        </MenuItem>
                    );
                })}
            </Menu>
        </GhostCell>
    );
}
