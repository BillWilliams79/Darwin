// Confirm unbinding one instruction from one agent (req #3063).
//
// Replaces a `window.confirm`. That was flagged twice — by the code reviewer, and
// then by the user — and both were right: it is the only confirmation on this page
// that did not look like Darwin. It is unthemed, unstyleable, invisible to a
// Playwright run that has not registered a dialog handler, and it sat two files
// away from InstructionDeleteDialog, whose own header explains at length why a
// real dialog beats `window.confirm` for exactly this class of action.
//
// ONE DIALOG, BOTH DIRECTIONS (req #3071). InstructionsPage unbinds by clicking an
// agent chip on an instruction row; AgentDetail unbinds by clicking the link-off
// icon on an instruction card. Those are the SAME DELETE of the SAME
// `agent_instructions` row, approached from either end of it, and #3063 left them
// inconsistent only because the agent-side one did not exist yet.
//
// So the copy here is deliberately DIRECTION-NEUTRAL — it names the agent, names
// the instruction, and states the slot consequence, none of which depends on which
// page you arrived from. Two components would have meant two places to keep that
// wording true; the agent-side `window.confirm` this replaced had already drifted
// (it never mentioned the slot at all). The caller supplies both halves of the
// pair, so neither page is privileged.
//
// PARENT-OWNS-STATE, the house pattern (see the `frontend-*` template-row
// instruction, and TaskDeleteDialog / RecurringDeleteDialog): this component holds
// NO action logic. It sets `confirmed = true` and closes; `useConfirmDialog`'s
// effect in the parent then runs the unbind. Keeping the write in the parent is
// what lets the page own the pessimistic-write queue and the error resync.
//
// WHY THE SLOT NUMBER IS IN THE COPY. Unbinding is not symmetrical with
// rebinding: the junction row is deleted, and a later rebind appends at max+1
// rather than restoring this position. The registry uses BANDED slots — per-agent
// rules at 1..N, the shared common-* rows together at 100+ — so a rebind can
// silently move a row out of its band. That is the one consequence a user cannot
// see from the card, so it is the one this dialog must state.

import { useRef } from 'react';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';

const InstructionUnbindDialog = ({
    open, setOpen, setConfirmed, instruction, agent,
}) => {
    /**
     * `useConfirmDialog` resets `infoObject` to its default in the SAME effect pass
     * that fires the confirm callback, so both props go undefined the instant the
     * user clicks Unbind. Returning null there would rip the dialog out mid-close
     * and skip its exit transition. Hold the last real pair so the closing frames
     * still have something to render; `open` is what actually controls visibility.
     *
     * There is deliberately no `busy` state. The write starts AFTER this dialog has
     * already closed, so a spinner here could never be seen — the earlier
     * `busy`-disabled buttons and `Working…` label were unreachable code. Progress
     * belongs on the card, where the chip row shows it.
     */
    const lastShown = useRef(null);
    if (instruction && agent) lastShown.current = { instruction, agent };
    const shown = (instruction && agent) ? { instruction, agent } : lastShown.current;
    if (!shown) return null;

    const { instruction: row, agent: target } = shown;
    const slot = target.slot;

    const cancel = () => setOpen(false);

    const confirm = () => {
        setConfirmed(true);
        setOpen(false);
    };

    return (
        <Dialog open={open} onClose={cancel} maxWidth="sm" fullWidth
                data-testid="instruction-unbind-dialog">
            <DialogTitle>Unbind from {target.name}?</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <DialogContentText>
                        {target.name} stops loading this instruction at its next boot. A session
                        already running keeps it until then.
                    </DialogContentText>

                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip size="small" variant="outlined" label={row.name} />
                        <Chip size="small" color="error" variant="outlined"
                              label={target.closed ? `${target.name} (closed)` : target.name} />
                    </Stack>

                    <DialogContentText>
                        The instruction row itself survives, and every other agent bound to it keeps
                        it. Only this one binding is removed.
                    </DialogContentText>

                    {Number.isFinite(slot) && (
                        <Alert severity="warning" data-testid="instruction-unbind-slot-warning">
                            Rebinding later appends it to the <strong>end</strong> of {target.name}
                            &apos;s load order — slot #{slot} is not restored.
                        </Alert>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={cancel}
                        data-testid="instruction-unbind-cancel-btn">Cancel</Button>
                <Button onClick={confirm} color="error" variant="contained"
                        data-testid="instruction-unbind-confirm-btn">
                    Unbind
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default InstructionUnbindDialog;
