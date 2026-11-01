// filerHover.js — what the Requirement Filer is flying over (req #3958): "the
// requirements create action popup should while being dragged highlight the
// HTML element over which it is flying and have [it] be in the data. Clear
// exceptions for any docked scenario (Title bar, navbar, topology bar … all
// bars)" — and only while its PUSHPIN is pressed (user ruling 2026-10-26: "add
// a pushpin next to the X between title. Pushpin pressed, it will highlight the
// HTML element and record the place. Pushpin not pressed it will not highlight
// the HTML element or record its place").
//
// THE HOVER PATTERN. Pinned, while the filer is dragged by its head, the element
// under its CENTRE — the probe its + records first in `pointedAt`
// (filedFromContext.js), resolved the same way to the nearest element carrying a
// data-testid — is OUTLINED by one fixed overlay drawn above every other popup, with a
// chip naming it (its innermost testid, or its tag) and a reticle at the aim
// point. The filer turns translucent while something is outlined (AnchoredPanel
// `onMoveTrack`), so the element shows through. The overlay is one DOM node
// moved by style per pointer frame — never a React render — and takes no
// pointer, so it is never what it finds. The outline moves to a new element only
// once it has stayed under the filer for AIM_SETTLE_MS, so what a drag merely
// crosses (the tile between two cards) is never outlined.
//
// PICKER MODE WORKS IN THE DOCKABLE AREAS (user, 2026-10-27: "when we are in
// pushpin html association mode we need that mode on the … bars elements too").
// Pinned, the filer docks only in the NAVBAR (AnchoredPanel
// `dockable="navbar"`, req #4172; the pin stays pressed there): carried over a
// title bar or AI Architecture's toolbar it outlines their elements like any
// others and floats where it is dropped. Unpinned, it docks
// in them as always and outlines nothing.
//
// IT REACHES THE EDGES (req #4046, user, 2026-10-30: "can the edges of the
// requirement filer pass off the screen in this mode so the circle can cover
// the whole field of view"). Pinned, a drag may carry it half off screen — its
// centre, the aim point, kept inside (AnchoredPanel `overhang`). Let go there
// it slides back whole on screen, so its + stays reachable, and the place under
// its centre at the release is HELD: still outlined, the reticle where it was,
// and what the + records — until it is dragged again or unpinned (user ruling),
// closed, or nothing is under it any more. The outline follows what moves under
// the held point each frame (RequirementFiler `followHeld`).
//
// THE DATA is the + press's own `pointedAt` (filedFromContext.js): where the
// filer IS at the press, never a spot it has left — or the place it holds —
// and nothing, with its reason, when the pin is not pressed.
//
// THE FILER AND ITS EDITOR ARE ON TOP (req #4044, "Requirement editor should
// have highest z axis"). Every Action Popup used to share AnchoredPanel's 1250,
// so which one won was DOM order, and the outline (drawn above every popup)
// tinted the filer itself — carried over the plan's Active box it read as
// buried under it. The order is stated now: the other popups, the outline,
// the filer, the reticle, then its editor — all below MUI's modals (1300+);
// carried out of the navbar, the navbar lifts to the filer's own z
// (usePanelRack `track` z).
// And the other Action Popups are pickable like any element: only the filer's
// own two windows are skipped (filedFromContext.js FILER_OWN_POPUPS).

import { pointTarget, probeAt } from './filedFromContext';
import { objectLabel } from './filerPointResolvers';

/** The outline's stacking: above every other Action Popup (AnchoredPanel 1250)
 *  and the navbar lifted for a rack drag, below the filer (req #4044). */
export const AIM_Z = 1290;
/** The Requirement Filer's stacking: above every other Action Popup and the
 *  outline, so what it is carried over never covers or tints it (req #4044). */
export const FILER_Z = 1294;
/** A plan-element editor's (pipeline / initiative / epic): above the other Action
 *  Popups and below the aim outline, the filer and the Requirement Editor, so the
 *  Requirement Editor opens ATOP it (req #4116). */
export const PLAN_EDITOR_Z = 1280;
/** The aim point's reticle: over the filer it marks the centre of — and,
 *  like the outline, under the editor, so it never floats there alone. */
export const AIM_POINT_Z = 1295;
/** Its editor's: the highest of all (req #4044) — over the filer too. All of
 *  these stay below MUI's modals, menus and snackbars (1300+). */
export const EDITOR_Z = 1296;
/** How often a drag re-samples what is under the filer, ms, and how long the
 *  outline glides to a new element — both 15% slower than a 60 Hz frame and the
 *  first 60 ms glide (user, 2026-10-26: "slightly less frenetic"). */
export const AIM_SAMPLE_MS = 19;
export const AIM_GLIDE_MS = 69;
/** How long a new element must stay under the filer before the outline moves
 *  to it — a DEBOUNCE, so what is crossed on the way (the tile between two
 *  cards) never flashes (user, 2026-10-27). */
export const AIM_SETTLE_MS = 160;
/** The outline's colour — the Action Popups' accent. */
export const AIM_COLOR = '#4fc3f7';
/** The targeting circle's: a brighter tint of it, with a glow (user, 2026-10-30:
 *  "make the targeting circle a bit brighter"). */
