import '../index.css';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { fetchExportData, downloadJson } from '../services/exportService';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { getTimezoneList } from '../utils/dateFormat';

import ThemeContext from '../Theme/ThemeContext';

import React, { useContext, useState, useMemo, useRef, useCallback } from 'react';
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

    const timezoneOptions = useMemo(() => getTimezoneList(), []);
    const selectedTimezone = timezoneOptions.find(tz => tz.value === timezone) || null;

    // Ref to track the latest profile values for save comparison
    const savedNameRef = useRef(profile?.name || '');
    const savedTimezoneRef = useRef(profile?.timezone || '');
    const savedThemeModeRef = useRef(profile?.theme_mode || 'light');

    const saveProfile = useCallback((newName, newTimezone, newThemeMode) => {
        // Skip if nothing changed from last saved values
        if (newName === savedNameRef.current && newTimezone === savedTimezoneRef.current && newThemeMode === savedThemeModeRef.current) return;

        const uri = `${darwinUri}/profiles`;
        call_rest_api(uri, 'PUT', [{ id: profile.id, name: newName, timezone: newTimezone, theme_mode: newThemeMode }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200 || result.httpStatus.httpStatus === 204) {
                    savedNameRef.current = newName;
                    savedTimezoneRef.current = newTimezone;
                    savedThemeModeRef.current = newThemeMode;
                    const updated = { ...profile, name: newName, timezone: newTimezone, theme_mode: newThemeMode };
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
                        onBlur={() => saveProfile(name, timezone, themeMode)}
                        id="Name"
                        key="Name"
                        variant="outlined"
                        size='small'
                        data-testid="profile-name" />
            <Autocomplete
                        options={timezoneOptions}
                        value={selectedTimezone}
                        onChange={(e, newValue) => {
                            const newTz = newValue?.value || '';
                            setTimezone(newTz);
                            saveProfile(name, newTz, themeMode);
                        }}
                        isOptionEqualToValue={(option, value) => option.value === value.value}
                        renderInput={(params) => (
                            <TextField {...params} label="Timezone" size="small" />
                        )}
                        data-testid="profile-timezone"
                        disableClearable
                        />
            {/* Appearance selector — miniature task card previews */}
            <Box>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>Appearance</Typography>
                <Box sx={{ display: 'flex', gap: 2 }} data-testid="profile-theme-toggle">
                    {['light', 'dark'].map((m) => {
                        const selected = themeMode === m;
                        const bg = m === 'light' ? '#fafafa' : '#141210';
                        const card = m === 'light' ? '#fff' : '#2a2723';
                        const header = m === 'light' ? '#e0e0e0' : '#3a3632';
                        const row = m === 'light' ? '#f5f5f5' : '#2a2723';
                        const text = m === 'light' ? '#bbb' : '#9a9186';
                        const dot = m === 'light' ? '#ccc' : '#555';
                        const nav = '#212121';
                        return (
                            <Box key={m}
                                onClick={() => { setThemeMode(m); saveProfile(name, timezone, m); }}
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
                                    bgcolor: bg, p: 0.5,
                                    display: 'flex', gap: 0.4,
                                }}>
                                    {/* Navbar */}
                                    <Box sx={{ width: 14, borderRadius: 0.5, bgcolor: nav, flexShrink: 0 }} />
                                    {/* Card area */}
                                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                                        {/* Card */}
                                        <Box sx={{
                                            flex: 1, borderRadius: 0.75, bgcolor: card,
                                            display: 'flex', flexDirection: 'column',
                                            overflow: 'hidden',
                                        }}>
                                            {/* Card header */}
                                            <Box sx={{ height: 10, bgcolor: header, px: 0.5, display: 'flex', alignItems: 'center' }}>
                                                <Box sx={{ width: 18, height: 3, borderRadius: 0.5, bgcolor: text }} />
                                            </Box>
                                            {/* Task rows */}
                                            {[0, 1, 2].map((i) => (
                                                <Box key={i} sx={{
                                                    height: 8, bgcolor: row, mx: 0.25, mt: 0.25,
                                                    borderRadius: 0.3,
                                                    display: 'flex', alignItems: 'center', gap: '2px', px: 0.3,
                                                }}>
                                                    <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: dot, flexShrink: 0 }} />
                                                    <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: dot, flexShrink: 0 }} />
                                                    <Box sx={{ flex: 1, height: 2.5, borderRadius: 0.5, bgcolor: text, ml: 0.25 }} />
                                                </Box>
                                            ))}
                                        </Box>
                                        {/* Second card hint */}
                                        <Box sx={{ height: 10, borderRadius: 0.75, bgcolor: card }}>
                                            <Box sx={{ height: 10, bgcolor: header, borderRadius: 0.75, px: 0.5, display: 'flex', alignItems: 'center' }}>
                                                <Box sx={{ width: 14, height: 3, borderRadius: 0.5, bgcolor: text }} />
                                            </Box>
                                        </Box>
                                    </Box>
                                </Box>
                                <Typography variant="caption" sx={{
                                    mt: 0.5, display: 'block',
                                    fontWeight: selected ? 600 : 400,
                                    color: selected ? 'primary.main' : 'text.secondary',
                                }}>
                                    {m === 'light' ? 'Light' : 'Dark'}
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
            <TextField  label="E-mail"
                        value = { profile.email }
                        id= "email"
                        key="email"
                        variant= "outlined"
                        size = 'small'
                        disabled />
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
