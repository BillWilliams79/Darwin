// PlanEngineBox.jsx — the plan view's engine control and launch line (req
// #3762), an Action Popup (req #3935: it was a strip pinned to the canvas's
// bottom-right corner; now it is the Active box's kind of window).
//
// Three rows:
//   1. THE SWITCH for this plan's engine on this machine (desired_state, R6),
//      the machine, and what the supervisor and the heartbeat say back — so
//      switching it on, the reader watches it come up.
//   2. WHERE THE NUMBERS COME FROM — the engine's cycle, or a prediction —
//      and the limits the cut is made against: ceiling, live, reserved, free.
//   3. THE LAUNCH QUEUE in order, each launch with the machine it runs on,
//      and the cut line drawn where the slots run out.
//
// ── AN ACTION POPUP ────────────────────────────────────────────────────────
// Floating, docking, reshaping, collapsing and racking onto the navbar are
// AnchoredPanel's (pattern doc memory/anchored-collapse-pattern.md), as the
// Active box's are. The head is every Action Popup's: the ▾, then the badge
// slot — a power badge in the engine's health colour, so folded it still says
// whether the engine is on — then the title. Home is the viewport's
// bottom-right, where the strip sat (req #3824: the Active box opens
// bottom-left). Where it sits, its shape and whether it is open are remembered
// per browser (usePlanEngineBoxStore). Viewport-fixed, so it stays with the
// plan when the canvas is maximized; mounted OUTSIDE the canvas pane, so
// d3-zoom never sees its pointer or wheel.

import { Fragment, memo } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';

import AnchoredPanel from '../../Components/AnchoredPanel/AnchoredPanel';
import { ActionPopupBadge } from '../../Components/AnchoredPanel/ActionPopupHead';
import { validDock } from '../../Components/AnchoredPanel/anchoredPanelGeometry';
import {
    ACTION_POPUP_COLORS, ACTION_POPUP_FONT_PX, ACTION_POPUP_HEAD_PX, ACTION_POPUP_SX,
} from '../../Components/AnchoredPanel/actionPopupChrome';
import { usePlanEngineBoxStore } from '../../stores/usePlanEngineBoxStore';
import { humanDuration } from '../pipelines/orchestrationHolder';
import { machineName } from './EngineLocationPanel';
import { agoText, stampText } from './engineModel';
import { SOURCE_ENGINE } from './engineOverlay';
import {
    ACTUAL_STATE_WORDS, HEALTH_COLORS, HEALTH_MISSING, HEALTH_STOPPED, HEALTH_WORDS, codeColor,
    codeLabel, epicName, plainWords,
} from './engineVocabulary';
import { CUT_RED, launchMachineText } from './PlanEngineBadge';

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';
const TEXT = '#d7e3f4';
const DIM = '#9fb0c8';
const ON_GREEN = '#4ade80';

/** Smallest panel the edges will shape, px: the switch and the machine. */
export const ENGINE_MIN_W = 240;
export const ENGINE_MIN_H = 64;
/** Content-sized, the panel is as wide as its rows, up to this, px. */
export const ENGINE_AUTO_MAX_W = 640;
const LIMITS = { minW: ENGINE_MIN_W, minH: ENGINE_MIN_H, autoMaxW: ENGINE_AUTO_MAX_W,
    headPx: ACTION_POPUP_HEAD_PX, fitMinW: ENGINE_MIN_W };
/** Home: the viewport's bottom-right, where the strip sat (req #3824), sized
 *  to its content on both axes until reshaped. */
export const ENGINE_HOME = Object.freeze({ h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null });

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

function SourceText({ ctl, overlay, timezone }) {
    if (!overlay) return null;
    if (overlay.source === SOURCE_ENGINE) {
        return (
            <span data-testid="plan-engine-source" data-source="engine" data-seq={overlay.seq}>
                Engine cycle {overlay.seq} · {stampText(overlay.now, timezone)}
            </span>
        );
    }
    return (
        <span data-testid="plan-engine-source" data-source="predicted">
            {ctl.engineOn
                ? 'Switched on — predicted until the engine publishes its first cycle'
                : 'Predicted — what the engine would launch if switched on now'}
        </span>
    );
}

function LimitsText({ overlay }) {
    if (!overlay) return null;
    if (!overlay.limitsKnown) {
        return (
            <Typography component="span" variant="caption" sx={{ color: CUT_RED }}
                        data-testid="plan-engine-limits-unknown">
                Capacity unknown — the ceiling or the live count could not be read, so nothing is admitted.
            </Typography>
        );
    }
    const l = overlay.limits;
    return (
        <Box component="span" sx={{ display: 'inline-flex', gap: 1.25, flexWrap: 'wrap' }}
             data-testid="plan-engine-limits">
            {['ceiling', 'live', 'reserved', 'free'].map((k) => (
                <span key={k} data-testid={`plan-engine-limit-${k}`}>{k} <b>{l[k]}</b></span>
            ))}
            {l.share != null && l.share !== l.free ? (
                <Tooltip disableInteractive
                         title="Engines on one machine share its free slots: a slot goes to the engine with work waiting that holds fewest (req #3807).">
                    <span data-testid="plan-engine-limit-share">
                        this plan&apos;s share <b>{l.share}</b> — {l.free - l.share} owed to other engines
                    </span>
                </Tooltip>
            ) : null}
        </Box>
    );
}

