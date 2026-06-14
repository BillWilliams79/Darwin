import { describe, it, expect } from 'vitest';
import {
    persistPartialize,
    migrateVisualizerState,
} from '../useSwarmVisualizerStore';

// req #2799 — `currentDate` is navigation state, not a saved preference. It must
// never round-trip through localStorage, so a stale date can never reload instead
// of today. req #2844 retired the Classic TimeSeriesView, removing konvaOn /
// viewType / beadWindow / sidewalkOn / elevatorOn from the schema. These tests
// lock the two pure helpers that enforce both contracts.

describe('persistPartialize (req #2799)', () => {
    it('drops currentDate from the persisted slice', () => {
        const out = persistPartialize({
            currentDate: '2026-05-22',
            dataKey: 'coordination',
            titlesOn: true,
            completesOn: false,
        });
        expect(out).not.toHaveProperty('currentDate');
    });

    it('keeps every real UI preference', () => {
        const out = persistPartialize({
            currentDate: '2026-05-22',
            dataKey: 'coordination',
            titlesOn: true,
            completesOn: true,
            phasesOn: true,
            konvaWide: false,
        });
        expect(out).toEqual({
            dataKey: 'coordination',
            titlesOn: true,
            completesOn: true,
            phasesOn: true,
            konvaWide: false,
        });
    });

    it('does not mutate the input state', () => {
        const input = { dataKey: 'category', currentDate: '2026-05-25' };
        persistPartialize(input);
        expect(input.currentDate).toBe('2026-05-25');
    });

    it('keeps konvaWide but strips the transient viewResetTick (req #2841)', () => {
        const out = persistPartialize({
            currentDate: '2026-06-13',
            konvaWide: false, viewResetTick: 7,
        });
        expect(out.konvaWide).toBe(false);
        expect(out).not.toHaveProperty('viewResetTick');
        expect(out).not.toHaveProperty('currentDate');
    });
});

describe('migrateVisualizerState (req #2799, req #2806, req #2844)', () => {
    it('strips a stale persisted currentDate (the late-May affinity)', () => {
        const out = migrateVisualizerState({
            currentDate: '2026-05-23',
            dataKey: 'category',
        });
        expect(out).not.toHaveProperty('currentDate');
    });

    it('strips a persisted vizKey (bead/swarm mode removed, req #2806)', () => {
        const out = migrateVisualizerState({
            currentDate: '2026-05-23',
            vizKey: 'bead',
        });
        expect(out).not.toHaveProperty('vizKey');
    });

    it('strips the retired Classic fields (req #2844)', () => {
        // A pre-#2844 blob still carrying the Classic TimeSeriesView modes.
        const out = migrateVisualizerState({
            konvaOn: false,
            viewType: 'week',
            beadWindow: '36h',
            sidewalkOn: true,
            elevatorOn: true,
            dataKey: 'coordination',
        });
        expect(out).not.toHaveProperty('konvaOn');
        expect(out).not.toHaveProperty('viewType');
        expect(out).not.toHaveProperty('beadWindow');
        expect(out).not.toHaveProperty('sidewalkOn');
        expect(out).not.toHaveProperty('elevatorOn');
        // Surviving preferences carry through.
        expect(out.dataKey).toBe('coordination');
    });

    it('preserves the surviving preferences carried by an old blob', () => {
        const out = migrateVisualizerState({
            currentDate: '2026-05-22',
            dataKey: 'coordination',
            titlesOn: true,
            completesOn: true,
            phasesOn: true,
            konvaWide: false,
        });
        expect(out.dataKey).toBe('coordination');
        expect(out.titlesOn).toBe(true);
        expect(out.completesOn).toBe(true);
        expect(out.phasesOn).toBe(true);
        expect(out.konvaWide).toBe(false);
    });

    it('back-fills fields added after the persisted version', () => {
        // An old blob predating titlesOn/completesOn/phasesOn/konvaWide.
        const out = migrateVisualizerState({
            dataKey: 'category',
        });
        expect(out.dataKey).toBe('category');
        expect(out.titlesOn).toBe(false);
        expect(out.completesOn).toBe(false);
        // req #2823 — phasesOn back-fills to false.
        expect(out.phasesOn).toBe(false);
        // req #2841 — konvaWide back-fills to true (36h mid zoom).
        expect(out.konvaWide).toBe(true);
    });

    it('preserves a persisted phasesOn=true (req #2823)', () => {
        const out = migrateVisualizerState({ phasesOn: true });
        expect(out.phasesOn).toBe(true);
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
        expect(out.konvaWide).toBe(true);
    });
});
