// The merged Requirement column's label (req #3455 polish).
//
// Pinned because the format is a spec, not a preference: `NNNN - <title>` with
// the title clipped to 35 characters, which is what the column width was sized
// against. A change to either without the other produces an ellipsis on every
// long row or a column of dead space.

import { describe, it, expect } from 'vitest';
import { reqIdOf, requirementLabel } from '../SessionsView';

describe('reqIdOf', () => {
    it('reads the id out of a requirement source_ref', () => {
        expect(reqIdOf('requirement:3455')).toBe('3455');
    });

    it('accepts the legacy priority: prefix', () => {
        // Pre-#2038 rows still carry it and must keep linking.
        expect(reqIdOf('priority:912')).toBe('912');
    });

    it('returns null for anything else', () => {
        expect(reqIdOf('issue:42')).toBeNull();
        expect(reqIdOf('')).toBeNull();
        expect(reqIdOf(null)).toBeNull();
        expect(reqIdOf('requirement:not-a-number')).toBeNull();
    });
});

describe('requirementLabel', () => {
    it('joins id and title as "NNNN - title"', () => {
        expect(requirementLabel({ source_ref: 'requirement:3455', title: 'Short title' }))
            .toBe('3455 - Short title');
    });

    it('shows the WHOLE title — no cap', () => {
        // It was clipped to 35, then 70; each cap was a guess at how much of a
        // title matters. The cell wraps and the row grows instead.
        const long = 'A'.repeat(200);
        expect(requirementLabel({ source_ref: 'requirement:3455', title: long }))
            .toBe(`3455 - ${long}`);
    });

    it('falls back to task_name when there is no title', () => {
        expect(requirementLabel({ source_ref: 'requirement:7', title: null, task_name: 'tn' }))
            .toBe('7 - tn');
    });

    it('shows the bare title when the session names no requirement', () => {
        // An issue-sourced session has a title worth reading and nothing to link.
        expect(requirementLabel({ source_ref: 'issue:9', title: 'Some work' }))
            .toBe('Some work');
    });

    it('shows the bare id when there is no title at all', () => {
        expect(requirementLabel({ source_ref: 'requirement:88', title: null, task_name: null }))
            .toBe('88');
    });
});
