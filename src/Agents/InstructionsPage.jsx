// /agents/instructions — the instruction registry (req #2998, editable req #3049).
//
// The point of this page is BLAST RADIUS. An instruction is a row, and a "common"
// instruction is simply a row that many agents link — there is no common flag in
// the schema. Editing one changes the duty for every agent that references it at
// their next boot, so every row shows chips for all referencing agents BEFORE
// anyone edits it.
//
// Req #3049 made the rows editable in place. The card list survives the change on
// purpose: `content` is prose, and a DataGrid would either truncate it into
// uselessness or need auto row height. The card is the only view that shows the
// text and its blast radius together, which is the read this page exists for.

import '../index.css';
import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import {
    useInstructions, useAgents, useAgentInstructions, useAgentDocuments,
    instructionKeys, agentInstructionKeys,
} from '../hooks/useDataQueries';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import {
    byId, agentsByInstruction, isCommonInstruction, instructionLinksByAgent,
    nextInstructionSortOrder, restErrorMessage, hasRole,
} from './agentRegistryUtils';
import {
    createInstruction, updateInstruction, deleteInstruction, syncInstructionAgents,
} from './actions/instructionsApi';
import InstructionEditDialog from './InstructionEditDialog';
import InstructionDeleteDialog from './InstructionDeleteDialog';

