// @vitest-environment jsdom
//
// req #3622 — the Urgent Review box: the Orchestration Ready panel over the
// requirements whose session is waiting on the user, step-card wide, top-left.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import UrgentReviewBox from '../UrgentReviewBox';
import UnorchestratedReqBox from '../UnorchestratedReqBox';
import { urgentBoxWidthPx } from '../pipelineUrgentReview';
import { CARD_FONT, cardGeometryFor } from '../pipelinePlanLayout';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
beforeEach(() => {
    window.localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const items = [
    { id: 21, title: 'Needs a look', sessionStatus: 'review' },
    { id: 22, title: 'Talk to me', sessionStatus: 'waiting' },
];
const sessionColors = { review: '#fcd34d', waiting: '#f472b6' };

describe('UrgentReviewBox', () => {
    it('lists each requirement by id and title, with no status words', () => {
        act(() => root.render(<UrgentReviewBox items={items} sessionColors={sessionColors} />));
        expect(q('pipeline-viz-urgent-header').textContent).toContain('Urgent Review');
        expect(q('pipeline-viz-urgent-count').textContent).toBe('2');
        const row = q('pipeline-viz-urgent-item-21').textContent;
        expect(row).toContain('21');
        expect(row).toContain('Needs a look');
        expect(row).not.toContain('review');
        expect(q('pipeline-viz-urgent-item-22').textContent).not.toContain('waiting');
    });

    it('colours each id by the live Session palette', () => {
        act(() => root.render(<UrgentReviewBox items={items} sessionColors={sessionColors} />));
        const idOf = (rid) => q(`pipeline-viz-urgent-item-${rid}`).firstChild;
        expect(getComputedStyle(idOf(21)).color).toBe('rgb(252, 211, 77)');
        expect(getComputedStyle(idOf(22)).color).toBe('rgb(244, 114, 182)');
    });

    it("shows the requirement's terminal and dev-server pills, acting like the cards'", () => {
        const reqPills = new Map([
            [21, { terminal: { label: 'Terminal 4', href: 'darwin-term://4', title: 't4' },
                devServer: { port: '3006', url: 'https://localhost:3006', local: true,
                    title: 'open' } }],
            [22, { terminal: null,
                devServer: { port: '3001', url: 'https://localhost:3001', local: false,
                    title: 'elsewhere' } }],
        ]);
        const onOpen = vi.fn();
        act(() => root.render(<UrgentReviewBox items={items} reqPills={reqPills}
            onOpen={onOpen} />));
        const term = q('pipeline-viz-urgent-item-21-terminal');
        expect(term.textContent).toBe('Terminal 4');
        expect(term.getAttribute('href')).toBe('darwin-term://4');
        const port = q('pipeline-viz-urgent-item-21-devserver');
        expect(port.textContent).toBe('3006');
        expect(port.getAttribute('href')).toBe('https://localhost:3006');
        expect(port.getAttribute('target')).toBe('_blank');
        // A port on another machine is drawn but does not act.
        const foreign = q('pipeline-viz-urgent-item-22-devserver');
        expect(foreign.tagName).toBe('SPAN');
        expect(foreign.getAttribute('title')).toBe('elsewhere');
        expect(q('pipeline-viz-urgent-item-22-terminal')).toBeNull();
        // Acting pills do not also open the requirement.
        act(() => port.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
        expect(onOpen).not.toHaveBeenCalled();
        act(() => foreign.click());
        expect(onOpen).toHaveBeenCalledWith(22);
    });

    it('is a step card wide on screen, and never narrower than a step card\'s line', () => {
        // Zoomed in past the type clamp: 16px type, card frame × 3.
        act(() => root.render(<UrgentReviewBox items={items} stepWidthLevel={3}
            zoom={3} fontPx={16} />));
        const box = q('pipeline-viz-urgent');
        expect(getComputedStyle(box).fontSize).toBe('16px');
        expect(getComputedStyle(box).width).toBe(`${urgentBoxWidthPx(3, 3, 16) / 16}em`);
        // Zoomed far out (the plan overview): 9px type, and the box is a step
        // card's line at that type — not the sliver card × 0.2 would be.
        act(() => root.render(<UrgentReviewBox items={items} stepWidthLevel={1}
            zoom={0.2} fontPx={9} />));
        expect(parseFloat(getComputedStyle(box).width))
            .toBeCloseTo(cardGeometryFor(1).cardFrameW / CARD_FONT.req, 9);
    });

    it('opens docked against the Orchestration Ready box, on the top edge', () => {
        act(() => root.render(<UrgentReviewBox items={items} />));
        const box = q('pipeline-viz-urgent');
        expect(box.getAttribute('data-pos')).toBe('home');
        expect(box.style.top).toBe('8px');
        expect(box.style.left).toBe('');
    });

    it('is canvas chrome, but not a seat source: rows open, never drag', () => {
        const onOpen = vi.fn();
        act(() => root.render(<UrgentReviewBox items={items} onOpen={onOpen} />));
        const box = q('pipeline-viz-urgent');
        expect(box.getAttribute('data-viz-chrome')).toBe('urgent');
        expect(box.hasAttribute('data-viz-unseated')).toBe(false);
        expect(q('pipeline-viz-urgent-item-21').getAttribute('draggable')).toBe('false');
        // Orchestration Ready's category bar (req #3619) is not drawn here.
        expect(q('pipeline-viz-urgent-bar-21')).toBeNull();
        act(() => q('pipeline-viz-urgent-item-21').click());
        expect(onOpen).toHaveBeenCalledWith(21);
    });

    it('says so when nothing is waiting on the user', () => {
        act(() => root.render(<UrgentReviewBox items={[]} />));
        expect(q('pipeline-viz-urgent-empty').textContent).toContain('no session is waiting');
    });

    it('remembers its spot apart from the Orchestration Ready box', () => {
        act(() => root.render(<>
            <UrgentReviewBox items={items} />
            <UnorchestratedReqBox items={items} />
        </>));
        const box = q('pipeline-viz-urgent');
        const bar = q('pipeline-viz-urgent-header');
        const pane = { clientWidth: 1000, clientHeight: 600 };
        Object.defineProperty(box, 'offsetParent', { get: () => pane });
        Object.defineProperty(box, 'offsetLeft', { get: () => 8 });
        Object.defineProperty(box, 'offsetTop', { get: () => 8 });
        Object.defineProperty(box, 'offsetWidth', { get: () => 250 });
        Object.defineProperty(bar, 'offsetHeight', { get: () => 36 });
        const fire = (type, x, y) => bar.dispatchEvent(new MouseEvent(type,
            { bubbles: true, clientX: x, clientY: y, button: 0 }));
        act(() => { fire('pointerdown', 20, 20); });
        act(() => { fire('pointermove', 120, 220); });
        act(() => { fire('pointerup', 120, 220); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-urgent-box-pos-docked')))
            .toEqual({ x: 108, y: 208 });
        expect(window.localStorage.getItem('darwin-plan-unseated-box-pos')).toBeNull();
        expect(q('pipeline-viz-unseated').getAttribute('data-pos')).toBe('home');
    });
});
