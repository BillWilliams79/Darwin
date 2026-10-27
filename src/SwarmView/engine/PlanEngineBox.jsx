// PlanEngineBox.jsx — the plan view's engine control (req #3762), an Action
// Popup (req #3935), cut to three facts by req #3981 ("its a single pipeline on
// your machine … just on off and report role"):
//
//   ON / OFF  — the switch for this plan's engine on this machine (desired_state,
//               R6). Switched on, the engine claims the plan and LEADS it when no
//               other machine does; otherwise it joins as a subscriber (req
//               #3678). Nothing to choose: the role is derived, never picked.
//   ROLE      — Primary (lead) or Secondary (subscriber), from the engine's own
//               record or heartbeat; nothing at all while it holds no role.
//   SLOTS     — slots taken / capacity on this machine: live + reserved against
//               machines.max_live_sessions, as the record's limits state them.
//
// What the engine is doing is still told in full where it is asked: the hover
// on the switch (its state sentence), the epic badges on the canvas (queue,
// cut, holds) and /swarm/engines. Open, the head reads ENGINE alone; folded,
// the switch moves into the head's badge slot as a power button and the slots
// follow the title (req #3981). There is no machine picker: the machine is the
// browser's own, or the link's `?engineMachine=`.
//
// ── AN ACTION POPUP ────────────────────────────────────────────────────────
// Floating, docking, reshaping, collapsing and racking onto the navbar are
// AnchoredPanel's (pattern doc memory/anchored-collapse-pattern.md). Home is
// the viewport's bottom-right (req #3824). Where it sits, its shape and whether
// it is open are remembered per browser (usePlanEngineBoxStore).

import { memo } from 'react';

import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';

import AnchoredPanel from '../../Components/AnchoredPanel/AnchoredPanel';
import { validDock } from '../../Components/AnchoredPanel/anchoredPanelGeometry';
import {
    ACTION_POPUP_BADGE_EM, ACTION_POPUP_COLORS, ACTION_POPUP_FONT_PX, ACTION_POPUP_HEAD_PX, ACTION_POPUP_MONO,
    ACTION_POPUP_SX,
} from '../../Components/AnchoredPanel/actionPopupChrome';
import { usePlanEngineBoxStore } from '../../stores/usePlanEngineBoxStore';
import { ROLE_LEAD, ROLE_REFUSED, ROLE_SUBSCRIBER, humanDuration } from '../pipelines/orchestrationHolder';
import { machineName } from './EngineLocationPanel';
import { agoText } from './engineModel';
import {
    ACTUAL_STATE_WORDS, HEALTH_COLORS, HEALTH_DEGRADED, HEALTH_MISSING, HEALTH_OK, HEALTH_STOPPED,
    HEALTH_WORDS,
} from './engineVocabulary';
import { SOURCE_ENGINE } from './engineOverlay';
import { CUT_RED } from './PlanEngineBadge';

const TEXT = '#d7e3f4';
const DIM = '#7f90a8';
const TRACK = '#26374f';
const ON_GREEN = '#4ade80';

/** Smallest panel the edges will shape, px: the switch, the role, the slots. */
export const ENGINE_MIN_W = 200;
export const ENGINE_MIN_H = 64;
/** Content-sized, the panel is as wide as its row, up to this, px. */
export const ENGINE_AUTO_MAX_W = 360;
const LIMITS = { minW: ENGINE_MIN_W, minH: ENGINE_MIN_H, autoMaxW: ENGINE_AUTO_MAX_W,
    headPx: ACTION_POPUP_HEAD_PX, fitMinW: ENGINE_MIN_W };
/** Home: the viewport's bottom-right (req #3824), sized to its content on both
 *  axes until reshaped. */
export const ENGINE_HOME = Object.freeze({ h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null });

/** The role, as the reader names it (req #3981): lead and subscriber are the
 *  role rule's words (req #3678); anything else is no role, and shows nothing. */
export const ROLE_WORDS = { [ROLE_LEAD]: 'Primary', [ROLE_SUBSCRIBER]: 'Secondary' };
const ROLE_COLORS = { [ROLE_LEAD]: '#7bb8de', [ROLE_SUBSCRIBER]: '#c4a7ff' };
/** An engine that runs but launches nothing — a HOLD verdict, or a refused
 *  role — wears this on its switch rather than a healthy green. */
const HOLD_AMBER = '#fcd34d';
/** Past this many slots the meter is a bar rather than one pip per slot. */
const MAX_PIPS = 12;

