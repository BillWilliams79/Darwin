// @vitest-environment jsdom
//
// Req #3721 — the Plan visualizer's Active box: an AnchoredPanel listing the
// plan's requirements whose sessions are under way, rows drawn like an epic
// card's (id in the colour key, Terminal / Dev Server pills, title). Moving,
// reshaping and collapsing are the panel's and are tested with it.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import PlanActiveBox from '../PlanActiveBox';
import { usePlanActiveBoxStore, useAllActiveBoxStore } from '../../../stores/usePlanActiveBoxStore';
import { usePanelRackStore } from '../../../stores/usePanelRackStore';
import { REQ_PILL_FONT_EM, REQ_PILL_H_EM, REQ_PILL_STYLE } from '../planReqPills';

const ITEMS = [
    { id: 3721, title: 'Make Pipeline Active session info popup', sessionStatus: 'active' },
    { id: 3720, title: 'Make Dev Server rackable', sessionStatus: 'review' },
];
const PILLS = new Map([
    [3721, { terminal: { label: 'Terminal 2', title: 'Focus Terminal 2', href: 'darwin-term://2' },
             devServer: { port: '3002', url: 'https://localhost:3002', local: true, title: 'Open' } }],
    [3720, { terminal: { label: 'Terminal 5', title: 'On another machine', href: null }, devServer: null }],
]);
const idStyleOf = (id) => ({ fill: id === 3721 ? 'rgb(255, 0, 0)' : 'rgb(0, 128, 0)', bold: id === 3721 });

