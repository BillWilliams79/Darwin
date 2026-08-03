// @vitest-environment jsdom
//
// Req #3158 — RouteCardView's aggregator wiring, stated acceptance criteria:
// the card is the FIRST cell of the grid on every pagination page, it is fed
// the FULL filtered list (never the 25-row slice), and it only renders when
// toggled on. RouteCard and the aggregator itself are mocked — leaflet cannot
// run in jsdom and their internals are covered by their own tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let aggregatorProps;

vi.mock('../RouteCard', () => ({
    default: ({ run }) => <div data-testid="route-card-mock" data-run-id={run.id} />,
}));

vi.mock('../MapAggregatorCard', () => ({
    default: (props) => {
        aggregatorProps = props;
        return <div data-testid="map-aggregator-card-mock" />;
    },
}));

vi.mock('../../MapRuns/MapRunsView', () => ({
    default: () => null,
    TABLE_WIDTH: 1200,
}));

vi.mock('../../photo-browser/handleDB.js', () => ({
    loadIndex: () => Promise.resolve(null),
}));

vi.mock('../../photo-browser/proxyConfig.js', () => ({ IS_MACOS: false }));

import RouteCardView from '../RouteCardView';

const RUNS = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }));

let container;
let root;

const render = (element) => {
    act(() => root.render(element));
};

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    aggregatorProps = undefined;
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('RouteCardView aggregator wiring (req #3158)', () => {
    it('renders the aggregator as the first grid cell, fed the FULL filtered list', () => {
        render(<RouteCardView runs={RUNS} showAggregatorCard />);

        const grid = container.querySelector('.card');
        expect(grid.firstElementChild.getAttribute('data-testid')).toBe('map-aggregator-card-mock');

        // Full list, not the 25-row pagination slice…
        expect(aggregatorProps.runs).toHaveLength(30);
        // …while the grid itself shows only the page.
        expect(container.querySelectorAll('[data-testid="route-card-mock"]')).toHaveLength(25);
    });

    it('renders no aggregator when toggled off', () => {
        render(<RouteCardView runs={RUNS} />);
        expect(container.querySelector('[data-testid="map-aggregator-card-mock"]')).toBeNull();
        expect(container.querySelector('.card').firstElementChild.getAttribute('data-testid')).toBe('route-card-mock');
    });

    it('renders no aggregator when nothing matches the filter — the empty state owns that view', () => {
        render(<RouteCardView runs={[]} showAggregatorCard />);
        expect(container.querySelector('[data-testid="map-aggregator-card-mock"]')).toBeNull();
        expect(container.textContent).toContain('No activities found');
    });
});
