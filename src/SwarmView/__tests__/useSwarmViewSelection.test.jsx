// @vitest-environment jsdom
//
// req #3302 — the STATEFUL half of the `/swarm?view=` contract (R9, req #3168).
//
// `swarmViewLink.test.js` covers the pure vocabulary and the param reader. Every
// rule R9 actually states is stateful, though — never written to storage, cleared
// by a manual pick, re-seeded on a link change and not on anything else — and none
// of it is reachable from a pure function. Hence the hook, and hence this file.
//
// A Router is the only provider needed: that is the whole reason the rules were
// lifted out of `SwarmView.jsx`, which additionally needs both Contexts, a
// QueryClient and a DnD provider.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { useSwarmViewSelection } from '../useSwarmViewSelection';
import { SWARM_VIEW_STORAGE_KEY } from '../swarmViewLink';

// A probe that renders the hook's answer, so every assertion reads the value the
// page would actually render. It also captures `useNavigate` — an in-place
// navigation has to go through the router the Probe is already inside;
// re-rendering `MemoryRouter` with different `initialEntries` does NOT navigate
// (that prop is read once, at mount), so a test written that way would assert
// nothing while looking like it asserted the re-seed.
let api;
let navigate;
let result;
const Probe = () => {
    api = useSwarmViewSelection();
    navigate = useNavigate();
    return <div data-testid="view">{api.view}</div>;
};

const mount = (entry) => {
    result = render(
        <MemoryRouter initialEntries={[entry]}><Probe /></MemoryRouter>
    );
    return result;
};

// Scoped to the current render, not `screen` — several cases re-render, and a
// document-wide query would find every mount at once.
const shown = () => result.getByTestId('view').textContent;
const stored = () => ({
    session: sessionStorage.getItem(SWARM_VIEW_STORAGE_KEY),
    local: localStorage.getItem(SWARM_VIEW_STORAGE_KEY),
});

beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    api = undefined;
    result = undefined;
});

afterEach(() => cleanup());

describe('what the page renders on arrival', () => {
    it('falls back to the default with no link and no stored value', () => {
        mount('/swarm');
        expect(shown()).toBe('cards');
    });

    it('honours the stored preference with no link', () => {
        localStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'trends');
        mount('/swarm');
        expect(shown()).toBe('trends');
    });

    it('lets the link WIN over a stored preference', () => {
        localStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'trends');
        mount('/swarm?view=table');
        expect(shown()).toBe('table');
    });

    // The whole point of R9: without this, the surface is unlinkable.
    it('lands on the named view for a first-time visitor', () => {
        mount('/swarm?view=visualizer');
        expect(shown()).toBe('visualizer');
    });

    it('leaves the stored preference in charge for an unknown link value', () => {
        localStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'trends');
        mount('/swarm?view=xyz');
        expect(shown()).toBe('trends');
    });
});

describe('the link is a TRANSIENT override and is never written', () => {
    it('writes nothing to either store on arrival', () => {
        localStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'trends');
        sessionStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'trends');
        mount('/swarm?view=table');
        expect(shown()).toBe('table');
        // The reader's default is untouched: they asked to see one thing once.
        expect(stored()).toEqual({ session: 'trends', local: 'trends' });
    });

    it('leaves a first-time visitor\'s seeded default at the DEFAULT, not the link', () => {
        mount('/swarm?view=table');
        expect(shown()).toBe('table');
        // useViewPreference seeds sessionStorage from the fallback on first mount;
        // that seed must be the page default, never the link's value.
        expect(stored().session).toBe('cards');
        expect(stored().local).toBeNull();
    });
});

