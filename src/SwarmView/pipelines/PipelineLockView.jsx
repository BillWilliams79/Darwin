// PipelineLockView.jsx — the Lock view of /swarm/pipeline/:id (req #3761).
//
// The plan visualizer condensed to pipeline → initiatives → epics, no
// requirement drawn: the whole picture at a glance of what is LOCKED, what is
// PAUSED, and where each ENGINE is working. `pipelineLockLayout.js` computes
// every fact and every coordinate; this file draws them and owns the six user
// actions (lock/unlock at each tier, pause/unpause at the two tiers that have
// one).
//
// THE WRITES are the ones the full canvas already makes — `updatePipeline`,
// `updateInitiative`, `updateEpic` against the gateway's generic PUT — and a
// write that comes back refused (the gateway's 423, `plan_lock.py`) is echoed
// IN PLACE, on the tier whose control was pressed, in the gateway's own words,
// never in a snackbar the reader has to connect back to a click.
//
// A LOCK CASCADES, so a row locked by an ANCESTOR cannot be unlocked from here
// (flipping its own flag would change nothing the reader can see); the control
// says which level to lift instead — the full canvas's rule, verbatim.
//
// EPIC CLICK FRAMES THE EPIC IN THE FULL VIEW (`epicPlanLinkTo`): the Lock view
// has no requirement to show, so the click leaves for the canvas that does.
//
// The camera is d3-zoom over an HTML surface (drag to pan, wheel to zoom) and
// the header's Default control returns it through `resetViewNonce`, the
// contract every mode of this page honours. The surface opens FITTED to the
// viewport's height — "the whole picture on one screen" is the acceptance.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';

import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';

import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { pipelineComposeKeys } from '../../hooks/useQueryKeys';
import { initiativeKeys, pipelineEpicKeys, pipelineKeys } from '../../hooks/useDataQueries';
import { updatePipeline } from '../../Pipelines/pipelinesApi';
import { updateInitiative } from '../../Initiatives/initiativesApi';
import { updateEpic } from '../../Epics/epicsApi';
import { BarrierGateIcon, PlanLockIcon } from './PlanEpicFlagIcons';
import { epicPlanLinkTo } from './pipelineEpicLink';
import { PLAN_VIZ_PALETTE, pauseBubbleColor } from './pipelinePlanLayout';
import {
    buildLockModel, fitLockLayout, LOCK_GEOM,
    LOCK_BY_PIPELINE, LOCK_BY_INITIATIVE,
} from './pipelineLockLayout';
import { BADGE_LEAD, BADGE_SUBSCRIBER } from './orchestrationHolder';

const P = PLAN_VIZ_PALETTE;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;
const FALLBACK_WIDTH = 1100;
const FALLBACK_HEIGHT = 640;

const TONE_COLOR = { [BADGE_LEAD]: P.holderLead, [BADGE_SUBSCRIBER]: P.holderSubscriber };
const toneColor = (tone) => TONE_COLOR[tone] || P.dim;

/** What a refused or failed write says, in the gateway's own words when it spoke. */
export function refusalText(err, failure) {
    const status = err?.httpStatus?.httpStatus;
    const message = err?.httpStatus?.httpMessage;
    if (status === 423) return `Refused (423): ${message || 'locked'}`;
    if (status) return `${failure} (HTTP ${status}${message ? `: ${message}` : ''})`;
    return `${failure}${err?.message ? `: ${err.message}` : ''}`;
}

const lockedByWords = (lockedBy) => (lockedBy === LOCK_BY_PIPELINE ? 'its pipeline'
    : lockedBy === LOCK_BY_INITIATIVE ? 'its initiative' : null);

