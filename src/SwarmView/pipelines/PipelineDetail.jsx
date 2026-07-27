// PipelineDetail.jsx — /swarm/pipeline/:id (req #3114).
//
// The header, the Table|Plan mode switcher (fed by pipelineDetailModes.js so
// req #3115 adds its visualizer without touching this file), and the active
// mode's panel.
//
// DATA: four bounded list reads + three dictionary reads, joined client-side in
// one useMemo (design rule 5 — the POC's ~86 per-requirement fetches took 2–3
// minutes per regeneration). Arriving from /swarm/pipelines every one of those
// queries is already warm, so the plan paints from cache with zero fetches —
// memory/detail-page-interlinking.md's composition rule, which is also why this
// page adds NO endpoint of its own.
//
// REFRESH is event-driven (design rule 6): the query client's staleTime +
// refetchOnWindowFocus + invalidation already do it. Deliberately no
// refetchInterval — a poll here would be the POC's manual regenerate step wearing
// a different hat.

import { useContext, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import AuthContext from '../../Context/AuthContext';
import {
    ALL_ROWS,
    useAllEpics,
    useAllFeatures,
    useAllPipelineStepDeps,
    useAllPipelineStepRequirements,
    useAllPipelineSteps,
    useAllPipelines,
    useAllRequirements,
    useMachines,
} from '../../hooks/useDataQueries';
import { useViewPreference } from '../../hooks/useViewPreference';
import normalizeView from '../../Components/ViewerHeader/normalizeView';
import { formatDateTime } from '../../utils/dateFormat';
import {
    PIPELINE_DETAIL_MODES,
    PIPELINE_DETAIL_MODE_STORAGE_KEY,
    DEFAULT_PIPELINE_DETAIL_MODE,
    findPipelineDetailMode,
} from './pipelineDetailModes';
import { pipelineStatusChipProps } from './pipelineChipStyles';
import {
    PLAN_REQUIREMENT_FIELDS,
    buildPipelineModel,
    machineTitle,
    orderedPlan,
    pipelineSummary,
} from './pipelineViewModel';

export default function PipelineDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;
    const pipelineId = Number(id);

    const [mode, setMode] = useViewPreference(
        PIPELINE_DETAIL_MODE_STORAGE_KEY, DEFAULT_PIPELINE_DETAIL_MODE);
    const activeMode = normalizeView(mode, PIPELINE_DETAIL_MODES);

    // The list read, not a by-id read: /swarm/pipelines has already primed this
    // exact cache entry, so arriving here costs nothing. A by-id hook would be a
    // second cache entry and a guaranteed fetch on every navigation.
    const { data: pipelines = [], isLoading: pipelinesLoading } = useAllPipelines(creatorFk);
    const { data: steps = [], isLoading: stepsLoading } = useAllPipelineSteps(creatorFk);
    const { data: stepRequirements = [], isLoading: linksLoading } =
        useAllPipelineStepRequirements(creatorFk);
    const { data: stepDeps = [], isLoading: depsLoading } = useAllPipelineStepDeps(creatorFk);
    const { data: requirements = [], isLoading: reqsLoading } =
        useAllRequirements(creatorFk, { fields: PLAN_REQUIREMENT_FIELDS });
    // Labels are a DICTIONARY here, not a catalog: closed epics/features must
    // still resolve or the plan blanks a column it has data for.
    const { data: features = [], isLoading: featuresLoading, isError: featuresError } =
        useAllFeatures(creatorFk, { closed: ALL_ROWS });
    const { data: epics = [], isLoading: epicsLoading, isError: epicsError } =
        useAllEpics(creatorFk);
    const { data: machines = [], isLoading: machinesLoading, isError: machinesError } =
        useMachines(creatorFk);

    // EVERY read gates the render, the three label dictionaries included. They are
    // not decoration: `displayOrder()` breaks ties on epic first-appearance order,
    // so rendering before features/epics resolve produces a DIFFERENT, silently
    // wrong row order — and one that verifyOrder() accepts, because a plan with no
    // epics violates no invariant. The one failure mode design rule 3's self-check
    // cannot catch is the one where the inputs, not the algorithm, are wrong.
    const isLoading = pipelinesLoading || stepsLoading || linksLoading
        || depsLoading || reqsLoading || featuresLoading || epicsLoading || machinesLoading;

    // Same argument, one step further: `fetchEntity` turns a 404 into `[]` and a
    // 5xx leaves `data` undefined, so a FAILED dictionary read is indistinguishable
    // from an empty one and would ship that wrong order permanently, with blank
    // Epic/Feature columns and numeric machine ids as its only symptoms. Say so.
    const dictionaryError = featuresError || epicsError || machinesError;

    const pipeline = useMemo(
        () => pipelines.find((p) => p.id === pipelineId) || null,
        [pipelines, pipelineId]);

    const model = useMemo(() => buildPipelineModel({
        pipeline, steps, stepRequirements, stepDeps, requirements, features, epics, machines,
    }), [pipeline, steps, stepRequirements, stepDeps, requirements, features, epics, machines]);

    // `now` is read ONCE per model change and handed to the engine, which never
    // reads a clock itself. Time-gate eligibility therefore re-evaluates when the
    // data does — on focus, on invalidation — rather than on a timer.
    const plan = useMemo(() => orderedPlan(model, { now: new Date() }), [model]);
    const summary = useMemo(() => pipelineSummary(plan.rows), [plan.rows]);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!pipeline) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="warning" data-testid="pipeline-not-found">
                    No pipeline with id {pipelineId}.{' '}
                    <Link component="button" variant="body2"
                          onClick={() => navigate('/swarm/pipelines')}>
                        Back to pipelines
                    </Link>
                </Alert>
            </Box>
        );
    }

    const ActiveComponent = (findPipelineDetailMode(activeMode)
        || PIPELINE_DETAIL_MODES[0]).Component;

    return (
        <Box sx={{ p: 3 }} data-testid="pipeline-detail">
            <Breadcrumbs sx={{ mb: 1 }}>
                <Link component="button" variant="body2" underline="hover"
                      onClick={() => navigate('/swarm/pipelines')}
                      data-testid="pipeline-breadcrumb-list">
                    Pipelines
                </Link>
                <Typography variant="body2" color="text.primary">{pipeline.title}</Typography>
            </Breadcrumbs>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
                        mb: 1 }}>
                <ToggleButtonGroup
                    value={activeMode}
                    exclusive
                    onChange={(_e, v) => setMode(v)}
                    size="small"
                    sx={{ flexShrink: 0 }}
                    data-testid="pipeline-detail-mode-toggle"
                >
                    {PIPELINE_DETAIL_MODES.map(({ value, label, icon: Icon, disabled }) => (
                        <ToggleButton key={value} value={value} disabled={disabled}
                                      sx={{ px: 2 }}
                                      data-testid={`pipeline-mode-${value}`}>
                            <Tooltip title={`${label} view`}>
                                <Icon fontSize="small" />
                            </Tooltip>
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>

                <Typography variant="h6" sx={{ flex: 1 }} data-testid="pipeline-title">
                    {pipeline.title}
                </Typography>

                <Chip size="small" label={pipeline.pipeline_status}
                      {...pipelineStatusChipProps(pipeline.pipeline_status)}
                      data-testid="pipeline-status-chip" />
                <Chip size="small" variant="outlined"
                      label={machineTitle(pipeline.machine_fk, machines)}
                      data-testid="pipeline-machine-chip" />
            </Box>

            {pipeline.description && (
                <Typography variant="body2" color="text.secondary"
                            sx={{ mb: 1, maxWidth: 900 }}
                            data-testid="pipeline-goal">
                    {pipeline.description}
                </Typography>
            )}

            {/* Accounting line — the whole plan, never the filtered view
                (view-switchable-pages § V7). */}
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}
                   alignItems="center" data-testid="pipeline-accounting">
                <Typography variant="body2" color="text.secondary">
                    {summary.total} step{summary.total === 1 ? '' : 's'} —{' '}
                    {summary.done} complete · {summary.running} running ·{' '}
                    {summary.pending} scheduled
                </Typography>
                {pipeline.started_at && (
                    <Typography variant="body2" color="text.secondary">
                        · started {formatDateTime(pipeline.started_at, timezone)}
                    </Typography>
                )}
                {pipeline.completed_at && (
                    <Typography variant="body2" color="text.secondary">
                        · completed {formatDateTime(pipeline.completed_at, timezone)}
                    </Typography>
                )}
            </Stack>

            {dictionaryError && (
                <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
                       data-testid="pipeline-dictionary-error">
                    The epic, feature or machine list failed to load. Epic and Feature
                    columns will be blank, machines will read as bare ids, and the ROW
                    ORDER is computed with those labels missing — it is not the plan&apos;s
                    real order. Reload before acting on this page.
                </Alert>
            )}

            <ActiveComponent plan={plan} model={model} pipeline={pipeline} timezone={timezone} />
        </Box>
    );
}
