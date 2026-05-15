import Box from '@mui/material/Box';

const SystemsPage2 = () => {
    return (
        <Box sx={{ gridArea: 'content', height: '100vh', width: '100%', overflow: 'hidden' }}>
            <iframe
                src="/systems2/nvlink_topology.html"
                title="NVLink Scale Up Network (v2)"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
        </Box>
    );
};

export default SystemsPage2;
