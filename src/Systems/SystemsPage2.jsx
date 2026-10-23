import { useRef } from 'react';

import Box from '@mui/material/Box';
import { useLocation } from 'react-router-dom';

import ToolbarRack from './ToolbarRack';

const SystemsPage2 = () => {
    // Forward the query string so /systems2?opt=<view id> deep-links a view
    // (req #3530); the topology page reads ?opt= without persisting it.
    const { search } = useLocation();
    const frameRef = useRef(null);
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
