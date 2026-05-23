import Box from '@mui/material/Box';

const BuildVisualizerPage = () => {
    return (
        <Box sx={{ gridArea: 'content', height: '100vh', width: '100%', overflow: 'hidden' }}>
            <iframe
                src="/build-visualizer/index.html"
                title="Build Visualizer"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
        </Box>
    );
};

export default BuildVisualizerPage;
