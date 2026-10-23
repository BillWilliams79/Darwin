// EngineScopeView.jsx — the 'engine' mode of /swarm/pipeline/:id (req #3760):
// the engines working THIS plan (whole-plan and initiative scopes, every
// machine), drawn exactly as /swarm/engines draws them.
//
// A mode component (pipelineDetailModes.js contract). It reads only the data
// contract rows, never the composed plan read, so it renders even while the
// plan's derivation is withheld — which is when a reader most wants to know
// what the engine made of it.

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import { Link as RouterLink } from 'react-router-dom';

import EngineList from './EngineList';
import { ENGINES_PATH } from './enginePaths';
import { useEngineView } from './useEngineView';

export default function EngineScopeView({ pipeline, timezone }) {
    const view = useEngineView({ pipelineId: pipeline.id });
    return (
        <Box sx={{ minWidth: 0 }} data-testid="engine-scope-view">
            <EngineList view={view} timezone={timezone}
                        empty={(
                            <>
                                No engine has run on this plan. Engines on other plans are on the{' '}
                                <Link component={RouterLink} to={ENGINES_PATH}>Engines page</Link>.
                            </>
                        )} />
        </Box>
    );
}
