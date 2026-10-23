// EngineDecisionPanel.jsx — one decision record, rendered as a reader reads it
// (req #3760, interface I7).
//
// The launch queue in the record's own order with the cut line where the
// record put it; each item's code in plain words with its reason; the
// executor's answer for every launch the record admitted; then each epic in
// scope with the code it was held or admitted under, and the cycle's events.
// Nothing is re-decided here (rule R2): the record is drawn as it is.

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import { epicPlanLinkTo } from '../pipelines/pipelineEpicLink';
import {
    OUTCOME_COLORS, OUTCOME_FAILED, OUTCOME_LANDED, OUTCOME_WORDS, codeColor, plainWords,
} from './engineVocabulary';
import { stampText } from './engineModel';
import { CodeChip, PanelTitle, ToneChip } from './enginePanelParts';

function EpicLink({ pipelineId, epicId, names, testid }) {
    const epic = names.epics.get(epicId);
    const to = epicPlanLinkTo(pipelineId, epicId);
    const text = epic && epic.title ? `epic ${epicId} · ${epic.title}` : `epic ${epicId}`;
    if (!to) return <span>{text}</span>;
    return (
        <Link component={RouterLink} to={to} underline="hover" data-testid={testid}>
            {text}
        </Link>
    );
}

function RequirementLink({ id, reqTitles }) {
    const row = reqTitles.get(id);
    return (
        <Link component={RouterLink} to={`/swarm/requirement/${id}`} underline="hover">
            #{id}{row && row.title ? ` ${row.title}` : ''}
        </Link>
    );
}

function Outcome({ outcome, testid }) {
    if (!outcome) return null;
    return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}
             data-testid={testid} data-outcome={outcome.state}>
            <ToneChip label={outcome.state} color={OUTCOME_COLORS[outcome.state]}
                      title={OUTCOME_WORDS[outcome.state]} />
            {outcome.state === OUTCOME_LANDED && outcome.sessionIds.map((sid) => (
                <Link key={sid} component={RouterLink} to={`/swarm/session/${sid}`} underline="hover"
                      variant="body2">
                    session {sid}
                </Link>
            ))}
            {outcome.state === OUTCOME_FAILED && outcome.reason && (
                <Typography variant="caption" color="text.secondary">{outcome.reason}</Typography>
            )}
        </Box>
    );
}

function CutLine({ engineId }) {
    return (
        <Box role="separator" data-testid={`engine-cut-${engineId}`}
             sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 0.5, color: 'error.main' }}>
            <Box sx={{ flex: 1, borderTop: '2px dashed', borderColor: 'error.main' }} />
            <Typography variant="caption" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                slots run out here
            </Typography>
            <Box sx={{ flex: 1, borderTop: '2px dashed', borderColor: 'error.main' }} />
        </Box>
    );
}

export default function EngineDecisionPanel({ engine, view, names, reqTitles, timezone }) {
    const id = engine.id;
    const pipelineId = engine.pipelineId;
    return (
        <Box data-testid={`engine-decision-${id}`}>
            <PanelTitle>Decision</PanelTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <Typography variant="subtitle2" data-testid={`engine-cycle-${id}`}>
                    Cycle {view.seq} · {stampText(view.now, timezone)}
                </Typography>
                <ToneChip label={view.ok ? 'OK' : view.verdict}
                          color={codeColor(view.ok ? 'ADMITTED' : 'ENGINE_HOLD')}
                          title={view.ok ? 'the engine trusted this cycle'
                              : plainWords('ENGINE_HOLD')}
                          testid={`engine-verdict-${id}`} />
                {view.verdictDetail && (
                    <Typography variant="body2" color="error" data-testid={`engine-verdict-detail-${id}`}>
                        {view.verdictDetail}
                    </Typography>
                )}
            </Box>

            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                Launch queue, in order ({view.queue.length} item{view.queue.length === 1 ? '' : 's'},
                {' '}{view.admittedCount} admitted)
            </Typography>
            {view.queue.length === 0 ? (
                <Typography variant="body2" color="text.secondary" data-testid={`engine-queue-empty-${id}`}>
                    The launch queue is empty this cycle — no launch-ready work in scope
                    {view.ok ? '.' : ', and the engine could not trust the cycle anyway.'}
                </Typography>
            ) : (
                <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}
                     data-testid={`engine-queue-${id}`}>
                    {view.queue.map((item) => (
                        <Box component="li" key={`${item.requirementId}-${item.index}`}>
                            {view.cutShown && item.index === view.cut && <CutLine engineId={id} />}
                            <Box data-testid={`engine-queue-item-${id}-${item.requirementId}`}
                                 data-code={item.code}
                                 data-below-cut={item.belowCut ? 'true' : 'false'}
                                 sx={{ display: 'grid', gap: 1, py: 0.5, alignItems: 'start',
                                       gridTemplateColumns: { xs: '24px 1fr', md: '24px 110px 1fr' },
                                       borderBottom: '1px solid', borderColor: 'divider',
                                       opacity: item.belowCut && item.code !== 'IN_FLIGHT' ? 0.75 : 1 }}>
                                <Typography variant="body2" color="text.secondary">{item.position}.</Typography>
                                <Box><CodeChip code={item.code} /></Box>
                                <Box sx={{ gridColumn: { xs: '2', md: 'auto' }, minWidth: 0 }}>
                                    <Typography variant="body2" component="div">
                                        <RequirementLink id={item.requirementId} reqTitles={reqTitles} />
                                        {' on '}
                                        <EpicLink pipelineId={pipelineId} epicId={item.epicId} names={names}
                                                  testid={`engine-epic-link-${id}-${item.epicId}-${item.index}`} />
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {item.words}{item.detail ? ` — ${item.detail}` : ''}
                                    </Typography>
                                    <Outcome outcome={item.outcome}
                                             testid={`engine-outcome-${id}-${item.requirementId}`} />
                                </Box>
                            </Box>
                        </Box>
                    ))}
                </Box>
            )}

            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5, mb: 0.5 }}>
                Epics in scope with open work
            </Typography>
            {view.epics.length === 0 ? (
                <Typography variant="body2" color="text.secondary" data-testid={`engine-epics-empty-${id}`}>
                    No epic in scope holds open work.
                </Typography>
            ) : (
                <Box data-testid={`engine-epics-${id}`}>
                    {view.epics.map((e) => (
                        <Box key={e.epicId} data-testid={`engine-epic-${id}-${e.epicId}`} data-code={e.code}
                             sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap', py: 0.25 }}>
                            <CodeChip code={e.code} />
                            <Typography variant="body2" component="span">
                                <EpicLink pipelineId={pipelineId} epicId={e.epicId} names={names}
                                          testid={`engine-epic-row-link-${id}-${e.epicId}`} />
                            </Typography>
                            <Typography variant="body2" color="text.secondary" component="span">
                                {e.words}{e.detail ? ` — ${e.detail}` : ''}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            )}

            {view.events.length > 0 && (
                <Box sx={{ mt: 1.5 }} data-testid={`engine-events-${id}`}>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                        Events this cycle
                    </Typography>
                    {view.events.map((ev, i) => (
                        <Alert key={i} severity={['REGRESSION', 'STALL', 'VIOLATION'].includes(ev.code)
                            ? 'warning' : 'info'} variant="outlined" sx={{ py: 0, mb: 0.5 }}>
                            {ev.text}
                        </Alert>
                    ))}
                </Box>
            )}
        </Box>
    );
}
