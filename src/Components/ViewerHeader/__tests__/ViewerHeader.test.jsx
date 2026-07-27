// @vitest-environment jsdom
//
// Req #3067 — the shared viewer header.
//
// What is worth testing here is NOT that MUI renders a toggle group. It is the
// handful of contracts that, if broken, break silently:
//
//   * THE TESTIDS IT DERIVES. Three shipped pages and an 864-line Playwright suite
//     reach for `instructions-view-toggle`, `instructions-settings-button`,
//     `instructions-sort-menu` and `instructions-sort-agents`. Those are now
//     produced by a template inside this component. A change to the template is
//     invisible in every unit test that does not assert the exact strings, and
//     surfaces as a mass E2E failure with no obvious cause.
//   * IT MUST NOT WRITE THE NORMALIZED VIEW BACK. Normalizing for display is
//     correct; persisting the normalization silently rewrites a preference the user
//     set and can never get back. Only a "the setter was not called" assertion can
//     catch a regression here — the rendered output is identical either way.
//   * THE `onClick(close)` DELEGATION. Re-picking the active sort mode must reverse
//     it and KEEP THE MENU OPEN so the arrow flip is visible. A component that
//     closed on every click would look completely normal and quietly destroy that
//     affordance.
//   * OMITTED SLOTS RENDER NOTHING. `/agents` passes no filters, no gear and (until
//     this req) no accounting line. A component that rendered an empty gear or a
//     blank accounting line would put furniture on a page that asked for none.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TableChartIcon from '@mui/icons-material/TableChart';
import SortByAlphaIcon from '@mui/icons-material/SortByAlpha';

import ViewerHeader from '../ViewerHeader';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const VIEWS = [
    { value: 'cards', label: 'Cards view', icon: ViewModuleIcon },
    { value: 'table', label: 'Table view', icon: TableChartIcon },
];

// Menus and tooltips PORTAL to document.body, not into `container`. Querying the
// container for a menu item is the classic way to write a test that can only fail.
const byId = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);

const render = (props) => act(() => {
    root.render(
        <ViewerHeader
            title="Instructions"
            views={VIEWS}
            view="cards"
            onViewChange={() => {}}
            testIdPrefix="instructions"
            {...props}
        />);
});

const click = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

describe('ViewerHeader — the testids it derives', () => {
    it('emits the exact ids three shipped pages and the E2E suite depend on', () => {
        render({
            settingsItems: [{
                id: 'sort',
                heading: 'Sort by',
                items: [{
                    id: 'agents', label: 'Agent Count',
                    icon: <SortByAlphaIcon fontSize="small" />, onClick: () => {},
                }],
            }],
            accounting: '3 instructions',
        });

        expect(byId('instructions-view-toggle')).toBeTruthy();
        expect(byId('instructions-settings-button')).toBeTruthy();
        expect(byId('instructions-accounting')).toBeTruthy();
        // Per-button ids stay LITERAL — they are not prefixed, because a test
        // switching views should not have to know which page it is on.
        expect(byId('view-toggle-cards')).toBeTruthy();
        expect(byId('view-toggle-table')).toBeTruthy();

        click(byId('instructions-settings-button'));
        // `<prefix>-sort-menu`, not `-settings-menu`: a deliberate wart, kept so the
        // shipped Playwright suite stays green.
        expect(byId('instructions-sort-menu')).toBeTruthy();
        // `<prefix>-<groupId>-<itemId>` reproduces `instructions-sort-agents`
        // byte-identically. This assertion IS the compatibility guarantee.
        expect(byId('instructions-sort-agents')).toBeTruthy();
    });

    it('marks the active view pressed', () => {
        render({ view: 'table' });
        expect(byId('view-toggle-table').getAttribute('aria-pressed')).toBe('true');
        expect(byId('view-toggle-cards').getAttribute('aria-pressed')).toBe('false');
    });
});

describe('ViewerHeader — view normalization', () => {
    it('selects a fallback view when the stored one is not available', () => {
        // A browser holding 'table' from before the button existed.
        render({ views: [VIEWS[0]], view: 'table' });
        expect(byId('view-toggle-cards').getAttribute('aria-pressed')).toBe('true');
    });

    it('NEVER writes the normalized value back through onViewChange', () => {
        // The whole point. `useViewPreference`'s setter writes localStorage as well
        // as sessionStorage, so a write-back here would permanently and invisibly
        // overwrite a cross-tab preference the user chose — and req #3067 is the
        // proof it matters, because it hands 'table' back to exactly those users.
        const onViewChange = vi.fn();
        render({ views: [VIEWS[0]], view: 'table', onViewChange });
        expect(onViewChange).not.toHaveBeenCalled();
    });

    it('forwards a real user selection unchanged', () => {
        const onViewChange = vi.fn();
        render({ onViewChange });
        click(byId('view-toggle-table'));
        expect(onViewChange).toHaveBeenCalledWith('table');
    });
});

