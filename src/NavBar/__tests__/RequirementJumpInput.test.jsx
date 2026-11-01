// @vitest-environment jsdom
//
// Req #4185 — the jump opens the requirement in a new tab marked `?from=jump`,
// which is how that standalone tab knows its exit is "Close", not a Back.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import RequirementJumpInput from '../RequirementJumpInput';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('RequirementJumpInput', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('opens /swarm/requirement/<id>?from=jump in a new tab', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        act(() => { root.render(<RequirementJumpInput />); });
        const input = container.querySelector('input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        await act(async () => {
            setter.call(input, '4185');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => {
            container.querySelector('[data-testid="req-jump-submit"]').click();
        });
        expect(open).toHaveBeenCalledWith(
            '/swarm/requirement/4185?from=jump', '_blank', 'noopener,noreferrer');
        act(() => root.unmount());
        open.mockRestore();
    });
});
