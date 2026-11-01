// Req #4076 code review — the dev-only proxy-auth gateway signs requests with
// the developer's own identity, so it must never reach anything but darwin_dev
// and never sign a request another site made.

import { describe, it, expect } from 'vitest';
import { upstreamUrl, isCrossSite, parseCredentialsFile } from '../../../devtools/proxyAuthDevGateway.js';

const O = { apiBase: '/api', database: 'internal', upstreamBase: 'https://h.example/eng' };

describe('upstreamUrl — pinned to darwin_dev', () => {
    it('maps the internal database onto darwin_dev, query included', () => {
        expect(upstreamUrl('/api/internal/profiles?fields=id', O)).toBe('https://h.example/eng/darwin_dev/profiles?fields=id');
        expect(upstreamUrl('/api/internal', O)).toBe('https://h.example/eng/darwin_dev');
    });
    it.each([
        '/api/internal/%2e%2e/darwin/profiles',   // reached PRODUCTION before the fix
        '/api/internal/../darwin/profiles',
        '/api/internal/%2E%2E%2Fdarwin/profiles',
        '/api/internal/a/%2e/b',
        '/api/internal/%5c..%5cdarwin',
        '/api/internal/%zz',
    ])('refuses %s', (url) => {
        expect(upstreamUrl(url, O)).toBeNull();
    });
    it('refuses another database and a prefix look-alike', () => {
        expect(upstreamUrl('/api/darwin/profiles', O)).toBeNull();
        expect(upstreamUrl('/api/internalx/profiles', O)).toBeNull();
    });
});

describe('isCrossSite — only the dev server\'s own pages', () => {
    it('refuses a foreign Origin or a cross-site fetch', () => {
        expect(isCrossSite({ origin: 'https://evil.example' }, 'localhost:3000')).toBe(true);
        expect(isCrossSite({ 'sec-fetch-site': 'cross-site' }, 'localhost:3000')).toBe(true);
        expect(isCrossSite({ origin: 'null' }, 'localhost:3000')).toBe(true);
    });
    it('allows same-origin and header-less requests', () => {
        expect(isCrossSite({ origin: 'https://localhost:3000', 'sec-fetch-site': 'same-origin' }, 'localhost:3000')).toBe(false);
        expect(isCrossSite({}, 'localhost:3000')).toBe(false);
    });
});

it('parseCredentialsFile reads export lines, quoted or not, and runs nothing', () => {
    expect(parseCredentialsFile('export A=1\nB="two"\n# c\nexport C=\'x y\'\n')).toEqual({ A: '1', B: 'two', C: 'x y' });
});
