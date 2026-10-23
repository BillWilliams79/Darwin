// engineTestStore.js — the engine tables as a little live store for component
// tests (req #3760). The mocked query hooks read it through
// `useSyncExternalStore`, so a test can PUBLISH a new record or heartbeat and
// watch the mounted page follow it, the way the polled reads do in the app.

import { useSyncExternalStore } from 'react';

import fixture from './engineViewFixture.json';

const clone = (x) => JSON.parse(JSON.stringify(x));

let tables = null;
const listeners = new Set();

export function resetEngineStore(overrides = {}) {
    tables = {
        machines: clone(fixture.machines),
        pipelines: clone(fixture.pipelines),
        initiatives: clone(fixture.initiatives),
        epics: clone(fixture.epics),
        engine_states: clone(fixture.engine_states),
        engine_heartbeats: clone(fixture.engine_heartbeats),
        engine_decision_records: clone(fixture.engine_decision_records),
        engine_outcomes: clone(fixture.engine_outcomes),
        ...overrides,
    };
    listeners.forEach((l) => l());
}

export function updateEngineStore(fn) {
    tables = { ...tables, ...fn(tables) };
    listeners.forEach((l) => l());
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => tables;

export function useTable(name) {
    const t = useSyncExternalStore(subscribe, snapshot);
    return { data: t[name], isLoading: false, isError: false };
}

export function useTables() {
    return useSyncExternalStore(subscribe, snapshot);
}

/** The fixture's `now` as a Date. */
export const FIXTURE_NOW = new Date(`${fixture.now.replace(' ', 'T')}Z`);

resetEngineStore();
