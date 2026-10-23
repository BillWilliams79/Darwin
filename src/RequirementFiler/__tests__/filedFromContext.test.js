// @vitest-environment jsdom
//
// Req #3813 — where a requirement was filed from: what it reads, what it never
// carries (credentials), the surface's deep-link form and the size cap. Since
// req #3815 it is the `filedFrom` category of the debug capture (filedFromNow).

import { describe, it, expect, beforeEach } from 'vitest';

import {
    FILED_FROM_MAX_CHARS, REDACTED, captureFiledFrom, cleanQuery, filedFromNow, queryObject, redact,
    registerPageOptions, routeIds, surfaceOf, viewState,
} from '../filedFromContext';
import { topologyPageOptions } from '../../Systems/SystemsPage2';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl';

describe('filedFromContext (req #3813)', () => {
    beforeEach(() => localStorage.clear());

    it('the Surface line is path?query without the filer parameter or credentials', () => {
        expect(surfaceOf('/systems2', '?opt=tpu8t-datacenter-3d&filer=new')).toBe('/systems2?opt=tpu8t-datacenter-3d');
        expect(surfaceOf('/swarm/pipeline/2', '?filer=1&mode=plan')).toBe('/swarm/pipeline/2?mode=plan');
        expect(surfaceOf('/maps', '?code=abc&id_token=x&view=cards')).toBe('/maps?view=cards');
        expect(surfaceOf('/maps', '')).toBe('/maps');
        // A page's own surface wins.
        expect(surfaceOf('/systems2', '?opt=a', '/systems2?opt=b')).toBe('/systems2?opt=b');
    });

    it('never carries a credential: names dropped, JWT-shaped values replaced', () => {
        expect(cleanQuery('?a=1&access_token=x&state=s&b=2')).toBe('?a=1&b=2');
        expect(cleanQuery('#id_token=x', '#')).toBe('');
        expect(queryObject('?tag=a&tag=b&refreshToken=z')).toEqual({ tag: ['a', 'b'] });
        expect(redact({ idToken: 'x', nested: { password: 'p', ok: JWT, keep: 1 }, list: [JWT, 'fine'] }))
            .toEqual({ nested: { ok: REDACTED, keep: 1 }, list: [REDACTED, 'fine'] });
    });

    it('view state: the owning app\'s allowlisted keys only, persist envelope unwrapped', () => {
        localStorage.setItem('darwin-swarm-view', 'table');
        localStorage.setItem('darwin_show_closed', JSON.stringify({ state: { met: true, authoring: false }, version: 2 }));
        localStorage.setItem('darwin-swarm-pipelines-place', JSON.stringify({ idToken: JWT, page: 3 }));
        localStorage.setItem('darwin-profile', JSON.stringify({ userName: 'u' }));
        localStorage.setItem('CognitoIdentityServiceProvider.abc.idToken', JWT);
        localStorage.setItem('pkce_code_verifier', 'v');
        localStorage.setItem('topology.lastOpt', 'H');
        localStorage.setItem('darwin-plan-unseated-box-size', 'x'.repeat(5000));
        expect(viewState('swarm')).toEqual({
            'darwin-plan-unseated-box-size': '[5000 chars — not copied]',
            'darwin-swarm-pipelines-place': { page: 3 },
            'darwin-swarm-view': 'table',
            darwin_show_closed: { met: true, authoring: false },
        });
        expect(viewState('systems')).toEqual({ 'topology.lastOpt': 'H' });
        expect(viewState(null)).toEqual({});
    });

    it('record ids come from the path', () => {
        expect(routeIds('/swarm/pipeline/2')).toEqual({ pipeline: 2 });
        expect(routeIds('/swarm/requirement/3813/edit')).toEqual({ requirement: 3813 });
        expect(routeIds('/maps')).toEqual({});
    });

    it('holds the size cap: view state first (names kept), then the popups, then the URL alone', () => {
        const args = (search, store) => ({ location: { pathname: '/systems2', search, hash: '' }, profile: {},
            database: 'darwin', theme: null, popupId: 'requirement-filer', popupStore: { open: true, dock: null } });
        for (let i = 0; i < 40; i++) localStorage.setItem(`topology.k${i}`, 'v'.repeat(1900));
        const capped = filedFromNow(args('?opt=H'));
        expect(JSON.stringify(capped).length).toBeLessThanOrEqual(FILED_FROM_MAX_CHARS);
        const vs = capped.options.viewState;
        expect(Object.keys(vs)).toHaveLength(40);
        expect(Object.values(vs).filter(v => /over the size cap/.test(v)).length).toBeGreaterThan(0);
        expect(Object.values(vs).filter(v => v === 'v'.repeat(1900)).length).toBeGreaterThan(0);
        localStorage.clear();

        // A query too big for anything: the surface and URL alone, clipped.
        const huge = filedFromNow({ ...args(`?ids=${'1,'.repeat(9000)}`), location: { pathname: '/swarm', search: `?ids=${'1,'.repeat(9000)}`, hash: '' } });
        expect(JSON.stringify(huge).length).toBeLessThanOrEqual(FILED_FROM_MAX_CHARS);
        expect(huge.surface.startsWith('/swarm?ids=1,1,')).toBe(true);
        expect(huge.omitted).toMatch(/size cap/);
        expect(huge.options).toBeUndefined();
    });

    it('a JWT under any name — query value, bare hash, a page\'s own surface — never reaches the block', () => {
        const unregister = registerPageOptions(() => ({ options: {}, surface: `/systems2?opt=H&code=abc&state=xyz&t=${JWT}` }));
        const ctx = captureFiledFrom({ location: { pathname: '/maps', search: `?view=cards&invite=${JWT}`, hash: `#${JWT}` },
            profile: {}, database: 'darwin', theme: null, popupId: 'requirement-filer', popupStore: null });
        unregister();
        const text = JSON.stringify(ctx);
        expect(text).not.toContain('eyJ');
        expect(text).not.toMatch(/code=abc|state=xyz/);
        expect(ctx.surface).toBe('/systems2?opt=H');
        expect(ctx.url.full).toBe('/maps?view=cards');
    });

    it('a capture that throws still records the URL and says so', () => {
        const ctx = filedFromNow({ location: { pathname: '/maps', search: '?a=1&filer=1', hash: '' },
            get profile() { throw new Error('boom'); } });
        expect(ctx.surface).toBe('/maps?a=1');
        expect(ctx.url.full).toBe('/maps?a=1');
        expect(ctx.captureError).toBe('boom');
    });

    it('the topology page reports the view on screen, not the one in the URL', () => {
        const doc = document.implementation.createHTMLDocument('t');
        doc.body.className = 'dark opt-tpu8t-datacenter-3d';
        doc.body.innerHTML = '<h1 id="main-title">TPU v8t Data Center</h1>';
        const frame = { contentDocument: doc, contentWindow: { location: { search: '?opt=H&filer=1' } } };
        localStorage.setItem('topology.lastOpt', 'H');
        expect(topologyPageOptions(frame, '?opt=H&filer=1&layout=virgo')).toEqual({
            options: { opt: 'tpu8t-datacenter-3d', title: 'TPU v8t Data Center', frameQuery: '?opt=H&filer=1', storedOpt: 'H' },
            surface: '/systems2?opt=tpu8t-datacenter-3d&layout=virgo',
        });
        expect(topologyPageOptions(null, '?opt=H&filer=1').surface).toBe('/systems2?opt=H');
    });
});
