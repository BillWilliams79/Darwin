// /agents — the architect registry index (req #2998).
//
// Cards | Table toggle per memory/view-switchable-pages.md. Each agent shows its
// identity (name, model/effort pin, overview) plus anchor-chip counts that drill
// into the matching anchored section of /agents/:id — the req #2494 interlinking
// grammar used by requirements <-> sessions.

import '../index.css';
import { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import useMediaQuery from '@mui/material/useMediaQuery';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TableRowsIcon from '@mui/icons-material/TableRows';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import AuthContext from '../Context/AuthContext';
import {
    useAgents, useAgentDocuments, useAgentInstructions,
} from '../hooks/useDataQueries';
import { useViewPreference } from '../hooks/useViewPreference';
import { effortChipProps, effortLabel } from '../SwarmView/effortChipStyles';
import {
    linksByAgent, instructionLinksByAgent, agentCounts,
    agentModelChipProps, agentModelLabel,
} from './agentRegistryUtils';

const AgentsPage = () => {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();
    const isMobile = useMediaQuery('(max-width:899px)');
    const [view, setView] = useViewPreference('agents-view', 'cards');

    const creatorFk = profile?.userName;
    const { data: agents, isLoading } = useAgents(creatorFk);
    const { data: agentDocs } = useAgentDocuments(creatorFk);
    const { data: agentInstrs } = useAgentInstructions(creatorFk);

    const docLinks = useMemo(() => linksByAgent(agentDocs || []), [agentDocs]);
    const instrLinks = useMemo(
        () => instructionLinksByAgent(agentInstrs || []), [agentInstrs]);

    const rows = useMemo(() => {
        if (!agents) return [];
        return agents
            .filter(a => !a.closed)
            .map(a => ({ ...a, ...agentCounts(a.id, instrLinks, docLinks) }))
            .sort((a, b) =>
                (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) || a.id - b.id);
    }, [agents, instrLinks, docLinks]);

    // Drill-through: land on the detail page with the relevant section anchored.
    const openAgent = (id, hash = '') => navigate(`/agents/${id}${hash}`);

    const columns = useMemo(() => [
        { field: 'id', headerName: 'ID', width: 60 },
        {
            field: 'name',
            headerName: 'Agent',
            width: 200,
            renderCell: (p) => (
                <span data-testid={`agent-name-${p.row.id}`}>{p.value}</span>
            ),
        },
        {
            field: 'ai_model',
            headerName: 'Model',
            width: 110,
            renderCell: (p) => (
                <Chip label={agentModelLabel(p.value)} size="small" {...agentModelChipProps(p.value)} />
            ),
        },
        {
            field: 'effort',
            headerName: 'Effort',
            width: 100,
            renderCell: (p) => (
                <Chip label={effortLabel(p.value)} size="small" {...effortChipProps(p.value)} />
            ),
        },
        { field: 'instructions', headerName: 'Instructions', width: 110, type: 'number' },
        { field: 'documents', headerName: 'Documents', width: 110, type: 'number' },
        {
            field: 'autoload',
            headerName: 'Autoload',
            width: 100,
            type: 'number',
            description: 'Documents tagged autoload — read in full at boot',
        },
        { field: 'file_name', headerName: 'Stub', width: 200 },
        { field: 'overview', headerName: 'Overview', flex: 1, minWidth: 260 },
    ], []);

    if (isLoading || !agents) {
        return (
            <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}><CircularProgress /></Box>
        );
    }

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            {/* Canonical viewer header (req #3013): the view toggle is the stable
                far-left anchor, the title follows with `flex: 1` — mirrors Requirements
                and the other viewers. The Instructions/Documents links that used to sit
                here moved to the AGENTS navbar group. */}
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={view}
                    onChange={(_e, v) => setView(v)}
                    sx={{ flexShrink: 0 }}
                    data-testid="agents-view-toggle"
                >
                    <ToggleButton value="cards" aria-label="cards view">
                        <ViewModuleIcon fontSize="small" />
                    </ToggleButton>
                    <ToggleButton value="table" aria-label="table view">
                        <TableRowsIcon fontSize="small" />
                    </ToggleButton>
                </ToggleButtonGroup>
                <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ flex: 1 }}>Agents</Typography>
            </Box>

            {rows.length === 0 ? (
                <Typography color="text.secondary" sx={{ p: 2 }}>No agents registered</Typography>
            ) : view === 'table' ? (
                <Box sx={{ width: '100%' }} data-testid="agents-datagrid">
                    <DataGrid
                        autoHeight
                        rows={rows}
                        columns={columns}
                        onRowClick={(p) => openAgent(p.row.id)}
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{ toolbar: { showQuickFilter: true } }}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 25 } },
                            sorting: { sortModel: [{ field: 'id', sort: 'asc' }] },
                        }}
                        pageSizeOptions={[10, 25, 50, 100]}
                        disableRowSelectionOnClick
                        density="compact"
                        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
                    />
                </Box>
            ) : (
                <Box
                    data-testid="agents-cards"
                    sx={{
                        display: 'grid',
                        gap: 2,
                        gridTemplateColumns: {
                            xs: '1fr',
                            md: 'repeat(2, minmax(0, 1fr))',
                            xl: 'repeat(3, minmax(0, 1fr))',
                        },
                    }}
                >
                    {rows.map(a => (
                        <Card key={a.id} variant="outlined" data-testid={`agent-card-${a.id}`}>
                            <CardActionArea onClick={() => openAgent(a.id)}>
                                <CardContent>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                                        <Typography variant="h6" sx={{ fontSize: '1.05rem' }}
                                                    data-testid={`agent-name-${a.id}`}>
                                            {a.name}
                                        </Typography>
                                        <Stack direction="row" spacing={0.5}>
                                            <Chip label={agentModelLabel(a.ai_model)} size="small"
                                                  {...agentModelChipProps(a.ai_model)} />
                                            <Chip label={effortLabel(a.effort)} size="small"
                                                  {...effortChipProps(a.effort)} />
                                        </Stack>
                                    </Box>

                                    <Typography variant="body2" color="text.secondary"
                                                sx={{
                                                    mb: 1.5,
                                                    display: '-webkit-box',
                                                    WebkitLineClamp: 4,
                                                    WebkitBoxOrient: 'vertical',
                                                    overflow: 'hidden',
                                                }}>
                                        {a.overview}
                                    </Typography>
                                </CardContent>
                            </CardActionArea>

                            {/* Anchor chips sit OUTSIDE the CardActionArea: each drills to a
                                different anchored section, so nesting them inside a single
                                click target would swallow their own navigation. */}
                            <Box sx={{ px: 2, pb: 1.5 }}>
                                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                    <Chip
                                        size="small"
                                        label={`${a.instructions} instructions`}
                                        onClick={() => openAgent(a.id, '#instructions')}
                                        clickable
                                        data-testid={`agent-chip-instructions-${a.id}`}
                                    />
                                    <Chip
                                        size="small"
                                        label={`${a.documents} documents`}
                                        onClick={() => openAgent(a.id, '#documents')}
                                        clickable
                                        data-testid={`agent-chip-documents-${a.id}`}
                                    />
                                    <Chip
                                        size="small"
                                        color="primary"
                                        variant="outlined"
                                        label={`${a.autoload} autoload`}
                                        onClick={() => openAgent(a.id, '#documents')}
                                        clickable
                                        data-testid={`agent-chip-autoload-${a.id}`}
                                    />
                                </Stack>
                            </Box>
                        </Card>
                    ))}
                </Box>
            )}
        </Box>
    );
};

export default AgentsPage;