export const AIM_POINT_COLOR = '#9be7ff';
const OVERLAY_ID = 'darwin-requirement-filer-aim';
const RETICLE_ID = 'darwin-requirement-filer-aim-point';

/** The point a popup at `rect` ({left, top, width, height}, Darwin viewport px) aims from. */
export const aimPoint = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

/**
 * What a popup drawn at `rect` is flying over: `{ el, hit, off, frame, rect,
 * name }` — `el` the named element, `rect` its on-screen rect in Darwin's
 * viewport px, `name` what the chip says — or null over nothing or a bar.
 */
export function aimAt(rect, doc = document) {
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    const { x, y } = aimPoint(rect);
    const probe = probeAt(doc, x, y);
    if (!probe) return null;
    // req #4158 — what the + would record: the object a canvas draws there
    // (epic, requirement, initiative band …), or the specific child of a large
    // container, outlined with ITS rect and named by ITS label.
    const target = pointTarget(probe, x, y);
    const el = target.named;
    const testid = el.getAttribute?.('data-testid') || el.tagName?.toLowerCase() || '?';
    const specificName = target.specific
        ? `${target.specific.kind}${target.specific.id != null ? ` #${target.specific.id}` : ''} in ${testid}` : null;
    return {
        el, hit: probe.hit, off: probe.off, frame: probe.frame,
        point: { x, y },
        // A target that moves under a held point is a NEW target (followHeld).
        key: target.key,
        ...(target.object ? { object: target.object } : null),
        rect: target.rect,
        name: (target.object ? `${objectLabel(target.object)} · ${testid}` : (specificName || testid)).slice(0, 100),
    };
}

function overlay(doc) {
    let o = doc.getElementById(OVERLAY_ID);
    if (o) return o;
    o = doc.createElement('div');
    o.id = OVERLAY_ID;
    o.setAttribute('data-testid', 'requirement-aim');
    o.setAttribute('aria-hidden', 'true');
    Object.assign(o.style, {
        position: 'fixed', zIndex: String(AIM_Z), pointerEvents: 'none', boxSizing: 'border-box',
        border: `2px solid ${AIM_COLOR}`, borderRadius: '3px', background: 'rgba(79, 195, 247, 0.12)',
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.55), 0 0 12px rgba(79, 195, 247, 0.55)',
        transition: ['left', 'top', 'width', 'height'].map(p => `${p} ${AIM_GLIDE_MS}ms`).join(', '),
    });
    const chip = doc.createElement('div');
    chip.setAttribute('data-testid', 'requirement-aim-name');
    Object.assign(chip.style, {
        position: 'absolute', left: '-2px', bottom: '100%', maxWidth: '360px', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '1px 6px', borderRadius: '3px 3px 0 0',
        background: AIM_COLOR, color: '#000', font: '600 11px/16px "SF Mono", Menlo, monospace',
    });
    o.append(chip);
    doc.body.appendChild(o);
    return o;
}

/** The reticle at the aim point — its own node, above the filer (AIM_POINT_Z). */
function reticle(doc) {
    let r = doc.getElementById(RETICLE_ID);
    if (r) return r;
    r = doc.createElement('div');
    r.id = RETICLE_ID;
    r.setAttribute('data-testid', 'requirement-aim-point');
    r.setAttribute('aria-hidden', 'true');
    Object.assign(r.style, {
        position: 'fixed', zIndex: String(AIM_POINT_Z), pointerEvents: 'none',
        width: '10px', height: '10px', marginLeft: '-5px', marginTop: '-5px',
        borderRadius: '50%', border: `2px solid ${AIM_POINT_COLOR}`,
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 6px 1px rgba(155, 231, 255, 0.85)',
        boxSizing: 'border-box',
    });
    doc.body.appendChild(r);
    return r;
}

/** Outlines `target` (aimAt), or clears the outline when null. `note` — said
 *  after the name on the chip. */
export function showAim(target, note = '', doc = document) {
    if (!target) { clearAim(doc); return; }
    const o = overlay(doc);
    const { left, top, width, height } = target.rect;
    Object.assign(o.style, { display: 'block', left: `${left}px`, top: `${top}px`,
        width: `${Math.max(width, 4)}px`, height: `${Math.max(height, 4)}px` });
    o.setAttribute('data-aim', target.name);
    const [chip] = o.children;
    const label = note ? `${target.name} · ${note}` : target.name;
    if (chip.textContent !== label) chip.textContent = label;
    // An element at the very top: its chip sits inside the outline instead.
    chip.style.bottom = top < 18 ? 'auto' : '100%';
    chip.style.top = top < 18 ? '0' : 'auto';
    Object.assign(reticle(doc).style, { left: `${target.point.x}px`, top: `${target.point.y}px` });
}

/** Clears the outline and its reticle. */
export function clearAim(doc = document) {
    doc.getElementById(OVERLAY_ID)?.remove();
    doc.getElementById(RETICLE_ID)?.remove();
}
