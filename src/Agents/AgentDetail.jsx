// /agents/:id — one architect's full registry entry (req #2998).
//
// Mirrors what the agent itself receives from darwin://agents/<name> at boot:
// identity, BINDING instructions in load order, and documents in relationship
// precedence order with the autoload subset called out. Identity fields are
// inline-editable (short by design); long content lives in the linked documents.

import '../index.css';
import { useContext, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import {
    useAgents, useInstructions, useArchitectureDocuments,
    useAgentDocuments, useAgentInstructions, agentKeys,
} from '../hooks/useDataQueries';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import {
    byId, linksByAgent, instructionLinksByAgent, agentsByInstruction,
    isCommonInstruction, relationshipChipProps, relationshipLabel,
    docTypeChipProps, documentHref, isAutoload,
    agentModelChipProps, agentModelLabel,
} from './agentRegistryUtils';

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

    const myInstructions = useMemo(
        () => (instrLinks.get(agentId) || [])
            .map(l => ({ link: l, row: instrIndex.get(l.instruction_fk) }))
            .filter(x => x.row && !x.row.closed),
        [instrLinks, agentId, instrIndex]);

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

                {myInstructions.length === 0 ? (
                    <Typography color="text.secondary" sx={{ mb: 3 }}>No instructions linked.</Typography>
                ) : (
                    <Stack spacing={1} sx={{ mb: 3 }}>
                        {myInstructions.map(({ link, row }) => {
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
                                        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                            #{link.sort_order ?? '—'}
                                        </Typography>
                                    </Box>
                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                        {row.content}
                                    </Typography>
                                </Paper>
                            );
                        })}
                    </Stack>
                )}
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
