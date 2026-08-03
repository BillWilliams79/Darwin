// @vitest-environment jsdom
//
// Req #3158 — the aggregator-card toggle lives in the MapsPage header, next to
// the ViewBar filter chips, in the CARDS view only. This pins the gating and
// the store wiring: present in cards view, absent in trends/table, click flips
// the persisted store, and RouteCardView receives the visibility prop. All
// child views are mocked — their behavior is covered elsewhere.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

let container;
let root;

const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
        root.render(
            <QueryClientProvider client={client}>
                <AppContext.Provider value={{ darwinUri: 'https://api.test' }}>
                    <AuthContext.Provider value={{ idToken: 'token-1', profile: { id: 'user-1' } }}>
                        <MapsPage />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
};

const click = (el) => {
    act(() => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
};

const toggleBtn = () => container.querySelector('[data-testid="map-aggregator-card-toggle"]');

beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    useMapAggregatorCardStore.setState({ show: false });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    routeCardViewProps = undefined;
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
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

        click(container.querySelector('[data-testid="view-toggle-trends"]'));
        expect(toggleBtn()).toBeNull();

        click(container.querySelector('[data-testid="view-toggle-table"]'));
        expect(toggleBtn()).toBeNull();

        click(container.querySelector('[data-testid="view-toggle-cards"]'));
        expect(toggleBtn()).not.toBeNull();
    });
});
