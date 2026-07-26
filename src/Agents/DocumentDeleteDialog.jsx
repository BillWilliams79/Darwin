// Close or delete one document REGISTRATION (req #3051).
//
// Modelled on InstructionDeleteDialog, which had already solved most of this
// problem. Two things are genuinely different, and both are in the copy:
//
// 1. THIS DOES NOT DELETE A FILE, and that is the likeliest misconception on the
//    page. `architecture_documents` stores a `location`, never content. Deleting
//    the row leaves the file sitting on disk, fully intact — and nothing anywhere
//    scans disk for unregistered files, so it becomes a file the registry will
//    never notice again. That is precisely the silent ownership drift the registry
//    was built to end, reintroduced by a delete button. The first line of the body
//    says so before anything else.
//
// 2. THE OWNERSHIP ASSIGNMENT IS THE UNRECOVERABLE PART. `agent_documents`
//    CASCADEs on `document_fk` (and it is the only table with an FK to
//    `architecture_documents`, so the cascade is exactly the link set). Everything
//    else about the row can be retyped from the file itself; who was responsible
//    for it cannot. It exists nowhere else.
//
// TWO COUNTS, and they are a DIFFERENT pair from the instruction dialog's:
//   * dataCount — every link. Junction rows destroyed, `notes` with them.
//   * bootCount — open agents holding an AUTOLOAD link. Those are the agents that
//     will boot without a document instruction #83 orders them to read in full.
//     A `referenced` link going away is a soft loss; an `autoload` one is not.
// Collapsing them would either understate the data loss or overstate the runtime
// impact.
//
// Close is the primary path. It has the identical effect at boot — closed
// documents drop out of every payload — but preserves the row and every link, so
// it is reversible. Delete is for mistakes.

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

const DocumentDeleteDialog = ({
    open, onClose, onCloseDocument, onReopen, onDelete,
    document: doc,
    // [{ name, closed, autoload, owner }] — every linked agent, closed included.
    linkedAgents = [],
    busy = false,
    // WHY the caller opened this: 'close' arrives from the Close menu item on a
    // linked row, where the blast radius must be shown before the document drops
    // out of those agents' payloads. A dialog titled "Delete …?" opened from a
    // menu item labelled "Close document…" would be a lie.
    intent = 'delete',
}) => {
    const [typed, setTyped] = useState('');

    useEffect(() => { if (open) setTyped(''); }, [open, doc?.id]);

    if (!doc) return null;

    const dataCount = linkedAgents.length;
    const bootCount = linkedAgents.filter(a => !a.closed && a.autoload).length;
    const owner = linkedAgents.find(a => a.owner);

    // Gated more tightly than the instruction dialog's `refCount >= 2`, because
    // an autoload link is a silent runtime change on its own — one is enough.
    const needsChallenge = dataCount >= 2 || bootCount >= 1;
    const deleteEnabled = !busy && (!needsChallenge || typed.trim() === doc.name);

    return (
        <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="sm" fullWidth
                data-testid="documents-delete-dialog">
            <DialogTitle>
                {doc.closed
                    ? `Reopen or delete the registration of “${doc.name}”?`
                    : intent === 'close'
                        ? `Close “${doc.name}”?`
                        : `Delete the registration of “${doc.name}”?`}
            </DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {/* First, before anything else. */}
                    <Alert severity="info" data-testid="documents-delete-file-note">
                        This removes the registry row, <strong>not the file</strong>.
                        {doc.location ? <> <code>{doc.location}</code> stays on disk</> : ' The file stays on disk'}
                        {' '}and nothing will record who owns it. Nothing scans disk for
                        unregistered files, so it becomes invisible to the registry.
                    </Alert>

                    {!!doc.closed && (
                        <Alert severity="info" data-testid="documents-delete-closed-note">
                            This document is closed, so it already drops out of every boot payload.
                            Reopening it restores it for {dataCount === 0
                                ? 'any agent linked to it'
                                : `${dataCount} linked agent${dataCount === 1 ? '' : 's'}`} at their
                            next boot.
                        </Alert>
                    )}

                    {dataCount > 0 ? (
                        <>
                            <Alert severity="error">
                                {dataCount} agent link{dataCount === 1 ? '' : 's'} cascade away
                                permanently, with their notes and no trace.
                                {owner
                                    ? ` That includes the ownership assignment held by ${owner.name}, which exists nowhere else.`
                                    : ' This document has no owner to lose.'}
                                {bootCount > 0
                                    ? ` ${bootCount} open agent${bootCount === 1 ? '' : 's'} read${bootCount === 1 ? 's' : ''} this file in full at boot and would silently stop.`
                                    : ' No open agent reads it at boot, so nothing changes at boot today.'}
                            </Alert>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {linkedAgents.map(a => (
                                    <Chip key={a.name} size="small" color="error"
                                          variant={a.owner ? 'filled' : 'outlined'}
                                          label={[
                                              a.name,
                                              a.owner && 'owner',
                                              a.autoload && 'autoload',
                                              a.closed && 'closed',
                                          ].filter(Boolean).join(' · ')} />
                                ))}
                            </Stack>
                            <Typography variant="body2">
                                <strong>Closing</strong> it instead has the same effect at boot —
                                closed documents drop out of every payload — but keeps the row and
                                every link, so it can be reopened.
                            </Typography>
                        </>
                    ) : (
                        <Typography variant="body2">
                            No agent links this document, so deleting the registration affects
                            nothing at boot.
                        </Typography>
                    )}

                    {needsChallenge && (
                        <TextField
                            label={`Type "${doc.name}" to confirm deletion`}
                            value={typed}
                            onChange={e => setTyped(e.target.value)}
                            size="small"
                            inputProps={{
                                style: { fontFamily: 'monospace' },
                                'data-testid': 'document-delete-challenge-input',
                            }}
                        />
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}
                        data-testid="document-delete-cancel-btn">Cancel</Button>
                {doc.closed ? (
                    <Button onClick={onReopen} variant="contained" disabled={busy}
                            data-testid="document-delete-reopen-btn">
                        Reopen
                    </Button>
                ) : (
                    <Button onClick={onCloseDocument} variant="contained" disabled={busy}
                            data-testid="document-delete-close-btn">
                        {/* "instead" only makes sense when the user arrived wanting
                            to delete. Coming from the Close menu item, this IS the
                            action they asked for. */}
                        {intent === 'close' || dataCount === 0 ? 'Close' : 'Close instead'}
                    </Button>
                )}
                <Button onClick={onDelete} color="error" disabled={!deleteEnabled}
                        data-testid="document-delete-confirm-btn">
                    {busy ? 'Working…' : 'Delete permanently'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DocumentDeleteDialog;
