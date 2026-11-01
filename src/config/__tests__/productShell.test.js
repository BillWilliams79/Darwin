// Req #4077 — what a scoped product leaves out of public/. darwin.one (every
// app) ships public/ whole; the internal product (Topology + Swarm) drops
// darwin.one's engineering docs and the Maps download, which nothing in its
// bundle links to.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from 'vite';
import { resolveProductConfig } from '../productConfig';
import { scopedOutPaths, WHOLE_APP_PUBLIC_PATHS } from '../../../devtools/productShell';

const darwinRoot = path.resolve(import.meta.dirname, '..', '..', '..');

function fileEnv(mode) {
    const saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VITE_')));
    for (const k of Object.keys(saved)) delete process.env[k];
    try { return loadEnv(mode, darwinRoot, 'VITE_'); } finally { Object.assign(process.env, saved); }
}

describe('scopedOutPaths', () => {
    it('darwin.one ships public/ whole', () => {
        expect(scopedOutPaths(resolveProductConfig({}))).toEqual([]);
    });

    it('the internal product drops docs/ and downloads/', () => {
        expect(scopedOutPaths(resolveProductConfig(fileEnv('internal')))).toEqual(['docs', 'downloads']);
    });

    it('every path it drops exists under public/ (a rename would otherwise ship it silently)', () => {
        for (const rel of WHOLE_APP_PUBLIC_PATHS) {
            expect(fs.existsSync(path.join(darwinRoot, 'public', rel)), rel).toBe(true);
        }
    });
});
