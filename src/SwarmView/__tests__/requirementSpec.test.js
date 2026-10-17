// req #3573 — the default requirement. The spec-code letter table lives only in
// darwin-mcp/services/requirement_spec.py since req #3595 (input shorthand, not a field).
import { describe, it, expect } from 'vitest';
import { DEFAULT_REQUIREMENT_SPEC } from '../requirementSpec';

describe('default requirement', () => {
    it('is swarm_ready / implemented / opus / high (SRIOH)', () => {
        expect(DEFAULT_REQUIREMENT_SPEC).toEqual({
            requirement_status: 'swarm_ready', coordination_type: 'implemented',
            ai_model: 'opus', effort: 'high',
        });
    });
});
