import '../index.css';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { fetchExportData, downloadJson } from '../services/exportService';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { getTimezoneList } from '../utils/dateFormat';

import React, { useContext, useState, useMemo } from 'react';

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';

const Profile = () => {

    console.count('Profile Render');

    const { idToken, profile, setProfile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);

    const [name, setName] = useState(profile?.name || '');
    const [timezone, setTimezone] = useState(profile?.timezone || '');
    const [saving, setSaving] = useState(false);
    const [exporting, setExporting] = useState(false);

    const timezoneOptions = useMemo(() => getTimezoneList(), []);
    const selectedTimezone = timezoneOptions.find(tz => tz.value === timezone) || null;

    const hasChanges = name !== (profile?.name || '') || timezone !== (profile?.timezone || '');

    const handleSave = () => {
        setSaving(true);
        const uri = `${darwinUri}/profiles`;
        call_rest_api(uri, 'PUT', [{ id: profile.id, name, timezone }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200 || result.httpStatus.httpStatus === 204) {
                    const updated = { ...profile, name, timezone };
                    setProfile(updated);
                    localStorage.setItem('darwin-profile', JSON.stringify(updated));
                } else {
                    showError(result, 'Unable to save profile');
                }
            })
            .catch(error => showError(error, 'Unable to save profile'))
            .finally(() => setSaving(false));
    };

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
                        id="Name"
                        key="Name"
                        variant="outlined"
                        size='small'
                        data-testid="profile-name" />
            <Autocomplete
                        options={timezoneOptions}
                        value={selectedTimezone}
                        onChange={(e, newValue) => setTimezone(newValue?.value || '')}
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
            <TextField  label="Region"
                        value = { profile.region }
                        id= "region"
                        key="region"
                        variant= "outlined"
                        size = 'small'
                        disabled />
            <TextField  label="User Pool ID"
                        value = { profile.userPoolId }
                        id= "userPoolId"
                        key="userPoolId"
                        variant= "outlined"
                        size = 'small'
                        disabled />
            <TextField  label="Cognito Identifier"
                        value = { profile.userName }
                        id= "userName"
                        key="userName"
                        variant= "outlined"
                        size = 'small'
                        disabled />
            <Button variant="contained"
                    onClick={handleSave}
                    disabled={!hasChanges || saving}
                    data-testid="profile-save"
                    sx={{ alignSelf: 'flex-start' }}>
                {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button
                variant="outlined"
                startIcon={exporting ? <CircularProgress size={20} /> : <FileDownloadOutlinedIcon />}
                onClick={handleExport}
                disabled={exporting}
                data-testid="export-button"
            >
                {exporting ? 'Exporting...' : 'Export My Data'}
            </Button>
        </Box>
        </>
    )
}

export default Profile;
