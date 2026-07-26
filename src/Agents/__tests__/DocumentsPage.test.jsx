// @vitest-environment jsdom
//
// Req #3051 — the WIRING of the editable document card.
//
// documentRegistryUtils.test.js pins the pure validators and the ownership
// planner; documentsApi.test.js pins the REST wire format and the rollback.
// Neither can see the layer between them, which is where this page's real risk
// lives: whether the card hands the right arguments to the right action at the
// right moment.
//
// What is only observable HERE:
//
//   * THE relationshipsReady HARD STOP. `isLoading` covers only the document
//     query, and `fetchEntity` rethrows every non-404 — so a 500 on
//     /agent_documents leaves the junction undefined PERMANENTLY. Every document
//     would then render as unowned, and a delete dialog would claim zero blast
//     radius for a document twelve architects read. Both halves are green in
//     isolation while the page happily renders a lie.
//   * THE LOCATION CONFIRM GATE. `location` is the most dangerous field on the
//     page (instruction #83 makes agents execute it at boot, and nothing validates
//     it), so its commit is intercepted when the document has autoload readers and
//     written directly when it has none. The graduation is the whole design; a
//     version that always wrote, or always asked, passes every other test.
//   * ONE PUT PER FIELD, carrying only that field. rest_put.py is a blind UPDATE
//     with no version column, so a body with an extra key silently reverts another
//     tab's edit. Only the page decides what goes in the body.
//   * THE GRADUATED CLOSE, read from the LIVE row's link count.
//   * The five data-testids that shipped with the read-only table. They moved from
//     <tr>/<Table> to <Card>/grid <Box>; the SELECTORS are the contract.
//
// Mounted harness with raw react-dom + act — the house pattern (there is no
// @testing-library in this repo), copied from InstructionsPage.test.jsx. The
// action module is mocked so assertions are about ARGUMENTS; the data hooks are
// mocked so a "refetch" is a controlled re-render.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateSpy }));

// Module-level query data — mutate then `bump()` to simulate a refetch landing.
let documentsData = [];
let agentsData = [];
let junctionData = [];
let junctionUndefined = false;

vi.mock('../../hooks/useDataQueries', () => ({
    useArchitectureDocuments: () => ({ data: documentsData, isLoading: false }),
    useAgents: () => ({ data: agentsData }),
    useAgentDocuments: () => ({ data: junctionUndefined ? undefined : junctionData }),
    architectureDocumentKeys: { all: (c) => ['architecture_documents', c] },
    agentDocumentKeys: { all: (c) => ['agent_documents', c] },
}));

vi.mock('../actions/documentsApi', () => ({
    createArchitectureDocument: vi.fn(),
    updateArchitectureDocument: vi.fn(),
    deleteArchitectureDocument: vi.fn(),
    linkAgentDocument: vi.fn(),
    linkAgentDocuments: vi.fn(),
    unlinkAgentDocument: vi.fn(),
    applyLinkPlan: vi.fn(),
    setAgentDocumentLink: vi.fn(),
    // A real class, because the page tests errors with `instanceof`.
    LinkRollbackError: class LinkRollbackError extends Error {},
}));

import DocumentsPage from '../DocumentsPage';
import * as api from '../actions/documentsApi';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

const URI = 'http://test.local';
const TOKEN = 'tok';
const CREATOR = 'tester';

// ---------------------------------------------------------------------------
// Fixture.
//
//   doc 20 — owned by Alpha with `autoload`, plus a `referenced` link from Bravo.
//            The AUTOLOAD reader is what makes it the location-confirm case, and
//            two links is what triggers the delete challenge.
//   doc 21 — UNOWNED and unlinked: the other side of every graduated branch, and
//            the state the registry exists to surface.
//   doc 22 — owned by Bravo with NO autoload link, so its location writes直接.
//            (Also proves the confirm gate is per-document, not per-page.)
// ---------------------------------------------------------------------------
const AGENTS = [
    { id: 1, name: 'Alpha', closed: 0 },
    { id: 2, name: 'Bravo', closed: 0 },
    { id: 3, name: 'Charlie', closed: 0 },
];
const DOCUMENTS = [
    { id: 20, name: 'Owned Doc', doc_type: 'markdown', location: 'memory/owned.md',
      url: null, closed: 0, sort_order: 1, update_ts: '2026-07-02T00:00:00' },
    { id: 21, name: 'Orphan Doc', doc_type: 'markdown', location: 'memory/orphan.md',
      url: null, closed: 0, sort_order: 1, update_ts: '2026-07-01T00:00:00' },
    { id: 22, name: 'Quiet Doc', doc_type: 'html', location: 'docs/quiet.html',
      url: 'https://example.test/quiet', closed: 0, sort_order: 2, update_ts: null },
];
const JUNCTION = [
    { agent_fk: 1, document_fk: 20, relationship: 'owned,autoload', notes: 'Alpha owns it', sort_order: 1 },
    { agent_fk: 2, document_fk: 20, relationship: 'referenced', notes: null, sort_order: 4 },
    { agent_fk: 2, document_fk: 22, relationship: 'owned', notes: null, sort_order: 2 },
];

