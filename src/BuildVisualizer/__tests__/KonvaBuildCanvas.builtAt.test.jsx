// @vitest-environment jsdom
//
// req #3515 — the canvas actually DRAWS the build's date line.
//
// d3LayoutEngine.test.js proves computeLayout puts `dateLabel` on each build
// record. That is the producer half. Nothing proved the consumer half: that the
// model the page hands the canvas survives the semantic transform with builtAt
// intact, and that KonvaBuildCanvas emits a Text node for it, one line below the
// version, in the documented geometry. A regression anywhere in that chain would
// leave every layout test green over a canvas with no dates on it — the feature
// the requester asked to SEE.
//
// react-konva is replaced by plain DOM stand-ins that record their props, so
// the assertions read the canvas's scene graph directly. Geometry is asserted
// RELATIVE to the version label, which makes it independent of the zoom
// transform: every glyph size is `size × inv`, so the version's own font size
// recovers `inv`.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-konva', () => {
    // eslint-disable-next-line react/display-name
    const node = (kind) => ({ children, ...p }) => (
        <span
            data-konva={kind}
            data-text={p.text ?? ''}
            data-x={p.x ?? ''}
            data-y={p.y ?? ''}
            data-font={p.fontSize ?? ''}
            data-listening={String(p.listening)}
        >
            {children}
        </span>
    );
    const Stage = forwardRef(({ children }, ref) => {
        const div = useRef(null);
        useImperativeHandle(ref, () => ({ container: () => div.current }));
        return <div ref={div} data-konva="Stage">{children}</div>;
    });
    return {
        Stage,
        Layer: node('Layer'),
        Group: node('Group'),
        Rect: node('Rect'),
        Circle: node('Circle'),
        Line: node('Line'),
        Text: node('Text'),
        Path: node('Path'),
        Arrow: node('Arrow'),
        Star: node('Star'),
    };
});

import KonvaBuildCanvas from '../KonvaBuildCanvas';

// jsdom has no layout: give the container a size so the Stage mounts.
let restoreSize;
beforeAll(() => {
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1400 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
    const RO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    restoreSize = () => {
        if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
        if (h) Object.defineProperty(HTMLElement.prototype, 'clientHeight', h);
        globalThis.ResizeObserver = RO;
    };
});
afterAll(() => restoreSize());
afterEach(cleanup);

// The Exemplar main branch (project 14, branch 24) in the data hook's model
// shape: 6.2.1.0 is NULL, the next three carry the simulator's 7am/7pm slots.
const EXEMPLAR_HEAD = [
    { id: 'm1', build: 1, builtAt: null, label: '' },
    { id: '24-b2', build: 2, builtAt: '2026-09-14 14:00:00.000000', label: 'Sep 14 7:00 AM' },
    { id: '24-b3', build: 3, builtAt: '2026-09-16 02:00:00.000000', label: 'Sep 15 7:00 PM' },
    { id: '24-b4', build: 4, builtAt: '2026-09-16 14:00:00.000000', label: 'Sep 16 7:00 AM' },
];

function exemplarModel() {
    const builds = {};
    EXEMPLAR_HEAD.forEach((b, i) => {
        builds[b.id] = {
            id: b.id, branchId: 'main', position: i, build: b.build, branchNum: 0,
            major: 6, minor: 2, dotColor: null, approvedForRelease: false,
            createdAt: '2026-09-13 06:31:33.000000', builtAt: b.builtAt,
        };
    });
    return {
        branches: [{
            id: 'main', type: 'main', name: 'Main', parentBuildId: null, parentBranchId: null,
            side: 'center', rowOrder: null, major: 6, minor: 2, labelEnd: null,
            buildIds: EXEMPLAR_HEAD.map(b => b.id),
        }],
        builds,
        releaseEvents: {},
        releaseEventDetails: {},
    };
}

function renderCanvas(props = {}) {
    return render(
        <KonvaBuildCanvas
            model={exemplarModel()}
            projectId={14}
            staggerOn
            showReleases
            showAcceptanceTests={false}
            appMode="light"
            pinnedLevel={3}
            collapseEnabled={false}
            {...props}
        />,
    );
}

const texts = (container) => [...container.querySelectorAll('[data-konva="Text"]')]
    .map(el => ({
        text: el.dataset.text,
        x: Number(el.dataset.x),
        y: Number(el.dataset.y),
        font: Number(el.dataset.font),
        listening: el.dataset.listening,
    }));

const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;
const DATE_RE = /^[A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2} [AP]M$/;

describe('KonvaBuildCanvas — built_at date line (req #3515)', () => {
    it('draws the Pacific date one line below the version of every dated build', () => {
        const { container } = renderCanvas();
        const all = texts(container);
        const versions = all.filter(t => VERSION_RE.test(t.text));
        const dates = all.filter(t => DATE_RE.test(t.text));

        expect(versions.map(v => v.text)).toEqual(['6.2.1.0', '6.2.2.0', '6.2.3.0', '6.2.4.0']);
        expect(dates.map(d => d.text)).toEqual(['Sep 14 7:00 AM', 'Sep 15 7:00 PM', 'Sep 16 7:00 AM']);

        for (const date of dates) {
            // Paired with the version drawn at the same x (same dot).
            const version = versions.find(v => v.x === date.x);
            expect(version, `no version label above "${date.text}"`).toBeDefined();
            // One line below: DATE_LINE_GAP = 1.2 × VERSION_FONT, both × inv.
            expect(date.y - version.y).toBeCloseTo(1.2 * version.font, 6);
            // A touch smaller than the version, which stays the primary label.
            expect(date.font).toBeCloseTo(0.9 * version.font, 6);
            // Decorative: must never steal the dot's click.
            expect(date.listening).toBe('false');
        }
    });

    it('draws no date line for a NULL built_at (Exemplar 6.2.1.0)', () => {
        const { container } = renderCanvas();
        const all = texts(container);
        const v1 = all.find(t => t.text === '6.2.1.0');
        const below = all.filter(t => t.x === v1.x && t.y > v1.y && t.y < v1.y + 3 * v1.font);
        expect(below).toEqual([]);
    });

    it('a model with no dates draws no date lines at all', () => {
        const model = exemplarModel();
        Object.values(model.builds).forEach(b => { b.builtAt = null; });
        const { container } = renderCanvas({ model });
        expect(texts(container).filter(t => DATE_RE.test(t.text))).toEqual([]);
    });

    it('at L1 the date follows the version: never drawn under a hidden version', () => {
        const { container } = renderCanvas({ pinnedLevel: 1, collapseEnabled: true });
        const all = texts(container);
        const versions = all.filter(t => VERSION_RE.test(t.text));
        const dates = all.filter(t => DATE_RE.test(t.text));
        // L1 labels only each branch's latest build (and release builds).
        expect(versions.map(v => v.text)).toEqual(['6.2.4.0']);
        expect(dates.map(d => d.text)).toEqual(['Sep 16 7:00 AM']);
        expect(dates[0].x).toBe(versions[0].x);
    });
});
