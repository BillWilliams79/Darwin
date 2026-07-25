// Create / edit one instruction registry row (req #3049).
//
// Shared by /agents/instructions and /agents/:id deliberately: the pencil on an
// agent's bound instruction opens THIS dialog, so the blast-radius warning
// travels with the edit no matter where it was started from.
//
// The dialog edits the ROW plus its agent MEMBERSHIP. It does not edit per-agent
// load order — with N agents there are N different orders and no coherent
// control for them here. Load order lives on AgentDetail, where an agent's list
// is a single ordered thing.

import { useEffect, useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { instructionNameTaken } from './agentRegistryUtils';

// `instructions.name` is VARCHAR(256) and the RDS sql_mode is NOT strict, so an
// over-long value is silently TRUNCATED rather than rejected — and the truncated
// value can then collide on the unique key. The cap has to be enforced here.
const NAME_MAX = 256;

// `content` is TEXT: 65,535 BYTES. Same non-strict-mode hazard as `name` — over
// the limit truncates silently. A hard block, unlike the hint below.
const CONTENT_MAX_BYTES = 65535;

// Long prose belongs in an architecture document, not an instruction row. A hint,
// never a block — the registry's own guidance, not a schema limit.
const CONTENT_HINT_LENGTH = 1500;

// `instructions.sort_order` is SMALLINT — MySQL CLAMPS out-of-range values under
// non-strict sql_mode rather than rejecting them.
const SORT_ORDER_MIN = -32768;
const SORT_ORDER_MAX = 32767;

const InstructionEditDialog = ({
    open, onClose, onSave, initial,
    allInstructions = [], agents = [], boundAgentIds = [], ownerAgentIds = [],
    saving = false, error = null, selfId: selfIdProp,
}) => {
    const [name, setName] = useState('');
    const [content, setContent] = useState('');
    const [sortOrder, setSortOrder] = useState('');
    const [closed, setClosed] = useState(false);
    const [linkedAgentIds, setLinkedAgentIds] = useState([]);

    useEffect(() => {
        if (!open) return;
        setName(initial?.name || '');
        setContent(initial?.content || '');
        setSortOrder(initial?.sort_order ?? '');
        setClosed(!!initial?.closed);
        setLinkedAgentIds(boundAgentIds);
        // `boundAgentIds` is a fresh array each render; depending on it directly
        // would re-seed (and discard) the user's checkbox edits on every parent
        // render. Key off the row identity instead — the dialog re-seeds when it
        // opens or when it is pointed at a different row, which is the intent.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initial?.id]);

    const openAgents = useMemo(() => agents.filter(a => !a.closed), [agents]);

    const trimmedName = name.trim();

    // The row this dialog is editing, which is NOT always `initial.id`. If a
    // create succeeded but the agent-binding phase then failed, the caller latches
    // the new row's id and keeps the dialog open for a retry — by which point the
    // refetched catalog contains that row. Excluding it from the uniqueness check
    // is what makes the retry possible; without it the dialog would flag the row
    // the user just created as a name collision and disable Save forever.
    const selfId = selfIdProp ?? initial?.id ?? null;
    const isExisting = selfId != null;

    const nameTaken = instructionNameTaken(trimmedName, allInstructions, selfId);
    const nameMissing = !trimmedName;
    const contentMissing = !content.trim();
    // `content` is TEXT — 65,535 BYTES — and the RDS sql_mode is not strict, so an
    // over-long value is silently TRUNCATED mid-sentence rather than rejected. For
    // text an agent loads verbatim that is a correctness failure, so measure the
    // encoded byte length, not the JS string length.
    const contentBytes = useMemo(
        () => new TextEncoder().encode(content).length, [content]);
    const contentTooLong = contentBytes > CONTENT_MAX_BYTES;
    // `sort_order` is SMALLINT. Non-strict sql_mode CLAMPS an out-of-range value
    // to 32767 instead of rejecting it — the same silent-corruption class as the
    // name and content limits, so guard it the same way.
    const sortOrderNum = sortOrder === '' ? null : parseInt(sortOrder, 10);
    const sortOrderInvalid = sortOrder !== '' && (
        !Number.isFinite(sortOrderNum)
        || sortOrderNum < SORT_ORDER_MIN || sortOrderNum > SORT_ORDER_MAX);
    const renamed = !!initial && trimmedName !== (initial.name || '');

    // Blast radius is measured on what is CURRENTLY bound in the database, not on
    // the pending checkbox state: it answers "who does this edit disturb?".
    //
    // Counted over OPEN agents only — a closed agent never boots, so it loads
    // nothing. Counting it would also disagree with the checkbox list below, which
    // shows open agents only.
    const boundAgentNames = useMemo(
        () => boundAgentIds
            .map(id => agents.find(a => a.id === id))
            .filter(a => a && !a.closed)
            .map(a => a.name),
        [boundAgentIds, agents]);
    const refCount = boundAgentNames.length;

    // The contradiction rule: an agent's binding instruction must not contradict a
    // document that same agent owns. Not machine-checkable — surfaced at the one
    // moment it can actually be violated.
    const bindsAnOwner = boundAgentIds.some(id => ownerAgentIds.includes(id));

    const invalid = nameMissing || contentMissing || nameTaken
        || contentTooLong || sortOrderInvalid;

    const toggleAgent = (id) => setLinkedAgentIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

    const submit = () => {
        if (invalid || saving) return;
        onSave({
            name: trimmedName,
            content,
            sort_order: sortOrderNum,
            closed: closed ? 1 : 0,
        }, linkedAgentIds);
    };

    return (
        <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="md" fullWidth
                data-testid="instruction-edit-dialog">
            <DialogTitle>{isExisting ? 'Edit instruction' : 'New instruction'}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>

                    {initial && refCount > 0 && (
                        <Alert severity={refCount >= 2 ? 'warning' : 'info'}
                               data-testid="instruction-blast-radius-alert">
                            <AlertTitle sx={{ mb: 0.5 }}>
                                {refCount} agent{refCount === 1 ? '' : 's'} load this at boot
                            </AlertTitle>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                Saving changes their duty at their <strong>next boot</strong>.
                                Sessions already running keep the old text.
                            </Typography>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {boundAgentNames.map(n => (
                                    <Chip key={n} label={n} size="small" variant="outlined" />
                                ))}
                            </Stack>
                        </Alert>
                    )}

                    {renamed && refCount >= 2 && (
                        <Alert severity="warning" data-testid="instruction-rename-warning">
                            Renaming <code>{initial.name}</code> breaks no code — no production
                            path resolves an instruction by name — but the name appears verbatim
                            in the charter stubs and the memory docs. Grep the workspace for the
                            old name after saving.
                        </Alert>
                    )}

                    {error && (
                        <Alert severity="error" data-testid="instruction-save-error">{error}</Alert>
                    )}

                    <TextField
                        autoFocus
                        label="Name"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        required
                        error={nameTaken}
                        helperText={nameTaken
                            ? `An instruction named "${trimmedName}" already exists (it may be closed).`
                            : 'Kebab-case by convention. Unique across the registry.'}
                        inputProps={{
                            maxLength: NAME_MAX,
                            style: { fontFamily: 'monospace' },
                            'data-testid': 'instruction-name-input',
                        }}
                    />

                    <TextField
                        label="Content"
                        value={content}
                        onChange={e => setContent(e.target.value)}
                        required
                        multiline
                        minRows={8}
                        maxRows={24}
                        error={contentTooLong}
                        helperText={
                            contentTooLong
                                ? `Too long: ${contentBytes.toLocaleString()} bytes of a ${CONTENT_MAX_BYTES.toLocaleString()}-byte limit. `
                                  + 'The database would truncate it silently.'
                                : content.length > CONTENT_HINT_LENGTH
                                    ? 'Long content usually belongs in an architecture document — instructions are short binding rules.'
                                    : bindsAnOwner
                                        ? 'Check this does not contradict a document the bound agent owns.'
                                        : 'BINDING text. Loaded verbatim into the agent at boot.'
                        }
                        inputProps={{ 'data-testid': 'instruction-content-input' }}
                    />

                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <TextField
                            label="Catalog order"
                            type="number"
                            value={sortOrder}
                            onChange={e => setSortOrder(e.target.value)}
                            sx={{ width: 240 }}
                            error={sortOrderInvalid}
                            helperText={sortOrderInvalid
                                ? `Must be a whole number between ${SORT_ORDER_MIN} and ${SORT_ORDER_MAX}.`
                                : 'Browse-list position only — does not affect what any agent loads.'}
                            inputProps={{
                                min: SORT_ORDER_MIN,
                                max: SORT_ORDER_MAX,
                                'data-testid': 'instruction-sort-order-input',
                            }}
                        />
                        {isExisting && (
                            <FormControlLabel
                                sx={{ mt: 1 }}
                                control={
                                    <Switch
                                        checked={closed}
                                        onChange={e => setClosed(e.target.checked)}
                                        data-testid="instruction-closed-switch"
                                    />
                                }
                                label="Closed (retired — drops out of every boot payload)"
                            />
                        )}
                    </Box>

                    <Box>
                        <Typography variant="subtitle2">Bound agents</Typography>
                        <Typography variant="caption" color="text.secondary">
                            Membership only. A newly bound instruction lands at the end of that
                            agent&apos;s load order; reorder it on the agent&apos;s own page.
                        </Typography>
                        <Box sx={{ maxHeight: 220, overflow: 'auto', border: 1,
                                    borderColor: 'divider', p: 1, borderRadius: 1, mt: 1 }}
                             data-testid="instruction-agent-link-list">
                            {openAgents.map(a => (
                                <FormControlLabel
                                    key={a.id}
                                    control={
                                        <Checkbox
                                            checked={linkedAgentIds.includes(a.id)}
                                            onChange={() => toggleAgent(a.id)}
                                            data-testid={`link-agent-${a.id}`}
                                        />
                                    }
                                    label={a.name}
                                    sx={{ display: 'block' }}
                                />
                            ))}
                        </Box>
                    </Box>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}
                        data-testid="instruction-cancel-btn">Cancel</Button>
                <Button onClick={submit} variant="contained" disabled={invalid || saving}
                        data-testid="instruction-save-btn">
                    {saving ? 'Saving…' : isExisting ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default InstructionEditDialog;
