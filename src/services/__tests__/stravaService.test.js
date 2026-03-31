import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the strava config before importing the service
vi.mock('../../config/strava', () => ({
    STRAVA_CONFIG: {
        clientId: '12345',
        clientSecret: 'test_secret',
        authorizeUrl: 'https://www.strava.com/oauth/authorize',
        tokenUrl: 'https://www.strava.com/oauth/token',
        apiBase: 'https://www.strava.com/api/v3',
        scopes: 'activity:read_all,profile:read_all',
        get redirectUri() { return 'https://localhost:3000/maps/import'; },
    },
}));

// Provide localStorage for node test environment
const store = {};
const mockLocalStorage = {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: vi.fn(() => { for (const k in store) delete store[k]; }),
};
vi.stubGlobal('localStorage', mockLocalStorage);

import {
    buildAuthorizeUrl,
    cacheTokensLocally,
    getCachedTokens,
    clearCachedTokens,
} from '../stravaService';

describe('buildAuthorizeUrl', () => {
    it('builds a valid Strava authorize URL', () => {
        const url = buildAuthorizeUrl();
        expect(url).toContain('https://www.strava.com/oauth/authorize?');
        expect(url).toContain('client_id=12345');
        expect(url).toContain('redirect_uri=');
        expect(url).toContain('response_type=code');
        expect(url).toContain('scope=activity%3Aread_all%2Cprofile%3Aread_all');
        expect(url).toContain('approval_prompt=auto');
    });
});

describe('localStorage cache', () => {
    beforeEach(() => {
        mockLocalStorage.clear();
    });

    it('caches and retrieves tokens', () => {
        const tokens = {
            access_token: 'abc123',
            refresh_token: 'refresh456',
            expires_at: 1700000000,
            athlete: { id: 1, firstname: 'Test', lastname: 'User' },
        };
        cacheTokensLocally(tokens);
        const cached = getCachedTokens();
        expect(cached.access_token).toBe('abc123');
        expect(cached.refresh_token).toBe('refresh456');
        expect(cached.expires_at).toBe(1700000000);
        expect(cached.athlete).toEqual({ id: 1, firstname: 'Test', lastname: 'User' });
    });

    it('returns null when no tokens cached', () => {
        expect(getCachedTokens()).toBeNull();
    });

    it('clears cached tokens', () => {
        cacheTokensLocally({
            access_token: 'abc', refresh_token: 'ref', expires_at: 123,
        });
        clearCachedTokens();
        expect(getCachedTokens()).toBeNull();
    });

    it('handles tokens without athlete data', () => {
        cacheTokensLocally({
            access_token: 'abc', refresh_token: 'ref', expires_at: 123,
        });
        const cached = getCachedTokens();
        expect(cached.access_token).toBe('abc');
        expect(cached.athlete).toBeNull();
    });
});
