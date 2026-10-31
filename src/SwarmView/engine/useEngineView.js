// useEngineView.js — the reads behind the engine view (req #3760).
//
// Every read goes through the query factory (`hooks/factory/devopsQueries.js`)
// over Lambda-Rest — the data contract's four tables plus the small whole-app
// dictionaries that put names on ids (machines, plans, initiatives, epics).
//
// POLLED, because the acceptance is that the page shows the latest decision
// EACH CYCLE as new records arrive: the engine publishes at most once per 60 s
// (its base interval) and backs off to 300 s when quiet (req #4022), so the
// live tables refetch every POLL_MS — 30 s, which still shows every cycle at
// the 60 s base interval (req #4122). A full decision record is
// content-addressed — its id is the hash of its body — so once read it never
// changes and is cached for good (`staleTime: Infinity`).

import { useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { ENGINE_RECORD_FULL_FIELDS } from '../../hooks/factory/devopsQueries';
import { fetchEntity } from '../../hooks/factory/createEntityQueries';
import {
    useAllInitiatives, useAllPipelineEpics, useAllPipelines, useEngineDecisionRecord,
    useEngineDecisionRecords, useEngineDecisionRecordsByPipeline, useEngineHeartbeats,
    useEngineOutcomesByRecord, useEngineStates, useMachines,
} from '../../hooks/useDataQueries';
import { assembleEngines, enginesForPipeline, parseJsonColumn } from './engineModel';

export const POLL_MS = 30000;
const CLOCK_MS = 5000;

/** A `Date` that moves every `intervalMs`, so ages count up between polls. */
export function useNow(intervalMs = CLOCK_MS) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), intervalMs);
        return () => clearInterval(t);
    }, [intervalMs]);
    return now;
}

const byId = (rows) => new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]));

/**
 * Engines, machine-wide (`pipelineId` undefined) or in one plan, with the
 * dictionaries that name them. `errors` lists every read that failed — the
 * page says so rather than rendering a partial answer as the whole one.
 */
export function useEngineView({ pipelineId } = {}) {
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const scoped = pipelineId != null;
    const poll = { refetchInterval: POLL_MS };

    const states = useEngineStates(creatorFk, poll);
    const beats = useEngineHeartbeats(creatorFk, poll);
    const allRecords = useEngineDecisionRecords(creatorFk, { ...poll, enabled: !scoped });
    const planRecords = useEngineDecisionRecordsByPipeline(creatorFk, pipelineId,
        { ...poll, enabled: scoped });
    const records = scoped ? planRecords : allRecords;
    const machines = useMachines(creatorFk);
    const pipelines = useAllPipelines(creatorFk);
    const initiatives = useAllInitiatives(creatorFk);
    const epics = useAllPipelineEpics(creatorFk);
    const now = useNow();

    const engines = useMemo(() => {
        const all = assembleEngines({ states: states.data, heartbeats: beats.data,
            records: records.data, now });
        return scoped ? enginesForPipeline(all, pipelineId) : all;
    }, [states.data, beats.data, records.data, now, scoped, pipelineId]);

    const names = useMemo(() => ({
        machines: byId(machines.data),
        pipelines: byId(pipelines.data),
        initiatives: byId(initiatives.data),
        epics: byId(epics.data),
    }), [machines.data, pipelines.data, initiatives.data, epics.data]);

    const errors = [
        states.isError && 'engine states',
        beats.isError && 'engine heartbeats',
        records.isError && 'decision records',
        machines.isError && 'machines',
    ].filter(Boolean);

    return {
        engines,
        names,
        machinesList: machines.data || [],
        now,
        isLoading: states.isLoading || beats.isLoading || records.isLoading,
        errors,
    };
}

/** One decision record's full body + its outcome rows, by record ROW id. */
export function useEngineRecord(rowId, { live = false, withOutcomes = true } = {}) {
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const full = useEngineDecisionRecord(creatorFk, rowId, {
        fields: ENGINE_RECORD_FULL_FIELDS, staleTime: Infinity, enabled: rowId != null });
    // Outcomes move after the record is written (the executor answers it), so
    // they poll while the record is the live one, and are read once otherwise.
    const outcomes = useEngineOutcomesByRecord(creatorFk, rowId, {
        enabled: withOutcomes && rowId != null, ...(live ? { refetchInterval: POLL_MS } : {}) });
    const record = full.data ? parseJsonColumn(full.data.record) : null;
    return {
        row: full.data || null,
        record,
        outcomes: outcomes.data || [],
        isLoading: full.isLoading,
        isError: full.isError,
        outcomesError: outcomes.isError,
    };
}

/**
 * `{id: {title, requirement_status}}` for the requirement ids on screen — one
 * IN read, keyed by the sorted id list so a cycle with the same queue reuses it.
 */
export function useRequirementTitles(ids) {
    const { darwinUri } = useContext(AppContext);
    const { profile, idToken } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const wanted = useMemo(() => [...new Set((ids || []).filter((x) => Number.isInteger(x)))]
        .sort((a, b) => a - b), [ids]);
    const query = useQuery({
        queryKey: ['requirements', creatorFk, { engineView: wanted.join(',') }],
        queryFn: () => fetchEntity(
            `${darwinUri}/requirements?id=(${wanted.join(',')})&fields=id,title,requirement_status`,
            idToken),
        enabled: !!creatorFk && !!idToken && wanted.length > 0,
        staleTime: 60000,
    });
    return useMemo(() => byId(query.data), [query.data]);
}