describe('PlanActiveBox (req #3721)', () => {
    beforeEach(() => {
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
        usePlanActiveBoxStore.setState({ open: true, dock: null });
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    it('is titled Active and counts its rows in the epic card badge', () => {
        render(<PlanActiveBox items={ITEMS} reqPills={PILLS} idStyleOf={idStyleOf} />);
        expect(screen.getByTestId('pipeline-viz-active-title').textContent).toBe('Active');
        expect(screen.getByTestId('pipeline-viz-active-count').textContent).toBe('2');
    });

    it('each title is ONE line, cut with "…" (req #3729)', () => {
        render(<PlanActiveBox items={ITEMS} reqPills={PILLS} idStyleOf={idStyleOf} />);
        const t = getComputedStyle(screen.getByTestId('pipeline-viz-active-item-title-3721'));
        expect(t.whiteSpace).toBe('nowrap');
        expect(t.textOverflow).toBe('ellipsis');
        expect(t.overflow).toBe('hidden');
    });

    it('has every Action Popup\'s controls: ▾ upper left, upper right blank (req #3741)', () => {
        render(<PlanActiveBox items={ITEMS} reqPills={PILLS} idStyleOf={idStyleOf} />);
        const head = screen.getByTestId('pipeline-viz-active-header');
        const toggle = screen.getByTestId('pipeline-viz-active-toggle');
        expect(head.firstElementChild).toBe(toggle);
        expect(toggle.textContent).toBe('▾');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        // No small-view button (req #3741); the upper right is empty.
        expect(screen.queryByTestId('pipeline-viz-active-small')).toBeNull();
        expect(head.lastElementChild.childElementCount).toBe(0);
        fireEvent.click(toggle);
        expect(usePlanActiveBoxStore.getState().open).toBe(false);
        expect(screen.getByTestId('pipeline-viz-active-toggle').getAttribute('aria-expanded')).toBe('false');
    });

    it('draws each row as the card does: coloured id, pills, title', () => {
        render(<PlanActiveBox items={ITEMS} reqPills={PILLS} idStyleOf={idStyleOf} />);
        const row = screen.getByTestId('pipeline-viz-active-item-3721');
        expect(row.style.color || getComputedStyle(row).color).toBe('rgb(255, 0, 0)');
        expect(screen.getByTestId('pipeline-viz-active-term-3721').textContent).toBe('Terminal 2');
        expect(screen.getByTestId('pipeline-viz-active-port-3721').textContent).toBe('3002');
        expect(screen.getByTestId('pipeline-viz-active-item-title-3721').textContent)
            .toBe('Make Pipeline Active session info popup');
        expect(screen.queryByTestId('pipeline-viz-active-port-3720')).toBeNull();
        expect(row.getAttribute('title')).toContain('Implementing');
        // The card's own pill: its palette, and its height relative to the
        // ROW's type (the pill's em is its label size, so it is divided out).
        const pill = getComputedStyle(screen.getByTestId('pipeline-viz-active-term-3721'));
        const probe = document.createElement('i');
        probe.style.background = REQ_PILL_STYLE.terminal.fill;
        expect(pill.backgroundColor || pill.background).toContain(probe.style.backgroundColor);
        expect(parseFloat(pill.height) * REQ_PILL_FONT_EM).toBeCloseTo(REQ_PILL_H_EM, 5);
    });

    it('opens the requirement from the keyboard too', () => {
        const onOpen = vi.fn();
        render(<PlanActiveBox items={ITEMS} reqPills={PILLS} idStyleOf={idStyleOf} onOpen={onOpen} />);
        fireEvent.keyDown(screen.getByTestId('pipeline-viz-active-item-3720'), { key: 'Enter' });
        expect(onOpen).toHaveBeenCalledWith(3720);
    });

    it('opens the requirement on a row click, and a pill does its own thing', () => {
        const onOpen = vi.fn();
        const openSpy = vi.fn();
        vi.stubGlobal('open', openSpy);
        render(<PlanActiveBox items={ITEMS} reqPills={PILLS} idStyleOf={idStyleOf} onOpen={onOpen} />);
        fireEvent.click(screen.getByTestId('pipeline-viz-active-item-title-3720'));
        expect(onOpen).toHaveBeenCalledWith(3720);
        fireEvent.click(screen.getByTestId('pipeline-viz-active-port-3721'));
        expect(openSpy).toHaveBeenCalledWith('https://localhost:3002', '_blank', 'noopener,noreferrer');
        expect(onOpen).toHaveBeenCalledTimes(1);
        // A terminal on another machine has no handle: no action, the row's click.
        expect(screen.getByTestId('pipeline-viz-active-term-3720').getAttribute('role')).toBeNull();
    });

    it('shaped narrow it drops the titles; a remembered small view is ignored (req #3741)', () => {
        // The small-view button is gone, so a browser that had it on must
        // not be left in it with no way out.
        usePlanActiveBoxStore.setState({ small: true });
        const { unmount } = render(<PlanActiveBox items={ITEMS} reqPills={PILLS} idStyleOf={idStyleOf} />);
        expect(screen.getByTestId('pipeline-viz-active-list').dataset.small).toBe('0');
        expect(screen.getByTestId('pipeline-viz-active-item-title-3721')).toBeTruthy();
        unmount();
        usePlanActiveBoxStore.setState({ dock: { h: 'l', x: 100, v: 'b', y: 16, w: 150, ht: null } });
        render(<PlanActiveBox items={ITEMS} reqPills={PILLS} idStyleOf={idStyleOf} />);
        expect(screen.getByTestId('pipeline-viz-active-list').dataset.small).toBe('1');
        expect(screen.queryByTestId('pipeline-viz-active-item-title-3721')).toBeNull();
        expect(screen.getByTestId('pipeline-viz-active-term-3721')).toBeTruthy();
    });

    it('racks onto the navbar like the other Action Popups (req #3720)', () => {
        const slot = document.createElement('div');
        document.body.appendChild(slot);
        usePanelRackStore.setState({ racked: ['active'], slot: { node: slot, width: 180 }, drag: null });
        try {
            render(<PlanActiveBox items={ITEMS} reqPills={PILLS} idStyleOf={idStyleOf} />);
            const panel = screen.getByTestId('pipeline-viz-active');
            expect(panel.getAttribute('data-rack-id')).toBe('active');
            expect(panel.getAttribute('data-racked')).toBe('1');
            expect(slot.contains(panel)).toBe(true);
        } finally {
            usePanelRackStore.setState({ racked: [], slot: null, drag: null });
            slot.remove();
        }
    });

    it('says None running when nothing is, and … while sessions load', () => {
        const { rerender } = render(<PlanActiveBox items={[]} idStyleOf={idStyleOf} />);
        expect(screen.getByTestId('pipeline-viz-active-empty').textContent).toBe('None running');
        rerender(<PlanActiveBox items={[]} idStyleOf={idStyleOf} isLoading />);
        expect(screen.queryByTestId('pipeline-viz-active-empty')).toBeNull();
        expect(screen.getByTestId('pipeline-viz-active-count').textContent).toBe('…');
    });

    // req #3978 — the Pipelines page's All Active box is this component with
    // its own name, test ids, rack id and remembered place.
    it('takes a name, test ids, rack id and store of its own (All Active)', () => {
        useAllActiveBoxStore.setState({ open: true, dock: null });
        render(<PlanActiveBox items={ITEMS} reqPills={PILLS} idStyleOf={idStyleOf}
                              name="All Active" testid="pipelines-all-active"
                              rackId="all-active" store={useAllActiveBoxStore} />);
        expect(screen.getByTestId('pipelines-all-active-title').textContent).toBe('All Active');
        expect(screen.getByTestId('pipelines-all-active-count').textContent).toBe('2');
        expect(screen.getByTestId('pipelines-all-active-term-3721').textContent).toBe('Terminal 2');
        expect(screen.getByTestId('pipelines-all-active-item-title-3720').textContent)
            .toBe('Make Dev Server rackable');
        expect(screen.getByTestId('pipelines-all-active').getAttribute('data-rack-id')).toBe('all-active');
        expect(screen.queryByTestId('pipeline-viz-active')).toBeNull();
        fireEvent.click(screen.getByTestId('pipelines-all-active-toggle'));
        expect(useAllActiveBoxStore.getState().open).toBe(false);
        expect(usePlanActiveBoxStore.getState().open).toBe(true);
    });
});
