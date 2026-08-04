// @vitest-environment jsdom
//
// Req #3158 — the aggregator card renders the combined ride track map for the
// FULL filtered list. Leaflet cannot run in jsdom, so RouteMapThumbnail and
// RouteMapFull are mocked to marker divs that record how many tracks/runs
// they were handed — which is exactly the acceptance criterion (N filtered
// rides → N tracks on the card). The coordinates hook is mocked so each
// state (loading / tracks / empty) can be exercised directly.
//
// Req #3174 — component-test coverage for feature #23. Adds the cap boundary
// (MAX_AGGREGATE_RUNS + the truncation notice, driven with 201 stub runs) and
// the stats arithmetic over the string DECIMALs Lambda-Rest actually returns.
//
// Req #3165 review — the card was rebuilt to reuse the SAME two map
// components a per-ride card uses instead of a lookalike built for this
// card: RouteMapThumbnail as the card's non-interactive preview, and
// RouteMapFull — reached the same way a per-ride card reaches it, by leaving
// the card entirely rather than growing inside it — for the full interactive
// map, opened in a `Dialog fullScreen` (the aggregate has no id to route to,
// so this stands in for the navigation a per-ride card does). Both
// generalized for multiple tracks. That moved the photo layer's downsampling
// math and its IS_MACOS/photo-browser-enabled gate INTO RouteMapFull, which
// — like every other Leaflet-heavy component in this codebase
// (RouteMapThumbnail included) — has no unit coverage today; Leaflet cannot
// run in jsdom, and this file's own mocking strategy exists because of that.
// Tests that used to assert that math/gating directly are removed rather
// than kept as false coverage; what remains here asserts the wiring THIS
// component owns — whether the dialog is open, and what
// tracks/runs/dedupedIndex/height/preferCanvas it hands to each tier.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

let hookResult;
let thumbnailProps;
let fullProps;
let runIdsRequested;

vi.mock('../../hooks/useDataQueries', () => ({
    useMapCoordinatesForRuns: (runIds) => {
        runIdsRequested = runIds;
        return hookResult;
    },
}));

vi.mock('../RouteMapThumbnail', () => ({
    default: (props) => {
        thumbnailProps = props;
        return <div data-testid="route-map-thumbnail" data-track-count={props.tracks.length} />;
    },
}));

vi.mock('../RouteMapFull', () => ({
    default: (props) => {
        fullProps = props;
        return (
            <div
                data-testid="route-map-full"
                data-track-count={props.tracks.length}
                data-run-count={(props.runs || []).length}
            />
        );
    },
}));

// Two photos per ride by default — enough to prove the count follows the run
// set. `photoCount` is overridable so the singular branch (exactly 1) is
// reachable, which a fixed 2/ride stub can never produce.
const photoStub = vi.hoisted(() => ({ count: null }));
vi.mock('../../photo-browser/filterUtils.js', () => ({
    countPhotosForRuns: (index, runs) => (photoStub.count ?? runs.length * 2),
}));

import MapAggregatorCard, { MAX_AGGREGATE_RUNS } from '../MapAggregatorCard';

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

// n stub rides, newest first — the order MapsPage's filter chain preserves.
// Each carries 1.0 mi so a capped sum is arithmetically distinct from an
// uncapped one (200 vs 201), and one track apiece.
//
// Timestamps DESCEND and are all distinct, deliberately: identical stamps would
// make the recency test below a statement about array position only, which a
// stable re-sort inside the component would satisfy while dropping the wrong
// rides. Index 0 is the newest.
const stubRuns = (n) => Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    distance_mi: '1.0',
    start_time: new Date(Date.UTC(2026, 4, 1, 10, 0, 0) - i * 86400000)
        .toISOString().slice(0, 19),
}));
const stubTracks = (n) => Array.from({ length: n }, (_, i) => (
    [{ latitude: `${37 + i * 0.001}`, longitude: '-122.1' }]
));

const statsText = () => screen.getByTestId('map-aggregator-card-stats').textContent;
const truncationNotice = () => screen.queryByTestId('map-aggregator-card-truncation');
const expandCard = () => fireEvent.click(screen.getByTestId('map-aggregator-card-preview'));

beforeEach(() => {
    hookResult = { isLoading: false, isError: false, data: TRACKS };
    thumbnailProps = undefined;
    fullProps = undefined;
    runIdsRequested = undefined;
    photoStub.count = null;
});

afterEach(() => {
    cleanup();
});

