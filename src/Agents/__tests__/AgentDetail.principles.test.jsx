// @vitest-environment jsdom
//
// Req #3129 — the guiding-principles slot on /agents/:id.
//
// The slot is a VIEW of one `agent_documents` link that also appears in the
// Documents table below it. That double-surfacing is the whole risk, and the
// three ways it goes wrong are each pinned here:
//
//   * the slot renders a document that is merely `owned` or `autoload` — the
//     role filter is missing or matches a substring rather than a SET member;
//   * the principles document VANISHES from the Documents table because someone
//     "fixed" the duplication by filtering it out, so the inventory silently
//     stops being an inventory;
//   * the empty state renders as a crash or a blank region rather than as the
//     actionable "no principles document assigned" prompt — the common case
//     right after the migration, when no agent is tagged yet.
//
// Mounted harness with raw react-dom + act, the house pattern — same shape as
// AgentDetail.unbind.test.jsx.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({
    useNavigate: () => navigateSpy,
    useParams: () => ({ id: '1' }),
}));

let agentsData = [];
let documentsData = [];
let agentDocsData = [];

vi.mock('../../hooks/useDataQueries', () => ({
    useAgents: () => ({ data: agentsData, isLoading: false }),
    useInstructions: () => ({ data: [] }),
    useArchitectureDocuments: () => ({ data: documentsData }),
    useAgentDocuments: () => ({ data: agentDocsData }),
    useAgentInstructions: () => ({ data: [] }),
    agentKeys: { all: (c) => ['agents', c] },
    instructionKeys: { all: (c) => ['instructions', c] },
    agentInstructionKeys: { all: (c) => ['agent_instructions', c] },
}));

vi.mock('../actions/instructionsApi', () => ({
    linkAgentInstruction: vi.fn(),
    unlinkAgentInstruction: vi.fn(),
    setAgentInstructionOrder: vi.fn(),
}));

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn() }));

import AgentDetail from '../AgentDetail';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';

const AGENT = {
    id: 1, name: 'Alpha', closed: 0, ai_model: 'opus', effort: 'high',
    overview: 'the alpha agent', location: 'alpha.md', file_name: 'alpha.md',
};

// Three documents on ONE agent. The decoys matter: `owned,autoload` carries both
// of the roles a principles link also carries, so a filter that tests for either
// of them instead of for `principles` picks the wrong row and still renders
// something plausible.
const DOCUMENTS = [
    { id: 20, name: 'Alpha Charter', location: 'memory/alpha-charter.md',
      doc_type: 'markdown', closed: 0 },
    { id: 21, name: 'Alpha Reference', location: 'memory/alpha-ref.md',
      doc_type: 'markdown', closed: 0 },
    { id: 22, name: 'Alpha Autoloaded', location: 'memory/alpha-auto.md',
      doc_type: 'markdown', closed: 0 },
];
const LINKS_WITH_PRINCIPLES = [
    { agent_fk: 1, document_fk: 20, relationship: 'principles,owned,autoload', sort_order: 1 },
    { agent_fk: 1, document_fk: 21, relationship: 'referenced', sort_order: 2 },
    { agent_fk: 1, document_fk: 22, relationship: 'owned,autoload', sort_order: 3 },
];
const LINKS_WITHOUT_PRINCIPLES = [
    { agent_fk: 1, document_fk: 22, relationship: 'owned,autoload', sort_order: 1 },
];

let container;
let root;
let queryClient;

const mount = () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                    <AuthContext.Provider
                        value={{ idToken: 'tok', profile: { userName: 'tester' } }}>
                        <AgentDetail />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
};

beforeEach(() => {
    agentsData = [{ ...AGENT }];
    documentsData = DOCUMENTS.map(d => ({ ...d }));
    agentDocsData = LINKS_WITH_PRINCIPLES.map(l => ({ ...l }));
    navigateSpy.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('AgentDetail — guiding principles slot (req #3129)', () => {
    it('renders THE principles document, not merely an owned or autoloaded one', () => {
        mount();
        const slot = container.querySelector('[data-testid="agent-principles-20"]');
        expect(slot).toBeTruthy();
        expect(slot.textContent).toContain('Alpha Charter');
        expect(slot.textContent).toContain('memory/alpha-charter.md');
        // The decoy carries owned+autoload but not principles.
        expect(slot.textContent).not.toContain('Alpha Autoloaded');
        expect(container.querySelector('[data-testid="agent-principles-22"]')).toBeNull();
    });

    it('renders the slot ABOVE the instructions section — load order is precedence', () => {
        mount();
        const principles = container.querySelector('#principles');
        const instructions = container.querySelector('#instructions');
        expect(principles).toBeTruthy();
        expect(instructions).toBeTruthy();
        // DOCUMENT_POSITION_FOLLOWING === 4: instructions comes after principles.
        expect(principles.compareDocumentPosition(instructions)
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('KEEPS the principles document in the Documents table — one link, two views', () => {
        mount();
        const row = container.querySelector('[data-testid="agent-document-20"]');
        expect(row).toBeTruthy();
        expect(row.textContent).toContain('Alpha Charter');
        // And it is flagged there too, so the two views cannot disagree.
        expect(row.textContent).toContain('principles');
        // All three links still listed; the slot is additive, not a filter.
        expect(container.querySelectorAll('[data-testid^="agent-document-"]').length).toBe(3);
    });

    it('prompts rather than blanking when no principles document is assigned', () => {
        agentDocsData = LINKS_WITHOUT_PRINCIPLES.map(l => ({ ...l }));
        mount();
        const empty = container.querySelector('[data-testid="agent-principles-empty"]');
        expect(empty).toBeTruthy();
        expect(empty.textContent).toContain('No guiding-principles document assigned');
        // The section still exists — an unassigned agent is a legitimate state,
        // not a reason to hide the slot and let the gap go unnoticed.
        expect(container.querySelector('#principles')).toBeTruthy();
    });
});
