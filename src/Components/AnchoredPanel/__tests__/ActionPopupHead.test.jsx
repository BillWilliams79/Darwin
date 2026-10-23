// @vitest-environment jsdom
//
// Req #3821 — every Action Popup draws ONE head row, so ▾ · badge · title line
// up when the popups stack in the navbar's rack. A popup with no count keeps
// its badge slot, blank, one badge circle wide; the row is one height whatever
// it holds. (jsdom has no layout: this pins the structure and the styles that
// make the columns agree.)

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import ActionPopupHead, { ActionPopupBadge, ActionPopupClose } from '../ActionPopupHead';
import AnchoredPanel from '../AnchoredPanel';
import { ACTION_POPUP_BADGE_EM, ACTION_POPUP_COLORS, ACTION_POPUP_HEAD_EM } from '../actionPopupChrome';

const LIMITS = { minW: 160, minH: 64, autoMaxW: 420, headPx: 31 };
const DOCK = { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null };
const noop = () => {};

const order = (testid) => [...screen.getByTestId(`${testid}-header`).children]
    .map(c => c.getAttribute('data-testid'));

describe('ActionPopupHead (req #3821)', () => {
    afterEach(cleanup);

    it('reserves the badge slot when the popup has no badge, so the title starts in the same column', () => {
        render(<>
            <ActionPopupHead open onToggle={noop} name="Dev Servers" testid="a"
                             badge={<ActionPopupBadge testid="a-count">3</ActionPopupBadge>} />
            <ActionPopupHead open onToggle={noop} name="Dev Server" testid="b" />
        </>);
        expect(order('a')).toEqual(['a-toggle', 'a-badge', 'a-title']);
        expect(order('b')).toEqual(['b-toggle', 'b-badge', 'b-title']);
        expect(screen.getByTestId('b-badge').childNodes.length).toBe(0);
        for (const id of ['a', 'b']) {
            const slot = getComputedStyle(screen.getByTestId(`${id}-badge`));
            expect(slot.minWidth).toBe(ACTION_POPUP_BADGE_EM);
            expect(slot.flexShrink).toBe('0');
        }
        // A one-digit badge is exactly the slot's circle.
        const badge = getComputedStyle(screen.getByTestId('a-count'));
        expect(badge.minWidth).toBe(ACTION_POPUP_BADGE_EM);
        expect(badge.height).toBe(ACTION_POPUP_BADGE_EM);
    });

    it('the row is one height and one padding, whatever it holds', () => {
        render(<>
            <ActionPopupHead open onToggle={noop} name="Filer" testid="a"
                             actions={<ActionPopupClose onClick={noop} label="Close" testid="a-x" />} />
            <ActionPopupHead open={false} onToggle={noop} name="Active" testid="b"
                             badge={<ActionPopupBadge>12</ActionPopupBadge>} />
        </>);
        const [a, b] = ['a', 'b'].map(id => getComputedStyle(screen.getByTestId(`${id}-header`)));
        for (const s of [a, b]) {
            expect(s.minHeight).toBe(`${ACTION_POPUP_HEAD_EM}em`);
            expect(s.paddingLeft).toBe('0.7em');
            expect(s.columnGap || s.gap).toBe('0.6em');
        }
        // The title is the head's small caps in every popup.
        for (const id of ['a', 'b']) {
            const t = getComputedStyle(screen.getByTestId(`${id}-title`));
            expect(t.textTransform).toBe('uppercase');
            expect(t.fontSize).toBe('0.9em');
            expect(t.color).not.toBe('');
        }
    });

    it('the icon-only navbar keeps the ▾ and the badge slot alone', () => {
        render(<ActionPopupHead open onToggle={noop} name="Filer" testid="a" narrow
                                actions={<ActionPopupClose onClick={noop} label="Close" testid="a-x" />} />);
        expect(order('a')).toEqual(['a-toggle', 'a-badge']);
    });

    it('an AnchoredPanel with no extras still draws the blank slot', () => {
        render(<AnchoredPanel dock={DOCK} onDockChange={noop} open onToggle={noop}
                              name="Dev Server" testid="ds" limits={LIMITS} colors={ACTION_POPUP_COLORS}>
            {() => <div>rows</div>}
        </AnchoredPanel>);
        expect(order('ds')).toEqual(['ds-toggle', 'ds-badge', 'ds-title']);
        expect(screen.getByTestId('ds-title').textContent).toBe('Dev Server');
    });
});
