// /swarm/testruns — Test Runs list (Cards + Table, req #2380 Phase 3).
// /swarm/testruns/:id — Test Run detail (inline result recording).

import { useState, useMemo, useContext, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {
    useAllTestRuns, useTestRunById, useTestResultsByRun,
    useAllTestCases, useAllTestPlans, useAllCategories,
} from '../hooks/useDataQueries';
import { testRunKeys, testResultKeys } from '../hooks/useQueryKeys';
import { useFeaturesFilterStore } from '../stores/useFeaturesFilterStore';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { recordTestResult, completeTestRun, abortTestRun } from './actions/validationApi';
import {
    runStatusChipProps, resultStatusChipProps,
    RUN_STATUS_ORDER, makeStatusComparator,
} from './statusChipStyles';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TableChartIcon from '@mui/icons-material/TableChart';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';

const VIEW_KEY = 'darwin-swarm-testruns-view';
const TABLE_WIDTH = 1050;
const formatDate = (v) => v ? new Date(v).toLocaleDateString() : '';
const formatDateTime = (v) => v ? new Date(v).toLocaleString() : '';

export function TestRunsPage() {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();
    const creatorFk = profile?.userName;

    const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'table');

    // Reuse the shared category filter (same store the other three pages use).
    // Runs don't have a direct category_fk; we filter via the plan's category_fk.
    const categoryFilter = useFeaturesFilterStore(s => s.categoryFilter);
    const setCategoryFilter = useFeaturesFilterStore(s => s.setCategoryFilter);

    const { data: runs = [], isLoading } = useAllTestRuns(creatorFk);
    const { data: plans = [] } = useAllTestPlans(creatorFk, { fields: 'id,title,category_fk' });
    const { data: categories = [] } = useAllCategories(creatorFk, {
        fields: 'id,category_name,color,project_fk,closed', closed: 0,
    });

    const planById = useMemo(() => {
        const m = {};
        for (const p of plans) m[p.id] = p;
        return m;
    }, [plans]);

    const categoryById = useMemo(() => {
        const m = {};
        for (const c of categories) m[c.id] = c;
        return m;
    }, [categories]);

    const filteredRuns = useMemo(() => {
        if (categoryFilter === null) return runs;
        return runs.filter(r => {
            const plan = planById[r.test_plan_fk];
            return plan && plan.category_fk === categoryFilter;
        });
    }, [runs, planById, categoryFilter]);

    const handleViewChange = (_e, newView) => {
        if (newView !== null) {
            setView(newView);
            localStorage.setItem(VIEW_KEY, newView);
        }
    };

    return (
        <Box className="app-content-planpage">
            <Box className="app-content-view-toggle"
                 sx={{
                     display: 'flex', alignItems: 'center', gap: 2,
                     mt: 3, mb: 1, px: 3, flexWrap: 'nowrap',
                     ...(view === 'cards' && { borderBottom: 1, borderColor: 'divider' }),
                     ...(view === 'table' && { maxWidth: TABLE_WIDTH }),
                 }}>
                <ToggleButtonGroup value={view} exclusive onChange={handleViewChange} size="small"
                                   sx={{ flexShrink: 0 }}
                                   data-testid="test-runs-view-toggle">
                    <Tooltip title="Cards View">
                        <ToggleButton value="cards" data-testid="view-toggle-cards" sx={{ px: 2 }}>
                            <ViewModuleIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                    <Tooltip title="Table View">
                        <ToggleButton value="table" data-testid="view-toggle-table" sx={{ px: 2 }}>
                            <TableChartIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                </ToggleButtonGroup>
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }} data-testid="category-filter">
                    <Chip label="All" size="small"
                          onClick={() => setCategoryFilter(null)}
                          color={categoryFilter === null ? 'primary' : 'default'}
                          variant={categoryFilter === null ? 'filled' : 'outlined'}
                          sx={{ cursor: 'pointer' }} />
                    {categories.map(c => {
                        const selected = categoryFilter === c.id;
                        return (
                            <Chip key={c.id} label={c.category_name} size="small"
                                  onClick={() => setCategoryFilter(c.id)}
                                  color={selected ? 'primary' : 'default'}
                                  variant={selected ? 'filled' : 'outlined'}
                                  sx={{
                                      cursor: 'pointer',
                                      ...(c.color && { borderColor: c.color }),
                                      ...(!selected && { opacity: 0.6 }),
                                  }}
                                  data-testid={`category-chip-${c.id}`} />
                        );
                    })}
                </Stack>
                {view === 'table' && <Box sx={{ flexGrow: 1 }} />}
            </Box>

            {isLoading
                ? <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>
                : view === 'table'
                    ? (
                        <Box className="app-content-tabpanel" sx={{ px: 3, pt: 0, maxWidth: TABLE_WIDTH }}>
                            <TestRunsTableView runs={filteredRuns} planById={planById} onOpen={navigate} />
                        </Box>
                    )
                    : (
                        <Box className="app-content-tabpanel" sx={{ p: 3 }}>
                            <TestRunsCardsView runs={filteredRuns} planById={planById}
                                                 categoryById={categoryById} onOpen={navigate} />
                        </Box>
                    )
            }
        </Box>
    );
}

