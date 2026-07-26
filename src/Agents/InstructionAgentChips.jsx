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

// THE COMPACT VARIANT (req #3067). The table view needs this same control inside a
// 92px grid row, where an inline palette of twelve ghost chips cannot fit. Rather
// than write a second membership control — which would be a second answer to the
// question "what does one click do?" — `variant="compact"` keeps every behaviour and
// changes only the assembly: bound chips on one non-wrapping line, and the palette
// moved into a Popover.
//
// The three chip GROUPS are built once and laid out twice. The first cut had the
// compact variant render THIS COMPONENT recursively inside the Popover, which is
// tidier to describe and wrong in practice: the bound chips and the toggle would
// then exist in both the row and the popover simultaneously, duplicating the exact
// data-testids both views' assertions reach for. Sharing the groups gets the same
// "one implementation, two presentations" property with no duplicate DOM.
//
// Untouched by the variant, because they are the part that matters: one chip is one
// write, the page's serialized pessimistic queue, and the drill-through.

import { useEffect, useState } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Popover from '@mui/material/Popover';
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
    // 'inline' — the card: the palette unfurls in place, below the bound chips.
    // 'compact' — a DataGrid cell: one non-wrapping line, palette in a Popover.
    variant = 'inline',
}) => {
    const [paletteOpen, setPaletteOpen] = useState(false);
    // The compact variant's Popover anchor, captured from the toggle chip's own
    // `e.currentTarget` — the house idiom (SwarmView, InstructionsPage's sort menu)
    // rather than a forwarded ref through Tooltip's cloned child.
    const [paletteAnchor, setPaletteAnchor] = useState(null);
    const compact = variant === 'compact';

    const togglePalette = (e) => {
        setPaletteAnchor(e.currentTarget);
        setPaletteOpen(v => !v);
    };

    // BINDING THE LAST AGENT MUST CLOSE THE PALETTE, not merely hide it.
    //
    // The toggle chip IS the Popover's anchor, and it unmounts when nothing is left
    // to bind. Gating only the Popover's `open` on `bindableAgents.length` masks the
    // symptom at that instant and re-arms it: unbind anyone afterwards, a new toggle
    // chip mounts, `paletteOpen` is still true, and the palette REOPENS BY ITSELF —
    // anchored to the detached original chip, so MUI clamps it to the top-left of
    // the viewport, far from the row it belongs to. Clearing the state is the fix;
    // the `open` guard stays as belt and braces for the frame in between.
    useEffect(() => {
        if (bindableAgents.length === 0) setPaletteOpen(false);
    }, [bindableAgents.length]);

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

    // ---- the three chip groups, built once, laid out twice ----

    const emptyNote = bound.length === 0 && (compact || !paletteOpen) ? (
        <Typography key="empty" variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
            {/* The row has no space for the card's fuller phrasing, and in a
                table the adjacent count column already says "0". */}
            {compact ? 'not bound' : 'No agent loads this yet —'}
        </Typography>
    ) : null;

    const boundChips = bound.map(agent => {
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
                    sx={{
                        ...(agent.closed && { opacity: 0.6 }),
                        // In a grid row the chips must not shrink into ellipsised
                        // stubs; the row scrolls the overflow away instead and the
                        // palette popover is where the full roster is legible.
                        ...(compact && { flexShrink: 0, maxWidth: 160 }),
                    }}
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
    });

    const paletteChips = bindableAgents.map(agent => (
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
    ));

    // Bind-all sits with the palette, not on the resting card: it is only
    // meaningful once you can see WHICH agents it would bind. Offered from two
    // upwards — at one remaining agent it is just that agent's chip with a longer
    // name. Additive and individually reversible, so no confirmation; unbinding is
    // the direction that gets a dialog.
    const bindAllChip = bindableAgents.length > 1 ? (
        <Tooltip key="bind-all" title={`Bind all ${bindableAgents.length} remaining agents`}>
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
    ) : null;

    const toggleChip = bindableAgents.length > 0 ? (
        <Tooltip key="toggle" title={paletteOpen
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
                onClick={togglePalette}
                sx={compact ? { flexShrink: 0 } : undefined}
                data-testid={`${testIdPrefix}-agent-add`}
            />
        </Tooltip>
    ) : null;

    const spinner = busy
        ? <CircularProgress key="busy" size={14} sx={{ ml: 0.5, flexShrink: 0 }} />
        : null;

    // ---- layout 1: the card. The palette unfurls in place. ----

    if (!compact) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', rowGap: 0.75 }}>
                {emptyNote}
                {boundChips}
                {paletteOpen && paletteChips}
                {paletteOpen && bindAllChip}
                {toggleChip}
                {spinner}
            </Box>
        );
    }

    // ---- layout 2: the grid cell. One line; the palette is a Popover. ----

    return (
        <>
            {/* nowrap + hidden, NOT wrap: the row height is fixed, so a second line
                of chips would be clipped rather than shown. What overflows is
                reachable through the palette, which lists the whole roster. */}
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: 0.5,
                flexWrap: 'nowrap', overflow: 'hidden', width: '100%',
            }}>
                {emptyNote}
                {boundChips}
                {toggleChip}
                {spinner}
            </Box>
            <Popover
                // `bindableAgents.length > 0` is part of the OPEN condition, not
                // just a guard. Binding the last remaining agent unmounts the
                // toggle chip — which is the anchor — and a Popover left open on a
                // detached anchorEl warns and floats at the origin. Closing on the
                // same condition that removes the anchor is also the right
                // behaviour: there is nothing left to bind.
                open={paletteOpen && !!paletteAnchor && bindableAgents.length > 0}
                anchorEl={paletteAnchor}
                onClose={() => setPaletteOpen(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                // The Popover renders through a PORTAL, outside the DataGrid — which
                // is why a test scoping its queries to `instructions-datagrid` has to
                // reach for this content at page level instead. Documented in
                // memory/darwin-viewer-pages.md.
                slotProps={{ paper: { 'data-testid': `${testIdPrefix}-agent-palette` } }}
            >
                <Box sx={{
                    p: 1.5, maxWidth: 520,
                    display: 'flex', alignItems: 'center', gap: 0.5,
                    flexWrap: 'wrap', rowGap: 0.75,
                }}>
                    {paletteChips}
                    {bindAllChip}
                </Box>
            </Popover>
        </>
    );
};

export default InstructionAgentChips;
