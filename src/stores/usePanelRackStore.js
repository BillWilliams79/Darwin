import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { rackInsert, rackRemove } from '../Components/AnchoredPanel/panelRack';

// The panel racks (req #3720, two of them since req #3886) — the Darwin navbar,
// and a page's own toolbar, as drop zones for any AnchoredPanel that names a
// `rackId` (see Components/AnchoredPanel/panelRack.js).
//   • `racked` — the ids locked into the Darwin NAVBAR, top to bottom;
//     `pageRacked` — the ids locked into a page's own TOOLBAR (AI
//     Architecture's topology navbar, Systems/ToolbarRack.jsx). A popup is in
//     one of them at most: racking it in one takes it out of the other.
//     Persisted per browser: where the reader keeps a panel is a viewer
//     convenience.
//   • `slot` — the navbar's `{ node, width, expand }`, published while it is
//     drawn: the element racked panels portal into, its width, and how to
//     unfold it. null = no navbar rack here (mobile).
//   • `pageSlot` — a page toolbar's, published while that toolbar is on the
//     page — folded to its slim strip included (req #3886), with `folded`. It
//     also carries `zone` (its drop zone), `offset()` (its document's origin in
//     Darwin's viewport, for a rack in a same-origin iframe), `cache` (the
//     emotion cache that styles a rack in a shadow root) and `name`.
//     BOTH racks are drop zones at once and each keeps its own popups (req
//     #3886 — before it, a drawn toolbar took over as THE rack and every racked
//     popup moved into it, and folding it moved them all back). A popup racked
//     in the toolbar on a page with no toolbar is drawn at the bottom of the
//     navbar's stack meanwhile, still the toolbar's (`rackPlacement`).
//   • `drag` — `{ id, over, rack, index, fromRack, from, color, z }` while a
//     rackable panel is being moved: `over` = the pointer is on a rack, `rack`
//     = which ('nav' | 'page'), `index` = where in that stack it would land,
//     `from` = the rack it is drawn in now (null = floating), `color` = the
//     panel's frame. The rack under it glows in that colour (req #3728).
//     `z` = the panel's own z-index when it has one (null = the default),
//     which the navbar lifts to while carrying it out (req #4044).
//   • `seeded` — the ids of panels that are racked BY DEFAULT (req #3727 — the
//     navbar's Dev Server panel) and have been racked once already. `seed(id)`
//     racks such a panel the first time it mounts in this browser, at the
//     bottom of the navbar's stack; after that where it sits is the reader's, so
//     one dragged off the navbar stays floating. Persisted with `racked`.
//   • `covered` — a page is drawn OVER the navbar (a visualizer maximized —
//     Plan, Build or Swarm — req #3735, #3793; `useVisualizerMaximize`
//     publishes it): the navbar is still mounted underneath, so the racks are
//     SUSPENDED for every window — no drop zone, a racked window floats —
//     rather than portalling windows into a navbar nobody can see. Published
//     by the covering page while it covers; live only, never persisted.
//     Every full screen mode covers it (req #4053, Components/fullScreenLayer.js
//     useCoverNavbar), and one can sit inside another — a map's full screen in
//     a full-screen dialog — so `cover()`/`uncover()` count them (`covers`):
//     the navbar is covered until the last one ends.
const ids = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

export const usePanelRackStore = create(
    persist(
        (set, get) => ({
            racked: [],
            pageRacked: [],
            slot: null,
            pageSlot: null,
            drag: null,
            seeded: [],
            covered: false,
            covers: 0,
            seed: (id) => {
                const { seeded, racked, pageRacked } = get();
                if (seeded.includes(id)) return;
                set({ seeded: [...seeded, id], racked: rackInsert(racked, id, racked.length),
                    pageRacked: rackRemove(pageRacked, id) });
            },
            // Into `where`'s stack ('nav' — the default — or 'page') at `index`,
            // and out of the other's.
            rack: (id, index, where = 'nav') => {
                const { racked, pageRacked } = get();
                set(where === 'page'
                    ? { pageRacked: rackInsert(pageRacked, id, index), racked: rackRemove(racked, id) }
                    : { racked: rackInsert(racked, id, index), pageRacked: rackRemove(pageRacked, id) });
            },
            unrack: (id) => set({ racked: rackRemove(get().racked, id), pageRacked: rackRemove(get().pageRacked, id) }),
            setSlot: (slot) => set({ slot }),
            setPageSlot: (pageSlot) => set({ pageSlot }),
            setDrag: (drag) => set({ drag }),
            setCovered: (covered) => set({ covered: !!covered }),
            cover: () => set({ covers: get().covers + 1, covered: true }),
            uncover: () => {
                const covers = Math.max(0, get().covers - 1);
                set({ covers, covered: covers > 0 });
            },
        }),
        {
            name: 'darwin_panel_rack',
            version: 1,
            partialize: (s) => ({ racked: s.racked, pageRacked: s.pageRacked, seeded: s.seeded }),
            merge: (persisted, current) => ({
                ...current,
                racked: ids(persisted?.racked),
                pageRacked: ids(persisted?.pageRacked),
                seeded: ids(persisted?.seeded),
            }),
        }
    )
);

/**
 * Where the panel `id` is racked and drawn now, or null when it is not racked:
 * `{ where, slot, pos }` — `where` the rack it is drawn in ('nav' | 'page';
 * null with no rack to draw it), `slot` that rack's slot, `pos` its place in
 * that rack's stack. A toolbar's popup on a page with no toolbar is drawn at
 * the bottom of the navbar's stack (`fallback`), and stays the toolbar's.
 */
export function rackPlacement(s, id) {
    if (!id) return null;
    const p = s.pageRacked.indexOf(id);
    if (p !== -1) {
        if (s.pageSlot?.node) return { where: 'page', slot: s.pageSlot, pos: p };
        if (s.slot?.node) return { where: 'nav', slot: s.slot, pos: s.racked.length + p, fallback: true };
        return { where: null, slot: null, pos: p };
    }
    const n = s.racked.indexOf(id);
    if (n === -1) return null;
    return s.slot?.node ? { where: 'nav', slot: s.slot, pos: n } : { where: null, slot: null, pos: n };
}