function TestRunsTableView({ runs, planById, onOpen }) {
    const columns = [
        { field: 'id', headerName: 'ID', width: 70, type: 'number' },
        {
            field: 'plan_title', headerName: 'Plan', flex: 1, minWidth: 220,
            valueGetter: (_v, row) => planById[row.test_plan_fk]?.title || `Plan ${row.test_plan_fk}`,
        },
        {
            field: 'run_status', headerName: 'Status', width: 140,
            sortComparator: makeStatusComparator(RUN_STATUS_ORDER),
            renderCell: (p) => (
                <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    <Chip label={p.value} size="small" {...runStatusChipProps(p.value)}
                          sx={{ textTransform: 'capitalize' }} />
                </Box>
            ),
        },
        { field: 'started_at', headerName: 'Started', width: 180, valueFormatter: formatDateTime },
        { field: 'completed_at', headerName: 'Completed', width: 180,
            valueFormatter: (v) => v ? new Date(v).toLocaleString() : '—' },
        { field: 'notes', headerName: 'Notes', width: 180 },
    ];
    return (
        <DataGrid
            rows={runs}
            columns={columns}
            rowHeight={52}
            density="compact"
            slots={{ toolbar: GridToolbar }}
            slotProps={{ toolbar: { showQuickFilter: true } }}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            pageSizeOptions={[25, 50, 100]}
            onRowClick={(p) => onOpen(`/swarm/testruns/${p.row.id}`)}
            sx={{ cursor: 'pointer' }}
            data-testid="test-runs-datagrid"
        />
    );
}

function TestRunsCardsView({ runs, planById, categoryById, onOpen }) {
    // Group by plan. Apply the plan's category color as the card's left border
    // so runs inherit their plan's visual treatment (matches the other pages).
    const byPlan = useMemo(() => {
        const g = {};
        for (const r of runs) {
            const k = r.test_plan_fk || 'orphan';
            (g[k] = g[k] || []).push(r);
        }
        return g;
    }, [runs]);
    if (runs.length === 0) {
        return <Typography sx={{ color: 'text.secondary' }}>No test runs match the current filters.</Typography>;
    }
    return (
        <Stack spacing={2} data-testid="test-runs-cards-view">
            {Object.entries(byPlan).map(([planId, group]) => {
                const plan = planById[planId];
                const cat = plan ? categoryById?.[plan.category_fk] : null;
                return (
                    <Card key={planId} variant="outlined"
                          sx={cat?.color ? { borderLeft: `4px solid ${cat.color}` } : undefined}
                          data-testid={`test-runs-card-${planId}`}>
                        <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                            <Typography variant="h6" sx={{ mb: 1 }}>
                                {plan?.title || `Plan ${planId}`}
                                <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                                    ({group.length} run{group.length !== 1 ? 's' : ''})
                                </Typography>
                            </Typography>
                            <Stack spacing={0.5}>
                                {group.map(r => (
                                    <Box key={r.id}
                                         sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75,
                                                border: 1, borderColor: 'divider', borderRadius: 1,
                                                cursor: 'pointer',
                                                '&:hover': { bgcolor: 'action.hover' } }}
                                         onClick={() => onOpen(`/swarm/testruns/${r.id}`)}
                                         data-testid={`test-run-row-${r.id}`}>
                                        <Typography sx={{ minWidth: 60 }}>#{r.id}</Typography>
                                        <Chip label={r.run_status} size="small"
                                              {...runStatusChipProps(r.run_status)}
                                              sx={{ textTransform: 'capitalize' }} />
                                        <Typography variant="caption" sx={{ flex: 1, color: 'text.secondary' }}>
                                            {r.notes || '—'}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                            {formatDateTime(r.started_at)}
                                        </Typography>
                                    </Box>
                                ))}
                            </Stack>
                        </CardContent>
                    </Card>
                );
            })}
        </Stack>
    );
}