describe('ViewerHeader — the settings menu', () => {
    const sortItems = (onClick, selected = 'agents') => [{
        id: 'sort',
        heading: 'Sort by',
        items: [
            {
                id: 'agents', label: 'Agent Count',
                icon: <SortByAlphaIcon fontSize="small" />,
                selected: selected === 'agents',
                trailing: <span data-testid="arrow">↓</span>,
                onClick,
            },
            {
                id: 'name', label: 'Name',
                icon: <SortByAlphaIcon fontSize="small" />,
                selected: selected === 'name',
                onClick,
            },
        ],
    }];

    it('hands the item a `close` callback rather than closing by itself', () => {
        // The delegation exists because the component cannot infer which items
        // should dismiss the menu. Re-picking the ACTIVE mode must not.
        const onClick = vi.fn();
        render({ settingsItems: sortItems(onClick) });

        click(byId('instructions-settings-button'));
        click(byId('instructions-sort-agents'));

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(typeof onClick.mock.calls[0][0]).toBe('function');
        // Not called => not closed. The menu is still on screen.
        expect(byId('instructions-sort-menu')).toBeTruthy();
    });

    it('closes when the item calls the callback it was given', async () => {
        const onClick = vi.fn((close) => close());
        render({ settingsItems: sortItems(onClick) });

        click(byId('instructions-settings-button'));
        expect(byId('instructions-sort-menu')).toBeTruthy();

        await act(async () => {
            byId('instructions-sort-name').dispatchEvent(
                new MouseEvent('click', { bubbles: true }));
        });
        // MUI closes the Menu through a Grow transition and unmounts on exit, so
        // the DOM does not settle synchronously. Wait past the transition rather
        // than asserting on a half-torn-down tree — the alternative is reaching into
        // MUI's `visibility: hidden`-during-exit internals, which is a test that
        // breaks on a library upgrade rather than on a real regression.
        await act(async () => { await new Promise(r => setTimeout(r, 600)); });
        expect(document.body.querySelector('.MuiModal-root')).toBeFalsy();
    });

    it('renders the trailing node — the only affordance saying a re-pick reverses', () => {
        render({ settingsItems: sortItems(() => {}) });
        click(byId('instructions-settings-button'));
        expect(byId('arrow')).toBeTruthy();
    });
});

describe('ViewerHeader — omitted slots', () => {
    it('renders no gear when settingsItems is omitted', () => {
        render({});
        expect(byId('instructions-settings-button')).toBeFalsy();
        expect(byId('instructions-sort-menu')).toBeFalsy();
    });

    it('renders no gear for an EMPTY settingsItems array', () => {
        // A page computing its groups conditionally (InstructionsPage renders the
        // sort group in Cards view only) can legitimately arrive here with [].
        render({ settingsItems: [] });
        expect(byId('instructions-settings-button')).toBeFalsy();
    });

    it('renders no accounting line when accounting is omitted', () => {
        render({});
        expect(byId('instructions-accounting')).toBeFalsy();
    });

    it('still renders the toggle group at length 1, to hold the left anchor', () => {
        // V1's spirit: dropping the group for a bare title is what moves the
        // title's x-position away from every other viewer.
        render({ views: [VIEWS[0]] });
        expect(byId('instructions-view-toggle')).toBeTruthy();
        expect(byId('view-toggle-cards')).toBeTruthy();
    });
});

describe('ViewerHeader — disabled views', () => {
    it('renders a disabled entry as a real disabled button', () => {
        render({
            views: [VIEWS[0], { ...VIEWS[1], disabled: true, disabledReason: 'Not built yet' }],
            view: 'cards',
        });
        const table = byId('view-toggle-table');
        expect(table).toBeTruthy();
        expect(table.hasAttribute('disabled')).toBe(true);
        // Wrapped in a span so MUI can fire a Tooltip over it — the documented fix,
        // and safe because v7's ToggleButtonGroup uses context rather than
        // cloneElement, so an intervening element cannot break grouping.
        expect(table.parentElement.tagName).toBe('SPAN');
    });

    it('keeps grouping intact through the span wrapper', () => {
        // The regression the span could plausibly cause: the enabled sibling losing
        // its selected state because the group could not reach it.
        render({
            views: [VIEWS[0], { ...VIEWS[1], disabled: true }],
            view: 'cards',
        });
        expect(byId('view-toggle-cards').getAttribute('aria-pressed')).toBe('true');
    });
});