/** What the switch and the supervisor say, in one phrase. */
export function engineStateText(engine) {
    if (!engine) return 'off — never switched on for this plan on this machine';
    const { desired_state: desired, actual_state: actual, actual_detail: detail } = engine.state;
    const actualWords = ACTUAL_STATE_WORDS[actual] || actual;
    if (desired === 'off') {
        if (actual === 'stopped') return 'off — stopped';
        return `switched off — the supervisor reports ${actualWords}`;
    }
    if (actual === 'crashed') return `on — crashed${detail ? `: ${detail}` : ''}`;
    if (engine.health === HEALTH_MISSING) {
        return engine.beatAgeSeconds != null
            ? `on — ${actualWords}, but no heartbeat for ${humanDuration(engine.beatAgeSeconds)}`
            : `on — ${actualWords}, no heartbeat yet`;
    }
    if (actual === 'running') {
        return `on — running, ${HEALTH_WORDS[engine.health]} (${agoText(engine.beatAgeSeconds)})`;
    }
    return `on — ${actualWords}`;
}

/** The role the engine REPORTS — never a prediction: its own record's, else
 *  the heartbeat of an engine beating now. Anything else is no role. */
export function engineRole(ctl) {
    if (!ctl.engineOn) return null;
    const { overlay, engine } = ctl;
    let role = overlay && overlay.source === SOURCE_ENGINE ? overlay.role : null;
    if (!role && engine && engine.beat && (engine.health === HEALTH_OK || engine.health === HEALTH_DEGRADED)) {
        role = engine.beat.role;
    }
    return role || null;
}

const counted = (l) => !!l && Number.isInteger(l.ceiling) && Number.isInteger(l.live);
const takenOf = (l) => ({ known: true, taken: l.live + (l.reserved || 0), ceiling: l.ceiling });

/**
 * Slots taken (live + reserved) of the machine's ceiling, as the ENGINE
 * reports them — never a prediction (req #3981: switched off, it holds no
 * slots, so the popup shows none). null = off, draw nothing; `{ loading }` =
 * on, nothing reported yet; `{ known: false }` = it could not count, or a read
 * failed.
 */
export function slotsOf(ctl) {
    if (!ctl.engineOn) return null;
    const { overlay, engine } = ctl;
    if (overlay && overlay.source === SOURCE_ENGINE) {
        return overlay.limitsKnown ? takenOf(overlay.limits) : { known: false };
    }
    // Its record not loaded yet: a beating engine's heartbeat carries them too.
    const beating = engine && (engine.health === HEALTH_OK || engine.health === HEALTH_DEGRADED);
    const beatLimits = beating && engine.healthJson ? engine.healthJson.limits : null;
    if (counted(beatLimits)) return takenOf(beatLimits);
    // On but silent (no supervisor, no beat), or a read failed: it cannot say.
    if (ctl.readErrors.length > 0 || ctl.recordError
        || (engine && (engine.health === HEALTH_MISSING || engine.health === HEALTH_STOPPED))) {
        return { known: false };
    }
    return { loading: true };
}

/** `numbers` false = the pips alone (the folded head, req #3981: no "1/8"
 *  there); nothing at all until the engine has counted. */
function SlotMeter({ slots, testid = 'plan-engine-slots', numbers = true }) {
    if (!slots) return null;
    if (!numbers && !slots.known) return null;
    if (slots.loading) {
        return (
            <Box component="span" data-testid={testid} data-known="loading"
                 sx={{ color: DIM }}>…/…</Box>
        );
    }
    if (!slots.known) {
        return (
            <Tooltip disableInteractive
                     title="Capacity unknown — the ceiling or the live count could not be read, so nothing is admitted.">
                <Box component="span" data-testid={testid} data-known="false"
                     sx={{ color: CUT_RED, fontWeight: 700 }}>?/?</Box>
            </Tooltip>
        );
    }
    const { taken, ceiling } = slots;
    const full = taken >= ceiling;
    const fill = full ? CUT_RED : ON_GREEN;
    const pips = ceiling > 0 && ceiling <= MAX_PIPS;
    return (
        <Tooltip disableInteractive
                 title={`${taken} of ${ceiling} session slots on this machine taken (live + reserved)`}>
            <Box component="span" data-testid={testid} data-known="true"
                 data-taken={taken} data-ceiling={ceiling}
                 sx={{ display: 'inline-flex', alignItems: 'center', gap: '0.5em' }}>
                <Box component="span" aria-hidden="true"
                     sx={{ display: 'inline-flex', gap: '2px', alignItems: 'center' }}>
                    {pips ? Array.from({ length: ceiling }, (_, i) => (
                        <Box key={i} component="span"
                             sx={{ width: 5, height: 12, borderRadius: '1.5px',
                                   bgcolor: i < taken ? fill : TRACK }} />
                    )) : (
                        <Box component="span" sx={{ width: 60, height: 6, borderRadius: 3, bgcolor: TRACK,
                                                    overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', bgcolor: fill,
                                       width: `${ceiling > 0 ? Math.min(100, (100 * taken) / ceiling) : 0}%` }} />
                        </Box>
                    )}
                </Box>
                {numbers && (
                    <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        <Box component="span" sx={{ color: TEXT, fontWeight: 700 }}>{taken}</Box>
                        <Box component="span" sx={{ color: DIM }}>/{ceiling}</Box>
                    </Box>
                )}
            </Box>
        </Tooltip>
    );
}

