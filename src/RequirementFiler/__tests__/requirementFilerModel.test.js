// Req #3811 — the popup requirement editor's pure half: the draft it starts
// from, when it can save, and the exact POST / PUT bodies.

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
    CARRIED_FIELDS, FILER_DEFAULT_SPEC, SPEC_LETTERS, buildPostBody, buildPutBody, carriedSettings, draftDirty,
    draftProblem, machineOptions, newRequirementDraft, savedValues, specCode, staleCategory, staleMachine,
    FILED_LIMIT, defaultProjectId, draftFromRow, withFiled,
} from '../requirementFilerModel';

const NOW = '2026-10-23T10:00:00.000Z';
// As the editor leaves a draft once its carried place has been checked.
const filled = (over = {}) => ({ ...newRequirementDraft(4, 862), title: '  Filer  ', defaultsUnchecked: [], ...over });

describe('requirementFilerModel (req #3811)', () => {
    it('starts from SRDOH, Any machine, where the last one was filed', () => {
        const d = newRequirementDraft(4, 862);
        expect(d).toMatchObject({ ...FILER_DEFAULT_SPEC, projectId: 4, category_fk: 862,
            machine_fk: null, affected_repos: '', title: '', description: '' });
        // No tracking flag (req #3982): the column's default decides.
        expect(d).not.toHaveProperty('tracking');
        expect(newRequirementDraft()).toMatchObject({ projectId: null, category_fk: null });
    });

    it('needs a title and a category, and never a blank enum', () => {
        expect(draftProblem(newRequirementDraft(4, 862))).toMatch(/title/);
        expect(draftProblem(filled({ category_fk: null }))).toMatch(/category/);
        expect(draftProblem(filled({ effort: '' }))).toMatch(/effort/);
        expect(draftProblem(filled())).toBe(null);
    });

    it('POSTs one object: trimmed, stamped, without blanks or the editor-only project', () => {
        const body = buildPostBody(filled({ requirement_status: 'development' }), NOW);
        expect(Array.isArray(body)).toBe(false);
        expect(body).toEqual({
            title: 'Filer', category_fk: 862,
            requirement_status: 'development', coordination_type: 'deployed', ai_model: 'opus', effort: 'high',
            started_at: NOW, completed_at: 'NULL', deferred_at: 'NULL',
        });
        const full = buildPostBody(filled({ description: 'd', machine_fk: 3, affected_repos: ' Darwin ', tracking: 1 }), NOW);
        expect(full).toMatchObject({ description: 'd', machine_fk: 3, affected_repos: 'Darwin' });
        // A stray tracking value (an older build's draft) is never sent (req #3982).
        expect(full).not.toHaveProperty('tracking');
        expect(full).not.toHaveProperty('projectId');
        // A blank enum is left out, never sent (req #3432).
        expect(buildPostBody(filled({ ai_model: '' }), NOW)).not.toHaveProperty('ai_model');
    });

    it('PUTs an array of one row carrying only what changed', () => {
        const saved = savedValues(filled({ machine_fk: 3, affected_repos: 'Darwin' }));
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin' }), saved, NOW)).toBe(null);
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin', title: 'New' }), saved, NOW))
            .toEqual([{ id: 9, title: 'New' }]);
        // Clearing machine and repos sends the 'NULL' sentinel.
        expect(buildPutBody(9, filled(), saved, NOW)).toEqual([{ id: 9, machine_fk: 'NULL', affected_repos: 'NULL' }]);
        // A status change re-derives the timestamps (req #3244).
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin', requirement_status: 'met' }), saved, NOW))
            .toEqual([{ id: 9, requirement_status: 'met', started_at: 'NULL', completed_at: NOW, deferred_at: 'NULL' }]);
        // Moving project alone sends nothing; the category it lands in does.
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin', projectId: 5 }), saved, NOW)).toBe(null);
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin', category_fk: 900 }), saved, NOW))
            .toEqual([{ id: 9, category_fk: 900 }]);
        // A blank enum is never sent, even as a change.
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin', effort: '' }), saved, NOW)).toBe(null);
    });

    it('is dirty until saved, then only when something changed', () => {
        const d = filled();
        expect(draftDirty(d, null, null)).toBe(true);
        expect(draftDirty(d, 9, savedValues(d))).toBe(false);
        expect(draftDirty({ ...d, title: 'Other' }, 9, savedValues(d))).toBe(true);
        // Tracking is not the editor's (req #3982): it never makes a save.
        expect(draftDirty({ ...d, tracking: 1 }, 9, savedValues(d))).toBe(false);
        expect(buildPutBody(9, { ...d, tracking: 1 }, { ...savedValues(d), tracking: 0 }, NOW)).toBe(null);
        expect(draftDirty(null, null, null)).toBe(false);
    });

    it('offers open machines in sort order, and keeps a closed pin visible', () => {
        const machines = [
            { id: 1, title: 'Zed', sort_order: null }, { id: 2, title: 'Mac', sort_order: 1 },
            { id: 3, title: 'Old', closed: 1 },
        ];
        expect(machineOptions(machines, null).map(o => o.value)).toEqual([2, 1]);
        expect(machineOptions(machines, 3).at(-1)).toEqual({ value: 3, label: 'Old (closed)' });
        expect(machineOptions(undefined, null)).toEqual([]);
    });
});