// =============================================================================
// Run detail (unchanged structure, minor chip cleanup)
// =============================================================================

export function TestRunDetail() {
    const { id } = useParams();
    const runId = parseInt(id);
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const navigate = useNavigate();
    const creatorFk = profile?.userName;

    const { data: runData, isLoading: loadingRun } = useTestRunById(creatorFk, runId);
    const { data: results = [], isLoading: loadingResults } = useTestResultsByRun(creatorFk, runId);
    const { data: allTestCases = [] } = useAllTestCases(creatorFk, {
        fields: 'id,title,test_type',
    });

    const run = Array.isArray(runData) ? runData[0] : runData;

    const testCasesById = useMemo(() => {
        const m = {};
        for (const tc of allTestCases) m[tc.id] = tc;
        return m;
    }, [allTestCases]);

    const counts = useMemo(() => {
        const c = { passed: 0, failed: 0, blocked: 0, skipped: 0, not_run: 0 };
        for (const r of results) c[r.result_status] = (c[r.result_status] || 0) + 1;
        return c;
    }, [results]);

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: testResultKeys.byRun(creatorFk, runId) });
        queryClient.invalidateQueries({ queryKey: testRunKeys.byId(creatorFk, runId) });
    };

    const updateResult = async (resultId, fields) => {
        try {
            await recordTestResult(darwinUri, idToken, resultId, fields);
            invalidate();
        } catch (e) {
            showError(e, 'Could not record result');
        }
    };

    const handleComplete = async () => {
        try {
            await completeTestRun(darwinUri, idToken, runId);
            invalidate();
            queryClient.invalidateQueries({ queryKey: testRunKeys.all(creatorFk) });
        } catch (e) {
            showError(e, 'Could not complete run');
        }
    };

    const handleAbort = async () => {
        if (!window.confirm('Abort this run? Outstanding not_run results will stay as-is.')) return;
        try {
            await abortTestRun(darwinUri, idToken, runId);
            invalidate();
            queryClient.invalidateQueries({ queryKey: testRunKeys.all(creatorFk) });
        } catch (e) {
            showError(e, 'Could not abort run');
        }
    };

    if (loadingRun || loadingResults) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>;
    }
    if (!run) return <Typography sx={{ p: 3 }}>Run not found.</Typography>;

    const isTerminal = run.run_status === 'completed' || run.run_status === 'aborted';
    const rp = runStatusChipProps(run.run_status);

    return (
        <Box className="app-content-planpage" sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'nowrap',
                          overflowX: 'auto' }}>
                <Button size="small" onClick={() => navigate('/swarm/testruns')}>← Back</Button>
                <Typography variant="h5" sx={{ flexShrink: 0 }}>Run #{run.id}</Typography>
                <Chip label={run.run_status} size="small" {...rp}
                      sx={{ textTransform: 'capitalize' }} />
                <Box sx={{ flexGrow: 1 }} />
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                    <Chip size="small" label={`Passed ${counts.passed}`} color="success" />
                    <Chip size="small" label={`Failed ${counts.failed}`} color="error" />
                    <Chip size="small" label={`Blocked ${counts.blocked}`} color="warning" />
                    <Chip size="small" label={`Skipped ${counts.skipped}`} />
                    <Chip size="small" label={`Not run ${counts.not_run}`} variant="outlined" />
                </Stack>
                {!isTerminal && (
                    <>
                        <Button variant="outlined" color="error" onClick={handleAbort}
                                startIcon={<CancelIcon />} sx={{ flexShrink: 0 }}
                                data-testid="abort-run-btn">Abort</Button>
                        <Button variant="contained" onClick={handleComplete}
                                startIcon={<CheckCircleIcon />} sx={{ flexShrink: 0 }}
                                data-testid="complete-run-btn">Complete Run</Button>
                    </>
                )}
            </Box>

            <Stack spacing={1} data-testid="run-results-list">
                {results.map(r => (
                    <TestResultRow
                        key={r.id}
                        result={r}
                        testCase={testCasesById[r.test_case_fk]}
                        isTerminal={isTerminal}
                        onSave={updateResult}
                    />
                ))}
                {results.length === 0 &&
                    <Typography sx={{ p: 3 }}>No results for this run yet. Cases are seeded as not_run when the run starts.</Typography>
                }
            </Stack>
        </Box>
    );
}

