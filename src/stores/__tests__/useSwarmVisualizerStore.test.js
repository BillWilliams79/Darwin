import { describe, it, expect } from 'vitest';
import {
    persistPartialize,
    migrateVisualizerState,
} from '../useSwarmVisualizerStore';

// req #2799 — `currentDate` is navigation state, not a saved preference. It must
// never round-trip through localStorage, so a stale date (e.g. a late-May day the
// elevator scrolled to) can never reload instead of today. These tests lock the
// two pure helpers that enforce that contract.

describe('persistPartialize (req #2799)', () => {
    it('drops currentDate from the persisted slice', () => {
        const out = persistPartialize({
            viewType: 'week',
            currentDate: '2026-05-22',
            beadWindow: '24h',
            sidewalkOn: false,
            elevatorOn: true,
            dataKey: 'coordination',
            titlesOn: true,
            completesOn: false,
        });
        expect(out).not.toHaveProperty('currentDate');
    });

    it('keeps every real UI preference', () => {
        const out = persistPartialize({
            viewType: 'week',
            currentDate: '2026-05-22',
            beadWindow: '36h',
            sidewalkOn: true,
            elevatorOn: true,
            dataKey: 'coordination',
            titlesOn: true,
            completesOn: true,
        });
        expect(out).toEqual({
            viewType: 'week',
            beadWindow: '36h',
            sidewalkOn: true,
            elevatorOn: true,
            dataKey: 'coordination',
            titlesOn: true,
            completesOn: true,
        });
    });

    it('does not mutate the input state', () => {
        const input = { viewType: 'day', currentDate: '2026-05-25' };
        persistPartialize(input);
        expect(input.currentDate).toBe('2026-05-25');
    });
});

describe('migrateVisualizerState (req #2799, req #2806)', () => {
    it('strips a stale persisted currentDate (the late-May affinity)', () => {
        const out = migrateVisualizerState({
            viewType: 'week',
            currentDate: '2026-05-23',
            beadWindow: '24h',
            sidewalkOn: false,
            elevatorOn: true,
            dataKey: 'category',
        });
        expect(out).not.toHaveProperty('currentDate');
    });

    it('strips a persisted vizKey (bead/swarm mode removed, req #2806)', () => {
        const out = migrateVisualizerState({
            viewType: 'week',
            currentDate: '2026-05-23',
            vizKey: 'bead',
            beadWindow: '24h',
        });
        expect(out).not.toHaveProperty('vizKey');
    });

    it('preserves preferences carried by an old (v2) blob', () => {
        const out = migrateVisualizerState({
            viewType: 'week',
            currentDate: '2026-05-22',
            beadWindow: '24h',
            sidewalkOn: false,
            elevatorOn: true,
            dataKey: 'coordination',
        });
        expect(out.viewType).toBe('week');
        expect(out.elevatorOn).toBe(true);
        expect(out.dataKey).toBe('coordination');
    });

    it('back-fills fields added after the persisted version', () => {
        // A v1 blob predating elevatorOn/dataKey/titlesOn/completesOn.
        const out = migrateVisualizerState({
            viewType: 'day',
            currentDate: '2026-05-25',
            beadWindow: '24h',
            sidewalkOn: false,
        });
        expect(out.elevatorOn).toBe(false);
        expect(out.dataKey).toBe('category');
        expect(out.titlesOn).toBe(false);
        expect(out.completesOn).toBe(false);
    });

    it('normalizes an unknown dataKey to category', () => {
        const out = migrateVisualizerState({ dataKey: 'bogus' });
        expect(out.dataKey).toBe('category');
    });

    it('tolerates null/undefined persisted state', () => {
        expect(() => migrateVisualizerState(null)).not.toThrow();
        expect(() => migrateVisualizerState(undefined)).not.toThrow();
        const out = migrateVisualizerState(null);
        expect(out).not.toHaveProperty('currentDate');
        expect(out.dataKey).toBe('category');
    });
});
