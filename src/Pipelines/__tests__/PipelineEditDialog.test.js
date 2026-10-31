// Req #3853 — the pipeline editor sends ONLY what changed, so a field left
// alone is never written (and a row read without one is never blanked).

import { describe, it, expect } from 'vitest';
import { pipelineEditFields } from '../PipelineEditDialog';

const ROW = { id: 7, title: 'Agent Harness', description: 'Why it exists', machine_fk: 4 };
const form = (over = {}) => ({
    title: ROW.title, description: ROW.description, machineFk: ROW.machine_fk, ...over,
});

describe('pipelineEditFields', () => {
    it('nothing changed is an empty update', () => {
        expect(pipelineEditFields(ROW, form())).toEqual({ fields: {} });
    });

    it('a changed title alone sends the title alone, trimmed', () => {
        expect(pipelineEditFields(ROW, form({ title: '  New name ' })))
            .toEqual({ fields: { title: 'New name' } });
    });

    it('a cleared goal is the REST clear sentinel; a changed one is the text', () => {
        expect(pipelineEditFields(ROW, form({ description: '   ' })).fields)
            .toEqual({ description: 'NULL' });
        expect(pipelineEditFields(ROW, form({ description: 'New goal' })).fields)
            .toEqual({ description: 'New goal' });
    });

    it('Any clears the machine; another machine is its id', () => {
        expect(pipelineEditFields(ROW, form({ machineFk: '' })).fields).toEqual({ machine_fk: 'NULL' });
        expect(pipelineEditFields(ROW, form({ machineFk: 5 })).fields).toEqual({ machine_fk: 5 });
        expect(pipelineEditFields({ ...ROW, machine_fk: null }, form({ machineFk: '' })).fields)
            .toEqual({});
    });

    it('a row read without a description is not blanked by an untouched save', () => {
        const row = { id: 7, title: 'T', machine_fk: null };
        expect(pipelineEditFields(row, { title: 'T', description: '', machineFk: '' }))
            .toEqual({ fields: {} });
    });

    it('refuses an empty title and the NULL sentinel', () => {
        expect(pipelineEditFields(ROW, form({ title: '  ' })).problem).toBe('Title is required');
        expect(pipelineEditFields(ROW, form({ title: 'NULL' })).problem).toMatch(/sentinel/);
        expect(pipelineEditFields(ROW, form({ description: ' NULL ' })).problem).toMatch(/sentinel/);
    });

    // req #3965 — the Status field: all seven values, sent only when changed.
    it('a changed status sends pipeline_status alone; an unchanged or omitted one sends nothing', () => {
        const row = { ...ROW, pipeline_status: 'authoring' };
        expect(pipelineEditFields(row, form({ status: 'orchestrating' })))
            .toEqual({ fields: { pipeline_status: 'orchestrating' } });
        expect(pipelineEditFields(row, form({ status: 'authoring' }))).toEqual({ fields: {} });
        expect(pipelineEditFields(row, form())).toEqual({ fields: {} });
    });

    it('refuses a status outside the seven values', () => {
        const row = { ...ROW, pipeline_status: 'authoring' };
        expect(pipelineEditFields(row, form({ status: 'paused' })).problem).toMatch(/Unknown status/);
    });
});

// req #4128 — the Lock control and the Sort order field, sent only when changed.
describe('pipelineEditFields — lock and sort order (req #4128)', () => {
    const row = { ...ROW, locked: 0, sort_order: 2 };
    it('an omitted lock or sort order sends nothing', () => {
        expect(pipelineEditFields(row, form())).toEqual({ fields: {} });
    });
    it('a changed lock sends 1/0; an unchanged one nothing', () => {
        expect(pipelineEditFields(row, form({ locked: true })).fields).toEqual({ locked: 1 });
        expect(pipelineEditFields({ ...row, locked: 1 }, form({ locked: false })).fields)
            .toEqual({ locked: 0 });
        expect(pipelineEditFields(row, form({ locked: false })).fields).toEqual({});
    });
    it('a sort order is an integer; blank keeps the place; junk is refused', () => {
        expect(pipelineEditFields(row, form({ sortOrder: ' 7 ' })).fields).toEqual({ sort_order: 7 });
        expect(pipelineEditFields(row, form({ sortOrder: '2' })).fields).toEqual({});
        expect(pipelineEditFields(row, form({ sortOrder: '' })).fields).toEqual({});
        expect(pipelineEditFields(row, form({ sortOrder: '1.5' })).problem).toMatch(/whole number/);
        expect(pipelineEditFields(row, form({ sortOrder: '9999999999' })).problem).toMatch(/between/);
    });
});
