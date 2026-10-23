// PipelinePlanToolbar.jsx — the PLAN mode's own controls on the plan page's
// header row (req #3261, extracted from PipelineDetail.jsx).
//
// WHY IT IS ITS OWN FILE (P8 / S4). Both shipped visualizers keep the active
// mode's controls in a component of their own — `SwarmView.jsx` renders
// `<VisualizerToolbar />` and nothing else for its canvas mode, and this is that
// file's sibling. Inlined, these ~250 lines were a large part of why
// `PipelineDetail.jsx` was 1133 lines, and every one of them is dead in Table
// mode. The extraction is mechanical: same controls, same behaviour, same
// preference plumbing, all of it still owned by the page (this component reads
// no storage, and its only state is the colour help's long-press pin, req #3766).
//
// WHY IT RETURNS A FRAGMENT rather than a wrapping Box. The header row is a flex
// container whose group separators are its OWN children (P2), so these controls
// have to BE that row's children: a wrapper would make them one flex item, the
// divider between the view group and the display group could not sit between
// them, the row's own `gap` would stop applying between the groups, and the
// DOM-order assertions PIPE-18 makes about the row's children would be reading a
// box instead of the controls.
//
// THE VOCABULARY IS THE BUILD VISUALIZER'S (P1 / S6): a small Chip, filled when
// on, outlined when off, from `toolbarChipProps`. That is also what
// `SemanticLevelControl` speaks — the shared control this row cannot restyle
// without changing the Build Visualizer too — so converging on it is the only
// choice that makes the row ONE vocabulary rather than one-plus-the-shared-one.
// Reset is the one deliberate exception and it is a COLOUR exception, not a
// widget one (req #3242 user directive — see its own note below).

import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';

import SemanticLevelControl from '../../Components/SemanticLevelControl';
import { PLAN_LEVEL_NUMBER, REQ_COLOR_SCALES,
    EPICS_ACROSS_OPTIONS, EPIC_WIDTH_RUNGS } from './pipelinePlanLayout';
import { toolbarChipProps } from './pipelineChipStyles';
import { ANY_MACHINE, machineChipLabel, orderMachineChips } from './planMachineFilter';
import { resolveThisMachineId } from '../terminalFocus';
import { LONG_PRESS_MS, PRESS_SLOP_PX } from '../../dnd/pressTimeline';

// Reset's wording, in ONE place: it is both the tooltip and the accessible name
// (see the chip below for why the two may not drift). It named the level too
// between req #3310 and req #3324, because Reset cleared the pin; #3324 made the
// level fixed until Auto is chosen, so Reset is about the camera and says so.
//
// "Reset" → "Default" (req #3648 user directive, "change reset to default for
// the view"): the control returns the camera to the plan's DEFAULT view — the
// one the page opens on since req #3312 — so the word now names the place it
// goes rather than the act of going there. The testid stays `pipeline-viz-reset`.
export const RESET_LABEL = 'Default — fully zoomed out, the whole plan\'s vertical '
    + 'extent visible';

// EPIC WIDTH IS HIDDEN, NOT DELETED (req #3648). The card is drawn at the
// fixed 25%-wider rung (`DEFAULT_PLAN_EPIC_WIDTH`, user directive "make the
// epic cards 25% wider"); flip the flag to bring the rungs back. The 6 5 4 3
// the user asked for between Color and the view are EPICS ACROSS — a zoom —
// not card widths (user, same day: "it's supposed to center that many active
// epics of width").
export const SHOW_EPIC_WIDTH = false;

// THE COLOUR CHIPS ARE THE REGISTRY, not a copy of it (req #3422). This array
// used to be written out here, which meant a scale's LABEL lived in the toolbar
// while its COLOURS lived in `pipelinePlanLayout.js` — two files to edit for one
// scale, and nothing to catch a chip that named a scale the canvas could not
// paint. `REQ_COLOR_SCALES` carries both, so the third scale (Autonomy) reached
// this row without an edit to this file's control at all.
//
// ONE TOOLTIP PER CONTROL, never one over the group (P6 / S8), and the strings
// travel with the scale for that rule's own reason: a tooltip has to say what
// THAT chip does. A single Tooltip wrapped the pair before, so it could say what
// they were FOR and could not say what either one DID. The deselect hint is on
// every chip, because
// clicking the pressed one is how the neutral position is reached and that is
// not discoverable from any one chip.