function cutSentence(overlay) {
    if (!overlay) return '';
    if (!overlay.queue.length) return 'nothing queued';
    if (!overlay.cutShown) return 'every queued launch has a slot';
    if (overlay.cut === 0) return 'no free slot — the slots run out before #1';
    return `the slots run out after #${overlay.cut}`;
}

function QueueChip({ item, machines, overlay }) {
    const color = codeColor(item.code);
    const outlined = item.belowCut;
    return (
        <Tooltip disableInteractive
                 title={`#${item.requirementId} on ${epicName(item.epicId, overlay.names)} — ${codeLabel(item.code)}: `
                     + `${plainWords(item.code)}${item.detail ? ` — ${item.detail}` : ''}`
                     + ` · runs on ${launchMachineText(machines, item.machineId)}`
                     + (item.outcome ? ` · executor: ${item.outcome.state}` : '')}>
            <Box component="li" data-testid={`plan-engine-queue-item-${item.requirementId}`}
                 data-code={item.code} data-position={item.position}
                 data-epic={item.epicId} data-machine={item.machineId ?? ''}
                 data-below-cut={item.belowCut ? 'true' : 'false'}
                 sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                       px: '6px', height: 20, borderRadius: '999px', fontFamily: MONO, fontSize: 11,
                       bgcolor: outlined ? 'transparent' : color, color: outlined ? color : '#000',
                       border: `1.5px solid ${color}`,
                       opacity: overlay.source === SOURCE_ENGINE || !outlined ? 1 : 0.9 }}>
                <b>{item.position}</b>
                <span>#{item.requirementId}</span>
                <span style={{ opacity: 0.8 }}>· {launchMachineText(machines, item.machineId)}</span>
            </Box>
        </Tooltip>
    );
}

/**
 * @param {Object} props
 * @param {Object} props.ctl           usePlanEngineOverlay's control
 * @param {Map} props.machines         machine id -> row
 * @param {function} props.onPickMachine  (id | null)
 * @param {string} [props.timezone]
 */
