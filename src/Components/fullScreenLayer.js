// fullScreenLayer.js — where a full screen mode sits, so the Requirement Filer
// stays on screen over every one of them (req #4053: "I switched chip into full
// screen mode and the requirement popup didnt show up").
//
// A full screen mode can hide the filer three ways, and each has its answer:
//   · THE BROWSER'S FULL SCREEN ON AN ELEMENT shows that element alone — a
//     TPU view's stage in its iframe, a 3D stage — and nothing Darwin draws
//     over the page. Every full screen is taken on the DOCUMENT instead
//     (useVisualizerMaximize, PipelineGroupView, the topology frame through
//     its host — SystemsPage2), and the page draws itself over the window.
//   · A LAYER ABOVE THE FILER (a fixed overlay at MUI's modal 1300, Leaflet's
//     pseudo full screen at 99999, a full-screen Dialog). Every full screen
//     layer is FULL_SCREEN_Z: over the navbar, under the filer and its editor.
//   · THE NAVBAR COVERED, with the filer racked in it. Every full screen mode
//     publishes the rack's `covered` (useCoverNavbar), so a racked window
//     floats over it until it ends (usePanelRackStore, req #3735).

import { useLayoutEffect } from 'react';

import { usePanelRackStore } from '../stores/usePanelRackStore';

/** A full screen mode's layer: over the navbar (MUI's drawer, 1200), at the
 *  other Action Popups' z (AnchoredPanel PANEL_Z — which of the two paints on
 *  top is DOM order), and below the Requirement
 *  Filer and its editor (RequirementFiler/filerHover.js FILER_Z, EDITOR_Z) and
 *  MUI's modals, menus and snackbars (1300+). */
export const FULL_SCREEN_Z = 1250;

/** A MUI Dialog shown full screen: on that layer, and its focus left free, so
 *  the filer's editor over it can be typed into. */
export const FULL_SCREEN_DIALOG_PROPS = Object.freeze({
    disableEnforceFocus: true,
    sx: { zIndex: FULL_SCREEN_Z },
});

/**
 * While `on`, a full screen mode covers the navbar: the panel racks are
 * suspended and a racked window floats (before paint, so nothing is portalled
 * into the covered navbar for a frame). Counted, so a full screen mode inside
 * another leaves the navbar covered when it ends first.
 * @param {boolean} on
 */
export function useCoverNavbar(on) {
    useLayoutEffect(() => {
        if (!on) return undefined;
        usePanelRackStore.getState().cover();
        return () => usePanelRackStore.getState().uncover();
    }, [on]);
}
