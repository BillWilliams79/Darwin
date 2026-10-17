// req #3573 — spec codes. The letter table here is pinned identically in
// darwin-mcp/tests/test_requirement_spec.py; change both or neither.
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_REQUIREMENT_SPEC, STATUS_CODES, COORDINATION_CODES, MODEL_CODES, EFFORT_CODES,
    specCode, parseSpecCode, specLabel,
} from '../requirementSpec';

describe('requirement spec codes', () => {
    it('the default requirement is SRIOH', () => {
        expect(DEFAULT_REQUIREMENT_SPEC).toEqual({
            requirement_status: 'swarm_ready', coordination_type: 'implemented',
            ai_model: 'opus', effort: 'high',
        });
        expect(specCode(DEFAULT_REQUIREMENT_SPEC)).toBe('SRIOH');
    });

    it('SRISM is the lower-cost spec', () => {
        expect(parseSpecCode('SRISM')).toEqual({
            requirement_status: 'swarm_ready', coordination_type: 'implemented',
            ai_model: 'sonnet', effort: 'medium',
        });
    });

    it('pins the letter table', () => {
        expect(STATUS_CODES).toEqual({ authoring: 'AU', approved: 'AP', swarm_ready: 'SR',
            development: 'DV', met: 'MT', deferred: 'DF', wontfix: 'WF' });
        expect(COORDINATION_CODES).toEqual({ discuss: 'C', planned: 'P', implemented: 'I', deployed: 'D' });
        expect(MODEL_CODES).toEqual({ haiku: 'H', sonnet: 'S', opus: 'O', fable: 'F' });
        expect(EFFORT_CODES).toEqual({ low: 'L', medium: 'M', high: 'H', xhigh: 'X', ultracode: 'U' });
    });

    it('round-trips every combination', () => {
        for (const requirement_status of Object.keys(STATUS_CODES))
            for (const coordination_type of Object.keys(COORDINATION_CODES))
                for (const ai_model of Object.keys(MODEL_CODES))
                    for (const effort of Object.keys(EFFORT_CODES)) {
                        const spec = { requirement_status, coordination_type, ai_model, effort };
                        expect(parseSpecCode(specCode(spec))).toEqual(spec);
                    }
    });

    it('parses case-insensitively and trims', () => {
        expect(parseSpecCode('  sriOh ')).toEqual(DEFAULT_REQUIREMENT_SPEC);
    });

    it('rejects anything that is not exactly a valid code', () => {
        for (const bad of ['', 'SRIO', 'SRIOHH', 'ZZIOH', 'SRZOH', 'SRIZH', 'SRIOZ', null, undefined, 42]) {
            expect(parseSpecCode(bad)).toBeNull();
        }
    });

    it('never borrows a default for a missing field', () => {
        expect(specCode({ requirement_status: 'authoring', coordination_type: 'deployed' })).toBe('AUD??');
        expect(specCode(null)).toBe('?????');
    });

    it('reads a spec out long-form', () => {
        expect(specLabel(DEFAULT_REQUIREMENT_SPEC)).toBe('Swarm Ready · Implemented · Opus · High');
        expect(specLabel(null)).toBe('');
    });
});
