import { useEffect, useRef } from 'react';

import Box from '@mui/material/Box';
import { useLocation } from 'react-router-dom';

import { registerPageOptions } from '../RequirementFiler/filedFromContext';
import ToolbarRack from './ToolbarRack';

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
    // (&traffic=, &step=); the frame's <body> carries the live ones as data-vs-traffic / data-vs-step.
    const kept = (search || '').replace(/^\?/, '').split('&')
        .filter(p => p && !(opt ? /^(opt|filer|traffic|step)(=|$)/ : /^filer(=|$)/).test(p));
    const live = opt === 'tpu8t-virgo-simple' ? doc?.body?.dataset : null;
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

const SystemsPage2 = () => {
    // Forward the query string so /systems2?opt=<view id> deep-links a view
    // (req #3530); the topology page reads ?opt= without persisting it.
    const { search } = useLocation();
    const frameRef = useRef(null);
    // req #3813 — the Requirement Filer records the view on screen, not the URL's.
    useEffect(() => registerPageOptions(() => topologyPageOptions(frameRef.current, search)), [search]);
    return (
        <Box sx={{ gridArea: 'content', height: '100vh', width: '100%', overflow: 'hidden' }}>
            {/* allow="fullscreen" (req #3568; every TPU 3D view since req #3600): a Rack / SuperPod / Data Center · 3D
                view's Full screen switch takes the browser's full screen from inside this frame, so Darwin's navbar goes too. */}
            <iframe
                ref={frameRef}
                src={`/systems2/nvlink_topology.html${search}`}
                title="NVLink System Views"
                allow="fullscreen"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
            {/* req #3792 — the topology page's own toolbar is the Action Popups' rack */}
            <ToolbarRack frameRef={frameRef} />
        </Box>
    );
};

export default SystemsPage2;
