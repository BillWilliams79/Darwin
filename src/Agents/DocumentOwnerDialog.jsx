// Confirm an ownership change on one document — transfer or release (req #3051).
//
// This dialog exists because the user is authorizing a NON-ATOMIC SEQUENCE, and
// the sequence is forced. `uq_agent_documents_owner` is a UNIQUE key over a
// virtual column that equals `document_fk` exactly when the relationship SET
// contains `owned`, so the incoming claim is rejected while the incumbent still
// holds it. Release must come first. There is no ordering that avoids a window in
// which the document is unowned — only its length and its recoverability are in
// our control, and the honest thing is to say so before the user commits rather
// than after it goes wrong.
//
// PARENT-OWNS-STATE, the house pattern (InstructionUnbindDialog, TaskDeleteDialog,
// RecurringDeleteDialog): this component holds no action logic. It sets
// `confirmed` and closes; `useConfirmDialog`'s effect in the page runs the plan.
// Keeping the write in the page is what lets it own the serialized membership
// queue and the error resync.
//
// WHY OWNERSHIP CAN BE RELEASED AT ALL, with no successor. Three reasons, and the
// first one settles it: the state already exists in the data — document #69
// `memory/pipeline-plan-tracking.md` carries only `referenced` links and is
// genuinely unowned. A UI that cannot reach a state it must render cannot round-
// trip its own data. Second, every transfer passes through the unowned state
// anyway, so it is structurally reachable. Third, and this is the registry's
// whole thesis: it exists to make unowned documents VISIBLE, not impossible.
// Ownership that lived only in prose "drifted silently and nobody notices"
// (agents-registry.md) — the red chip and the accounting line are the mechanism.
// Forbidding the state would only push people into naming a fake owner, which is
// drift again, wearing a badge.

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

import { parseRoles, relationshipLabel } from './agentRegistryUtils';