// ── THE COLOUR HELP'S LONG-PRESS PIN (req #3766, user directive: "if i long
// press the color, the color help will stick unless you click any button
// again") ─────────────────────────────────────────────────────────────────────
// Hover (and keyboard focus) on a chip reports `{ key, el }` so the visualizer
// draws that chip's help (req #3722), and leaving reports null. A LONG PRESS —
// held still for the app's LONG_PRESS_MS, within PRESS_SLOP_PX — PINS it: it
// fires while still held, reports `{ key, el, pinned: true }`, and from then on
// hover, focus and blur change nothing. The release that ends the long press is
// not a click (it would otherwise toggle the colour key it was asking about).
// The NEXT press anywhere — any button, any chip, the canvas — or Escape unpins
// it, and the help falls back to whatever chip the pointer rests on, so a press
// on another colour chip still does what that chip does. The touch context menu
// a long press would raise on a chip is suppressed for the same press.
function useKeyHelp(onKeyHover) {
    const reportRef = useRef(onKeyHover);
    reportRef.current = onKeyHover;
    const hoverRef = useRef(null);         // the chip under the pointer / focus
    const pinnedRef = useRef(null);        // the pinned `{ key, el, pinned }`
    const pressRef = useRef(null);         // `{ x, y, timer }` of a press in flight
    const swallowClickRef = useRef(false);
    const [pinned, setPinned] = useState(null);

    const endPress = () => {
        if (pressRef.current) clearTimeout(pressRef.current.timer);
        pressRef.current = null;
    };
    const report = (h) => {
        hoverRef.current = h;
        if (!pinnedRef.current) reportRef.current?.(h);
    };

    // While pinned, the next press (capture phase, so nothing under it can stop
    // it) or Escape unpins. Attached after the pinning press went down, so that
    // press cannot unpin itself.
    useEffect(() => {
        if (!pinned) return undefined;
        const unpin = () => {
            pinnedRef.current = null;
            swallowClickRef.current = false;
            setPinned(null);
            reportRef.current?.(hoverRef.current);
        };
        const onKey = (e) => { if (e.key === 'Escape') unpin(); };
        window.addEventListener('pointerdown', unpin, true);
        window.addEventListener('keydown', onKey, true);
        return () => {
            window.removeEventListener('pointerdown', unpin, true);
            window.removeEventListener('keydown', onKey, true);
        };
    }, [pinned]);

    // Unmounting drops a press in flight and a pin with it.
    useEffect(() => () => {
        endPress();
        if (pinnedRef.current) reportRef.current?.(null);
    }, []);

    return (key) => ({
        onMouseEnter: (e) => report({ key, el: e.currentTarget }),
        onMouseLeave: () => report(null),
        onFocus: (e) => report({ key, el: e.currentTarget }),
        onBlur: () => report(null),
        onPointerDown: (e) => {
            swallowClickRef.current = false;
            endPress();
            if (e.button !== 0) return;
            const el = e.currentTarget;
            pressRef.current = {
                x: e.clientX, y: e.clientY,
                timer: setTimeout(() => {
                    pressRef.current = null;
                    swallowClickRef.current = true;
                    const h = { key, el, pinned: true };
                    pinnedRef.current = h;
                    setPinned(h);
                    reportRef.current?.(h);
                }, LONG_PRESS_MS),
            };
        },
        onPointerMove: (e) => {
            const p = pressRef.current;
            if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP_PX) endPress();
        },
        onPointerUp: endPress,
        onPointerCancel: endPress,
        onPointerLeave: endPress,
        onContextMenu: (e) => {
            if (pressRef.current || pinnedRef.current?.el === e.currentTarget) e.preventDefault();
        },
        onClickCapture: (e) => {
            if (!swallowClickRef.current) return;
            swallowClickRef.current = false;
            e.stopPropagation();
            e.preventDefault();
        },
    });
}