describe('MapAggregatorCard (req #3158)', () => {
    it('renders the clickable preview first, with one track per filtered ride', () => {
        render(<MapAggregatorCard runs={RUNS} />);
        expect(screen.getByTestId('map-aggregator-card')).not.toBeNull();
        expect(screen.getByTestId('route-map-thumbnail').getAttribute('data-track-count')).toBe('3');
        expect(thumbnailProps.tracks).toBe(hookResult.data);
        expect(thumbnailProps.height).toBe(400);
        expect(thumbnailProps.preferCanvas).toBe(true);
        expect(screen.queryByTestId('route-map-full')).toBeNull();
    });

    it('opens the same full map every per-ride card uses, full-screen, when the preview is clicked', () => {
        render(<MapAggregatorCard runs={RUNS} />);
        // No full-screen dialog until the preview is clicked — a per-ride
        // card doesn't leave its own page until its thumbnail is clicked
        // either.
        expect(screen.queryByTestId('route-map-full')).toBeNull();

        expandCard();

        // Full screen, not the card: RouteMapFull mounts in a Dialog
        // (portaled to document.body), not inside the 400px card cell —
        // and the card's own preview stays exactly as it was, underneath.
        expect(screen.getByTestId('map-aggregator-card-full-dialog')).not.toBeNull();
        expect(screen.getByTestId('route-map-full').getAttribute('data-track-count')).toBe('3');
        expect(fullProps.tracks).toBe(hookResult.data);
        expect(fullProps.runs).toBe(RUNS);
        expect(fullProps.height).toBe('100%');
        expect(fullProps.preferCanvas).toBe(true);
        expect(screen.getByTestId('route-map-thumbnail')).not.toBeNull();
    });

    it('closes the full-screen dialog via its own close button', async () => {
        render(<MapAggregatorCard runs={RUNS} />);
        expandCard();
        expect(screen.getByTestId('route-map-full')).not.toBeNull();

        fireEvent.click(screen.getByTestId('map-aggregator-card-collapse-button'));
        // MUI's Dialog unmounts its content after its exit transition, not
        // synchronously with the click.
        await waitFor(() => expect(screen.queryByTestId('route-map-full')).toBeNull());
    });

    it('stats header shows ride count and total distance; no photo segment without an index', () => {
        render(<MapAggregatorCard runs={RUNS} dedupedPhotoIndex={null} />);
        expect(statsText()).toContain('3 rides');
        expect(statsText()).toContain('30.6 mi');
        expect(statsText()).not.toContain('photo');
    });

    it('uses the singular form for one ride', () => {
        hookResult = { isLoading: false, isError: false, data: [TRACKS[0]] };
        render(<MapAggregatorCard runs={[RUNS[0]]} />);
        expect(statsText()).toContain('1 ride');
        expect(statsText()).not.toContain('1 rides');
    });

    it('sums photo counts across the filtered rides once the index is loaded', () => {
        render(<MapAggregatorCard runs={RUNS} dedupedPhotoIndex={[{}]} />);
        expect(statsText()).toContain('6 photos');
    });

    it('shows a spinner, not either map tier, while coordinates load', () => {
        hookResult = { isLoading: true, isError: false, data: undefined };
        render(<MapAggregatorCard runs={RUNS} />);
        expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
        expect(screen.queryByTestId('route-map-thumbnail')).toBeNull();
        expect(screen.queryByTestId('route-map-full')).toBeNull();
    });

    it('surfaces a fetch failure instead of quietly dropping tracks', () => {
        hookResult = { isLoading: false, isError: true, data: undefined };
        render(<MapAggregatorCard runs={RUNS} />);
        expect(screen.getByTestId('map-aggregator-card-error')).not.toBeNull();
        expect(screen.queryByTestId('route-map-thumbnail')).toBeNull();
        expect(document.body.textContent).not.toContain('No map data');
    });

    it('shows the no-data placeholder when no ride has a track', () => {
        hookResult = { isLoading: false, isError: false, data: [[], [], []] };
        render(<MapAggregatorCard runs={RUNS} />);
        expect(screen.queryByTestId('route-map-thumbnail')).toBeNull();
        expect(document.body.textContent).toContain('No map data');
    });
});

