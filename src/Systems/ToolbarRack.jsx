// ToolbarRack.jsx — AI Architecture's own toolbar as a panel rack (req #3792),
// beside the Darwin navbar's (req #3886).
//
// AI Architecture (/systems2) shows its own toolbar: the topology page's
// navbar, drawn in a same-origin iframe beside Darwin's. An Action Popup docks
// against it by the Darwin navbar's rules and with its behaviours — dropped on the toolbar it glows in
// the window's frame colour, the window locks in below the toolbar's buttons at
// the toolbar's width, more than one stack in rack order, each only as tall as
// its content, the buttons first; dragged up and down the stack it reorders,
// dragged off it floats again. Pattern doc: memory/anchored-collapse-pattern.md
// § A page's own toolbar.
//
// A SECOND rack (req #3886, replacing #3792's take-over): this publishes the
// toolbar as the store's `pageSlot`, a drop zone beside the navbar's. Each rack
// keeps the popups dropped on it — the navbar's stay in the navbar while this
// toolbar is drawn, and this toolbar's stay here when it folds — and the hit
// test, drop index, reorder, glow and box are usePanelRack's / panelRack's own
// (RACK_SX, rackGlow). What is this page's:
//   • WHERE — a shadow root appended to the toolbar, below its buttons, so the
//     topology page's own CSS (its global `button` rule) and scripts (which
//     select its nav buttons) never reach the windows, nor theirs the page. The
//     windows are styled there through an emotion cache (`slot.cache`).
//   • THE IFRAME'S PX — `slot.offset()` is the iframe's origin in Darwin's
//     viewport, so hit tests and gestures stay in Darwin's px.
//   • THE ZONE — the toolbar's column, from its top to the bottom of the frame
//     (the navbar's is its whole height), so the empty space below the stack is
//     still the toolbar.
//   • THE LOOK — the windows inherit Darwin's body type (CssBaseline's body1,
//     smoothing) rather than the topology page's, and the rack sits as close
//     under the buttons as the navbar's: the toolbar's own section gap is
//     cancelled, so an empty rack changes nothing in its layout. The glow fades
//     in and out as the navbar's does.
//   • THE HEIGHT — the toolbar scrolls with its page, so the rack is capped at
//     what the buttons leave of the frame's height: the navbar's "the nav list
//     comes first, the rack gets what is left" (req #3751).
//   • FOLDED — the toolbar folded to its slim strip (its ‹) keeps its popups
//     (req #3886): the rack stays in the strip (the page hides every other
//     child of a folded toolbar), and each popup is drawn there as its ONE
//     icon in a box of its frame colour (AnchoredPanel's `rackIcon`) — a click
//     on it unfolds the toolbar (`expand`, the toolbar's own ›) unless the
//     popup's icon does something of its own. The strip is still a drop zone.
//   • DRAWN — covered by a view's full screen, the toolbar is not drawn: the
//     slot is withdrawn. The full screen covers the Darwin navbar too
//     (SystemsPage2, req #4053), so its windows float over it meanwhile.
// An Action Popup carried from anywhere but this toolbar over the frame would
// otherwise lose its pointer to the iframe, so the frame takes no pointer
// meanwhile.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

import { RACK_SX, rackGlow } from '../Components/AnchoredPanel/panelRack';
import { usePanelRackStore } from '../stores/usePanelRackStore';

/** The toolbar in the topology page. */
const TOOLBAR_SELECTOR = 'nav.navbar';
/** A view's full screen covers the toolbar: a 3D stage takes the fixed
 *  `.tpu3d-full` overlay and a 2D stage the fixed `.s2-full`, the browser's full
 *  screen under them where it is allowed (Topology tpu3d.js). */
export const FULL_SCREEN_STAGES = '.tpu3d, .stage';
export const FULL_SCREEN_SELECTOR = '.tpu3d-full, .s2-full';
/** The toolbar folded to its slim strip, and the › that unfolds it (Topology
 *  topology.js setNavCollapsed). */
const FOLDED_CLASS = 'nav-collapsed';
const EXPAND_SELECTOR = '[data-testid="topo-nav-collapse"]';
/** The shadow root's own base: the windows size by border-box, as in Darwin. */
const SHADOW_BASE_CSS = ':host { display: block; } *, *::before, *::after { box-sizing: border-box; }';