// Req #3815 — a new requirement starts with the last one's settings (SRDOH
// before any), and the editor shows them as their spec code.
describe('the last settings and the spec code (req #3815)', () => {
    it('a never-set setting is SRDOH on Any machine; a carried one wins; the place is the last filed', () => {
        expect(newRequirementDraft(1, 10, {})).toMatchObject({ ...FILER_DEFAULT_SPEC, coordination_type: 'deployed',
            machine_fk: null, projectId: 1, category_fk: 10, defaultsUnchecked: ['category'] });
        expect(newRequirementDraft(null, null, {}).defaultsUnchecked).toEqual([]);
        const d = newRequirementDraft(1, 10, { effort: 'low', ai_model: '', machine_fk: 2, tracking: 1,
            seatEpicId: 300, projectId: 9 });
        expect(d).toMatchObject({ effort: 'low', ai_model: 'opus', machine_fk: 2, projectId: 1, category_fk: 10 });
        // Only what the form shows is carried — never a seat, a place, or a
        // tracking flag an older build's `defaults` still holds (req #3982).
        expect(d).not.toHaveProperty('seatEpicId');
        expect(d).not.toHaveProperty('tracking');
        // The carried place and machine are checked against live data first, which holds File.
        expect(d.defaultsUnchecked).toEqual(['category', 'machine']);
        expect(draftProblem({ ...d, title: 'x' })).toBe('Checking the last settings…');
    });

    it('carries the settings the form shows, from what was saved', () => {
        const saved = savedValues(filled({ requirement_status: 'approved', machine_fk: 3, tracking: 1 }));
        expect(carriedSettings(saved)).toEqual({ requirement_status: 'approved', coordination_type: 'deployed',
            ai_model: 'opus', effort: 'high', machine_fk: 3 });
        expect(Object.keys(carriedSettings(saved))).toEqual([...CARRIED_FIELDS]);
    });

    it('a carried place that closed is stale; unknown until its reads land', () => {
        const projects = [{ id: 4 }];
        const categories = [{ id: 862 }];
        expect(staleCategory({ projectId: 4, category_fk: 862 }, projects, categories)).toBe(null);
        expect(staleCategory({ projectId: 4, category_fk: 1 }, projects, categories)).toEqual({ project: false, text: 'is closed or deleted' });
        expect(staleCategory({ projectId: 9, category_fk: 1 }, projects, undefined)).toEqual({ project: true, text: 'is closed or deleted' });
        expect(staleCategory({ projectId: 4, category_fk: 862 }, undefined, undefined)).toBe(undefined);
        expect(staleCategory({ projectId: 4, category_fk: 862 }, projects, undefined, true)).toEqual({ project: false, text: 'could not be checked' });
        expect(staleCategory({ category_fk: null }, undefined, undefined)).toBe(null);
        // A category with no project cannot be read, so it is never waited on.
        expect(staleCategory({ projectId: null, category_fk: 862 }, undefined, undefined)).toEqual({ project: false, text: 'could not be checked' });
    });

    it('the spec code is the four launch fields\' letters', () => {
        expect(specCode(FILER_DEFAULT_SPEC)).toBe('SRDOH');
        expect(specCode({ requirement_status: 'swarm_ready', coordination_type: 'implemented', ai_model: 'sonnet', effort: 'medium' }))
            .toBe('SRISM');
        expect(specCode({ requirement_status: 'development', coordination_type: 'discuss', ai_model: 'fable', effort: 'ultracode' }))
            .toBe('DVCFU');
        expect(specCode({})).toBe('?????');
    });

    it('its letter table is darwin-mcp\'s (services/requirement_spec.py), when the workspace has it', () => {
        const py = path.resolve(__dirname, '../../../../darwin-mcp/services/requirement_spec.py');
        if (!fs.existsSync(py)) return;      // a Darwin checkout on its own
        const src = fs.readFileSync(py, 'utf8');
        const table = (name) => Object.fromEntries([...src.match(new RegExp(`${name} = \\{([^}]*)\\}`))[1]
            .matchAll(/'(\w+)': '(\w+)'/g)].map(m => [m[1], m[2]]));
        expect(SPEC_LETTERS.requirement_status).toEqual(table('STATUS_CODES'));
        expect(SPEC_LETTERS.coordination_type).toEqual(table('COORDINATION_CODES'));
        expect(SPEC_LETTERS.ai_model).toEqual(table('MODEL_CODES'));
        expect(SPEC_LETTERS.effort).toEqual(table('EFFORT_CODES'));
    });

    it('a carried machine that closed or went is stale; unknown until its read lands', () => {
        const machines = [{ id: 2 }, { id: 3, closed: 1 }];
        expect(staleMachine({ machine_fk: 2 }, machines)).toBe(null);
        expect(staleMachine({ machine_fk: 3 }, machines)).toBe('closed');
        expect(staleMachine({ machine_fk: 8 }, machines)).toBe('no longer exists');
        expect(staleMachine({ machine_fk: 2 }, undefined)).toBe(undefined);
        expect(staleMachine({ machine_fk: null }, undefined)).toBe(null);
    });
});