/**
 * Per-result editor row with LOCAL state on Actual + Notes (save on blur) so we
 * don't fire a PUT + refetch on every keystroke. The status dropdown stays
 * eager-save (discrete choice, no typing race). Code-review finding for req #2380.
 */
function TestResultRow({ result, testCase, isTerminal, onSave }) {
    const rsp = resultStatusChipProps(result.result_status);
    const [actualDraft, setActualDraft] = useState(result.actual || '');
    const [notesDraft, setNotesDraft] = useState(result.notes || '');

    // Re-sync drafts only when the row identity changes (e.g., refetch after status change);
    // mid-typing edits within the same row are preserved.
    useEffect(() => {
        setActualDraft(result.actual || '');
        setNotesDraft(result.notes || '');
    }, [result.id]);

    const saveActual = () => {
        if (actualDraft === (result.actual || '')) return;
        onSave(result.id, {
            result_status: result.result_status,
            actual: actualDraft,
            notes: result.notes,
        });
    };
    const saveNotes = () => {
        if (notesDraft === (result.notes || '')) return;
        onSave(result.id, {
            result_status: result.result_status,
            actual: result.actual,
            notes: notesDraft,
        });
    };

    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2,
                    display: 'flex', flexDirection: 'column', gap: 1 }}
             data-testid={`result-row-${result.id}`}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Chip size="small" label={result.result_status} {...rsp}
                      sx={{ textTransform: 'capitalize', minWidth: 80 }} />
                <Typography sx={{ flex: 1, fontWeight: 500 }}>
                    {testCase?.title || `Test case ${result.test_case_fk}`}
                </Typography>
                <FormControl size="small" sx={{ minWidth: 140 }} disabled={isTerminal}>
                    <Select value={result.result_status}
                            onChange={e => onSave(result.id, {
                                result_status: e.target.value,
                                actual: result.actual,
                                notes: result.notes,
                            })}
                            data-testid={`result-status-${result.id}`}>
                        <MenuItem value="not_run">not_run</MenuItem>
                        <MenuItem value="passed">passed</MenuItem>
                        <MenuItem value="failed">failed</MenuItem>
                        <MenuItem value="blocked">blocked</MenuItem>
                        <MenuItem value="skipped">skipped</MenuItem>
                    </Select>
                </FormControl>
            </Box>
            <TextField size="small" label="Actual" value={actualDraft}
                       onChange={e => setActualDraft(e.target.value)}
                       onBlur={saveActual}
                       multiline minRows={1} disabled={isTerminal}
                       inputProps={{ 'data-testid': `result-actual-${result.id}` }} />
            <TextField size="small" label="Notes" value={notesDraft}
                       onChange={e => setNotesDraft(e.target.value)}
                       onBlur={saveNotes}
                       multiline minRows={1} disabled={isTerminal}
                       inputProps={{ 'data-testid': `result-notes-${result.id}` }} />
        </Box>
    );
}
