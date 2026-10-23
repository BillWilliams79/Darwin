// @vitest-environment jsdom
//
// Req #3821 — every Action Popup draws ONE head row, so ▾ · badge · title line
// up when the popups stack in the navbar's rack. A popup with no count keeps
// its badge slot, blank, one badge circle wide; the row is one height whatever
// it holds. (jsdom has no layout: this pins the structure and the styles that
// make the columns agree.)

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import ActionPopupHead, {
    ACTION_POPUP_CHEVRON_SCALE, ActionPopupAdd, ActionPopupBadge, ActionPopupClose,
} from '../ActionPopupHead';
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

    // Req #3830 — the Requirement Filer's head: no badge slot, a +, a bigger ▾.
    it('badgeSlot={false} puts the title against the ▾, on the panel too', () => {
        render(<AnchoredPanel dock={DOCK} onDockChange={noop} open={false} onToggle={noop}
                              name="Requirement" testid="rf" badgeSlot={false}
                              limits={LIMITS} colors={ACTION_POPUP_COLORS}
                              actions={<ActionPopupClose onClick={noop} label="Close" testid="rf-x" />}>
            {() => <div>rows</div>}
        </AnchoredPanel>);
        expect(order('rf')).toEqual(['rf-toggle', 'rf-title', null]);
        expect(screen.queryByTestId('rf-badge')).toBe(null);
    });

    it('draws the ▾ 50% bigger without growing the row, in every popup', () => {
        expect(ACTION_POPUP_CHEVRON_SCALE).toBe(1.5);
        render(<ActionPopupHead open onToggle={noop} name="Dev Servers" testid="a" />);
        const glyph = getComputedStyle(screen.getByTestId('a-toggle').firstChild);
        expect(glyph.fontSize).toBe('1.5em');
        expect(glyph.lineHeight).toBe('1');
    });

    it('the + is a button bigger than the × and no taller than the row', () => {
        const onClick = vi.fn();
        render(<ActionPopupHead open={false} onToggle={noop} name="Requirement" testid="a" badgeSlot={false}
                                actions={<>
                                    <ActionPopupAdd onClick={onClick} label="Create" testid="a-add" />
                                    <ActionPopupClose onClick={noop} label="Close" testid="a-x" />
                                </>} />);
        const add = screen.getByTestId('a-add');
        expect(add.tagName).toBe('BUTTON');
        expect(add.getAttribute('aria-label')).toBe('Create');
        // Its ems are the ROW's (a button's own default type is 13.33px), so
        // 1.6em is exactly the row's content height: 2.2em less 0.3em top and bottom.
        const box = getComputedStyle(add);
        expect(box.fontSize).toBe('inherit');
        expect(parseFloat(box.height)).toBe(ACTION_POPUP_HEAD_EM - 0.6);
        // Bigger than the ×: its box is 1.4em of 1.1em = 1.54em; the + mark,
        // 1.3em, against the ×'s 1.1em glyph.
        const x = getComputedStyle(screen.getByTestId('a-x'));
        expect(parseFloat(box.width)).toBeGreaterThan(parseFloat(x.width) * parseFloat(x.fontSize));
        expect(parseFloat(getComputedStyle(add.firstChild).width)).toBeGreaterThan(parseFloat(x.fontSize));
        fireEvent.click(add);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('pressing the + (its mark included) never moves or sends home the panel', () => {
        const onDockChange = vi.fn();
        render(<AnchoredPanel dock={DOCK} onDockChange={onDockChange} open={false} onToggle={noop}
                              name="Requirement" testid="rf" badgeSlot={false}
                              limits={LIMITS} colors={ACTION_POPUP_COLORS}
                              actions={<ActionPopupAdd onClick={noop} label="Create" testid="rf-add" />}>
            {() => <div>rows</div>}
        </AnchoredPanel>);
        const mark = screen.getByTestId('rf-add').querySelector('path');
        fireEvent.pointerDown(mark, { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
        fireEvent.pointerMove(mark, { pointerId: 1, clientX: 150, clientY: 150, buttons: 1 });
        fireEvent.pointerUp(mark, { pointerId: 1, clientX: 150, clientY: 150 });
        fireEvent.doubleClick(mark);
        expect(onDockChange).not.toHaveBeenCalled();
    });

    it('the icon-only navbar keeps the ▾ alone when there is no badge slot', () => {
        render(<ActionPopupHead open={false} onToggle={noop} name="Requirement" testid="a" narrow badgeSlot={false}
                                actions={<ActionPopupAdd onClick={noop} label="Create" testid="a-add" />} />);
        expect(order('a')).toEqual(['a-toggle']);
    });
});
