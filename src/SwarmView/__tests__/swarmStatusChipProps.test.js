import { describe, it, expect } from 'vitest';
import { swarmStatusChipProps, swarmStatusLabel } from '../swarmStatusChipProps';

describe('swarmStatusChipProps', () => {
    const ALL_STATUSES = ['starting', 'waiting', 'planning', 'active', 'review', 'completing', 'completed', 'paused'];

    it('returns non-default props for every known status', () => {
        for (const status of ALL_STATUSES) {
            const props = swarmStatusChipProps(status);
            // Every known status must NOT return { color: 'default' }
            expect(props.color).not.toBe('default');
        }
    });

    it('returns distinct props for statuses with explicit bgcolor', () => {
        // Statuses that use sx.bgcolor should each have a unique color
        const bgStatuses = ['active', 'review', 'paused', 'waiting', 'planning'];
        const bgColors = bgStatuses.map(s => swarmStatusChipProps(s).sx?.bgcolor);
        expect(new Set(bgColors).size).toBe(bgStatuses.length);
    });

    it('returns { color: "default" } for unknown status', () => {
        expect(swarmStatusChipProps('bogus')).toEqual({ color: 'default' });
        expect(swarmStatusChipProps(undefined)).toEqual({ color: 'default' });
    });

    it('returns correct props for active', () => {
        expect(swarmStatusChipProps('active')).toEqual({ sx: { bgcolor: '#4caf50', color: '#fff' } });
    });

    it('returns correct props for waiting', () => {
        expect(swarmStatusChipProps('waiting')).toEqual({ sx: { bgcolor: '#ffb74d', color: '#000' } });
    });

    it('returns correct props for planning', () => {
        expect(swarmStatusChipProps('planning')).toEqual({ sx: { bgcolor: '#4fc3f7', color: '#000' } });
    });

    it('returns correct props for review', () => {
        expect(swarmStatusChipProps('review')).toEqual({ sx: { bgcolor: '#ce93d8', color: '#000' } });
    });

    it('returns correct props for paused', () => {
        expect(swarmStatusChipProps('paused')).toEqual({ sx: { bgcolor: '#f0d000', color: '#000' } });
    });

    it('returns MUI color "info" for starting', () => {
        expect(swarmStatusChipProps('starting')).toEqual({ color: 'info' });
    });

    it('returns MUI color "info" for completing', () => {
        expect(swarmStatusChipProps('completing')).toEqual({ color: 'info' });
    });

    it('returns MUI color "success" for completed', () => {
        expect(swarmStatusChipProps('completed')).toEqual({ color: 'success' });
    });
});

describe('swarmStatusLabel', () => {
    it('returns "Implementing" for active', () => {
        expect(swarmStatusLabel('active')).toBe('Implementing');
    });

    it('returns "Reviewing" for review', () => {
        expect(swarmStatusLabel('review')).toBe('Reviewing');
    });

    it('returns the status string as-is for most other statuses', () => {
        expect(swarmStatusLabel('waiting')).toBe('waiting');
        expect(swarmStatusLabel('planning')).toBe('planning');
        expect(swarmStatusLabel('starting')).toBe('starting');
        expect(swarmStatusLabel('completed')).toBe('completed');
        expect(swarmStatusLabel('paused')).toBe('paused');
    });

    it('returns "completing" for completing', () => {
        expect(swarmStatusLabel('completing')).toBe('completing');
    });
});
