// @vitest-environment jsdom
//
// Req #3720 — the panel rack store: only the rack order persists (the slot is
// the live navbar's, the drag the live gesture's), and a malformed stored
// order loads as an empty rack rather than a broken one.

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('usePanelRackStore (req #3720)', () => {
    beforeEach(() => { localStorage.clear(); vi.resetModules(); });

    it('persists the rack order and nothing else', async () => {
        const { usePanelRackStore } = await import('../usePanelRackStore');
        const s = usePanelRackStore.getState();
        s.setSlot({ node: document.createElement('div'), width: 180 });
        s.setDrag({ id: 'devservers', over: true, index: 0, fromRack: false });
        s.rack('devservers', 0);
        s.rack('other', 0);
        expect(usePanelRackStore.getState().racked).toEqual(['other', 'devservers']);
        const stored = JSON.parse(localStorage.getItem('darwin_panel_rack'));
        expect(stored.state).toEqual({ racked: ['other', 'devservers'] });
        s.unrack('other');
        expect(usePanelRackStore.getState().racked).toEqual(['devservers']);
    });

    it('loads a stored order, and a malformed one as empty', async () => {
        localStorage.setItem('darwin_panel_rack', JSON.stringify({
            state: { racked: ['devservers', 7, null] }, version: 1 }));
        let { usePanelRackStore } = await import('../usePanelRackStore');
        await usePanelRackStore.persist.rehydrate();
        expect(usePanelRackStore.getState().racked).toEqual(['devservers']);
        expect(usePanelRackStore.getState().slot).toBe(null);

        localStorage.setItem('darwin_panel_rack', JSON.stringify({
            state: { racked: 'devservers' }, version: 1 }));
        vi.resetModules();
        ({ usePanelRackStore } = await import('../usePanelRackStore'));
        await usePanelRackStore.persist.rehydrate();
        expect(usePanelRackStore.getState().racked).toEqual([]);
    });
});