/** One holder: a badge circle (platform inside) and the machine + role, outlined in its tone. */
function HolderChip({ holder, testId }) {
    return (
        <Tooltip title={holder.title}>
            <Box role="img" aria-label={holder.title}
                 data-testid={testId} data-tone={holder.tone} data-role={holder.role || 'stale'}
                 sx={{
                     display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '100%',
                     px: '4px', py: '2px', borderRadius: '999px', fontSize: 11, lineHeight: 1.2,
                     color: P.text, boxSizing: 'border-box',
                     border: `1px ${holder.stale ? 'dashed' : 'solid'} ${toneColor(holder.tone)}`,
                 }}>
                <Box component="span"
                     sx={{
                         width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                         display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                         fontSize: holder.platform.length > 3 ? 8 : 9, fontWeight: 700,
                         bgcolor: holder.stale ? 'transparent' : toneColor(holder.tone),
                         color: holder.tone === BADGE_SUBSCRIBER ? '#000' : '#fff',
                     }}>
                    {holder.platform}
                </Box>
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {holder.label}
                </Box>
            </Box>
        </Tooltip>
    );
}

/** The padlock control of any tier. */
function LockControl({ tier, what, locked, lockedBy, busy, onToggle, testId }) {
    const byAncestor = locked && lockedBy && lockedBy !== tier;
    const label = !locked ? `Lock ${what}`
        : byAncestor ? `${what} is locked by ${lockedByWords(lockedBy)} — unlock that first`
            : `Unlock ${what}`;
    return (
        <Tooltip title={label}>
            <span>
                <IconButton size="small" aria-label={label} aria-pressed={locked}
                            disabled={busy} onClick={onToggle}
                            data-testid={testId} data-locked={locked ? '1' : '0'}
                            data-locked-by={lockedBy || ''}
                            sx={{ p: '3px', color: locked ? P.lockOn : P.dim, opacity: locked ? 1 : 0.75,
                                  '&:hover': { opacity: 1 } }}>
                    <PlanLockIcon locked={locked} sx={{ fontSize: 18 }} />
                </IconButton>
            </span>
        </Tooltip>
    );
}

/** The pause control of the two tiers that have one. */
function PauseControl({ what, paused, disabledReason, busy, onToggle, testId }) {
    const label = disabledReason || (paused ? `Unpause ${what}` : `Pause ${what}`);
    return (
        <Tooltip title={label}>
            <span>
                <IconButton size="small" aria-label={label} aria-pressed={paused}
                            disabled={busy || !!disabledReason} onClick={onToggle}
                            data-testid={testId} data-paused={paused ? '1' : '0'}
                            sx={{ p: '3px', color: paused ? P.pausePaused : P.dim, opacity: paused ? 1 : 0.75,
                                  '&:hover': { opacity: 1 } }}>
                    {paused ? <PlayCircleOutlineIcon sx={{ fontSize: 18 }} />
                        : <PauseCircleOutlineIcon sx={{ fontSize: 18 }} />}
                </IconButton>
            </span>
        </Tooltip>
    );
}