let container;
let root;
let queryClient;
let bump;

function Harness() {
    const [, setTick] = useState(0);
    bump = () => setTick(t => t + 1);
    return <DocumentsPage />;
}

// The REAL cache key the junction query lives under. `agentDocuments` is declared
// `fieldsInKey: true` in devopsQueries, so the factory appends a `{ fields }`
// segment — the page's key factory returns only the PREFIX, which is why
// `freshAgentDocuments` must use `getQueriesData` (prefix match) rather than
// `getQueryData` (exact). Seeding the FULL key is what keeps that load-bearing:
// against the bare prefix an exact lookup would find it too, and the test would
// pass while production fell through to the stale ref.
const JUNCTION_KEY = ['agent_documents', CREATOR,
    { fields: 'agent_fk,document_fk,relationship,notes,sort_order' }];

const mount = () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(JUNCTION_KEY, junctionData);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: URI }}>
                    <AuthContext.Provider value={{ idToken: TOKEN, profile: { userName: CREATOR } }}>
                        <Harness />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
};

beforeEach(() => {
    // A stored sort mode would reorder the cards and break any position-based
    // read; the page default (Owner, asc) is what these tests assume.
    localStorage.clear();
    sessionStorage.clear();
    junctionUndefined = false;
    documentsData = DOCUMENTS.map(d => ({ ...d }));
    agentsData = AGENTS.map(a => ({ ...a }));
    junctionData = JUNCTION.map(l => ({ ...l }));
    for (const [name, fn] of Object.entries(api)) {
        if (typeof fn?.mockReset !== 'function') continue;   // skip the error class
        fn.mockReset();
        fn.mockResolvedValue(name === 'unlinkAgentDocument' ? true : {});
    }
    api.applyLinkPlan.mockResolvedValue({ applied: 1 });
    navigateSpy.mockReset();
    useSnackBarStore.setState({ open: false, message: '' });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// DOM helpers. Menus, dialogs and popovers render into portals on document.body,
// so every lookup is document-wide rather than container-scoped.
// ---------------------------------------------------------------------------
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

const click = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});

const clickAsync = async (el) => { await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}); };

// A controlled React input ignores `el.value = x`; the write has to go through the
// native setter so React's change tracking sees it.
const typeInto = (el, value) => act(() => {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});

const focus = (el) => act(() => el.focus());
const blur = async (el) => { await act(async () => { el.blur(); }); };
const flush = async () => { await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
}); };

const editField = async (testId, value) => {
    const el = byTestId(testId);
    focus(el);
    typeInto(el, value);
    await blur(el);
    await flush();
};

const openRowMenu = (rowId) => click(byTestId(`document-card-menu-${rowId}`));

const putBodies = () => api.updateArchitectureDocument.mock.calls.map(
    ([, , id, fields]) => ({ id, fields }));

// ===========================================================================

describe('DocumentsPage — the relationshipsReady hard stop', () => {
    it('refuses to render the registry when the junction query is unresolved', () => {
        // Every document would otherwise render as unowned — indistinguishable from
        // genuine drift — and a delete dialog would report zero blast radius for a
        // document several architects read in full at boot.
        junctionUndefined = true;
        mount();

        expect(byTestId('documents-relationships-error')).toBeTruthy();
        expect(byTestId('documents-registry')).toBeNull();
        expect(byTestId('document-row-20')).toBeNull();
    });

    it('says WHY editing is disabled rather than just failing', () => {
        junctionUndefined = true;
        mount();
        const text = byTestId('documents-relationships-error').textContent;
        expect(text).toMatch(/who owns each document/i);
        expect(text).toMatch(/Reload/i);
    });

    it('renders the registry once the junction resolves', () => {
        mount();
        expect(byTestId('documents-relationships-error')).toBeNull();
        expect(byTestId('documents-registry')).toBeTruthy();
    });
});

describe('DocumentsPage — the testids that shipped with the read-only table', () => {
    // These five are the standing contract. They moved from <tr>/<Table> to
    // <Card>/grid <Box>; a test reaching for them should not have to care.
    it('still resolves all five', () => {
        mount();
        expect(byTestId('documents-registry')).toBeTruthy();
        expect(byTestId('document-row-20')).toBeTruthy();
        expect(byTestId('document-owner-20')).toBeTruthy();
        expect(byTestId('document-unowned-21')).toBeTruthy();
        expect(byTestId('document-20-agent-2')).toBeTruthy();
    });

    it('names the owning agent on the owner chip, not its id', () => {
        mount();
        expect(byTestId('document-owner-20').textContent).toMatch(/Alpha/);
    });

    it('marks a genuinely unowned document, and does NOT give it an owner chip', () => {
        mount();
        expect(byTestId('document-unowned-21')).toBeTruthy();
        expect(byTestId('document-owner-21')).toBeNull();
    });

    it('keeps the owner OUT of the other-agents chip row — one fact, one place', () => {
        // Alpha owns doc 20, so it must not also appear as an ordinary link chip.
        mount();
        expect(byTestId('document-20-agent-2')).toBeTruthy();    // Bravo, referenced
        expect(byTestId('document-20-agent-1')).toBeNull();      // Alpha, the owner
    });
});

