import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import BuildVisualizerControls from './BuildVisualizerControls';
import { usePatternLibrary } from './usePatternLibrary';
import { BRANCH_TYPES } from './branchTypeChipStyles';
import {
    DEFAULT_DARK_VARIANT,
    LIGHT_TRANSPORT_VARIANT,
    isThemeVariant,
} from './themeVariants';
import ThemeContext from '../Theme/ThemeContext';

const parseNonNegInt = (s, fallback) => {
    const n = parseInt(String(s).trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const parsePosInt = (s, fallback) => {
    const n = parseInt(String(s).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

// localStorage key shared with Topology/build-visualizer/app.js (req #2598;
// React shell owns the toggle UI since req #2616 but the iframe still reads
// this key on standalone boot so dev workflow stays unchanged).
const VERSION_LANES_STORAGE_KEY = 'darwin.buildVisualizer.versionLanes.v1';

// User's preferred DARK variant (req #2621). Independent of Darwin's app
// mode — when the app is light we don't touch this key; when the app
// flips back to dark we apply the stored choice. The picker only shows
// when the app is in dark mode, and only lists dark variants.
const DARK_VARIANT_STORAGE_KEY = 'darwin.buildVisualizer.darkVariant.v1';

// Release-event overlay state (req #2606). Keys match the iframe's
// localStorage so standalone mode and embedded mode agree on the boot value.
const SHOW_RELEASES_STORAGE_KEY = 'darwin.bv.showReleases';
const RELEASE_STYLE_STORAGE_KEY = 'darwin.bv.releaseStyle';

const readShowReleases = () => {
    try {
        return window.localStorage.getItem(SHOW_RELEASES_STORAGE_KEY) !== 'off';
    } catch (_) { return true; }
};

const writeShowReleases = (value) => {
    try {
        window.localStorage.setItem(SHOW_RELEASES_STORAGE_KEY, value ? 'on' : 'off');
    } catch (_) { /* private mode — accept transient state */ }
};

const readReleaseStyle = () => {
    try {
        const v = parseInt(window.localStorage.getItem(RELEASE_STYLE_STORAGE_KEY) || '', 10);
        return Number.isFinite(v) && v >= 1 && v <= 5 ? v : 1;
    } catch (_) { return 1; }
};

const writeReleaseStyle = (value) => {
    try {
        window.localStorage.setItem(RELEASE_STYLE_STORAGE_KEY, String(value));
    } catch (_) { /* private mode — accept transient state */ }
};

const readVersionLanes = () => {
    try {
        return window.localStorage.getItem(VERSION_LANES_STORAGE_KEY) !== 'off';
    } catch (_) {
        return true;
    }
};

const writeVersionLanes = (value) => {
    try {
        window.localStorage.setItem(VERSION_LANES_STORAGE_KEY, value ? 'on' : 'off');
    } catch (_) { /* private mode — accept transient state */ }
};

const readStoredDarkVariant = () => {
    try {
        const v = window.localStorage.getItem(DARK_VARIANT_STORAGE_KEY);
        return isThemeVariant(v) ? v : null;
    } catch (_) {
        return null;
    }
};

const writeStoredDarkVariant = (variant) => {
    try {
        window.localStorage.setItem(DARK_VARIANT_STORAGE_KEY, variant);
    } catch (_) { /* private mode — accept transient state */ }
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

    // Stagger toggle (req #2616 — relocated from iframe #toolbar to the React
    // shell). React owns the UI; iframe owns the renderer effect. Initialised
    // from localStorage so reload survives, and an inbound
    // bv:version-lanes-state from the iframe at boot adopts whatever value the
    // iframe started with (covers the case where standalone mode flipped it).
    const [staggerOn, setStaggerOn] = useState(() => readVersionLanes());
    const staggerOnRef = useRef(staggerOn);
    useEffect(() => { staggerOnRef.current = staggerOn; }, [staggerOn]);

    // Release-event overlay toolbar state (req #2606). React shell owns the UI;
    // iframe owns the renderer. localStorage keeps the boot value stable so
    // standalone mode and embedded mode agree on first paint.
    const [showReleases, setShowReleases] = useState(() => readShowReleases());
    const [releaseStyle, setReleaseStyle] = useState(() => readReleaseStyle());
    const showReleasesRef = useRef(showReleases);
    const releaseStyleRef = useRef(releaseStyle);
    useEffect(() => { showReleasesRef.current = showReleases; }, [showReleases]);
    useEffect(() => { releaseStyleRef.current = releaseStyle; }, [releaseStyle]);

    // Dark variant + transport-aware theme (req #2621).
    //   • `darkVariant` is the user's chosen DARK theme. Default Charcoal.
    //     Only changes when the user picks from the menu (which is hidden
    //     unless the app is in dark mode).
    //   • The value actually posted to the iframe is `effectiveMode === 'dark'
    //     ? darkVariant : 'light'`. Switching Darwin's app mode automatically
    //     re-themes the canvas without touching the stored dark preference.
    const { effectiveMode } = useContext(ThemeContext);
    const [darkVariant, setDarkVariant] = useState(
        () => readStoredDarkVariant() || DEFAULT_DARK_VARIANT,
    );
    // Resolve once per render so both the postMessage effect and the ref
    // mirror agree on a single value.
    const iframeTheme = effectiveMode === 'dark' ? darkVariant : LIGHT_TRANSPORT_VARIANT;
    const iframeThemeRef = useRef(iframeTheme);
    useEffect(() => { iframeThemeRef.current = iframeTheme; }, [iframeTheme]);

    const changeDarkVariant = useCallback((variant) => {
        if (!isThemeVariant(variant)) return;
        setDarkVariant(variant);
        writeStoredDarkVariant(variant);
    }, []);

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

    const postVersionLanes = useCallback((value) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage({ type: 'bv:set-version-lanes', value }, window.location.origin);
    }, []);

    const postTheme = useCallback((variant) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage({ type: 'bv:set-theme', variant }, window.location.origin);
    }, []);

    const postShowReleases = useCallback((value) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage({ type: 'bv:set-show-releases', value }, window.location.origin);
    }, []);

    const postReleaseStyle = useCallback((value) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage({ type: 'bv:set-release-style', value }, window.location.origin);
    }, []);

    const toggleStagger = useCallback(() => {
        setStaggerOn(prev => !prev);
    }, []);

    const toggleShowReleases = useCallback(() => {
        setShowReleases(prev => !prev);
    }, []);

    const changeReleaseStyle = useCallback((v) => {
        const num = Number(v);
        if (!Number.isInteger(num) || num < 1 || num > 5) return;
        setReleaseStyle(num);
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
                postVersionLanes(staggerOnRef.current);
                postTheme(iframeThemeRef.current);
                postShowReleases(showReleasesRef.current);
                postReleaseStyle(releaseStyleRef.current);
            } else if (msg.type === 'bv:release-overlay-state') {
                // Iframe announced its boot value. Adopt only when it differs
                // from the value we already hold so we don't re-render on echo.
                const nextShow = !!msg.showReleases;
                const v = Number(msg.releaseStyle);
                const nextStyle = Number.isInteger(v) && v >= 1 && v <= 5 ? v : 1;
                if (nextShow !== showReleasesRef.current) setShowReleases(nextShow);
                if (nextStyle !== releaseStyleRef.current) setReleaseStyle(nextStyle);
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
            } else if (msg.type === 'bv:version-lanes-state') {
                // Iframe announced its boot value (e.g. standalone mode flipped
                // localStorage from a different tab). Adopt it locally so the
                // Chip matches the renderer; the staggerOn effect persists.
                const next = !!msg.value;
                if (next !== staggerOnRef.current) setStaggerOn(next);
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [lib, postLoad, postFilter, postVersionLanes, postTheme, postShowReleases, postReleaseStyle]);

    // Push filter to iframe on every chip toggle (no-op until iframe is ready —
    // the bv:ready handler covers the initial post once the iframe boots).
    useEffect(() => {
        if (!iframeReady.current) return;
        postFilter(selectedTypes);
    }, [selectedTypes, postFilter]);

    // Persist Stagger state to localStorage whenever it changes. The first
    // run after mount re-writes the value we just READ from localStorage —
    // harmless and keeps the side effect out of the toggle callback.
    useEffect(() => {
        writeVersionLanes(staggerOn);
    }, [staggerOn]);

    // Push Stagger state to iframe on every toggle (no-op until iframe is
    // ready — the bv:ready handler covers the initial post once the iframe
    // boots).
    useEffect(() => {
        if (!iframeReady.current) return;
        postVersionLanes(staggerOn);
    }, [staggerOn, postVersionLanes]);

    // Req #2606 — persist + push release-overlay state on every change.
    useEffect(() => { writeShowReleases(showReleases); }, [showReleases]);
    useEffect(() => { writeReleaseStyle(releaseStyle); }, [releaseStyle]);
    useEffect(() => {
        if (!iframeReady.current) return;
        postShowReleases(showReleases);
    }, [showReleases, postShowReleases]);
    useEffect(() => {
        if (!iframeReady.current) return;
        postReleaseStyle(releaseStyle);
    }, [releaseStyle, postReleaseStyle]);

    // Push theme to iframe whenever the resolved value changes — either
    // because the user picked a different dark variant OR Darwin's app
    // theme flipped between light and dark (no-op until iframe is ready;
    // bv:ready covers the initial post once the iframe boots).
    useEffect(() => {
        if (!iframeReady.current) return;
        postTheme(iframeTheme);
    }, [iframeTheme, postTheme]);

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
            <BuildVisualizerControls
                lib={lib}
                selectedTypes={selectedTypes}
                onToggleType={toggleType}
                staggerOn={staggerOn}
                onToggleStagger={toggleStagger}
                appMode={effectiveMode}
                darkVariant={darkVariant}
                onChangeDarkVariant={changeDarkVariant}
                showReleases={showReleases}
                onToggleShowReleases={toggleShowReleases}
                releaseStyle={releaseStyle}
                onChangeReleaseStyle={changeReleaseStyle}
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
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
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
