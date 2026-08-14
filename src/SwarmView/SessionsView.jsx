import '../index.css';
import AuthContext from '../Context/AuthContext';
import { useSessions, useDevServers, useAllSwarmStartSessions, useMachines, useAllPipelines } from '../hooks/useDataQueries';
import { useShowClosedStore, ALL_SESSION_STATUSES } from '../stores/useShowClosedStore';
import { useViewPreference } from '../hooks/useViewPreference';
import { formatDate, formatHM12 } from '../utils/dateFormat';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import { swarmStatusChipProps, swarmStatusLabel } from './swarmStatusChipProps';
import { machineChipProps, machineLabel, UNASSIGNED_MACHINE } from './machineChipStyles';
import { terminalFocusState } from './terminalFocus';
import { sessionPipelineLink } from './sessionPipelineLink';
import TerminalChip from './TerminalChip';
import ModelEffortPill from './ModelEffortPill';
import ChipFilter from '../Components/ChipFilter';
import { aiModelLabel } from './modelChipStyles';
import { effortLabel } from './effortChipStyles';
import { formatDuration } from '../utils/formatDuration';
import SessionsStatsView from './SessionsStatsView';
import React, { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import TableChartIcon from '@mui/icons-material/TableChart';
import BarChartIcon from '@mui/icons-material/BarChart';
import useMediaQuery from '@mui/material/useMediaQuery';
import { CircularProgress, Typography } from '@mui/material';

const SESSIONS_VIEW_STORAGE_KEY = 'darwin-swarm-sessions-view';

// The session LIFECYCLE, in order, as DISPLAY LABELS — what the Status column
// sorts on:
//   starting -> [waiting | planning] -> active -> review -> paused ->
//   completing -> completed
//
// Declared here rather than derived from ALL_SESSION_STATUSES, which looks like
// the same list but is not: that one is FILTER-CHIP order and puts `paused`
// last, after `completed`. Two different questions — which order to offer the
// chips in, and which order the work actually moves through — so they get two
// lists instead of one that silently serves the wrong one.
const SWARM_STATUS_ORDER = [
    'starting', 'waiting', 'planning', 'active', 'review',
    'paused', 'completing', 'completed',
].map(swarmStatusLabel);

// req #2992 — status vocabulary is fixed, so its options are module-level.
// swarmStatusChipProps supplies the semantic colors; the ChipFilter palette is
// not consulted for this dimension.
const sessionStatusOptions = ALL_SESSION_STATUSES.map(status => ({
    value: status,
    label: swarmStatusLabel(status),
    chipProps: swarmStatusChipProps(status),
}));

// The merged `NNNN - <title>` label, and the id behind it.
//
// The title is shown IN FULL on hover — no character cap; it was clipped to
// one line's worth, then two, and each cap was a guess at how much of a title
// matters. `getRowHeight: 'auto'` used to let the row grow to fit it, but that grid
// setting is banned (§ D rule 2 of `memory/view-switchable-pages.md`): the row
// virtualizer mis-measures after a re-sort, and this grid has exactly the
// shape (two `sortComparator`s, a sortable header on every other column) that
// makes it likely to hit that. So the row is FIXED height and the cell CLAMPS
// instead — full title recovered via the `Tooltip` on hover. Recipe from
// `RequirementsTableView.jsx` (req #3302/#3316); doc'd in `memory/table-design.md`
// § *Fixed row height is a MECHANISM*.
const CLAMP_WRAP_SX = {
    display: 'flex',
    alignItems: 'center',
    height: '100%',
    width: '100%',
};

// 3 lines, not RequirementsTableView's 2 — this column's own design intent
// (see `field: 'requirement_label'` below) was "a three-line title is
// readable", and the clamp preserves that as closely as a fixed row allows.
const CLAMP_CELL_SX = {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
    overflow: 'hidden',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    lineHeight: 1.3,
    width: '100%',
};

// Pre-density figure would matter only under `density="compact"` (0.7×); this
// grid sets no `density` prop, so it runs at the default `"standard"` (1×) and
// the pixel value applies directly. 76px = 3 clamped lines at `lineHeight: 1.3`
// / 0.875rem (~54.6px) plus the cell's vertical padding.
const ROW_HEIGHT = 76;

export const reqIdOf = (sourceRef) => {
    const m = String(sourceRef || '').match(/^(?:priority|requirement):(\d+)$/);
    return m ? m[1] : null;
};

export const requirementLabel = (session) => {
    const title = session.title || session.task_name || '';
    const reqId = reqIdOf(session.source_ref);
    if (!reqId) return title || '';
    return title ? `${reqId} - ${title}` : `${reqId}`;
};

// A timestamp on two lines: date, then time. See the Started column for why.
// Renders an em-dash for a null so an empty cell is never mistaken for a
// zero-length one.
const StackedTimestamp = ({ value, timezone }) => {
    if (!value) return '—';
    return (
        // Centred on BOTH axes, and the two lines are separated by an explicit
        // gap rather than by line-height leading. At 13px/1.25 the natural
        // leading was ~3.25px; 5px is 50% more, and being explicit means the
        // spacing no longer changes if the font size does.
        <Box sx={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: '5px', width: '100%', height: '100%', py: 0.75,
        }}>
            {/* Both lines share the DATE's typeface — same size, same colour.
                The time line used to be smaller and dimmer, which read as a
                caption hanging off the date rather than as the other half of
                one value. */}
            <Box sx={{ fontSize: '0.8125rem', lineHeight: 1.1 }}>{formatDate(value, timezone)}</Box>
            <Box sx={{ fontSize: '0.8125rem', lineHeight: 1.1 }}>{formatHM12(value, timezone)}</Box>
        </Box>
    );
};