const InstructionsPage = () => {
    const navigate = useNavigate();
    const { profile, idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const isMobile = useMediaQuery('(max-width:899px)');
    const creatorFk = profile?.userName;

    const { data: instructions, isLoading } = useInstructions(creatorFk);
    const { data: agents } = useAgents(creatorFk);
    const { data: agentInstrs } = useAgentInstructions(creatorFk);
    const { data: agentDocs } = useAgentDocuments(creatorFk);

    const [showClosed, setShowClosed] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [busy, setBusy] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [createdId, setCreatedId] = useState(null);

    const agentIndex = useMemo(() => byId(agents || []), [agents]);
    const byInstruction = useMemo(
        () => agentsByInstruction(agentInstrs || []), [agentInstrs]);
    const instrLinks = useMemo(
        () => instructionLinksByAgent(agentInstrs || []), [agentInstrs]);

    // Agents that own at least one document — drives the contradiction hint in the
    // edit dialog (a binding instruction must not contradict a document its agent
    // owns).
    const ownerAgentIds = useMemo(() => [...new Set(
        (agentDocs || []).filter(l => hasRole(l.relationship, 'owned'))
            .map(l => l.agent_fk))], [agentDocs]);

    const hasClosed = useMemo(
        () => (instructions || []).some(i => i.closed), [instructions]);

    const rows = useMemo(() => {
        if (!instructions) return [];
        return instructions
            .filter(i => showClosed || !i.closed)
            .map(i => ({ ...i, refs: byInstruction.get(i.id) || [] }))
            .sort((a, b) =>
                // Open rows first — a closed row binds nothing, so it never
                // belongs above a live one.
                (a.closed ? 1 : 0) - (b.closed ? 1 : 0) ||
                // Then the biggest blast radius, then the catalog order. NOTE:
                // `instructions.sort_order` is a CATALOG hint only. Boot load
                // order is `agent_instructions.sort_order`, which is per-agent
                // and shown on each agent's own page.
                b.refs.length - a.refs.length ||
                (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) ||
                a.name.localeCompare(b.name));
    }, [instructions, byInstruction, showClosed]);

    // Awaited by every caller: the membership diff reads `byInstruction`, so a
    // retry after a partial failure must diff against what is actually stored.
    const invalidate = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: instructionKeys.all(creatorFk) }),
        // A hard delete cascades junction rows, and every membership edit writes
        // them, so the junction cache is stale even when only the row changed.
        queryClient.invalidateQueries({ queryKey: agentInstructionKeys.all(creatorFk) }),
    ]);

    const openCreate = () => {
        setSaveError(null); setEditTarget(null); setCreatedId(null); setEditOpen(true);
    };
    const openEdit = (row) => { setSaveError(null); setEditTarget(row); setEditOpen(true); };

    const handleSave = async (values, linkedAgentIds) => {
        setBusy(true);
        setSaveError(null);
        try {
            // `createdId` latches a row this dialog already created. Without it, a
            // retry after the LINK phase failed would call createInstruction again
            // and hit the unique-name 500 — leaving an orphan row and a dialog that
            // can never be completed.
            let instructionId = editTarget?.id || createdId;
            if (editTarget) {
                await updateInstruction(darwinUri, idToken, editTarget.id, values);
            } else if (instructionId) {
                await updateInstruction(darwinUri, idToken, instructionId, values);
            } else {
                let saved = await createInstruction(darwinUri, idToken,
                    { ...values, creator_fk: creatorFk });
                if (Array.isArray(saved)) saved = saved[0];
                instructionId = saved?.id;
                // rest_post.py returns 201 with an EMPTY body on three fallback
                // paths. Silently skipping the agent bindings there would report
                // success while binding nothing, so fail loudly instead.
                if (!instructionId) {
                    throw new Error(
                        'The instruction was created but the server did not return its id, '
                        + 'so the agent bindings were not applied. Reload and edit the row.');
                }
                setCreatedId(instructionId);
            }

            await syncInstructionAgents(darwinUri, idToken, {
                instructionId,
                prevAgentIds: byInstruction.get(instructionId) || [],
                nextAgentIds: linkedAgentIds,
                sortOrderFor: (agentId) => nextInstructionSortOrder(agentId, instrLinks),
            });
            await invalidate();
            setCreatedId(null);
            setEditOpen(false);
        } catch (err) {
            // Resync first so a retry diffs against reality — the membership loop
            // is a sequence of independent writes and may be half-applied.
            await invalidate();
            // A constraint violation arrives as an opaque 500 — show the mapped
            // message inline on the dialog, where the offending field is.
            setSaveError(restErrorMessage(err, err?.message
                || (editTarget ? 'Could not save the instruction.'
                               : 'Could not create the instruction.')));
        } finally {
            setBusy(false);
        }
    };

    const handleClose = async () => {
        if (!deleteTarget) return;
        setBusy(true);
        try {
            await updateInstruction(darwinUri, idToken, deleteTarget.id, { closed: 1 });
            await invalidate();
            setDeleteTarget(null);
        } catch (err) {
            await invalidate();
            showError(err, restErrorMessage(err, 'Could not close the instruction'));
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setBusy(true);
        try {
            await deleteInstruction(darwinUri, idToken, deleteTarget.id);
            await invalidate();
            setDeleteTarget(null);
        } catch (err) {
            await invalidate();
            showError(err, restErrorMessage(err, 'Could not delete the instruction'));
        } finally {
            setBusy(false);
        }
    };

    if (isLoading || !instructions) {
        return <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}><CircularProgress /></Box>;
    }

    const openCount = rows.filter(r => !r.closed).length;

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ flex: 1 }}>Instructions</Typography>
                {hasClosed && (
                    <Tooltip title={showClosed ? 'Hide closed instructions' : 'Show closed instructions'}>
                        <Chip
                            label="Closed"
                            size="small"
                            color={showClosed ? 'primary' : 'default'}
                            variant={showClosed ? 'filled' : 'outlined'}
                            onClick={() => setShowClosed(v => !v)}
                            sx={{ cursor: 'pointer' }}
                            data-testid="instructions-show-closed"
                        />
                    </Tooltip>
                )}
                <Button variant="contained" size="small" startIcon={<AddIcon />}
                        onClick={openCreate} data-testid="new-instruction-btn">
                    New Instruction
                </Button>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {openCount} binding instruction rows. Chips show every agent bound by each row —
                editing a row changes the duty for all of them at their next boot.
            </Typography>

            <Stack spacing={1.5} data-testid="instructions-registry">
                {rows.map(row => {
                    const common = isCommonInstruction(row.id, byInstruction);
                    return (
                        <Paper key={row.id} variant="outlined"
                               sx={{ p: 2, ...(row.closed && { opacity: 0.55 }) }}
                               data-testid={`instruction-row-${row.id}`}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                                <Typography variant="subtitle2" sx={{ fontFamily: 'monospace' }}>
                                    {row.name}
                                </Typography>
                                {common && (
                                    <Chip label="common" size="small" color="secondary" variant="outlined"
                                          data-testid={`instruction-common-${row.id}`} />
                                )}
                                {row.refs.length === 0 ? (
                                    <Chip label="0 agents — not bound" size="small" color="warning"
                                          variant="outlined"
                                          data-testid={`instruction-unbound-${row.id}`} />
                                ) : (
                                    <Chip label={`${row.refs.length} agent${row.refs.length === 1 ? '' : 's'}`}
                                          size="small" variant="outlined" />
                                )}
                                {row.closed && (
                                    <Chip label="closed" size="small"
                                          data-testid={`instruction-closed-${row.id}`} />
                                )}
                                <Box sx={{ ml: 'auto', flexShrink: 0 }}>
                                    <Tooltip title="Edit instruction">
                                        <IconButton size="small" onClick={() => openEdit(row)}
                                                    data-testid={`instruction-edit-${row.id}`}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Retire or delete">
                                        <IconButton size="small" onClick={() => setDeleteTarget(row)}
                                                    data-testid={`instruction-delete-${row.id}`}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            </Box>

                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1.5 }}>
                                {row.content}
                            </Typography>

                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {row.refs.map(aid => {
                                    const a = agentIndex.get(aid);
                                    if (!a) return null;
                                    return (
                                        <Chip
                                            key={aid}
                                            label={a.name}
                                            size="small"
                                            clickable
                                            onClick={() => navigate(`/agents/${aid}#instructions`)}
                                            data-testid={`instruction-${row.id}-agent-${aid}`}
                                        />
                                    );
                                })}
                            </Stack>
                        </Paper>
                    );
                })}
            </Stack>

            <InstructionEditDialog
                open={editOpen}
                onClose={() => setEditOpen(false)}
                onSave={handleSave}
                initial={editTarget}
                // The row being edited is `createdId` when a create succeeded but
                // its agent-binding phase failed: the dialog stays open for a
                // retry, and by then the refetched catalog contains that row.
                // Without this the uniqueness check would flag it and disable Save.
                selfId={editTarget?.id ?? createdId ?? null}
                allInstructions={instructions}
                agents={agents || []}
                boundAgentIds={editTarget ? (byInstruction.get(editTarget.id) || []) : []}
                ownerAgentIds={ownerAgentIds}
                saving={busy}
                error={saveError}
            />

            <InstructionDeleteDialog
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onClose_Instruction={handleClose}
                onDelete={handleDelete}
                instruction={deleteTarget}
                // EVERY binding, including closed agents': a hard delete cascades
                // all of them away, so all of them belong in the warning. The
                // dialog counts the open ones separately for the "load at boot"
                // wording — data loss and boot impact are different questions.
                boundAgents={deleteTarget
                    ? (byInstruction.get(deleteTarget.id) || [])
                        .map(aid => agentIndex.get(aid))
                        .filter(Boolean)
                        .map(a => ({ name: a.name, closed: !!a.closed }))
                    : []}
                busy={busy}
            />
        </Box>
    );
};

export default InstructionsPage;
