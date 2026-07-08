import React, { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import call_rest_api from '../../RestApi/RestApi';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { useShowClosedStore, ALL_REQUIREMENT_STATUSES } from '../../stores/useShowClosedStore';
import { useAllCategories } from '../../hooks/useDataQueries';
import { siblingActiveSort } from './requirementSort';
import { formatDateTime, formatDate } from '../../utils/dateFormat';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { DataGrid } from '@mui/x-data-grid';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { requirementKeys } from '../../hooks/useQueryKeys';
import RequirementDeleteDialog from '../RequirementDeleteDialog';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

import { swarmStatusChipProps, swarmStatusLabel } from '../swarmStatusChipProps';
import { COORDINATION_COLOR } from '../coordinationChipStyles';
import { AI_MODEL_COLOR, AI_MODELS, aiModelLabel } from '../modelChipStyles';
import { EFFORT_COLOR, EFFORTS, effortLabel } from '../effortChipStyles';
import { formatDuration } from '../../utils/formatDuration';
import { renderSourceRef } from '../repoGitHubMap.jsx';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import { CircularProgress, Stack, Typography } from '@mui/material';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import NorthIcon from '@mui/icons-material/North';
import SouthIcon from '@mui/icons-material/South';

// Soft limit for requirement titles — the swarm terminal, status line, and iTerm tab title
// all cap at 35 chars (see ~/.claude/statusline.sh and scripts/swarm/iterm-launch.sh). Req #2410.
const TITLE_SOFT_LIMIT = 35;

const getSessionColumns = (navigate, timezone) => [
    { field: 'id',           headerName: 'ID',        width: 70 },
    { field: 'swarm_status', headerName: 'Status',    width: 110,
      renderCell: (params) => (
          <Chip label={swarmStatusLabel(params.value)} size="small"
                {...swarmStatusChipProps(params.value)} />
      )
    },
    {
        field: 'source_ref',
        headerName: 'Source',
        width: 140,
        renderCell: (params) => renderSourceRef(params.value, navigate),
    },
    { field: 'branch',       headerName: 'Branch',    width: 200, flex: 1 },
    {
        field: 'duration',
        headerName: 'Duration',
        width: 110,
        valueGetter: (value, row) => {
            if (row.instrumented) {
                return (Number(row.starting_secs) || 0) + (Number(row.waiting_secs) || 0)
                    + (Number(row.planning_secs) || 0) + (Number(row.implementing_secs) || 0)
                    + (Number(row.review_secs) || 0) + (Number(row.completion_secs) || 0)
                    + (Number(row.paused_secs) || 0) + (Number(row.legacy_secs) || 0);
            }
            return row.legacy_secs != null ? Number(row.legacy_secs) : null;
        },
        valueFormatter: (value) => formatDuration(value),
    },
    { field: 'started_at',   headerName: 'Started',   width: 170,
      valueFormatter: (value) => value ? formatDate(value, timezone) : '—' },
    { field: 'completed_at', headerName: 'Completed', width: 120,
      valueFormatter: (value) => value ? formatDate(value, timezone) : '—' },
];

const RequirementDetail = () => {

    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const fromCalendar = location.state?.from === 'calendar';
    // "new" mode (req #2414): the user came from the aggregator template row.
    // No DB record exists yet — the requirement is POSTed only when the user
    // picks a category. Until then this page edits a purely local draft.
    const isNew = id === 'new';
    const handleBack = () => navigate(fromCalendar ? '/calview' : '/swarm');
    const backLabel = fromCalendar ? 'Back to Calendar' : 'Back to Roadmap';
    const { idToken, profile } = useContext(AuthContext);
    const timezone = profile?.timezone;
    const { darwinUri } = useContext(AppContext);

    const [requirement, setRequirement] = useState(isNew ? {
        id: null,
        title: location.state?.title || '',
        description: '',
        category_fk: null,
        requirement_status: 'authoring',
        coordination_type: 'implemented',
        ai_model: 'opus',
        effort: 'xhigh',
        started_at: null,
        completed_at: null,
        deferred_at: null,
        create_ts: null,
        update_ts: null,
    } : null);
    const [sessions, setSessions] = useState([]);
    const [siblings, setSiblings] = useState([]);
    const [sibSortMode, setSibSortMode] = useState('hand');
    const [loading, setLoading] = useState(!isNew);

    // Req #2818: in the aggregator-template / category-unset flow the Category select is
    // autofocused (req #2815). Once the user picks a category the description field can no
    // longer rely on its mount-time `autoFocus` (the component stays mounted), so we move
    // focus imperatively. `descriptionInputRef` points at the description <textarea>;
    // `focusDescriptionPending` is set ONLY when the category was previously unset.
    const descriptionInputRef = useRef(null);
    const [focusDescriptionPending, setFocusDescriptionPending] = useState(false);

    // Req #2884: the Category <Select> is gated behind the categories query
    // (`allCategories ? <Select autoFocus={categoryUnset}/> : —`). On a cold load
    // it mounts only once `useAllCategories` resolves, and `autoFocus` fires at
    // that (late) mount — yanking focus away from the Title/Description field the
    // user already clicked into. Track whether the user has focused an editable
    // field first; if so, the late-mounting select must NOT auto-focus. The flag
    // is a ref because `autoFocus` is consulted only at the select's mount render
    // (driven by the query resolving), so the ref value at that moment is exactly
    // the signal we need — and we don't want to trigger an extra re-render.
    const userInteractedRef = useRef(false);
    const markUserInteracted = () => { userInteractedRef.current = true; };

    const showError = useSnackBarStore(s => s.showError);
    const requirementStatusFilter = useShowClosedStore(s => s.requirementStatusFilter);

    const { data: allCategories } = useAllCategories(profile?.userName, {
        fields: 'id,category_name',
        closed: 0,
    });
    // Filter chips now match DB status values directly
    const siblingStatuses = [...requirementStatusFilter];

    const queryClient = useQueryClient();

    const requirementDelete = useConfirmDialog({
        onConfirm: ({ requirementId }) => {
            const uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'DELETE', { id: requirementId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                        navigate('/swarm');
                    } else {
                        showError(result, 'Unable to delete requirement');
                    }
                })
                .catch(error => showError(error, 'Unable to delete requirement'));
        }
    });

    // Requirement Duplicator (req #2808): clone the opened requirement into a NEW
    // requirement that shares ONLY the title, description and category. Status and
    // coordination fall back to defaults (status 'authoring'; coordination_type
    // omitted so the server applies its NOT NULL default). The title gets a
    // "COPY of {origin id}" suffix. Nothing else is copied — dates, sessions,
    // sort_order and project_fk are deliberately left off the POST body.
    const handleDuplicate = async () => {
        if (isNew || !requirement) return;
        // requirements.title is VARCHAR(256). Always keep the "COPY of {id}" suffix
        // and truncate the base title so the combined string fits the column.
        const suffix = ` COPY of ${id}`;
        const baseTitle = (requirement.title || '').slice(0, 256 - suffix.length);
        const draft = {
            title: `${baseTitle}${suffix}`,
            description: requirement.description || '',
            category_fk: requirement.category_fk,
            requirement_status: 'authoring',
        };
        const postResult = await call_rest_api(`${darwinUri}/requirements`, 'POST', draft, idToken)
            .catch(() => null);
        if (!postResult || !postResult.httpStatus || postResult.httpStatus.httpStatus !== 200 ||
            !postResult.data || !postResult.data[0]) {
            const err = postResult && postResult.httpStatus
                ? postResult
                : { httpStatus: { httpStatus: 'network error' } };
            showError(err, 'Unable to duplicate requirement');
            return;
        }
        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
        navigate(`/swarm/requirement/${postResult.data[0].id}`);
    };

    useEffect(() => {
        if (isNew) return;  // no fetch — local draft only
        const fetchData = async () => {
            try {
                const requirementUri = `${darwinUri}/requirements?id=${id}`;
                const result = await call_rest_api(requirementUri, 'GET', '', idToken);

                if (result.httpStatus.httpStatus !== 200 || result.data.length === 0) {
                    showError(result, 'Unable to load requirement');
                    setLoading(false);
                    return;
                }

                const p = result.data[0];
                setRequirement(p);

                // Fetch sessions, siblings, and category sort_mode in parallel
                const siblingFilter = siblingStatuses.length === ALL_REQUIREMENT_STATUSES.length
                    ? ''
                    : `&requirement_status=(${siblingStatuses.join(',')})`;
                const [sessionsResult, siblingsResult, categoryResult] = await Promise.all([
                    // Req #2834 — read swarm_sessions through `darwinUri` (the dev/prod split),
                    // matching req #2827's migration of the factory ops hooks. The req #2697
                    // pin to production `darwin` is gone: in production `darwinUri === darwinOpsUri`
                    // (= `…/darwin`) so this is a no-op there, while in dev mode the linked-sessions
                    // read now hits `darwin_dev` — the same schema SessionsView/useSessions reads —
                    // so a dev-seeded session is visible here too (without this, dev showed the
                    // list from darwin_dev but linked sessions from production darwin).
                    call_rest_api(`${darwinUri}/swarm_sessions?source_ref=requirement:${p.id}`, 'GET', '', idToken).catch(() => null),
                    call_rest_api(`${darwinUri}/requirements?category_fk=${p.category_fk}&fields=id,requirement_status,completed_at,deferred_at,started_at${siblingFilter}`, 'GET', '', idToken).catch(() => null),
                    call_rest_api(`${darwinUri}/categories?id=${p.category_fk}&fields=id,sort_mode`, 'GET', '', idToken).catch(() => null),
                ]);

                if (sessionsResult?.httpStatus?.httpStatus === 200 && sessionsResult.data.length > 0) {
                    setSessions(sessionsResult.data);
                }
                if (siblingsResult?.httpStatus?.httpStatus === 200 && siblingsResult.data.length > 0) {
                    setSiblings(siblingsResult.data);
                }
                if (categoryResult?.httpStatus?.httpStatus === 200 && categoryResult.data.length > 0) {
                    // Mirror CategoryCard coercion: 'hand' / 'reverse' pass through, anything else → 'process'.
                    const raw = categoryResult.data[0].sort_mode;
                    setSibSortMode(raw === 'hand' ? 'hand' : raw === 'reverse' ? 'reverse' : 'process');
                }
            } catch (error) {
                showError(error, 'Unable to load requirement');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [id, idToken, darwinUri, siblingStatuses.join()]);

    const saveField = (field, value) => {
        if (isNew) return;  // draft — nothing is saved until category is picked
        let uri = `${darwinUri}/requirements`;
        call_rest_api(uri, 'PUT', [{ id: parseInt(id), [field]: value }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, `Unable to update ${field}`);
                } else {
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                }
            }).catch(error => {
                showError(error, `Unable to update ${field}`);
            });
    };

    const handleTitleBlur = () => {
        if (requirement) saveField('title', requirement.title);
    };

    const handleTitleKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveField('title', requirement.title);
        }
    };

    const handleDescriptionBlur = () => {
        if (requirement) saveField('description', requirement.description || '');
    };

    const currentStatus = requirement?.requirement_status || 'authoring';

    // Confirmation dialog for transitions FROM met state
    const requirementReopen = useConfirmDialog({
        onConfirm: ({ targetStatus }) => {
            executeStatusChange(targetStatus);
        }
    });

    const executeStatusChange = (newStatus) => {
        const now = new Date().toISOString();

        // wontfix is a terminal state like met — both set completed_at (req #2783)
        const setsCompleted = newStatus === 'met' || newStatus === 'wontfix';

        const updates = {
            requirement_status: newStatus,
            started_at: newStatus === 'development' ? now : 'NULL',
            completed_at: setsCompleted ? now : 'NULL',
            deferred_at: newStatus === 'deferred' ? now : 'NULL',
        };

        setRequirement(prev => ({
            ...prev,
            requirement_status: newStatus,
            started_at: newStatus === 'development' ? now : null,
            completed_at: setsCompleted ? now : null,
            deferred_at: newStatus === 'deferred' ? now : null,
        }));

        let uri = `${darwinUri}/requirements`;
        call_rest_api(uri, 'PUT', [{ id: parseInt(id), ...updates }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, 'Unable to update requirement status');
                } else {
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                }
            }).catch(error => {
                showError(error, 'Unable to update requirement status');
            });
    };

    const handleStatusChange = (event, newStatus) => {
        if (newStatus === null || newStatus === currentStatus) return;

        // Require confirmation when leaving a terminal state (met or wontfix — req #2783)
        if (currentStatus === 'met' || currentStatus === 'wontfix') {
            requirementReopen.openDialog({ targetStatus: newStatus });
            return;
        }

        executeStatusChange(newStatus);
    };

    const handleCoordinationChange = (event, newVal) => {
        // Autonomy is mandatory (req #2745) — newVal is always one of the four
        // values; the chip can no longer deselect to null.
        setRequirement(prev => ({ ...prev, coordination_type: newVal }));
        saveField('coordination_type', newVal);
    };

    const handleModelChange = (event, newVal) => {
        // Model is mandatory (req #2909) — newVal is always one of the four
        // values; no deselect-to-null path, mirroring autonomy.
        setRequirement(prev => ({ ...prev, ai_model: newVal }));
        saveField('ai_model', newVal);
    };

    const handleEffortChange = (event, newVal) => {
        // Effort is mandatory (req #2916) — newVal is always one of the five
        // values; no deselect-to-null path, mirroring autonomy and model.
        setRequirement(prev => ({ ...prev, effort: newVal }));
        saveField('effort', newVal);
    };

    const handleCategoryChange = async (event) => {
        const newCategoryFk = parseInt(event.target.value, 10);
        if (!Number.isFinite(newCategoryFk)) return;  // ignore the placeholder value
        // Req #2818: only the forced-pick (category-was-unset) case jumps focus to
        // description afterward. Changing the category on an already-categorized
        // requirement leaves focus where it is.
        const wasCategoryUnset = !requirement?.category_fk;
        setRequirement(prev => ({ ...prev, category_fk: newCategoryFk }));

        // New-mode (req #2414): picking a category is the first save. POST creates
        // the requirement, then we navigate to the canonical detail URL.
        if (isNew) {
            const draft = {
                title: requirement?.title || '',
                description: requirement?.description || '',
                requirement_status: requirement?.requirement_status || 'authoring',
                category_fk: newCategoryFk,
                project_fk: null,
            };
            const postResult = await call_rest_api(`${darwinUri}/requirements`, 'POST', draft, idToken)
                .catch(() => null);
            if (!postResult || !postResult.httpStatus || postResult.httpStatus.httpStatus !== 200 ||
                !postResult.data || !postResult.data[0]) {
                setRequirement(prev => ({ ...prev, category_fk: null }));
                const err = postResult && postResult.httpStatus
                    ? postResult
                    : { httpStatus: { httpStatus: 'network error' } };
                showError(err, 'Unable to create requirement');
                return;
            }
            queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
            if (wasCategoryUnset) setFocusDescriptionPending(true);  // req #2818
            navigate(`/swarm/requirement/${postResult.data[0].id}`, { replace: true });
            return;
        }

        // Await the PUT so siblings refetch sees the committed category_fk
        const putResult = await call_rest_api(`${darwinUri}/requirements`, 'PUT', [{ id: parseInt(id), category_fk: newCategoryFk }], idToken)
            .catch(() => null);
        if (!putResult || (putResult.httpStatus.httpStatus !== 200 && putResult.httpStatus.httpStatus !== 204)) {
            showError(putResult, 'Unable to update category');
            return;
        }
        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
        if (wasCategoryUnset) setFocusDescriptionPending(true);  // req #2818

        // Refresh siblings and sort mode for the new category so prev/next navigation stays accurate
        const siblingFilter = siblingStatuses.length === ALL_REQUIREMENT_STATUSES.length
            ? ''
            : `&requirement_status=(${siblingStatuses.join(',')})`;
        try {
            const [siblingsResult, categoryResult] = await Promise.all([
                call_rest_api(`${darwinUri}/requirements?category_fk=${newCategoryFk}&fields=id,requirement_status,completed_at,deferred_at,started_at${siblingFilter}`, 'GET', '', idToken).catch(() => null),
                call_rest_api(`${darwinUri}/categories?id=${newCategoryFk}&fields=id,sort_mode`, 'GET', '', idToken).catch(() => null),
            ]);
            if (siblingsResult?.httpStatus?.httpStatus === 200) setSiblings(siblingsResult.data || []);
            if (categoryResult?.httpStatus?.httpStatus === 200) setSibSortMode(categoryResult.data[0]?.sort_mode || 'hand');
        } catch (e) {
            // siblings refresh is best-effort
        }
    };

    // Req #2818: when a category was just picked from the forced-pick state, move focus to
    // the description field. Runs once the flag is set and the input is mounted; in new-mode
    // the same effect re-fires after the post-navigate refetch replaces `requirement`.
    useEffect(() => {
        if (focusDescriptionPending && descriptionInputRef.current) {
            descriptionInputRef.current.focus();
            setFocusDescriptionPending(false);
        }
    }, [focusDescriptionPending, requirement]);

    const sortedSiblings = useMemo(() => {
        if (!siblings.length) return [];
        return [...siblings].sort((a, b) => siblingActiveSort(sibSortMode, a, b));
    }, [siblings, sibSortMode]);

    const currentIndex = useMemo(() => {
        const idNum = parseInt(id);
        return sortedSiblings.findIndex(s => parseInt(s.id) === idNum);
    }, [sortedSiblings, id]);

    const prevId = currentIndex > 0 ? sortedSiblings[currentIndex - 1]?.id : null;
    const nextId = currentIndex >= 0 && currentIndex < sortedSiblings.length - 1 ? sortedSiblings[currentIndex + 1]?.id : null;

    const titleOverflow = Math.max(0, (requirement?.title || '').length - TITLE_SOFT_LIMIT);

    if (loading) return <CircularProgress />;
    if (!requirement) return <Typography>Requirement not found.</Typography>;

    const categoryUnset = !requirement.category_fk;

    // Req #2836 — page is wider than the prose column so the Linked Sessions
    // DataGrid (~770px of columns) fits without a horizontal scrollbar. The
    // editor controls above the table keep their readable width via NARROW.
    // Mirrors the page-width-vs-prose-width split in SwarmStartDetail.
    const NARROW = { maxWidth: 800 };
    return (
        <Box sx={{ p: 3, maxWidth: 1000 }} data-testid="requirement-detail">
            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', ...NARROW }}>
                <Button variant="outlined"
                        onClick={handleBack}
                        data-testid="btn-back-to-swarm">
                    {backLabel}
                </Button>
            </Box>

            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, ...NARROW }}>
                <TextField
                    variant="standard"
                    value={requirement.title || ''}
                    onChange={(e) => setRequirement(prev => ({ ...prev, title: e.target.value }))}
                    onBlur={handleTitleBlur}
                    onKeyDown={handleTitleKeyDown}
                    onFocus={markUserInteracted}  // req #2884 — block late select autofocus steal
                    fullWidth
                    autoComplete="off"
                    slotProps={{
                        input: { style: { fontSize: 24, fontWeight: 500 } },
                        htmlInput: { maxLength: 256 }
                    }}
                    data-testid="requirement-title"
                />
                {titleOverflow > 0 && (
                    <Tooltip title={`${titleOverflow} over the ${TITLE_SOFT_LIMIT}-char soft limit (status line / tab title truncate past ${TITLE_SOFT_LIMIT})`} enterDelay={400}>
                        <Chip
                            label={`+${titleOverflow}`}
                            size="small"
                            variant="outlined"
                            sx={{ borderColor: '#fbc02d', color: '#b38600', fontWeight: 500, flexShrink: 0 }}
                            data-testid="title-overflow-chip"
                        />
                    </Tooltip>
                )}
            </Box>

            {/* New-mode (req #2424): keep this row in the layout but invisible so
                Category/Description below don't shift when the requirement is saved
                and the row becomes visible. */}
            <Box sx={{
                display: 'flex', gap: 1, mb: 2, alignItems: 'center', flexWrap: 'wrap', ...NARROW,
                ...(isNew && { visibility: 'hidden', pointerEvents: 'none' }),
            }}>
                {/* minWidth matches the Autonomy label below so the first chips of both
                    rows share a left edge. */}
                <Typography variant="subtitle2" color="text.secondary" sx={{ minWidth: 72 }}>
                    Status
                </Typography>
                <Stack direction="row" spacing={0.5} data-testid="requirement-state-selector">
                    {[
                        { value: 'authoring',   label: 'Authoring', chipSx: { bgcolor: '#fbc02d', color: '#000' } },
                        { value: 'approved',    label: 'Approved',  chipSx: { bgcolor: '#90caf9', color: '#000' } },
                        { value: 'swarm_ready', label: 'Swarm-Start', chipSx: { bgcolor: '#1976d2', color: '#fff' } },
                        { value: 'development', label: 'Dev',       chipSx: { bgcolor: '#81c784', color: '#000' } },
                        { value: 'met',         label: 'Met',       chipSx: { bgcolor: '#2e7d32', color: '#fff' } },
                        { value: 'deferred',    label: 'Deferred',  chipSx: { bgcolor: '#ff9800', color: '#fff' } },
                        { value: 'wontfix',     label: "Won't Fix", chipSx: { bgcolor: '#9e9e9e', color: '#fff' } },
                    ].map(({ value, label, color, chipSx }) => {
                        const selected = currentStatus === value;
                        return (
                            <Chip
                                key={value}
                                label={label}
                                size="small"
                                onClick={() => handleStatusChange(null, value)}
                                data-testid={`state-${value}`}
                                {...(selected
                                    ? (chipSx ? { sx: { ...chipSx, cursor: 'pointer' } } : { color, sx: { cursor: 'pointer' } })
                                    : { variant: 'outlined', sx: { cursor: 'pointer', opacity: 0.6 } }
                                )}
                            />
                        );
                    })}
                </Stack>
                <Tooltip title="Previous requirement" enterDelay={400}>
                    <span>
                        <IconButton
                            onClick={() => navigate(`/swarm/requirement/${prevId}`)}
                            disabled={!prevId}
                            data-testid="btn-prev-requirement"
                            sx={{ maxWidth: 25, maxHeight: 25 }}
                        >
                            <NorthIcon />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Next requirement" enterDelay={400}>
                    <span>
                        <IconButton
                            onClick={() => navigate(`/swarm/requirement/${nextId}`)}
                            disabled={!nextId}
                            data-testid="btn-next-requirement"
                            sx={{ maxWidth: 25, maxHeight: 25 }}
                        >
                            <SouthIcon />
                        </IconButton>
                    </span>
                </Tooltip>
                {!isNew && (
                    <Tooltip title="Duplicate requirement" enterDelay={400} enterNextDelay={200}>
                        <IconButton
                            onClick={handleDuplicate}
                            data-testid="btn-duplicate-requirement"
                            sx={{ maxWidth: '25px', maxHeight: '25px' }}
                        >
                            <ContentCopyIcon />
                        </IconButton>
                    </Tooltip>
                )}
                <Tooltip title="Delete requirement" enterDelay={400} enterNextDelay={200}>
                    <IconButton
                        onClick={() => requirementDelete.openDialog({ requirementId: parseInt(id) })}
                        data-testid="btn-delete-requirement"
                        sx={{ maxWidth: '25px', maxHeight: '25px' }}
                    >
                        <DeleteIcon />
                    </IconButton>
                </Tooltip>
            </Box>

            {/* Autonomy — editable during authoring/approved/swarm_ready, full opacity only on swarm_ready, faded+disabled otherwise.
                New-mode (req #2424): kept in layout but invisible so Category/Description below don't shift when the requirement is saved. */}
            {(() => {
                const isReady = currentStatus === 'swarm_ready';
                const isEditable = ['authoring', 'approved', 'swarm_ready'].includes(currentStatus);
                const isFaded = !isReady;

                return (
                    <Box sx={{
                        display: 'flex', gap: 1, mb: 2, alignItems: 'center', ...NARROW,
                        opacity: isFaded ? 0.4 : 1,
                        ...(isNew && { visibility: 'hidden', pointerEvents: 'none' }),
                    }}>
                        {/* minWidth matches the Status label above so both rows' first chips
                            share a left edge. */}
                        <Typography variant="subtitle2" color={isFaded ? 'text.disabled' : 'text.secondary'} sx={{ minWidth: 72 }}>
                            Autonomy
                        </Typography>
                        <Stack direction="row" spacing={0.5} data-testid="coordination-type-selector">
                            {[
                                { value: 'discuss',     label: 'Discuss Req', chipSx: { bgcolor: COORDINATION_COLOR.discuss,     color: '#000' } },
                                { value: 'planned',     label: 'Planned',     chipSx: { bgcolor: COORDINATION_COLOR.planned,     color: '#000' } },
                                { value: 'implemented', label: 'Implemented', chipSx: { bgcolor: COORDINATION_COLOR.implemented, color: '#000' } },
                                { value: 'deployed',    label: 'Deployed',    chipSx: { bgcolor: COORDINATION_COLOR.deployed,    color: '#000' } },
                            ].map(({ value, label, color, chipSx }) => {
                                const selected = requirement.coordination_type === value;
                                return (
                                    <Chip
                                        key={value}
                                        label={label}
                                        size="small"
                                        disabled={!isEditable}
                                        onClick={() => { if (!selected) handleCoordinationChange(null, value); }}
                                        {...(selected
                                            ? (chipSx ? { sx: { ...chipSx, cursor: isEditable ? 'pointer' : 'default' } } : { color, sx: { cursor: isEditable ? 'pointer' : 'default' } })
                                            : { variant: 'outlined', sx: { cursor: isEditable ? 'pointer' : 'default', opacity: !isEditable ? 0.3 : 0.6 } }
                                        )}
                                    />
                                );
                            })}
                        </Stack>
                    </Box>
                );
            })()}

            {/* Model + Effort (req #2909 / #2916) — the Claude launch settings, grouped in one
                rounded-rectangle area directly below Autonomy with identical editability/fade/
                new-mode rules. Pre-migration rows fall back to 'opus' / 'high' (the documented
                backfill defaults). */}
            {(() => {
                const isReady = currentStatus === 'swarm_ready';
                const isEditable = ['authoring', 'approved', 'swarm_ready'].includes(currentStatus);
                const isFaded = !isReady;
                const currentModel = requirement.ai_model || 'opus';
                const currentEffort = requirement.effort || 'high';
                const rowSx = { display: 'flex', gap: 1, alignItems: 'center' };
                const labelColor = isFaded ? 'text.disabled' : 'text.secondary';

                return (
                    // A real <fieldset>/<legend> pair so the "AI Settings" caption sits ON the
                    // border line at top-left with the line notched behind the text.
                    <Box
                        component="fieldset"
                        data-testid="launch-settings-group"
                        sx={{
                            width: 'fit-content', maxWidth: '100%',
                            m: 0, mb: 2, px: 1.5, pt: 0.25, pb: 1.25,
                            display: 'flex', flexDirection: 'column', gap: 1.5,
                            border: 1, borderColor: 'common.white', borderRadius: 2,
                            opacity: isFaded ? 0.4 : 1,
                            ...(isNew && { visibility: 'hidden', pointerEvents: 'none' }),
                        }}
                    >
                        <Box component="legend" sx={{ ml: 1, px: 0.5 }}>
                            <Typography variant="subtitle2" color={labelColor}>
                                AI Settings
                            </Typography>
                        </Box>
                        <Box sx={rowSx}>
                            <Typography variant="subtitle2" color={labelColor} sx={{ minWidth: 48 }}>
                                Model
                            </Typography>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap data-testid="ai-model-selector">
                                {AI_MODELS.map((value) => {
                                    const selected = currentModel === value;
                                    return (
                                        <Chip
                                            key={value}
                                            label={aiModelLabel(value)}
                                            size="small"
                                            disabled={!isEditable}
                                            onClick={() => { if (!selected) handleModelChange(null, value); }}
                                            data-testid={`model-${value}`}
                                            {...(selected
                                                ? { sx: { bgcolor: AI_MODEL_COLOR[value], color: '#000', cursor: isEditable ? 'pointer' : 'default' } }
                                                : { variant: 'outlined', sx: { cursor: isEditable ? 'pointer' : 'default', opacity: !isEditable ? 0.3 : 0.6 } }
                                            )}
                                        />
                                    );
                                })}
                            </Stack>
                        </Box>
                        <Box sx={rowSx}>
                            <Typography variant="subtitle2" color={labelColor} sx={{ minWidth: 48 }}>
                                Effort
                            </Typography>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap data-testid="effort-selector">
                                {EFFORTS.map((value) => {
                                    const selected = currentEffort === value;
                                    return (
                                        <Chip
                                            key={value}
                                            label={effortLabel(value)}
                                            size="small"
                                            disabled={!isEditable}
                                            onClick={() => { if (!selected) handleEffortChange(null, value); }}
                                            data-testid={`effort-${value}`}
                                            {...(selected
                                                ? { sx: { bgcolor: EFFORT_COLOR[value], color: '#000', cursor: isEditable ? 'pointer' : 'default' } }
                                                : { variant: 'outlined', sx: { cursor: isEditable ? 'pointer' : 'default', opacity: !isEditable ? 0.3 : 0.6 } }
                                            )}
                                        />
                                    );
                                })}
                            </Stack>
                        </Box>
                    </Box>
                );
            })()}

            <Box sx={{
                mb: 2, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', ...NARROW,
                color: categoryUnset ? 'error.main' : 'text.secondary',
                fontWeight: 'bold', fontSize: '1.25rem',
            }}>
                <Box component="span">Category -&nbsp;</Box>
                {allCategories ? (
                    <Select
                        // Req #2815: when the category is unset (the aggregator-template /
                        // "new" case) focus the category select, not description. The user
                        // presses ArrowDown to open the list, picks a category, and then
                        // lands in description (which autofocuses once a category is set).
                        // Req #2884: suppress this if the user already focused a field — the
                        // select mounts late (after the categories query resolves) and would
                        // otherwise steal focus from the field being typed in.
                        autoFocus={categoryUnset && !userInteractedRef.current}
                        value={requirement.category_fk || ''}
                        onChange={handleCategoryChange}
                        displayEmpty
                        renderValue={(selected) => {
                            if (!selected) return 'Must Select';
                            const cat = allCategories.find(c => c.id === selected);
                            return cat ? cat.category_name : '';
                        }}
                        variant="standard"
                        IconComponent={() => null}
                        data-testid="requirement-category-select"
                        sx={{
                            fontSize: '1.25rem',
                            fontWeight: 'bold',
                            color: categoryUnset ? 'error.main' : 'text.secondary',
                            '& .MuiSelect-select': { py: 0, pr: '0 !important' },
                            '&:before': { borderBottomColor: 'transparent' },
                            '&:hover:not(.Mui-disabled):before': { borderBottomColor: 'rgba(0,0,0,0.3)' },
                        }}
                    >
                        {allCategories.map(cat => (
                            <MenuItem key={cat.id} value={cat.id} sx={{ fontSize: '1.25rem' }}>
                                {cat.category_name}
                            </MenuItem>
                        ))}
                    </Select>
                ) : (
                    <Box component="span">—</Box>
                )}
                {!isNew && (
                    <Box component="span" data-testid="requirement-id">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;ID - {requirement.id}</Box>
                )}
            </Box>

            <Box sx={{ mb: 2, ...NARROW }}>
                <Typography
                    variant="subtitle2"
                    color={categoryUnset ? 'error.main' : 'text.secondary'}
                    sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}
                >
                    Description
                </Typography>
                <TextField
                    variant="outlined"
                    value={requirement.description || ''}
                    onChange={(e) => setRequirement(prev => ({ ...prev, description: e.target.value }))}
                    onBlur={handleDescriptionBlur}
                    onFocus={markUserInteracted}  // req #2884 — block late select autofocus steal
                    fullWidth
                    multiline
                    minRows={3}
                    autoComplete="off"
                    autoFocus={!categoryUnset && !userInteractedRef.current}
                    inputRef={descriptionInputRef}
                    size="small"
                    data-testid="requirement-description"
                    sx={categoryUnset ? { '& .MuiInputBase-input': { color: 'error.main' } } : undefined}
                />
            </Box>

            {!isNew && (
            <Box sx={{ display: 'flex', gap: 4, mb: 3, ...NARROW }}>
                {/* Requirement timings — left column */}
                <Box sx={{ flex: 1 }}>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Requirement Created</Typography>
                        <Typography variant="body2" data-testid="requirement-create-ts">
                            {requirement.create_ts ? formatDateTime(requirement.create_ts, timezone) : '—'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Requirement Updated</Typography>
                        <Typography variant="body2" data-testid="requirement-update-ts">
                            {requirement.update_ts ? formatDateTime(requirement.update_ts, timezone) : '—'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Requirement Deferred</Typography>
                        <Typography variant="body2" data-testid="requirement-deferred-at">
                            {requirement.deferred_at ? formatDateTime(requirement.deferred_at, timezone) : '—'}
                        </Typography>
                    </Box>
                </Box>
                {/* Session timings — right column */}
                <Box sx={{ flex: 1 }}>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Swarm Started</Typography>
                        <Typography variant="body2" data-testid="requirement-started-at">
                            {requirement.started_at ? formatDateTime(requirement.started_at, timezone) : '—'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>{requirement.requirement_status === 'wontfix' ? "Won't Fix" : 'Requirement Met'}</Typography>
                        <Typography variant="body2" data-testid="requirement-completed-at">
                            {requirement.completed_at ? formatDateTime(requirement.completed_at, timezone) : '—'}
                        </Typography>
                    </Box>
                </Box>
            </Box>
            )}

            {!isNew && (
                <>
                    <Typography variant="h6" gutterBottom>Linked Sessions</Typography>
                    {sessions.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" data-testid="no-linked-sessions">
                            No sessions linked to this requirement.
                        </Typography>
                    ) : (
                        <Box data-testid="linked-sessions-grid">
                            <DataGrid
                                autoHeight
                                rows={sessions}
                                columns={getSessionColumns(navigate, timezone)}
                                density="compact"
                                disableRowSelectionOnClick
                                onRowClick={(params) => navigate(`/swarm/session/${params.id}`)}
                                sx={{ cursor: 'pointer' }}
                            />
                        </Box>
                    )}
                </>
            )}

            <RequirementDeleteDialog
                deleteDialogOpen={requirementDelete.dialogOpen}
                setDeleteDialogOpen={requirementDelete.setDialogOpen}
                setDeleteId={requirementDelete.setInfoObject}
                setDeleteConfirmed={requirementDelete.setConfirmed}
                requirement={requirement}
            />

            <Dialog
                open={requirementReopen.dialogOpen}
                onClose={() => { requirementReopen.setDialogOpen(false); requirementReopen.setInfoObject({}); }}
                data-testid="requirement-reopen-dialog"
            >
                <DialogTitle>
                    {requirementReopen.infoObject.targetStatus === 'deferred' ? 'Defer Requirement' : 'Re-open Requirement'}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {requirementReopen.infoObject.targetStatus === 'deferred'
                            ? 'This will clear the completion date and mark the requirement as deferred. Continue?'
                            : 'Re-opening will clear the completion date. Continue?'}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { requirementReopen.setConfirmed(true); requirementReopen.setDialogOpen(false); }} variant="outlined">
                        {requirementReopen.infoObject.targetStatus === 'deferred' ? 'Defer' : 'Re-open'}
                    </Button>
                    <Button onClick={() => { requirementReopen.setDialogOpen(false); requirementReopen.setInfoObject({}); }} variant="outlined" autoFocus>
                        Cancel
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default RequirementDetail;
