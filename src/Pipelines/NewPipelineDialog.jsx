// NewPipelineDialog.jsx — create trial A (req #3773): a "New pipeline" button
// in the Pipelines page header, opening a dialog that asks for everything a
// plan row carries up front — title, goal, execution mode and machine.
//
// The button lives in the header's `actions` slot, so it is there in both the
// Cards and the Table view. Trial B is `NewPipelineCard.jsx`; both write
// through `useCreatePipeline`.

import { useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';

import { executionModeLabel } from '../SwarmView/pipelines/pipelineChipStyles';
import useCreatePipeline from './useCreatePipeline';

// `''` is the Machine select's "Any" — a MUI select cannot hold a null value.
const ANY_MACHINE = '';

export default function NewPipelineDialog({ machines = [] }) {
    const { create, creating } = useCreatePipeline();
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [executionMode, setExecutionMode] = useState('parallel');
    const [machineFk, setMachineFk] = useState(ANY_MACHINE);

    // A double-click on the button lands its second click on the backdrop,
    // which would close the dialog again at once (EmptyPlanAddEpic's guard).
    const openedAtRef = useRef(0);
    const openDialog = () => {
        openedAtRef.current = Date.now();
        setTitle('');
        setDescription('');
        setExecutionMode('parallel');
        setMachineFk(ANY_MACHINE);
        setOpen(true);
    };
    const close = (_event, reason) => {
        if (reason === 'backdropClick' && Date.now() - openedAtRef.current < 600) return;
        if (!creating) setOpen(false);
    };

    const commit = async () => {
        const done = await create({
            title,
            description,
            execution_mode: executionMode,
            machine_fk: machineFk === ANY_MACHINE ? null : machineFk,
        });
        if (done) setOpen(false);
    };

    return (
        <>
            <Button variant="contained" size="small" startIcon={<AddIcon />}
                    onClick={openDialog} sx={{ flexShrink: 0 }}
                    data-testid="pipelines-new-button">
                New pipeline
            </Button>

            <Dialog open={open} onClose={close} fullWidth maxWidth="sm"
                    data-testid="pipelines-new-dialog">
                <DialogTitle>New pipeline</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField autoFocus fullWidth size="small" label="Title" required
                                   value={title}
                                   onChange={(e) => setTitle(e.target.value)}
                                   onKeyDown={(e) => {
                                       if (e.key === 'Enter') { e.preventDefault(); commit(); }
                                   }}
                                   inputProps={{ 'data-testid': 'pipelines-new-title' }} />
                        <TextField fullWidth size="small" label="Goal" multiline minRows={3}
                                   value={description}
                                   placeholder="Why this plan exists and what it must achieve"
                                   onChange={(e) => setDescription(e.target.value)}
                                   inputProps={{ 'data-testid': 'pipelines-new-description' }} />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2,
                                   flexWrap: 'wrap' }}>
                            <Box>
                                <Typography variant="caption" color="text.secondary"
                                            component="div" sx={{ mb: 0.5 }}>
                                    Execution
                                </Typography>
                                <ToggleButtonGroup size="small" exclusive value={executionMode}
                                                   onChange={(_e, v) => { if (v) setExecutionMode(v); }}
                                                   data-testid="pipelines-new-execmode">
                                    {['parallel', 'serial'].map((mode) => (
                                        <ToggleButton key={mode} value={mode}
                                                      aria-label={executionModeLabel(mode)}
                                                      data-testid={`pipelines-new-execmode-${mode}`}>
                                            {executionModeLabel(mode)}
                                        </ToggleButton>
                                    ))}
                                </ToggleButtonGroup>
                            </Box>
                            <TextField select size="small" label="Machine" value={machineFk}
                                       onChange={(e) => setMachineFk(e.target.value)}
                                       sx={{ minWidth: 200, flex: 1, mt: 2.5 }}
                                       inputProps={{ 'data-testid': 'pipelines-new-machine' }}>
                                <MenuItem value={ANY_MACHINE}>Any</MenuItem>
                                {machines.filter((m) => !m.closed).map((m) => (
                                    <MenuItem key={m.id} value={m.id}>{m.title || `Machine ${m.id}`}</MenuItem>
                                ))}
                            </TextField>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                            The pipeline starts as a draft and opens on its plan, where you add
                            its first initiative and epic.
                        </Typography>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)} disabled={creating}>Cancel</Button>
                    <Button variant="contained" onClick={commit}
                            disabled={creating || !title.trim()}
                            data-testid="pipelines-new-create">
                        {creating ? 'Creating…' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
