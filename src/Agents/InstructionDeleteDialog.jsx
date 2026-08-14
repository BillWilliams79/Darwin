// Retire or delete one instruction (req #3049).
//
// A dedicated dialog rather than window.confirm — a deliberate departure from the
// `TestCatalog/actions/validationApi.js` exemplar — because `agent_instructions`
// CASCADEs on both foreign keys.
// A hard delete silently strips the instruction from every agent that bound it,
// and window.confirm cannot render WHICH agents those are. Seeing the list is the
// whole guardrail.
//
// Close is presented as the primary path: it has the same runtime effect (closed
// rows drop out of the boot payload) but preserves the row and all its links, so
// it is reversible. Delete is for mistakes.
//
// Req #3063 made this dialog the ONLY retire path. The edit-in-place card
// deliberately has no closed switch: closing is not a text edit, and a bare
// switch on a card is a one-click way to silently unload an instruction from
// every architect that binds it — which is the exact outcome this dialog exists
// to make visible. So Close is offered whenever the row is open (it used to be
// gated on the row having bindings, which left an unbound row with no retire path
// once the dialog's switch went away), and Reopen is offered when it is closed.

import { useEffect, useState } from 'react';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

const InstructionDeleteDialog = ({
    open, onClose, onClose_Instruction, onReopen, onDelete, instruction,
    boundAgents = [], busy = false,
    // WHY the caller opened this. The card's options menu can arrive here wanting
    // to CLOSE a bound row (the blast radius must be shown before it is unloaded
    // from those agents) rather than to delete it — and a dialog titled
    // "Delete …?" opened from a menu item labelled "Close instruction…" is a lie.
    intent = 'delete',
}) => {
    const [typed, setTyped] = useState('');

    useEffect(() => { if (open) setTyped(''); }, [open, instruction?.id]);

    if (!instruction) return null;

    // Two different counts, deliberately. `refCount` is DATA destroyed — every
    // junction row cascades away, whether or not its agent is closed. `bootCount`
    // is RUNTIME impact — only open agents boot. Collapsing them would either
    // understate the data loss or overstate what stops loading.
    const refCount = boundAgents.length;
    const bootCount = boundAgents.filter(a => !a.closed).length;
    // A typed-name challenge is reserved for shared rows. Requiring it everywhere
    // would train people to type past it; requiring it on a row that a dozen
    // architects load is proportionate.
    const needsChallenge = refCount >= 2;
    const deleteEnabled = !busy && (!needsChallenge || typed.trim() === instruction.name);

    return (
        <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="sm" fullWidth
                data-testid="instruction-delete-dialog">
            <DialogTitle>
                {instruction.closed
                    ? `Reopen or delete “${instruction.name}”?`
                    : intent === 'close'
                        ? `Close “${instruction.name}”?`
                        : `Delete “${instruction.name}”?`}
            </DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {instruction.closed && (
                        <Alert severity="info" data-testid="instruction-delete-closed-note">
                            This instruction is closed, so it drops out of every boot payload today.
                            Reopening it restores the duty for {bootCount === 0
                                ? 'any agent bound to it'
                                : `${bootCount} open agent${bootCount === 1 ? '' : 's'}`} at their
                            next boot.
                        </Alert>
                    )}

                    {refCount > 0 ? (
                        <>
                            <Alert severity="error">
                                This instruction is bound to {refCount} agent{refCount === 1 ? '' : 's'}.
                                Deleting it removes those bindings permanently — the junction rows
                                cascade away with no trace.
                                {bootCount > 0
                                    ? ` ${bootCount} of them load it at boot today and would silently lose the duty.`
                                    : ' None of them are open, so nothing changes at boot — but reopening any of them would silently lose the duty.'}
                            </Alert>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {boundAgents.map(a => (
                                    <Chip key={a.name} size="small" color="error" variant="outlined"
                                          label={a.closed ? `${a.name} (closed)` : a.name} />
                                ))}
                            </Stack>
                            <Typography variant="body2">
                                <strong>Closing</strong> it instead has the same effect at boot —
                                closed rows drop out of every payload — but keeps the row and every
                                binding, so it can be reopened.
                            </Typography>
                        </>
                    ) : (
                        <Typography variant="body2">
                            No agent is bound to this instruction, so deleting it affects nothing
                            at boot.
                        </Typography>
                    )}

                    {needsChallenge && (
                        <TextField
                            label={`Type "${instruction.name}" to confirm deletion`}
                            value={typed}
                            onChange={e => setTyped(e.target.value)}
                            size="small"
                            inputProps={{
                                style: { fontFamily: 'monospace' },
                                'data-testid': 'instruction-delete-challenge-input',
                            }}
                        />
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}
                        data-testid="instruction-delete-cancel-btn">Cancel</Button>
                {instruction.closed ? (
                    <Button onClick={onReopen} variant="contained" disabled={busy}
                            data-testid="instruction-delete-reopen-btn">
                        Reopen
                    </Button>
                ) : (
                    <Button onClick={onClose_Instruction} variant="contained" disabled={busy}
                            data-testid="instruction-delete-close-btn">
                        {/* "instead" only makes sense when the user arrived wanting
                            to delete. Coming from the Close menu item, this IS the
                            action they asked for. */}
                        {intent === 'close' || refCount === 0 ? 'Close' : 'Close instead'}
                    </Button>
                )}
                <Button onClick={onDelete} color="error" disabled={!deleteEnabled}
                        data-testid="instruction-delete-confirm-btn">
                    {busy ? 'Working…' : 'Delete permanently'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default InstructionDeleteDialog;