// Req #3174 criterion 3. The cap was exported by the pre-#3181 implementation,
// lost in that revert, and rebuilt with this requirement; feature #23's linked
// test case 3 is the spec — capped set on the map, capped set in the header,
// and the shortfall stated on screen. 201 runs is the boundary+1 named there.
describe('MapAggregatorCard cap (req #3174)', () => {
    it('caps the coordinate fan-out at MAX_AGGREGATE_RUNS with 201 filtered rides', () => {
        const runs = stubRuns(MAX_AGGREGATE_RUNS + 1);
        hookResult = { isLoading: false, isError: false, data: stubTracks(MAX_AGGREGATE_RUNS) };
        render(<MapAggregatorCard runs={runs} />);

        // One coordinate query per aggregated ride — 200, never 201.
        expect(runIdsRequested).toHaveLength(MAX_AGGREGATE_RUNS);
        expect(screen.getByTestId('route-map-thumbnail').getAttribute('data-track-count'))
            .toBe(String(MAX_AGGREGATE_RUNS));
    });

    it('keeps the MOST RECENT rides, since runs arrive start_time:desc', () => {
        const runs = stubRuns(MAX_AGGREGATE_RUNS + 1);
        render(<MapAggregatorCard runs={runs} />);

        // Stated against the TIMESTAMPS, not against array positions: the ride
        // dropped must be the oldest one in the set, and every ride kept must
        // be newer than it. A tail slice fails, and so does a re-sort that
        // happens to preserve order on equal keys.
        const byId = new Map(runs.map(r => [r.id, r.start_time]));
        const kept = runIdsRequested.map(id => byId.get(id));
        const dropped = runs
            .filter(r => !runIdsRequested.includes(r.id))
            .map(r => r.start_time);

        expect(kept).toHaveLength(MAX_AGGREGATE_RUNS);
        expect(dropped).toEqual([runs[MAX_AGGREGATE_RUNS].start_time]);
        const oldestKept = kept.reduce((a, b) => (a < b ? a : b));
        expect(oldestKept > dropped[0]).toBe(true);
    });

    it('drops the OLDEST ride even when the newest is not first in the array', () => {
        // Guards the claim from the other side. If the component ever sorts
        // rather than slicing the head, this is the case that tells the two
        // apart: the head here is the oldest ride, so a head-slice keeps it and
        // a recency-sort does not. Documents the CURRENT contract — the card
        // slices the head and relies on MapsPage delivering start_time:desc —
        // so if that precondition is ever broken upstream, this test says which
        // behaviour the card actually has rather than leaving it to the caption.
        const runs = stubRuns(MAX_AGGREGATE_RUNS + 1);
        const rotated = [runs[MAX_AGGREGATE_RUNS], ...runs.slice(0, MAX_AGGREGATE_RUNS)];
        render(<MapAggregatorCard runs={rotated} />);

        expect(runIdsRequested).toHaveLength(MAX_AGGREGATE_RUNS);
        expect(runIdsRequested[0]).toBe(rotated[0].id);
        expect(runIdsRequested).not.toContain(rotated[MAX_AGGREGATE_RUNS].id);
    });

    it('reports the truncation visibly, naming the cap and the true total', () => {
        render(<MapAggregatorCard runs={stubRuns(201)} />);
        const notice = truncationNotice();
        expect(notice).not.toBeNull();
        expect(notice.textContent).toBe('showing the 200 most recent of 201 rides');
    });

    it('computes the header over the CAPPED set so header and map agree', () => {
        // 201 rides × 1.0 mi: an uncapped sum reads 201, a capped one 200.
        render(<MapAggregatorCard runs={stubRuns(201)} dedupedPhotoIndex={[{}]} />);
        expect(statsText()).toContain('200 rides');
        expect(statsText()).not.toContain('201 rides');
        expect(statsText()).toContain('200 mi');
        // countPhotosForRuns is stubbed at 2/ride → capped set, not 402.
        expect(statsText()).toContain('400 photos');
    });

    it('hands the full map the capped run set too, once expanded', () => {
        render(<MapAggregatorCard runs={stubRuns(201)} />);
        expandCard();
        expect(fullProps.runs).toHaveLength(MAX_AGGREGATE_RUNS);
    });

    it('does not truncate exactly AT the cap — the notice is absent and all 200 draw', () => {
        const runs = stubRuns(MAX_AGGREGATE_RUNS);
        render(<MapAggregatorCard runs={runs} />);
        expect(truncationNotice()).toBeNull();
        expect(runIdsRequested).toHaveLength(MAX_AGGREGATE_RUNS);
        expect(statsText()).toContain('200 rides');
    });

    it('shows no notice below the cap', () => {
        render(<MapAggregatorCard runs={RUNS} />);
        expect(truncationNotice()).toBeNull();
    });
});

