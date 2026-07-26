// Edit ONE agent→document link: its roles and its notes (req #3051).
//
// WHY THIS ONE CONTROL HAS A SAVE BUTTON, when nothing else on the registry does.
//
// Darwin's shipped idiom for a short closed vocabulary is a chip row that writes
// on click — RequirementDetail's Model / Effort / Machine chips, and the doc_type
// chips on the card behind this popover. That is right THERE because each click
// is a single-column PUT against a row with an `id`: non-destructive, and undone
// by clicking the previous chip.
//
// `agent_documents` has NO `id` column, so Lambda-Rest cannot PUT it. Every role
// change is a DELETE of the whole row followed by a fresh INSERT. Ticking three
// roles would therefore be three destroy-and-recreate cycles for one logical
// edit, each opening a window in which the link does not exist, and each able to
// drop `notes` or `sort_order` if any single one of them is wired wrong. Staging
// the whole set behind one Save collapses that to one cycle — the same reasoning
// that made `bindAllAgents` a single bulk POST instead of a loop of binds.
//
// This is a deliberate, reasoned departure from the no-Save-button rule, not an
// oversight. Do not "fix" it into commit-on-click.
//
// `owned` is NOT offered here. Ownership is DB-enforced unique per document, it
// needs a transfer plan rather than a toggle, and it has its own row on the card.
// One fact, one editor.

