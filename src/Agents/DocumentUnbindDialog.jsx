// Confirm removing one agent→document link (req #3051).
//
// Peer to InstructionUnbindDialog, and a real dialog rather than a
// `window.confirm` for the reasons that one records: `window.confirm` is
// unthemed, unstyleable, and invisible to a Playwright run that has not
// registered a handler.
//
// PARENT-OWNS-STATE: this component sets `confirmed` and closes. The page runs
// the write, through the same serialized queue as every other membership change.
//
// What this dialog has to say that the instruction one does not: whether the link
// being removed is an AUTOLOAD link. Unbinding a `referenced` document is a soft
// loss — the agent could have consulted the file and now will not think to. But
// instruction #83 orders every agent to read its `autoload` documents in full
// before starting work, so removing an autoload link silently changes what that
// agent knows at its next boot, and nothing anywhere reports it. That is the one
// consequence a user cannot see from the chip, so it is the one that gets an
// Alert.

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { isAutoload, relationshipLabel } from './agentRegistryUtils';

const DocumentUnbindDialog = ({ open, setOpen, setConfirmed, info }) => {
    // See InstructionUnbindDialog: `useConfirmDialog` clears `infoObject` in the
    // same effect pass that fires the callback, and `open` controls visibility.
    // The page holds the last real value so the closing frames have something to
    // render.
    if (!info?.document || !info?.agent) return null;

    const { document: doc, agent, link } = info;
    const autoload = isAutoload(link?.relationship);

    const cancel = () => setOpen(false);
    const confirm = () => { setConfirmed(true); setOpen(false); };

    return (
        <Dialog open={open} onClose={cancel} maxWidth="sm" fullWidth
                data-testid="documents-unbind-dialog">
            <DialogTitle>Unlink {agent.name} from “{doc.name}”?</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip size="small" variant="outlined" label={doc.name} />
                        <Chip size="small" color="error" variant="outlined"
                              label={agent.closed ? `${agent.name} (closed)` : agent.name} />
                        <Chip size="small" variant="outlined"
                              label={relationshipLabel(link?.relationship)} />
                    </Stack>

                    {autoload ? (
                        <Alert severity="warning" data-testid="documents-unbind-autoload-warning">
                            {agent.name} currently reads this file <strong>in full at every
                            boot</strong>. After this it will not, and nothing will report the
                            change — the agent simply starts work without knowledge it used to have.
                        </Alert>
                    ) : (
                        <DialogContentText>
                            {agent.name} stops referencing this document at its next boot. Nothing
                            was being loaded automatically, so no knowledge is lost.
                        </DialogContentText>
                    )}

                    <DialogContentText>
                        The document row itself survives, and every other agent linked to it keeps
                        its link. Only this one relationship is removed.
                    </DialogContentText>

                    {link?.notes && (
                        <Typography variant="body2" color="warning.main"
                                    data-testid="documents-unbind-notes-warning">
                            This link&apos;s notes are discarded with it: “{link.notes}”
                        </Typography>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={cancel} data-testid="documents-unbind-cancel-btn">Cancel</Button>
                <Button onClick={confirm} color="error" variant="contained"
                        data-testid="documents-unbind-confirm-btn">
                    Unlink
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DocumentUnbindDialog;