/** The navbar's glow fade (NavBarSidebar's box-shadow transition). */
const GLOW_FADE = 'box-shadow 0.12s';
const GLOW_FADE_MS = 120;

const px = (v) => parseFloat(v) || 0;

/** Build the rack's host in the toolbar of the iframe's document, or null. */
export function mountToolbarHost(frame) {
    let doc = null;
    try { doc = frame?.contentDocument; } catch { return null; }   // not same-origin
    const toolbar = doc?.querySelector(TOOLBAR_SELECTOR);
    if (!toolbar) return null;
    const hostEl = doc.createElement('div');
    hostEl.setAttribute('data-testid', 'toolbar-rack-host');
    // Shown in the folded strip too, which hides every other child but its top
    // row (`.navbar.nav-collapsed > :not(.nav-top)`): an inline display wins.
    hostEl.style.display = 'block';
    const shadow = hostEl.attachShadow({ mode: 'open' });
    const base = doc.createElement('style');
    base.textContent = SHADOW_BASE_CSS;
    const mount = doc.createElement('div');
    shadow.append(base, mount);
    toolbar.appendChild(hostEl);
    // The toolbar spaces its sections by a flex gap; the rack sits as close
    // under the buttons as the navbar's does (its own 6px when it holds a
    // window), and an empty one takes no room at all.
    const gap = px(doc.defaultView.getComputedStyle(toolbar).rowGap);
    if (gap) hostEl.style.marginTop = `-${gap}px`;
    return {
        doc, toolbar, hostEl, mount,
        cache: createCache({ key: 'toolbar-rack', container: shadow, prepend: true }),
    };
}

/** Whether the toolbar is drawn: present, not under a full screen. Folded to
 *  its strip it is still drawn (req #3886). */
export function toolbarDrawn(host) {
    return !!host?.toolbar.isConnected && !host.doc.querySelector(FULL_SCREEN_SELECTOR);
}

/** Whether the toolbar is folded to its slim strip. */
export function toolbarFolded(host) {
    return !!host?.toolbar.classList.contains(FOLDED_CLASS);
}

/** The height the toolbar's buttons leave the rack in the frame, px. */
export function rackRoom(host, rackEl) {
    const win = host.doc.defaultView;
    const top = rackEl.getBoundingClientRect().top + win.scrollY;
    const below = px(win.getComputedStyle(host.toolbar).paddingBottom)
        + px(win.getComputedStyle(host.doc.body).paddingBottom);
    return Math.max(0, Math.floor(win.innerHeight - top - below));
}

/**
 * @param {Object} props
 * @param {React.RefObject<HTMLIFrameElement>} props.frameRef  the AI Architecture iframe
 */
