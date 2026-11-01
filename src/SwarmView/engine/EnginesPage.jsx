// EnginesPage.jsx — /swarm/engines: every orchestration engine, machine-wide
// (req #3760). What each one is doing, read from the rows it publishes, so
// nobody reads a terminal to know.

import { useContext } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import AuthContext from '../../Context/AuthContext';
import EngineList from './EngineList';
import { HEALTH_ASLEEP, HEALTH_MISSING, HEALTH_OK, HEALTH_DEGRADED } from './engineVocabulary';
import { useEngineView } from './useEngineView';

export default function EnginesPage() {
    const { profile } = useContext(AuthContext);
    const view = useEngineView();
    const count = (pred) => view.engines.filter(pred).length;
    const alive = count((e) => e.health === HEALTH_OK || e.health === HEALTH_DEGRADED);
    const missing = count((e) => e.health === HEALTH_MISSING);
    const asleep = count((e) => e.health === HEALTH_ASLEEP);
    const off = count((e) => e.off);
    return (
        <Box sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }} data-testid="engines-page">
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <Typography variant="h5" component="h1">Engines</Typography>
                {!view.isLoading && (
                    <Typography variant="body2" color="text.secondary" data-testid="engines-summary">
                        {view.engines.length} engine{view.engines.length === 1 ? '' : 's'} · {alive} beating
                        {' '}· {missing} missing{asleep ? ` · ${asleep} asleep` : ''} · {off} off
                    </Typography>
                )}
            </Box>
            <EngineList view={view} timezone={profile?.timezone}
                        empty={'No orchestration engine has published anything yet. An engine '
                            + 'appears here on its first heartbeat.'} />
        </Box>
    );
}
