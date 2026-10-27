// EngineHealthPanel.jsx — HOW an engine is (rule R4): its heartbeat by AGE,
// the read and cycle times it measured, its code verdict, how many cycles in a
// row failed, how often the supervisor restarted it (req #3869), and what the
// supervisor reports (req #3760).
//
// The supervisor line is the `engine_states.actual_state` row — the report the
// supervisor writes back (req #3758) — never anything the browser infers.

import Box from '@mui/material/Box';

import {
    ACTUAL_STATE_WORDS, CODE_VERDICT_WORDS, HEALTH_COLORS, HEALTH_MISSING, HEALTH_WORDS,
    desiredReasonText,
} from './engineVocabulary';
import { agoText, humanDuration, intervalText, missingAfter, restartsText, stampText } from './engineModel';
import { Field, PanelTitle, ToneChip } from './enginePanelParts';

const ms = (v) => (v == null ? '—' : `${Math.round(v)} ms`);

export default function EngineHealthPanel({ engine, timezone }) {
    const h = engine.healthJson || {};
    const state = engine.state || {};
    const beat = engine.beat;
    return (
        <Box data-testid={`engine-health-${engine.id}`}>
            <PanelTitle>Health</PanelTitle>
            <Field label="Heartbeat" testid={`engine-heartbeat-${engine.id}`}>
                <ToneChip label={engine.health} color={HEALTH_COLORS[engine.health]}
                          title={HEALTH_WORDS[engine.health]}
                          testid={`engine-health-state-${engine.id}`} sx={{ mr: 1 }} />
                {beat ? `last beat ${agoText(engine.beatAgeSeconds)}` : 'never beat'}
                {engine.health === HEALTH_MISSING && (
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                        {` (missing after ${humanDuration(missingAfter(h))})`}
                    </Box>
                )}
            </Field>
            <Field label="Plan read" testid={`engine-read-${engine.id}`}>
                {h.read_ok === false
                    ? `FAILED${h.read_error ? ` — ${h.read_error}` : ''}`
                    : `ok · ${ms(h.read_ms)}`}
            </Field>
            <Field label="Cycle time">{ms(h.cycle_ms)}</Field>
            <Field label="Next cycle" testid={`engine-interval-${engine.id}`}>
                {intervalText(h)}
            </Field>
            <Field label="Code" testid={`engine-code-${engine.id}`}>
                {h.code_verdict ? `${h.code_verdict} — ${CODE_VERDICT_WORDS[h.code_verdict]
                    || 'unrecognised verdict'}` : '—'}
            </Field>
            <Field label="Degraded" testid={`engine-degraded-${engine.id}`}>
                {Number.isInteger(h.degraded_count)
                    ? (h.degraded_count === 0 ? 'no failed cycles'
                        : `${h.degraded_count} failed cycle${h.degraded_count === 1 ? '' : 's'} in a row`)
                    : '—'}
            </Field>
            <Field label="Restarts" testid={`engine-restarts-${engine.id}`}>
                {restartsText(h)}
            </Field>
            <Field label="Supervisor" testid={`engine-supervisor-${engine.id}`}>
                {ACTUAL_STATE_WORDS[state.actual_state] || state.actual_state || '—'}
                {state.actual_detail ? ` — ${state.actual_detail}` : ''}
                {state.actual_at ? ` · ${stampText(state.actual_at, timezone)}` : ''}
            </Field>
            <Field label="Wanted" testid={`engine-desired-${engine.id}`}>
                {state.desired_state || '—'}
                {state.desired_reason ? ` (${desiredReasonText(state.desired_reason)})` : ''}
            </Field>
        </Box>
    );
}