describe('the filer\'s default project and its list (req #3830)', () => {
    it('a draft with no place starts in Darwin, else the only project, else none', () => {
        expect(defaultProjectId([{ id: 9, project_name: 'Other' }, { id: 4, project_name: ' darwin ' }])).toBe(4);
        expect(defaultProjectId([{ id: 9, project_name: 'Other' }])).toBe(9);
        expect(defaultProjectId([{ id: 9, project_name: 'Other' }, { id: 8, project_name: 'More' }])).toBe(null);
        expect(defaultProjectId([])).toBe(null);
        expect(defaultProjectId(undefined)).toBe(null);
    });

    it('a filed row reopens as a draft already saved — nothing to send, nothing to check', () => {
        const row = { id: 7, title: 'T', description: null, category_fk: 862, requirement_status: 'development',
            coordination_type: 'implemented', ai_model: 'opus', effort: 'high', machine_fk: null,
            affected_repos: null, tracking: '1' };
        const d = draftFromRow(row, 4);
        expect(d).toMatchObject({ title: 'T', description: '', projectId: 4, category_fk: 862,
            affected_repos: '', machine_fk: null, defaultsUnchecked: [], notice: null });
        // A container reopened keeps its flag: the editor never holds or sends it (req #3982).
        expect(d).not.toHaveProperty('tracking');
        expect(draftDirty(d, 7, savedValues(d))).toBe(false);
        expect(draftProblem(d)).toBe(null);
    });

    it('the list: a new id first, a known one keeps its place and takes its title, capped', () => {
        let l = withFiled([], 1, 'a');
        l = withFiled(l, 2, 'b');
        expect(l).toEqual([{ id: 2, title: 'b' }, { id: 1, title: 'a' }]);
        expect(withFiled(l, 1, 'A')).toEqual([{ id: 2, title: 'b' }, { id: 1, title: 'A' }]);
        let full = [];
        for (let i = 0; i < FILED_LIMIT + 3; i++) full = withFiled(full, i, `r${i}`);
        expect(full).toHaveLength(FILED_LIMIT);
        expect(full[0].id).toBe(FILED_LIMIT + 2);
    });
});