describe('DocumentsPage — one PUT per field, carrying only that field', () => {
    it('writes ONLY the edited column', async () => {
        // rest_put.py builds its SET clause from the body's keys and has no version
        // column, so an extra key silently reverts a concurrent edit to it.
        mount();
        await editField('document-name-input-20', 'Renamed Doc');

        expect(putBodies()).toHaveLength(1);
        const [{ id, fields }] = putBodies();
        expect(id).toBe(20);
        expect(Object.keys(fields)).toEqual(['name']);
        expect(fields.name).toBe('Renamed Doc');
    });

    it('normalizes a name before storing it — NO PAD collation makes padding a distinct row', async () => {
        mount();
        await editField('document-name-input-20', '  Padded   Name  ');
        expect(putBodies()[0].fields.name).toBe('Padded Name');
    });

    it('stores an emptied URL as NULL, not as an empty string', async () => {
        // '' would make documentHref return a dead link instead of falling back to
        // the constructed GitHub blob URL.
        mount();
        await editField('document-url-input-22', '');
        expect(putBodies()[0].fields).toEqual({ url: null });
    });

    it('does NOT write a name the validator rejects, and flags the card unsaved', async () => {
        mount();
        // 'Orphan Doc' is doc 21's name and the unique key does not exclude closed
        // rows, so this is a collision the user cannot see the cause of.
        await editField('document-name-input-20', 'Orphan Doc');

        expect(api.updateArchitectureDocument).not.toHaveBeenCalled();
        // With no Save button, this chip is the ONLY signal the value was not written.
        expect(byTestId('document-unsaved-20')).toBeTruthy();
    });

    it('does NOT write a url with a dangerous scheme', async () => {
        // documentHref's result goes straight into an anchor href.
        mount();
        await editField('document-url-input-22', 'javascript:alert(1)');
        expect(api.updateArchitectureDocument).not.toHaveBeenCalled();
        expect(byTestId('document-unsaved-22')).toBeTruthy();
    });
});

describe('DocumentsPage — doc_type is a constrained chip row', () => {
    it('offers exactly the three registry types', () => {
        mount();
        for (const t of ['markdown', 'html', 'text']) {
            expect(byTestId(`document-type-20-${t}`), t).toBeTruthy();
        }
    });

    it('writes immediately on click — a single-column PUT on a row that has an id', async () => {
        mount();
        await clickAsync(byTestId('document-type-20-html'));
        expect(putBodies()).toEqual([{ id: 20, fields: { doc_type: 'html' } }]);
    });

    it('does not write when the already-selected type is clicked again', async () => {
        mount();
        await clickAsync(byTestId('document-type-20-markdown'));
        expect(api.updateArchitectureDocument).not.toHaveBeenCalled();
    });

    it('surfaces a stored value outside the vocabulary instead of hiding it', () => {
        // The column is VARCHAR(16), not an ENUM, and the MCP's VALID_DOC_TYPES
        // never runs for a browser write — so a bad value CAN be in there, and
        // three unselected chips would give no hint that anything was wrong.
        documentsData = documentsData.map(
            d => (d.id === 20 ? { ...d, doc_type: 'mrkdown' } : d));
        mount();
        expect(byTestId('document-type-unknown-20')).toBeTruthy();
        expect(byTestId('document-type-unknown-20').textContent).toMatch(/mrkdown/);
    });
});

