// Agent membership for one instruction row, edited in place (req #3063).
//
// THE ROSTER PALETTE. The chips that already showed the blast radius ARE the
// control: bound agents render solid, and one click on the ＋ chip unfurls the
// REST of the roster inline as dashed ghost chips. Clicking a ghost chip binds
// it; clicking a solid one's ✕ unbinds it. Same row, same shape, same gesture in
// both directions.
//
// Why this and not the obvious controls:
//   * A dropdown / Autocomplete (the first cut) hides the answer to the question
//     you actually have — "who ISN'T bound?" — behind a click and a scroll, and
//     makes you read a menu of names out of context. The palette answers it in
//     the same visual row as the bindings themselves.
//   * A checkbox list (the req #3049 dialog) spends twelve rows to show twelve
//     facts and buries the blast radius under a form.
//   * The roster is TWELVE architects, not a thousand. A control that scales to
//     unbounded options is the wrong shape for a set this size — showing all of
//     them is cheaper to read than any search affordance. `bindableAgents` is a
//     prop, so if the roster ever outgrows the palette the caller can cap it
//     without this component changing.
//
// The palette stays open after a bind so several can be bound in a row; the agent
// just bound simply moves from ghost to solid in place.
//
// This component does not CONFIRM an unbind, it REQUESTS one. The dialog and the
// write both live in the page (InstructionUnbindDialog + useConfirmDialog), which
// is the house parent-owns-state pattern and keeps the action logic next to the
// pessimistic-write queue that serializes it.
//
// ONE CHIP IS ONE WRITE. The old dialog committed a SET and diffed it
// (syncInstructionAgents), which read as atomic and was not: the diff is a
// sequence of independent Lambda calls under autocommit, so a half-applied save
// was always possible and the UI had no way to say so. A single bind or unbind
// per interaction removes that failure mode rather than reporting it.
//
// PESSIMISTIC, deliberately — and the opposite choice from the ghost text fields
// on the same card:
//   * The bound list is not a cache slice. It is a useMemo over the whole
//     agent_instructions query (agentsByInstruction), so an optimistic update
//     would mean hand-patching the junction cache and re-deriving from it.
//   * Nothing is applied locally, so a failed write leaves NOTHING to roll back.
//     For a non-atomic write that is worth more than the latency it costs; the
//     round trip is one call and its result is simply the chip going solid.

import { useState } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DoneAllIcon from '@mui/icons-material/DoneAll';

// Ghost chips read as "could be bound, isn't" — dashed and faded, so a glance
// separates them from the solid bindings without reading a single name.
const ghostChipSx = {
    borderStyle: 'dashed',
    opacity: 0.55,
    transition: 'opacity 150ms',
    '&:hover': { opacity: 1 },
};

const InstructionAgentChips = ({
    boundAgentIds = [],
    agentIndex,
    // Open agents this row could still bind — the caller filters and sorts.
    bindableAgents = [],
    // (agentId) => the junction sort_order this agent currently loads it at.
    slotOf,
    onBind,
    onBindAll,
    onRequestUnbind,
    onOpenAgent,
    busy = false,
    testIdPrefix,
}) => {
    const [paletteOpen, setPaletteOpen] = useState(false);

    const bound = boundAgentIds
        .map(id => agentIndex.get(id))
        .filter(Boolean)
        // Closed agents last: they bind nothing at boot, so they never belong
        // above an agent that does.
        .sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0)
            || (a.name || '').localeCompare(b.name || ''));

    // Requests the unbind; it does not confirm it. The page owns the confirmation
    // dialog (InstructionUnbindDialog via useConfirmDialog) so that the action logic
    // and the pessimistic-write queue stay in one place — the house
    // parent-owns-state pattern.
    // No `busy` guard: the page serializes membership writes through a queue, so a
    // second request is safely ordered rather than lost. The guard used to make the
    // chip's X look live and silently do nothing during another write — the chip is
    // not `disabled` (that would kill its drill-through too), so there was no
    // feedback at all.
    const requestUnbind = (agent) => onRequestUnbind(agent, slotOf?.(agent.id));

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', rowGap: 0.75 }}>
            {bound.length === 0 && !paletteOpen && (
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                    No agent loads this yet —
                </Typography>
            )}

            {bound.map(agent => {
                const slot = slotOf?.(agent.id);
                const orderNote = Number.isFinite(slot)
                    ? `Loads at #${slot} in ${agent.name}'s order — reorder on that agent's page.`
                    : `${agent.name} loads this at boot — set its position on that agent's page.`;
                return (
                    <Tooltip
                        key={agent.id}
                        title={agent.closed
                            ? `${agent.name} is closed — it never boots, so this binding loads nothing. `
                              + 'It is still real data a hard delete would cascade away.'
                            : orderNote}
                    >
                        <Chip
                            label={agent.closed ? `${agent.name} (closed)` : agent.name}
                            size="small"
                            clickable
                            // Deliberately NOT MUI's `disabled` for a closed agent:
                            // that would kill both the drill-through and the ✕, and
                            // the binding still has to be removable — it is data a
                            // hard delete would cascade. Muted styling instead.
                            variant={agent.closed ? 'outlined' : 'filled'}
                            sx={agent.closed ? { opacity: 0.6 } : undefined}
                            onClick={() => onOpenAgent(agent.id)}
                            onDelete={() => requestUnbind(agent)}
                            // The canonical testid stays on EVERY chip regardless of
                            // the agent's closed state. A test reaching for this
                            // binding should not have to know whether the agent
                            // happens to be closed today; closedness is exposed
                            // through the label and the attribute below instead.
                            data-testid={`${testIdPrefix}-agent-${agent.id}`}
                            data-agent-closed={agent.closed ? '1' : '0'}
                        />
                    </Tooltip>
                );
            })}

            {paletteOpen && bindableAgents.map(agent => (
                <Tooltip key={agent.id} title={`Not bound — click to bind ${agent.name}`}>
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

            {/* Bind-all sits with the palette, not on the resting card: it is only
                meaningful once you can see WHICH agents it would bind. Offered from
                two upwards — at one remaining agent it is just that agent's chip
                with a longer name. Additive and individually reversible, so no
                confirmation; unbinding is the direction that gets a dialog. */}
            {paletteOpen && bindableAgents.length > 1 && (
                <Tooltip title={`Bind all ${bindableAgents.length} remaining agents`}>
                    <Chip
                        size="small"
                        variant="outlined"
                        color="primary"
                        icon={<DoneAllIcon fontSize="small" />}
                        label={`bind all ${bindableAgents.length}`}
                        disabled={busy}
                        onClick={() => onBindAll(bindableAgents)}
                        data-testid={`${testIdPrefix}-agent-bind-all`}
                    />
                </Tooltip>
            )}

            {bindableAgents.length > 0 && (
                <Tooltip title={paletteOpen
                    ? 'Hide the unbound agents'
                    : `Show the ${bindableAgents.length} agents not bound to this`}>
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

export default InstructionAgentChips;
