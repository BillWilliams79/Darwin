// pipelineGroupScene.js — the "Pipeline group" 3D engine (req #3972).
//
// Draws `buildPipelineGroupModel`'s scene with three.js and gives it the TPU
// Data Center's fly-through (Topology `tpu3d.js`, req #3566/#3567), re-built
// here rather than imported — Topology is a private, dev-only repo and its
// engine is a classic script over a vendored bundle:
//
//   * drag to orbit, right-drag (or shift-drag) to pan, scroll to zoom
//     (OrbitControls, damped); arrow keys / WASD pan, +/- zoom
//   * View presets Default · Top · Front · Side. Default is the perspective
//     overview; Top, Front and Side look EXACTLY along a world axis through an
//     ORTHOGRAPHIC camera, so every platform edge runs square to the screen
//     (Topology's `TPU3D_AXIS` frames, same screen axes)
//   * a preset FLIES there in 600 ms on a spherical path about the pivot (a
//     straight line between two presets cuts in toward it); an axis preset
//     flies the perspective camera onto the axis and lands by swapping to the
//     orthographic one at the identical scale
//   * Rotate turns the view about the pivot
//   * every platform carries its title, its initiative names and its epic
//     names (req #4040), decluttered each frame so none prints over another
//   * the floor is a CALENDAR (req #4042): a tile per time column, its date
//     in a header behind it, and a skipped stretch named in its wider aisle
//   * hover names what is under the pointer; a click FOCUSES a pipeline — the
//     others lowlight, the camera flies to frame it and its labels take
//     priority over every other platform's (the Data Center's focus); a click
//     on empty floor or Esc clears it; a double-click zooms toward the point
//     under the pointer
//
// There is no 3D single-pipeline view to hand a focus to (the user: "honoring
// the fact that there is no 3-D visualizer" for the detail level yet), so the
// drill-in is the 2D plan visualizer, opened from the view's focus panel.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { GROUP, LABEL_TIER, pipelineBox, placeLabels } from './pipelineGroupModel';
import { PLAN_VIZ_PALETTE } from '../SwarmView/pipelines/pipelinePlanLayout';

const P = PLAN_VIZ_PALETTE;
export const FLIGHT_MS = 600;
const FOV = 45;
const LOWLIGHT = 0.88;          // how far a lowlit colour moves toward the floor
const CLICK_SLOP_PX = 5;

// Topology's axis frames (tpu3d.js TPU3D_AXIS): `dir` points FROM the pivot TO
// the camera. Top is straight down with the back (−z) up the screen, Front
// looks at the front (from +z), Side looks across from +x — front to the left.
export const AXIS = Object.freeze({
    top: { dir: [0, 1, 0] },
    front: { dir: [0, 0, 1] },
    side: { dir: [1, 0, 0] },
});
export const PRESETS = ['iso', 'top', 'front', 'side'];

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

/** True when this browser can give us a WebGL context at all. */
export function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        return !!(window.WebGLRenderingContext
            && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch {
        return false;
    }
}

function labelEl(text, className) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    return el;
}

/**
 * @param {HTMLElement} container  positioned element the canvas fills
 * @param {{
 *   onHover?: (hit: null | {kind, pipeline, epic?, req?, x, y}) => void,
 *   onFocus?: (pipelineId: number|null) => void,
 *   onPreset?: (name: string) => void,
 * }} handlers
 */