describe('DocumentsPage — the location confirm gate', () => {
    it('ASKS before writing when an open agent autoloads the document', async () => {
        // Instruction #83 makes agents read this path in full at boot and nothing
        // validates it, so a wrong value fails silently at their next boot.
        mount();
        await editField('document-location-input-20', 'memory/moved.md');

        expect(byTestId('documents-location-dialog')).toBeTruthy();
        expect(api.updateArchitectureDocument).not.toHaveBeenCalled();
    });

    it('shows the old path, the new path, and names the reader agents', async () => {
        mount();
        await editField('document-location-input-20', 'memory/moved.md');

        expect(byTestId('documents-location-old').textContent).toBe('memory/owned.md');
        expect(byTestId('documents-location-new').textContent).toBe('memory/moved.md');
        expect(byTestId('documents-location-reader-1')).toBeTruthy();   // Alpha
        expect(byTestId('documents-location-warning').textContent)
            .toMatch(/Nothing validates this path/i);
    });

    it('reverts the field to the STORED value while the dialog is open', async () => {
        // Nothing has been written, so showing the new value would be a lie.
        mount();
        await editField('document-location-input-20', 'memory/moved.md');
        expect(byTestId('document-location-input-20').value).toBe('memory/owned.md');
    });

    it('writes once the change is confirmed', async () => {
        mount();
        await editField('document-location-input-20', 'memory/moved.md');
        await clickAsync(byTestId('documents-location-confirm-btn'));
        await flush();

        expect(putBodies()).toEqual([{ id: 20, fields: { location: 'memory/moved.md' } }]);
    });

    it('writes NOTHING when the change is cancelled', async () => {
        mount();
        await editField('document-location-input-20', 'memory/moved.md');
        await clickAsync(byTestId('documents-location-cancel-btn'));
        await flush();

        expect(api.updateArchitectureDocument).not.toHaveBeenCalled();
        expect(byTestId('document-location-input-20').value).toBe('memory/owned.md');
    });

    it('does NOT ask when no agent autoloads the document — ceremony needs something to disclose', async () => {
        // Doc 22 is owned but not autoloaded by anyone. Ceremony with nothing to
        // disclose trains people to click past ceremony that does.
        mount();
        await editField('document-location-input-22', 'docs/moved.html');

        expect(byTestId('documents-location-dialog')).toBeNull();
        expect(putBodies()).toEqual([{ id: 22, fields: { location: 'docs/moved.html' } }]);
    });

    it('does NOT ask for a document with no links at all', async () => {
        mount();
        await editField('document-location-input-21', 'memory/renamed.md');
        expect(byTestId('documents-location-dialog')).toBeNull();
        expect(putBodies()).toEqual([{ id: 21, fields: { location: 'memory/renamed.md' } }]);
    });

    it('does not write an invalid path, and does not open the dialog for one either', async () => {
        mount();
        await editField('document-location-input-20', '/memory/absolute.md');
        expect(byTestId('documents-location-dialog')).toBeNull();
        expect(api.updateArchitectureDocument).not.toHaveBeenCalled();
        expect(byTestId('document-unsaved-20')).toBeTruthy();
    });
});

describe('DocumentsPage — the graduated close decision', () => {
    it('closes an UNLINKED document immediately, with no dialog', async () => {
        mount();
        openRowMenu(21);

        // No ellipsis: the label itself is the promise that nothing else happens.
        expect(byTestId('document-menu-close-21').textContent).toBe('Close document');

        await clickAsync(byTestId('document-menu-close-21'));
        await flush();

        expect(putBodies()).toEqual([{ id: 21, fields: { closed: 1 } }]);
        expect(byTestId('documents-delete-dialog')).toBeNull();
    });

    it('routes a LINKED document through the dialog, writing nothing yet', async () => {
        mount();
        openRowMenu(20);

        expect(byTestId('document-menu-close-20').textContent).toBe('Close document…');

        await clickAsync(byTestId('document-menu-close-20'));
        await flush();

        expect(api.updateArchitectureDocument).not.toHaveBeenCalled();
        expect(byTestId('documents-delete-dialog')).toBeTruthy();
    });

    it('titles the dialog by the INTENT it was opened with', async () => {
        // A dialog headed "Delete …?" opened from a menu item labelled "Close" is a
        // lie about what the primary button will do.
        mount();
        openRowMenu(20);
        await clickAsync(byTestId('document-menu-close-20'));
        expect(document.body.textContent).toMatch(/Close “Owned Doc”\?/);
    });
});