// Column order is deliberate and left-to-right by how a reader scans a run:
// what STATE is it in → where can I reach it (Terminal, Dev Server) → what work
// (Requirement) → what plan (Pipeline) → where and how it ran (Machine,
// Model/Effort) → how long (Duration, Started, Completed).
//
// The session ID column is GONE. This reads as a dashboard now, and the id was
// the least useful thing on the row: it addresses nothing the reader types, and
// clicking the row still opens that session.
const getSessionColumns = (navigate, timezone, showCompleted) => [
    {
        // A COLOURED CHIP. Status is the one column where the colour is doing
        // real work — it is what the eye lands on first when scanning for a
        // session that needs attention, and it matches the filter chips above
        // the grid. (Machine stays plain text: its colour carried no such
        // urgency.) Labels are capitalised by swarmStatusLabel.
        field: 'swarm_status',
        headerName: 'Status',
        width: 120,
        valueGetter: (value) => swarmStatusLabel(value),
        // Sorted by the LIFECYCLE, not alphabetically. Alphabetical order puts
        // Completed first and Waiting last, which is noise; the lifecycle is the
        // order the reader already has in their head. Unknown statuses sort last
        // rather than colliding at 0 with `starting`.
        sortComparator: (a, b) => {
            const rank = (label) => {
                const i = SWARM_STATUS_ORDER.indexOf(label);
                return i === -1 ? SWARM_STATUS_ORDER.length : i;
            };
            return rank(a) - rank(b);
        },
        renderCell: (params) => (
            <Chip label={swarmStatusLabel(params.row.swarm_status)} size="small"
                  {...swarmStatusChipProps(params.row.swarm_status)}
                  data-testid="chip-swarm-status" />
        ),
    },
    {
        // req #3455 — WHICH TERMINAL WINDOW the worker runs in, and a click that
        // brings it to the front when it is on THIS machine. `terminal` is
        // computed once per row in enrichedSessions (it needs the machines list,
        // which a column renderer has no access to).
        field: 'terminal',
        headerName: 'Terminal',
        width: 120,
        // The grid filters/quick-searches/exports on this string, not on the
        // object — an object cell would render '[object Object]' in the CSV
        // export and match nothing in the quick filter.
        valueGetter: (value) => value?.label ?? '',
        // ...but it must not SORT on it: "Terminal 10" sorts before "Terminal 4"
        // lexicographically, which is nonsense for a window number.
        //
        // Un-numbered rows sort LAST ASCENDING (and therefore first descending —
        // MUI implements desc as `-1 * comparator`, so "last in both directions"
        // is not something a comparator alone can express; the earlier comment
        // claimed it anyway). Ascending is the direction that matters: most rows
        // have no terminal, and a click on this header should surface the ones
        // that do. Equal sentinels return 0 rather than Infinity-Infinity = NaN.
        sortComparator: (a, b) => {
            const num = (v) => {
                const digits = String(v ?? '').replace(/\D+/g, '');
                return digits === '' ? Number.POSITIVE_INFINITY : Number(digits);
            };
            const va = num(a), vb = num(b);
            if (va === vb) return 0;
            return va - vb;
        },
        renderCell: (params) => (
            <TerminalChip terminal={params.row.terminal}
                          testId={`session-terminal-${params.row.id}`} />
        ),
    },
    {
        field: 'dev_server_port',
        headerName: 'Dev Server',
        width: 120,   // fits the header text; 100 clipped it
        renderCell: (params) => params.value
            ? <Chip label={params.value} size="small" color="primary"
                    component="a" href={`https://localhost:${params.value}`}
                    target="_blank" rel="noopener" clickable
                    onClick={(e) => e.stopPropagation()}
                    data-testid="chip-dev-server-port" />
            : '—',
    },
    {
        // Requirement id AND title in ONE column: `NNNN - <title>`. They were two
        // columns and were always read as one phrase, so the split cost a column
        // of width to say nothing. The whole cell navigates to the requirement —
        // the id was the only link before, which made a 4-character click target.
        //
        // 330px is a WRAP WIDTH, not a fit-the-longest-value width — the title
        // has no cap, so there is no longest value to fit. It is ~43 characters
        // per line at the grid's 0.875rem body font, which keeps the common
        // one-requirement-per-line reading while letting long titles run on.
        field: 'requirement_label',
        headerName: 'Requirement',
        width: 330,
        // Clamps to 3 lines; the row is fixed height (`ROW_HEIGHT` below). The
        // clamp hides nothing — the full title is the cell's `Tooltip`, so a
        // truncated row stays readable without leaving the page.
        renderCell: (params) => {
            const reqId = params.row.requirement_id;
            if (!params.value) return '—';
            // White, not blue: no requirement to link to (an issue-sourced or
            // direct session). Colour here means 'this goes somewhere'.
            if (!reqId) return (
                <Tooltip title={params.value} enterDelay={600} enterNextDelay={300}>
                    <Box sx={CLAMP_WRAP_SX}>
                        <Box sx={CLAMP_CELL_SX}>{params.value}</Box>
                    </Box>
                </Tooltip>
            );
            return (
                <Tooltip title={params.value} enterDelay={600} enterNextDelay={300}>
                    <Box onClick={(e) => { e.stopPropagation(); navigate(`/swarm/requirement/${reqId}`); }}
                         // NOT blue. Every row in this column is a requirement, so
                         // colouring the linked ones split one column into two
                         // visual kinds for no information gain. The hover
                         // underline still says it is clickable.
                         sx={{ cursor: 'pointer', ...CLAMP_WRAP_SX,
                               '&:hover > div': { textDecoration: 'underline' } }}
                         data-testid={`session-requirement-${reqId}`}>
                        <Box sx={CLAMP_CELL_SX}>{params.value}</Box>
                    </Box>
                </Tooltip>
            );
        },
    },
    {
        // req #3186 — which pipeline this session was advancing. `pipeline_fk`
        // is a COLUMN on the session row, so this column costs the grid nothing;
        // the title is resolved client-side from the already-cached plan list.
        // NULL is a real answer (work outside any plan) → em-dash.
        //
        // The `field` name is HISTORICAL — the row property it once named is
        // gone (req #3356, see `enrichedSessions`) and both the `valueGetter`
        // and the `renderCell` read `row.pipeline` instead. Renaming it would
        // move the column's identity for column-visibility state and testids
        // with nothing gained.
        field: 'pipeline_title',
        headerName: 'Pipeline',
        width: 170,
        valueGetter: (value, row) => row.pipeline?.label ?? '',
        renderCell: (params) => {
            const plan = params.row.pipeline;
            if (!plan || plan.state === 'none') return '—';
            const clickable = plan.state === 'link';
            return (
                <Tooltip title={plan.title || ''}>
                    {/* span wrapper — a non-clickable Chip fires no events for
                        the Tooltip to hang off. */}
                    <span>
                        <Chip label={plan.label} size="small" variant="outlined"
                              color={clickable ? 'primary' : 'default'}
                              {...(clickable ? {
                                  onClick: (e) => { e.stopPropagation(); navigate(plan.href); },
                                  sx: { cursor: 'pointer' },
                              } : {})}
                              data-pipeline-state={plan.state}
                              data-testid={`session-pipeline-${params.row.id}`} />
                    </span>
                </Tooltip>
            );
        },
    },
    {
        // req #2943 — which machine ran this session. Name resolved client-side
        // from the machines query cache; NULL / unresolved renders em-dash.
        // Plain TEXT, not a chip: every row carries one, so a column of solid
        // colour blocks competed with Status and Terminal for attention while
        // saying something far less urgent. The machine FILTER keeps its chips —
        // that is where the colour earns its place.
        field: 'machine_name',
        headerName: 'Machine',
        width: 130,
        renderCell: (params) => params.value
            ? <span data-testid="cell-machine">{params.value}</span>
            : '—',
    },
    {
        // req #2909 / #2916 — model and effort, ONE pill in two halves. Two
        // separate facts that are always read together; see ModelEffortPill.
        field: 'model_effort',
        headerName: 'Model / Effort',
        width: 160,   // the widest pair is Sonnet|Ultracode
        sortable: false,
        valueGetter: (value, row) => `${aiModelLabel(row.ai_model)} ${effortLabel(row.effort)}`,
        renderCell: (params) => (
            <ModelEffortPill model={params.row.ai_model} effort={params.row.effort}
                             testId="pill-model-effort" />
        ),
    },
    {
        field: 'duration',
        headerName: 'Duration',
        headerAlign: 'center',
        width: 120,
        valueGetter: (value, row) => {
            if (row.instrumented) {
                return (Number(row.starting_secs) || 0)
                    + (Number(row.waiting_secs) || 0)
                    + (Number(row.planning_secs) || 0)
                    + (Number(row.implementing_secs) || 0)
                    + (Number(row.review_secs) || 0)
                    + (Number(row.completion_secs) || 0)
                    + (Number(row.paused_secs) || 0)
                    + (Number(row.legacy_secs) || 0);
            }
            return row.legacy_secs != null ? Number(row.legacy_secs) : null;
        },
        renderCell: (params) => {
            const row = params.row;
            const isLegacy = !row.instrumented;
            return (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                           gap: 0.5, width: '100%' }}>
                    <span>{formatDuration(params.value)}</span>
                    {isLegacy && params.value != null && (
                        <Chip label="Legacy" size="small" variant="outlined"
                              sx={{ height: 18, fontSize: '0.65rem' }} />
                    )}
                </Box>
            );
        },
    },
    {
        // Date on line one, time on line two. One line of `2026-08-10 14:07:23`
        // is 19 characters of which only the last 8 differ across a same-day
        // run, so the eye scans a wall of identical prefixes; stacked, the date
        // reads once and the times line up as a column.
        field: 'started_at',
        headerName: 'Started',
        width: 120,
        renderCell: (params) => <StackedTimestamp value={params.value} timezone={timezone} />,
    },
    // Completed is only meaningful when completed sessions are on screen. With
    // the default filter (which excludes them) every cell was an em-dash — a
    // column of nothing. It returns the moment `completed` is in the filter.
    ...(showCompleted ? [{
        field: 'completed_at',
        headerName: 'Completed',
        width: 120,
        renderCell: (params) => <StackedTimestamp value={params.value} timezone={timezone} />,
    }] : []),
];

