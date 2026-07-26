// Agent membership for one document row, edited in place (req #3051).
//
// The direct counterpart of InstructionAgentChips, and deliberately the same
// gesture in both directions: bound agents render solid, one click on the ＋ chip
// unfurls the REST of the roster inline as dashed ghost chips, clicking a ghost
// chip binds it, and the ✕ on a solid one requests an unbind. The roster is
// twelve architects — showing all of them is cheaper to read than any search
// affordance, and it answers "who ISN'T linked?" without a click.
//
// TWO THINGS DIFFER FROM THE INSTRUCTION VERSION, both because a document link
// carries more than membership:
//
//   1. THE OWNER IS NOT HERE. `owned` is DB-enforced unique per document and
//      needs a transfer plan rather than a toggle, so it has its own row on the
//      card and this component renders only the non-owner links. Mixing them
//      would put two different kinds of write behind one identical-looking chip.
//
//   2. THE CHIP BODY OPENS AN EDITOR, not a drill-through. An instruction link is
//      just membership, so its chip navigates. A document link additionally
//      carries `relationship` roles and `notes`, and those need somewhere to be
//      edited — so the body opens DocumentLinkPopover and the drill-through to
//      the agent lives inside it, one click deeper. That is the honest trade: the
//      information the chip is now hiding is the information the popover exists
//      to show.
//
// Binding defaults to `referenced` with no role picker. Every one of the 32
// non-owned links in production is exactly `referenced`; making the fast path
// stop for a choice would tax the only case that actually happens. The popover is
// there for the exceptions.
//
// PESSIMISTIC, like the instruction version and for the same reason: the bound
// list is a useMemo over the whole `agent_documents` query, not a cache slice, so
// an optimistic update would mean hand-patching the junction cache and
// re-deriving from it — and a failed write would leave nothing to roll back.

import { useState } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DoneAllIcon from '@mui/icons-material/DoneAll';

import { relationshipChipProps, relationshipLabel } from './agentRegistryUtils';

// Ghost chips read as "could be linked, isn't" — dashed and faded, so a glance
// separates them from the real links without reading a single name.
const ghostChipSx = {
    borderStyle: 'dashed',
    opacity: 0.55,
    transition: 'opacity 150ms',
    '&:hover': { opacity: 1 },
};

const DocumentAgentChips = ({
    // Non-owner links for this document, each { agent_fk, relationship, notes, … }.
    links = [],
    agentIndex,
    // Open agents this document could still link — the caller filters and sorts.
    bindableAgents = [],
    onBind,
    onBindAll,
    onRequestUnbind,
    onOpenLink,
    busy = false,
    testIdPrefix,
}) => {
    const [paletteOpen, setPaletteOpen] = useState(false);

    const bound = links
        .map(l => ({ link: l, agent: agentIndex.get(l.agent_fk) }))
        .filter(x => x.agent)
        // Closed agents last: they never boot, so they never belong above an
        // agent that does.
        .sort((a, b) => (a.agent.closed ? 1 : 0) - (b.agent.closed ? 1 : 0)
            || (a.agent.name || '').localeCompare(b.agent.name || ''));

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', rowGap: 0.75 }}>
            {bound.length === 0 && !paletteOpen && (
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                    No other agent references this —
                </Typography>
            )}

            {bound.map(({ link, agent }) => (
                <Tooltip
                    key={agent.id}
                    title={agent.closed
                        ? `${agent.name} is closed — it never boots, so this link loads nothing. `
                          + 'It is still real data a hard delete would cascade away.'
                        : `${relationshipLabel(link.relationship)} — click to edit roles and notes`}
                >
                    <Chip
                        label={`${agent.name} · ${relationshipLabel(link.relationship)}`}
                        size="small"
                        clickable
                        {...relationshipChipProps(link.relationship)}
                        // Deliberately NOT MUI's `disabled` for a closed agent:
                        // that would kill both the editor and the ✕, and the link
                        // still has to be removable — it is data a hard delete
                        // would cascade. Muted styling instead.
                        sx={agent.closed ? { opacity: 0.6 } : undefined}
                        onClick={(e) => onOpenLink(link, agent, e.currentTarget)}
                        onDelete={() => onRequestUnbind(link, agent)}
                        // The canonical testid stays on EVERY chip regardless of
                        // the agent's closed state — a test reaching for this link
                        // should not have to know whether the agent happens to be
                        // closed today.
                        data-testid={`${testIdPrefix}-agent-${agent.id}`}
                        data-agent-closed={agent.closed ? '1' : '0'}
                    />
                </Tooltip>
            ))}

            {paletteOpen && bindableAgents.map(agent => (
                <Tooltip key={agent.id}
                         title={`Not linked — click to add ${agent.name} as referenced`}>
                    <Chip
                        label={agent.name}
                        size="small"
                        clickable
                        variant="outlined"
                        sx={ghostChipSx}
                        disabled={busy}
                        onClick={() => onBind(agent.id)}
                        data-testid={`${testIdPrefix}-bind-${agent.id}`}
                    />
                </Tooltip>
            ))}

            {/* Link-all sits with the palette, not on the resting card: it is only
                meaningful once you can see WHICH agents it would link. Offered
                from two upwards — at one remaining agent it is just that agent's
                chip with a longer name. Additive and individually reversible, so
                no confirmation; unlinking is the direction that gets a dialog. */}
            {paletteOpen && bindableAgents.length > 1 && (
                <Tooltip title={`Link all ${bindableAgents.length} remaining agents as referenced`}>
                    <Chip
                        size="small"
                        variant="outlined"
                        color="primary"
                        icon={<DoneAllIcon fontSize="small" />}
                        label={`link all ${bindableAgents.length}`}
                        disabled={busy}
                        onClick={() => onBindAll(bindableAgents)}
                        data-testid={`${testIdPrefix}-agent-bind-all`}
                    />
                </Tooltip>
            )}

            {bindableAgents.length > 0 && (
                <Tooltip title={paletteOpen
                    ? 'Hide the unlinked agents'
                    : `Show the ${bindableAgents.length} agents not linked to this`}>
                    <Chip
                        size="small"
                        variant="outlined"
                        color={paletteOpen ? 'primary' : 'default'}
                        icon={paletteOpen
                            ? <CloseIcon fontSize="small" />
                            : <AddIcon fontSize="small" />}
                        label={paletteOpen ? 'done' : bindableAgents.length}
                        onClick={() => setPaletteOpen(v => !v)}
                        data-testid={`${testIdPrefix}-agent-add`}
                    />
                </Tooltip>
            )}

            {busy && <CircularProgress size={14} sx={{ ml: 0.5 }} />}
        </Box>
    );
};

export default DocumentAgentChips;