describe('a MANUAL PICK clears the override and persists', () => {
    it('makes the link inert from that moment', () => {
        mount('/swarm?view=trends');
        expect(shown()).toBe('trends');

        act(() => api.setView('table'));
        expect(shown()).toBe('table');
        expect(stored()).toEqual({ session: 'table', local: 'table' });

        // The query string is still `?view=trends` in the address bar. The
        // override must NOT come back — that is what "inert" means.
        act(() => api.setView('cards'));
        expect(shown()).toBe('cards');
    });

    // MUI's exclusive ToggleButtonGroup fires onChange(_, null) when the
    // already-selected button is clicked. Clearing the override there would drop
    // the reader from the linked view back to their stored one, on a click that
    // means "no change".
    it('absorbs the null an already-active toggle click sends', () => {
        localStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'cards');
        mount('/swarm?view=trends');
        expect(shown()).toBe('trends');

        act(() => api.setView(null));
        expect(shown()).toBe('trends');
        act(() => api.setView(undefined));
        expect(shown()).toBe('trends');
        expect(stored().local).toBe('cards');
    });
});

describe('a CROSS-VIEW HANDSHAKE overrides without persisting', () => {
    // Clicking a Trends chart bar to inspect its requirements is not a request to
    // make Table the default in every tab forever.
    it('shows the view and writes nothing', () => {
        localStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'trends');
        sessionStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'trends');
        mount('/swarm');
        expect(shown()).toBe('trends');

        act(() => api.showTransiently('table'));
        expect(shown()).toBe('table');
        expect(stored()).toEqual({ session: 'trends', local: 'trends' });
    });

    it('refuses a value outside the vocabulary', () => {
        mount('/swarm');
        act(() => api.showTransiently('nope'));
        expect(shown()).toBe('cards');
    });

    it('is undone by a later manual pick, which does persist', () => {
        mount('/swarm');
        act(() => api.showTransiently('table'));
        expect(shown()).toBe('table');
        act(() => api.setView('visualizer'));
        expect(shown()).toBe('visualizer');
        expect(stored().local).toBe('visualizer');
    });
});

describe('the re-seed fires on a LINK change and nothing else', () => {
    // The component stays mounted across an in-place navigation, so only the
    // effect can answer the new link.
    it('answers an in-place navigation to a new ?view=', () => {
        mount('/swarm?view=table');
        expect(shown()).toBe('table');

        act(() => navigate('/swarm?view=trends'));
        expect(shown()).toBe('trends');
    });

    it('releases the override when the param is dropped', () => {
        localStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'visualizer');
        mount('/swarm?view=table');
        expect(shown()).toBe('table');

        act(() => navigate('/swarm'));
        expect(shown()).toBe('visualizer');
    });

    // A manual pick changes no query param, so `linkView` is referentially
    // identical and the effect must not re-fire against it. If it did, the pick
    // would be undone one frame later and the control would look broken — which
    // is why this asserts the picked view EXACTLY.
    it('does not resurrect the override after a manual pick', () => {
        mount('/swarm?view=trends');
        act(() => api.setView('table'));
        expect(shown()).toBe('table');

        // A navigation that leaves the query string alone.
        act(() => navigate('/swarm?view=trends'));
        expect(shown()).toBe('table');
    });

    // Same rule from the other side: a re-navigation to the SAME link must not
    // undo a transient drill either.
    it('does not resurrect the override after a transient drill', () => {
        mount('/swarm?view=trends');
        act(() => api.showTransiently('table'));
        expect(shown()).toBe('table');

        act(() => navigate('/swarm?view=trends'));
        expect(shown()).toBe('table');
    });
});

describe('the STORED value is validated too', () => {
    // An unmatched ToggleButtonGroup value selects nothing AND every
    // `view === '…'` branch goes false — a header row over an empty body, with no
    // error. localStorage is user- and E2E-writable, so this is reachable.
    it.each(['', 'kanban', 'TABLE'])('normalizes the unrenderable stored value %o', (bad) => {
        localStorage.setItem(SWARM_VIEW_STORAGE_KEY, bad);
        mount('/swarm');
        expect(shown()).toBe('cards');
    });

    it('never writes the normalization back', () => {
        localStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'kanban');
        sessionStorage.setItem(SWARM_VIEW_STORAGE_KEY, 'kanban');
        mount('/swarm');
        expect(shown()).toBe('cards');
        // A stored value the page cannot render is a temporary condition of the
        // PAGE, not a preference change the reader made.
        expect(stored()).toEqual({ session: 'kanban', local: 'kanban' });
    });
});
