// @vitest-environment jsdom
// req #3793 review — a switch that MOVES when clicked (the Plan's: header row →
// canvas corner and back) unmounts under the keyboard's focus. The switch that
// mounts in the click's render takes the focus; no later mount does.
import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import FullscreenSwitch from '../FullscreenSwitch';

function Moving() {
    const [on, setOn] = useState(false);
    const toggle = () => setOn((v) => !v);
    return (
        <div>
            <div data-testid="header">
                {!on && <FullscreenSwitch on={false} onToggle={toggle} testid="sw" />}
            </div>
            <div data-testid="canvas">
                {on && <FullscreenSwitch on variant="floating" onToggle={toggle} testid="sw" />}
            </div>
        </div>
    );
}

function Late() {
    const [extra, setExtra] = useState(false);
    return (
        <div>
            <FullscreenSwitch on={false} onToggle={() => {}} testid="first" />
            <button type="button" data-testid="add" onClick={() => setExtra(true)}>add</button>
            {extra && <FullscreenSwitch on={false} onToggle={() => {}} testid="late" />}
        </div>
    );
}

describe('FullscreenSwitch focus (req #3793)', () => {
    afterEach(cleanup);

    it('focus follows a switch that moves when clicked, both ways', () => {
        const { getByTestId } = render(<Moving />);
        getByTestId('sw').focus();
        act(() => { getByTestId('sw').click(); });
        expect(getByTestId('canvas').contains(document.activeElement)).toBe(true);
        expect(document.activeElement).toBe(getByTestId('sw'));
        act(() => { getByTestId('sw').click(); });
        expect(getByTestId('header').contains(document.activeElement)).toBe(true);
    });

    it('a click without focus (a mouse on an unfocused switch) moves nothing', () => {
        const { getByTestId } = render(<Moving />);
        document.body.focus();
        act(() => { getByTestId('sw').click(); });
        expect(document.activeElement).toBe(document.body);
    });

    it('a switch mounted later, by something else, takes no focus', async () => {
        const { getByTestId } = render(<Late />);
        getByTestId('first').focus();
        act(() => { getByTestId('first').click(); });
        await new Promise((r) => setTimeout(r, 5));
        getByTestId('add').focus();
        act(() => { getByTestId('add').click(); });
        expect(document.activeElement).toBe(getByTestId('add'));
    });
});
