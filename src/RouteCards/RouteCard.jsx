import React, { useState, useMemo, useContext } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { mapRunKeys, mapRouteKeys, mapPartnerKeys, mapRunPartnerKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { loadIndex, loadMeta } from '../photo-browser/handleDB.js';
import { countPhotosForRun } from '../photo-browser/filterUtils.js';
import { checkPhotosProxy, startScan } from '../photo-browser/scanUtils.js';
import { IS_MACOS } from '../photo-browser/proxyConfig.js';
import RouteMapThumbnail from './RouteMapThumbnail';
import RideDeleteDialog from './RideDeleteDialog';
import GhostTextField from '../Components/GhostField/GhostTextField';
import { mapRunFields, dateTimeField, notesField } from '../utils/ghostFieldParsers';
import { ghostSelectBase, ghostAutocompleteInputBase } from '../utils/ghostFieldStyles';

const NO_ROUTE = '__no_route__';
const ACTIVITY_TYPES = ['Ride', 'Hike'];

/**
 * One row of the stats table: label, ghost-editable value, unit.
 *
 * `rule` is the column's entry from ghostFieldParsers — it owns the display format,
 * the canonical form a commit normalizes to, the verdict on a bad value, and the
 * shape of the PUT payload. The card just wires it to a field and a save.
 *
 * `inline` is what keeps `12.5` and ` mi` on the same line inside the <td>, and
 * `overlayMessage` is what keeps them there once a verdict appears: an inline-flex
 * box is as wide as its widest child, so an in-flow "Enter a number" would be three
 * times the width of the value and would shove the unit across the cell. Nothing on
 * the card clips it, unlike the DataGrid cells.
 */
const StatRow = ({ label, column, rule, raw, unit, widthCh, onSave, testId }) => (
    <tr>
        <td>{label}</td>
        <td>
            <GhostTextField
                inline
                overlayMessage
                value={rule.format(raw)}
                required={rule.required}
                normalize={rule.normalize}
                validate={rule.validate}
                // Returns the promise on purpose: GhostTextField awaits onCommit and
                // reverts on rejection, and an adapter that forgets to return would
                // resolve immediately and disable the rollback with no symptom.
                onCommit={(text) => onSave({ [column]: rule.toApi(text) })}
                autoWidthCh={widthCh}
                testId={testId}
            />
            {unit ? ` ${unit}` : null}
        </td>
    </tr>
);

const RouteCard = ({ run, routeName, routes, allRuns, partners = [], runPartners = [], dedupedPhotoIndex = null }) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const showError = useSnackBarStore(s => s.showError);
    const creatorFk = profile?.id;
    const timezone = profile?.timezone;

    const [deleteOpen, setDeleteOpen] = useState(false);

    // Only the three controls that are NOT ghost text fields still mirror the run in
    // local state — a Select and an Autocomplete both have to render optimistically
    // and be rolled back by hand. Every stat field below reads straight from `run`;
    // GhostTextField owns its own text between focus and blur and re-seeds itself
    // from the prop when a refetch lands, which is what makes the old per-field
    // useState block and its `[run.id]` reset effect unnecessary.
    const [routeValue, setRouteValue] = useState(run.map_route_fk ?? NO_ROUTE);
    const [activityType, setActivityType] = useState(run.activity_name || '');
    const [selectedPartners, setSelectedPartners] = useState(() => {
        const ids = runPartners.filter(rp => rp.map_run_fk === run.id).map(rp => rp.map_partner_fk);
        return partners.filter(p => ids.includes(p.id)).map(p => p.name);
    });

    const startTime = useMemo(() => dateTimeField(timezone), [timezone]);

    const sortedRoutes = useMemo(() =>
        [...(routes || [])].sort((a, b) => a.name.localeCompare(b.name)), [routes]);

    // ── Save helpers ─────────────────────────────────────────────────────────

    /**
     * REJECTS on failure, and that is the contract, not an oversight.
     *
     * GhostTextField awaits onCommit and reverts the field when it rejects, so a
     * write that resolves after a 500 would leave the failed value sitting on screen
     * looking saved until the next refetch quietly replaced it — the exact defect
     * req #3073 exists to remove. Every caller that is NOT a GhostTextField catches
     * this itself and rolls back its own optimistic state.
     */
    const saveRunFields = async (fields) => {
        let result;
        try {
            result = await call_rest_api(`${darwinUri}/map_runs`, 'PUT', [{ id: run.id, ...fields }], idToken);
        } catch (err) {
            showError(err, 'Failed to update activity');
            throw err;
        }
        if (result.httpStatus.httpStatus > 204) {
            showError(result, 'Failed to update activity');
            throw new Error('Failed to update activity');
        }
        queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
    };

    const handleRouteChange = async (newValue) => {
        const previous = routeValue;
        setRouteValue(newValue);
        try {
            await saveRunFields({ map_route_fk: newValue === NO_ROUTE ? 'NULL' : newValue });
            queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
        } catch {
            setRouteValue(previous);   // already reported by saveRunFields
        }
    };

    const handleActivityChange = async (newValue) => {
        const previous = activityType;
        setActivityType(newValue);
        try {
            await saveRunFields({ activity_name: newValue });
        } catch {
            setActivityType(previous);
        }
    };

    const handlePartnerChange = async (newNames) => {
        const previous = selectedPartners;
        setSelectedPartners(newNames);
        const existingIds = runPartners.filter(rp => rp.map_run_fk === run.id).map(rp => rp.map_partner_fk);
        const existingNames = partners.filter(p => existingIds.includes(p.id)).map(p => p.name);
        const toAdd = newNames.filter(n => !existingNames.includes(n));
        const toRemove = existingNames.filter(n => !newNames.includes(n));
        try {
            for (const name of toAdd) {
                let partner = partners.find(p => p.name === name);
                if (!partner) {
                    const pr = await call_rest_api(`${darwinUri}/map_partners`, 'POST', { name, creator_fk: creatorFk }, idToken);
                    if (pr.httpStatus.httpStatus === 200 && pr.data?.[0]) partner = pr.data[0]; else continue;
                }
                await call_rest_api(`${darwinUri}/map_run_partners`, 'POST', { map_run_fk: run.id, map_partner_fk: partner.id }, idToken);
            }
            for (const name of toRemove) {
                const partner = partners.find(p => p.name === name);
                if (!partner) continue;
                const link = runPartners.find(rp => rp.map_run_fk === run.id && rp.map_partner_fk === partner.id);
                if (link) await call_rest_api(`${darwinUri}/map_run_partners`, 'DELETE', { id: link.id }, idToken);
            }
            queryClient.invalidateQueries({ queryKey: mapPartnerKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: mapRunPartnerKeys.all(creatorFk) });
        } catch (err) {
            showError(err, 'Failed to update partners');
            setSelectedPartners(previous);
        }
    };

    const handleDeleteConfirm = async () => {
        try {
            const result = await call_rest_api(`${darwinUri}/map_runs`, 'DELETE', { id: run.id }, idToken);
            if (result.httpStatus.httpStatus === 200) {
                queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
                queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
            } else showError(result, 'Failed to delete activity');
        } catch (err) { showError(err, 'Failed to delete activity'); }
    };

    const featureEnabled = IS_MACOS && localStorage.getItem('photo-browser-enabled') !== 'false';

    // Photo count for this activity's exact time window. null until the (shared, parent-loaded)
    // index is available, so the count only renders once we have real data (req #2855).
    const photoCount = useMemo(
        () => (dedupedPhotoIndex ? countPhotosForRun(dedupedPhotoIndex, run) : null),
        [dedupedPhotoIndex, run.id, run.start_time, run.run_time_sec, run.stopped_time_sec]
    );

    const handlePhotosClick = async (e) => {
        e.stopPropagation();
        const [savedIndex, meta, proxy] = await Promise.all([loadIndex(), loadMeta(), checkPhotosProxy()]);
        if (proxy.available && savedIndex && meta?.fileCount !== proxy.assetCount) startScan();
        if (savedIndex) { sessionStorage.setItem('maps_scrollY', String(window.scrollY)); navigate(`/maps/photos/${run.id}`); }
        else if (proxy.available) { startScan(); navigate('/maps/settings/photos'); }
        else navigate('/maps/settings/photos');
    };

    return (
        <>
            <Card raised={true}
                data-testid="route-card"
                sx={{ border: '2px solid transparent', position: 'relative', '&:hover': { borderColor: 'primary.main' } }}
            >
                {/* Header — route name (Select, no arrow) + delete button.
                    Matches original: fontSize 24, fontWeight normal, flexGrow 1. */}
                <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pt: 1.5 }}>
                    <Select
                        value={routeValue}
                        onChange={(e) => handleRouteChange(e.target.value)}
                        variant="standard"
                        displayEmpty
                        IconComponent={() => null}
                        data-testid="route-card-route-select"
                        sx={(theme) => ({
                            ...ghostSelectBase(theme),
                            fontSize: 24, fontWeight: 'normal', flexGrow: 1,
                        })}
                    >
                        <MenuItem value={NO_ROUTE}><em>No route</em></MenuItem>
                        {sortedRoutes.map(r => (
                            <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
                        ))}
                    </Select>
                </Box>

                {/* Thumbnail — the only clickable element that navigates */}
                <Box onClick={() => { sessionStorage.setItem('maps_scrollY', String(window.scrollY)); navigate(`/maps/${run.id}`); }} sx={{ cursor: 'pointer' }} data-testid="route-card-thumbnail">
                    <RouteMapThumbnail runId={run.id} />
                </Box>

                <CardContent>
                    {/* Subtitle row — matches original: body2 secondary, flex row with photo btn.
                        Activity type + separator + start time, all ghost-editable. */}
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <Select
                                value={activityType}
                                onChange={(e) => handleActivityChange(e.target.value)}
                                variant="standard"
                                IconComponent={() => null}
                                data-testid="route-card-activity-type"
                                sx={(theme) => ({
                                    ...ghostSelectBase(theme),
                                    fontSize: '0.875rem',
                                    color: 'text.secondary',
                                })}
                            >
                                {ACTIVITY_TYPES.map(t => <MenuItem key={t} value={t} sx={{ fontSize: '0.875rem' }}>{t}</MenuItem>)}
                            </Select>
                            <Typography variant="body2" color="text.secondary" component="span" sx={{ mx: 0.75 }}>·</Typography>
                            <GhostTextField
                                inline
                                overlayMessage
                                type="datetime-local"
                                value={startTime.format(run.start_time)}
                                required={startTime.required}
                                validate={startTime.validate}
                                onCommit={(text) => saveRunFields({ start_time: startTime.toApi(text) })}
                                testId="route-card-start-time"
                                sx={{
                                    fontSize: '0.875rem',
                                    color: 'text.secondary',
                                    // Without this Chrome's own picker button opens on
                                    // click and swallows the first Escape to close
                                    // itself, so the field never sees the abandon key.
                                    '& input::-webkit-calendar-picker-indicator': { display: 'none' },
                                    '& input::-webkit-inner-spin-button': { display: 'none' },
                                    '& .MuiInputBase-input': { minWidth: '16ch' },
                                }}
                            />
                        </Box>
                        {featureEnabled && (
                            <Box sx={{ display: 'flex', alignItems: 'center', ml: 0.5 }}>
                                <IconButton size="small" onClick={handlePhotosClick} title="Browse photos from this activity"
                                    data-testid="route-card-photos-btn" sx={{ p: 0.25 }}>
                                    <CameraAltIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                                {photoCount != null && (
                                    <Typography variant="caption" color="text.secondary"
                                        data-testid="route-card-photos-count"
                                        title={`${photoCount} photos & videos`}
                                        sx={{ ml: 0.25 }}>
                                        {photoCount}
                                    </Typography>
                                )}
                            </Box>
                        )}
                    </Box>

                    {/* Stats table — matches original sx exactly.
                        Right column: ghost text field followed by " unit", same as original "{value} unit". */}
                    <Box component="table" sx={{ width: '100%', '& td': { py: 0.2 }, '& td:first-of-type': { color: 'text.secondary', pr: 1.5 } }}>
                        <tbody>
                            <StatRow label="Distance" column="distance_mi" rule={mapRunFields.distance_mi}
                                raw={run.distance_mi} unit="mi" widthCh={3}
                                onSave={saveRunFields} testId="route-card-distance" />
                            <StatRow label="Avg Speed" column="avg_speed_mph" rule={mapRunFields.avg_speed_mph}
                                raw={run.avg_speed_mph} unit="mph" widthCh={3}
                                onSave={saveRunFields} testId="route-card-avg-speed" />
                            <StatRow label="Max Speed" column="max_speed_mph" rule={mapRunFields.max_speed_mph}
                                raw={run.max_speed_mph} unit="mph" widthCh={3}
                                onSave={saveRunFields} testId="route-card-max-speed" />
                            <StatRow label="Ascent" column="ascent_ft" rule={mapRunFields.ascent_ft}
                                raw={run.ascent_ft} unit="ft" widthCh={1}
                                onSave={saveRunFields} testId="route-card-ascent" />
                            <StatRow label="Ride Time" column="run_time_sec" rule={mapRunFields.run_time_sec}
                                raw={run.run_time_sec} widthCh={7}
                                onSave={saveRunFields} testId="route-card-ride-time" />
                            <StatRow label="Stop Time" column="stopped_time_sec" rule={mapRunFields.stopped_time_sec}
                                raw={run.stopped_time_sec} widthCh={7}
                                onSave={saveRunFields} testId="route-card-stopped-time" />
                        </tbody>
                    </Box>

                    {/* Notes — matches original: body2 secondary italic.
                        Always visible (empty = blank line, hover shows affordance). */}
                    <GhostTextField
                        multiline
                        value={notesField.format(run.notes)}
                        normalize={notesField.normalize}
                        onCommit={(text) => saveRunFields({ notes: notesField.toApi(text) })}
                        testId="route-card-notes"
                        sx={{
                            mt: 1,
                            fontSize: '0.875rem',
                            color: 'text.secondary',
                            fontStyle: 'italic',
                            '& .MuiInputBase-input': {
                                fontSize: '0.875rem',
                                color: 'text.secondary',
                                fontStyle: 'italic',
                                minHeight: '1.2em',
                            },
                        }}
                    />

                    {/* Partners row — Autocomplete on left, delete button on right */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-end', mt: 1 }}>
                        <Autocomplete
                            multiple freeSolo
                            options={partners.map(p => p.name)}
                            value={selectedPartners}
                            onChange={(e, v) => handlePartnerChange(v)}
                            disablePortal={false}
                            sx={{ flexGrow: 1 }}
                            renderTags={(value, getTagProps) =>
                                value.map((option, index) => (
                                    <Chip variant="outlined" label={option} size="small" {...getTagProps({ index })} key={option} />
                                ))
                            }
                            renderInput={(params) => (
                                <TextField
                                    {...params}
                                    variant="standard"
                                    placeholder={selectedPartners.length === 0 ? 'No partners' : ''}
                                    sx={(theme) => ghostAutocompleteInputBase(theme, {
                                        placeholderFontSize: '0.875rem',
                                    })}
                                />
                            )}
                            data-testid="route-card-partners"
                        />
                        <IconButton size="small" color="error" onClick={() => setDeleteOpen(true)}
                                    sx={{ p: 0.25, mb: 0.25 }} data-testid="route-card-delete-btn">
                            <DeleteOutlineIcon sx={{ fontSize: 22 }} />
                        </IconButton>
                    </Box>
                </CardContent>
            </Card>

            <RideDeleteDialog
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                onConfirm={handleDeleteConfirm}
                run={run}
                routeName={routeName}
                timezone={timezone}
            />
        </>
    );
};

export default RouteCard;
