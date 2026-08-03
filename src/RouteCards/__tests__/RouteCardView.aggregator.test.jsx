// @vitest-environment jsdom
//
// Req #3158 — RouteCardView's aggregator wiring, stated acceptance criteria:
// the card is the FIRST cell of the grid on every pagination page, it is fed
// the FULL filtered list (never the 25-row slice), and it only renders when
// toggled on. RouteCard and the aggregator itself are mocked — leaflet cannot
// run in jsdom and their internals are covered by their own tests.
//
// Req #3174 — criteria 1 and 2. `runs` → `paginatedRuns` in the aggregator's
// prop is a ONE-WORD regression that changes nothing visible about the grid
// and silently reduces the aggregate to the current page, so it is pinned from
// both directions: the prop identity, and a page turn that must not move it.
// The cap lives in the card, not the view — at 201 filtered rides the view
// still hands over all 201 and the card is what trims (see
// MapAggregatorCard.test.jsx). Rendering is @testing-library/react.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

let aggregatorProps;
let aggregatorRenders;

vi.mock('../RouteCard', () => ({
    default: ({ run }) => <div data-testid="route-card-mock" data-run-id={run.id} />,
}));

vi.mock('../MapAggregatorCard', () => ({
    default: (props) => {
        aggregatorProps = props;
        aggregatorRenders += 1;
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

const grid = () => document.querySelector('.card');

beforeEach(() => {
    aggregatorProps = undefined;
    aggregatorRenders = 0;
});

afterEach(() => {
    cleanup();
});

describe('RouteCardView aggregator wiring (req #3158)', () => {
    it('renders the aggregator as the first grid cell, fed the FULL filtered list', () => {
        render(<RouteCardView runs={RUNS} showAggregatorCard />);

        expect(grid().firstElementChild.getAttribute('data-testid')).toBe('map-aggregator-card-mock');

        // Full list, not the 25-row pagination slice…
        expect(aggregatorProps.runs).toHaveLength(30);
        // Gate off at module load → this view is NOT managing the photo index,
        // signalled as undefined (never null) so the layer can self-load.
        expect(aggregatorProps.dedupedPhotoIndex).toBeUndefined();
        // …while the grid itself shows only the page.
        expect(screen.getAllByTestId('route-card-mock')).toHaveLength(25);
    });

    it('renders no aggregator when toggled off', () => {
        render(<RouteCardView runs={RUNS} />);
        expect(screen.queryByTestId('map-aggregator-card-mock')).toBeNull();
        expect(grid().firstElementChild.getAttribute('data-testid')).toBe('route-card-mock');
    });

    it('renders no aggregator when nothing matches the filter — the empty state owns that view', () => {
        render(<RouteCardView runs={[]} showAggregatorCard />);
        expect(screen.queryByTestId('map-aggregator-card-mock')).toBeNull();
        expect(document.body.textContent).toContain('No activities found');
    });
});

// Req #3174 criterion 2. The regression this guards is invisible on screen:
// the grid looks identical either way, and only the aggregate's contents move.
describe('RouteCardView aggregate source (req #3174)', () => {
    it('hands over the SAME array object it was given, not a derived slice', () => {
        render(<RouteCardView runs={RUNS} showAggregatorCard />);
        // Identity, not just length: `runs.slice(...)` of the whole list would
        // still be 30 long on page 1 and would pass a length-only assertion.
        expect(aggregatorProps.runs).toBe(RUNS);
    });

    it('keeps the aggregate on the full list after a page turn', () => {
        render(<RouteCardView runs={RUNS} showAggregatorCard />);
        expect(screen.getAllByTestId('route-card-mock')).toHaveLength(25);

        fireEvent.click(screen.getByRole('button', { name: /next page/i }));

        // Page 2 holds the 5 remaining cards…
        expect(screen.getAllByTestId('route-card-mock')).toHaveLength(5);
        // …and the aggregator is still first and still fed all 30.
        expect(grid().firstElementChild.getAttribute('data-testid')).toBe('map-aggregator-card-mock');
        expect(aggregatorProps.runs).toBe(RUNS);
    });

    it('is first on the page-2 grid too, not just on page 1', () => {
        render(<RouteCardView runs={RUNS} showAggregatorCard />);
        fireEvent.click(screen.getByRole('button', { name: /next page/i }));
        const cells = Array.from(grid().children);
        expect(cells[0].getAttribute('data-testid')).toBe('map-aggregator-card-mock');
        expect(within(grid()).getAllByTestId('route-card-mock')).toHaveLength(5);
    });

    it('passes all 201 rides down at cap scale — the trim belongs to the card', () => {
        const many = Array.from({ length: 201 }, (_, i) => ({ id: i + 1 }));
        render(<RouteCardView runs={many} showAggregatorCard />);
        expect(aggregatorProps.runs).toHaveLength(201);
        expect(screen.getAllByTestId('route-card-mock')).toHaveLength(25);
    });

    it('renders nothing but the loading spinner while runs are still loading', () => {
        render(<RouteCardView runs={RUNS} showAggregatorCard isLoading />);
        expect(screen.queryByTestId('map-aggregator-card-mock')).toBeNull();
        expect(aggregatorRenders).toBe(0);
        expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
    });
});
