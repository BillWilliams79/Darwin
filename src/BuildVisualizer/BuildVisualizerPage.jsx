import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import BuildPatternToolbar from './BuildPatternToolbar';
import { usePatternLibrary } from './usePatternLibrary';
import { BRANCH_TYPES } from './branchTypeChipStyles';

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
        </Box>
    );
};

export default BuildVisualizerPage;