export default function ToolbarRack({ frameRef }) {
    // The host in the iframe's CURRENT document — rebuilt on each load.
    const [host, setHost] = useState(null);
    const [drawn, setDrawn] = useState(false);
    const [folded, setFolded] = useState(false);
    const [rackEl, setRackEl] = useState(null);
    const [slotNode, setSlotNode] = useState(null);
    const [width, setWidth] = useState(0);
    const [room, setRoom] = useState(null);
    const theme = useTheme();

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return undefined;
        let current = null;
        const attach = () => {
            current?.hostEl.remove();
            current = mountToolbarHost(frame);
            setHost(current);
        };
        frame.addEventListener('load', attach);
        if (frame.contentDocument?.readyState === 'complete') attach();
        return () => {
            frame.removeEventListener('load', attach);
            current?.hostEl.remove();
            setHost(null);
        };
    }, [frameRef]);

    // Drawn: re-read when the toolbar folds or a 3D stage goes full screen —
    // those elements' classes only, never the page's (its animations flip
    // classes on every frame).
    useEffect(() => {
        if (!host) return undefined;
        const check = () => { setDrawn(toolbarDrawn(host)); setFolded(toolbarFolded(host)); };
        check();
        const mo = new host.doc.defaultView.MutationObserver(check);
        [host.toolbar, ...host.doc.querySelectorAll(FULL_SCREEN_STAGES)].forEach(el =>
            mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
        return () => mo.disconnect();
    }, [host]);
    // Wide and roomy: re-read whenever the toolbar or the frame resizes.
    useEffect(() => {
        if (!host || !rackEl) return undefined;
        const win = host.doc.defaultView;
        const measure = () => {
            setWidth(rackEl.clientWidth);
            setRoom(rackRoom(host, rackEl));
        };
        measure();
        const ro = new win.ResizeObserver(measure);
        ro.observe(host.toolbar);
        win.addEventListener('resize', measure);
        return () => { ro.disconnect(); win.removeEventListener('resize', measure); };
    }, [host, rackEl]);

    // THE rack while drawn (before paint, so a racked window never flashes at
    // its floating dock first); withdrawn otherwise and on unmount.
    useLayoutEffect(() => {
        const frame = frameRef.current;
        const { setPageSlot } = usePanelRackStore.getState();
        if (!host || !slotNode || !drawn || !frame) { setPageSlot(null); return undefined; }
        const win = host.doc.defaultView;
        setPageSlot({
            node: slotNode, width, cache: host.cache, name: 'toolbar', folded,
            // A popup's icon in the folded strip unfolds it: the toolbar's own ›.
            expand: () => { if (toolbarFolded(host)) host.doc.querySelector(EXPAND_SELECTOR)?.click(); },
            // The toolbar's column, its top to the frame's bottom.
            zone: { getBoundingClientRect: () => {
                const r = host.toolbar.getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, bottom: win.innerHeight,
                    width: r.width, height: Math.max(0, win.innerHeight - r.top) };
            } },
            offset: () => {
                const r = frame.getBoundingClientRect();
                return { left: r.left + frame.clientLeft, top: r.top + frame.clientTop };
            },
        });
        return () => setPageSlot(null);
    }, [host, slotNode, drawn, folded, width, frameRef]);

    // The drop glow on the toolbar, and a carried floating Action Popup keeps its
    // pointer over the frame.
    const drag = usePanelRackStore(s => (s.pageSlot && s.pageSlot.node === slotNode ? s.drag : null));
    const dragging = !!drag;
    useEffect(() => {
        if (!host) return;
        const over = !!drag?.over && drag.rack === 'page';
        host.toolbar.style.boxShadow = over ? rackGlow(drag.color) : '';
        host.toolbar.setAttribute('data-rack-drop', drag ? (over ? 'over' : 'armed') : 'off');
    }, [host, drag]);
    // The fade, only while a drag is on (and through its fade-out): the toolbar's
    // own transitions (its collapse) are kept and extended, never replaced.
    const fadeTimer = useRef(0);
    useEffect(() => {
        if (!host || !dragging) return undefined;
        const st = host.toolbar.style;
        clearTimeout(fadeTimer.current);
        st.transition = '';
        const own = host.doc.defaultView.getComputedStyle(host.toolbar).transition;
        st.transition = own && !/^all 0s/.test(own) ? `${own}, ${GLOW_FADE}` : GLOW_FADE;
        return () => {
            fadeTimer.current = setTimeout(() => { st.transition = ''; }, GLOW_FADE_MS + 30);
        };
    }, [host, dragging]);
    useEffect(() => () => clearTimeout(fadeTimer.current), []);
    // Carried from anywhere but this toolbar (floating, or the navbar's rack).
    const carried = !!drag && drag.from !== 'page';
    useEffect(() => {
        const frame = frameRef.current;
        if (!frame || !carried) return undefined;
        frame.style.pointerEvents = 'none';
        return () => { frame.style.pointerEvents = ''; };
    }, [frameRef, carried]);

    if (!host) return null;
    return createPortal(
        <CacheProvider value={host.cache}>
            <Box ref={setRackEl} data-testid="toolbar-rack"
                 sx={{ ...RACK_SX, ...(room != null && { maxHeight: `${room}px` }),
                        // Darwin's body type (CssBaseline), not the topology page's.
                        ...theme.typography.body1,
                        WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}>
                <Box ref={setSlotNode} data-testid="toolbar-rack-slot" sx={{ display: 'contents' }} />
            </Box>
        </CacheProvider>,
        host.mount,
    );
}
