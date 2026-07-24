// /agents/documents — THE architecture-document registry (req #2998).
//
// One row per document, with the reverse-link direction of /agents/:id: there the
// question is "what does this agent own?"; here it is "who owns this file?" —
// the question that had no answer before the registry existed, and the reason
// ownership drifted silently for years.
//
// At most one `owned` link may exist per document; that is enforced by a UNIQUE
// key on a VIRTUAL generated column, not by convention. A row rendering without
// an owner chip therefore means genuinely unowned, not a UI gap.

import '../index.css';
import { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import useMediaQuery from '@mui/material/useMediaQuery';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import AuthContext from '../Context/AuthContext';
import {
    useArchitectureDocuments, useAgents, useAgentDocuments,
} from '../hooks/useDataQueries';
import {
    byId, linksByDocument, relationshipChipProps, relationshipLabel,
    docTypeChipProps, documentHref, hasRole,
} from './agentRegistryUtils';

const DocumentsPage = () => {
    const navigate = useNavigate();
    const { profile } = useContext(AuthContext);
    const isMobile = useMediaQuery('(max-width:899px)');
    const creatorFk = profile?.userName;

    const { data: documents, isLoading } = useArchitectureDocuments(creatorFk);
    const { data: agents } = useAgents(creatorFk);
    const { data: agentDocs } = useAgentDocuments(creatorFk);

    const agentIndex = useMemo(() => byId(agents || []), [agents]);
    const byDocument = useMemo(() => linksByDocument(agentDocs || []), [agentDocs]);

    const rows = useMemo(() => {
        if (!documents) return [];
        return documents
            .filter(d => !d.closed)
            .map(d => {
                const links = byDocument.get(d.id) || [];
                return {
                    ...d,
                    links,
                    owner: links.find(l => hasRole(l.relationship, 'owned')) || null,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [documents, byDocument]);

    const unowned = rows.filter(r => !r.owner).length;

    if (isLoading || !documents) {
        return <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ mb: 0.5 }}>Architecture Documents</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {rows.length} registered documents
                {unowned > 0
                    ? ` · ${unowned} with no owner`
                    : ' · every one has exactly one owner'}
                . At most one owner per document is enforced by the database.
            </Typography>

            <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" data-testid="documents-registry">
                    <TableHead>
                        <TableRow>
                            <TableCell>Document</TableCell>
                            <TableCell>Type</TableCell>
                            <TableCell>Owner</TableCell>
                            <TableCell>Other agents</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(doc => {
                            const href = documentHref(doc);
                            const others = doc.links.filter(l => !hasRole(l.relationship, 'owned'));
                            return (
                                <TableRow key={doc.id} data-testid={`document-row-${doc.id}`}>
                                    <TableCell>
                                        {href ? (
                                            <Link href={href} target="_blank" rel="noopener noreferrer"
                                                  underline="hover">
                                                {doc.name} <OpenInNewIcon sx={{ fontSize: 12 }} />
                                            </Link>
                                        ) : doc.name}
                                        <Typography variant="caption" color="text.secondary"
                                                    sx={{ display: 'block' }}>
                                            {doc.location}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip label={doc.doc_type || '—'} size="small"
                                              {...docTypeChipProps(doc.doc_type)} />
                                    </TableCell>
                                    <TableCell>
                                        {doc.owner ? (
                                            <Chip
                                                label={agentIndex.get(doc.owner.agent_fk)?.name || `#${doc.owner.agent_fk}`}
                                                size="small"
                                                {...relationshipChipProps('owned')}
                                                clickable
                                                onClick={() => navigate(`/agents/${doc.owner.agent_fk}#documents`)}
                                                data-testid={`document-owner-${doc.id}`}
                                            />
                                        ) : (
                                            <Chip label="unowned" size="small" color="error"
                                                  variant="outlined"
                                                  data-testid={`document-unowned-${doc.id}`} />
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                            {others.length === 0
                                                ? <Typography variant="caption" color="text.secondary">—</Typography>
                                                : others.map(l => (
                                                    <Chip
                                                        key={`${l.agent_fk}-${l.document_fk}`}
                                                        size="small"
                                                        label={`${agentIndex.get(l.agent_fk)?.name || `#${l.agent_fk}`} · ${relationshipLabel(l.relationship)}`}
                                                        {...relationshipChipProps(l.relationship)}
                                                        clickable
                                                        onClick={() => navigate(`/agents/${l.agent_fk}#documents`)}
                                                        data-testid={`document-${doc.id}-agent-${l.agent_fk}`}
                                                    />
                                                ))}
                                        </Stack>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Box>
        </Box>
    );
};

export default DocumentsPage;
