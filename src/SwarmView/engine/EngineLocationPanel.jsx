// EngineLocationPanel.jsx — WHERE an engine is (rule R7): machine, terminal,
// scope, role and how long it has held its claim (req #3760).
//
// The machine is drawn with the orchestration badge (`OrchestrationBadges`,
// req #3809): green the lead, orange a subscriber, a dashed outline when it is
// not alive.

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import OrchestrationBadges from '../pipelines/OrchestrationBadges';
import {
    BADGE_LEAD, BADGE_STALE, BADGE_SUBSCRIBER, humanDuration, machinePlatformLabel,
} from '../pipelines/orchestrationHolder';
import { planDetailPath } from '../pipelines/planEra';
import { HEALTH_OK, HEALTH_DEGRADED } from './engineVocabulary';
import { scopeText } from './engineModel';
import { PanelTitle, Field } from './enginePanelParts';

const ROLE_WORDS = {
    lead: 'lead — launches unpinned work and its own machine\'s',
    subscriber: 'subscriber — launches only work pinned to its machine',
    refused: 'refused — another claim on this machine overlaps; launches nothing',
};

export function machineName(machine, id) {
    if (!machine) return id == null ? 'no machine' : `machine ${id}`;
    return machine.title || machine.hostname || `machine ${id}`;
}

export default function EngineLocationPanel({ engine, names }) {
    const machine = names.machines.get(engine.machineId);
    const beat = engine.beat || {};
    const role = beat.role ?? null;
    const alive = engine.health === HEALTH_OK || engine.health === HEALTH_DEGRADED;
    const tone = !alive ? BADGE_STALE : role === 'lead' ? BADGE_LEAD : BADGE_SUBSCRIBER;
    const pipeline = names.pipelines.get(engine.pipelineId);
    const initiative = engine.initiativeId == null ? null : names.initiatives.get(engine.initiativeId);
    const claimAge = engine.healthJson && engine.healthJson.claim_age_s;
    // The claim age is measured AT the beat; add the beat's own age so the
    // number a reader sees is the claim's age now, not at the last cycle.
    const claimNow = claimAge == null ? null
        : claimAge + (alive && engine.beatAgeSeconds != null ? engine.beatAgeSeconds : 0);

    return (
        <Box data-testid={`engine-location-${engine.id}`}>
            <PanelTitle>Location</PanelTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <OrchestrationBadges badges={[{
                    key: `engine-${engine.id}`,
                    text: machinePlatformLabel(machine),
                    tone,
                    title: `${machineName(machine, engine.machineId)} — ${role || 'no role'}`,
                }]} />
                <Typography variant="subtitle2" data-testid={`engine-machine-${engine.id}`}>
                    {machineName(machine, engine.machineId)}
                </Typography>
            </Box>
            <Field label="Scope" testid={`engine-scope-${engine.id}`}>
                <Link component={RouterLink} to={planDetailPath(engine.pipelineId, 'mode=plan')}
                      underline="hover">
                    {scopeText(engine.pipelineId, engine.initiativeId, {
                        pipelineTitle: pipeline && pipeline.title,
                        initiativeTitle: initiative && initiative.title })}
                </Link>
            </Field>
            <Field label="Role" testid={`engine-role-${engine.id}`}>
                {role ? ROLE_WORDS[role] || role : 'none — its claim is lost'}
            </Field>
            <Field label="Terminal">{beat.terminal_pid ?? '—'}</Field>
            <Field label="Engine pid">{beat.engine_pid ?? '—'}</Field>
            <Field label="Claim" testid={`engine-claim-${engine.id}`}>
                {beat.claim_fk == null ? 'none held' : `#${beat.claim_fk}`}
                {beat.claim_fk != null && claimNow != null && ` · held ${humanDuration(claimNow)}`}
            </Field>
        </Box>
    );
}
