// /agents/instructions — the instruction registry (req #2998).
//
// The point of this page is BLAST RADIUS. An instruction is a row, and a "common"
// instruction is simply a row that many agents link — there is no common flag in
// the schema. Editing one changes the duty for every agent that references it at
// their next boot, so every row shows chips for all referencing agents BEFORE
// anyone edits it.

import '../index.css';
import { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import useMediaQuery from '@mui/material/useMediaQuery';

import AuthContext from '../Context/AuthContext';
import {
    useInstructions, useAgents, useAgentInstructions,
} from '../hooks/useDataQueries';
import { byId, agentsByInstruction, isCommonInstruction } from './agentRegistryUtils';

const InstructionsPage = () => {
    const navigate = useNavigate();
    const { profile } = useContext(AuthContext);
    const isMobile = useMediaQuery('(max-width:899px)');
    const creatorFk = profile?.userName;

    const { data: instructions, isLoading } = useInstructions(creatorFk);
    const { data: agents } = useAgents(creatorFk);
    const { data: agentInstrs } = useAgentInstructions(creatorFk);

    const agentIndex = useMemo(() => byId(agents || []), [agents]);
    const byInstruction = useMemo(
        () => agentsByInstruction(agentInstrs || []), [agentInstrs]);

    const rows = useMemo(() => {
        if (!instructions) return [];
        return instructions
            .filter(i => !i.closed)
            .map(i => ({ ...i, refs: byInstruction.get(i.id) || [] }))
            .sort((a, b) =>
                // Common rows first (biggest blast radius at the top), then by
                // the sort_order that drives boot load order.
                b.refs.length - a.refs.length ||
                (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) ||
                a.name.localeCompare(b.name));
    }, [instructions, byInstruction]);

    if (isLoading || !instructions) {
        return <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ mb: 0.5 }}>Instructions</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {rows.length} binding instruction rows. Chips show every agent bound by each row —
                editing a row changes the duty for all of them at their next boot.
            </Typography>

            <Stack spacing={1.5} data-testid="instructions-registry">
                {rows.map(row => {
                    const common = isCommonInstruction(row.id, byInstruction);
                    return (
                        <Paper key={row.id} variant="outlined" sx={{ p: 2 }}
                               data-testid={`instruction-row-${row.id}`}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                                <Typography variant="subtitle2" sx={{ fontFamily: 'monospace' }}>
                                    {row.name}
                                </Typography>
                                {common && (
                                    <Chip label="common" size="small" color="secondary" variant="outlined"
                                          data-testid={`instruction-common-${row.id}`} />
                                )}
                                <Chip label={`${row.refs.length} agent${row.refs.length === 1 ? '' : 's'}`}
                                      size="small" variant="outlined" />
                            </Box>

                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1.5 }}>
                                {row.content}
                            </Typography>

                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {row.refs.map(aid => {
                                    const a = agentIndex.get(aid);
                                    if (!a) return null;
                                    return (
                                        <Chip
                                            key={aid}
                                            label={a.name}
                                            size="small"
                                            clickable
                                            onClick={() => navigate(`/agents/${aid}#instructions`)}
                                            data-testid={`instruction-${row.id}-agent-${aid}`}
                                        />
                                    );
                                })}
                            </Stack>
                        </Paper>
                    );
                })}
            </Stack>
        </Box>
    );
};

export default InstructionsPage;
