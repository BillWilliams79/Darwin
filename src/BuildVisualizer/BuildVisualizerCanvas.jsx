// BuildVisualizerCanvas.jsx — orchestrator for the Build Visualizer render
// surface (req #2864).
//
// The diagram renderer was re-platformed from React-rendered SVG onto a Konva
// canvas, mirroring the Swarm Visualizer migration (req #2841). This component
// keeps the public prop contract the page already depends on (model, projectId,
// loading/error, filters, the hover/click callbacks, resetViewNonce) and the
// loading / error / empty states, then lazy-loads the heavy Konva render layer —
// Konva pulls a large canvas bundle, so it is code-split exactly like the swarm
// (KonvaSwarmCanvas via SwarmVisualizerView). The semantic-zoom logic, d3-zoom
// pan/zoom, and all glyph drawing now live in KonvaBuildCanvas.

import { Suspense, lazy } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

const KonvaBuildCanvas = lazy(() => import('./KonvaBuildCanvas'));

const BuildVisualizerCanvas = ({
    model,
    projectId,
    isLoading,
    error,
    selectedTypes,
    staggerOn,
    showReleases,
    appMode,
    darkVariant,
    pinnedLevel,
    onEffectiveLevel,
    onBuildClick,
    onBuildLeave,
    onBranchClick,
    onEmptyAnchorClick,
    resetViewNonce,
}) => {
    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <CircularProgress />
            </Box>
        );
    }
    if (error) {
        return (
            <Box sx={{ p: 2, color: 'error.main' }}>
                Error loading build data: {error?.message || String(error)}
            </Box>
        );
    }
    if (!model?.branches?.length) {
        return (
            <Box sx={{ p: 2, color: 'text.secondary' }}>
                No branches in the selected project.
            </Box>
        );
    }

    return (
        <Box sx={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
            <Suspense fallback={(
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <CircularProgress />
                </Box>
            )}>
                <KonvaBuildCanvas
                    model={model}
                    projectId={projectId}
                    selectedTypes={selectedTypes}
                    staggerOn={staggerOn}
                    showReleases={showReleases}
                    appMode={appMode}
                    darkVariant={darkVariant}
                    pinnedLevel={pinnedLevel}
                    onEffectiveLevel={onEffectiveLevel}
                    onBuildClick={onBuildClick}
                    onBuildLeave={onBuildLeave}
                    onBranchClick={onBranchClick}
                    onEmptyAnchorClick={onEmptyAnchorClick}
                    resetViewNonce={resetViewNonce}
                />
            </Suspense>
        </Box>
    );
};

export default BuildVisualizerCanvas;