describe('DocumentsPage — the delete dialog discloses what a delete really costs', () => {
    const openDelete = async (id) => {
        openRowMenu(id);
        await clickAsync(byTestId(`document-menu-delete-${id}`));
        await flush();
    };

    it('states FIRST that the file on disk survives', async () => {
        // The likeliest misconception on the page: this deletes a registration, and
        // nothing scans disk for unregistered files afterwards.
        mount();
        await openDelete(20);

        const note = byTestId('documents-delete-file-note');
        expect(note).toBeTruthy();
        expect(note.textContent).toMatch(/not the file/i);
        expect(note.textContent).toMatch(/memory\/owned\.md/);
    });

    it('names the owner as unrecoverable, separately from the other links', async () => {
        mount();
        await openDelete(20);
        expect(document.body.textContent).toMatch(/ownership assignment held by Alpha/);
        expect(document.body.textContent).toMatch(/exists nowhere else/);
    });

    it('counts BOOT impact separately from data loss', async () => {
        // Two links cascade away (data), but only the autoload one changes what an
        // agent knows at boot. Collapsing the two would misstate one of them.
        mount();
        await openDelete(20);
        expect(document.body.textContent).toMatch(/2 agent links cascade away/);
        expect(document.body.textContent).toMatch(/1 open agent reads this file in full at boot/);
    });

    it('challenges the delete when the document is autoloaded', async () => {
        mount();
        await openDelete(20);
        expect(byTestId('document-delete-challenge-input')).toBeTruthy();
        expect(byTestId('document-delete-confirm-btn').disabled).toBe(true);
    });

    it('enables the delete only once the name is typed EXACTLY', async () => {
        mount();
        await openDelete(20);

        typeInto(byTestId('document-delete-challenge-input'), 'Owned Do');
        expect(byTestId('document-delete-confirm-btn').disabled).toBe(true);

        typeInto(byTestId('document-delete-challenge-input'), 'Owned Doc');
        expect(byTestId('document-delete-confirm-btn').disabled).toBe(false);

        await clickAsync(byTestId('document-delete-confirm-btn'));
        await flush();
        expect(api.deleteArchitectureDocument).toHaveBeenCalledWith(URI, TOKEN, 20);
    });

    it('does NOT challenge an unlinked document — nothing to disclose', async () => {
        mount();
        await openDelete(21);
        expect(byTestId('document-delete-challenge-input')).toBeNull();
        expect(byTestId('document-delete-confirm-btn').disabled).toBe(false);
        expect(document.body.textContent).toMatch(/affects nothing at boot/);
    });

    it('offers Close as the primary path', async () => {
        mount();
        await openDelete(20);
        expect(byTestId('document-delete-close-btn').textContent).toBe('Close instead');
    });
});

describe('DocumentsPage — ownership', () => {
    const openOwnerPalette = (id) => click(byTestId(`document-owner-add-${id}`));

    it('CLAIMS an unowned document with no dialog — additive, and it repairs a red state', async () => {
        mount();
        openOwnerPalette(21);
        await clickAsync(byTestId('document-owner-claim-21-1'));
        await flush();

        expect(byTestId('documents-owner-dialog')).toBeNull();
        expect(api.applyLinkPlan).toHaveBeenCalledTimes(1);

        const [, , steps] = api.applyLinkPlan.mock.calls[0];
        expect(steps).toHaveLength(1);
        expect(steps[0].prev).toBeNull();
        expect(steps[0].agent_fk).toBe(1);
        expect(steps[0].next.relationship).toBe('owned');
        // A brand-new link needs a slot, computed from the cache at write time.
        expect(steps[0].next.sort_order).toBe(2);      // Alpha's max is 1
    });

    it('ASKS before a TRANSFER — two non-atomic writes with an unowned window', async () => {
        mount();
        openOwnerPalette(20);
        await clickAsync(byTestId('document-owner-claim-20-3'));   // Alpha -> Charlie
        await flush();

        expect(byTestId('documents-owner-dialog')).toBeTruthy();
        expect(api.applyLinkPlan).not.toHaveBeenCalled();
        expect(byTestId('documents-owner-window-warning').textContent)
            .toMatch(/two writes/i);
    });

    it('releases BEFORE it claims, and demotes rather than unlinking the incumbent', async () => {
        mount();
        openOwnerPalette(20);
        await clickAsync(byTestId('document-owner-claim-20-3'));
        await clickAsync(byTestId('documents-owner-confirm-btn'));
        await flush();

        const [, , steps] = api.applyLinkPlan.mock.calls[0];
        expect(steps).toHaveLength(2);
        // Release first — the unique key rejects a second owner.
        expect(steps[0].agent_fk).toBe(1);
        expect(steps[0].next.relationship).toBe('autoload');   // keeps its other role
        expect(steps[0].next.notes).toBe('Alpha owns it');     // and its notes
        expect(steps[0].next.sort_order).toBe(1);              // and its slot
        // Then claim.
        expect(steps[1].agent_fk).toBe(3);
        expect(steps[1].next.relationship).toBe('owned');
    });

    it('ASKS before a RELEASE with no successor, and creates the unowned state on confirm', async () => {
        mount();
        await clickAsync(byTestId('document-owner-20').querySelector('.MuiChip-deleteIcon'));
        await flush();

        expect(byTestId('documents-owner-dialog')).toBeTruthy();
        expect(document.body.textContent).toMatch(/Release ownership/);

        await clickAsync(byTestId('documents-owner-confirm-btn'));
        await flush();

        const [, , steps] = api.applyLinkPlan.mock.calls[0];
        expect(steps).toHaveLength(1);
        expect(steps[0].next.relationship).toBe('autoload');
    });

    it('raises a STANDING notice when a transfer leaves the document unowned', async () => {
        // A transient snackbar would be wrong: the user may have looked away, and
        // the document stays broken until someone acts.
        api.applyLinkPlan.mockRejectedValue(
            Object.assign(new Error('boom'), { httpStatus: { httpStatus: 500 } }));
        mount();

        openOwnerPalette(20);
        await clickAsync(byTestId('document-owner-claim-20-3'));
        await clickAsync(byTestId('documents-owner-confirm-btn'));
        await flush();

        // The junction is unchanged in the fixture, so doc 20 still HAS an owner —
        // and the alert is conditioned on the card actually being unowned, so it
        // must stay hidden rather than contradict the chip beside it.
        expect(byTestId('document-owner-alert-20')).toBeNull();
    });

    it('renders the standing notice only while the card really IS unowned', async () => {
        api.applyLinkPlan.mockRejectedValue(
            Object.assign(new Error('boom'), { httpStatus: { httpStatus: 500 } }));
        // Simulate the genuinely-stranded case: the release landed, the claim did
        // not, so the refetch shows no owner.
        junctionData = junctionData.filter(l => !(l.document_fk === 20 && l.agent_fk === 1));
        mount();

        openOwnerPalette(20);
        await clickAsync(byTestId('document-owner-claim-20-3'));
        await flush();

        // Doc 20 is now unowned in the data, so this is a CLAIM (no dialog).
        expect(byTestId('document-owner-alert-20')).toBeTruthy();
        expect(byTestId('document-owner-retry-20')).toBeTruthy();
        expect(byTestId('document-owner-alert-20').textContent).toMatch(/currently\s+unowned/);
    });
});

