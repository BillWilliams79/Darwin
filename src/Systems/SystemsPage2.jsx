import Box from '@mui/material/Box';
import { useLocation } from 'react-router-dom';

const SystemsPage2 = () => {
    // Forward the query string so /systems2?opt=<view id> deep-links a view
    // (req #3530); the topology page reads ?opt= without persisting it.
    const { search } = useLocation();
    return (
        <Box sx={{ gridArea: 'content', height: '100vh', width: '100%', overflow: 'hidden' }}>
            <iframe
                src={`/systems2/nvlink_topology.html${search}`}
                title="NVLink System Views"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
        </Box>
    );
};

export default SystemsPage2;
