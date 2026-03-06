import '../index.css';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { getTimezoneList } from '../utils/dateFormat';

import React, { useContext, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';

const SetupWizard = () => {

    const { idToken, profile, setProfile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);
    const navigate = useNavigate();

    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const [name, setName] = useState(profile?.name || '');
    const [timezone, setTimezone] = useState(browserTimezone);
    const [saving, setSaving] = useState(false);

    const timezoneOptions = useMemo(() => getTimezoneList(), []);
    const selectedTimezone = timezoneOptions.find(tz => tz.value === timezone) || null;

    const handleSubmit = () => {
        setSaving(true);
        const uri = `${darwinUri}/profiles`;
        call_rest_api(uri, 'PUT', [{ id: profile.id, name, timezone }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200 || result.httpStatus.httpStatus === 204) {
                    const updated = { ...profile, name, timezone };
                    setProfile(updated);
                    localStorage.setItem('darwin-profile', JSON.stringify(updated));
                    navigate('/', { replace: true });
                } else {
                    showError(result, 'Unable to save profile');
                }
            })
            .catch(error => showError(error, 'Unable to save profile'))
            .finally(() => setSaving(false));
    };

    return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center',
                   minHeight: '60vh', p: 2 }}>
            <Paper elevation={3} sx={{ p: 4, maxWidth: 450, width: '100%' }}>
                <Typography variant="h5" gutterBottom>
                    Welcome to Darwin
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Let's set up your profile. You can change these later in Settings.
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        label="Display Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        size="small"
                        autoFocus
                        data-testid="setup-name"
                    />
                    <Autocomplete
                        options={timezoneOptions}
                        value={selectedTimezone}
                        onChange={(e, newValue) => setTimezone(newValue?.value || browserTimezone)}
                        isOptionEqualToValue={(option, value) => option.value === value.value}
                        renderInput={(params) => (
                            <TextField {...params} label="Timezone" size="small" />
                        )}
                        data-testid="setup-timezone"
                        disableClearable
                    />
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={!name.trim() || !timezone || saving}
                        data-testid="setup-save"
                        sx={{ mt: 1 }}
                    >
                        {saving ? 'Saving...' : 'Get Started'}
                    </Button>
                </Box>
            </Paper>
        </Box>
    );
};

export default SetupWizard;
