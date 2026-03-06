import '../index.css';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { fetchExportData, downloadJson } from '../services/exportService';

import React, {useContext, useState} from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';

const Profile = () => {

    console.count('Profile Render');

    const { profile, idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState(null);

    const handleExport = async () => {
        setExporting(true);
        setError(null);
        try {
            const data = await fetchExportData(darwinUri, profile.userName, idToken, profile);
            const date = new Date().toISOString().slice(0, 10);
            downloadJson(data, `darwin-export-${date}.json`);
        } catch (err) {
            console.error('Export failed:', err);
            setError('Export failed. Please try again.');
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
                        value = { profile.name }
                        id= "Name"
                        key="Name"
                        variant= "outlined"
                        size = 'small'
                        disabled />
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
        <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
            <Alert onClose={() => setError(null)} severity="error" variant="filled">
                {error}
            </Alert>
        </Snackbar>
        </>
    )
}

export default Profile;
