// @vitest-environment jsdom
//
// Req #3643 — the Dev Servers dashboard's persisted store: a pre-v2 dock (v0
// saved a width from every move, v1 a height from every grip drag) loses its
// size on load so the panel is content-sized on both axes again, and keeps
// where it was parked.

import { describe, it, expect, vi } from 'vitest';

describe('useDevServerDashboardStore migration', () => {
    it('drops a v0 size and keeps the spot', async () => {
        localStorage.setItem('darwin_devserver_dashboard', JSON.stringify({
            state: { show: true, open: false, dock: { h: 'l', x: 40, v: 't', y: 90, w: 320, ht: 200 } },
            version: 0,
        }));
        vi.resetModules();
        const { useDevServerDashboardStore } = await import('../useDevServerDashboardStore');
        await useDevServerDashboardStore.persist.rehydrate();
        expect(useDevServerDashboardStore.getState()).toMatchObject({
            show: true, open: false, dock: { h: 'l', x: 40, v: 't', y: 90, w: null, ht: null },
        });
    });

    it('drops a v1 size too', async () => {
        localStorage.setItem('darwin_devserver_dashboard', JSON.stringify({
            state: { show: true, open: true, dock: { h: 'r', x: 0, v: 'b', y: 0, w: 260, ht: 300 } },
            version: 1,
        }));
        vi.resetModules();
        const { useDevServerDashboardStore } = await import('../useDevServerDashboardStore');
        await useDevServerDashboardStore.persist.rehydrate();
        expect(useDevServerDashboardStore.getState().dock).toEqual(
            { h: 'r', x: 0, v: 'b', y: 0, w: null, ht: null });
    });

    it('leaves a v2 shaped size alone', async () => {
        localStorage.setItem('darwin_devserver_dashboard', JSON.stringify({
            state: { show: true, open: true, dock: { h: 'r', x: 0, v: 'b', y: 0, w: 260, ht: null } },
            version: 2,
        }));
        vi.resetModules();
        const { useDevServerDashboardStore } = await import('../useDevServerDashboardStore');
        await useDevServerDashboardStore.persist.rehydrate();
        expect(useDevServerDashboardStore.getState().dock.w).toBe(260);
    });
});