import { useEffect, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import {
    parseRoles, serializeRoles, relationshipChipProps,
    relationshipSetError, relationshipSetHint,
    documentNotesError, charLength, DOCUMENT_NOTES_MAX,
} from './agentRegistryUtils';

// `owned` is handled by the card's owner row — see the header note.
const EDITABLE_ROLES = ['curated', 'autoload', 'referenced'];

const ROLE_HELP = {
    curated: 'This agent keeps the document accurate, without owning it.',
    autoload: 'This agent reads the file IN FULL at every boot — a real context cost.',
    referenced: 'This agent may consult the document. Nothing is loaded automatically.',
};

const DocumentLinkPopover = ({
    open,
    anchorEl,
    onClose,
    document: doc,
    agent,
    link,
    onSave,
    onOpenAgent,
    busy = false,
}) => {
    const [roles, setRoles] = useState([]);
    const [notes, setNotes] = useState('');

    // Re-seed whenever the popover is opened onto a (possibly different) link.
    // Keyed on the link identity as well as `open` so reopening the same popover
    // after an external refetch shows the stored values, not the last draft.
    useEffect(() => {
        if (!open) return;
        setRoles(parseRoles(link?.relationship).filter(r => r !== 'owned'));
        setNotes(link?.notes || '');
    }, [open, link?.agent_fk, link?.document_fk, link?.relationship, link?.notes]);

    if (!agent || !link) return null;

    // `owned` is not editable here but it is still ON the link, and it must
    // survive the save — dropping it would silently un-own the document from a
    // control that never mentioned ownership.
    const keepsOwned = parseRoles(link.relationship).includes('owned');
    const nextRoles = keepsOwned ? ['owned', ...roles] : roles;

    const roleError = relationshipSetError(nextRoles);
    const roleHint = relationshipSetHint(nextRoles);
    const notesError = documentNotesError(notes);
    const notesLength = charLength(notes);

    const gainsAutoload = roles.includes('autoload')
        && !parseRoles(link.relationship).includes('autoload');

    const dirty = serializeRoles(nextRoles) !== serializeRoles(link.relationship)
        || (notes || '') !== (link.notes || '');

    const toggleRole = (role) => setRoles(prev => (
        prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]));

    const save = () => {
        if (roleError || notesError || !dirty) return;
        onSave({
            ...link,
            relationship: serializeRoles(nextRoles),
            notes: notes.trim() || null,
            // Carried through UNTOUCHED. This is the agent's per-agent document
            // order and it belongs to AgentDetail; a re-POST that omitted it would
            // write NULL over it from a control that has nothing to do with order.
            sort_order: link.sort_order,
        });
    };

    return (
        <Popover
            open={open}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ paper: {
                sx: { p: 2, width: 380, maxWidth: '95vw' },
                'data-testid': `document-link-popover-${doc?.id}-${agent.id}`,
            } }}
        >
            <Stack spacing={1.5}>
                <Box>
                    <Link
                        component="button"
                        type="button"
                        underline="hover"
                        onClick={() => onOpenAgent(agent.id)}
                        sx={{ fontWeight: 500 }}
                    >
                        {agent.name}
                    </Link>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Relationship to {doc?.name}
                    </Typography>
                </Box>

                <Divider />

                {keepsOwned && (
                    <Alert severity="info" sx={{ py: 0 }}>
                        This agent <strong>owns</strong> the document. Ownership is edited on the
                        card&apos;s Owner row; it is preserved by anything you do here.
                    </Alert>
                )}

                <Box>
                    <Typography variant="caption" color="text.secondary"
                                sx={{ display: 'block', mb: 0.5 }}>
                        Roles
                    </Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {EDITABLE_ROLES.map(role => {
                            const on = roles.includes(role);
                            // `owned` supersedes `referenced` (instruction #83), so
                            // the combination is blocked by relationshipSetError.
                            // Offering a chip that can only ever produce an error
                            // is worse than not offering it — disable it and say
                            // why in the tooltip.
                            const blockedByOwnership = keepsOwned && role === 'referenced';
                            const chip = (
                                <Chip
                                    key={role}
                                    label={role}
                                    size="small"
                                    clickable={!blockedByOwnership}
                                    disabled={busy || blockedByOwnership}
                                    onClick={blockedByOwnership ? undefined : () => toggleRole(role)}
                                    {...(on
                                        ? relationshipChipProps(role)
                                        : { variant: 'outlined', sx: { opacity: 0.55 } })}
                                    data-testid={`document-link-role-${doc?.id}-${agent.id}-${role}`}
                                />
                            );
                            return blockedByOwnership ? (
                                <Tooltip key={role}
                                         title="The owner already outranks a reference — release ownership first">
                                    {/* A disabled MUI Chip swallows pointer events,
                                        so the Tooltip needs a real element to hang
                                        off. */}
                                    <span>{chip}</span>
                                </Tooltip>
                            ) : chip;
                        })}
                    </Stack>
                    <Typography variant="caption" color="text.secondary"
                                sx={{ display: 'block', mt: 0.5 }}>
                        {roles.length === 1 ? ROLE_HELP[roles[0]] : 'Pick one or more.'}
                    </Typography>
                </Box>

                {/* Autoload is the only role with a runtime COST, so it is the only
                    one that gets a warning. Advisory, never a block: there is no
                    context budget anywhere in the system to measure this against,
                    and a block would be inventing a limit nobody set. Deliberately
                    no token estimate either — the file's size is on disk and the
                    browser cannot see it, so any number here would be made up. */}
                {gainsAutoload && (
                    <Alert severity="warning" sx={{ py: 0 }}
                           data-testid={`document-link-autoload-warning-${doc?.id}-${agent.id}`}>
                        {agent.name} will read this file <strong>in full at every boot</strong>,
                        adding its whole contents to that agent&apos;s context.
                    </Alert>
                )}

                {roleError && <Alert severity="error" sx={{ py: 0 }}>{roleError}</Alert>}
                {!roleError && roleHint && (
                    <Alert severity="info" sx={{ py: 0 }}>{roleHint}</Alert>
                )}

                <TextField
                    label="Notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    multiline
                    maxRows={4}
                    fullWidth
                    size="small"
                    error={!!notesError}
                    helperText={notesError
                        || `${notesLength} / ${DOCUMENT_NOTES_MAX} characters`}
                    inputProps={{
                        maxLength: DOCUMENT_NOTES_MAX,
                        'data-testid': `document-link-notes-${doc?.id}-${agent.id}`,
                    }}
                />

                <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" onClick={onClose} disabled={busy}
                            data-testid={`document-link-cancel-${doc?.id}-${agent.id}`}>
                        Cancel
                    </Button>
                    <Button
                        size="small"
                        variant="contained"
                        onClick={save}
                        disabled={busy || !dirty || !!roleError || !!notesError}
                        data-testid={`document-link-save-${doc?.id}-${agent.id}`}
                    >
                        {busy ? 'Saving…' : 'Save'}
                    </Button>
                </Stack>
            </Stack>
        </Popover>
    );
};

export default DocumentLinkPopover;
