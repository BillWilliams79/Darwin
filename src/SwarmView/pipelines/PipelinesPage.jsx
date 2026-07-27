// PipelinesPage.jsx — /swarm/pipelines (req #3114).
//
// The orchestrator of a view-switchable page per memory/view-switchable-pages.md:
// the `.app-content-planpage` CSS grid, an icon-only ToggleButtonGroup pinned
// FIRST and LEFT (R8), shared controls beside it, the flexGrow spacer LAST, and
// exactly one view component rendered at a time. View state comes from
// useViewPreference (R1/V8) under `darwin-swarm-pipelines-view`.
//
// Both views are fed the SAME pre-filtered rows and the SAME derived summaries
// (R5) — switching views re-renders, never re-fetches.

import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';

import AuthContext from '../../Context/AuthContext';
import {
    useAllPipelineStepRequirements,
    useAllPipelineSteps,
    useAllPipelines,
    useAllRequirements,
    useMachines,
} from '../../hooks/useDataQueries';
import { useViewPreference } from '../../hooks/useViewPreference';
import normalizeView from '../../Components/ViewerHeader/normalizeView';
import PipelineCardsView from './PipelineCardsView';
import PipelinesTableView from './PipelinesTableView';
import { pipelineStatusChipProps, PIPELINE_STATUS_VALUES } from './pipelineChipStyles';
import { PLAN_REQUIREMENT_FIELDS, pipelineSummaries } from './pipelineViewModel';

const VIEW_STORAGE_KEY = 'darwin-swarm-pipelines-view';

const VIEWS = [
    { value: 'cards', label: 'Cards', icon: ViewModuleIcon },
    { value: 'table', label: 'Table', icon: TableChartIcon },
];

export default function PipelinesPage() {
    const navigate = useNavigate();
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const [view, setView] = useViewPreference(VIEW_STORAGE_KEY, 'cards');
    const activeView = normalizeView(view, VIEWS);
    const [statusFilter, setStatusFilter] = useState(null);

    const { data: pipelines = [], isLoading: pipelinesLoading } = useAllPipelines(creatorFk);
    const { data: steps = [], isLoading: stepsLoading } = useAllPipelineSteps(creatorFk);
    const { data: stepRequirements = [], isLoading: linksLoading } =
        useAllPipelineStepRequirements(creatorFk);
    // The SAME projection the detail page requests. `useAllRequirements` puts
    // `fields` in its cache key, so a narrower one here would be a second cache
    // entry — and clicking into a plan would refetch the whole requirements table
    // rather than rendering from the read this page already paid for.
    const { data: requirements = [], isLoading: reqsLoading } =
        useAllRequirements(creatorFk, { fields: PLAN_REQUIREMENT_FIELDS });
    const { data: machines = [], isLoading: machinesLoading } = useMachines(creatorFk);

    // Every read that feeds a NUMBER OR A LABEL gates the spinner. `pipelines` is
    // one row and resolves first; the requirements read is the whole table and
    // resolves last — so gating on pipelines alone paints "0 steps · 0 complete"
    // and an empty progress bar over a 34-step plan on essentially every cold
    // load, then snaps to the real figures. A wrong number is not a loading
    // state, and neither is a machine rendered as a bare id.
    const isLoading = pipelinesLoading || stepsLoading || linksLoading
        || reqsLoading || machinesLoading;

    const summaries = useMemo(
        () => pipelineSummaries({ pipelines, steps, stepRequirements, requirements }),
        [pipelines, steps, stepRequirements, requirements]);

    const filtered = useMemo(
        () => (statusFilter === null
            ? pipelines
            : pipelines.filter((p) => p.pipeline_status === statusFilter)),
        [pipelines, statusFilter]);

    const open = (id) => navigate(`/swarm/pipeline/${id}`);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box className="app-content-planpage">
            <Box className="app-content-view-toggle"
                 sx={{ display: 'flex', alignItems: 'center', gap: 2,
                        mt: 3, mb: 1, px: 3, flexWrap: 'wrap' }}>
                <ToggleButtonGroup
                    value={activeView}
                    exclusive
                    onChange={(_e, v) => setView(v)}
                    size="small"
                    sx={{ flexShrink: 0 }}
                    data-testid="pipelines-view-toggle"
                >
                    {VIEWS.map(({ value, label, icon: Icon }) => (
                        <ToggleButton key={value} value={value} sx={{ px: 2 }}
                                      data-testid={`view-toggle-${value}`}>
                            <Tooltip title={`${label} View`}>
                                <Icon fontSize="small" />
                            </Tooltip>
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>

                {/* Shared control — filters BOTH views (R4/R5). Local state is
                    sufficient: nothing outside this page reads it, so a Zustand
                    store would be ceremony without a second consumer. */}
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}
                       data-testid="pipelines-status-filter">
                    <Chip label="All" size="small"
                          onClick={() => setStatusFilter(null)}
                          color={statusFilter === null ? 'primary' : 'default'}
                          variant={statusFilter === null ? 'filled' : 'outlined'}
                          sx={{ cursor: 'pointer' }}
                          data-testid="pipelines-status-chip-all" />
                    {PIPELINE_STATUS_VALUES.map((v) => {
                        const selected = statusFilter === v;
                        const props = pipelineStatusChipProps(v);
                        return (
                            <Chip key={v} label={v} size="small"
                                  onClick={() => setStatusFilter(v)}
                                  variant={selected ? 'filled' : 'outlined'}
                                  sx={{ cursor: 'pointer',
                                         ...(selected && props.sx ? props.sx : {}),
                                         ...(!selected && props.sx
                                             ? { borderColor: props.sx.bgcolor, opacity: 0.75 }
                                             : {}) }}
                                  data-testid={`pipelines-status-chip-${v}`} />
                        );
                    })}
                </Stack>

                {/* Accounting line counts the WHOLE dataset, with the filtered
                    subset named separately (V7). The call-to-action names what
                    the ACTIVE view actually shows — "click a row" is wrong
                    advice in Cards, where the click target is a card. */}
                <Typography variant="caption" sx={{ color: 'text.secondary' }}
                            data-testid="pipelines-accounting">
                    {filtered.length} of {pipelines.length} pipeline
                    {pipelines.length === 1 ? '' : 's'} — click a{' '}
                    {activeView === 'table' ? 'row' : 'card'} for the plan
                </Typography>

                <Box sx={{ flexGrow: 1 }} />
            </Box>

            <Box className="app-content-tabpanel" sx={{ px: 3, pt: 0 }}>
                {activeView === 'table' ? (
                    <PipelinesTableView
                        pipelines={filtered}
                        summaries={summaries}
                        machines={machines}
                        timezone={timezone}
                        onOpen={open}
                    />
                ) : (
                    <PipelineCardsView
                        pipelines={filtered}
                        summaries={summaries}
                        machines={machines}
                        onOpen={open}
                        filtered={statusFilter !== null}
                    />
                )}
            </Box>
        </Box>
    );
}
