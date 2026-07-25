// /agents/:id — one architect's full registry entry (req #2998).
//
// Mirrors what the agent itself receives from darwin://agents/<name> at boot:
// identity, BINDING instructions in load order, and documents in relationship
// precedence order with the autoload subset called out. Identity fields are
// inline-editable (short by design); long content lives in the linked documents.
//
// Req #3049 made the instructions section editable. This page owns the
// RELATIONSHIP — which instructions bind this agent and in what order — because
// an agent's list is a single ordered thing. It does not own instruction CONTENT.
//
// Req #3063 sharpened that boundary. The pencil used to open the shared edit
// dialog so the blast-radius warning travelled with the edit; that dialog is
// gone, and content is now edited in place on the registry page itself. So the
// pencil DRILLS THROUGH to the row on /agents/instructions instead — the
// interlinking grammar of req #2494, and the thing that keeps exactly one editor
// for instruction content. Editing it from here would put a second editor on a
// surface that cannot show who else loads the text.

import '../index.css';
import { useContext, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import EditIcon from '@mui/icons-material/Edit';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import {
    useAgents, useInstructions, useArchitectureDocuments,
    useAgentDocuments, useAgentInstructions, agentKeys,
    instructionKeys, agentInstructionKeys,
} from '../hooks/useDataQueries';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import {
    byId, linksByAgent, instructionLinksByAgent, agentsByInstruction,
    isCommonInstruction, relationshipChipProps, relationshipLabel,
    docTypeChipProps, documentHref, isAutoload,
    agentModelChipProps, agentModelLabel,
    nextInstructionSortOrder, planInstructionSwap, restErrorMessage,
} from './agentRegistryUtils';
import {
    linkAgentInstruction, unlinkAgentInstruction, setAgentInstructionOrder,
} from './actions/instructionsApi';

const AgentDetail = () => {
    const { id } = useParams();
    const agentId = Number(id);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { profile, idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);

    const creatorFk = profile?.userName;
    const { data: agents, isLoading } = useAgents(creatorFk);
    const { data: allInstructions } = useInstructions(creatorFk);
    const { data: allDocuments } = useArchitectureDocuments(creatorFk);
    const { data: agentDocs } = useAgentDocuments(creatorFk);
    const { data: agentInstrs } = useAgentInstructions(creatorFk);

    const agent = useMemo(
        () => (agents || []).find(a => a.id === agentId), [agents, agentId]);

    const [overview, setOverview] = useState('');
    useEffect(() => { setOverview(agent?.overview || ''); }, [agent?.overview]);

    // Scroll the requested section into view when arriving via an anchor chip.
    useEffect(() => {
        if (isLoading) return;
        const hash = window.location.hash;
        if (!hash) return;
        const el = document.getElementById(hash.slice(1));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [isLoading, agentId]);

    const instrIndex = useMemo(() => byId(allInstructions || []), [allInstructions]);
    const docIndex = useMemo(() => byId(allDocuments || []), [allDocuments]);
    const instrLinks = useMemo(
        () => instructionLinksByAgent(agentInstrs || []), [agentInstrs]);
    const docLinks = useMemo(() => linksByAgent(agentDocs || []), [agentDocs]);
    const byInstruction = useMemo(
        () => agentsByInstruction(agentInstrs || []), [agentInstrs]);

    // Only OPEN instructions render: closed rows drop out of the agent's real boot
    // payload, so listing them here would misrepresent what the agent loads. The
    // count of hidden ones is surfaced instead, so "where did it go?" has an answer.
    const myLinks = useMemo(
        () => (instrLinks.get(agentId) || [])
            .map(l => ({ link: l, row: instrIndex.get(l.instruction_fk) }))
            .filter(x => x.row),
        [instrLinks, agentId, instrIndex]);

    const myInstructions = useMemo(
        () => myLinks.filter(x => !x.row.closed), [myLinks]);

    const closedLinkedCount = myLinks.length - myInstructions.length;

    // Instructions this agent could still bind — open, and not already linked.
    const linkableInstructions = useMemo(() => {
        const bound = new Set(myLinks.map(x => x.row.id));
        return (allInstructions || [])
            .filter(i => !i.closed && !bound.has(i.id))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [allInstructions, myLinks]);

    const myDocuments = useMemo(
        () => (docLinks.get(agentId) || [])
            .map(l => ({ link: l, row: docIndex.get(l.document_fk) }))
            .filter(x => x.row && !x.row.closed),
        [docLinks, agentId, docIndex]);

    const autoloadCount = myDocuments.filter(
        d => isAutoload(d.link.relationship)).length;

    const saveOverview = async () => {
        const next = overview.trim();
        if (!agent || next === (agent.overview || '')) return;
        if (!next) { setOverview(agent.overview || ''); return; }  // overview is NOT NULL
        try {
            await call_rest_api(`${darwinUri}/agents`, 'PUT',
                [{ id: agent.id, overview: next }], idToken);
            queryClient.invalidateQueries({ queryKey: agentKeys.all(creatorFk) });
        } catch (err) {
            showError(err, 'Failed to update agent overview');
            setOverview(agent.overview || '');
        }
    };

    // ---------- instruction relationship editing (req #3049) ----------

    const [addSelection, setAddSelection] = useState(null);
    const [instrBusy, setInstrBusy] = useState(false);

    /**
     * AWAITED on purpose. Returning before the refetch settles would re-enable the
     * arrows while the list still renders the PRE-change order, and the next click
     * would plan its swap from stale `sort_order` values — producing duplicate
     * slots and moving a different row than the one under the cursor.
     */
    const invalidateInstructions = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: instructionKeys.all(creatorFk) }),
        queryClient.invalidateQueries({ queryKey: agentInstructionKeys.all(creatorFk) }),
    ]);

    // Resync BEFORE surfacing the error: a display failure must never be able to
    // skip the refetch, because the write may be half-applied.
    const reportInstructionError = async (err, fallback) => {
        await invalidateInstructions();
        showError(err, restErrorMessage(err, fallback));
    };

    /**
     * Move a bound instruction up or down the agent's load order.
     *
     * A SWAP, never a renumber. Closed links keep their stored slots and are not
     * rewritten, so their values are passed as `reserved` to stop a repair pass
     * colliding with them.
     */
    const moveInstruction = async (fromIdx, toIdx) => {
        const links = myInstructions.map(x => x.link);
        const reserved = myLinks
            .filter(x => x.row.closed)
            .map(x => x.link.sort_order);
        const plan = planInstructionSwap(links, fromIdx, toIdx, reserved);
        if (!plan) return;
        setInstrBusy(true);
        try {
            await setAgentInstructionOrder(darwinUri, idToken, plan.writes, plan.originals);
            await invalidateInstructions();
        } catch (err) {
            await reportInstructionError(err, 'Could not change the load order');
        } finally {
            setInstrBusy(false);
        }
    };

    const unlinkInstruction = async (instruction) => {
        // Unbinding changes what this agent loads at boot and there is no undo, so
        // it gets a confirmation like every other destructive action here.
        if (!window.confirm(
            `Unbind "${instruction.name}" from ${agent?.name || 'this agent'}?\n\n` +
            'The agent stops loading it at its next boot. The instruction row itself survives.')) {
            return;
        }
        setInstrBusy(true);
        try {
            await unlinkAgentInstruction(darwinUri, idToken, agentId, instruction.id);
            await invalidateInstructions();
        } catch (err) {
            await reportInstructionError(err, 'Could not unlink the instruction');
        } finally {
            setInstrBusy(false);
        }
    };

    const addInstruction = async () => {
        if (!addSelection) return;
        setInstrBusy(true);
        try {
            await linkAgentInstruction(darwinUri, idToken, agentId, addSelection.id,
                nextInstructionSortOrder(agentId, instrLinks));
            setAddSelection(null);
            await invalidateInstructions();
        } catch (err) {
            await reportInstructionError(err, 'Could not bind the instruction');
        } finally {
            setInstrBusy(false);
        }
    };

    if (isLoading || !agents) {
        return <Box sx={{ gridArea: 'content', p: 3 }}><CircularProgress /></Box>;
    }
    if (!agent) {
        return (
            <Box sx={{ gridArea: 'content', p: 3 }}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/agents')}>
                    Agents
                </Button>
                <Typography sx={{ mt: 2 }}>Agent {agentId} not found.</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ gridArea: 'content', p: 3 }} data-testid={`agent-detail-${agent.id}`}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/agents')} sx={{ mb: 1 }}>
                Agents
            </Button>

            {/* ---------- identity ---------- */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
                <Typography variant="h5">{agent.name}</Typography>
                <Chip label={agentModelLabel(agent.ai_model)} size="small"
                      {...agentModelChipProps(agent.ai_model)} />
                <Chip label={agent.effort || '—'} size="small" variant="outlined" />
                {agent.closed ? <Chip label="Closed" size="small" /> : null}
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                Charter stub: <code>{agent.location || agent.file_name}</code> · boot read:{' '}
                <code>darwin://agents/{agent.name}</code>
            </Typography>

            <TextField
                label="Overview"
                value={overview}
                onChange={(e) => setOverview(e.target.value)}
                onBlur={saveOverview}
                multiline
                minRows={2}
                fullWidth
                size="small"
                helperText="Mirrored into the stub's frontmatter description by reconcile-agent-stubs.sh. The DB is canon."
                sx={{ mb: 3 }}
                data-testid="agent-overview-field"
            />

            {/* ---------- instructions ---------- */}
            <Box id="instructions" sx={{ scrollMarginTop: 16 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                    Instructions{' '}
                    <Typography component="span" variant="body2" color="text.secondary">
                        — BINDING, in load order ({myInstructions.length})
                    </Typography>
                </Typography>

                {closedLinkedCount > 0 && (
                    <Typography variant="caption" color="text.secondary"
                                sx={{ display: 'block', mb: 1 }}
                                data-testid="agent-instructions-closed-note">
                        {closedLinkedCount} linked instruction{closedLinkedCount === 1 ? ' is' : 's are'} closed
                        and not loaded at boot.
                    </Typography>
                )}

                {myInstructions.length === 0 ? (
                    <Typography color="text.secondary" sx={{ mb: 1 }}>No instructions linked.</Typography>
                ) : (
                    <Stack spacing={1} sx={{ mb: 1 }}>
                        {myInstructions.map(({ link, row }, idx) => {
                            const refs = byInstruction.get(row.id) || [];
                            const common = isCommonInstruction(row.id, byInstruction);
                            return (
                                <Paper key={row.id} variant="outlined" sx={{ p: 1.5 }}
                                       data-testid={`agent-instruction-${row.id}`}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                                        <Typography variant="subtitle2" sx={{ fontFamily: 'monospace' }}>
                                            {row.name}
                                        </Typography>
                                        {common && (
                                            <Chip label={`common · ${refs.length} agents`} size="small"
                                                  color="secondary" variant="outlined"
                                                  onClick={() => navigate('/agents/instructions')}
                                                  clickable
                                                  data-testid={`agent-instruction-common-${row.id}`} />
                                        )}
                                        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Tooltip title="Load order — position in this agent's boot payload">
                                                <Typography variant="caption" color="text.secondary"
                                                            data-testid={`agent-instruction-order-${row.id}`}>
                                                    #{link.sort_order ?? '—'}
                                                </Typography>
                                            </Tooltip>
                                            <Tooltip title="Load earlier">
                                                <span>
                                                    <IconButton size="small" disabled={idx === 0 || instrBusy}
                                                                onClick={() => moveInstruction(idx, idx - 1)}
                                                                data-testid={`agent-instruction-up-${row.id}`}>
                                                        <ArrowUpwardIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                            <Tooltip title="Load later">
                                                <span>
                                                    <IconButton size="small"
                                                                disabled={idx === myInstructions.length - 1 || instrBusy}
                                                                onClick={() => moveInstruction(idx, idx + 1)}
                                                                data-testid={`agent-instruction-down-${row.id}`}>
                                                        <ArrowDownwardIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                            {/* No <span> wrapper: this button is
                                                never disabled now, and the wrapper
                                                only ever existed so a Tooltip could
                                                attach to a disabled one. */}
                                            <Tooltip title="Edit this instruction on the registry, where every agent that loads it is visible">
                                                <IconButton size="small"
                                                            onClick={() => navigate(
                                                                `/agents/instructions#instruction-${row.id}`)}
                                                            data-testid={`agent-instruction-edit-${row.id}`}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Unbind from this agent (the instruction itself survives)">
                                                <span>
                                                    <IconButton size="small" disabled={instrBusy}
                                                                onClick={() => unlinkInstruction(row)}
                                                                data-testid={`agent-instruction-unlink-${row.id}`}>
                                                        <LinkOffIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </Box>
                                    </Box>
                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                        {row.content}
                                    </Typography>
                                </Paper>
                            );
                        })}
                    </Stack>
                )}

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 3, flexWrap: 'wrap' }}>
                    <Autocomplete
                        size="small"
                        sx={{ minWidth: 320 }}
                        options={linkableInstructions}
                        getOptionLabel={(o) => o.name || ''}
                        value={addSelection}
                        onChange={(_e, v) => setAddSelection(v)}
                        isOptionEqualToValue={(o, v) => o.id === v.id}
                        disabled={instrBusy}
                        renderInput={(params) => (
                            <TextField {...params} label="Bind an instruction"
                                       inputProps={{ ...params.inputProps,
                                                     'data-testid': 'agent-instruction-add' }} />
                        )}
                    />
                    <Button variant="outlined" size="small" onClick={addInstruction}
                            disabled={!addSelection || instrBusy}
                            data-testid="agent-instruction-add-btn">
                        Bind
                    </Button>
                </Box>
            </Box>

            {/* ---------- documents ---------- */}
            <Box id="documents" sx={{ scrollMarginTop: 16 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                    Documents{' '}
                    <Typography component="span" variant="body2" color="text.secondary">
                        — {myDocuments.length} linked, {autoloadCount} read in full at boot
                    </Typography>
                </Typography>

                {myDocuments.length === 0 ? (
                    <Typography color="text.secondary">No documents linked.</Typography>
                ) : (
                    <Table size="small" data-testid="agent-documents-table">
                        <TableHead>
                            <TableRow>
                                <TableCell>Document</TableCell>
                                <TableCell>Type</TableCell>
                                <TableCell>Relationship</TableCell>
                                <TableCell>Notes</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {myDocuments.map(({ link, row }) => {
                                const href = documentHref(row);
                                const autoload = isAutoload(link.relationship);
                                return (
                                    <TableRow key={row.id} data-testid={`agent-document-${row.id}`}>
                                        <TableCell>
                                            <Stack direction="row" spacing={0.5} alignItems="center">
                                                {href ? (
                                                    <Link href={href} target="_blank" rel="noopener noreferrer"
                                                          underline="hover">
                                                        {row.name} <OpenInNewIcon sx={{ fontSize: 12 }} />
                                                    </Link>
                                                ) : row.name}
                                                {autoload && (
                                                    <Chip label="autoload" size="small" color="primary"
                                                          variant="outlined" />
                                                )}
                                            </Stack>
                                            <Typography variant="caption" color="text.secondary">
                                                {row.location}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Chip label={row.doc_type || '—'} size="small"
                                                  {...docTypeChipProps(row.doc_type)} />
                                        </TableCell>
                                        <TableCell>
                                            <Chip label={relationshipLabel(link.relationship)} size="small"
                                                  {...relationshipChipProps(link.relationship)}
                                                  onClick={() => navigate('/agents/documents')}
                                                  clickable />
                                        </TableCell>
                                        <TableCell sx={{ maxWidth: 380 }}>
                                            <Typography variant="caption" color="text.secondary">
                                                {link.notes || '—'}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </Box>

        </Box>
    );
};

export default AgentDetail;
