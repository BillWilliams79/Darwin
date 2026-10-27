// EnginePanel.jsx — one engine, whole (req #3760): where it is, how it is, its
// limits, the decision it made and the cycles before it.
//
// FOLLOWING vs SCRUBBING. By default the panel follows the newest record, so a
// new cycle replaces the decision on screen as it arrives (the requirement's
// acceptance). Picking a cycle in the history strip pins THAT record until
// "Latest" is pressed — a reader looking back must not be yanked forward by
// the next poll.
//
// OFF. An engine whose desired state is off is drawn greyed with the time it
// stopped, still showing its last decision. MISSING. An engine wanted on with
// no fresh heartbeat says so BY AGE ("no heartbeat for 15m") — the row is
// still there; its silence is the fact.

import { useEffect, useMemo, useRef, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

import { humanDuration } from '../pipelines/orchestrationHolder';
import EngineDecisionPanel from './EngineDecisionPanel';
import EngineHealthPanel from './EngineHealthPanel';
import EngineHistoryStrip from './EngineHistoryStrip';
import EngineLimitsPanel from './EngineLimitsPanel';
import EngineLocationPanel, { machineName } from './EngineLocationPanel';
import {
    historyCells, missingAfter, outcomesByRequirement, parseUtc, recordChanges, recordView, scopeText,
    stampText,
} from './engineModel';
import { HEALTH_COLORS, HEALTH_MISSING, HEALTH_WORDS } from './engineVocabulary';
import { ToneChip } from './enginePanelParts';
import { useEngineRecord, useRequirementTitles } from './useEngineView';

export default function EnginePanel({ engine, names, timezone, now = new Date() }) {
    const [pinnedId, setPinnedId] = useState(null);
    // Set when retention deleted the cycle a reader had pinned: the panel goes
    // back to following and says why, rather than jumping silently.
    const [agedOut, setAgedOut] = useState(false);
    const cells = useMemo(() => historyCells(engine.history), [engine.history]);
    const pinnedStillStored = pinnedId != null && cells.some((c) => c.id === pinnedId);
    const following = !pinnedStillStored;
    const latestId = engine.latest ? engine.latest.id : null;
    useEffect(() => {
        if (pinnedId != null && !pinnedStillStored && cells.length) {
            setPinnedId(null);
            setAgedOut(true);
        }
    }, [pinnedId, pinnedStillStored, cells.length]);
    // Picking the newest cycle IS following it: the next record moves on with it.
    const select = (id) => {
        setAgedOut(false);
        setPinnedId(id === latestId ? null : id);
    };
    const follow = () => {
        setAgedOut(false);
        setPinnedId(null);
    };
    const selectedId = following ? (engine.latest ? engine.latest.id : null) : pinnedId;
    const selectedIndex = cells.findIndex((c) => c.id === selectedId);
    const previousId = selectedIndex > 0 ? cells[selectedIndex - 1].id : null;

    const current = useEngineRecord(selectedId, { live: following });
    const previous = useEngineRecord(previousId, { withOutcomes: false });

    const loaded = useMemo(() => (current.record
        ? recordView(current.record, { outcomes: outcomesByRequirement(current.outcomes, selectedId), names })
        : null), [current.record, current.outcomes, selectedId, names]);
    // While FOLLOWING, the decision on screen stays until the next record has
    // loaded, so a new cycle replaces it instead of flashing a spinner.
    const lastView = useRef(null);
    if (loaded) lastView.current = loaded;
    const view = loaded || (following ? lastView.current : null);
    const changes = useMemo(() => (current.record && (previousId == null || previous.record)
        ? recordChanges(previous.record, current.record, names) : null),
    [current.record, previous.record, previousId, names]);
    const reqTitles = useRequirementTitles(view ? view.queue.map((q) => q.requirementId) : []);

    const machine = names.machines.get(engine.machineId);
    const pipeline = names.pipelines.get(engine.pipelineId);
    const initiative = engine.initiativeId == null ? null : names.initiatives.get(engine.initiativeId);
    const stoppedFor = engine.off && engine.stoppedAt ? (() => {
        const at = parseUtc(engine.stoppedAt);
        return at ? Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000)) : null;
    })() : null;

    const limitsFromBeat = following && engine.healthJson && engine.healthJson.limits;
    const limits = limitsFromBeat || (view && view.limits) || null;

    return (
        <Paper variant="outlined" data-testid={`engine-panel-${engine.id}`}
               data-health={engine.health} data-off={engine.off ? 'true' : 'false'}
               sx={{ p: 2, mb: 2, position: 'relative',
                     borderLeft: '4px solid', borderLeftColor: HEALTH_COLORS[engine.health] }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <Typography variant="h6" component="h2" sx={{ fontSize: '1.05rem' }}
                            data-testid={`engine-title-${engine.id}`}>
                    {machineName(machine, engine.machineId)} · {scopeText(engine.pipelineId, engine.initiativeId, {
                        pipelineTitle: pipeline && pipeline.title,
                        initiativeTitle: initiative && initiative.title })}
                </Typography>
                <ToneChip label={engine.health} color={HEALTH_COLORS[engine.health]}
                          title={HEALTH_WORDS[engine.health]} testid={`engine-health-chip-${engine.id}`} />
                {!following && (
                    <Typography variant="caption" color="warning.main" data-testid={`engine-pinned-${engine.id}`}>
                        viewing an earlier cycle
                    </Typography>
                )}
            </Box>

            {engine.off && (
                <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }} data-testid={`engine-off-${engine.id}`}>
                    {engine.state.actual_state === 'stopped'
                        ? `Turned off${engine.stoppedAt ? ` — stopped ${stampText(engine.stoppedAt, timezone)}` : ''}`
                        : `Switched off${engine.stoppedAt ? ` at ${stampText(engine.stoppedAt, timezone)}` : ''}`
                          + ` — still stopping: the supervisor reports ${engine.state.actual_state}`}
                    {stoppedFor != null ? ` (${humanDuration(stoppedFor)} ago)` : ''}.
                    {engine.latest ? ' Its last decision is shown greyed below.' : ' It never published a decision.'}
                </Alert>
            )}
            {agedOut && (
                <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }} onClose={() => setAgedOut(false)}
                       data-testid={`engine-aged-out-${engine.id}`}>
                    The cycle you were viewing aged out of the stored history; showing the latest.
                </Alert>
            )}
            {engine.health === HEALTH_MISSING && (
                <Alert severity="error" sx={{ mb: 1.5 }} data-testid={`engine-missing-${engine.id}`}>
                    {engine.beatAgeSeconds != null
                        ? `No heartbeat for ${humanDuration(engine.beatAgeSeconds)}`
                        : 'No readable heartbeat from this engine'}
                    {` — it is wanted on, and an engine silent for more than ${humanDuration(missingAfter(engine.healthJson))} `}
                    is missing. The decision below is its last, not a current one.
                </Alert>
            )}

            <Box sx={{ opacity: engine.off ? 0.5 : 1, filter: engine.off ? 'grayscale(0.6)' : 'none' }}
                 data-testid={`engine-body-${engine.id}`}>
                <Box sx={{ display: 'grid', gap: 2,
                           gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 340px) 1fr' } }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <EngineLocationPanel engine={engine} names={names} />
                        <EngineHealthPanel engine={engine} timezone={timezone} />
                        <EngineLimitsPanel engine={engine} limits={limits}
                                           source={limitsFromBeat ? 'at the last heartbeat'
                                               : view ? `at cycle ${view.seq}` : null} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                        {selectedId == null ? (
                            <Typography variant="body2" color="text.secondary"
                                        data-testid={`engine-no-record-${engine.id}`}>
                                No decision record stored for this engine yet —
                                {engine.beat ? ' it has a heartbeat but has not published a cycle that produced one.'
                                    : ' it has neither a heartbeat nor a published cycle.'}
                            </Typography>
                        ) : current.isError ? (
                            <Alert severity="error">The decision record failed to load.</Alert>
                        ) : !view ? (
                            <CircularProgress size={20} />
                        ) : (
                            <EngineDecisionPanel engine={engine} view={view} names={names}
                                                 reqTitles={reqTitles} timezone={timezone} />
                        )}
                        {current.outcomesError && (
                            <Alert severity="warning" sx={{ mt: 1 }}>
                                The executor outcomes failed to load — admitted launches read as pending.
                            </Alert>
                        )}
                    </Box>
                </Box>
                <Divider sx={{ my: 1.5 }} />
                <EngineHistoryStrip engineId={engine.id} cells={cells} selectedId={selectedId}
                                    following={following} onSelect={select}
                                    onFollow={follow} changes={changes}
                                    timezone={timezone} />
            </Box>
        </Paper>
    );
}
