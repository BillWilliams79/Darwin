// @vitest-environment jsdom
//
// Req #4076 — the internal product's BEHAVIOUR, with config/product.js mocked to
// what `vite build --mode internal` defines: proxy auth (no token sent, "who am
// I" from the API), the Topology + Swarm scope through navConfig's one
// visibility predicate, and the home route landing on Topology.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INTERNAL = vi.hoisted(() => ({
    PRODUCT: {
        productName: 'Topology', productTagline: '', apiBase: '/api',
        opsDatabase: 'internal', buildVizDatabase: null, authMode: 'proxy', prodBaseUrl: '',
    },
    PRODUCT_NAME: 'Topology', PRODUCT_TAGLINE: '', API_BASE: '/api', AUTH_MODE: 'proxy',
    PROD_BASE_URL: '', PROXY_AUTH: true,
    APP_SCOPE: { all: false, tasks: false, maps: false, systems: true, swarm: true, 'swarm-validate': false },
    SCOPE_ALL: false, HAS_TASKS: false, HAS_MAPS: false, HAS_SYSTEMS: true, HAS_SWARM: true,
    HAS_SWARM_VALIDATE: false,
}));
vi.mock('../product', () => INTERNAL);

const ok = (data) => ({ status: 200, json: async () => data });

beforeEach(() => { vi.stubEnv('VITE_DARWIN_DATABASE', 'internal'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); delete global.fetch; });

describe('RestApi in proxy auth', () => {
    it('sends NO Authorization header, whatever token a caller passes', async () => {
        global.fetch = vi.fn().mockResolvedValue(ok([]));
        const { default: call_rest_api, setAuthToken } = await import('../../RestApi/RestApi');
        setAuthToken('module-token');
        await call_rest_api('/api/internal/requirements', 'GET', '', 'caller-token');
        const [, init] = global.fetch.mock.calls[0];
        expect(init.headers).not.toHaveProperty('Authorization');
    });
});

describe('AppContext in the internal product', () => {
    it('builds every URI on same-origin /api with the internal database', async () => {
        const mod = await import('../../Context/AppContext');
        expect(mod.DEFAULT_DARWIN_URI).toBe('/api/internal');
        let ctx;
        const Probe = () => { ctx = React.useContext(mod.default); return null; };
        const root = createRoot(document.createElement('div'));
        act(() => root.render(<mod.AppContextProvider><Probe /></mod.AppContextProvider>));
        expect(ctx.darwinUri).toBe('/api/internal');
        expect(ctx.darwinOpsUri).toBe('/api/internal');
        expect(ctx.darwinBuildVizUri).toBeNull();
        act(() => root.unmount());
    });
});

describe('AuthContext in proxy auth — the API says who you are', () => {
    async function mountAuth() {
        const mod = await import('../../Context/AuthContext');
        let ctx;
        const Probe = () => { ctx = React.useContext(mod.default); return null; };
        const root = createRoot(document.createElement('div'));
        await act(async () => { root.render(<mod.AuthContextProvider><Probe /></mod.AuthContextProvider>); });
        await act(async () => { await Promise.resolve(); });
        return { mod, ctx: () => ctx, unmount: () => act(() => root.unmount()) };
    }

    it('reads the caller\'s own profiles row — no login, no Cognito', async () => {
        global.fetch = vi.fn().mockResolvedValue(ok([{ id: 'sub-1', name: 'Bill', email: 'b@x' }]));
        const { mod, ctx, unmount } = await mountAuth();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][0]).toBe('/api/internal/profiles');
        expect(ctx().authLoading).toBe(false);
        expect(ctx().profile).toMatchObject({ id: 'sub-1', userName: 'sub-1', sub: 'sub-1', name: 'Bill' });
        expect(ctx().idToken).toBe(mod.PROXY_SESSION);
        unmount();
    });

    it('names nobody when the server maps the login to no profile', async () => {
        global.fetch = vi.fn().mockResolvedValue({ status: 403, json: async () => 'FORBIDDEN' });
        const { ctx, unmount } = await mountAuth();
        expect(ctx().authLoading).toBe(false);
        expect(ctx().profile).toBeNull();
        expect(ctx().idToken).toBeNull();
        expect(ctx().authError).toBe(403);
        unmount();
    });

    it('more than one row is "nobody" — never whichever came first', async () => {
        global.fetch = vi.fn().mockResolvedValue(ok([{ id: 'a' }, { id: 'b' }]));
        const { ctx, unmount } = await mountAuth();
        expect(ctx().profile).toBeNull();
        expect(ctx().idToken).toBeNull();
        unmount();
    });

    it('an empty profiles list is also "nobody", not a crash', async () => {
        global.fetch = vi.fn().mockResolvedValue(ok([]));
        const { ctx, unmount } = await mountAuth();
        expect(ctx().profile).toBeNull();
        expect(ctx().authError).toBe(200);
        unmount();
    });
});

describe('navConfig in the internal product', () => {
    it('shows Topology (SYSTEMS), Swarm and Agents — nothing else', async () => {
        const { NAV_GROUPS, isGroupVisible } = await import('../../NavBar/navConfig');
        const visible = NAV_GROUPS.map(g => g.id).filter(id => isGroupVisible({}, id, null));
        expect(visible).toEqual(['systems', 'swarm', 'agents']);
    });

    it('its applications ignore the darwin.one profile toggles (Swarm defaults OFF there)', async () => {
        const { isGroupVisible } = await import('../../NavBar/navConfig');
        expect(isGroupVisible({ app_swarm: 0 }, 'swarm', null)).toBe(true);
        expect(isGroupVisible(undefined, 'agents', null)).toBe(true);
    });

    it('a product scope is the outer bound — a dev scope cannot widen it', async () => {
        const { isGroupVisible } = await import('../../NavBar/navConfig');
        expect(isGroupVisible({}, 'maps', new Set(['maps', 'swarm']))).toBe(false);
        expect(isGroupVisible({}, 'swarm', new Set(['maps', 'swarm']))).toBe(true);
        expect(isGroupVisible({}, 'systems', new Set(['swarm']))).toBe(false);
    });

    it('carries the Topology page and none of the build tools', async () => {
        const { NAV_LINKS, flattenNavLinks } = await import('../../NavBar/navConfig');
        const paths = flattenNavLinks(NAV_LINKS).map(l => l.path);
        expect(paths).toContain('/systems2');
        expect(paths).not.toContain('/build-visualizer');
        expect(paths).not.toContain('/customers');
    });

    it('lands the home route on Topology', async () => {
        const { PRODUCT_HOME_ROUTE } = await import('../../NavBar/navConfig');
        expect(PRODUCT_HOME_ROUTE).toBe('/systems2');
    });
});

describe('prodUrl in the internal product', () => {
    it('has no separate production site — a requirement link is same-origin', async () => {
        const { prodRequirementUrl, PROD_HOST } = await import('../../utils/prodUrl');
        expect(prodRequirementUrl(7)).toBe('/swarm/requirement/7');
        expect(PROD_HOST).toBe('');
    });
});