const SessionCard = ({ session, navigate, timezone }) => (
    <Card variant="outlined" sx={{ mb: 1 }}>
        <CardActionArea onClick={() => navigate(`/swarm/session/${session.id}`)}>
            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Chip label={swarmStatusLabel(session.swarm_status)} size="small"
                          {...swarmStatusChipProps(session.swarm_status)}
                          data-testid="chip-swarm-status" />
                    <Typography variant="caption" color="text.secondary">
                        #{session.id}
                    </Typography>
                </Box>
                <Typography variant="body1" sx={{ fontWeight: 500, mb: 0.5 }}>
                    {session.title || session.task_name || '(untitled)'}
                </Typography>
                {session.title && session.task_name && session.task_name !== session.title && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                        {session.task_name}
                    </Typography>
                )}
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    {/* One pill, two halves — the same component the grid uses. */}
                    <ModelEffortPill model={session.ai_model} effort={session.effort}
                                     testId="pill-model-effort" />
                    {/* req #3455 — same component, same rules as the grid column,
                        including which states render at all. */}
                    <TerminalChip terminal={session.terminal}
                                  testId={`session-terminal-${session.id}`} />
                    {session.dev_server_port && (
                        <Chip label={`Port ${session.dev_server_port}`} size="small" color="primary"
                              component="a" href={`https://localhost:${session.dev_server_port}`}
                              target="_blank" rel="noopener" clickable
                              onClick={(e) => e.stopPropagation()}
                              data-testid="chip-dev-server-port" />
                    )}
                    {session.pr_url && (
                        <Chip label="PR" size="small" variant="outlined"
                              component="a" href={session.pr_url} target="_blank" rel="noopener noreferrer"
                              clickable onClick={(e) => e.stopPropagation()}
                              data-testid="session-pr-url" />
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                        {session.started_at ? formatDate(session.started_at, timezone) : ''}
                    </Typography>
                </Stack>
            </CardContent>
        </CardActionArea>
    </Card>
);

const SessionsView = () => {

    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();
    const isMobile = useMediaQuery('(max-width:899px)');

    const { data: sessionsArray } = useSessions(profile?.userName);
    const { data: devServersData } = useDevServers(profile?.userName);
    const { data: swarmStartSessions } = useAllSwarmStartSessions(profile?.userName);
    const { data: machinesData } = useMachines(profile?.userName);
    // req #3186 — pipeline id → title for the Pipeline column. ONE bounded list
    // read for the whole grid, shared with the /swarm/pipelines pages via the
    // same query cache; the per-row id is already on the session.
    //
    // req #3455 added this 2.0 list beside a 1.0 one so a 2.0-seated session was
    // NAMED rather than rendered as a bare id nothing in the app lists. req
    // #3356 removed the 1.0 list: Pipeline 1.0 is eradicated, `useAllPipelines`
    // is not called here any more, and with it went the `pipelineTitleById` map
    // that only ever fed a dead grid field (see `pipeline_title` below).
    const { data: pipelinesData } = useAllPipelines(profile?.userName);

    // req #2943 — machine id → friendly name for the Machine column.
    const machineNameById = useMemo(() => {
        const map = {};
        (machinesData || []).forEach(m => { map[m.id] = m.title; });
        return map;
    }, [machinesData]);
    const sessionStatusFilter = useShowClosedStore(s => s.sessionStatusFilter);
    const toggleSessionStatus = useShowClosedStore(s => s.toggleSessionStatus);
    const sessionMachineFilter = useShowClosedStore(s => s.sessionMachineFilter);
    const toggleSessionMachine = useShowClosedStore(s => s.toggleSessionMachine);

    // req #2992 — machine selector options: one per open machine, plus the
    // Unassigned sentinel. Sorted by id so palette colors stay put as machines
    // come and go.
    const machineOptions = useMemo(() => {
        const machines = [...(machinesData || [])]
            .filter(m => !m.closed)
            .sort((a, b) => a.id - b.id);
        return [
            ...machines.map(m => ({
                value: m.id,
                label: m.title,
                chipProps: machineChipProps(m.id),
            })),
            {
                value: UNASSIGNED_MACHINE,
                label: machineLabel(UNASSIGNED_MACHINE),
                chipProps: machineChipProps(UNASSIGNED_MACHINE),
            },
        ];
    }, [machinesData]);

    const machineOptionValues = useMemo(
        () => machineOptions.map(o => o.value),
        [machineOptions],
    );

    // View toggle (Table | Stats) — req #2825.
    const [view, setView] = useViewPreference(SESSIONS_VIEW_STORAGE_KEY, 'table');
    const handleViewChange = (_event, newView) => setView(newView);

    const devServerMap = useMemo(() => {
        if (!devServersData) return {};
        const map = {};
        devServersData.forEach(ds => { if (ds.session_fk) map[ds.session_fk] = ds.port; });
        return map;
    }, [devServersData]);

    // Req #2422 — session_fk -> swarm_start_fk lookup from the junction.
    // Multi-parent policy: a session linked to multiple swarm_starts resolves
    // to the MOST RECENT one (highest swarm_start_fk). Junction is sorted by
    // swarm_start_fk DESC so the first-write wins per session_fk. This matches
    // the MCP `darwin://swarm-starts-for-session/{id}` ORDER BY id DESC and
    // SwarmSessionDetail's `.find()` on the same sorted list — all three code
    // paths agree on the same parent for any given session.
    const swarmStartBySession = useMemo(() => {
        if (!swarmStartSessions) return {};
        const sorted = [...swarmStartSessions]
            .sort((a, b) => b.swarm_start_fk - a.swarm_start_fk);
        const map = {};
        sorted.forEach(j => {
            if (!(j.session_fk in map)) map[j.session_fk] = j.swarm_start_fk;
        });
        return map;
    }, [swarmStartSessions]);

    // Memoised: each row scans the machines list and the plan list to resolve
    // its display fields, and a fresh array on every render paid all of that
    // again for no reason — `rows` identity only needs to change when an input
    // actually does.
    const enrichedSessions = useMemo(() => !sessionsArray ? null
        : sessionsArray.map(s => ({
            ...s,
            dev_server_port: devServerMap[s.id] || null,
            swarm_start_fk: swarmStartBySession[s.id] || null,
            machine_name: s.machine_fk != null ? (machineNameById[s.machine_fk] ?? null) : null,
            // The plan chip — label, tooltip, href and state, all from the one
            // resolver. It is the SOLE source for this column: the row property
            // `pipeline_title` that used to sit here read `s.pipeline_fk`
            // against the 1.0 list, and req #3356 deleted it rather than
            // re-pointing it because NOTHING CONSUMED IT — the `pipeline_title`
            // column overrides the row value with a `valueGetter` reading
            // `row.pipeline.label`, and its `renderCell` reads `row.pipeline`.
            // The column keeps its `field` name; only the dead value is gone.
            pipeline: sessionPipelineLink(s, pipelinesData),
            // req #3455 — computed here rather than in the column renderer
            // because it needs the machines list to answer "is this terminal on
            // the machine this browser is running on?", and a DataGrid renderCell
            // has no access to component scope.
            terminal: terminalFocusState(s, machinesData),
            // The merged Requirement column. `source_ref` is `requirement:NNNN`
            // (legacy `priority:NNNN`); anything else has no requirement to
            // link to and falls back to the bare title.
            requirement_id: reqIdOf(s.source_ref),
            requirement_label: requirementLabel(s),
          })),
        [sessionsArray, devServerMap, swarmStartBySession, machineNameById,
         machinesData, pipelinesData]);

    // req #2992 — a session's machine filter key. Anything without a chip of its
    // own (NULL machine_fk, or an fk pointing at a closed/deleted machine) maps
    // to the Unassigned sentinel, so every row is governed by a chip the user
    // can actually see. Without this fallback, sessions from a retired machine
    // would vanish with no visible control to bring them back.
    const machineKeyFor = (session) =>
        (session.machine_fk != null && machineOptionValues.includes(session.machine_fk))
            ? session.machine_fk
            : UNASSIGNED_MACHINE;

    const filteredSessions = enrichedSessions
        ? enrichedSessions.filter(s =>
            sessionStatusFilter.includes(s.swarm_status)
            && (sessionMachineFilter === null || sessionMachineFilter.includes(machineKeyFor(s))))
        : null;

    // Is the Completed column worth its width? Only when completed sessions can
    // actually appear. The default filter excludes them, so the column was a
    // full column of em-dashes.
    const showCompleted = sessionStatusFilter.includes('completed');

    const sortedSessions = filteredSessions
        ? [...filteredSessions].sort((a, b) => b.id - a.id)
        : null;

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={handleViewChange}
                    size="small"
                    sx={{ flexShrink: 0 }}
                    data-testid="sessions-view-toggle"
                >
                    <Tooltip title="Table View">
                        <ToggleButton value="table" data-testid="view-toggle-table" sx={{ px: 2 }}>
                            <TableChartIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                    <Tooltip title="Stats View">
                        <ToggleButton value="stats" data-testid="view-toggle-stats" sx={{ px: 2 }}>
                            <BarChartIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                </ToggleButtonGroup>
                <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ flex: 1 }}>Swarm Sessions</Typography>
                {view === 'table' && (
                    <>
                        <ChipFilter
                            options={machineOptions}
                            selected={sessionMachineFilter}
                            onToggle={(value) => toggleSessionMachine(value, machineOptionValues)}
                            testId="session-machine-filter"
                            chipTestIdPrefix="machine-filter-chip"
                        />
                        <ChipFilter
                            options={sessionStatusOptions}
                            selected={sessionStatusFilter}
                            onToggle={toggleSessionStatus}
                            testId="session-status-filter"
                        />
                    </>
                )}
            </Box>

            {!sessionsArray ? (
                <CircularProgress />
            ) : view === 'stats' ? (
                <SessionsStatsView rows={enrichedSessions || []} />
            ) : isMobile ? (
                <Box data-testid="sessions-datagrid">
                    {sortedSessions.length === 0 ? (
                        <Typography color="text.secondary" sx={{ p: 2 }}>No sessions</Typography>
                    ) : (
                        sortedSessions.map(session => (
                            <SessionCard key={session.id} session={session} navigate={navigate} timezone={profile?.timezone} />
                        ))
                    )}
                </Box>
            ) : (
                <Box sx={{ width: '100%' }} data-testid="sessions-datagrid">
                    <DataGrid
                        autoHeight
                        rows={sortedSessions}
                        columns={getSessionColumns(navigate, profile?.timezone, showCompleted)}
                        // FIXED, not auto — § D rule 2 bans `getRowHeight: 'auto'` (row
                        // virtualizer mis-measures after a re-sort). The Requirement
                        // cell clamps to 3 lines instead of growing the row; see
                        // `ROW_HEIGHT` / `CLAMP_CELL_SX` above.
                        rowHeight={ROW_HEIGHT}
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{
                            toolbar: {
                                showQuickFilter: true,
                            },
                        }}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 25 } },
                            // Default sort: STATUS, ascending, in lifecycle order
                            // (see SWARM_STATUS_ORDER). A dashboard is read by
                            // "what needs me", and that is a state question.
                            sorting: { sortModel: [
                                // Status first, then newest-first WITHIN a status.
                                // Without the second key every tie group (which is
                                // most of the grid) fell back to gateway order.
                                { field: 'swarm_status', sort: 'asc' },
                                { field: 'started_at', sort: 'desc' },
                            ] },
                        }}
                        pageSizeOptions={[10, 25, 50, 100]}
                        disableRowSelectionOnClick
                        onRowClick={(params) => navigate(`/swarm/session/${params.id}`)}
                        // ONE `sx`. Two sx props on the same element compile to a
                        // single object literal and the LAST one wins, so an
                        // earlier block is silently discarded — which is exactly
                        // what happened to the cell-centering rules here (the
                        // build warned "Duplicate sx attribute" and still exited 0).
                        sx={{
                            cursor: 'pointer',
                            // Vertically centre EVERY cell's content — chips, pills,
                            // text and the stacked timestamps alike. Needed because
                            // MUI's default `.MuiDataGrid-cell` is `display: block`
                            // (flex is opt-in per column via `display: 'flex'`), so
                            // without this every pill sat flush against the top of
                            // the fixed-height row instead of centred in it.
                            '& .MuiDataGrid-cell': {
                                display: 'flex',
                                alignItems: 'center',
                            },
                        }}
                        data-testid="sessions-grid"
                    />
                </Box>
            )}
        </Box>
    );
};

export default SessionsView;