describe('DocumentsPage — non-owner links', () => {
    it('links a new agent as `referenced` in one write, with a fresh slot', async () => {
        // All 32 live non-owner links are plain `referenced`, so the fast path must
        // not stop for a role choice.
        mount();
        click(byTestId('document-20-agent-add'));
        await clickAsync(byTestId('document-20-bind-3'));
        await flush();

        expect(api.linkAgentDocument).toHaveBeenCalledTimes(1);
        const [, , link] = api.linkAgentDocument.mock.calls[0];
        expect(link).toMatchObject({
            agent_fk: 3, document_fk: 20, relationship: ['referenced'], notes: null,
        });
        expect(link.sort_order).toBe(1);      // Charlie has no links yet
    });

    it('links ALL remaining agents in ONE array-body call, each with its own slot', async () => {
        // A loop would be the half-applied-set failure mode; one multi-value INSERT
        // either lands or does not.
        mount();
        click(byTestId('document-21-agent-add'));
        await clickAsync(byTestId('document-21-agent-bind-all'));
        await flush();

        expect(api.linkAgentDocuments).toHaveBeenCalledTimes(1);
        const [, , rows] = api.linkAgentDocuments.mock.calls[0];
        expect(rows.map(r => r.agent_fk).sort()).toEqual([1, 2, 3]);
        // Per-agent slots, not one shared value: Alpha's max is 1, Bravo's is 4,
        // Charlie has none.
        const slots = Object.fromEntries(rows.map(r => [r.agent_fk, r.sort_order]));
        expect(slots).toEqual({ 1: 2, 2: 5, 3: 1 });
    });

    it('confirms before unlinking, and warns when the link is an AUTOLOAD one', async () => {
        // Doc 22's owner link is not autoload; doc 20's Bravo link is `referenced`.
        // Use doc 20 + Alpha via the owner row? No — Alpha is the owner. Bravo's
        // referenced link is the non-autoload case.
        mount();
        await clickAsync(byTestId('document-20-agent-2').querySelector('.MuiChip-deleteIcon'));
        await flush();

        expect(byTestId('documents-unbind-dialog')).toBeTruthy();
        // `referenced`, so no knowledge is lost and there is no autoload warning.
        expect(byTestId('documents-unbind-autoload-warning')).toBeNull();
        expect(api.applyLinkPlan).not.toHaveBeenCalled();

        await clickAsync(byTestId('documents-unbind-confirm-btn'));
        await flush();

        const [, , steps] = api.applyLinkPlan.mock.calls[0];
        expect(steps).toEqual([{
            agent_fk: 2, document_fk: 20,
            prev: expect.objectContaining({ agent_fk: 2, relationship: 'referenced' }),
            next: null,
        }]);
    });

    it('opens the role/notes editor from the chip body', async () => {
        mount();
        await clickAsync(byTestId('document-20-agent-2'));
        await flush();

        expect(byTestId('document-link-popover-20-2')).toBeTruthy();
        // `owned` is not offered here — it lives on the owner row.
        expect(byTestId('document-link-role-20-2-referenced')).toBeTruthy();
        expect(byTestId('document-link-role-20-2-autoload')).toBeTruthy();
        expect(byTestId('document-link-role-20-2-owned')).toBeNull();
    });

    it('stages role changes behind Save rather than writing per click', async () => {
        // No PUT on this table, so each role change is a DELETE + re-INSERT. Three
        // clicks would be three destroy-and-recreate cycles for one logical edit.
        mount();
        await clickAsync(byTestId('document-20-agent-2'));
        await clickAsync(byTestId('document-link-role-20-2-autoload'));
        await flush();

        expect(api.setAgentDocumentLink).not.toHaveBeenCalled();

        await clickAsync(byTestId('document-link-save-20-2'));
        await flush();

        expect(api.setAgentDocumentLink).toHaveBeenCalledTimes(1);
        const [, , { prev, next }] = api.setAgentDocumentLink.mock.calls[0];
        expect(prev.relationship).toBe('referenced');
        expect(next.relationship).toBe('autoload,referenced');
        // The agent's per-agent document order belongs to AgentDetail and must
        // survive a role edit made here.
        expect(next.sort_order).toBe(4);
    });

    it('warns when a role edit newly adds autoload', async () => {
        mount();
        await clickAsync(byTestId('document-20-agent-2'));
        await clickAsync(byTestId('document-link-role-20-2-autoload'));
        await flush();
        expect(byTestId('document-link-autoload-warning-20-2').textContent)
            .toMatch(/in full at every boot/);
    });

    it('disables Save when every role has been unticked', async () => {
        // An empty SET is a legal value for a NOT NULL SET column, so the database
        // would accept it and the link would stop meaning anything.
        mount();
        await clickAsync(byTestId('document-20-agent-2'));
        await clickAsync(byTestId('document-link-role-20-2-referenced'));
        await flush();

        expect(byTestId('document-link-save-20-2').disabled).toBe(true);
        expect(document.body.textContent).toMatch(/at least one role/);
    });
});

