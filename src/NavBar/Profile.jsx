import '../index.css';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { fetchExportData, downloadJson } from '../services/exportService';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { getTimezoneList } from '../utils/dateFormat';

import ThemeContext from '../Theme/ThemeContext';

import React, { useContext, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import LoginOutlined from '@mui/icons-material/LoginOutlined';
import PersonAddOutlined from '@mui/icons-material/PersonAddOutlined';

const Profile = () => {

    const { idToken, profile, setProfile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const { themeMode, setThemeMode } = useContext(ThemeContext);
    const showError = useSnackBarStore(s => s.showError);
    const navigate = useNavigate();

    const [name, setName] = useState(profile?.name || '');
    const [timezone, setTimezone] = useState(profile?.timezone || '');
    const [exporting, setExporting] = useState(false);
    const [appTasks, setAppTasks] = useState(Number(profile?.app_tasks ?? 1));
    const [appMaps, setAppMaps] = useState(Number(profile?.app_maps ?? 1));
    const [appSwarm, setAppSwarm] = useState(Number(profile?.app_swarm ?? 0));

    const timezoneOptions = useMemo(() => getTimezoneList(), []);
    const selectedTimezone = timezoneOptions.find(tz => tz.value === timezone) || null;

    // Ref to track the latest profile values for save comparison
    const savedNameRef = useRef(profile?.name || '');
    const savedTimezoneRef = useRef(profile?.timezone || '');
    const savedThemeModeRef = useRef(profile?.theme_mode || 'light');
    const savedAppTasksRef = useRef(Number(profile?.app_tasks ?? 1));
    const savedAppMapsRef = useRef(Number(profile?.app_maps ?? 1));
    const savedAppSwarmRef = useRef(Number(profile?.app_swarm ?? 0));

    // Fetch fresh profile from DB on mount — stale localStorage must not be authoritative
    useEffect(() => {
        if (!idToken || !profile?.id) return;
        call_rest_api(`${darwinUri}/profiles?id=${profile.id}`, 'GET', '', idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200 && result.data?.[0]) {
                    const db = result.data[0];
                    // Sync local state with DB truth
                    setName(db.name || '');
                    setTimezone(db.timezone || '');
                    setAppTasks(Number(db.app_tasks ?? 1));
                    setAppMaps(Number(db.app_maps ?? 1));
                    setAppSwarm(Number(db.app_swarm ?? 0));
                    // Sync saved refs so change-detection works against DB truth
                    savedNameRef.current = db.name || '';
                    savedTimezoneRef.current = db.timezone || '';
                    savedThemeModeRef.current = db.theme_mode || 'light';
                    savedAppTasksRef.current = Number(db.app_tasks ?? 1);
                    savedAppMapsRef.current = Number(db.app_maps ?? 1);
                    savedAppSwarmRef.current = Number(db.app_swarm ?? 0);
                    // Update context + localStorage with merged profile
                    const updated = { ...profile, ...db };
                    setProfile(updated);
                    localStorage.setItem('darwin-profile', JSON.stringify(updated));
                }
            })
            .catch(() => {}); // silent — fall back to cached values
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveProfile = useCallback((newName, newTimezone, newThemeMode, newAppTasks, newAppMaps, newAppSwarm) => {
        // Skip if nothing changed from last saved values
        if (newName === savedNameRef.current && newTimezone === savedTimezoneRef.current
            && newThemeMode === savedThemeModeRef.current
            && newAppTasks === savedAppTasksRef.current && newAppMaps === savedAppMapsRef.current
            && newAppSwarm === savedAppSwarmRef.current) return;

        const uri = `${darwinUri}/profiles`;
        call_rest_api(uri, 'PUT', [{
            id: profile.id, name: newName, timezone: newTimezone, theme_mode: newThemeMode,
            app_tasks: newAppTasks, app_maps: newAppMaps, app_swarm: newAppSwarm,
        }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200 || result.httpStatus.httpStatus === 204) {
                    savedNameRef.current = newName;
                    savedTimezoneRef.current = newTimezone;
                    savedThemeModeRef.current = newThemeMode;
                    savedAppTasksRef.current = newAppTasks;
                    savedAppMapsRef.current = newAppMaps;
                    savedAppSwarmRef.current = newAppSwarm;
                    const updated = {
                        ...profile, name: newName, timezone: newTimezone, theme_mode: newThemeMode,
                        app_tasks: newAppTasks, app_maps: newAppMaps, app_swarm: newAppSwarm,
                    };
                    setProfile(updated);
                    localStorage.setItem('darwin-profile', JSON.stringify(updated));
                } else {
                    showError(result, 'Unable to save profile');
                }
            })
            .catch(error => showError(error, 'Unable to save profile'));
    }, [darwinUri, profile, idToken, setProfile, showError]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const data = await fetchExportData(darwinUri, profile.userName, idToken, profile);
            const date = new Date().toISOString().slice(0, 10);
            downloadJson(data, `darwin-export-${date}.json`);
        } catch (err) {
            showError(err, 'Export failed. Please try again.');
        } finally {
            setExporting(false);
        }
    };

    // Unauthenticated view — login and create account buttons
    if (!idToken) {
        return (
            <>
            <Box className="app-title" sx={{ ml: 2}}>
                <Typography variant="h5">
                    Profile
                </Typography>
            </Box>
            <Box className="app-content" sx={{ margin: 2, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
                <Button
                    variant="contained"
                    startIcon={<LoginOutlined />}
                    onClick={() => navigate('/login', { state: { from: { pathname: '/taskcards' } } })}
                    data-testid="login-button"
                >
                    Log In
                </Button>
                <Button
                    variant="outlined"
                    startIcon={<PersonAddOutlined />}
                    onClick={() => navigate('/signup')}
                    data-testid="create-account-button"
                >
                    Create Account
                </Button>
            </Box>
            </>
        );
    }

    // Authenticated view — profile fields + export + logout
    return (
        <>
        <Box className="app-title" sx={{ ml: 2}}>
            <Typography variant="h5">
                Profile
            </Typography>
        </Box >
        <Box className="app-content" sx={{ margin: 2, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
            <TextField  label="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={() => saveProfile(name, timezone, themeMode, appTasks, appMaps, appSwarm)}
                        id="Name"
                        key="Name"
                        variant="outlined"
                        size='small'
                        data-testid="profile-name" />
            <TextField  label="E-mail"
                        value = { profile.email }
                        id= "email"
                        key="email"
                        variant= "outlined"
                        size = 'small'
                        disabled />
            <Autocomplete
                        options={timezoneOptions}
                        value={selectedTimezone}
                        onChange={(e, newValue) => {
                            const newTz = newValue?.value || '';
                            setTimezone(newTz);
                            saveProfile(name, newTz, themeMode, appTasks, appMaps, appSwarm);
                        }}
                        isOptionEqualToValue={(option, value) => option.value === value.value}
                        renderInput={(params) => (
                            <TextField {...params} label="Timezone" size="small" />
                        )}
                        data-testid="profile-timezone"
                        disableClearable
                        />
            {/* Applications selector — toggle cards for app groups */}
            <Box>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>Applications</Typography>
                <Box sx={{ display: 'flex', gap: 2 }} data-testid="profile-app-toggle">
                    {[
                        { key: 'tasks', label: 'Tasks', value: appTasks, setValue: setAppTasks },
                        { key: 'maps', label: 'Maps', value: appMaps, setValue: setAppMaps },
                        { key: 'swarm', label: 'Swarm', value: appSwarm, setValue: setAppSwarm },
                    ].map((app) => {
                        const enabled = app.value === 1;
                        // Count currently enabled apps to prevent disabling all
                        const enabledCount = [appTasks, appMaps, appSwarm].filter(v => v === 1).length;

                        const handleToggle = () => {
                            if (enabled && enabledCount <= 1) return; // prevent all-disabled
                            const newVal = enabled ? 0 : 1;
                            app.setValue(newVal);
                            const newTasks = app.key === 'tasks' ? newVal : appTasks;
                            const newMaps = app.key === 'maps' ? newVal : appMaps;
                            const newSwarm = app.key === 'swarm' ? newVal : appSwarm;
                            saveProfile(name, timezone, themeMode, newTasks, newMaps, newSwarm);
                        };

                        // Miniature preview content for each app
                        const renderPreview = () => {
                            const fg = enabled ? 'text.secondary' : 'action.disabled';
                            if (app.key === 'tasks') {
                                // Task card rows
                                return (
                                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.4, p: 0.5 }}>
                                        {[0, 1, 2].map((i) => (
                                            <Box key={i} sx={{
                                                height: 12, borderRadius: 0.5, bgcolor: 'action.hover',
                                                display: 'flex', alignItems: 'center', gap: '3px', px: 0.5,
                                            }}>
                                                <Box sx={{ width: 5, height: 5, borderRadius: '50%', border: '1.5px solid', borderColor: fg, flexShrink: 0 }} />
                                                <Box sx={{ flex: 1, height: 3, borderRadius: 0.5, bgcolor: fg }} />
                                            </Box>
                                        ))}
                                    </Box>
                                );
                            }
                            if (app.key === 'maps') {
                                // Map route line
                                return (
                                    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 0.5 }}>
                                        <svg width="60" height="40" viewBox="0 0 60 40">
                                            <path d="M8 32 Q15 8, 30 20 T52 8" fill="none"
                                                stroke={enabled ? '#1976d2' : '#bbb'} strokeWidth="2.5" strokeLinecap="round" />
                                            <circle cx="8" cy="32" r="3" fill={enabled ? '#e91e63' : '#ccc'} />
                                            <circle cx="52" cy="8" r="3" fill={enabled ? '#4caf50' : '#ccc'} />
                                        </svg>
                                    </Box>
                                );
                            }
                            // Swarm — roadmap columns
                            return (
                                <Box sx={{ flex: 1, display: 'flex', gap: 0.4, p: 0.5 }}>
                                    {[0, 1, 2].map((col) => (
                                        <Box key={col} sx={{
                                            flex: 1, borderRadius: 0.5, bgcolor: 'action.hover',
                                            display: 'flex', flexDirection: 'column', gap: 0.3, p: 0.3,
                                        }}>
                                            <Box sx={{ height: 5, borderRadius: 0.3, bgcolor: fg }} />
                                            {[0, 1].map((r) => (
                                                <Box key={r} sx={{ height: 8, borderRadius: 0.3, bgcolor: 'action.selected' }} />
                                            ))}
                                        </Box>
                                    ))}
                                </Box>
                            );
                        };

                        return (
                            <Box key={app.key}
                                onClick={handleToggle}
                                sx={{
                                    cursor: enabled && enabledCount <= 1 ? 'default' : 'pointer',
                                    textAlign: 'center',
                                    '&:hover .app-thumb': enabled && enabledCount <= 1 ? {} : { borderColor: 'primary.main' },
                                }}
                            >
                                <Box className="app-thumb" sx={{
                                    width: 110, height: 78, borderRadius: 1.5, overflow: 'hidden',
                                    border: '2px solid',
                                    borderColor: enabled ? 'primary.main' : 'divider',
                                    boxShadow: enabled ? '0 0 0 2px rgba(144,202,249,0.3)' : 'none',
                                    bgcolor: 'background.paper',
                                    display: 'flex',
                                }}>
                                    {renderPreview()}
                                </Box>
                                <Typography variant="caption" sx={{
                                    mt: 0.5, display: 'block',
                                    fontWeight: enabled ? 600 : 400,
                                    color: enabled ? 'primary.main' : 'text.secondary',
                                }}>
                                    {app.label}
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
            {/* Appearance selector — miniature task card previews */}
            <Box>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>Appearance</Typography>
                <Box sx={{ display: 'flex', gap: 2 }} data-testid="profile-theme-toggle">
                    {['light', 'dark', 'system'].map((m) => {
                        const selected = themeMode === m;
                        // Color palettes for light and dark previews
                        const palettes = {
                            light: { bg: '#fafafa', card: '#fff', header: '#e0e0e0', row: '#f5f5f5', text: '#bbb', dot: '#ccc' },
                            dark:  { bg: '#141210', card: '#2a2723', header: '#3a3632', row: '#2a2723', text: '#9a9186', dot: '#555' },
                        };
                        const nav = '#212121';

                        // Render helper for a single-mode thumbnail interior
                        const renderPreviewContent = (p) => (
                            <>
                                <Box sx={{ width: 14, borderRadius: 0.5, bgcolor: nav, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                                    <Box sx={{
                                        flex: 1, borderRadius: 0.75, bgcolor: p.card,
                                        display: 'flex', flexDirection: 'column', overflow: 'hidden',
                                    }}>
                                        <Box sx={{ height: 10, bgcolor: p.header, px: 0.5, display: 'flex', alignItems: 'center' }}>
                                            <Box sx={{ width: 18, height: 3, borderRadius: 0.5, bgcolor: p.text }} />
                                        </Box>
                                        {[0, 1, 2].map((i) => (
                                            <Box key={i} sx={{
                                                height: 8, bgcolor: p.row, mx: 0.25, mt: 0.25, borderRadius: 0.3,
                                                display: 'flex', alignItems: 'center', gap: '2px', px: 0.3,
                                            }}>
                                                <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: p.dot, flexShrink: 0 }} />
                                                <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: p.dot, flexShrink: 0 }} />
                                                <Box sx={{ flex: 1, height: 2.5, borderRadius: 0.5, bgcolor: p.text, ml: 0.25 }} />
                                            </Box>
                                        ))}
                                    </Box>
                                    <Box sx={{ height: 10, borderRadius: 0.75, bgcolor: p.card }}>
                                        <Box sx={{ height: 10, bgcolor: p.header, borderRadius: 0.75, px: 0.5, display: 'flex', alignItems: 'center' }}>
                                            <Box sx={{ width: 14, height: 3, borderRadius: 0.5, bgcolor: p.text }} />
                                        </Box>
                                    </Box>
                                </Box>
                            </>
                        );

                        return (
                            <Box key={m}
                                onClick={() => { setThemeMode(m); saveProfile(name, timezone, m, appTasks, appMaps, appSwarm); }}
                                sx={{
                                    cursor: 'pointer', textAlign: 'center',
                                    '&:hover .theme-thumb': { borderColor: 'primary.main' },
                                }}
                            >
                                <Box className="theme-thumb" sx={{
                                    width: 110, height: 78, borderRadius: 1.5, overflow: 'hidden',
                                    border: '2px solid',
                                    borderColor: selected ? 'primary.main' : 'divider',
                                    boxShadow: selected ? '0 0 0 2px rgba(144,202,249,0.3)' : 'none',
                                    bgcolor: m === 'system' ? palettes.light.bg : palettes[m].bg,
                                    p: 0.5,
                                    display: 'flex', gap: 0.4,
                                    position: 'relative',
                                }}>
                                    {m === 'system' ? (
                                        /* Split preview: light left half, dark right half */
                                        <>
                                            {/* Light half */}
                                            <Box sx={{
                                                position: 'absolute', inset: 0, p: 0.5,
                                                display: 'flex', gap: 0.4,
                                                bgcolor: palettes.light.bg,
                                                clipPath: 'polygon(0 0, 50% 0, 50% 100%, 0 100%)',
                                            }}>
                                                {renderPreviewContent(palettes.light)}
                                            </Box>
                                            {/* Dark half */}
                                            <Box sx={{
                                                position: 'absolute', inset: 0, p: 0.5,
                                                display: 'flex', gap: 0.4,
                                                bgcolor: palettes.dark.bg,
                                                clipPath: 'polygon(50% 0, 100% 0, 100% 100%, 50% 100%)',
                                            }}>
                                                {renderPreviewContent(palettes.dark)}
                                            </Box>
                                        </>
                                    ) : (
                                        renderPreviewContent(palettes[m])
                                    )}
                                </Box>
                                <Typography variant="caption" sx={{
                                    mt: 0.5, display: 'block',
                                    fontWeight: selected ? 600 : 400,
                                    color: selected ? 'primary.main' : 'text.secondary',
                                }}>
                                    {m === 'light' ? 'Light' : m === 'dark' ? 'Dark' : 'System'}
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
            <Button
                variant="outlined"
                startIcon={exporting ? <CircularProgress size={20} /> : <FileDownloadOutlinedIcon />}
                onClick={handleExport}
                disabled={exporting}
                data-testid="export-button"
            >
                {exporting ? 'Exporting...' : 'Export My Data'}
            </Button>
            <Button
                variant="outlined"
                startIcon={<LogoutOutlined />}
                component={Link}
                to="/logout"
                data-testid="logout-button"
            >
                Log Out
            </Button>
        </Box>
        </>
    )
}

export default Profile;
