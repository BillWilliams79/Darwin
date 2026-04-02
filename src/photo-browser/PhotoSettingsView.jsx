import React, { useState, useEffect, useCallback, useContext } from 'react';
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
import FolderIcon from '@mui/icons-material/Folder';
import ReplayIcon from '@mui/icons-material/Replay';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import useScanStore from './useScanStore.js';
import { loadHandle, loadMeta, clearCache, saveHandle } from './handleDB.js';
import { startScan, checkPhotosProxy } from './scanUtils.js';

const FEATURE_KEY = 'photo-browser-enabled';

const PhotoSettingsView = () => {
    const navigate = useNavigate();

    // Scan store
    const dirHandle = useScanStore((s) => s.dirHandle);
    const folderName = useScanStore((s) => s.folderName);
    const scanState = useScanStore((s) => s.scanState);
    const scanProgress = useScanStore((s) => s.scanProgress);
    const scanElapsed = useScanStore((s) => s.scanElapsed);
    const scanError = useScanStore((s) => s.scanError);
    const scanDiag = useScanStore((s) => s.scanDiag);
    const index = useScanStore((s) => s.index);
    const setDirHandle = useScanStore((s) => s.setDirHandle);
    const setIndex = useScanStore((s) => s.setIndex);
    const setScanState = useScanStore((s) => s.setScanState);

    // Local state from IndexedDB meta
    const [meta, setMeta] = useState(null);
    const [featureEnabled, setFeatureEnabled] = useState(
        () => localStorage.getItem(FEATURE_KEY) !== 'false'
    );
    const [clearing, setClearing] = useState(false);
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

    const handleSelectFolder = useCallback(async () => {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'read', startIn: 'pictures' });
            const name = handle.name;
            await saveHandle(handle);
            setDirHandle(handle, name);
            startScan(handle, name);
        } catch (err) {
            if (err.name !== 'AbortError') console.error('[PhotoSettings] folder picker error:', err);
        }
    }, [setDirHandle]);

    const handleRescan = useCallback(async () => {
        // Try to get an existing dirHandle (for filesystem walk fallback)
        const handle = dirHandle || await loadHandle().catch(() => null);
        if (handle) {
            try {
                const perm = await handle.queryPermission({ mode: 'read' });
                if (perm !== 'granted') {
                    const result = await handle.requestPermission({ mode: 'read' });
                    if (result !== 'granted' && !proxyStatus?.available) return;
                    if (result === 'granted') {
                        setDirHandle(handle, handle.name);
                    }
                } else {
                    setDirHandle(handle, handle.name);
                }
            } catch {
                // Permission check failed — proxy-only scan if available
            }
        }

        // Start scan — dirHandle may be null (proxy-only mode in Safari)
        const activeHandle = useScanStore.getState().dirHandle;
        if (!activeHandle && !proxyStatus?.available) {
            handleSelectFolder();
            return;
        }
        startScan(activeHandle, activeHandle?.name || 'Photos.sqlite');
    }, [dirHandle, handleSelectFolder, setDirHandle, proxyStatus]);

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

    const displayFolderName = folderName || meta?.folderName || null;
    const displayFileCount = (scanState === 'complete' ? index.length : null) ?? meta?.fileCount ?? null;
    const displayScannedAt = meta?.scannedAt ? new Date(meta.scannedAt).toLocaleDateString([], {
        year: 'numeric', month: 'short', day: 'numeric',
    }) : null;

    const supportsFilePicker = 'showDirectoryPicker' in window;

    return (
        <Box sx={{ mt: 2, px: 2, pb: 4, maxWidth: 640 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/maps')} size="small">
                    Maps
                </Button>
            </Box>
            <Typography variant="h5" sx={{ mb: 2 }}>Photo Settings</Typography>

            {!supportsFilePicker && (
                <Alert severity={proxyStatus?.available ? 'info' : 'warning'} sx={{ mb: 2 }}>
                    {proxyStatus?.available
                        ? 'Folder picker not available in this browser. Using Photos proxy for scanning and file access.'
                        : 'Folder access requires Chrome or Edge 86+. Start the Photos proxy to scan in this browser.'}
                </Alert>
            )}

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

            {/* Folder */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>FOLDER</Typography>
                {displayFolderName ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <FolderIcon fontSize="small" color="action" />
                        <Typography variant="body2">{displayFolderName}</Typography>
                    </Box>
                ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        No folder selected.
                    </Typography>
                )}
                {supportsFilePicker && (
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={handleSelectFolder}
                    >
                        {displayFolderName ? 'Change Folder' : 'Select Folder'}
                    </Button>
                )}
            </Box>

            <Divider sx={{ mb: 2 }} />

            {/* Photos Proxy */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>PHOTOS PROXY</Typography>
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
                            href="https://www.darwin.one/downloads/Darwin-Photos.dmg"
                            sx={{ mb: 1 }}
                        >
                            Download Darwin Photos
                        </Button>
                        <Typography variant="caption" color="text.secondary" display="block">
                            After downloading: open the .dmg, drag Darwin Photos to Applications, launch it once,
                            then grant Full Disk Access in System Settings &gt; Privacy &amp; Security.
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
                        {meta?.scanSource && (
                            <Chip
                                label={meta.scanSource === 'proxy' ? 'Photos.sqlite' : 'Filesystem scan'}
                                size="small"
                                variant="outlined"
                            />
                        )}
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
                        disabled={(!supportsFilePicker && !proxyStatus?.available) || scanState === 'scanning'}
                    >
                        Re-scan
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
