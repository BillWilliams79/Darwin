// @vitest-environment jsdom
//
// Req #3158 — the aggregator-card toggle lives in the MapsPage header, next to
// the ViewBar filter chips, in the CARDS view only. This pins the gating and
// the store wiring: present in cards view, absent in trends/table, click flips
// the persisted store, and RouteCardView receives the visibility prop. All
// child views are mocked — their behavior is covered elsewhere.
//
// Req #3174 criterion 7 — the toggle's persistence semantics as the USER meets
// them: the click writes through to localStorage, and a page mounting with an
// already-persisted state comes up showing the card. The store's own contract
// is unit-tested in stores/__tests__/useMapAggregatorCardStore.test.js.
// Rendering is @testing-library/react.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let routeCardViewProps;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));
vi.mock('../../MapRuns/MapRunsView', () => ({ default: () => null, TABLE_WIDTH: 1200 }));
vi.mock('../../RouteCards/RouteCardView', () => ({
    default: (props) => {
        routeCardViewProps = props;
        return <div data-testid="route-card-view-mock" />;
    },
}));
vi.mock('../../Trends/TrendsView', () => ({ default: () => null }));
vi.mock('../ViewBar', () => ({ default: () => <div data-testid="view-bar-mock" /> }));
vi.mock('../ViewDialog', () => ({ default: () => null }));
vi.mock('../TrendsFilterChips', () => ({ default: () => null }));
vi.mock('../PickerDialog', () => ({ default: () => null }));
vi.mock('../../MapExport/ExportDialog', () => ({ default: () => null }));
vi.mock('../../photo-browser/proxyConfig.js', () => ({ IS_MACOS: false }));
vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn() }));
vi.mock('../../hooks/useDataQueries', () => {
    const empty = () => ({ data: [], isLoading: false });
    return {
        useMapRuns: empty,
        useMapRoutes: empty,
        useMapViews: empty,
        useMapPartners: empty,
        useMapRunPartners: empty,
    };
});

import MapsPage from '../MapsPage';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { useMapAggregatorCardStore } from '../../stores/useMapAggregatorCardStore';

const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AppContext.Provider value={{ darwinUri: 'https://api.test' }}>
                <AuthContext.Provider value={{ idToken: 'token-1', profile: { id: 'user-1' } }}>
                    <MapsPage />
                </AuthContext.Provider>
            </AppContext.Provider>
        </QueryClientProvider>
    );
};

const click = (el) => fireEvent.click(el);

const toggleBtn = () => screen.queryByTestId('map-aggregator-card-toggle');

beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    useMapAggregatorCardStore.setState({ show: false });
    routeCardViewProps = undefined;
});

afterEach(() => {
    cleanup();
});

describe('MapsPage aggregator toggle (req #3158)', () => {
    it('shows the toggle in cards view and flips the persisted store on click', () => {
        renderPage();

        expect(toggleBtn()).not.toBeNull();
        expect(routeCardViewProps.showAggregatorCard).toBe(false);

        click(toggleBtn());
        expect(useMapAggregatorCardStore.getState().show).toBe(true);
        expect(routeCardViewProps.showAggregatorCard).toBe(true);

        click(toggleBtn());
        expect(useMapAggregatorCardStore.getState().show).toBe(false);
    });

    it('hides the toggle outside the cards view', () => {
        renderPage();
        expect(toggleBtn()).not.toBeNull();

        click(screen.getByTestId('view-toggle-trends'));
        expect(toggleBtn()).toBeNull();

        click(screen.getByTestId('view-toggle-table'));
        expect(toggleBtn()).toBeNull();

        click(screen.getByTestId('view-toggle-cards'));
        expect(toggleBtn()).not.toBeNull();
    });
});

// Req #3174 criterion 7, at the surface the user actually meets: the toggle is
// the only writer, and what it writes is what a later mount reads.
describe('MapsPage aggregator toggle persistence (req #3174)', () => {
    it('writes the toggle through to localStorage on click', () => {
        renderPage();
        // beforeEach's setState is itself a persisted write, so the key exists
        // and reads false — the click is what has to move it.
        const before = JSON.parse(localStorage.getItem('darwin_map_aggregator_card'));
        expect(before.state.show).toBe(false);

        click(toggleBtn());

        const persisted = JSON.parse(localStorage.getItem('darwin_map_aggregator_card'));
        expect(persisted.state.show).toBe(true);
    });

    it('comes up showing the card when the store was left on — the reload case', () => {
        // What rehydration leaves behind before MapsPage ever mounts.
        useMapAggregatorCardStore.setState({ show: true });

        renderPage();

        expect(routeCardViewProps.showAggregatorCard).toBe(true);
        // Off is likewise restored, not merely defaulted to.
        click(toggleBtn());
        expect(routeCardViewProps.showAggregatorCard).toBe(false);
        expect(JSON.parse(localStorage.getItem('darwin_map_aggregator_card')).state.show).toBe(false);
    });

    it('leaves the persisted state alone while the user is in another view', () => {
        useMapAggregatorCardStore.setState({ show: true });
        renderPage();

        click(screen.getByTestId('view-toggle-trends'));

        // Discard the capture from the initial cards render. Without this the
        // assertion below is satisfied by the value taken at mount, so a
        // regression that stopped rendering RouteCardView on the way back would
        // still pass.
        routeCardViewProps = undefined;
        click(screen.getByTestId('view-toggle-cards'));

        expect(routeCardViewProps).toBeDefined();
        expect(useMapAggregatorCardStore.getState().show).toBe(true);
        expect(routeCardViewProps.showAggregatorCard).toBe(true);
    });
});