function PlanEngineBox({ ctl, machines, onPickMachine, timezone }) {
    const open = usePlanEngineBoxStore(s => s.open);
    const storedDock = usePlanEngineBoxStore(s => s.dock);
    const { toggleOpen, setDock } = usePlanEngineBoxStore.getState();
    const dock = validDock(storedDock, ENGINE_MIN_W, ENGINE_MIN_H) || ENGINE_HOME;
    const { overlay, engine } = ctl;
    const desired = engine ? engine.state.desired_state : 'off';
    const health = engine ? engine.health : HEALTH_STOPPED;
    const noMachine = ctl.machineId == null;
    const stateText = engineStateText(engine);
    const switchLabel = ctl.pending
        ? (ctl.pending === 'on' ? 'Switching on…' : 'Switching off…')
        : ctl.engineOn ? 'Engine on' : 'Engine off';
    return (
        <AnchoredPanel dock={dock} onDockChange={setDock}
                       open={open} onToggle={toggleOpen}
                       name="Engine" testid="plan-engine-box" rackId="engine"
                       rackIcon={PowerSettingsNewIcon} rackIconLabel={`Engine — ${stateText}\nClick to expand`}
                       limits={LIMITS} fontPx={ACTION_POPUP_FONT_PX} colors={ACTION_POPUP_COLORS}
                       sx={ACTION_POPUP_SX}
                       extras={
                           // Folded, the badge is what says the engine is on.
                           <ActionPopupBadge testid="plan-engine-box-power" title={stateText}
                                             fill={ctl.engineOn ? (HEALTH_COLORS[health] || ON_GREEN) : '#26374f'}
                                             text={ctl.engineOn ? '#000' : DIM}>
                               <PowerSettingsNewIcon sx={{ fontSize: '1em' }} />
                           </ActionPopupBadge>
                       }>
            {() => (
                <Box data-testid="plan-engine-strip"
                     data-source={overlay ? overlay.source : ''}
                     data-desired={desired}
                     data-actual={engine ? engine.state.actual_state : ''}
                     data-health={health}
                     sx={{ px: '0.7em', py: '0.3em', color: TEXT, fontSize: 12, userSelect: 'text' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Tooltip title={noMachine
                            ? 'Pick the machine this browser is on first'
                            : `Switch this plan's engine on ${machineName(ctl.machine, ctl.machineId)} `
                                + (ctl.engineOn ? 'off' : 'on')}>
                            <span>
                                <Button size="small" variant={ctl.engineOn ? 'contained' : 'outlined'}
                                        onClick={ctl.toggle}
                                        disabled={!!ctl.pending || noMachine}
                                        startIcon={<PowerSettingsNewIcon fontSize="small" />}
                                        aria-pressed={ctl.engineOn}
                                        data-testid="plan-engine-switch"
                                        data-on={ctl.engineOn ? 'true' : 'false'}
                                        sx={{ textTransform: 'none', fontWeight: 700, py: 0, minHeight: 26,
                                              ...(ctl.engineOn
                                                  ? { bgcolor: ON_GREEN, color: '#000', '&:hover': { bgcolor: '#22c55e' } }
                                                  : { color: TEXT, borderColor: DIM }) }}>
                                    {switchLabel}
                                </Button>
                            </span>
                        </Tooltip>
                        {ctl.machineResolved && ctl.openMachines.length <= 1 ? (
                            <Typography variant="caption" sx={{ color: DIM }} data-testid="plan-engine-machine">
                                on {machineName(ctl.machine, ctl.machineId)}
                            </Typography>
                        ) : (
                            <Select size="small" variant="standard" value={ctl.machineId ?? ''}
                                    displayEmpty
                                    onChange={(e) => onPickMachine(e.target.value === '' ? null : Number(e.target.value))}
                                    inputProps={{ 'aria-label': 'This machine', 'data-testid': 'plan-engine-machine-select' }}
                                    data-testid="plan-engine-machine"
                                    sx={{ fontSize: 12, color: TEXT, '& .MuiSelect-icon': { color: DIM } }}>
                                {noMachine && <MenuItem value="">pick this machine</MenuItem>}
                                {ctl.openMachines.map((m) => (
                                    <MenuItem key={m.id} value={m.id}>on {machineName(m, m.id)}</MenuItem>
                                ))}
                            </Select>
                        )}
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                            <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%',
                                                        bgcolor: HEALTH_COLORS[health] }} />
                            <Typography variant="caption" data-testid="plan-engine-state">
                                {stateText}
                            </Typography>
                        </Box>
                    </Box>

                    {ctl.error && (
                        <Alert severity="error" variant="outlined" sx={{ mt: 0.5, py: 0, color: TEXT }}
                               data-testid="plan-engine-error">
                            The engine switch failed: {ctl.error}
                        </Alert>
                    )}
                    {ctl.readErrors.length > 0 && (
                        <Typography variant="caption" component="div" sx={{ color: CUT_RED, mt: 0.25 }}
                                    data-testid="plan-engine-read-error">
                            Could not read {ctl.readErrors.join(', ')} — the rows below may be out of date.
                        </Typography>
                    )}

                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap', mt: 0.5,
                               color: DIM, fontSize: 12 }}>
                        {overlay ? <SourceText ctl={ctl} overlay={overlay} timezone={timezone} /> : (
                            <span data-testid="plan-engine-source" data-source="">
                                {noMachine ? 'Pick this machine to see the launch order'
                                    : ctl.recordError ? 'The engine\'s decision record failed to load'
                                        : 'Reading the launch order…'}
                            </span>
                        )}
                        {overlay && !overlay.ok && (
                            <Tooltip title={plainWords('ENGINE_HOLD')}>
                                <Box component="span" sx={{ color: CUT_RED, fontWeight: 700 }}
                                     data-testid="plan-engine-verdict">
                                    {overlay.verdict}{overlay.verdictDetail ? ` — ${overlay.verdictDetail}` : ''}
                                </Box>
                            </Tooltip>
                        )}
                        <LimitsText overlay={overlay} />
                        {overlay && (
                            <span data-testid="plan-engine-cut-text">{cutSentence(overlay)}</span>
                        )}
                    </Box>
                    {overlay && overlay.queue.length > 0 && (
                        // Wraps rather than scrolls sideways: the reader shapes the
                        // window, and its body scrolls down.
                        <Box component="ol" data-testid="plan-engine-queue"
                             sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', rowGap: 0.5,
                                   listStyle: 'none', p: 0, m: 0, mt: 0.5, pb: 0.25 }}>
                            {overlay.queue.map((item) => (
                                <Fragment key={`${item.requirementId}-${item.index}`}>
                                    {overlay.cutShown && item.index === overlay.cut && (
                                        <Box component="li" role="separator" data-testid="plan-engine-cut"
                                             data-cut={overlay.cut}
                                             title="the slots run out here"
                                             sx={{ alignSelf: 'stretch', flexShrink: 0, mx: 0.5,
                                                   borderLeft: `2px dashed ${CUT_RED}`,
                                                   display: 'flex', alignItems: 'center', pl: 0.5,
                                                   color: CUT_RED, fontSize: 11, fontWeight: 700,
                                                   whiteSpace: 'nowrap' }}>
                                            cut
                                        </Box>
                                    )}
                                    <QueueChip item={item} machines={machines} overlay={overlay} />
                                </Fragment>
                            ))}
                        </Box>
                    )}
                </Box>
            )}
        </AnchoredPanel>
    );
}

// The visualizer re-renders on every zoom frame; the box need not.
export default memo(PlanEngineBox);
