// The 'plan' mode's panel until req #3115 lands the real visualizer.
//
// A named placeholder, not a disabled toggle: the mode IS part of the design
// (memory/swarm-orchestration.md § POC transfer manifest assigns the whole
// viz-generate.py Plan mode to #3115), so the switcher should carry it. What a
// placeholder must never do is look broken — it says exactly what is coming and
// which requirement brings it.

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import AccountTreeIcon from '@mui/icons-material/AccountTree';

export default function PipelinePlanPlaceholder() {
    return (
        <Paper
            variant="outlined"
            sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center',
                   gap: 1.5, textAlign: 'center' }}
            data-testid="pipeline-plan-placeholder"
        >
            <AccountTreeIcon sx={{ fontSize: 44, color: 'text.disabled' }} />
            <Typography variant="h6">Plan visualizer</Typography>
            <Box sx={{ maxWidth: 620 }}>
                <Typography variant="body2" color="text.secondary">
                    The graph view of this plan — epic bands, chain-aware swim lanes,
                    dependency-depth columns, launch-batch boxes, and drag-to-pan with
                    three-level zoom — is a separate requirement and is not built yet.
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Until then, the Table view above is the complete plan: same rows, same
                    computed order, same launch batches.
                </Typography>
            </Box>
        </Paper>
    );
}
