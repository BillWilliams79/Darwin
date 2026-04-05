import React, { useState, useEffect, useMemo, useContext } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import InputBase from '@mui/material/InputBase';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { mapRunKeys, mapRouteKeys, mapPartnerKeys, mapRunPartnerKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { loadIndex, loadMeta } from '../photo-browser/handleDB.js';
import { checkPhotosProxy, startScan } from '../photo-browser/scanUtils.js';
import { IS_MACOS } from '../photo-browser/proxyConfig.js';
import RouteMapThumbnail from './RouteMapThumbnail';
import RideDeleteDialog from './RideDeleteDialog';
import { formatDuration, parseDuration } from '../utils/mapDataUtils';
import { toDateTimeLocalValue, fromDateTimeLocalValue } from '../utils/dateFormat';

const NO_ROUTE = '__no_route__';
const ACTIVITY_TYPES = ['Ride', 'Hike'];

// InputBase that looks like plain text until hovered (subtle underline) or focused (primary underline).
// Uses CSS border-bottom on the <input> element itself — no MUI underline animation layer needed.
const ghostBase = {
    display: 'inline-flex',
    verticalAlign: 'baseline',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    color: 'inherit',
    letterSpacing: 'inherit',
    '& .MuiInputBase-input': {
        p: 0,
        height: 'auto',
        fontSize: 'inherit',
        fontFamily: 'inherit',
        lineHeight: 'inherit',
        color: 'inherit',
        letterSpacing: 'inherit',
        borderBottom: '1px solid transparent',
        transition: 'border-bottom-color 150ms',
        '&:hover': { borderBottomColor: 'rgba(0,0,0,0.3)' },
        '&:focus': { outline: 'none', borderBottomColor: 'primary.main' },
    },
};

const RouteCard = ({ run, routeName, routes, allRuns, partners = [], runPartners = [] }) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const showError = useSnackBarStore(s => s.showError);
    const creatorFk = profile?.id;
    const timezone = profile?.timezone;

    const [deleteOpen, setDeleteOpen] = useState(false);

    // Editable state — mirrors run props
    const [routeValue, setRouteValue] = useState(run.map_route_fk ?? NO_ROUTE);
    const [activityType, setActivityType] = useState(run.activity_name || '');
    const [startTime, setStartTime] = useState(() => toDateTimeLocalValue(run.start_time, timezone));
    const [distance, setDistance] = useState(Number(run.distance_mi).toFixed(1));
    const [avgSpeed, setAvgSpeed] = useState(run.avg_speed_mph != null ? Number(run.avg_speed_mph).toFixed(1) : '');
    const [maxSpeed, setMaxSpeed] = useState(run.max_speed_mph != null ? Number(run.max_speed_mph).toFixed(1) : '');
    const [ascent, setAscent] = useState(run.ascent_ft != null ? String(Math.round(Number(run.ascent_ft))) : '');
    const [rideTime, setRideTime] = useState(formatDuration(run.run_time_sec));
    const [stoppedTime, setStoppedTime] = useState(formatDuration(run.stopped_time_sec || 0));
    const [notes, setNotes] = useState(run.notes || '');
    const [selectedPartners, setSelectedPartners] = useState(() => {
        const ids = runPartners.filter(rp => rp.map_run_fk === run.id).map(rp => rp.map_partner_fk);
        return partners.filter(p => ids.includes(p.id)).map(p => p.name);
    });

    // Reset when a different run is displayed
    useEffect(() => {
        setRouteValue(run.map_route_fk ?? NO_ROUTE);
        setActivityType(run.activity_name || '');
        setStartTime(toDateTimeLocalValue(run.start_time, timezone));
        setDistance(Number(run.distance_mi).toFixed(1));
        setAvgSpeed(run.avg_speed_mph != null ? Number(run.avg_speed_mph).toFixed(1) : '');
        setMaxSpeed(run.max_speed_mph != null ? Number(run.max_speed_mph).toFixed(1) : '');
        setAscent(run.ascent_ft != null ? String(Math.round(Number(run.ascent_ft))) : '');
        setRideTime(formatDuration(run.run_time_sec));
        setStoppedTime(formatDuration(run.stopped_time_sec || 0));
        setNotes(run.notes || '');
        const ids = runPartners.filter(rp => rp.map_run_fk === run.id).map(rp => rp.map_partner_fk);
        setSelectedPartners(partners.filter(p => ids.includes(p.id)).map(p => p.name));
    }, [run.id]); // eslint-disable-line react-hooks/exhaustive-deps


    const sortedRoutes = useMemo(() =>
        [...(routes || [])].sort((a, b) => a.name.localeCompare(b.name)), [routes]);

    // ── Save helpers ─────────────────────────────────────────────────────────

    const saveRunFields = async (fields) => {
        try {
            const result = await call_rest_api(`${darwinUri}/map_runs`, 'PUT', [{ id: run.id, ...fields }], idToken);
            if (result.httpStatus.httpStatus > 204) showError(result, 'Failed to update activity');
            else queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
        } catch (err) {
            showError(err, 'Failed to update activity');
        }
    };

    const handleRouteChange = async (newValue) => {
        setRouteValue(newValue);
        await saveRunFields({ map_route_fk: newValue === NO_ROUTE ? 'NULL' : newValue });
        queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
    };

    const handlePartnerChange = async (newNames) => {
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
        } catch (err) { showError(err, 'Failed to update partners'); }
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

    const handlePhotosClick = async (e) => {
        e.stopPropagation();
        const [savedIndex, meta, proxy] = await Promise.all([loadIndex(), loadMeta(), checkPhotosProxy()]);
        if (proxy.available && savedIndex && meta?.fileCount !== proxy.assetCount) startScan();
        if (savedIndex) { sessionStorage.setItem('maps_scrollY', String(window.scrollY)); navigate(`/maps/photos/${run.id}`); }
        else if (proxy.available) { startScan(); navigate('/maps/settings/photos'); }
        else navigate('/maps/settings/photos');
    };

    // w: width in ch units for the input, sized to current value length
    const w = (val, min = 2) => ({ style: { width: `${Math.max((val ?? '').length, min)}ch` } });

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
                        sx={{
                            fontSize: 24, fontWeight: 'normal', flexGrow: 1,
                            '& .MuiSelect-select': { py: 0, pr: '0 !important' },
                            '&:before': { borderBottomColor: 'transparent' },
                            '&:hover:not(.Mui-disabled):before': { borderBottomColor: 'rgba(0,0,0,0.3)' },
                        }}
                    >
                        <MenuItem value={NO_ROUTE}><em>No route</em></MenuItem>
                        {sortedRoutes.map(r => (
                            <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
                        ))}
                    </Select>
                    <IconButton size="small" color="error" onClick={() => setDeleteOpen(true)} sx={{ p: 0.25 }} data-testid="route-card-delete-btn">
                        <DeleteOutlineIcon sx={{ fontSize: 22 }} />
                    </IconButton>
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
                                onChange={async (e) => { setActivityType(e.target.value); await saveRunFields({ activity_name: e.target.value }); }}
                                variant="standard"
                                IconComponent={() => null}
                                data-testid="route-card-activity-type"
                                sx={{
                                    fontSize: '0.875rem',
                                    color: 'text.secondary',
                                    '& .MuiSelect-select': { py: 0, pr: '0 !important' },
                                    '&:before': { borderBottomColor: 'transparent' },
                                    '&:hover:not(.Mui-disabled):before': { borderBottomColor: 'rgba(0,0,0,0.3)' },
                                }}
                            >
                                {ACTIVITY_TYPES.map(t => <MenuItem key={t} value={t} sx={{ fontSize: '0.875rem' }}>{t}</MenuItem>)}
                            </Select>
                            <Typography variant="body2" color="text.secondary" component="span" sx={{ mx: 0.75 }}>·</Typography>
                            <InputBase
                                type="datetime-local"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                onBlur={async () => { const p = fromDateTimeLocalValue(startTime, timezone); if (p) await saveRunFields({ start_time: p }); }}
                                sx={{
                                    ...ghostBase,
                                    fontSize: '0.875rem',
                                    color: 'text.secondary',
                                    '& input::-webkit-calendar-picker-indicator': { display: 'none' },
                                    '& input::-webkit-inner-spin-button': { display: 'none' },
                                    '& .MuiInputBase-input': {
                                        ...ghostBase['& .MuiInputBase-input'],
                                        minWidth: '16ch',
                                    },
                                }}
                                data-testid="route-card-start-time"
                            />
                        </Box>
                        {featureEnabled && (
                            <IconButton size="small" onClick={handlePhotosClick} title="Browse photos from this activity"
                                data-testid="route-card-photos-btn" sx={{ ml: 0.5, p: 0.25 }}>
                                <PhotoLibraryIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                        )}
                    </Box>

                    {/* Stats table — matches original sx exactly.
                        Right column: InputBase (ghost text) followed by " unit" text, same as original "{value} unit". */}
                    <Box component="table" sx={{ width: '100%', '& td': { py: 0.2 }, '& td:first-of-type': { color: 'text.secondary', pr: 1.5 } }}>
                        <tbody>
                            <tr>
                                <td>Distance</td>
                                <td>
                                    <InputBase value={distance} onChange={(e) => setDistance(e.target.value)}
                                        onBlur={async () => { const v = parseFloat(distance); if (!isNaN(v)) await saveRunFields({ distance_mi: v }); }}
                                        inputProps={w(distance, 3)} sx={ghostBase} data-testid="route-card-distance"
                                    /> mi
                                </td>
                            </tr>
                            <tr>
                                <td>Avg Speed</td>
                                <td>
                                    <InputBase value={avgSpeed} onChange={(e) => setAvgSpeed(e.target.value)}
                                        onBlur={async () => { const v = avgSpeed === '' ? 'NULL' : parseFloat(avgSpeed); if (avgSpeed === '' || !isNaN(v)) await saveRunFields({ avg_speed_mph: v }); }}
                                        inputProps={w(avgSpeed, 3)} sx={ghostBase} data-testid="route-card-avg-speed"
                                    /> mph
                                </td>
                            </tr>
                            <tr>
                                <td>Max Speed</td>
                                <td>
                                    <InputBase value={maxSpeed} onChange={(e) => setMaxSpeed(e.target.value)}
                                        onBlur={async () => { const v = maxSpeed === '' ? 'NULL' : parseFloat(maxSpeed); if (maxSpeed === '' || !isNaN(v)) await saveRunFields({ max_speed_mph: v }); }}
                                        inputProps={w(maxSpeed, 3)} sx={ghostBase} data-testid="route-card-max-speed"
                                    /> mph
                                </td>
                            </tr>
                            <tr>
                                <td>Ascent</td>
                                <td>
                                    <InputBase value={ascent} onChange={(e) => setAscent(e.target.value)}
                                        onBlur={async () => { const v = ascent === '' ? 'NULL' : parseInt(ascent, 10); if (ascent === '' || !isNaN(v)) await saveRunFields({ ascent_ft: v }); }}
                                        inputProps={w(ascent, 1)} sx={ghostBase} data-testid="route-card-ascent"
                                    /> ft
                                </td>
                            </tr>
                            <tr>
                                <td>Ride Time</td>
                                <td>
                                    <InputBase value={rideTime} onChange={(e) => setRideTime(e.target.value)}
                                        onBlur={async () => { const s = parseDuration(rideTime); if (!isNaN(s)) await saveRunFields({ run_time_sec: s }); }}
                                        inputProps={w(rideTime, 7)}
                                        sx={{ ...ghostBase, '& .MuiInputBase-input': { ...ghostBase['& .MuiInputBase-input'], color: rideTime !== '' && isNaN(parseDuration(rideTime)) ? 'error.main' : 'inherit' } }}
                                        data-testid="route-card-ride-time"
                                    />
                                </td>
                            </tr>
                            <tr>
                                <td>Stop Time</td>
                                <td>
                                    <InputBase value={stoppedTime} onChange={(e) => setStoppedTime(e.target.value)}
                                        onBlur={async () => { const s = parseDuration(stoppedTime); if (!isNaN(s)) await saveRunFields({ stopped_time_sec: s }); }}
                                        inputProps={w(stoppedTime, 7)}
                                        sx={{ ...ghostBase, '& .MuiInputBase-input': { ...ghostBase['& .MuiInputBase-input'], color: stoppedTime !== '' && isNaN(parseDuration(stoppedTime)) ? 'error.main' : 'inherit' } }}
                                        data-testid="route-card-stopped-time"
                                    />
                                </td>
                            </tr>
                        </tbody>
                    </Box>

                    {/* Notes — matches original: body2 secondary italic.
                        Always visible (empty = blank line, hover shows affordance). */}
                    <InputBase
                        fullWidth multiline
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        onBlur={async () => saveRunFields({ notes: notes.trim() || 'NULL' })}
                        sx={{
                            ...ghostBase,
                            display: 'flex',
                            mt: 1,
                            fontSize: '0.875rem',
                            color: 'text.secondary',
                            fontStyle: 'italic',
                            '& .MuiInputBase-input': {
                                ...ghostBase['& .MuiInputBase-input'],
                                fontSize: '0.875rem',
                                color: 'text.secondary',
                                fontStyle: 'italic',
                                minHeight: '1.2em',
                            },
                        }}
                        data-testid="route-card-notes"
                    />

                    {/* Partners — chips inline with input on one row.
                        TextField variant="standard" is what MUI Autocomplete is designed for;
                        the Popper listbox floats (portal) so it never pushes content down. */}
                    <Autocomplete
                        multiple freeSolo
                        options={partners.map(p => p.name)}
                        value={selectedPartners}
                        onChange={(e, v) => handlePartnerChange(v)}
                        disablePortal={false}
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
                                sx={{
                                    mt: 1,
                                    '& .MuiInput-underline:before': { borderBottomColor: 'transparent' },
                                    '& .MuiInput-underline:hover:not(.Mui-disabled, .Mui-error):before': { borderBottomColor: 'rgba(0,0,0,0.3)' },
                                    '& .MuiInputBase-input::placeholder': { color: 'text.disabled', opacity: 1, fontSize: '0.875rem' },
                                    '& .MuiInputBase-root': { flexWrap: 'wrap', gap: 0.5 },
                                }}
                            />
                        )}
                        data-testid="route-card-partners"
                    />
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
