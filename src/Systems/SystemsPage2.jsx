import { useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import { useLocation } from 'react-router-dom';

import { FULL_SCREEN_Z, useCoverNavbar } from '../Components/fullScreenLayer';
import { registerPageOptions } from '../RequirementFiler/filedFromContext';
import ToolbarRack, { FULL_SCREEN_SELECTOR, FULL_SCREEN_STAGES } from './ToolbarRack';

/**
 * The view the topology page is drawing now (req #3813). Picking a view in the
 * frame never writes Darwin's URL (`?opt=` opens one without persisting it),
 * so the Requirement Filer asks the frame: its <body> carries `opt-<id>` for
 * the live view on every render path. `surface` is the deep link back to it,
 * Darwin's other query parameters kept (the filer's own dropped).
 */
export function topologyPageOptions(frame, search) {
    const doc = frame?.contentDocument;
    const bodyOpt = doc?.body
        ? Array.from(doc.body.classList).find(c => c.startsWith('opt-'))?.slice(4) : null;
    const opt = bodyOpt || doc?.querySelector('button[data-opt].selected')?.getAttribute('data-opt') || null;
    let lastOpt = null;
    try { lastOpt = localStorage.getItem('topology.lastOpt'); } catch { /* storage blocked */ }
    // A frame that cannot say (not loaded yet) leaves the URL's own ?opt=.
    // req #3803 — the Virgo Simple view's Traffic pattern and Adaptive Routing step deep-link too
    // (&traffic=, &step=); the frame's <body> carries the live ones as data-vs-traffic / data-vs-step,
    // which replace the URL's. Another view's &traffic= (Virgo Plane's, req #3690) is kept only while
    // the frame still shows the URL's own view — the pattern names belong to the view.
    const params = (search || '').replace(/^\?/, '').split('&');
    const urlOpt = params.find(p => /^opt=/.test(p))?.slice(4) ?? null;
    const live = opt === 'tpu8t-virgo-simple' ? doc?.body?.dataset : null;
    const dropTraffic = !!opt && (!!live || opt !== urlOpt);
    const kept = params.filter(p => p && !(opt ? /^(opt|filer)(=|$)/ : /^filer(=|$)/).test(p)
        && !(dropTraffic && /^(traffic|step)(=|$)/.test(p)));
    const query = [...(opt ? [`opt=${encodeURIComponent(opt)}`] : []),
        ...(live?.vsTraffic ? [`traffic=${encodeURIComponent(live.vsTraffic)}`] : []),
        ...(live?.vsTraffic && live?.vsStep ? [`step=${encodeURIComponent(live.vsStep)}`] : []),
        ...kept].join('&');
    return {
        options: {
            opt,
            title: doc?.getElementById('main-title')?.textContent?.trim() || doc?.title || null,
            frameQuery: frame?.contentWindow?.location?.search || '',
            storedOpt: lastOpt,
        },
        surface: `/systems2${query ? `?${query}` : ''}`,
    };
}

/**
 * Whether a view in the frame is in full screen (req #4053): a stage carries
 * its fixed full screen overlay (`.tpu3d-full` / `.s2-full`). Re-read when a
 * stage's class changes — those elements only, never the page's (its
 * animations flip classes on every frame) — and on each load of the frame.
 */
export function useFrameFullScreen(frameRef) {
    const [full, setFull] = useState(false);
    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return undefined;
        let mo = null;
        const attach = () => {
            mo?.disconnect();
            mo = null;
            let doc = null;
            try { doc = frame.contentDocument; } catch { /* not same-origin */ }
            const win = doc?.defaultView;
            if (!win) { setFull(false); return; }
            const check = () => setFull(!!doc.querySelector(FULL_SCREEN_SELECTOR));
            check();
            mo = new win.MutationObserver(check);
            doc.querySelectorAll(FULL_SCREEN_STAGES).forEach(el =>
                mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
        };
        frame.addEventListener('load', attach);
        if (frame.contentDocument?.readyState === 'complete') attach();
        return () => {
            frame.removeEventListener('load', attach);
            mo?.disconnect();
        };
    }, [frameRef]);
    return full;
}

const SystemsPage2 = () => {
    // Forward the query string so /systems2?opt=<view id> deep-links a view
    // (req #3530); the topology page reads ?opt= without persisting it.
    const { search } = useLocation();
    const frameRef = useRef(null);
    // req #3813 — the Requirement Filer records the view on screen, not the URL's.
    useEffect(() => registerPageOptions(() => topologyPageOptions(frameRef.current, search)), [search]);
    // req #4053 — a view's Full screen switch takes the browser's full screen on
    // THIS document (the frame's `data-host-fullscreen` asks it to — Topology
    // tpu3d.js tpu3dFsTarget), and while it is up the frame is drawn over the
    // whole window, navbar covered. Taken on the frame's own stage, the browser
    // showed the frame alone and nothing Darwin draws over the page: the
    // Requirement Filer and every other Action Popup were gone.
    const full = useFrameFullScreen(frameRef);
    useCoverNavbar(full);
    const fullRef = useRef(full);
    fullRef.current = full;
    // Esc leaves a view's full screen wherever the focus is: pressed in Darwin
    // (the Requirement Filer, over the view) it never reaches the frame, whose
    // own Esc handler leaves it — so it is handed to that handler. Not an Esc a
    // text field or an open window took (read once every listener has had it).
    useEffect(() => {
        if (!full) return undefined;
        let timer = null;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            const t = e.target;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
            timer = setTimeout(() => {
                const win = frameRef.current?.contentWindow;
                if (!e.defaultPrevented && win) win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
            }, 0);
        };
        window.addEventListener('keydown', onKey);
        return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer); };
    }, [full]);
    // Leaving the page while a view is full: the frame goes with it, so the
    // full screen it took on this document is left here.
    useEffect(() => () => {
        if (fullRef.current && document.fullscreenElement === document.documentElement) {
            Promise.resolve(document.exitFullscreen?.()).catch(() => {});
        }
    }, []);
    return (
        <Box data-testid="systems2-page" data-full={full ? 'true' : 'false'}
             sx={{ gridArea: 'content', height: '100vh', width: '100%', overflow: 'hidden',
                   ...(full && { position: 'fixed', inset: 0, width: '100vw', zIndex: FULL_SCREEN_Z }) }}>
            {/* data-host-fullscreen (req #4053): the views' Full screen is this document's, above. allow="fullscreen"
                (req #3568, #3600) stays so a full screen the frame takes on its own stage is still allowed. */}
            <iframe
                ref={frameRef}
                src={`/systems2/nvlink_topology.html${search}`}
                title="NVLink System Views"
                allow="fullscreen"
                data-host-fullscreen=""
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
            {/* req #3792 — the topology page's own toolbar is the Action Popups' rack */}
            <ToolbarRack frameRef={frameRef} />
        </Box>
    );
};

export default SystemsPage2;
