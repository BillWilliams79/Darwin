// Confirm deleting one agent-context telemetry capture (req #3071).
//
// Replaces the last `window.confirm` under /agents. Of the two this requirement
// retired, this is the one that deserved a real dialog most: unbinding an
// instruction is reversible by rebinding it, and this is not reversible at all.
//
// WHY A CAPTURE CANNOT BE RE-CREATED. A run is not a saved view of live data — it
// is a MEASUREMENT. `/agent-telemetry-run` produces one by launching a
// load-and-stop probe per agent and reading actual token deltas out of each
// transcript, against whatever harness, CLAUDE.md, charter stubs and autoload
// documents existed that day. Re-running it later is a new measurement of a
// different system; it cannot reproduce the numbers in this row. `window.confirm`'s
// "This cannot be undone" said the words without ever saying why, and the why is
// the whole reason to hesitate.
//
// WHAT ELSE GOES. `agent_telemetry_rows.run_fk` is ON DELETE CASCADE (migration
// 069), so the per-agent rows are deleted server-side with the header. The picker
// shows a capture as ONE line, so its size — the thing actually being destroyed —
// is invisible until this dialog states it.
//
// PARENT-OWNS-STATE, the house pattern (see InstructionUnbindDialog, TaskDeleteDialog,
// RecurringDeleteDialog): this component holds NO action logic. It sets
// `confirmed = true` and closes; `useConfirmDialog`'s effect in the parent then runs
// the delete, the selection fix-up and the cache invalidation.

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

/**
 * `run` and `rowCount` describe the capture being deleted, so they arrive in the
 * confirm payload and are SNAPSHOTTED — they must not follow the picker.
 *
 * `remainingCount` is the opposite: it describes the LIST, which is live behind
 * the dialog. A capture arriving from another session (or from
 * `/agent-telemetry-run` finishing) while this is open would leave a snapshotted
 * count asserting "this is the only capture" after it had stopped being true. So
 * it is passed as an ordinary prop, read at render — but only WHILE OPEN. Once the
 * user has confirmed, the delete and its refetch routinely beat MUI's ~195ms fade,
 * and a still-live count would rewrite the closing dialog to describe the world
 * AFTER the decision — growing or dropping the last-capture line in a dialog that
 * asked a question about the world BEFORE it. Live while it is still a question,
 * frozen once it is an answer.
 */
const TelemetryRunDeleteDialog = ({
    open, setOpen, setConfirmed, run, rowCount, remainingCount,
}) => {
    /**
     * `useConfirmDialog` resets `infoObject` to its default in the SAME effect pass
     * that fires the confirm callback, so `run` goes undefined the instant the user
     * clicks Delete. Returning null there would rip the dialog out mid-close and
     * skip its exit transition. Hold the last real payload so the closing frames
     * still have something to render; `open` is what controls visibility.
     *
     * There is deliberately no `busy` state, for the same reason as
     * InstructionUnbindDialog: the write starts AFTER this dialog has closed, so a
     * spinner here could never be seen. Progress shows on the page's delete button.
     */
    const lastShown = useRef(null);
    if (run) lastShown.current = { run, rowCount };
    const shown = run ? { run, rowCount } : lastShown.current;

    // Tracked separately from `lastShown` because it is latched on a different
    // event: `lastShown` freezes when the PAYLOAD clears (at confirm), this one
    // when the dialog CLOSES. They coincide on confirm and diverge on cancel.
    const lastRemaining = useRef(null);
    if (open) lastRemaining.current = remainingCount;

    if (!shown) return null;

    const { run: target } = shown;
    const capturedOn = target.captured_at ? String(target.captured_at).slice(0, 10) : null;
    const rows = Number.isFinite(shown.rowCount) ? shown.rowCount : null;
    const liveRemaining = open ? remainingCount : lastRemaining.current;
    const remaining = Number.isFinite(liveRemaining) ? liveRemaining : null;

    const cancel = () => setOpen(false);

    const confirm = () => {
        setConfirmed(true);
        setOpen(false);
    };

    return (
        <Dialog open={open} onClose={cancel} maxWidth="sm" fullWidth
                data-testid="telemetry-run-delete-dialog">
            <DialogTitle>Delete this capture?</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip size="small" color="error" variant="outlined"
                              label={target.label || `Capture #${target.id}`} />
                        {capturedOn && (
                            <Chip size="small" variant="outlined" label={capturedOn} />
                        )}
                        {target.harness_version && (
                            <Chip size="small" variant="outlined"
                                  label={`harness ${target.harness_version}`} />
                        )}
                    </Stack>

                    {/* Zero is a real state, not a missing count: the run header and
                        its rows are stored by separate MCP calls, so an aborted
                        capture leaves a header with nothing under it. Sending it
                        through the numeric branch would read "All 0 rows … are
                        deleted with it", which is both odd and beside the point —
                        what is being deleted there is the header. */}
                    <DialogContentText data-testid="telemetry-run-delete-rows">
                        {rows === null
                            ? 'Every per-agent measurement row in this capture is deleted with it.'
                            : rows === 0
                                ? 'It holds no per-agent measurement rows — only the capture '
                                  + 'header is deleted.'
                                : `All ${rows} per-agent measurement row${rows === 1 ? '' : 's'} `
                                  + 'in this capture are deleted with it.'}
                    </DialogContentText>

                    {/* The irreversibility that matters, stated as the reason rather
                        than the slogan: this is a measurement of a system that has
                        since moved on, not a view that can be rebuilt. */}
                    <Alert severity="error" data-testid="telemetry-run-delete-warning">
                        This cannot be undone. A capture measures the agent harness as it stood
                        {capturedOn ? ` on ${capturedOn}` : ' when it was taken'} — re-running{' '}
                        <code>/agent-telemetry-run</code> records today&apos;s numbers, not these.
                    </Alert>

                    {remaining === 0 && (
                        <DialogContentText data-testid="telemetry-run-delete-last">
                            It is the only capture stored. This page will be empty until another
                            one is taken.
                        </DialogContentText>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={cancel}
                        data-testid="telemetry-run-delete-cancel-btn">Cancel</Button>
                <Button onClick={confirm} color="error" variant="contained"
                        data-testid="telemetry-run-delete-confirm-btn">
                    Delete
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TelemetryRunDeleteDialog;
