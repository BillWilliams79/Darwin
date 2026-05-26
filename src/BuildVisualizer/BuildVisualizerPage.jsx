import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import BuildVisualizerControls from './BuildVisualizerControls';
import { usePatternLibrary } from './usePatternLibrary';
import { BRANCH_TYPES } from './branchTypeChipStyles';
import {
    DEFAULT_DARK_VARIANT,
    LIGHT_TRANSPORT_VARIANT,
    isThemeVariant,
} from './themeVariants';
import ThemeContext from '../Theme/ThemeContext';

// localStorage key shared with Topology/build-visualizer/app.js (req #2598;
// React shell owns the toggle UI since req #2616 but the iframe still reads
// this key on standalone boot so dev workflow stays unchanged).
const VERSION_LANES_STORAGE_KEY = 'darwin.buildVisualizer.versionLanes.v1';

// User's preferred DARK variant (req #2621). Independent of Darwin's app
// mode — when the app is light we don't touch this key; when the app
// flips back to dark we apply the stored choice. The picker only shows
// when the app is in dark mode, and only lists dark variants.
const DARK_VARIANT_STORAGE_KEY = 'darwin.buildVisualizer.darkVariant.v1';

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

    const toggleStagger = useCallback(() => {
        setStaggerOn(prev => !prev);
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
            } else if (msg.type === 'bv:changed') {
                if (msg.data && typeof msg.data === 'object') {
                    lib.saveActiveData(msg.data);
                }
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
    }, [lib, postLoad, postFilter, postVersionLanes, postTheme]);

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

    // Push theme to iframe whenever the resolved value changes — either
    // because the user picked a different dark variant OR Darwin's app
    // theme flipped between light and dark (no-op until iframe is ready;
    // bv:ready covers the initial post once the iframe boots).
    useEffect(() => {
        if (!iframeReady.current) return;
        postTheme(iframeTheme);
    }, [iframeTheme, postTheme]);

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
        </Box>
    );
};

export default BuildVisualizerPage;
