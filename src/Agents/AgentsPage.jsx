// /agents — the architect registry index (req #2998).
//
// Cards | Table toggle per memory/view-switchable-pages.md. Each agent shows its
// identity (name, model/effort pin, overview) plus anchor-chip counts that drill
// into the matching anchored section of /agents/:id — the req #2494 interlinking
// grammar used by requirements <-> sessions.
//
// Req #3067 converted the hand-rolled header to the shared ViewerHeader and fixed
// three pieces of drift this page had accumulated as the codebase's oldest viewer:
//   1. It was the SINGLE file using TableRowsIcon for a table toggle; TableChartIcon
//      is canon (view-switchable-pages.md § C R3) and is what ten other files use.
//   2. Its view-preference key was `agents-view`, violating V8's
//      `darwin-<feature>-view` shape. Changed with no migration shim: anyone who had
//      selected Table is reset to Cards exactly once, which is cheaper than a
//      compatibility branch that would live forever.
//   3. It filtered closed agents out of its own list UNCONDITIONALLY, with no count
//      and no way to reveal them — so a user looking at twelve rows could not tell
//      whether that was all of them. That is precisely the drift V7's accounting
//      line exists to make legible, and both sibling /agents/* pages already fixed
//      it. The line and its Closed chip arrive together on purpose: an accounting
//      line that names a hidden set with no way to see it is worse than silence.

import '../index.css';
import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import useMediaQuery from '@mui/material/useMediaQuery';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TableChartIcon from '@mui/icons-material/TableChart';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import AuthContext from '../Context/AuthContext';
import ViewerHeader from '../Components/ViewerHeader/ViewerHeader';
import { normalizeView } from '../Components/ViewerHeader/normalizeView';
import {
    useAgents, useAgentDocuments, useAgentInstructions,
} from '../hooks/useDataQueries';
import { useViewPreference } from '../hooks/useViewPreference';
import { effortChipProps, effortLabel } from '../SwarmView/effortChipStyles';
import {
    linksByAgent, instructionLinksByAgent, agentCounts,
    agentModelChipProps, agentModelLabel,
} from './agentRegistryUtils';

const VIEWS = [
    { value: 'cards', label: 'Cards view', icon: ViewModuleIcon },
    { value: 'table', label: 'Table view', icon: TableChartIcon },
];

const AgentsPage = () => {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();
    const isMobile = useMediaQuery('(max-width:899px)');
    const [view, setView] = useViewPreference('darwin-agents-view', 'cards');
    const activeView = normalizeView(view, VIEWS);
    const [showClosed, setShowClosed] = useState(false);

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
            .filter(a => showClosed || !a.closed)
            .map(a => ({ ...a, ...agentCounts(a.id, instrLinks, docLinks) }))
            // Closed agents last regardless of catalog order: a closed agent never
            // boots, so it never belongs above one that does.
            .sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0)
                || (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
                || a.id - b.id);
    }, [agents, instrLinks, docLinks, showClosed]);

    const hasClosed = useMemo(() => (agents || []).some(a => a.closed), [agents]);

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
        // Only reachable once the Closed filter is on, but the column is always
        // present: a row list that can contain closed rows and cannot say which
        // they are is the drift the accounting line was added to stop.
        { field: 'closed', headerName: 'Closed', width: 90, type: 'boolean' },
        { field: 'overview', headerName: 'Overview', flex: 1, minWidth: 260 },
    ], []);

    if (isLoading || !agents) {
        return (
            <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}><CircularProgress /></Box>
        );
    }

    // V7 — counted over the WHOLE registry, never the filtered rows.
    const openCount = agents.filter(a => !a.closed).length;
    const closedCount = agents.length - openCount;

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            {/* The Instructions/Documents links that used to sit here moved to the
                AGENTS navbar group. */}
            <ViewerHeader
                title="Agents"
                views={VIEWS}
                view={activeView}
                onViewChange={setView}
                testIdPrefix="agents"
                filters={hasClosed && (
                    <Tooltip title={showClosed ? 'Hide closed agents' : 'Show closed agents'}>
                        <Chip
                            label="Closed"
                            size="small"
                            color={showClosed ? 'primary' : 'default'}
                            variant={showClosed ? 'filled' : 'outlined'}
                            onClick={() => setShowClosed(v => !v)}
                            sx={{ cursor: 'pointer', flexShrink: 0 }}
                            data-testid="agents-show-closed"
                        />
                    </Tooltip>
                )}
                accounting={[
                    `${openCount} agent${openCount === 1 ? '' : 's'}`,
                    closedCount > 0 && `${closedCount} closed`,
                ].filter(Boolean).join(' · ')}
            />

            {rows.length === 0 ? (
                <Typography color="text.secondary" sx={{ p: 2 }}>
                    {/* "No agents registered" would contradict the accounting line
                        directly above it when every agent is closed and the filter is
                        off — it reads `0 agents · 12 closed`, so there plainly ARE
                        agents. Say which of the two situations this is. */}
                    {closedCount > 0
                        ? 'No open agents — turn on the Closed filter to see the retired ones'
                        : 'No agents registered'}
                </Typography>
            ) : activeView === 'table' ? (
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
                        // Closed rows carry `opacity: 0.55` in the card view; without
                        // this the Closed column would be the table's only signal,
                        // and the two views would disagree about how retired reads.
                        getRowClassName={(p) => (p.row.closed ? 'agent-row--closed' : '')}
                        sx={{
                            '& .MuiDataGrid-row': { cursor: 'pointer' },
                            '& .agent-row--closed .MuiDataGrid-cell': { opacity: 0.55 },
                        }}
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
                        <Card key={a.id} variant="outlined"
                              sx={a.closed ? { opacity: 0.55 } : undefined}
                              data-testid={`agent-card-${a.id}`}>
                            <CardActionArea onClick={() => openAgent(a.id)}>
                                <CardContent>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                                        <Typography variant="h6" sx={{ fontSize: '1.05rem' }}
                                                    data-testid={`agent-name-${a.id}`}>
                                            {a.name}
                                        </Typography>
                                        <Stack direction="row" spacing={0.5}>
                                            {/* `!!` is load-bearing: `closed` is a MySQL
                                                TINYINT, so it arrives as the NUMBER 0, and
                                                `0 && <Chip/>` evaluates to 0 — which React
                                                renders as a literal "0" beside the chips. */}
                                            {!!a.closed && (
                                                <Chip label="closed" size="small"
                                                      data-testid={`agent-closed-${a.id}`} />
                                            )}
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
