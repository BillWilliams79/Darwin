// Confirm changing a document's `location` when agents read it at boot (req #3051).
//
// WHY THIS FIELD, AND ONLY THIS FIELD, GETS A DIALOG.
//
// `location` looks like a caption and is the most dangerous editable value on the
// page. It is not read by any code — it is read by the AGENT. Instruction #83,
// bound to all twelve architects, orders each of them to read every `autoload`
// document "from its `location` in full, byte 1 to byte n" before starting work.
// The executor is an LLM, not a function, so nothing type-checks the path and
// nothing fails loudly: an agent handed a wrong location boots without knowledge
// it was told to have and reports itself green. The only detector in the system
// is the context-telemetry harness, and that walks `autoload_documents` only.
//
// Contrast `name`, which LOOKS like the load-bearing one because it is UNIQUE and
// documented as "the idempotent-seed key". It is not: there is no seed script in
// the repo (verified — nothing under `scripts/` references either document
// table), and `get_architecture_document_by_name` has no caller outside the MCP
// test suite. A rename is prose, exactly as req #3068 found for instruction
// names. So the intuition about which of the two fields is risky is backwards,
// and the UI corrects for it here rather than treating both as ordinary text.
//
// The dialog is GRADUATED, not unconditional: a document no agent autoloads has
// no boot to break, and ceremony with nothing to disclose trains people to click
// past ceremony that does. The page checks for autoload readers before opening
// this at all.
//
// The browser cannot verify the path exists — it has no filesystem. So this
// dialog does not pretend to validate. It names who is affected and says plainly
// that nothing checks the value, which is the honest disclosure.

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

const pathSx = {
    fontFamily: 'monospace',
    fontSize: '0.8125rem',
    wordBreak: 'break-all',
};

const DocumentLocationDialog = ({ open, setOpen, setConfirmed, info }) => {
    // Same closing-frame guard as the other dialogs here — see
    // InstructionUnbindDialog's note. The page holds the last real value.
    if (!info?.document) return null;

    const { document: doc, next, readers = [] } = info;

    const cancel = () => setOpen(false);
    const confirm = () => { setConfirmed(true); setOpen(false); };

    return (
        <Dialog open={open} onClose={cancel} maxWidth="sm" fullWidth
                data-testid="documents-location-dialog">
            <DialogTitle>Change where “{doc.name}” is read from?</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Box>
                        <Typography variant="caption" color="text.secondary">Currently</Typography>
                        <Typography sx={pathSx} data-testid="documents-location-old">
                            {doc.location || '— not set —'}
                        </Typography>
                    </Box>
                    <Box>
                        <Typography variant="caption" color="text.secondary">Changing to</Typography>
                        <Typography sx={{ ...pathSx, color: 'primary.main' }}
                                    data-testid="documents-location-new">
                            {next || '— cleared —'}
                        </Typography>
                    </Box>

                    <Alert severity="warning" data-testid="documents-location-warning">
                        {readers.length === 1
                            ? '1 agent reads this file'
                            : `${readers.length} agents read this file`} in full at every boot.
                        <strong> Nothing validates this path.</strong> If it is wrong they will boot
                        without the knowledge and report themselves healthy — the failure is silent
                        at the point it happens and only shows up as an agent that quietly does not
                        know something.
                    </Alert>

                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {readers.map(a => (
                            <Chip key={a.id} size="small" color="warning" variant="outlined"
                                  label={a.name}
                                  data-testid={`documents-location-reader-${a.id}`} />
                        ))}
                    </Stack>

                    <DialogContentText>
                        Registering a path does not create the file. Make sure it already exists at
                        the new location on <code>main</code>.
                    </DialogContentText>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={cancel} data-testid="documents-location-cancel-btn">Cancel</Button>
                <Button onClick={confirm} variant="contained" color="warning"
                        data-testid="documents-location-confirm-btn">
                    Change the path
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DocumentLocationDialog;