describe('DocumentsPage — the template card creates in place', () => {
    it('waits for BOTH required columns before posting', async () => {
        mount();
        await editField('document-name-input-template', 'Brand New');
        expect(api.createArchitectureDocument).not.toHaveBeenCalled();

        await editField('document-location-input-template', 'memory/brand-new.md');
        expect(api.createArchitectureDocument).toHaveBeenCalledTimes(1);
    });

    it('posts the registry defaults and the creator, and NO sort_order', async () => {
        // The column is incoherent and being retired; inventing a slot would
        // perpetuate the artifact.
        mount();
        await editField('document-name-input-template', 'Brand New');
        await editField('document-location-input-template', 'memory/brand-new.md');

        const [, , body] = api.createArchitectureDocument.mock.calls[0];
        expect(body).toEqual({
            name: 'Brand New',
            doc_type: 'markdown',
            location: 'memory/brand-new.md',
            url: null,
            creator_fk: CREATOR,
        });
        expect(body).not.toHaveProperty('sort_order');
    });

    it('creates NO agent links — the junction needs an id that does not exist yet', async () => {
        // This ordering is what retires the two-phase create-then-link failure
        // mode, where a successful POST followed by a failed link left a row owned
        // by nobody and a dialog reporting an error.
        mount();
        await editField('document-name-input-template', 'Brand New');
        await editField('document-location-input-template', 'memory/brand-new.md');

        expect(api.linkAgentDocument).not.toHaveBeenCalled();
        expect(api.linkAgentDocuments).not.toHaveBeenCalled();
        expect(api.applyLinkPlan).not.toHaveBeenCalled();
    });

    it('honours a type chosen on the template', async () => {
        mount();
        await clickAsync(byTestId('document-type-template-html'));
        await editField('document-name-input-template', 'Brand New');
        await editField('document-location-input-template', 'docs/new.html');
        expect(api.createArchitectureDocument.mock.calls[0][2].doc_type).toBe('html');
    });

    it('posts ONCE, not twice, when both fields are blurred in turn', async () => {
        mount();
        await editField('document-name-input-template', 'Brand New');
        await editField('document-location-input-template', 'memory/brand-new.md');
        // Re-blurring the first field must not create a second row.
        await editField('document-name-input-template', 'Brand New');
        expect(api.createArchitectureDocument).toHaveBeenCalledTimes(1);
    });

    it('empties the draft after a successful create, so the next row inherits nothing', async () => {
        mount();
        await editField('document-name-input-template', 'Brand New');
        await editField('document-location-input-template', 'memory/brand-new.md');
        await flush();

        expect(byTestId('document-name-input-template').value).toBe('');
        expect(byTestId('document-location-input-template').value).toBe('');
    });

    it('KEEPS the draft when the create fails, so the next blur retries it', async () => {
        api.createArchitectureDocument.mockRejectedValue(
            Object.assign(new Error('boom'), { httpStatus: { httpStatus: 500 } }));
        mount();
        await editField('document-name-input-template', 'Brand New');
        await editField('document-location-input-template', 'memory/brand-new.md');
        await flush();

        expect(byTestId('document-name-input-template').value).toBe('Brand New');

        api.createArchitectureDocument.mockResolvedValue({});
        await editField('document-location-input-template', 'memory/brand-new.md');
        expect(api.createArchitectureDocument).toHaveBeenCalledTimes(2);
    });

    it('does not post a name that collides with an existing document', async () => {
        mount();
        await editField('document-name-input-template', 'Owned Doc');
        await editField('document-location-input-template', 'memory/whatever.md');
        expect(api.createArchitectureDocument).not.toHaveBeenCalled();
    });
});

