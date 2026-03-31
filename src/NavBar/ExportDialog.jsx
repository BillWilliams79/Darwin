import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';

const APP_DEFS = [
    { key: 'tasks', label: 'Tasks', testId: 'export-app-tasks' },
    { key: 'maps', label: 'Maps', testId: 'export-app-maps' },
    { key: 'swarm', label: 'Swarm', testId: 'export-app-swarm' },
];

const ExportDialog = ({ open, onClose, enabledApps, onExport, exporting }) => {
    const [checked, setChecked] = useState({ tasks: false, maps: false, swarm: false });
    const [mapsGps, setMapsGps] = useState(false);
    const [gpsWarningOpen, setGpsWarningOpen] = useState(false);

    // Reset checkboxes to all-enabled-checked whenever dialog opens
    useEffect(() => {
        if (open) {
            setChecked({
                tasks: !!enabledApps.tasks,
                maps: !!enabledApps.maps,
                swarm: !!enabledApps.swarm,
            });
            setMapsGps(false);
        }
    }, [open, enabledApps]);

    const handleToggle = (key) => {
        setChecked(prev => {
            const next = { ...prev, [key]: !prev[key] };
            // Uncheck GPS sub-option when Maps is unchecked
            if (key === 'maps' && !next.maps) setMapsGps(false);
            return next;
        });
    };

    const handleGpsToggle = () => {
        if (!mapsGps) {
            // Turning on — show warning first
            setGpsWarningOpen(true);
        } else {
            setMapsGps(false);
        }
    };

    const handleGpsConfirm = () => {
        setMapsGps(true);
        setGpsWarningOpen(false);
    };

    const anyChecked = Object.values(checked).some(Boolean);

    return (
        <>
            <Dialog
                open={open}
                onClose={exporting ? undefined : onClose}
                data-testid="export-dialog"
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Export My Data</DialogTitle>
                <DialogContent>
                    <FormGroup>
                        {APP_DEFS.filter(app => enabledApps[app.key]).map(app => (
                            <Box key={app.key}>
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={checked[app.key]}
                                            onChange={() => handleToggle(app.key)}
                                            disabled={exporting}
                                            data-testid={app.testId}
                                        />
                                    }
                                    label={app.label}
                                />
                                {app.key === 'maps' && checked.maps && (
                                    <Box sx={{ pl: 4 }}>
                                        <FormControlLabel
                                            control={
                                                <Checkbox
                                                    checked={mapsGps}
                                                    onChange={handleGpsToggle}
                                                    disabled={exporting}
                                                    size="small"
                                                    data-testid="export-maps-gps"
                                                />
                                            }
                                            label="Include GPS track data"
                                            slotProps={{ typography: { variant: 'body2' } }}
                                        />
                                    </Box>
                                )}
                            </Box>
                        ))}
                    </FormGroup>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={onClose}
                        disabled={exporting}
                        data-testid="export-dialog-cancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => onExport({ ...checked, mapsGps })}
                        disabled={!anyChecked || exporting}
                        startIcon={exporting ? <CircularProgress size={20} /> : <FileDownloadOutlinedIcon />}
                        data-testid="export-dialog-export"
                    >
                        {exporting ? 'Exporting...' : 'Export'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* GPS warning confirmation */}
            <Dialog
                open={gpsWarningOpen}
                onClose={() => setGpsWarningOpen(false)}
                data-testid="export-gps-warning"
            >
                <DialogTitle>Include GPS Data?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        GPS track data includes coordinates for every activity. Depending on the
                        number of activities and distance traveled, this export may take a long
                        time to process and produce a very large file.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setGpsWarningOpen(false)}
                        data-testid="export-gps-warning-cancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleGpsConfirm}
                        data-testid="export-gps-warning-confirm"
                    >
                        Include GPS Data
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default ExportDialog;
