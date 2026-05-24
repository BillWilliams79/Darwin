import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import BuildPatternToolbar from './BuildPatternToolbar';
import { usePatternLibrary } from './usePatternLibrary';
import { BRANCH_TYPES } from './branchTypeChipStyles';

const parseNonNegInt = (s, fallback) => {
    const n = parseInt(String(s).trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const parsePosInt = (s, fallback) => {
    const n = parseInt(String(s).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const BuildVisualizerPage = () => {
    const iframeRef = useRef(null);
    const iframeReady = useRef(false);
    const prevActiveIdRef = useRef(null);
    const lib = usePatternLibrary();
    // Pending release-creation dialog request from the iframe. When non-null the
    // dialog is open; submitting / cancelling posts bv:release-dialog-result back
    // and clears this state.
    const [releaseReq, setReleaseReq] = useState(null);
    const [releaseName, setReleaseName] = useState('');
    const [releaseMajor, setReleaseMajor] = useState('1');
    const [releaseMinor, setReleaseMinor] = useState('0');
    const [releaseInitialBuild, setReleaseInitialBuild] = useState('1');
    // All branch types start selected — deselecting hides that type (and any
    // descendants rooted on it) in the iframe renderer.
    const [selectedTypes, setSelectedTypes] = useState(() => [...BRANCH_TYPES]);
    // Mirror selectedTypes into a ref so the bv:ready handler can read the
    // latest value without forcing the message-listener effect to re-register
    // on every chip toggle.
    const selectedTypesRef = useRef(selectedTypes);
    useEffect(() => { selectedTypesRef.current = selectedTypes; }, [selectedTypes]);

    const toggleType = useCallback((type) => {
        setSelectedTypes(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        );
    }, []);

    const postLoad = useCallback((data) => {
        const win = iframeRef.current?.contentWindow;
        if (!win || !data) return;
        win.postMessage({ type: 'bv:load', data }, window.location.origin);
    }, []);

    const postReleaseResult = useCallback((requestId, payload) => {
        const win = iframeRef.current?.contentWindow;
        if (!win || !requestId) return;
        win.postMessage(
            { type: 'bv:release-dialog-result', requestId, ...payload },
            window.location.origin,
        );
    }, []);

    const postFilter = useCallback((selected) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        // Send the deselected types — the iframe hides ONLY the types listed
        // here, leaving any branch type not in the chip rail visible by
        // default. Keeps the iframe robust to REGISTRY entries added without
        // a corresponding chip.
        const hidden = BRANCH_TYPES.filter(t => !selected.includes(t));
        win.postMessage({ type: 'bv:filter', hidden }, window.location.origin);
    }, []);

    useEffect(() => {
        const onMessage = (e) => {
            if (e.origin !== window.location.origin) return;
            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'bv:ready') {
                iframeReady.current = true;
                if (lib.activePattern) {
                    prevActiveIdRef.current = lib.activeId;
                    postLoad(lib.activePattern.data);
                }
                postFilter(selectedTypesRef.current);
            } else if (msg.type === 'bv:changed') {
                if (msg.data && typeof msg.data === 'object') {
                    lib.saveActiveData(msg.data);
                }
            } else if (msg.type === 'bv:request-release-dialog') {
                const d = msg.defaults || {};
                setReleaseName('Release');
                setReleaseMajor(String(Number.isFinite(d.major) ? d.major : 1));
                setReleaseMinor(String(Number.isFinite(d.minor) ? d.minor : 0));
                setReleaseInitialBuild(String(Number.isFinite(d.initialBuildNumber) ? d.initialBuildNumber : 1));
                setReleaseReq({ requestId: msg.requestId });
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [lib, postLoad, postFilter]);

    // Push filter to iframe on every chip toggle (no-op until iframe is ready —
    // the bv:ready handler covers the initial post once the iframe boots).
    useEffect(() => {
        if (!iframeReady.current) return;
        postFilter(selectedTypes);
    }, [selectedTypes, postFilter]);

    const closeReleaseDialog = (confirmed) => {
        if (!releaseReq) return;
        const requestId = releaseReq.requestId;
        if (confirmed) {
            const name = releaseName.trim() || 'Release';
            postReleaseResult(requestId, {
                confirmed: true,
                values: {
                    name,
                    major: parseNonNegInt(releaseMajor, 1),
                    minor: parseNonNegInt(releaseMinor, 0),
                    initialBuildNumber: parsePosInt(releaseInitialBuild, 1),
                },
            });
        } else {
            postReleaseResult(requestId, { confirmed: false });
        }
        setReleaseReq(null);
    };

    // Push the active pattern into the iframe ONLY when the user switches to
    // a different pattern. Data-within-active-pattern saves originate from the
    // iframe via bv:changed — echoing them back as bv:load would dismiss any
    // open context menu and cause a visual re-render flicker.
    useEffect(() => {
        if (!iframeReady.current || !lib.activePattern) return;
        if (prevActiveIdRef.current === lib.activeId) return;
        prevActiveIdRef.current = lib.activeId;
        postLoad(lib.activePattern.data);
    }, [lib.activeId, lib.activePattern, postLoad]);

    return (
        <Box
            sx={{
                gridArea: 'content',
                display: 'grid',
                gridTemplateRows: 'auto 1fr',
                height: '100vh',
                width: '100%',
                overflow: 'hidden',
            }}
        >
            <BuildPatternToolbar
                lib={lib}
                selectedTypes={selectedTypes}
                onToggleType={toggleType}
            />
            {lib.isReady ? (
                <iframe
                    ref={iframeRef}
                    src="/build-visualizer/index.html"
                    title="Build Visualizer"
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                    data-testid="build-visualizer-iframe"
                />
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress />
                </Box>
            )}

            <Dialog open={!!releaseReq} onClose={() => closeReleaseDialog(false)}>
                <DialogTitle>Create Release branch</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 1 }}>
                        This release inherits its Major.Minor from the trunk at this point. The values below define the NEW trunk identity that takes effect for builds after this release.
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        label="Release branch name"
                        value={releaseName}
                        onChange={(e) => setReleaseName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && releaseName.trim()) closeReleaseDialog(true); }}
                        inputProps={{ 'data-testid': 'bv-release-name' }}
                    />
                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        <TextField
                            label="New trunk Major"
                            type="number"
                            margin="dense"
                            value={releaseMajor}
                            onChange={(e) => setReleaseMajor(e.target.value)}
                            inputProps={{ min: 0, step: 1, 'data-testid': 'bv-release-major' }}
                            sx={{ flex: 1 }}
                        />
                        <TextField
                            label="New trunk Minor"
                            type="number"
                            margin="dense"
                            value={releaseMinor}
                            onChange={(e) => setReleaseMinor(e.target.value)}
                            inputProps={{ min: 0, step: 1, 'data-testid': 'bv-release-minor' }}
                            sx={{ flex: 1 }}
                        />
                        <TextField
                            label="First Build #"
                            type="number"
                            margin="dense"
                            value={releaseInitialBuild}
                            onChange={(e) => setReleaseInitialBuild(e.target.value)}
                            inputProps={{ min: 1, step: 1, 'data-testid': 'bv-release-initial-build' }}
                            sx={{ flex: 1 }}
                            helperText="Defaults to 1"
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => closeReleaseDialog(false)}>Cancel</Button>
                    <Button
                        onClick={() => closeReleaseDialog(true)}
                        disabled={!releaseName.trim()}
                        data-testid="bv-release-confirm"
                    >
                        Create
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default BuildVisualizerPage;