export function createPipelineGroupScene(container, handlers = {}) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(new THREE.Color(P.bg), 1);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.outline = 'none';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('data-testid', 'pipelines-group-canvas');
    container.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    Object.assign(labels.domElement.style, {
        position: 'absolute', top: '0', left: '0', pointerEvents: 'none',
    });
    container.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x0a1220, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(40, 80, 60);
    scene.add(sun);

    const persp = new THREE.PerspectiveCamera(FOV, 1, 0.1, 5000);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    let halfH = 10;                                   // the orthographic frame's half-height

    // ── THE LOST-POINTERUP GUARD ────────────────────────────────────────────
    // r161's OrbitControls ends a drag only on that pointer's `pointerup`; when
    // it never arrives (a right-click on macOS — Topology req #3901) the view
    // follows a mouse with no button held. Topology patches the bundle; here
    // the missing event is supplied instead. Registered BEFORE the controls so
    // a re-press of a still-tracked pointer is ended ahead of their handler.
    const down = new Set();
    const el = renderer.domElement;
    const endPointer = (e) => {
        el.dispatchEvent(new PointerEvent('pointerup', {
            pointerId: e.pointerId, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY,
        }));
    };
    const guardDown = (e) => {
        if (down.has(e.pointerId)) endPointer(e);
        down.add(e.pointerId);
    };
    const guardMove = (e) => {
        if (e.buttons === 0 && e.pointerType !== 'touch' && down.has(e.pointerId)) endPointer(e);
    };
    const guardUp = (e) => { down.delete(e.pointerId); };
    // A press or a wheel during a flight takes the camera back where it is;
    // registered ahead of the controls so they receive this same event.
    const takeOver = () => { if (flight) cancelFlight(); };
    el.addEventListener('pointerdown', takeOver);
    el.addEventListener('wheel', takeOver, { passive: true });
    el.addEventListener('pointerdown', guardDown);
    el.addEventListener('pointermove', guardMove);
    el.addEventListener('pointerup', guardUp);
    el.addEventListener('pointercancel', guardUp);

    const controls = new OrbitControls(persp, el);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = false;              // pan along the floor
    controls.maxPolarAngle = Math.PI / 2;             // never under the floor
    controls.minDistance = 2;
    controls.maxDistance = 2000;
    controls.autoRotateSpeed = 1.2;
    controls.zoomToCursor = true;
    controls.minZoom = 0.05;                          // the orthographic presets' zoom range
    controls.maxZoom = 400;

    let model = null;
    let world = null;                                 // everything built from the model
    let focusId = null;
    let presetName = 'iso';
    let flight = null;
    let pendingOrtho = null;                          // the axis frame a flight lands on
    let raf = 0;
    let disposed = false;
    let width = 1;
    let height = 1;

    // ── CAMERAS ─────────────────────────────────────────────────────────────
    const tanHalf = () => Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const isOrtho = () => controls.object === ortho;
    const live = () => controls.object;

    function frustum() {
        ortho.top = halfH;
        ortho.bottom = -halfH;
        ortho.right = halfH * persp.aspect;
        ortho.left = -ortho.right;
        ortho.updateProjectionMatrix();
    }

    // The distance a perspective camera stands to show what the live camera shows.
    function equivalentDistance() {
        if (!isOrtho()) return persp.position.distanceTo(controls.target);
        return (halfH / ortho.zoom) / tanHalf();
    }

    function toPersp() {
        if (!isOrtho()) return;
        const d = equivalentDistance();
        const dir = ortho.position.clone().sub(controls.target).normalize();
        persp.position.copy(controls.target).addScaledVector(dir, d);
        persp.up.set(0, 1, 0);
        controls.object = persp;
        controls.update();
    }

    function toOrtho(frame) {
        halfH = frame.halfH;
        ortho.zoom = 1;
        const depth = frame.depth;
        ortho.near = 0.1;
        ortho.far = 2 * depth + 2000;
        ortho.position.copy(frame.target)
            .addScaledVector(new THREE.Vector3(...frame.dir).normalize(), depth);
        // `up` stays world-up: OrbitControls measures its orbit from the
        // camera's up at construction, so the screen frame comes from where
        // the camera stands (Top: a hair in front of the pivot → back is up).
        ortho.up.set(0, 1, 0);
        controls.target.copy(frame.target);
        ortho.lookAt(frame.target);
        frustum();
        controls.object = ortho;
        // OrbitControls keeps the camera a hair off the poles (Spherical.makeSafe);
        // Top lands there by construction — a hair in front of the pivot.
        controls.update();
    }

    // ── FRAMING ─────────────────────────────────────────────────────────────
    function frameBox() {
        if (!model) return { minX: -10, maxX: 10, minZ: -10, maxZ: 10, maxY: 1 };
        const focused = focusId != null ? model.pipelines.find((p) => p.id === focusId) : null;
        return focused ? pipelineBox(focused) : model.bounds;
    }

    function boxCenter(b) {
        return new THREE.Vector3((b.minX + b.maxX) / 2, b.maxY / 3, (b.minZ + b.maxZ) / 2);
    }

    // The perspective overview: three-quarter view from the front-left, high
    // enough to see down the lanes and low enough to read the stacks.
    function isoPose(b) {
        const target = boxCenter(b);
        const sx = b.maxX - b.minX;
        const sz = b.maxZ - b.minZ;
        const radius = 0.5 * Math.sqrt(sx * sx + sz * sz + b.maxY * b.maxY);
        const fit = Math.max(radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2)),
            radius / Math.sin(Math.atan(tanHalf() * persp.aspect)));
        // The bounding sphere is generous for a flat field seen from above
        // (its height is mostly air), so the camera stands in from it.
        const dist = Math.max(8, fit * 0.85);
        const s = new THREE.Spherical(dist, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(-28));
        return { target, pos: new THREE.Vector3().setFromSpherical(s).add(target) };
    }

    // An axis preset's square frame: the box's extent across the screen.
    function axisFrame(name, b) {
        const a = AXIS[name];
        const target = boxCenter(b);
        const sx = b.maxX - b.minX;
        const sz = b.maxZ - b.minZ;
        const sy = b.maxY;
        let w;
        let h;
        if (name === 'top') { w = sx; h = sz; target.y = 0; }
        else if (name === 'front') { w = sx; h = sy; target.y = sy / 2; }
        else { w = sz; h = sy; target.y = sy / 2; }
        const margin = 1.12;
        const half = Math.max(2, Math.max(h / 2, w / 2 / persp.aspect) * margin);
        const depth = Math.max(sx, sz, sy) + 50;
        // Top sits a hair in front of straight-down, as OrbitControls would put it.
        const dir = name === 'top' ? [0, 1, 1e-4] : a.dir;
        return { halfH: half, depth, target, dir };
    }

    function cancelFlight() {
        flight = null;
        pendingOrtho = null;
        controls.enabled = true;
    }

    function startFlight(target, pos, landOn = null) {
        // Spend any drag momentum first: damping would otherwise carry it
        // into the landing and turn an axis view off its axis.
        const damp = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = damp;
        if (isOrtho()) toPersp();
        controls.autoRotate = false;
        handlers.onRotate?.(false);
        flight = {
            t0: controls.target.clone(), p0: persp.position.clone(),
            t1: target.clone(), p1: pos.clone(), start: performance.now(),
        };
        flight.s0 = new THREE.Spherical().setFromVector3(flight.p0.clone().sub(flight.t0));
        flight.s1 = new THREE.Spherical().setFromVector3(flight.p1.clone().sub(flight.t1));
        flight.dTheta = Math.atan2(Math.sin(flight.s1.theta - flight.s0.theta),
            Math.cos(flight.s1.theta - flight.s0.theta));
        pendingOrtho = landOn;
        controls.enabled = false;
    }

    function stepFlight(now) {
        const f = flight;
        const t = Math.min(1, (now - f.start) / FLIGHT_MS);
        const e = easeInOut(t);
        const target = new THREE.Vector3().lerpVectors(f.t0, f.t1, e);
        const s = new THREE.Spherical(
            f.s0.radius + (f.s1.radius - f.s0.radius) * e,
            f.s0.phi + (f.s1.phi - f.s0.phi) * e,
            f.s0.theta + f.dTheta * e,
        );
        controls.target.copy(target);
        persp.position.copy(t >= 1 ? f.p1 : new THREE.Vector3().setFromSpherical(s).add(target));
        persp.lookAt(target);
        if (t >= 1) {
            flight = null;
            controls.enabled = true;
            if (pendingOrtho) { toOrtho(pendingOrtho); pendingOrtho = null; }
            else controls.update();
        }
    }

    function preset(name, { animate = true } = {}) {
        if (!PRESETS.includes(name)) return;
        presetName = name;
        handlers.onPreset?.(name);
        const b = frameBox();
        if (name === 'iso') {
            const pose = isoPose(b);
            if (animate) startFlight(pose.target, pose.pos);
            else {
                if (isOrtho()) toPersp();
                controls.target.copy(pose.target);
                persp.position.copy(pose.pos);
                controls.update();
            }
            return;
        }
        const frame = axisFrame(name, b);
        const d = frame.halfH / tanHalf();
        const pos = frame.target.clone().addScaledVector(new THREE.Vector3(...frame.dir).normalize(), d);
        if (animate) startFlight(frame.target, pos, frame);
        else toOrtho(frame);
    }

    // ── BUILD ───────────────────────────────────────────────────────────────
    const bg = new THREE.Color(P.bg);
    const tmp = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    function disposeWorld() {
        if (!world) return;
        scene.remove(world.root);
        world.root.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
            }
            if (o.isCSS2DObject) o.element.remove();
        });
        // An instanced mesh frees its instance buffers on its OWN dispose.
        world.pedestals?.dispose();
        world.cubes?.dispose();
        world = null;
    }

    function build() {
        disposeWorld();
        if (!model) return;
        const G = GROUP;
        const root = new THREE.Group();
        const b = model.bounds;

        // The floor: a grid over the field, a little past its edge.
        const span = Math.max(40, b.maxX - b.minX, b.maxZ - b.minZ) + 40;
        const grid = new THREE.GridHelper(span, Math.round(span / 4), P.line, P.panel);
        grid.material.transparent = true;
        grid.material.opacity = 0.55;
        root.add(grid);

        const platforms = [];
        const byPipeline = new Map();
        const labelRefs = [];            // every label in the field, for the declutter
        const addLabel = (entry, obj, tier) => {
            entry.group.add(obj);
            entry.labels.push(obj);
            labelRefs.push({ obj, tier, pipelineId: entry.p.id, w: 0, h: 0 });
        };
        const reqRefs = [];
        const epicRefs = [];
        const allReqs = [];
        const allEpics = [];

        // The calendar (req #4042): a tile under every time column, alternate
        // columns a shade apart so the eye can follow one down; its date in
        // the header strip behind it; a skipped stretch named in its aisle.
        const calendar = new THREE.Group();
        const half = G.aisle / 2;
        (model.columns || []).forEach((c, i) => {
            const tileD = c.d + G.header;
            const mat = new THREE.MeshBasicMaterial({
                color: P.accent, transparent: true, opacity: i % 2 ? 0.05 : 0.09, depthWrite: false,
            });
            const tile = new THREE.Mesh(new THREE.PlaneGeometry(c.w + 2 * half - 1, tileD + half), mat);
            tile.rotation.x = -Math.PI / 2;
            tile.position.set(c.x + c.w / 2, 0.005, c.z - G.header + (tileD + half) / 2);
            calendar.add(tile);
            const head = new CSS2DObject(labelEl(c.label, 'pg-label pg-label-column'));
            head.position.set(c.x + c.w / 2, 0.05, c.headerZ);
            head.center.set(0.5, 0.5);
            calendar.add(head);
            labelRefs.push({ obj: head, tier: LABEL_TIER.column, pipelineId: null, w: 0, h: 0 });
            if (c.gapBefore && i > 0) {
                const prev = model.columns[i - 1];
                const gap = new CSS2DObject(labelEl(`· ${c.gapBefore.label} ·`, 'pg-label pg-label-gap'));
                gap.position.set((prev.x + prev.w + c.x) / 2, 0.05, c.headerZ);
                gap.center.set(0.5, 0.5);
                calendar.add(gap);
                labelRefs.push({ obj: gap, tier: LABEL_TIER.gap, pipelineId: null, w: 0, h: 0 });
            }
        });
        root.add(calendar);

        for (const p of model.pipelines) {
            const g = new THREE.Group();
            g.position.set(p.x, 0, p.z);
            const entry = { p, group: g, materials: [], labels: [] };

            const slabMat = new THREE.MeshStandardMaterial({
                color: P.panel, roughness: 0.9, metalness: 0.05, transparent: true, opacity: 1,
            });
            const slab = new THREE.Mesh(new THREE.BoxGeometry(p.w, G.slabH, p.d), slabMat);
            slab.position.set(p.w / 2, G.slabH / 2, p.d / 2);
            slab.userData = { kind: 'pipeline', pipelineId: p.id };
            g.add(slab);
            platforms.push(slab);
            entry.materials.push({ m: slabMat, base: new THREE.Color(P.panel) });

            const edgeColor = p.state === 'error' ? '#ff6b6b' : P.wire;
            const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.9 });
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), edgeMat);
            edges.position.copy(slab.position);
            g.add(edges);
            entry.materials.push({ m: edgeMat, base: new THREE.Color(edgeColor) });

            for (const band of p.bands) {
                const mat = new THREE.MeshBasicMaterial({
                    color: band.color, transparent: true, opacity: 0.22, depthWrite: false,
                });
                const strip = new THREE.Mesh(new THREE.PlaneGeometry(band.w - 0.4, band.d), mat);
                strip.rotation.x = -Math.PI / 2;
                strip.position.set(band.w / 2, G.slabH + 0.01, band.z + band.d / 2);
                g.add(strip);
                entry.materials.push({ m: mat, base: new THREE.Color(band.color), opacity: 0.22 });
                const lab = new CSS2DObject(labelEl(band.label, 'pg-label pg-label-initiative'));
                lab.element.style.setProperty('--pg-band', band.color);
                lab.position.set(0.3, G.slabH + 0.05, band.z + band.d / 2);
                lab.center.set(0, 0.5);
                addLabel(entry, lab, LABEL_TIER.initiative);
            }

            for (const e of p.epics) {
                allEpics.push({ p, e });
                for (const r of e.reqs) allReqs.push({ p, e, r });
                const lab = new CSS2DObject(labelEl(e.title, 'pg-label pg-label-epic'));
                lab.position.set(e.x, G.slabH + e.height + 0.35, e.z);
                lab.center.set(0.5, 1);
                addLabel(entry, lab, LABEL_TIER.epic);
            }

            if (p.arcs.length) {
                const pts = [];
                for (const a of p.arcs) {
                    const from = new THREE.Vector3(a.from[0], G.slabH + a.from[1], a.from[2]);
                    const to = new THREE.Vector3(a.to[0], G.slabH + a.to[1], a.to[2]);
                    const mid = new THREE.Vector3((from.x + to.x) / 2, G.slabH + a.apex, (from.z + to.z) / 2);
                    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
                    const seg = curve.getPoints(16);
                    for (let i = 0; i < seg.length - 1; i += 1) pts.push(seg[i], seg[i + 1]);
                }
                const arcMat = new THREE.LineBasicMaterial({ color: P.arc, transparent: true, opacity: 0.85 });
                const arcs = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), arcMat);
                g.add(arcs);
                entry.materials.push({ m: arcMat, base: new THREE.Color(P.arc), opacity: 0.85 });
            }

            const title = p.state === 'loading' ? `${p.title} · loading…`
                : p.state === 'error' ? `${p.title} · could not load`
                    : p.title;
            const tl = new CSS2DObject(labelEl(title, 'pg-label pg-label-pipeline'));
            tl.position.set(p.w / 2, G.slabH + 0.2, -0.6);
            tl.center.set(0.5, 1);
            addLabel(entry, tl, LABEL_TIER.pipeline);

            root.add(g);
            byPipeline.set(p.id, entry);
        }

        // Every pedestal and every cube in the field is ONE instanced mesh
        // each: a plan of 160 epics and its requirements is a few hundred
        // instances, not a few hundred draw calls.
        let pedestals = null;
        if (allEpics.length) {
            pedestals = new THREE.InstancedMesh(
                new THREE.BoxGeometry(G.pedestal, G.pedestalH, G.pedestal),
                new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 }),
                allEpics.length);
            allEpics.forEach(({ p, e }, i) => {
                tmp.position.set(p.x + e.x, G.slabH + G.pedestalH / 2, p.z + e.z);
                tmp.updateMatrix();
                pedestals.setMatrixAt(i, tmp.matrix);
                pedestals.setColorAt(i, tmpColor.set(e.color).multiplyScalar(0.55));
                epicRefs.push({ pipelineId: p.id, epic: e, base: tmpColor.clone() });
            });
            pedestals.userData = { kind: 'epic' };
            root.add(pedestals);
        }
        let cubes = null;
        if (allReqs.length) {
            cubes = new THREE.InstancedMesh(
                new THREE.BoxGeometry(G.cube, G.cube, G.cube),
                new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 }),
                allReqs.length);
            allReqs.forEach(({ p, e, r }, i) => {
                tmp.position.set(p.x + r.x, G.slabH + r.y, p.z + r.z);
                tmp.updateMatrix();
                cubes.setMatrixAt(i, tmp.matrix);
                cubes.setColorAt(i, tmpColor.set(r.color));
                reqRefs.push({ pipelineId: p.id, epic: e, req: r, base: tmpColor.clone() });
            });
            cubes.userData = { kind: 'req' };
            root.add(cubes);
        }

        scene.add(root);
        world = { root, platforms, byPipeline, pedestals, cubes, epicRefs, reqRefs, labelRefs };
        applyFocus();
    }

    // ── FOCUS ───────────────────────────────────────────────────────────────
    function applyFocus() {
        if (!world) return;
        const dim = (color, lit) => (lit ? color : color.clone().lerp(bg, LOWLIGHT));
        for (const [id, entry] of world.byPipeline) {
            const lit = focusId == null || id === focusId;
            for (const { m, base, opacity } of entry.materials) {
                m.color.copy(dim(base, lit));
                if (opacity != null) m.opacity = lit ? opacity : opacity * 0.5;
            }
            for (const l of entry.labels) l.element.classList.toggle('pg-label-dim', !lit);
        }
        const paint = (mesh, refs) => {
            if (!mesh) return;
            refs.forEach((ref, i) => {
                const lit = focusId == null || ref.pipelineId === focusId;
                mesh.setColorAt(i, dim(ref.base, lit));
            });
            mesh.instanceColor.needsUpdate = true;
        };
        paint(world.pedestals, world.epicRefs);
        paint(world.cubes, world.reqRefs);
    }

    function setFocus(id, { fly = true } = {}) {
        const next = id != null && model?.pipelines.some((p) => p.id === id) ? id : null;
        const changed = next !== focusId;
        focusId = next;
        applyFocus();
        container.dataset.focus = focusId == null ? '' : String(focusId);
        if (fly && changed) preset(presetName);
    }

    // ── PICKING ─────────────────────────────────────────────────────────────
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    function pick(clientX, clientY) {
        if (!world) return null;
        const r = el.getBoundingClientRect();
        ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, live());
        const targets = [world.cubes, world.pedestals, ...world.platforms].filter(Boolean);
        const hit = ray.intersectObjects(targets, false)[0];
        if (!hit) return null;
        const pipelineOf = (id) => model.pipelines.find((p) => p.id === id);
        const kind = hit.object.userData.kind;
        if (kind === 'req') {
            const ref = world.reqRefs[hit.instanceId];
            return { kind, pipeline: pipelineOf(ref.pipelineId), epic: ref.epic, req: ref.req, point: hit.point };
        }
        if (kind === 'epic') {
            const ref = world.epicRefs[hit.instanceId];
            return { kind, pipeline: pipelineOf(ref.pipelineId), epic: ref.epic, point: hit.point };
        }
        return { kind: 'pipeline', pipeline: pipelineOf(hit.object.userData.pipelineId), point: hit.point };
    }

    let hoverQueued = null;
    let lastHoverKey = '';
    const onMove = (e) => {
        if (e.buttons !== 0) return;
        hoverQueued = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
        hoverQueued = null;
        lastHoverKey = '';
        handlers.onHover?.(null);
    };
    function flushHover() {
        if (!hoverQueued) return;
        const { x, y } = hoverQueued;
        hoverQueued = null;
        const hit = pick(x, y);
        const key = hit ? `${hit.kind}:${hit.pipeline?.id}:${hit.epic?.id ?? ''}:${hit.req?.id ?? ''}` : '';
        el.style.cursor = hit ? 'pointer' : '';
        const r = container.getBoundingClientRect();
        if (key === lastHoverKey && !hit) return;
        lastHoverKey = key;
        handlers.onHover?.(hit ? { ...hit, x: x - r.left, y: y - r.top } : null);
    }

    let press = null;
    const onDown = (e) => {
        press = { x: e.clientX, y: e.clientY, button: e.button };
    };
    const onUp = (e) => {
        const p = press;
        press = null;
        if (!p || p.button !== 0) return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) return;
        const hit = pick(e.clientX, e.clientY);
        handlers.onFocus?.(hit ? hit.pipeline.id : null);
    };
    // Double-click zooms toward the point under the pointer (or the floor
    // there): the pivot moves to it and the camera halves its distance.
    const onDbl = (e) => {
        const hit = pick(e.clientX, e.clientY);
        let point = hit?.point;
        if (!point) {
            const r = el.getBoundingClientRect();
            ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
            ray.setFromCamera(ndc, live());
            point = new THREE.Vector3();
            if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)) return;
        }
        // Mid-flight to an axis preset (a click just started one): land it
        // now, so the zoom happens in the view the flight was going to.
        if (flight && pendingOrtho) {
            const frame = pendingOrtho;
            cancelFlight();
            toOrtho(frame);
        }
        if (isOrtho()) {
            const z = ortho.zoom;
            const shift = point.clone().sub(controls.target);
            controls.target.add(shift);
            ortho.position.add(shift);
            ortho.zoom = Math.min(z * 2, 400);
            ortho.updateProjectionMatrix();
            controls.update();
            return;
        }
        const dir = persp.position.clone().sub(controls.target);
        const dist = Math.max(controls.minDistance, dir.length() / 2);
        startFlight(point, point.clone().addScaledVector(dir.normalize(), dist));
    };
    const onKey = (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'Escape') { handlers.onFocus?.(null); return; }
        const panKeys = {
            ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0],
            ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1],
        };
        const k = panKeys[e.key];
        if (k) {
            e.preventDefault();
            // Pan along the floor in the camera's own left/right and forward.
            const cam = live();
            const fwd = new THREE.Vector3();
            cam.getWorldDirection(fwd);
            fwd.y = 0;
            // Looking straight down (Top): forward is the screen's up.
            if (fwd.lengthSq() < 1e-6) fwd.set(0, 1, 0).applyQuaternion(cam.quaternion).setY(0);
            if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
            fwd.normalize();
            const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
            const step = (isOrtho() ? halfH / ortho.zoom : equivalentDistance() * tanHalf()) * 0.15;
            const move = right.multiplyScalar(k[0] * step).addScaledVector(fwd, -k[1] * step);
            controls.target.add(move);
            cam.position.add(move);
            controls.update();
            return;
        }
        if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
            e.preventDefault();
            const zoomIn = e.key === '+' || e.key === '=';
            if (isOrtho()) {
                ortho.zoom = Math.min(400, Math.max(0.05, ortho.zoom * (zoomIn ? 1.25 : 0.8)));
                ortho.updateProjectionMatrix();
            } else {
                const dir = persp.position.clone().sub(controls.target);
                const len = Math.min(controls.maxDistance, Math.max(controls.minDistance,
                    dir.length() * (zoomIn ? 0.8 : 1.25)));
                persp.position.copy(controls.target).addScaledVector(dir.normalize(), len);
            }
            controls.update();
        }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('keydown', onKey);
    // A drag the user starts ends a flight's hold on the camera; it is theirs.

    // ── SIZE + LOOP ─────────────────────────────────────────────────────────
    function resize() {
        width = Math.max(1, container.clientWidth);
        height = Math.max(1, container.clientHeight);
        renderer.setSize(width, height);
        labels.setSize(width, height);
        persp.aspect = width / height;
        persp.updateProjectionMatrix();
        frustum();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    function loop(now) {
        if (disposed) return;
        raf = requestAnimationFrame(loop);
        if (document.hidden) return;
        if (flight) stepFlight(now);
        else controls.update();
        flushHover();
        renderer.render(scene, live());
        labels.render(scene, live());
        declutter();
    }

    // Every label in the field is placed in priority order each frame — the
    // focused plan's first, then titles › initiatives › epics, nearest first —
    // and one that would print over a placed one hides until the view
    // separates them (`placeLabels`). Seen square-on from the front or the
    // side, platforms in one line of sight print their titles on one spot
    // (Topology's stacked labels, req #3566): the nearest shows.
    //
    // Screen boxes are PROJECTED from each label's anchor exactly as
    // CSS2DRenderer places it, with its size measured once: a few hundred
    // getBoundingClientRect calls a frame would be a few hundred layouts.
    const viewProj = new THREE.Matrix4();
    const ndcPos = new THREE.Vector3();
    function declutter() {
        if (!world) return;
        const cam = live();
        viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        const items = [];
        const refs = [];
        // Read every size first, then write: one layout per frame at most.
        // `visibility` keeps a hidden label's box, so a measurement stays true.
        for (const ref of world.labelRefs) {
            const { obj } = ref;
            if (obj.element.style.display === 'none') continue;   // behind the camera
            if (!ref.w) {
                ref.w = obj.element.offsetWidth;
                ref.h = obj.element.offsetHeight;
                if (!ref.w) continue;
            }
            // `labels.render` just brought every matrixWorld up to date.
            ndcPos.setFromMatrixPosition(obj.matrixWorld);
            const d = ndcPos.distanceToSquared(cam.position);
            ndcPos.applyMatrix4(viewProj);
            const x = (ndcPos.x * 0.5 + 0.5) * width - obj.center.x * ref.w;
            const y = (-ndcPos.y * 0.5 + 0.5) * height - obj.center.y * ref.h;
            // Off the stage: clipped anyway, and it must not crowd one that is on it.
            if (x > width || y > height || x + ref.w < 0 || y + ref.h < 0) continue;
            items.push({
                left: x, top: y, right: x + ref.w, bottom: y + ref.h,
                tier: ref.tier, d, lit: focusId != null && ref.pipelineId === focusId,
            });
            refs.push(ref);
        }
        const shown = placeLabels(items);
        refs.forEach((ref, i) => {
            const want = shown[i] ? '' : 'hidden';
            if (ref.obj.element.style.visibility !== want) ref.obj.element.style.visibility = want;
        });
    }
    // A web font landing after the first measurement changes every label's
    // width: measure again.
    const remeasure = () => {
        if (world) for (const ref of world.labelRefs) ref.w = 0;
    };
    document.fonts?.addEventListener?.('loadingdone', remeasure);
    raf = requestAnimationFrame(loop);

    let framed = false;
    return {
        /** Draw a new model; the camera and the focus stay where they are. */
        setModel(next) {
            model = next;
            build();
            // The focused plan left the field (a filter hid it): clear the
            // focus everywhere and go back to the whole field.
            if (focusId != null && !model.pipelines.some((p) => p.id === focusId)) {
                setFocus(null, { fly: framed });
                handlers.onFocus?.(null);
            }
            if (!framed && model.pipelines.length) {
                framed = true;
                preset(presetName, { animate: false });
            }
        },
        setFocus,
        preset,
        setRotate(on) {
            controls.autoRotate = !!on;
            handlers.onRotate?.(!!on);
        },
        /** Test hook: the live view as plain data. */
        state() {
            return {
                preset: presetName,
                ortho: isOrtho(),
                flying: !!flight,
                focus: focusId,
                target: controls.target.toArray(),
                pipelines: model ? model.pipelines.length : 0,
            };
        },
        dispose() {
            disposed = true;
            cancelAnimationFrame(raf);
            ro.disconnect();
            el.removeEventListener('pointerdown', guardDown);
            el.removeEventListener('pointermove', guardMove);
            el.removeEventListener('pointerup', guardUp);
            el.removeEventListener('pointercancel', guardUp);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerleave', onLeave);
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('pointerup', onUp);
            el.removeEventListener('dblclick', onDbl);
            el.removeEventListener('keydown', onKey);
            el.removeEventListener('pointerdown', takeOver);
            el.removeEventListener('wheel', takeOver);
            document.fonts?.removeEventListener?.('loadingdone', remeasure);
            controls.dispose();
            disposeWorld();
            renderer.dispose();
            // Free the context now; toggling views would otherwise pile them
            // up until Chrome drops the oldest.
            renderer.forceContextLoss();
            el.remove();
            labels.domElement.remove();
        },
    };
}