const DocumentOwnerDialog = ({
    open, setOpen, setConfirmed,
    info,                       // { document, fromAgent, fromLink, toAgent, toLink }
    keepOutgoing, setKeepOutgoing,
}) => {
    // `useConfirmDialog` resets `infoObject` to its default in the SAME effect
    // pass that fires the confirm callback, so `info` goes empty the instant the
    // user clicks. `open` is what controls visibility; rendering null here would
    // rip the dialog out mid-close and skip its exit transition. The page holds
    // the last real value for us — see `lastOwnerInfo` there.
    if (!info?.document) return null;

    const { document: doc, fromAgent, fromLink, toAgent, toLink } = info;
    const isTransfer = !!toAgent;

    // Does the outgoing owner's link survive on its own roles? An `owned,autoload`
    // owner becomes plain `autoload` and the question does not arise. An
    // owner-ONLY link has nothing left, and then the choice below is real: park it
    // at `referenced`, or drop it. Parking is the default because the link's
    // `notes` die with it, and 87 of the 100 live links carry one.
    const outgoingRemaining = fromLink
        ? parseRoles(fromLink.relationship).filter(r => r !== 'owned')
        : [];
    const outgoingWouldVanish = !!fromLink && outgoingRemaining.length === 0;

    // Claiming ownership never adds `autoload` on its own — `planOwnerTransfer`
    // merges only `owned` into whatever the incoming agent already had. So the
    // only autoload fact worth stating is whether it ALREADY reads the file.
    const incomingAutoloads = toLink
        ? parseRoles(toLink.relationship).includes('autoload')
        : false;

    const cancel = () => setOpen(false);
    const confirm = () => { setConfirmed(true); setOpen(false); };

    return (
        <Dialog open={open} onClose={cancel} maxWidth="sm" fullWidth
                data-testid="documents-owner-dialog">
            <DialogTitle>
                {isTransfer
                    ? `Transfer ownership of “${doc.name}”?`
                    : `Release ownership of “${doc.name}”?`}
            </DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip size="small" color="primary" variant="filled"
                              label={fromAgent?.name || 'unowned'} />
                        <ArrowForwardIcon fontSize="small" sx={{ opacity: 0.6 }} />
                        {isTransfer
                            ? <Chip size="small" color="primary" variant="outlined"
                                    label={toAgent.name} />
                            : <Chip size="small" color="error" variant="outlined" label="unowned" />}
                    </Stack>

                    {/* The mechanism, stated plainly. The user is not authorizing
                        "make B the owner" — they are authorizing two writes that
                        cannot be reordered and are not a transaction. */}
                    <Alert severity="warning" data-testid="documents-owner-window-warning">
                        {isTransfer ? (
                            <>
                                This is <strong>two writes</strong>: {fromAgent?.name} is released
                                first, then {toAgent.name} claims it. The database allows only one
                                owner per document, so the order cannot be reversed. If the second
                                write fails, the document is left <strong>unowned</strong> and this
                                card will say so in red.
                            </>
                        ) : (
                            <>
                                No agent will be the named responsible party for this file. Unowned
                                documents are exactly what this registry exists to surface — it will
                                show in red until someone claims it.
                            </>
                        )}
                    </Alert>

                    {fromLink && !outgoingWouldVanish && (
                        <DialogContentText>
                            {fromAgent?.name} keeps its other role
                            {outgoingRemaining.length === 1 ? '' : 's'} on this document
                            (<strong>{outgoingRemaining.join(', ')}</strong>)
                            {outgoingRemaining.includes('autoload')
                                ? ' — it still reads the file in full at every boot.'
                                : '.'}
                        </DialogContentText>
                    )}

                    {outgoingWouldVanish && (
                        <FormControl>
                            <FormLabel sx={{ fontSize: '0.875rem' }}>
                                {fromAgent?.name} has no other role on this document
                            </FormLabel>
                            <RadioGroup
                                value={keepOutgoing ? 'keep' : 'remove'}
                                onChange={(e) => setKeepOutgoing(e.target.value === 'keep')}
                            >
                                <FormControlLabel
                                    value="keep"
                                    control={<Radio size="small"
                                                    inputProps={{ 'data-testid': 'documents-owner-keep' }} />}
                                    label={`Keep ${fromAgent?.name} linked as referenced`}
                                />
                                <FormControlLabel
                                    value="remove"
                                    control={<Radio size="small"
                                                    inputProps={{ 'data-testid': 'documents-owner-remove' }} />}
                                    label="Remove the link entirely"
                                />
                            </RadioGroup>
                            {!keepOutgoing && fromLink?.notes && (
                                <Typography variant="caption" color="warning.main">
                                    Removing it also discards this link&apos;s notes:
                                    “{fromLink.notes}”
                                </Typography>
                            )}
                        </FormControl>
                    )}

                    {isTransfer && toLink && (
                        <DialogContentText>
                            {toAgent.name} already links this document as{' '}
                            <strong>{relationshipLabel(toLink.relationship)}</strong>; ownership is
                            added to what it has, and its notes are kept.
                            {incomingAutoloads
                                ? ' It already reads the file in full at boot.'
                                : ' It does not read the file at boot — add autoload afterwards if it should.'}
                        </DialogContentText>
                    )}

                    {isTransfer && !toLink && (
                        <DialogContentText>
                            {toAgent.name} has no link to this document yet, so a new one is created
                            carrying <strong>owned</strong>. Add <code>autoload</code> afterwards if
                            it should read the file at boot.
                        </DialogContentText>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={cancel} data-testid="documents-owner-cancel-btn">Cancel</Button>
                <Button onClick={confirm} variant="contained"
                        color={isTransfer ? 'primary' : 'error'}
                        data-testid="documents-owner-confirm-btn">
                    {isTransfer ? 'Transfer ownership' : 'Release ownership'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DocumentOwnerDialog;