/** Folded, the head's power button (req #3981): the same switch as the body's
 *  ON / OFF, a circle beside the title. A real <button>, so pressing it never
 *  starts a move of the popup (AnchoredPanel skips buttons). */
function HeadPowerButton({ ctl, lit, color, faulted, tip, disabled }) {
    return (
        <Tooltip disableInteractive title={<span style={{ whiteSpace: 'pre-line' }}>{tip}</span>}>
            <span style={{ display: 'inline-flex' }}>
                {/* Not `disabled`: a disabled ButtonBase lets presses fall
                    through to the head, where they would move the popup. */}
                <ButtonBase onClick={disabled ? undefined : ctl.toggle} aria-disabled={disabled}
                            aria-pressed={lit} aria-label={`Engine ${lit ? 'on' : 'off'} — switch ${lit ? 'off' : 'on'}`}
                            data-testid="plan-engine-box-power"
                            data-on={lit ? 'true' : 'false'}
                            data-pending={ctl.pending || ''}
                            sx={{ width: ACTION_POPUP_BADGE_EM, height: ACTION_POPUP_BADGE_EM, borderRadius: '50%',
                                  boxSizing: 'border-box',
                                  border: `1.5px solid ${faulted ? CUT_RED : lit ? color : DIM}`,
                                  bgcolor: lit ? color : 'transparent', color: lit ? '#000' : TEXT,
                                  boxShadow: lit ? `0 0 8px ${color}66` : 'none',
                                  transition: 'background-color 160ms, box-shadow 160ms',
                                  ...(ctl.pending && { animation: 'planEnginePulse 0.9s ease-in-out infinite alternate',
                                      '@keyframes planEnginePulse': { from: { opacity: 1 }, to: { opacity: 0.35 } } }),
                                  '&:hover': { borderColor: lit ? color : TEXT },
                                  ...(disabled && { opacity: 0.55, cursor: 'default' }) }}>
                    <PowerSettingsNewIcon sx={{ fontSize: '0.95em' }} />
                </ButtonBase>
            </span>
        </Tooltip>
    );
}

/**
 * @param {Object} props
 * @param {Object} props.ctl           usePlanEngineOverlay's control
 */
