import { describe, it, expect } from 'vitest';
import { GROUP_PROFILE_KEY, GROUP_PROFILE_DEFAULT } from '../navConfig';

describe('req #3553 — AGENTS follows the Swarm profile toggle', () => {
    it('agents group is gated by app_swarm', () => {
        expect(GROUP_PROFILE_KEY.agents).toBe('app_swarm');
        expect(GROUP_PROFILE_DEFAULT.app_swarm).toBe(0);
    });
});