// Stable defaults, so an omitted prop is not a new identity every render.
const NO_MACHINES = [];
const NO_HIDDEN = new Set();

/**
 * @param {Object} props
 * @param {function} props.onEpicsAcross       receives the epic count to fit
 * @param {number} props.epicWidthLevel         a EPIC_WIDTH_RUNGS value (6|5|4|3)
 * @param {function} props.onChangeEpicWidthLevel receives the level as a string
 * @param {string} props.colorKey               a REQ_COLOR_KEYS value
 * @param {function} props.onChangeColorKey     receives a REQ_COLOR_KEYS value
 * @param {function} [props.onKeyHover]         receives `{ key, el }` when the pointer (or focus)
 *                                              rests on a colour
 *                                              chip (`key` its scale), `null` when it leaves; the
 *                                              plan visualizer draws the colour-help popup
 *                                              (req #3722); a long press reports it with
 *                                              `pinned: true` and holds it until the next
 *                                              press anywhere (req #3766)
 * @param {boolean} props.hideClosed            the closed (met/deferred/wontfix) rows are hidden
 * @param {function} props.onChangeHideClosed   receives the next boolean
 * @param {Object[]} props.machines             the open machines, one filter chip each (req #3708)
 * @param {Set<number>} props.hiddenMachines    machine ids whose requirements are hidden
 * @param {function} props.onToggleMachine      receives a machine id
 * @param {string} props.planLevelPref         'auto' | '1' | '2' | '3'
 * @param {?string} props.effectiveLevel        the canvas's 'out'|'mid'|'in'
 * @param {function} props.onChangeLevelPref    receives 'auto' | '1' | '2' | '3'
 * @param {function} props.onResetView          the Reset click
 */
