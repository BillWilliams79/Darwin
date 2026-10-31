// Req #4076 — the product configuration that selects darwin.one or the internal
// (Topology) build. Pins: the defaults ARE darwin.one's pre-#4076 values, the
// internal env file resolves to the internal product, the scope vocabulary is
// navConfig's, and every gate is a flat define (the folding contract).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from 'vite';
import {
    resolveProductConfig, productDefines, APP_KEYS, APP_FLAG, DEFAULTS,
} from '../productConfig';
import { DEV_APP_GROUPS } from '../../NavBar/navConfig';

const darwinRoot = path.resolve(import.meta.dirname, '..', '..', '..');

// loadEnv lets process.env win over the files, and vitest has already copied
// the test mode's VITE_* values into process.env — so read the files as a
// build shell does, with no VITE_* exported.
function fileEnv(mode) {
    const saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VITE_')));
    for (const k of Object.keys(saved)) delete process.env[k];
    try { return loadEnv(mode, darwinRoot, 'VITE_'); } finally { Object.assign(process.env, saved); }
}

describe('resolveProductConfig — the default product is darwin.one, unchanged', () => {
    const p = resolveProductConfig({});

    it('names Darwin, the AWS API and the three darwin.one databases', () => {
        expect(p.productName).toBe('Darwin');
        expect(p.productTagline).toBe('Task Management');
        expect(p.apiBase).toBe('https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng');
        expect(p.opsDatabase).toBe('darwin');
        expect(p.buildVizDatabase).toBe('darwin_dev');
        expect(p.prodBaseUrl).toBe('https://www.darwin.one');
    });

    it('signs in with Cognito and carries every application', () => {
        expect(p.authMode).toBe('cognito');
        expect(p.apps.all).toBe(true);
        APP_KEYS.forEach(k => expect(p.apps[k]).toBe(true));
    });

    it('the committed .env (the default build) resolves to the same product', () => {
        const env = fileEnv('production');
        expect(resolveProductConfig(env)).toEqual(p);
    });
});

describe('resolveProductConfig — the internal mode (.env.internal)', () => {
    const env = fileEnv('internal');
    const p = resolveProductConfig(env);

    it('is Topology, same-origin /api, one brand-neutral `internal` database', () => {
        expect(p.productName).toBe('Topology');
        expect(p.productTagline).toBe('');
        expect(p.apiBase).toBe('/api');
        expect(env.VITE_DARWIN_DATABASE).toBe('internal');
        expect(p.opsDatabase).toBe('internal');
        expect(p.buildVizDatabase).toBeNull();
        expect(p.prodBaseUrl).toBe('');
    });

    it('authenticates at the proxy, and carries Topology + Swarm only', () => {
        expect(p.authMode).toBe('proxy');
        expect(p.apps).toEqual({
            all: false, list: ['systems', 'swarm'],
            tasks: false, maps: false, systems: true, swarm: true, 'swarm-validate': false,
        });
    });

    it('overrides every darwin.one value .env sets', () => {
        const base = fileEnv('production');
        for (const [k, v] of Object.entries(base)) {
            if (/amazonaws|cognito|darwin\.one/i.test(v)) expect(env[k], k).not.toBe(v);
        }
    });

    it('renaming the product is ONE value', () => {
        expect(resolveProductConfig({ ...env, VITE_PRODUCT_NAME: 'Swarm' }).productName).toBe('Swarm');
        const text = fs.readFileSync(path.join(darwinRoot, '.env.internal'), 'utf8');
        const valueLines = text.split('\n').filter(l => !l.startsWith('#'));
        expect(valueLines.filter(l => l.includes('Topology'))).toEqual(['VITE_PRODUCT_NAME=Topology']);
    });
});

