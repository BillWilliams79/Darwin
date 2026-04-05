import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ReplayIcon from '@mui/icons-material/Replay';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import useScanStore from './useScanStore.js';
import { loadMeta, clearCache } from './handleDB.js';
import { startScan, checkPhotosProxy } from './scanUtils.js';

const FEATURE_KEY = 'photo-browser-enabled';

const PhotoSettingsView = () => {
    const navigate = useNavigate();

    // Scan store
    const scanState = useScanStore((s) => s.scanState);
    const scanProgress = useScanStore((s) => s.scanProgress);
    const scanElapsed = useScanStore((s) => s.scanElapsed);
    const scanError = useScanStore((s) => s.scanError);
    const scanDiag = useScanStore((s) => s.scanDiag);
    const index = useScanStore((s) => s.index);
    const setIndex = useScanStore((s) => s.setIndex);
    const setScanState = useScanStore((s) => s.setScanState);

    // Local state from IndexedDB meta
    const [meta, setMeta] = useState(null);
    const [featureEnabled, setFeatureEnabled] = useState(
        () => localStorage.getItem(FEATURE_KEY) !== 'false'
    );
    const [clearing, setClearing] = useState(false);
    const [downloadError, setDownloadError] = useState(null);
    const [proxyStatus, setProxyStatus] = useState(null); // null=checking, { available, assetCount? }

    // Load meta from IDB on mount
    useEffect(() => {
        loadMeta().then((m) => setMeta(m)).catch(() => {});
    }, []);

    // Check proxy status on mount and after scan completes
    useEffect(() => {
        checkPhotosProxy().then(setProxyStatus);
    }, [scanState]);

    // Refresh meta when scan completes
    useEffect(() => {
        if (scanState === 'complete') {
            loadMeta().then((m) => setMeta(m)).catch(() => {});
        }
    }, [scanState]);

    const handleFeatureToggle = useCallback((e) => {
        const val = e.target.checked;
        setFeatureEnabled(val);
        localStorage.setItem(FEATURE_KEY, String(val));
    }, []);

    const handleRescan = useCallback(() => {
        startScan();
    }, []);

    const handleClearCache = useCallback(async () => {
        setClearing(true);
        try {
            await clearCache();
            setIndex([]);
            setScanState('idle');
            setMeta(null);
        } finally {
            setClearing(false);
        }
    }, [setIndex, setScanState]);

    // Format bytes
    const formatBytes = (bytes) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const estimatedSizeBytes = index.length * 190;

    const displayFileCount = (scanState === 'complete' ? index.length : null) ?? meta?.fileCount ?? null;
    const displayScannedAt = meta?.scannedAt ? new Date(meta.scannedAt).toLocaleDateString([], {
        year: 'numeric', month: 'short', day: 'numeric',
    }) : null;

    return (
        <Box sx={{ mt: 2, px: 2, pb: 4, maxWidth: 640 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/maps')} size="small">
                    Maps
                </Button>
            </Box>
            <Typography variant="h5" sx={{ mb: 2 }}>Photo Settings</Typography>

            <Divider sx={{ mb: 2 }} />

            {/* Feature toggle */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>FEATURE</Typography>
                <FormControlLabel
                    control={<Switch checked={featureEnabled} onChange={handleFeatureToggle} />}
                    label="Show photo button on activity cards"
                />
            </Box>

            <Divider sx={{ mb: 2 }} />

            {/* Photos Proxy */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>DARWIN PHOTOS APP</Typography>
                {proxyStatus === null ? (
                    <Typography variant="body2" color="text.secondary">Checking...</Typography>
                ) : proxyStatus.available ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Chip label="Connected" size="small" color="success" />
                        {proxyStatus.assetCount != null && (
                            <Chip label={`${proxyStatus.assetCount.toLocaleString()} assets in Photos.sqlite`} size="small" variant="outlined" />
                        )}
                    </Box>
                ) : (
                    <Box>
                        <Chip label="Not detected" size="small" color="default" sx={{ mb: 1 }} />
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            Install Darwin Photos to browse your Apple Photos Library.
                        </Typography>
                        <Button
                            variant="contained"
                            size="small"
                            onClick={async () => {
                                setDownloadError(null);
                                const url = 'https://www.darwin.one/downloads/Darwin-Photos.dmg';
                                try {
                                    const resp = await fetch(url, { method: 'HEAD' });
                                    if (resp.ok) {
                                        window.open(url, '_blank');
                                    } else {
                                        setDownloadError('Download not available — the DMG has not been published yet.');
                                    }
                                } catch {
                                    setDownloadError('Could not reach darwin.one — check your internet connection.');
                                }
                            }}
                            sx={{ mb: 1 }}
                        >
                            Download Darwin Photos
                        </Button>
                        {downloadError && (
                            <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setDownloadError(null)}>
                                {downloadError}
                            </Alert>
                        )}
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                            1. Open the .dmg and drag Darwin Photos to Applications.
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                            2. If macOS says "damaged," run in Terminal:{' '}
                            <Box component="code" sx={{ fontSize: '0.7rem', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 }}>
                                xattr -cr /Applications/Darwin\ Photos.app
                            </Box>
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                            3. Launch once, then grant Full Disk Access in System Settings &gt; Privacy &amp; Security.
                        </Typography>
                    </Box>
                )}
            </Box>

            <Divider sx={{ mb: 2 }} />

            {/* Cache */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>CACHE</Typography>
                {displayFileCount != null ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                        <Chip label={`${displayFileCount.toLocaleString()} files`} size="small" />
                        {displayScannedAt && (
                            <Chip label={`Last scanned ${displayScannedAt}`} size="small" variant="outlined" />
                        )}
                        <Chip label={`~${formatBytes(estimatedSizeBytes)}`} size="small" variant="outlined" />
                    </Box>
                ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        No index cached.
                    </Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ReplayIcon />}
                        onClick={handleRescan}
                        disabled={!proxyStatus?.available || scanState === 'scanning'}
                    >
                        {displayFileCount != null ? 'Re-scan' : 'Scan'}
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        startIcon={<DeleteOutlineIcon />}
                        onClick={handleClearCache}
                        disabled={clearing || displayFileCount == null}
                    >
                        Clear Cache
                    </Button>
                </Box>
            </Box>

            <Divider sx={{ mb: 2 }} />

            {/* Scan Progress — always visible */}
            <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>SCAN PROGRESS</Typography>

                {scanState === 'idle' && (
                    <Typography variant="body2" color="text.secondary">No scan in progress.</Typography>
                )}

                {scanState === 'scanning' && (
                    <Box>
                        <LinearProgress sx={{ mb: 1 }} />
                        <Typography variant="body2">
                            Scanned {scanProgress.scanned.toLocaleString()} files
                            {scanElapsed > 0 ? ` · ${scanElapsed}s elapsed` : ''}
                        </Typography>
                    </Box>
                )}

                {scanState === 'complete' && (
                    <Alert severity="success">
                        Scan complete — {index.length.toLocaleString()} files indexed.
                    </Alert>
                )}

                {scanState === 'error' && (
                    <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>
                        {scanError || 'Unknown error'}
                    </Alert>
                )}

                {/* Diagnostic log — shows what the scanner encountered */}
                {scanDiag && (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>SCAN LOG</Typography>
                        <Box
                            component="pre"
                            sx={{
                                fontSize: '0.75rem',
                                fontFamily: 'monospace',
                                bgcolor: 'action.hover',
                                p: 1.5,
                                borderRadius: 1,
                                maxHeight: 300,
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                            }}
                        >
                            {scanDiag}
                        </Box>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default PhotoSettingsView;
