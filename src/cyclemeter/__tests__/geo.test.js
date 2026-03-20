import { describe, it, expect } from 'vitest';
import { haversineDistance } from '../geo';

describe('haversineDistance', () => {
    it('returns 0 for identical points', () => {
        expect(haversineDistance(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);
    });

    it('calculates known distance: SF to LA (~559 km)', () => {
        // San Francisco to Los Angeles
        const dist = haversineDistance(37.7749, -122.4194, 34.0522, -118.2437);
        expect(dist).toBeGreaterThan(558000);
        expect(dist).toBeLessThan(560000);
    });

    it('calculates short GPS distance (~10m)', () => {
        // Two points roughly 10 meters apart on the SF Bay Trail
        const dist = haversineDistance(33.90087, -118.41943, 33.9008, -118.41933);
        expect(dist).toBeGreaterThan(5);
        expect(dist).toBeLessThan(15);
    });

    it('handles equator crossing', () => {
        const dist = haversineDistance(1, 0, -1, 0);
        // ~222 km
        expect(dist).toBeGreaterThan(221000);
        expect(dist).toBeLessThan(223000);
    });

    it('handles meridian crossing', () => {
        const dist = haversineDistance(0, -1, 0, 1);
        // ~222 km at equator
        expect(dist).toBeGreaterThan(221000);
        expect(dist).toBeLessThan(223000);
    });
});
