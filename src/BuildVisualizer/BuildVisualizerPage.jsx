import { useCallback, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import BuildPatternToolbar from './BuildPatternToolbar';
import { usePatternLibrary } from './usePatternLibrary';

const BuildVisualizerPage = () => {
    const iframeRef = useRef(null);
    const iframeReady = useRef(false);
    const prevActiveIdRef = useRef(null);
    const lib = usePatternLibrary();

    const postLoad = useCallback((data) => {
        const win = iframeRef.current?.contentWindow;
        if (!win || !data) return;
        win.postMessage({ type: 'bv:load', data }, window.location.origin);
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
            } else if (msg.type === 'bv:changed') {
                if (msg.data && typeof msg.data === 'object') {
                    lib.saveActiveData(msg.data);
                }
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [lib, postLoad]);

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
            <BuildPatternToolbar lib={lib} />
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