function PlanEngineBox({ ctl }) {
    const open = usePlanEngineBoxStore(s => s.open);
    const storedDock = usePlanEngineBoxStore(s => s.dock);
    const { toggleOpen, setDock } = usePlanEngineBoxStore.getState();
    const dock = validDock(storedDock, ENGINE_MIN_W, ENGINE_MIN_H) || ENGINE_HOME;
    const { overlay, engine } = ctl;
    const desired = engine ? engine.state.desired_state : 'off';
    const health = engine ? engine.health : HEALTH_STOPPED;
    const noMachine = ctl.machineId == null;
    const stateText = engineStateText(engine);
    const role = engineRole(ctl);
    const slots = slotsOf(ctl);
    // On, the switch wears the engine's health: green beating, amber when its
    // cycles fail or it holds (a HOLD verdict, a refused role), red when
    // silent — the one place the popup says how it is.
    const holding = health === HEALTH_OK && ((overlay && overlay.source === SOURCE_ENGINE && !overlay.ok)
        || role === ROLE_REFUSED);
    const onColor = holding ? HOLD_AMBER
        : HEALTH_COLORS[health] && health !== HEALTH_STOPPED ? HEALTH_COLORS[health] : ON_GREEN;
    // A read that failed, or a switch that failed: the switch's outline goes red
    // and its hover says which — the rows may be out of date.
    const readErrors = [...ctl.readErrors, ...(ctl.recordError ? ["the engine's decision record"] : [])];
    const faulted = !!ctl.error || readErrors.length > 0;
    const lit = ctl.engineOn;
    const label = ctl.pending ? (ctl.pending === 'on' ? 'ON…' : 'OFF…') : lit ? 'ON' : 'OFF';
    const where = noMachine ? null : machineName(ctl.machine, ctl.machineId);
    const switchTip = [
        ctl.error && `The engine switch failed: ${ctl.error}`,
        readErrors.length > 0 && `Could not read ${readErrors.join(', ')} — this may be out of date.`,
        noMachine ? 'This browser cannot tell which machine it is on — open the plan with ?engineMachine=<machine id>'
            : `${stateText}${holding && overlay && !overlay.ok ? ` — holding: ${overlay.verdict}` : ''}`
                + (holding && role === ROLE_REFUSED ? ' — refused: another engine on this machine holds this plan' : '')
                + `\nOrchestrate this plan on ${where} — click to switch ${lit ? 'off' : 'on'}`,
    ].filter(Boolean).join('\n');
    return (
        <AnchoredPanel dock={dock} onDockChange={setDock}
                       open={open} onToggle={toggleOpen}
                       name="Engine" testid="plan-engine-box" rackId="engine"
                       rackIcon={PowerSettingsNewIcon} rackIconLabel={`Engine — ${stateText}\nClick to expand`}
                       limits={LIMITS} fontPx={ACTION_POPUP_FONT_PX} colors={ACTION_POPUP_COLORS}
                       sx={ACTION_POPUP_SX}
                       // Folded, the switch rides the head beside the title;
                       // open, it is the body's ON / OFF alone.
                       extras={open ? null : (
                           <HeadPowerButton ctl={ctl} lit={lit} color={onColor} faulted={faulted}
                                            tip={switchTip} disabled={!!ctl.pending || noMachine} />
                       )}
                       // …and the slots' pips right after the title, no "1/8".
                       actions={open || !slots ? null : (
                           <SlotMeter slots={slots} testid="plan-engine-box-slots" numbers={false} />
                       )}>
            {() => (
                <Box data-testid="plan-engine-strip"
                     data-source={overlay ? overlay.source : ''}
                     data-seq={overlay && overlay.seq != null ? overlay.seq : ''}
                     data-desired={desired}
                     data-actual={engine ? engine.state.actual_state : ''}
                     data-health={health}
                     data-role={role || ''}
                     sx={{ display: 'flex', alignItems: 'center', gap: '0.9em', flexWrap: 'wrap',
                           px: '0.7em', py: '0.45em', color: TEXT, fontFamily: ACTION_POPUP_MONO,
                           fontSize: 12, userSelect: 'none' }}>
                    <Tooltip disableInteractive title={<span style={{ whiteSpace: 'pre-line' }}>{switchTip}</span>}>
                        <span>
                            <ButtonBase onClick={ctl.toggle}
                                        disabled={!!ctl.pending || noMachine}
                                        aria-pressed={lit}
                                        aria-label={`Engine ${lit ? 'on' : 'off'}`}
                                        data-testid="plan-engine-switch"
                                        data-on={lit ? 'true' : 'false'}
                                        data-fault={faulted ? 'true' : 'false'}
                                        sx={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em',
                                              height: 24, minWidth: 64, px: '0.75em', borderRadius: 12,
                                              fontFamily: ACTION_POPUP_MONO, fontSize: 12, fontWeight: 800,
                                              letterSpacing: '0.08em',
                                              border: `1.5px solid ${faulted ? CUT_RED : lit ? onColor : DIM}`,
                                              bgcolor: lit ? onColor : 'transparent',
                                              color: lit ? '#000' : TEXT,
                                              boxShadow: lit && health === HEALTH_OK ? `0 0 10px ${onColor}66` : 'none',
                                              transition: 'background-color 160ms, box-shadow 160ms, border-color 160ms',
                                              '&:hover': { borderColor: lit ? onColor : TEXT },
                                              '&.Mui-disabled': { opacity: 0.55 } }}>
                                <PowerSettingsNewIcon sx={{ fontSize: 14 }} />
                                {label}
                            </ButtonBase>
                        </span>
                    </Tooltip>

                    {ROLE_WORDS[role] ? (
                        <Box component="span" data-testid="plan-engine-role" data-role={role}
                             sx={{ color: ROLE_COLORS[role], fontWeight: 800, letterSpacing: '0.1em',
                                   textTransform: 'uppercase', fontSize: 11 }}>
                            {ROLE_WORDS[role]}
                        </Box>
                    ) : null}

                    <Box sx={{ ml: 'auto' }}>
                        <SlotMeter slots={slots} />
                    </Box>
                </Box>
            )}
        </AnchoredPanel>
    );
}

// The visualizer re-renders on every zoom frame; the box need not.
export default memo(PlanEngineBox);
