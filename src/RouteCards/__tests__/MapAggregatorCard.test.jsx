// @vitest-environment jsdom
//
// Req #3158 — the aggregator card renders the combined ride track map for the
// FULL filtered list. Leaflet cannot run in jsdom, so ExportMapPreview is
// mocked to a marker div that records how many tracks it was handed — which is
// exactly the acceptance criterion (N filtered rides → N tracks on the card).
// The coordinates hook is mocked so each state (loading / tracks / empty) can
// be exercised directly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let hookResult;
let previewProps;

vi.mock('../../hooks/useDataQueries', () => ({
    useMapCoordinatesForRuns: () => hookResult,
}));

vi.mock('../../MapExport/ExportMapPreview', () => ({
    default: (props) => {
        previewProps = props;
        return <div data-testid="export-map-preview" data-track-count={props.routeCoordinates.length} />;
    },
}));

vi.mock('../../photo-browser/filterUtils.js', () => ({
    countPhotosForRuns: (index, runs) => runs.length * 2,
}));

import MapAggregatorCard from '../MapAggregatorCard';

const RUNS = [
    { id: 1, distance_mi: '10.2', start_time: '2026-05-01T10:00:00' },
    { id: 2, distance_mi: '15.3', start_time: '2026-05-02T10:00:00' },
    { id: 3, distance_mi: '5.1', start_time: '2026-05-03T10:00:00' },
];

const TRACKS = [
    [{ latitude: '37.1', longitude: '-122.1' }, { latitude: '37.2', longitude: '-122.2' }],
    [{ latitude: '38.1', longitude: '-121.1' }, { latitude: '38.2', longitude: '-121.2' }],
    [{ latitude: '39.1', longitude: '-120.1' }, { latitude: '39.2', longitude: '-120.2' }],
];

let container;
let root;

const render = (element) => {
    act(() => root.render(element));
};

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    hookResult = { isLoading: false, isError: false, data: TRACKS };
    previewProps = undefined;
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('MapAggregatorCard (req #3158)', () => {
    it('renders under its testid with one track per filtered ride', () => {
        render(<MapAggregatorCard runs={RUNS} />);
        expect(container.querySelector('[data-testid="map-aggregator-card"]')).not.toBeNull();
        const preview = container.querySelector('[data-testid="export-map-preview"]');
        expect(preview.getAttribute('data-track-count')).toBe('3');
        expect(previewProps.routeCoordinates).toBe(hookResult.data);
        expect(previewProps.scrollWheel).toBe(false);
        expect(previewProps.preferCanvas).toBe(true);
    });

    it('stats header shows ride count and total distance; no photo segment without an index', () => {
        render(<MapAggregatorCard runs={RUNS} dedupedPhotoIndex={null} />);
        const stats = container.querySelector('[data-testid="map-aggregator-card-stats"]');
        expect(stats.textContent).toContain('3 rides');
        expect(stats.textContent).toContain('30.6 mi');
        expect(stats.textContent).not.toContain('photo');
    });

    it('uses the singular form for one ride', () => {
        hookResult = { isLoading: false, isError: false, data: [TRACKS[0]] };
        render(<MapAggregatorCard runs={[RUNS[0]]} />);
        const stats = container.querySelector('[data-testid="map-aggregator-card-stats"]');
        expect(stats.textContent).toContain('1 ride');
        expect(stats.textContent).not.toContain('1 rides');
    });

    it('sums photo counts across the filtered rides once the index is loaded', () => {
        render(<MapAggregatorCard runs={RUNS} dedupedPhotoIndex={[{}]} />);
        const stats = container.querySelector('[data-testid="map-aggregator-card-stats"]');
        expect(stats.textContent).toContain('6 photos');
    });

    it('shows a spinner, not the map, while coordinates load', () => {
        hookResult = { isLoading: true, isError: false, data: undefined };
        render(<MapAggregatorCard runs={RUNS} />);
        expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="export-map-preview"]')).toBeNull();
    });

    it('surfaces a fetch failure instead of quietly dropping tracks', () => {
        hookResult = { isLoading: false, isError: true, data: undefined };
        render(<MapAggregatorCard runs={RUNS} />);
        expect(container.querySelector('[data-testid="map-aggregator-card-error"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="export-map-preview"]')).toBeNull();
        expect(container.textContent).not.toContain('No map data');
    });

    it('shows the no-data placeholder when no ride has a track', () => {
        hookResult = { isLoading: false, isError: false, data: [[], [], []] };
        render(<MapAggregatorCard runs={RUNS} />);
        expect(container.querySelector('[data-testid="export-map-preview"]')).toBeNull();
        expect(container.textContent).toContain('No map data');
    });
});