// Req #3174 criterion 4. distance_mi is a DECIMAL column: Lambda-Rest returns
// it as a STRING, and a NULL column arrives as null. A `+` on strings would
// concatenate ("10.2" + "15.3" → "10.215.3"), which is why the sum must stay
// numeric — and why this is asserted rather than assumed.
describe('MapAggregatorCard stats arithmetic (req #3174)', () => {
    const withDistances = (values) => values.map((distance_mi, i) => ({
        id: i + 1, distance_mi, start_time: '2026-05-01T10:00:00',
    }));

    it('sums string DECIMALs numerically, not by concatenation', () => {
        render(<MapAggregatorCard runs={withDistances(['10.2', '15.3', '5.1'])} />);
        expect(statsText()).toContain('30.6 mi');
        expect(statsText()).not.toContain('10.215.3');
    });

    it('rounds the accumulated float to one decimal', () => {
        // 0.1 + 0.2 is 0.30000000000000004 in IEEE 754 — unrounded that leaks
        // straight into the header.
        render(<MapAggregatorCard runs={withDistances(['0.1', '0.2'])} />);
        expect(statsText()).toContain('0.3 mi');
        expect(statsText()).not.toContain('0.30000000000000004');
    });

    it('treats a NULL / missing / unparseable distance as zero rather than NaN', () => {
        render(<MapAggregatorCard runs={withDistances([null, undefined, '', 'n/a', '12.5'])} />);
        expect(statsText()).toContain('5 rides');
        expect(statsText()).toContain('12.5 mi');
        expect(statsText()).not.toContain('NaN');
    });

    it('counts every filtered ride, including zero-distance ones', () => {
        render(<MapAggregatorCard runs={withDistances(['0.0', '0', '4.0'])} />);
        expect(statsText()).toContain('3 rides');
        expect(statsText()).toContain('4 mi');
    });

    it('renders an empty aggregate without arithmetic artifacts', () => {
        // RouteCardView gates on runs.length, so this is defensive — but the
        // header must not read "NaN mi" if it is ever reached directly.
        hookResult = { isLoading: false, isError: false, data: [] };
        render(<MapAggregatorCard runs={[]} />);
        expect(statsText()).toContain('0 rides');
        expect(statsText()).toContain('0 mi');
        expect(statsText()).not.toContain('NaN');
    });

    it('pluralizes photos, singular at exactly one', () => {
        photoStub.count = 1;
        render(<MapAggregatorCard runs={RUNS} dedupedPhotoIndex={[{}]} />);
        expect(statsText()).toContain('1 photo');
        expect(statsText()).not.toContain('1 photos');
        cleanup();

        photoStub.count = 2;
        render(<MapAggregatorCard runs={RUNS} dedupedPhotoIndex={[{}]} />);
        expect(statsText()).toContain('2 photos');
    });

    it('renders a zero photo count rather than hiding the segment', () => {
        // 0 is a real answer — "this filter has no photos" — and `!= null`
        // rather than a truthiness check is what keeps it on screen.
        photoStub.count = 0;
        render(<MapAggregatorCard runs={RUNS} dedupedPhotoIndex={[{}]} />);
        expect(statsText()).toContain('0 photos');
    });
});

// Req #3174 criterion 5 — an absent photo index must degrade, not explode.
describe('MapAggregatorCard photo index states (req #3174)', () => {
    it('renders no photo segment and throws nothing when the index is null', () => {
        expect(() => render(<MapAggregatorCard runs={RUNS} dedupedPhotoIndex={null} />)).not.toThrow();
        expect(statsText()).not.toContain('photo');
        // The map itself is unaffected — a missing index costs the count, not the card.
        expect(screen.getByTestId('route-map-thumbnail')).not.toBeNull();
    });

    it('renders no photo segment when the parent is not managing an index at all', () => {
        expect(() => render(<MapAggregatorCard runs={RUNS} />)).not.toThrow();
        expect(statsText()).not.toContain('photo');
    });

    it('passes the null index straight through to RouteMapFull, once expanded', () => {
        // null means "parent is loading"; undefined means "self-load". The card
        // must not collapse the two — the layer's fallback depends on the
        // difference (req #3159).
        render(<MapAggregatorCard runs={RUNS} dedupedPhotoIndex={null} />);
        expandCard();
        expect(fullProps.dedupedIndex).toBeNull();
        cleanup();

        render(<MapAggregatorCard runs={RUNS} />);
        expandCard();
        expect(fullProps.dedupedIndex).toBeUndefined();
    });
});
