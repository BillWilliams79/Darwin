// PlanEngineBadge.jsx — one epic's place in the engine's launch order, on its
// card in the plan view (req #3762).
//
// THE NUMBERS ARE THE RECORD'S. A badge reads the queue positions of the
// epic's launches (`1`, `2,3`, `4–6`) exactly as the engine view numbers its
// queue, so the two pages cannot disagree; an epic with no launch in the queue
// shows its hold's short label instead. Filled while its launches go now (or
// would), outlined once every one of them falls after the cut, and a red
// dashed edge where the cut itself lands. Hovering it gives the hold in the
// engine view's plain words, every launch with its machine, and where the
// slots run out — for every held epic, which is the requirement's ask.
//
// Geometry arrives in `style` (per pan/zoom frame, the badge layer's reason);
// the chrome stays in `sx`.

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { machineName } from './EngineLocationPanel';
import { SOURCE_PREDICTED } from './engineOverlay';
import { codeColor, codeLabel, plainWords } from './engineVocabulary';

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';
export const ENGINE_BADGE_H = 18;
export const CUT_RED = '#ff6b6b';

/** Where a launch runs, in words — null is a lead the claims cannot name. */
export function launchMachineText(machines, machineId) {
    if (machineId == null) return 'whichever machine leads';
    return machineName(machines.get(machineId), machineId);
}

function HoldText({ badge, overlay, machines, title }) {
    return (
        <Box data-testid={`plan-engine-hold-${badge.epicId}`} sx={{ maxWidth: 360 }}>
            <Typography variant="caption" component="div" sx={{ fontWeight: 700 }}>
                Epic {badge.epicId}{title ? ` · ${title}` : ''}
            </Typography>
            <Typography variant="body2" component="div" data-testid={`plan-engine-hold-words-${badge.epicId}`}>
                <b>{badge.label}</b> — {badge.words}{badge.detail ? ` — ${badge.detail}` : ''}
            </Typography>
            {badge.items.length > 0 && (
                <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, mt: 0.5 }}>
                    {badge.items.map((item) => (
                        <Box component="li" key={`${item.requirementId}-${item.index}`}>
                            {overlay.cutShown && item.index === overlay.cut && (
                                <Typography variant="caption" component="div"
                                            sx={{ color: CUT_RED, fontWeight: 700 }}>
                                    ┄ the slots run out here ┄
                                </Typography>
                            )}
                            <Typography variant="caption" component="div">
                                {item.position}. #{item.requirementId} · {codeLabel(item.code)}
                                {item.code !== badge.code || badge.items.length > 1
                                    ? ` — ${plainWords(item.code)}${item.detail ? ` — ${item.detail}` : ''}` : ''}
                                {` · runs on ${launchMachineText(machines, item.machineId)}`}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            )}
            <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.75 }}>
                {overlay.source === SOURCE_PREDICTED
                    ? 'Predicted — the engine is not publishing for this plan on this machine.'
                    : `From the engine's cycle ${overlay.seq}.`}
            </Typography>
        </Box>
    );
}

export default function PlanEngineBadge({ badge, overlay, machines, thisMachineId, title, style }) {
    const color = codeColor(badge.code);
    const outlined = badge.belowCut;
    // Launches that would run somewhere other than this machine name it.
    const away = [...new Set(badge.items.map((i) => i.machineId)
        .filter((m) => m != null && m !== thisMachineId))];
    return (
        <Tooltip disableInteractive placement="top-start"
                 title={<HoldText badge={badge} overlay={overlay} machines={machines} title={title} />}>
            <Box data-testid={`plan-engine-badge-${badge.epicId}`}
                 data-code={badge.code}
                 data-text={badge.text}
                 data-positions={badge.positions.join(',')}
                 data-below-cut={badge.belowCut ? 'true' : 'false'}
                 data-cut-before={badge.cutBefore ? 'true' : 'false'}
                 data-source={overlay.source}
                 aria-label={`Epic ${badge.epicId}: ${badge.label} — ${badge.words}`}
                 style={style}
                 sx={{
                     position: 'absolute',
                     pointerEvents: 'auto',
                     display: 'flex', alignItems: 'center', gap: '4px',
                     height: ENGINE_BADGE_H, px: '6px',
                     borderRadius: '999px',
                     fontFamily: MONO, fontSize: 11, fontWeight: 700, lineHeight: 1,
                     whiteSpace: 'nowrap',
                     bgcolor: outlined ? 'rgba(17, 27, 43, 0.92)' : color,
                     color: outlined ? color : '#000',
                     border: `1.5px solid ${color}`,
                     borderLeft: badge.cutBefore ? `3px dashed ${CUT_RED}` : `1.5px solid ${color}`,
                     boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                     cursor: 'default',
                 }}>
                {badge.text}
                {away.length > 0 && (
                    <Box component="span" sx={{ fontWeight: 400, opacity: 0.85 }}
                         data-testid={`plan-engine-badge-machine-${badge.epicId}`}>
                        → {away.map((m) => machineName(machines.get(m), m)).join(', ')}
                    </Box>
                )}
            </Box>
        </Tooltip>
    );
}
