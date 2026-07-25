// @vitest-environment jsdom
//
// Req #3056 — the Autonomy (coordination_type) icon must render for every
// requirement_status, with no exceptions — including authoring/approved and
// the terminal/historical statuses met/wontfix/deferred, all of which were
// previously hidden. It's editable for authoring/approved/swarm_ready
// (matching RequirementDetail's coordination_type editor, req #3054) and
// locked everywhere else.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

import RequirementRow from '../RequirementRow';
import { RequirementActionsContext } from '../../hooks/useRequirementActions';

const noop = () => {};

let roots = [];
function mount(requirement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
        root.render(
            <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
                <RequirementActionsContext.Provider value={{
                    statusClick: noop, coordinationClick: noop,
                    titleChange: noop, titleKeyDown: noop, titleOnBlur: noop,
                    deleteClick: noop, sessionStatusMap: {}, sortMode: 'created',
                    setCrossCardInsertIndex: noop, requirementsArray: [requirement],
                    setRequirementsArray: noop,
                }}>
                    <RequirementRow requirement={requirement} requirementIndex={0} />
                </RequirementActionsContext.Provider>
            </DndProvider>
        );
    });
    return container;
}

afterEach(() => {
    act(() => { roots.forEach((r) => r.unmount()); });
    roots = [];
    document.body.innerHTML = '';
});

const reqWithStatus = (status) => ({
    id: 42, title: 'Test requirement', requirement_status: status,
    coordination_type: 'implemented', category_fk: 5, sort_order: 0,
});

const ALL_STATUSES = ['authoring', 'approved', 'swarm_ready', 'development', 'met', 'wontfix', 'deferred'];

describe('RequirementRow autonomy icon visibility (req #3056)', () => {
    it.each(ALL_STATUSES)(
        'shows the autonomy icon for status=%s',
        (status) => {
            const container = mount(reqWithStatus(status));
            expect(container.querySelector('[data-testid="coordination-toggle-42"]')).not.toBeNull();
        }
    );

    const EDITABLE_STATUSES = ['authoring', 'approved', 'swarm_ready'];

    it('is editable for authoring/approved/swarm_ready and locked elsewhere', () => {
        for (const status of ALL_STATUSES) {
            const container = mount(reqWithStatus(status));
            const button = container.querySelector('[data-testid="coordination-toggle-42"]');
            expect(button.disabled).toBe(!EDITABLE_STATUSES.includes(status));
        }
    });
});
