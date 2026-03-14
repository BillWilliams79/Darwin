import '../index.css';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { fetchExportData, downloadJson } from '../services/exportService';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { getTimezoneList } from '../utils/dateFormat';

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

    console.count('Profile Render');

    const { idToken, profile, setProfile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
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

    const saveProfile = useCallback((newName, newTimezone) => {
        // Skip if nothing changed from last saved values
        if (newName === savedNameRef.current && newTimezone === savedTimezoneRef.current) return;

        const uri = `${darwinUri}/profiles`;
        call_rest_api(uri, 'PUT', [{ id: profile.id, name: newName, timezone: newTimezone }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200 || result.httpStatus.httpStatus === 204) {
                    savedNameRef.current = newName;
                    savedTimezoneRef.current = newTimezone;
                    const updated = { ...profile, name: newName, timezone: newTimezone };
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
            console.error('Export failed:', err);
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
                        onBlur={() => saveProfile(name, timezone)}
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
                            saveProfile(name, newTz);
                        }}
                        isOptionEqualToValue={(option, value) => option.value === value.value}
                        renderInput={(params) => (
                            <TextField {...params} label="Timezone" size="small" />
                        )}
                        data-testid="profile-timezone"
                        disableClearable
                        />
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