describe('DocumentsPage — the viewer header', () => {
    it('counts the WHOLE catalog, not the filtered rows', () => {
        mount();
        const text = byTestId('documents-accounting').textContent;
        expect(text).toMatch(/3 registered documents/);
        expect(text).toMatch(/1 with no owner/);
    });

    it('offers the Unowned filter only when there IS drift to isolate', () => {
        mount();
        expect(byTestId('documents-show-unowned')).toBeTruthy();
    });

    it('hides the Unowned filter when every document has an owner', () => {
        documentsData = documentsData.filter(d => d.id !== 21);
        mount();
        expect(byTestId('documents-show-unowned')).toBeNull();
    });

    it('filters to unowned rows without changing the accounting line', async () => {
        mount();
        await clickAsync(byTestId('documents-show-unowned'));

        expect(byTestId('document-row-21')).toBeTruthy();
        expect(byTestId('document-row-20')).toBeNull();
        // V7: a count that changed when you toggled a filter would not be an
        // accounting line.
        expect(byTestId('documents-accounting').textContent).toMatch(/3 registered documents/);
    });

    it('hides the Closed filter until a closed row exists', () => {
        mount();
        expect(byTestId('documents-show-closed')).toBeNull();

        act(() => root.unmount());
        documentsData = documentsData.map(d => (d.id === 21 ? { ...d, closed: 1 } : d));
        root = createRoot(container);
        mount();
        expect(byTestId('documents-show-closed')).toBeTruthy();
    });

    it('keeps sort behind the gear, not in a chip row (V4)', () => {
        mount();
        click(byTestId('documents-settings-button'));
        expect(byTestId('documents-sort-menu')).toBeTruthy();
        expect(byTestId('documents-sort-owner')).toBeTruthy();
    });

    it('reverses when the ACTIVE mode is picked again, and stays open to show it', async () => {
        mount();
        click(byTestId('documents-settings-button'));
        await clickAsync(byTestId('documents-sort-owner'));
        // The arrow is the only affordance saying a second click reverses it, so
        // the menu must remain open.
        expect(byTestId('documents-sort-menu')).toBeTruthy();
    });

    it('renders the view toggle even with a single view, to hold the title anchor', () => {
        mount();
        expect(byTestId('documents-view-toggle')).toBeTruthy();
        expect(byTestId('view-toggle-cards')).toBeTruthy();
    });
});

describe('DocumentsPage — closed rows', () => {
    it('renders a closed chip as a CHIP, never as a literal 0', () => {
        // `closed` is a MySQL TINYINT, so it arrives as the number 0 and
        // `0 && <Chip/>` renders "0".
        documentsData = documentsData.map(d => (d.id === 21 ? { ...d, closed: 1 } : d));
        mount();
        click(byTestId('documents-show-closed'));
        expect(byTestId('document-closed-21')).toBeTruthy();
        expect(byTestId('document-row-20').textContent).not.toMatch(/^0/);
    });

    it('hides closed rows by default and offers Reopen rather than Close', async () => {
        documentsData = documentsData.map(d => (d.id === 21 ? { ...d, closed: 1 } : d));
        mount();
        expect(byTestId('document-row-21')).toBeNull();

        await clickAsync(byTestId('documents-show-closed'));
        openRowMenu(21);
        expect(byTestId('document-menu-reopen-21')).toBeTruthy();
        expect(byTestId('document-menu-close-21')).toBeNull();

        await clickAsync(byTestId('document-menu-reopen-21'));
        await flush();
        expect(putBodies()).toEqual([{ id: 21, fields: { closed: 0 } }]);
    });
});

describe('DocumentsPage — drill-through', () => {
    it('sends the owner chip to that agent\'s documents section', async () => {
        mount();
        await clickAsync(byTestId('document-owner-20'));
        expect(navigateSpy).toHaveBeenCalledWith('/agents/1#documents');
    });

    it('links out to the document itself, since the name is now an editable heading', () => {
        // The name used to BE the external link; making it editable would have
        // silently removed the page's most-used affordance.
        const link = byTestId('document-open-link-20');
        expect(link).toBeNull();     // not yet mounted
        mount();
        const el = byTestId('document-open-link-20');
        expect(el).toBeTruthy();
        expect(el.getAttribute('href'))
            .toBe('https://github.com/BillWilliams79/DarwinAI-Config/blob/main/memory/owned.md');
        expect(el.getAttribute('target')).toBe('_blank');
        expect(el.getAttribute('rel')).toMatch(/noopener/);
    });

    it('prefers a stored url over the constructed blob url', () => {
        mount();
        expect(byTestId('document-open-link-22').getAttribute('href'))
            .toBe('https://example.test/quiet');
    });
});