export default function PipelinePlanToolbar({
    onEpicsAcross,
    epicWidthLevel,
    onChangeEpicWidthLevel,
    colorKey,
    onChangeColorKey,
    onKeyHover,
    hideClosed,
    onChangeHideClosed,
    machines = NO_MACHINES,
    hiddenMachines = NO_HIDDEN,
    onToggleMachine,
    planLevelPref,
    effectiveLevel,
    onChangeLevelPref,
    onResetView,
}) {
    // Hover (and keyboard focus) on a chip reports it so the visualizer can draw
    // that chip's colour help (req #3722); a long press pins it (req #3766).
    const hoverKeyProps = useKeyHelp(onKeyHover);
    // req #3806 — the machine this browser is on leads the machine chips.
    const thisMachineId = resolveThisMachineId(machines);
    return (
        <>
            {/* The colour key for the REQUIREMENT MARKS, never the beads — the
                bead's fill is derived EPIC state and stays that (the
                one-fact-one-channel-one-level rule in pipelinePlanLayout.js).

                N+1 POSITIONS FROM N CHIPS, unchanged in behaviour by the move
                off `ToggleButtonGroup` and unchanged again by the third scale
                (req #3422). The group used to lean on MUI's exclusive-group
                `onChange(_, null)` to report the neutral position; chips have no
                group to fire that, so the "click the pressed one again" rule is
                spelled out here instead. `useViewPreference` ignores null, which
                is why 'none' is stored as a string.

                It gains a caption for the same reason Width did: bare chips
                reading "State", "Autonomy" and "Machine" name their own VALUES
                and leave the axis they select unstated, which is P9's defect
                with no first option to hide the name in.

                NO CAPTION, AND THIS GROUP LEADS THE ROW (req #3648 user
                directive: remove the text descriptors "Color" and "View", and
                swap the two groups' places). The chips' own tooltips carry what
                the caption said. Before that, THE CAPTION WAS "Color" (req #3365
                user directive). Darwin's
                prose is British throughout this module and stays that way —
                this is the one string a USER reads, and it now matches the
                rest of the product's UI spelling rather than the code's. The
                chip ORDER is the user's too, and it lives in
                `REQ_COLOR_SCALES`, not here — see its own comment. */}
            <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
                   sx={{ flexShrink: 0 }}
                   data-testid="pipeline-viz-colorkey-toggle">
                {/* The colour chips explain THEMSELVES on hover — active or not —
                    so the old Tooltip is gone: two overlays on one chip would
                    fight. `chipTip` stays the registry's description (the
                    chip's aria-label carries `chipName`). */}
                {REQ_COLOR_SCALES.map(({ key, chipLabel, chipName }) => {
                    const on = colorKey === key;
                    return (
                        <Chip
                            key={key}
                            label={chipLabel}
                            aria-label={chipName}
                            onClick={() => onChangeColorKey(on ? 'none' : key)}
                            {...hoverKeyProps(key)}
                            {...toolbarChipProps(on)}
                            data-testid={`pipeline-viz-colorkey-${key}`}
                        />
                    );
                })}
            </Stack>

            <Divider orientation="vertical" flexItem
                     sx={{ mx: 0.5, flexShrink: 0 }} />

            {/* ── HIDE CLOSED (req #3686, user directive: "a UI button between
                color and width") ──────────────────────────────────────────
                Hides every epic card's CLOSED requirements (met / deferred /
                wontfix — the list under the dashed complete line) AND that line,
                leaving the open work. A STATE like Colour, so it shows pressed;
                the cards re-lay out because they are shorter. */}
            <Tooltip title={hideClosed
                ? 'Show the closed (met, deferred, wontfix) requirements again'
                : 'Hide the closed (met, deferred, wontfix) requirements and their dashed line'}>
                <Chip
                    label="Closed"
                    aria-label="Hide closed requirements"
                    onClick={() => onChangeHideClosed?.(!hideClosed)}
                    {...toolbarChipProps(!!hideClosed, { sx: {
                        flexShrink: 0, height: 22,
                        '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' },
                    } })}
                    data-testid="pipeline-viz-hide-closed"
                />
            </Tooltip>

            <Divider orientation="vertical" flexItem
                     sx={{ mx: 0.5, flexShrink: 0 }} />

            {/* ── MACHINE FILTER (req #3708, user directive: "a machine ID
                filter for MCHP Windows or Mac Mini, deselecting a filter means
                machine specific requirements will not be displayed anywhere in
                the visualizer") ───────────────────────────────────────────
                One chip per open machine, pressed = its requirements are
                shown. Every machine starts pressed; deselecting one hides the
                requirements pinned to it on the epic cards AND in the
                Orchestrables box. A trailing Any chip does the same for
                requirements pinned to no machine (follow-up user directive:
                "add an any filter as well"), so the group always has at least
                that one chip. */}
            <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
                   sx={{ flexShrink: 0 }}
                   data-testid="pipeline-viz-machine-filter">
                {orderMachineChips(machines, thisMachineId).map((m) => {
                    const on = !hiddenMachines.has(m.id);
                    const name = m.id === ANY_MACHINE ? 'Any' : machineChipLabel(m);
                    const what = m.id === ANY_MACHINE
                        ? 'requirements pinned to Any machine' : `${name} requirements`;
                    return (
                        <Tooltip key={m.id} title={on
                            ? `Showing ${what} — click to hide them`
                            : `Hiding ${what} — click to show them`}>
                            <Chip
                                label={name}
                                aria-label={`${on ? 'Hide' : 'Show'} ${what}`}
                                onClick={() => onToggleMachine?.(m.id)}
                                {...toolbarChipProps(on, { sx: { flexShrink: 0 } })}
                                data-testid={`pipeline-viz-machine-${m.id}`}
                            />
                        </Tooltip>
                    );
                })}
            </Stack>

            <Divider orientation="vertical" flexItem
                     sx={{ mx: 0.5, flexShrink: 0 }} />

            {/* ── EPICS ACROSS — the zoom ladder, in the unit a reader thinks
                in (req #3498, user directive 2026-08-13) ────────────────────
                BETWEEN the colour chips and the view group since req #3648, as
                6 5 4, centred on the active epics (`epicsAcrossTransform`).
                Numbers only, all one size — the directive is
                specific and the reason it works is that the number IS the
                label: "4" means four epics across, and an explainer beside it
                would say the same word twice.

                NOT a toggle group and nothing is ever shown pressed. These are
                ACTIONS, not a state: the reader can wheel-zoom away from any of
                them, so a chip left pressed would go on claiming a scale the
                canvas is no longer at. Reset is the same kind of control for the
                same reason. */}
            <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
                   sx={{ flexShrink: 0 }}
                   data-testid="pipeline-viz-epics-across">
                {EPICS_ACROSS_OPTIONS.map((n) => (
                    <Tooltip key={n} title={`Fit ${n} epics across, centred on the active epics`}>
                        <Chip
                            label={String(n)}
                            aria-label={`Fit ${n} epics across, centred on the active epics`}
                            onClick={() => onEpicsAcross?.(n)}
                            {...toolbarChipProps(false)}
                            sx={{ minWidth: 34 }}
                            data-testid={`pipeline-viz-epics-across-${n}`}
                        />
                    </Tooltip>
                ))}
            </Stack>

            <Divider orientation="vertical" flexItem
                     sx={{ mx: 0.5, flexShrink: 0 }} />

            {/* ── EPIC WIDTH (hidden — see `SHOW_EPIC_WIDTH`). Each number is the card's width in QUARTERS of
                the original card — 4 the original, 5 (the default) 25% wider,
                6 1.5x, 3 0.75x (`EPIC_WIDTH_RUNGS`). No caption, like its
                neighbours since req #3648; the tooltip says what a rung is.

                A RELAYOUT, DELIBERATELY NOT AN ACTION (req #3503 user
                directive: *"this will cause a re-layout so it is a
                [deliberate,] required UI option"*): every OTHER control on
                this row is a pure camera transform, so this one shows PRESSED
                like Colour and View do — a STATE the plan is currently laid
                out at, not a button that fired and forgot. */}
            {SHOW_EPIC_WIDTH && (<>
            <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
                   sx={{ flexShrink: 0 }}
                   data-testid="pipeline-viz-epicwidth-toggle">
                {EPIC_WIDTH_RUNGS.map((rung) => {
                    const on = epicWidthLevel === rung;
                    const label = rung === 4
                        ? 'Epic Width 4 — the original card width'
                        : `Epic Width ${rung} — ${rung}/4 of the original card width`
                            + `${rung > 4 ? `, ${(rung - 4) * 25}% wider` : ', 25% narrower'}`;
                    return (
                        <Tooltip key={rung} title={label}>
                            <Chip
                                label={String(rung)}
                                aria-label={label}
                                onClick={() => onChangeEpicWidthLevel?.(String(rung))}
                                {...toolbarChipProps(on)}
                                sx={{ minWidth: 28 }}
                                data-testid={`pipeline-viz-epicwidth-${rung}`}
                            />
                        </Tooltip>
                    );
                })}
            </Stack>

            <Divider orientation="vertical" flexItem
                     sx={{ mx: 0.5, flexShrink: 0 }} />
            </>)}

            {/* ── VIEW GROUP — how much of the plan the reader is looking at ──
                FOLLOWS the colour group since req #3648 (user directive: swap
                "color" and "view"). Within the group the order is still req
                #3242's user directive: Reset sits immediately LEFT of the
                level selector "ahead of the whole zoom/layout control cluster
                rather than trailing it". Req #3261 P2 named the groups in the
                opposite order, against a row that also still had a Counts
                toggle; #3242 removed that toggle and fixed this position, and it
                is the later and more specific instruction. What P2 asked for —
                that there BE groups, and that a rule separate them — is what is
                applied here.

                THE SHARED COMPONENT, not a header-shaped copy of it — req #3168
                extracted it from the Build Visualizer precisely so two canvases
                doing semantic zoom cannot drift, and the Build Visualizer
                renders it in ITS header among chips too. `testIdPrefix` keeps
                every `pipeline-viz-level-*` hook byte-for-byte.

                Reset (labelled "Default" since req #3648) rides INSIDE it as
                `leadingChildren` (req #3242) so the group reads "Default Auto
                L1 L2 L3" as one control set. It is
                deliberately NOT in this file's chip vocabulary: the user asked
                for its own colour, as border + label only, "so this is a
                different KIND of control" is legible at a glance — it performs
                an action and is never part of the pinned-level state. That is a
                later and explicit instruction than S6, and S6's point (one
                widget TYPE, so the row reads as one control set) is unaffected
                by it — it is still a small Chip.

                Reset's behaviour: FACTORY DEFAULT — one click always shows the
                whole plan's vertical extent, from any pan or zoom. Since req
                #3312 that is ALSO the view the page opens on, so Reset means
                "back to where this plan started" rather than a second base view
                the landing had to be told about: it and Width's recentre apply
                one expression (`kFactoryDefault` in PipelinePlanVisualizer.jsx),
                and the ref that used to pick between two scales is gone. What
                the control still adds over the landing is the INTENT — it ends
                any `?initiative=` re-fit, exactly as a drag does.

                No `data-viz-chrome` here, unlike in the key: that attribute
                exempts a control from the canvas's two gesture filters, and
                those are bound to the canvas container. This row is outside it,
                so a mousedown here was never reachable as a pan gesture. */}
            <Box sx={{ display: 'flex', flexShrink: 0 }}>
                <SemanticLevelControl
                    // The page holds the pref as the CANVAS's vocabulary
                    // ('auto'|'1'|'2'|'3') and the reported level as the
                    // canvas's OTHER vocabulary ('out'|'mid'|'in'); the shared
                    // control speaks `null | 1 | 2 | 3` and is deliberately
                    // ignorant of what a level MEANS. Both translations happen
                    // here, which is the only place that knows both.
                    pinnedLevel={planLevelPref === 'auto'
                        ? null : Number(planLevelPref)}
                    effectiveLevel={PLAN_LEVEL_NUMBER[effectiveLevel] ?? null}
                    onChangePinnedLevel={(lvl) => onChangeLevelPref(
                        lvl == null ? 'auto' : String(lvl))}
                    // req #3242 user directive — "Detail:" -> "View"; req #3648
                    // user directive — no caption at all.
                    label={null}
                    leadingChildren={(
                        // RESET TOUCHES NO CHIP IN THIS GROUP (req #3324). Between
                        // req #3310 and #3324 it cleared the pinned level, and the
                        // label had to say so — a control that silently un-pins a
                        // chip immediately to its right is a surprise however right
                        // the behaviour is. The level is fixed until Auto is chosen
                        // now, so Reset is exactly what Width and Colour already
                        // were to it: unrelated. Its label says camera and nothing
                        // else.
                        <Tooltip title={RESET_LABEL}>
                            <Chip
                                label="Default"
                                size="small"
                                variant="outlined"
                                // EXPLICIT, though the tooltip happens to start
                                // with the visible word. Relying on that would
                                // make the wording of a tooltip load-bearing for
                                // WCAG 2.5.3 with nothing saying so: rewrite it
                                // as "Zoom out to the whole plan" and this chip
                                // silently displays "Reset" while announcing a
                                // sentence that never says it. ONE constant now,
                                // so the visible and announced wordings cannot
                                // drift apart the next time either is edited.
                                aria-label={RESET_LABEL}
                                onClick={onResetView}
                                sx={{
                                    borderColor: 'secondary.main',
                                    color: 'secondary.main',
                                    cursor: 'pointer',
                                }}
                                data-testid="pipeline-viz-reset"
                            />
                        </Tooltip>
                    )}
                    testIdPrefix="pipeline-viz"
                />
            </Box>

        </>
    );
}