function Refusal({ refusal, tierKey }) {
    if (!refusal || refusal.key !== tierKey) return null;
    return (
        <Typography role="alert" title={refusal.text}
                    data-testid={`lock-view-refusal-${tierKey}`}
                    sx={{ fontSize: 11, lineHeight: 1.25, color: P.lockedFrame, mt: '2px',
                          overflow: 'hidden', display: '-webkit-box',
                          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {refusal.text}
        </Typography>
    );
}

const abs = ({ x, y, w, h }) => ({ position: 'absolute', left: x, top: y, width: w, height: h });

export default function PipelineLockView({
    plan, model, pipeline, orchestrationClaims, machines, resetViewNonce = 0,
}) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);

    // ── GEOMETRY ────────────────────────────────────────────────────────────
    const viewportRef = useRef(null);
    const surfaceRef = useRef(null);
    const zoomRef = useRef(null);
    const [box, setBox] = useState({ width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT });
    useEffect(() => {
        const el = viewportRef.current;
        if (!el) return undefined;
        const measure = () => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                setBox((b) => (b.width === Math.round(r.width) && b.height === Math.round(r.height)
                    ? b : { width: Math.round(r.width), height: Math.round(r.height) }));
            }
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const lockModel = useMemo(() => buildLockModel({
        pipeline, plan, initiatives: model?.initiatives, claims: orchestrationClaims, machines,
    }), [pipeline, plan, model?.initiatives, orchestrationClaims, machines]);
    // The whole picture on one screen: the layout and the camera that fits it.
    const { layout, k: fitK } = useMemo(
        () => fitLockLayout(lockModel, box), [lockModel, box]);

    useEffect(() => {
        const el = viewportRef.current;
        if (!el) return undefined;
        const zb = d3zoom()
            .scaleExtent([MIN_ZOOM, MAX_ZOOM])
            // A press on a control is a click, never a pan.
            .filter((event) => event.type === 'wheel'
                || (!event.button && !(event.target.closest && event.target.closest('button'))))
            .on('zoom', (event) => {
                const surface = surfaceRef.current;
                if (!surface) return;
                const t = event.transform;
                surface.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
                surface.dataset.zoom = t.k.toFixed(3);
            });
        zoomRef.current = zb;
        select(el).call(zb);
        return () => { select(el).on('.zoom', null); zoomRef.current = null; };
    }, []);

    // Open on the fit, and go back to it when Default is pressed.
    useEffect(() => {
        const el = viewportRef.current;
        if (!el || !zoomRef.current) return;
        select(el).call(zoomRef.current.transform, zoomIdentity.scale(fitK));
    }, [fitK, resetViewNonce]);

    // ── THE WRITES ──────────────────────────────────────────────────────────
    const [busy, setBusy] = useState(null);       // the tier key being written
    const [refusal, setRefusal] = useState(null); // { key, text }

    const refresh = useCallback(() => {
        const creatorFk = profile?.userName;
        return Promise.all([
            pipeline?.id != null && queryClient.invalidateQueries({
                queryKey: pipelineComposeKeys.byId(pipeline.id) }),
            creatorFk && queryClient.invalidateQueries({ queryKey: initiativeKeys.all(creatorFk) }),
            creatorFk && queryClient.invalidateQueries({ queryKey: pipelineEpicKeys.all(creatorFk) }),
            // The plans list reads the pipeline's own Lock and Status columns.
            creatorFk && queryClient.invalidateQueries({ queryKey: pipelineKeys.all(creatorFk) }),
            queryClient.invalidateQueries({ queryKey: ['orchestration_index'] }),
        ]);
    }, [queryClient, pipeline?.id, profile?.userName]);

    const act = useCallback(async (key, write, failure) => {
        setBusy(key);
        setRefusal(null);
        try {
            await write();
            await refresh();
        } catch (err) {
            setRefusal({ key, text: refusalText(err, failure) });
        } finally {
            setBusy(null);
        }
    }, [refresh]);

    // A row locked by an ANCESTOR is unlocked there. Said in place, before any write.
    const refuseAncestor = useCallback((key, what, lockedBy, tier) => {
        if (lockedBy && lockedBy !== tier) {
            setRefusal({ key, text: `This ${what} is locked by ${lockedByWords(lockedBy)} — unlock that first` });
            return true;
        }
        return false;
    }, []);

    const togglePipelineLock = () => act('pipeline',
        () => updatePipeline(darwinUri, idToken, lockModel.pipeline.id,
            { locked: lockModel.pipeline.locked ? 0 : 1 }),
        'Could not change the pipeline lock');
    const togglePipelinePause = () => act('pipeline',
        () => updatePipeline(darwinUri, idToken, lockModel.pipeline.id,
            { pipeline_status: lockModel.pipeline.paused ? 'active' : 'paused' }),
        'Could not change the pipeline pause');
    const toggleInitiativeLock = (band) => {
        const key = `initiative-${band.id}`;
        if (refuseAncestor(key, 'initiative', band.lockedBy, LOCK_BY_INITIATIVE)) return;
        act(key, () => updateInitiative(darwinUri, idToken, band.id, { locked: band.locked ? 0 : 1 }),
            'Could not change the initiative lock');
    };
    const toggleInitiativePause = (band) => act(`initiative-${band.id}`,
        () => updateInitiative(darwinUri, idToken, band.id,
            { initiative_status: band.paused ? 'active' : 'paused' }),
        'Could not change the initiative pause');
    const toggleEpicLock = (epic) => {
        const key = `epic-${epic.id}`;
        if (refuseAncestor(key, 'epic', epic.lockedBy, 'epic')) return;
        act(key, () => updateEpic(darwinUri, idToken, epic.id, { locked: epic.locked ? 0 : 1 }),
            'Could not change the epic lock');
    };

    // EPIC CLICK frames the epic in the full view.
    const frameEpic = (epicId) => {
        const to = epicPlanLinkTo(pipeline.id, epicId);
        if (to) navigate(to);
    };

    const { pipeline: pl, initiatives: bands, totals } = lockModel;
    const pipelineHolderColor = pl.holders.length ? toneColor(pl.holders[0].tone) : null;
    const epicLayout = new Map();
    layout.bands.forEach((b) => b.epics.forEach((e) => epicLayout.set(e.id, e)));

    return (
        <Box sx={{ mt: 0 }} data-testid="lock-view"
             data-locked-initiatives={totals.lockedInitiatives}
             data-locked-epics={totals.lockedEpics}
             data-paused-initiatives={totals.pausedInitiatives}>
            <Box ref={viewportRef} data-testid="lock-view-viewport"
                 sx={{
                     position: 'relative', overflow: 'hidden', bgcolor: P.bg, color: P.text,
                     height: 'calc(100vh - 170px)', minHeight: 420, borderRadius: 1,
                     cursor: 'grab', touchAction: 'none', userSelect: 'none',
                     '&:active': { cursor: 'grabbing' },
                 }}>
                <Box ref={surfaceRef} data-testid="lock-view-surface"
                     sx={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0',
                           width: layout.width, height: layout.height }}>

                    {/* ── PIPELINE TIER ─────────────────────────────────────── */}
                    <Box data-testid="lock-view-pipeline"
                         data-locked={pl.locked ? '1' : '0'} data-paused={pl.paused ? '1' : '0'}
                         data-held={pl.holders.length ? '1' : '0'}
                         sx={{
                             ...abs(layout.frame), boxSizing: 'border-box', borderRadius: 1.5,
                             bgcolor: P.panel,
                             border: `${pl.holders.length ? 3 : 1}px solid ${pipelineHolderColor || P.line}`,
                             backgroundImage: pl.locked
                                 ? `linear-gradient(${P.lockBandTint}, ${P.lockBandTint})` : 'none',
                         }} />
                    <Box sx={{ ...abs(layout.header), display: 'flex', alignItems: 'center', gap: 1,
                               minWidth: 0 }}
                         data-testid="lock-view-pipeline-header">
                        <Box component="span" aria-hidden="true"
                             sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                                   bgcolor: pauseBubbleColor(pl.paused) }} />
                        <Box sx={{ minWidth: 0, flex: '0 1 auto' }}>
                            <Typography noWrap title={pl.title}
                                        sx={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>
                                {pl.title}
                            </Typography>
                            <Typography sx={{ fontSize: 11, color: P.dim, lineHeight: 1.3 }}>
                                Pipeline · {totals.initiatives} initiatives · {totals.epics} epics
                                {' · '}{totals.lockedEpics} epics locked
                                {pl.paused ? ' · PAUSED' : ''}
                            </Typography>
                        </Box>
                        <LockControl tier={LOCK_BY_PIPELINE} what="pipeline" locked={pl.locked}
                                     lockedBy={pl.lockedBy} busy={busy === 'pipeline'}
                                     onToggle={togglePipelineLock}
                                     testId="lock-view-pipeline-lock" />
                        <PauseControl what="pipeline" paused={pl.paused} busy={busy === 'pipeline'}
                                      disabledReason={pl.canPause ? null
                                          : `A ${pl.status || 'new'} pipeline cannot be paused`}
                                      onToggle={togglePipelinePause}
                                      testId="lock-view-pipeline-pause" />
                        <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
                            {pl.holders.map((h) => (
                                <HolderChip key={h.key} holder={h}
                                            testId={`lock-view-pipeline-holder-${h.claimId}`} />
                            ))}
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Refusal refusal={refusal} tierKey="pipeline" />
                        </Box>
                    </Box>

                    {/* ── INITIATIVE TIER ───────────────────────────────────── */}
                    {bands.map((band) => {
                        const placed = layout.bands.find((b) => b.key === band.key);
                        const tierKey = `initiative-${band.id}`;
                        const holderTone = band.holders.length ? toneColor(band.holders[0].tone) : null;
                        return (
                            <Box key={`band-${band.key ?? 'none'}`}
                                 data-testid={`lock-view-initiative-${band.id ?? 'none'}`}
                                 data-locked={band.effectiveLocked ? '1' : '0'}
                                 data-locked-by={band.lockedBy || ''}
                                 data-paused={band.effectivePaused ? '1' : '0'}
                                 data-paused-by={band.pausedBy || ''}
                                 data-held={band.holders.length ? '1' : '0'}
                                 sx={{
                                     ...abs(placed), boxSizing: 'border-box', borderRadius: 1,
                                     bgcolor: P.bg,
                                     border: `${band.holders.length ? 3 : 1}px solid ${holderTone || P.line}`,
                                     backgroundImage: band.effectiveLocked
                                         ? `linear-gradient(${P.lockBandTint}, ${P.lockBandTint})` : 'none',
                                 }}>
                                <Box sx={{ ...abs({ x: 0, y: 0, w: LOCK_GEOM.BAND_HEAD_W, h: placed.h }),
                                           boxSizing: 'border-box', p: '8px 8px 6px',
                                           display: 'flex', flexDirection: 'column', gap: '4px',
                                           overflow: 'hidden' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                        <Box component="span" aria-hidden="true"
                                             data-testid={`lock-view-initiative-bubble-${band.id ?? 'none'}`}
                                             sx={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                                                   bgcolor: pauseBubbleColor(band.effectivePaused) }} />
                                        <Typography noWrap title={band.title}
                                                    sx={{ fontWeight: 700, fontSize: 13, minWidth: 0 }}>
                                            {band.title}
                                        </Typography>
                                    </Box>
                                    <Typography sx={{ fontSize: 11, color: P.dim, lineHeight: 1.2 }}>
                                        {band.counts.epics} epics
                                        {band.counts.lockedEpics ? ` · ${band.counts.lockedEpics} locked` : ''}
                                        {band.effectivePaused
                                            ? ` · paused${band.pausedBy === 'pipeline' ? ' by pipeline' : ''}` : ''}
                                    </Typography>
                                    {band.id != null && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                            <LockControl tier={LOCK_BY_INITIATIVE} what={`initiative ${band.title}`}
                                                         locked={band.effectiveLocked} lockedBy={band.lockedBy}
                                                         busy={busy === tierKey}
                                                         onToggle={() => toggleInitiativeLock(band)}
                                                         testId={`lock-view-initiative-lock-${band.id}`} />
                                            <PauseControl what={`initiative ${band.title}`} paused={band.paused}
                                                          busy={busy === tierKey}
                                                          onToggle={() => toggleInitiativePause(band)}
                                                          testId={`lock-view-initiative-pause-${band.id}`} />
                                        </Box>
                                    )}
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px', minWidth: 0 }}>
                                        {band.holders.map((h) => (
                                            <HolderChip key={h.key} holder={h}
                                                        testId={`lock-view-initiative-holder-${h.claimId}`} />
                                        ))}
                                    </Box>
                                    <Refusal refusal={refusal} tierKey={tierKey} />
                                </Box>
                            </Box>
                        );
                    })}

                    {/* ── EPIC TIER ─────────────────────────────────────────── */}
                    {bands.flatMap((band) => band.epics.map((epic) => {
                        const at = epicLayout.get(epic.id);
                        if (!at) return null;
                        const tierKey = `epic-${epic.id}`;
                        const { style } = epic;
                        return (
                            <Box key={`epic-${epic.id}`}
                                 data-testid={`lock-view-epic-${epic.id}`}
                                 data-locked={epic.effectiveLocked ? '1' : '0'}
                                 data-locked-by={epic.lockedBy || ''}
                                 data-frame={style.frame}
                                 data-barrier={epic.barrier ? '1' : '0'}
                                 sx={{
                                     ...abs(at), boxSizing: 'border-box', borderRadius: 1,
                                     border: `${style.frameWidth}px solid ${style.frame}`,
                                     bgcolor: P.pendingFill,
                                     backgroundImage: epic.effectiveLocked
                                         ? `linear-gradient(${P.lockTint}, ${P.lockTint})` : 'none',
                                     overflow: 'hidden',
                                 }}>
                                {/* The state strip: derived state in the canvas's own fill. */}
                                <Box aria-hidden="true" data-testid={`lock-view-epic-state-${epic.id}`}
                                     data-fill={style.fill}
                                     sx={{
                                         position: 'absolute', left: 0, top: 0, bottom: 0, width: 7,
                                         bgcolor: style.fill,
                                         ...(style.pulse && {
                                             animation: 'lockViewPulse 1.6s ease-in-out infinite',
                                             '@keyframes lockViewPulse': { '50%': { opacity: 0.45 } },
                                             '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                                         }),
                                     }} />
                                <ButtonBase onClick={() => frameEpic(epic.id)}
                                            aria-label={`Open epic ${epic.id}, ${epic.title}, in the full plan`}
                                            data-testid={`lock-view-epic-open-${epic.id}`}
                                            sx={{
                                                position: 'absolute', inset: 0, pl: '12px', pr: '28px',
                                                display: 'block', textAlign: 'left',
                                                color: P.text,
                                            }}>
                                    <Typography component="span" sx={{ display: 'block', fontSize: 10,
                                                                      color: P.dim, lineHeight: 1.3 }}>
                                        #{epic.id}{epic.manual ? ' · manual' : ''}
                                    </Typography>
                                    <Typography component="span" title={epic.title}
                                                sx={{ display: '-webkit-box', fontSize: 12, lineHeight: 1.2,
                                                      overflow: 'hidden', WebkitLineClamp: 2,
                                                      WebkitBoxOrient: 'vertical' }}>
                                        {epic.title}
                                    </Typography>
                                </ButtonBase>
                                <Box sx={{ position: 'absolute', top: 1, right: 1, zIndex: 1 }}>
                                    <LockControl tier="epic" what={`epic ${epic.id}`} locked={epic.effectiveLocked}
                                                 lockedBy={epic.lockedBy} busy={busy === tierKey}
                                                 onToggle={() => toggleEpicLock(epic)}
                                                 testId={`lock-view-epic-lock-${epic.id}`} />
                                </Box>
                                {epic.barrier && (
                                    <Tooltip title="Barrier — holds the epics downstream of it until its work is closed">
                                        <Box component="span" data-testid={`lock-view-epic-barrier-${epic.id}`}
                                             sx={{ position: 'absolute', right: 4, bottom: 2, lineHeight: 0,
                                                   color: P.epicBarrier }}>
                                            <BarrierGateIcon closed stripe={P.barrierOn} light={P.barrierLight}
                                                             sx={{ fontSize: 16 }} />
                                        </Box>
                                    </Tooltip>
                                )}
                                <Box sx={{ position: 'absolute', left: 12, right: 24, bottom: 0 }}>
                                    <Refusal refusal={refusal} tierKey={tierKey} />
                                </Box>
                            </Box>
                        );
                    }))}
                </Box>
            </Box>
        </Box>
    );
}
