// EngineList.jsx — the engines a page shows, grouped by machine (req #3760).
// Shared by `/swarm/engines` (every engine) and the plan page's Engine mode
// (the engines of one plan), so the two never draw an engine differently.

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

import EnginePanel from './EnginePanel';
import { machineName } from './EngineLocationPanel';

export default function EngineList({ view, timezone, empty }) {
    const { engines, names, now, isLoading, errors } = view;
    const groups = [];
    for (const e of engines) {
        const last = groups[groups.length - 1];
        if (last && last.machineId === e.machineId) last.engines.push(e);
        else groups.push({ machineId: e.machineId, engines: [e] });
    }
    return (
        <Box data-testid="engine-list">
            {errors.length > 0 && (
                <Alert severity="error" sx={{ mb: 2 }} data-testid="engine-read-error">
                    Could not read {errors.join(', ')}. What is shown below may be incomplete —
                    reload before acting on it.
                </Alert>
            )}
            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>
            ) : engines.length === 0 ? (
                <Alert severity="info" data-testid="engine-list-empty">{empty}</Alert>
            ) : groups.map((g) => (
                <Box key={g.machineId ?? 'none'} component="section" sx={{ mb: 1 }}
                     data-testid={`engine-machine-group-${g.machineId}`}>
                    <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>
                        {machineName(names.machines.get(g.machineId), g.machineId)}
                        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                            {g.engines.length} engine{g.engines.length === 1 ? '' : 's'}
                        </Typography>
                    </Typography>
                    {g.engines.map((e) => (
                        <EnginePanel key={e.key} engine={e} names={names} timezone={timezone} now={now} />
                    ))}
                </Box>
            ))}
        </Box>
    );
}
