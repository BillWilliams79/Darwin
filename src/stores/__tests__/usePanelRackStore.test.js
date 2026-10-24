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
        // req #3735 — a covered navbar is the live page's fact, never stored.
        s.setCovered(true);
        expect(usePanelRackStore.getState().covered).toBe(true);
        s.rack('devservers', 0);
        s.rack('other', 0);
        expect(usePanelRackStore.getState().racked).toEqual(['other', 'devservers']);
        const stored = JSON.parse(localStorage.getItem('darwin_panel_rack'));
        expect(stored.state).toEqual({ racked: ['other', 'devservers'], pageRacked: [], seeded: [] });
        s.unrack('other');
        expect(usePanelRackStore.getState().racked).toEqual(['devservers']);
    });

    it('keeps a toolbar\'s rack beside the navbar\'s: racked in one, a panel leaves the other (req #3886)', async () => {
        const { usePanelRackStore } = await import('../usePanelRackStore');
        const s = usePanelRackStore.getState;
        s().rack('a', 0);
        s().rack('b', 0, 'page');
        s().rack('c', 5, 'page');
        expect([s().racked, s().pageRacked]).toEqual([['a'], ['b', 'c']]);
        s().rack('b', 0, 'nav');
        expect([s().racked, s().pageRacked]).toEqual([['b', 'a'], ['c']]);
        s().rack('a', 0, 'page');
        expect([s().racked, s().pageRacked]).toEqual([['b'], ['a', 'c']]);
        s().unrack('c');
        expect(s().pageRacked).toEqual(['a']);
        // Seeded into the navbar, a panel leaves the toolbar's rack.
        s().seed('a');
        expect([s().racked, s().pageRacked]).toEqual([['b', 'a'], []]);
        expect(JSON.parse(localStorage.getItem('darwin_panel_rack')).state.pageRacked).toEqual([]);
    });

    it('loads a stored toolbar order, and a malformed one as empty (req #3886)', async () => {
        localStorage.setItem('darwin_panel_rack', JSON.stringify({
            state: { racked: [], pageRacked: ['requirement-filer', 4] }, version: 1 }));
        let { usePanelRackStore } = await import('../usePanelRackStore');
        await usePanelRackStore.persist.rehydrate();
        expect(usePanelRackStore.getState().pageRacked).toEqual(['requirement-filer']);
        // A store from before req #3886 has none.
        localStorage.setItem('darwin_panel_rack', JSON.stringify({ state: { racked: ['a'] }, version: 1 }));
        vi.resetModules();
        ({ usePanelRackStore } = await import('../usePanelRackStore'));
        await usePanelRackStore.persist.rehydrate();
        expect(usePanelRackStore.getState().pageRacked).toEqual([]);
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

    it('seeds a racked-by-default panel once, at the bottom, and never again (req #3727)', async () => {
        const { usePanelRackStore } = await import('../usePanelRackStore');
        const s = usePanelRackStore.getState();
        s.rack('devservers', 0);
        s.seed('devserver-info');
        expect(usePanelRackStore.getState().racked).toEqual(['devservers', 'devserver-info']);
        // Dragged off, it stays off: a later mount does not re-rack it.
        s.unrack('devserver-info');
        s.seed('devserver-info');
        expect(usePanelRackStore.getState().racked).toEqual(['devservers']);
        const stored = JSON.parse(localStorage.getItem('darwin_panel_rack'));
        expect(stored.state.seeded).toEqual(['devserver-info']);
    });

    it('loads a stored seeded list, and a malformed one as empty (req #3727)', async () => {
        localStorage.setItem('darwin_panel_rack', JSON.stringify({
            state: { racked: [], seeded: ['devserver-info', 3] }, version: 1 }));
        const { usePanelRackStore } = await import('../usePanelRackStore');
        await usePanelRackStore.persist.rehydrate();
        expect(usePanelRackStore.getState().seeded).toEqual(['devserver-info']);
        // Already seeded and not racked: the reader floated it — seed leaves it be.
        usePanelRackStore.getState().seed('devserver-info');
        expect(usePanelRackStore.getState().racked).toEqual([]);
    });
});
