// @vitest-environment jsdom
//
// Req #3265 — the delete guard on a swarm_start row is CLIENT-SIDE ONLY
// (swarm_start_sessions.swarm_start_fk is ON DELETE CASCADE, not RESTRICT;
// the browser's delete goes through the generic REST endpoint, never the
// delete_swarm_start MCP tool's guard). The disabled Delete button is the
// only thing standing between a linked row and a silent orphan of real
// session history, so this file asserts that guard directly rather than
// leaving it implicit in the parent pages' wiring.
//
// Mounted harness with raw react-dom + act — the house pattern (see
// InstructionDeleteDialog.test.jsx). The dialog is a pure presentational
// component: no contexts, no query client, no mocked modules.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import SwarmStartDeleteDialog from '../SwarmStartDeleteDialog';

const SWARM_START = { id: 42, arguments: '3251' };

let container;
let root;
let handlers;

beforeEach(() => {
    handlers = {
        setDeleteDialogOpen: vi.fn(),
        setDeleteId: vi.fn(),
        setDeleteConfirmed: vi.fn(),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
});

const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const render = (props = {}) => act(() => {
    root.render(
        <SwarmStartDeleteDialog
            deleteDialogOpen
            swarmStart={SWARM_START}
            linkedSessionIds={[]}
            {...handlers}
            {...props}
        />
    );
});

const click = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});

describe('zero-session row', () => {
    it('enables Delete and shows the plain confirmation copy', () => {
        render({ linkedSessionIds: [] });

        const btn = byTestId('btn-confirm-delete-swarm-start');
        expect(btn.disabled).toBe(false);
        expect(text(byTestId('swarm-start-delete-dialog'))).toContain(
            'Do you want to permanently delete this swarm-start invocation record?');
    });

    it('confirming fires setDeleteConfirmed and closes the dialog', () => {
        render({ linkedSessionIds: [] });
        click(byTestId('btn-confirm-delete-swarm-start'));

        expect(handlers.setDeleteConfirmed).toHaveBeenCalledWith(true);
        expect(handlers.setDeleteDialogOpen).toHaveBeenCalledWith(false);
    });
});

describe('linked row — the guard req #3265 exists to enforce', () => {
    it('disables Delete and names every linked session id', () => {
        render({ linkedSessionIds: [101, 102] });

        const btn = byTestId('btn-confirm-delete-swarm-start');
        expect(btn.disabled).toBe(true);
        const body = text(byTestId('swarm-start-delete-dialog'));
        expect(body).toContain('101');
        expect(body).toContain('102');
        expect(body).toContain('sessions');
    });

    it('singularises the copy at exactly one linked session', () => {
        render({ linkedSessionIds: [307] });

        const body = text(byTestId('swarm-start-delete-dialog'));
        expect(body).toContain('session 307');
        expect(body).not.toContain('sessions 307');
    });

    it('clicking a disabled Delete button never fires setDeleteConfirmed', () => {
        render({ linkedSessionIds: [101] });
        click(byTestId('btn-confirm-delete-swarm-start'));

        expect(handlers.setDeleteConfirmed).not.toHaveBeenCalled();
    });
});

describe('linkedLoading — fail CLOSED while the guard data is still in flight', () => {
    it('disables Delete even with an empty linkedSessionIds list', () => {
        // The exact race the code review (finding C2) flagged: both call sites
        // derive linkedSessionIds from queries that are not the one gating the
        // page's render, so an empty list during load must not read as "safe".
        render({ linkedSessionIds: [], linkedLoading: true });

        expect(byTestId('btn-confirm-delete-swarm-start').disabled).toBe(true);
        expect(text(byTestId('swarm-start-delete-dialog'))).toContain(
            'Cannot confirm there are no linked sessions yet');
    });

    it('re-enables once loading finishes with no linked sessions found', () => {
        render({ linkedSessionIds: [], linkedLoading: true });
        expect(byTestId('btn-confirm-delete-swarm-start').disabled).toBe(true);

        render({ linkedSessionIds: [], linkedLoading: false });
        expect(byTestId('btn-confirm-delete-swarm-start').disabled).toBe(false);
    });
});

describe('cancel', () => {
    it('closes the dialog and clears the selected row without confirming', () => {
        render({ linkedSessionIds: [] });
        const cancelBtn = Array.from(document.querySelectorAll('button'))
            .find(b => text(b) === 'Cancel');
        click(cancelBtn);

        expect(handlers.setDeleteDialogOpen).toHaveBeenCalledWith(false);
        expect(handlers.setDeleteId).toHaveBeenCalledWith({});
        expect(handlers.setDeleteConfirmed).not.toHaveBeenCalled();
    });
});