describe('resolveProductConfig — validation', () => {
    it('refuses an unknown application rather than scoping to nothing', () => {
        expect(() => resolveProductConfig({ VITE_APP_SCOPE: 'systems,topology' })).toThrow(/topology/);
    });
    it('refuses an unknown auth mode', () => {
        expect(() => resolveProductConfig({ VITE_AUTH_MODE: 'ldap' })).toThrow(/cognito \| proxy/);
    });
    it('trims a trailing slash off the API base and accepts spaces in the scope', () => {
        const p = resolveProductConfig({ VITE_API_BASE: '/api/', VITE_APP_SCOPE: ' swarm , systems ' });
        expect(p.apiBase).toBe('/api');
        expect(p.apps.list).toEqual(['systems', 'swarm']);
    });
    it('an explicitly empty tagline / production URL stays empty; an absent one defaults', () => {
        expect(resolveProductConfig({ VITE_PRODUCT_TAGLINE: '', VITE_PROD_BASE_URL: '' }))
            .toMatchObject({ productTagline: '', prodBaseUrl: '' });
        expect(resolveProductConfig({})).toMatchObject({
            productTagline: DEFAULTS.productTagline, prodBaseUrl: DEFAULTS.prodBaseUrl });
    });
});

describe('the scope vocabulary and the folding contract', () => {
    it('the application keys are navConfig DEV_APP_GROUPS keys — one vocabulary', () => {
        expect([...APP_KEYS].sort()).toEqual(Object.keys(DEV_APP_GROUPS).sort());
    });

    it('every gate is its own FLAT define holding a bare boolean literal', () => {
        // A nested read (`__PRODUCT__.apps.maps`) does not fold — measured,
        // req #4076 — so each gate must be a top-level identifier.
        const defs = productDefines(resolveProductConfig({ VITE_AUTH_MODE: 'proxy', VITE_APP_SCOPE: 'systems' }));
        expect(defs.__PROXY_AUTH__).toBe('true');
        expect(defs[APP_FLAG.all]).toBe('false');
        expect(defs[APP_FLAG.systems]).toBe('true');
        expect(defs[APP_FLAG['swarm-validate']]).toBe('false');
        Object.values(APP_FLAG).forEach(id => expect(id).toMatch(/^__APP_[A-Z_]+__$/));
    });

    it('product.js reads every flag the defines provide (none left undefined)', () => {
        const src = fs.readFileSync(path.join(darwinRoot, 'src', 'config', 'product.js'), 'utf8');
        Object.values(APP_FLAG).forEach(id => expect(src).toContain(id));
        expect(src).toContain('__PROXY_AUTH__');
        // and it must not import the resolver: its darwin.one defaults would ship.
        expect(src).not.toMatch(/^import .*productConfig/m);
    });
});

describe('the default build reads darwin.one through the app modules', () => {
    // vitest runs vite.config.js, so `__PRODUCT__` here is the test mode's —
    // the committed .env, i.e. darwin.one. These pin that the modules wired to
    // the config mean exactly what they meant before req #4076.
    it('product.js', async () => {
        const p = await import('../product');
        expect(p.PRODUCT_NAME).toBe('Darwin');
        expect(p.PROXY_AUTH).toBe(false);
        expect(p.SCOPE_ALL).toBe(true);
        expect(p.API_BASE).toBe(DEFAULTS.apiBase);
    });
    it('prodUrl and the document title', async () => {
        const { prodRequirementUrl, PROD_HOST } = await import('../../utils/prodUrl');
        expect(prodRequirementUrl(7)).toBe('https://www.darwin.one/swarm/requirement/7');
        expect(PROD_HOST).toBe('darwin.one');
        const { DEFAULT_DOCUMENT_TITLE } = await import('../../hooks/useDocumentTitle');
        expect(DEFAULT_DOCUMENT_TITLE).toBe('Darwin');
    });
    it('navConfig: no product home, Topology only in DEV, profile toggles still rule', async () => {
        const nav = await import('../../NavBar/navConfig');
        expect(nav.PRODUCT_HOME_ROUTE).toBeNull();
        expect(nav.TOPOLOGY_ON).toBe(import.meta.env.DEV);
        expect(nav.isGroupVisible({ app_swarm: 0 }, 'swarm', null)).toBe(false);
        expect(nav.isGroupVisible({ app_maps: 1 }, 'maps', null)).toBe(true);
    });
});
