// Req #3051 — the REST mutation layer for the editable documents registry.
//
// documentRegistryUtils.test.js covers the pure PLANNING helpers. This file
// covers the part that talks to the network, where the risk lives:
//
//   * `agent_documents` has no `id` column, so a SINGLE-OBJECT POST commits the
//     row and THEN returns 500 (rest_post.py re-reads `WHERE id = ...`, raising
//     1054 after the INSERT has already committed under autocommit). Every insert
//     must use an array body.
//   * With no PUT available, a role change is a DELETE plus a fresh INSERT across
//     two non-atomic Lambda invocations. The rollback is the only thing standing
//     between a rejected edit and a link vanishing from an agent that was told to
//     read the file at boot — and it is unreachable from an integration test.
//   * A re-INSERT that omits `notes` or `sort_order` does not leave them alone. It
//     writes NULL over them. Silently.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn() }));

import call_rest_api from '../../RestApi/RestApi';
import {
    createArchitectureDocument, updateArchitectureDocument,
    deleteArchitectureDocument,
    linkAgentDocument, linkAgentDocuments, unlinkAgentDocument,
    applyLinkPlan, setAgentDocumentLink, LinkRollbackError,
} from '../actions/documentsApi';
import { parseRoles, isDuplicateLink } from '../agentRegistryUtils';

const URI = 'https://api.test/darwin_dev';
const TOKEN = 'id-token';

const ok = (status = 200, data = null) =>
    ({ data, httpStatus: { httpStatus: status, httpMessage: 'OK' } });

// call_rest_api rejects with a bare object (`throw {data, httpStatus}`), not an
// Error — the 404-tolerant paths read that shape directly.
const rejectWith = (status, httpMessage = '') =>
    Promise.reject({ data: null, httpStatus: { httpStatus: status, httpMessage } });

const calls = () => call_rest_api.mock.calls.map(
    ([url, method, body]) => ({ table: url.split('/').pop(), method, body }));

beforeEach(() => {
    call_rest_api.mockReset();
    call_rest_api.mockResolvedValue(ok(201, { inserted: 1 }));
});

// ---------------------------------------------------------------------------
// architecture_documents — the table that HAS an id.
// ---------------------------------------------------------------------------

describe('architecture_documents writes', () => {
    it('creates with a single-object POST — this table has an id, so read-back works', () => {
        return createArchitectureDocument(URI, TOKEN, {
            name: 'New Doc', location: 'memory/new.md', creator_fk: 'user-1',
        }).then(() => {
            const [c] = calls();
            expect(c.table).toBe('architecture_documents');
            expect(c.method).toBe('POST');
            expect(Array.isArray(c.body)).toBe(false);
            expect(c.body.doc_type).toBe('markdown');       // registry default
            expect(c.body.url).toBeNull();
            expect(c.body.closed).toBe(0);
            expect(c.body.creator_fk).toBe('user-1');
        });
    });

    it('PUTs an array body carrying ONLY the fields it was given', async () => {
        // rest_put.py builds its SET clause from the body's keys and has no version
        // column, so including an unchanged field would silently revert whatever
        // another tab had just written to it.
        await updateArchitectureDocument(URI, TOKEN, 12, { location: 'memory/moved.md' });

        const [c] = calls();
        expect(c.method).toBe('PUT');
        expect(c.body).toEqual([{ id: 12, location: 'memory/moved.md' }]);
        expect(Object.keys(c.body[0])).toEqual(['id', 'location']);
    });

    it('passes an explicit null through, which Lambda-Rest maps to SQL NULL', async () => {
        await updateArchitectureDocument(URI, TOKEN, 12, { url: null });
        expect(calls()[0].body).toEqual([{ id: 12, url: null }]);
    });

    it('deletes by id', async () => {
        await deleteArchitectureDocument(URI, TOKEN, 12);
        const [c] = calls();
        expect(c.method).toBe('DELETE');
        expect(c.body).toEqual({ id: 12 });
    });

    it('throws an error CARRYING httpStatus, which every consumer destructures', async () => {
        // showError reads err.httpStatus.httpStatus from inside a catch block; an
        // error without it throws a TypeError there and kills the resync that
        // catch block exists to perform.
        call_rest_api.mockResolvedValue(
            { data: null, httpStatus: { httpStatus: 500, httpMessage: 'boom' } });
        await expect(updateArchitectureDocument(URI, TOKEN, 1, { name: 'x' }))
            .rejects.toMatchObject({ httpStatus: { httpStatus: 500 } });
    });
});

// ---------------------------------------------------------------------------
// agent_documents — the id-less junction.
// ---------------------------------------------------------------------------

describe('junction inserts never use the single-object POST path', () => {
    it('sends an ARRAY body even for one link', async () => {
        await linkAgentDocument(URI, TOKEN, {
            agent_fk: 7, document_fk: 42, relationship: ['referenced'], sort_order: 3,
        });

        const [c] = calls();
        expect(c.table).toBe('agent_documents');
        expect(c.method).toBe('POST');
        expect(Array.isArray(c.body)).toBe(true);
        expect(c.body).toHaveLength(1);
    });

    it('serializes the SET with NO SPACES — a space stores \'\' under non-strict mode', async () => {
        await linkAgentDocument(URI, TOKEN, {
            agent_fk: 7, document_fk: 42, relationship: ['autoload', 'owned'],
        });
        expect(calls()[0].body[0].relationship).toBe('owned,autoload');
        expect(calls()[0].body[0].relationship).not.toMatch(/\s/);
    });

    it('canonicalizes at the WIRE BOUNDARY, so a bad caller cannot bypass it', async () => {
        // Passing relationshipLabel's display output ("owned, autoload") is the
        // exact mistake that empties the SET. It is normalized here regardless.
        await linkAgentDocument(URI, TOKEN, {
            agent_fk: 7, document_fk: 42, relationship: 'owned, autoload',
        });
        expect(calls()[0].body[0].relationship).toBe('owned,autoload');
    });

    it('carries notes and sort_order rather than defaulting them away', async () => {
        await linkAgentDocument(URI, TOKEN, {
            agent_fk: 7, document_fk: 42, relationship: ['owned'],
            notes: 'because', sort_order: 5,
        });
        expect(calls()[0].body[0]).toMatchObject({ notes: 'because', sort_order: 5 });
    });

    it('never writes the VIRTUAL owned_document_fk column', async () => {
        await linkAgentDocument(URI, TOKEN, {
            agent_fk: 7, document_fk: 42, relationship: ['owned'],
            owned_document_fk: 42,          // a caller mistakenly passing it
        });
        expect(calls()[0].body[0]).not.toHaveProperty('owned_document_fk');
    });

    it('normalizes every row to the SAME key set', async () => {
        // _rest_post_bulk builds ONE multi-value INSERT from the FIRST item's key
        // list and then reads item[k] on every later item, so a row missing a key
        // raises KeyError inside the Lambda and a row with extra keys drops them.
        await linkAgentDocuments(URI, TOKEN, [
            { agent_fk: 1, document_fk: 42, relationship: ['owned'], notes: 'a', sort_order: 1 },
            { agent_fk: 2, document_fk: 42, relationship: ['referenced'] },
        ]);
        const [a, b] = calls()[0].body;
        expect(Object.keys(a)).toEqual(Object.keys(b));
        expect(b.notes).toBeNull();
        expect(b.sort_order).toBeNull();
    });

    it('coerces a non-finite sort_order to null rather than sending NaN', async () => {
        await linkAgentDocuments(URI, TOKEN, [
            { agent_fk: 1, document_fk: 42, relationship: ['owned'], sort_order: undefined },
        ]);
        expect(calls()[0].body[0].sort_order).toBeNull();
    });

    it('no-ops on an empty list, so a fully-raced click is a clean nothing', async () => {
        await linkAgentDocuments(URI, TOKEN, []);
        expect(call_rest_api).not.toHaveBeenCalled();
    });
});

describe('unlinkAgentDocument tolerates an already-absent link', () => {
    it('returns true when a row was really removed', async () => {
        call_rest_api.mockResolvedValue(ok(204));
        await expect(unlinkAgentDocument(URI, TOKEN, 7, 42)).resolves.toBe(true);
    });

    it('returns FALSE on 404 — already gone is the desired end state', async () => {
        call_rest_api.mockImplementation(() => rejectWith(404, 'NOT FOUND'));
        await expect(unlinkAgentDocument(URI, TOKEN, 7, 42)).resolves.toBe(false);
    });

    it('rethrows anything that is not a 404', async () => {
        call_rest_api.mockImplementation(() => rejectWith(500, 'SQL FAILED'));
        await expect(unlinkAgentDocument(URI, TOKEN, 7, 42)).rejects.toBeTruthy();
    });

    it('deletes by the COMPOSITE key — there is no id to delete by', async () => {
        call_rest_api.mockResolvedValue(ok(204));
        await unlinkAgentDocument(URI, TOKEN, 7, 42);
        expect(calls()[0].body).toEqual({ agent_fk: 7, document_fk: 42 });
    });
});

// ---------------------------------------------------------------------------
// applyLinkPlan — the rollback. The reason this module exists.
// ---------------------------------------------------------------------------

const link = (agent_fk, relationship, extra = {}) => ({
    agent_fk, document_fk: 10, relationship, notes: null, sort_order: 1, ...extra,
});

/**
 * Drive call_rest_api by (method, table) so a test can fail exactly one call.
 * `fail(n)` fails the nth matching call, 1-indexed.
 */
const scriptCalls = (script) => {
    let i = 0;
    call_rest_api.mockImplementation((url, method) => {
        i += 1;
        const verdict = script(i, method);
        if (verdict === 'fail') return rejectWith(500, 'SQL FAILED');
        if (verdict === '404') return rejectWith(404, 'NOT FOUND');
        return Promise.resolve(ok(method === 'DELETE' ? 204 : 201));
    });
};

describe('applyLinkPlan — the happy paths', () => {
    it('re-classifies as DELETE then array-POST, in that order', async () => {
        const prev = link(2, 'referenced', { notes: 'keep me', sort_order: 4 });
        await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev, next: { ...prev, relationship: 'curated' },
        }]);

        const c = calls();
        expect(c.map(x => x.method)).toEqual(['DELETE', 'POST']);
        expect(c[1].body[0]).toMatchObject({
            relationship: 'curated', notes: 'keep me', sort_order: 4,
        });
    });

    it('creates with NO leading DELETE when prev is null', async () => {
        await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 5, document_fk: 10, prev: null, next: link(5, 'owned'),
        }]);
        expect(calls().map(x => x.method)).toEqual(['POST']);
    });

    it('unlinks with NO trailing POST when next is null', async () => {
        await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev: link(2, 'referenced'), next: null,
        }]);
        expect(calls().map(x => x.method)).toEqual(['DELETE']);
    });

    it('runs steps in the order given — release before claim', async () => {
        await applyLinkPlan(URI, TOKEN, [
            { agent_fk: 2, document_fk: 10, prev: link(2, 'owned,autoload'),
              next: link(2, 'autoload') },
            { agent_fk: 5, document_fk: 10, prev: null, next: link(5, 'owned') },
        ]);
        const c = calls();
        expect(c.map(x => x.method)).toEqual(['DELETE', 'POST', 'POST']);
        expect(c[1].body[0].agent_fk).toBe(2);
        expect(c[2].body[0].agent_fk).toBe(5);
    });

    it('no-ops on an empty plan', async () => {
        await expect(applyLinkPlan(URI, TOKEN, [])).resolves.toBeNull();
        expect(call_rest_api).not.toHaveBeenCalled();
    });
});

describe('applyLinkPlan — rollback', () => {
    it('restores step 1 when step 2 fails — the ownership-transfer failure mode', async () => {
        // Release agent 2, then agent 5 claims and is rejected. Without the
        // rollback the document is left permanently unowned.
        const prev = link(2, 'owned,autoload', { notes: 'why 2 owns it', sort_order: 3 });
        scriptCalls((i, method) => (i === 3 && method === 'POST' ? 'fail' : 'ok'));

        await expect(applyLinkPlan(URI, TOKEN, [
            { agent_fk: 2, document_fk: 10, prev, next: { ...prev, relationship: 'autoload' } },
            { agent_fk: 5, document_fk: 10, prev: null, next: link(5, 'owned') },
        ])).rejects.toBeTruthy();

        const c = calls();
        // 1 DELETE(2) 2 POST(2 as autoload) 3 POST(5 owned) FAILS
        // rollback, reverse order: step2 wrote nothing durable -> DELETE(5),
        // then step1: DELETE(2 autoload) + POST(2 at its ORIGINAL roles)
        expect(c).toHaveLength(6);
        const restore = c[c.length - 1];
        expect(restore.method).toBe('POST');
        expect(restore.body[0]).toMatchObject({
            agent_fk: 2,
            relationship: 'owned,autoload',      // the ORIGINAL, not the demoted value
            notes: 'why 2 owns it',
            sort_order: 3,
        });
    });

    it('rolls back creates by DELETING them in REVERSE order, posting nothing', async () => {
        scriptCalls((i) => (i === 2 ? 'fail' : 'ok'));

        await expect(applyLinkPlan(URI, TOKEN, [
            { agent_fk: 5, document_fk: 10, prev: null, next: link(5, 'referenced') },
            { agent_fk: 6, document_fk: 10, prev: null, next: link(6, 'referenced') },
        ])).rejects.toBeTruthy();

        const c = calls();
        expect(c.map(x => x.method)).toEqual(['POST', 'POST', 'DELETE', 'DELETE']);

        // Reverse order: the FAILED step is cleaned up first. Its own write is
        // attempted-not-confirmed, and the DELETE is issued anyway — a lost
        // response after a committed INSERT would otherwise leave the row behind,
        // and the delete is 404-tolerant so trying costs nothing.
        expect(c[2].body).toEqual({ agent_fk: 6, document_fk: 10 });
        expect(c[3].body).toEqual({ agent_fk: 5, document_fk: 10 });

        // Nothing is RESTORED, because neither step removed anything: `prev` was
        // null on both. Recreating a row that never existed is its own corruption.
        expect(c.filter(x => x.method === 'POST')).toHaveLength(2);
    });

    it('does NOT resurrect a link whose prev turned out to be already absent', async () => {
        // Recreating a row that did not exist is its own corruption. The DELETE
        // returns 404, so the step records deleted:false and the rollback skips
        // the restore.
        scriptCalls((i, method) => {
            if (i === 1 && method === 'DELETE') return '404';   // prev already gone
            if (i === 2 && method === 'POST') return 'fail';    // our write fails
            return 'ok';
        });

        await expect(applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10,
            prev: link(2, 'referenced'), next: link(2, 'curated'),
        }])).rejects.toBeTruthy();

        const c = calls();
        // DELETE(404), POST(fail), then rollback removes what we wrote — and
        // crucially does NOT post `prev` back.
        expect(c.filter(x => x.method === 'POST')).toHaveLength(1);
        expect(c[c.length - 1].method).toBe('DELETE');
    });

    it('propagates the ORIGINAL error when the rollback succeeds', async () => {
        // Nothing was lost, so "your edit was rejected" is the right headline.
        scriptCalls((i, method) => (i === 2 && method === 'POST' ? 'fail' : 'ok'));

        await expect(applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10,
            prev: link(2, 'referenced'), next: link(2, 'curated'),
        }])).rejects.not.toBeInstanceOf(LinkRollbackError);
    });

    it('raises LinkRollbackError when the RESTORE itself fails', async () => {
        // Now a link the user never asked to remove really is missing, and that
        // outranks the error that caused it. This is the case the MCP daemon gets
        // wrong: it logs "the link is now MISSING" and re-raises the original
        // conflict, so the user is told about ownership while data has vanished.
        scriptCalls((i, method) => {
            if (i === 1 && method === 'DELETE') return 'ok';    // prev removed
            if (i === 2 && method === 'POST') return 'fail';    // our write fails
            if (i === 3 && method === 'DELETE') return 'ok';    // undo our write
            if (i === 4 && method === 'POST') return 'fail';    // restore FAILS
            return 'ok';
        });

        const prev = link(2, 'owned,autoload');
        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev, next: { ...prev, relationship: 'autoload' },
        }]).catch(e => e);

        expect(err).toBeInstanceOf(LinkRollbackError);
        expect(err.message).toMatch(/now missing/);
        expect(err.message).toMatch(/Reload the page/);
        expect(err.lost).toHaveLength(1);
        expect(err.lost[0].prev).toBe(prev);
        // A relink has an incumbent, so nothing here is an ORPHAN — the missing
        // link is the whole story and the message must not also claim a stray one.
        expect(err.orphaned).toHaveLength(0);
        expect(err.message).not.toMatch(/may have been created/);
        expect(err.cause).toBeTruthy();
        // It must still carry httpStatus, or showError throws inside the catch
        // block that is trying to report it.
        expect(err.httpStatus).toBeTruthy();
    });

    it('keeps unwinding after one restore fails, rather than stranding the rest', async () => {
        // Three relinks. The third one's INSERT fails, and then the FIRST restore
        // the rollback attempts (step 3's, since it unwinds in reverse) ALSO fails.
        // Steps 2 and 1 must still be restored — a second failure must not strand
        // rows that could still be put back.
        //
        // Call order, by index:
        //   1 DEL(2)  2 POST(2)   step1 ok
        //   3 DEL(3)  4 POST(3)   step2 ok
        //   5 DEL(4)  6 POST(4)   step3 — POST FAILS
        //   7 DEL(4)  8 POST(4)   rollback step3 — RESTORE FAILS  -> lost
        //   9 DEL(3) 10 POST(3)   rollback step2 — restored
        //  11 DEL(2) 12 POST(2)   rollback step1 — restored
        scriptCalls((i) => ((i === 6 || i === 8) ? 'fail' : 'ok'));

        const prevs = { 2: link(2, 'referenced'), 3: link(3, 'referenced'), 4: link(4, 'referenced') };
        const err = await applyLinkPlan(URI, TOKEN, [2, 3, 4].map(id => ({
            agent_fk: id, document_fk: 10, prev: prevs[id], next: link(id, 'curated'),
        }))).catch(e => e);

        expect(err).toBeInstanceOf(LinkRollbackError);
        // Exactly ONE step was unrecoverable, not all three.
        expect(err.lost).toHaveLength(1);
        expect(err.lost[0].agent_fk).toBe(4);

        // Steps 2 and 1 were restored to their ORIGINAL roles after the failure.
        const restores = calls()
            .filter(c => c.method === 'POST' && c.body[0].relationship === 'referenced')
            .map(c => c.body[0].agent_fk);
        expect(restores).toContain(3);
        expect(restores).toContain(2);
    });

    // -----------------------------------------------------------------------
    // req #3101, finding 3a — the CREATE-ONLY ORPHAN.
    //
    // A standalone create step (claiming a currently-unowned document, so there is
    // no incumbent and no `prev` to roll back to) whose INSERT genuinely commits
    // while its HTTP response is lost, AND whose cleanup DELETE then also fails for
    // an unrelated reason, leaves a row nobody authorized sitting in the junction.
    // Before #3101 the rollback tracked only rows the user previously HAD, so this
    // double fault raised NOTHING beyond the original — by-then-stale — error.
    // -----------------------------------------------------------------------

    it('reports an ORPHAN when a create-only step cannot be cleaned up', async () => {
        //   1 POST(5)  the claim — fails (or its response is lost)
        //   2 DELETE(5) rollback cleanup — ALSO fails, so the row may still be there
        scriptCalls(() => 'fail');

        const next = link(5, 'owned');
        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 5, document_fk: 10, prev: null, next,
        }]).catch(e => e);

        expect(err).toBeInstanceOf(LinkRollbackError);
        expect(err.orphaned).toHaveLength(1);
        expect(err.orphaned[0].agent_fk).toBe(5);
        expect(err.orphaned[0].next).toBe(next);
        // Nothing the user HAD went missing, so the message must not say so.
        expect(err.lost).toHaveLength(0);
        expect(err.message).toMatch(/may have been created/);
        expect(err.message).not.toMatch(/now missing/);
        expect(err.message).toMatch(/Reload the page/);
        expect(err.cause).toBeTruthy();
        expect(err.httpStatus).toBeTruthy();
    });

    it('does NOT report an orphan when the cleanup DELETE succeeds', async () => {
        // The single-fault case, which is the overwhelmingly common one: the write
        // failed and its cleanup worked, so the database is exactly where it
        // started and "your edit was rejected" is the whole truth.
        scriptCalls((i, method) => (method === 'POST' ? 'fail' : 'ok'));

        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 5, document_fk: 10, prev: null, next: link(5, 'owned'),
        }]).catch(e => e);

        expect(err).not.toBeInstanceOf(LinkRollbackError);
    });

    it('does NOT report an orphan when a 404 tells us the row was never there', async () => {
        // `unlinkAgentDocument` maps 404 to "already gone", which is the desired
        // end state rather than a failure. Counting it as an orphan would cry wolf
        // on the commonest shape of this double fault.
        scriptCalls((i, method) => (method === 'POST' ? 'fail' : '404'));

        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 5, document_fk: 10, prev: null, next: link(5, 'owned'),
        }]).catch(e => e);

        expect(err).not.toBeInstanceOf(LinkRollbackError);
    });

    it('names BOTH kinds of damage when both happened, missing links first', async () => {
        // Step 1 is a relink whose restore fails (LOST). Step 2 is a create whose
        // cleanup fails (ORPHANED). One error has to carry both, or the user
        // repairs half the damage and stops.
        //   1 DEL(2)   2 POST(2)     step1 ok
        //   3 POST(5)                step2 — FAILS
        //   4 DEL(5)                 rollback step2 cleanup — FAILS -> orphaned
        //   5 DEL(2)   6 POST(2)     rollback step1 — restore FAILS -> lost
        scriptCalls((i) => ((i === 3 || i === 4 || i === 6) ? 'fail' : 'ok'));

        const prev = link(2, 'owned,autoload');
        const err = await applyLinkPlan(URI, TOKEN, [
            { agent_fk: 2, document_fk: 10, prev, next: { ...prev, relationship: 'autoload' } },
            { agent_fk: 5, document_fk: 10, prev: null, next: link(5, 'owned') },
        ]).catch(e => e);

        expect(err).toBeInstanceOf(LinkRollbackError);
        expect(err.lost).toHaveLength(1);
        expect(err.orphaned).toHaveLength(1);
        expect(err.message).toMatch(/now missing/);
        expect(err.message).toMatch(/may have been created/);
        // LOST leads: a link an agent was told to read is gone silently, while a
        // stray one is on the card the user is looking at.
        expect(err.message.indexOf('now missing'))
            .toBeLessThan(err.message.indexOf('may have been created'));
    });

    it('still attempts the RESTORE when the cleanup DELETE threw', async () => {
        // The two halves of a step's rollback were one try block until #3101, so a
        // failed cleanup — the half that costs the user nothing — skipped the
        // restore, which is the half that repairs real damage. They are independent
        // now, and this pins that: the restore POST must be issued even though the
        // DELETE before it threw.
        //   1 DEL(2)  2 POST(2)   step1 — POST FAILS
        //   3 DEL(2)              rollback cleanup — FAILS
        //   4 POST(2)             rollback restore — must still happen
        scriptCalls((i) => ((i === 2 || i === 3) ? 'fail' : 'ok'));

        const prev = link(2, 'owned,autoload', { notes: 'why', sort_order: 6 });
        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev, next: { ...prev, relationship: 'autoload' },
        }]).catch(e => e);

        const c = calls();
        expect(c).toHaveLength(4);
        expect(c[3].method).toBe('POST');
        expect(c[3].body[0]).toMatchObject({
            agent_fk: 2, relationship: 'owned,autoload', notes: 'why', sort_order: 6,
        });
        // The restore SUCCEEDED, so nothing was lost — and a step with a `prev` is
        // never an orphan, because the restore targets that same composite-PK row.
        expect(err).not.toBeInstanceOf(LinkRollbackError);
    });

    it('reports an ORPHAN on a relink whose prev turned out to be already gone', async () => {
        // THE SHAPE THE FIRST VERSION OF THIS FIX MISSED. Keying the orphan check on
        // "no `prev`" looks equivalent to "no restore ran" and is not: another writer
        // removing the link between the plan being built and the write executing
        // leaves `prev` non-null, the DELETE 404s, and the restore is correctly
        // SKIPPED (resurrecting a row that did not exist is its own corruption) —
        // but the INSERT still created a row that was not there a moment earlier.
        // Reachable from a single popover Save.
        //   1 DEL(2) -> 404   prev already gone, nothing to restore
        //   2 POST(2)         our write — FAILS
        //   3 DEL(2)          rollback cleanup — ALSO fails
        scriptCalls((i) => (i === 1 ? '404' : 'fail'));

        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10,
            prev: link(2, 'referenced'), next: link(2, 'curated'),
        }]).catch(e => e);

        expect(err).toBeInstanceOf(LinkRollbackError);
        expect(err.orphaned).toHaveLength(1);
        expect(err.orphaned[0].agent_fk).toBe(2);
        expect(err.lost).toHaveLength(0);
        expect(err.message).toMatch(/may have been created/);
        expect(err.message).not.toMatch(/now missing/);
    });

    it('says the link CARRIES THE REJECTED VALUE, not that it is missing, when the cleanup failed too', async () => {
        // A triple fault, and the most misleading state of the three: the cleanup
        // DELETE failed so the row is still there holding `next` — the value the
        // rejected edit asked for — and the restore then collides with it. Telling
        // the user it is "missing" sends them hunting for a row that is on screen.
        //   1 DEL(2)  ok       prev removed
        //   2 POST(2) FAIL     our write
        //   3 DEL(2)  FAIL     rollback cleanup
        //   4 POST(2) FAIL     rollback restore
        scriptCalls((i) => (i === 1 ? 'ok' : 'fail'));

        const prev = link(2, 'owned,autoload');
        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev, next: { ...prev, relationship: 'autoload' },
        }]).catch(e => e);

        expect(err).toBeInstanceOf(LinkRollbackError);
        expect(err.lost).toHaveLength(1);
        expect(err.lost[0].cleanupFailed).toBe(true);
        expect(err.message).toMatch(/still carries the rejected value/);
        expect(err.message).not.toMatch(/now missing/);
        // Not an orphan either — a restore WAS attempted for this step.
        expect(err.orphaned).toHaveLength(0);
    });

    it('rolls back a step whose LEADING DELETE lost its response', async () => {
        // The mirror of "the INSERT may have committed", and it was untreated: the
        // record used to be pushed AFTER the delete, so a DELETE that committed and
        // then failed to answer left `applied` empty, the rollback never saw the
        // step, and the link was silently gone with no error naming it.
        //
        // The rollback for this shape is ONE POST and nothing else.
        //   1 DEL(2)  FAIL — may or may not have committed
        //   2 POST(2) rollback restore
        scriptCalls((i) => (i === 1 ? 'fail' : 'ok'));

        const prev = link(2, 'owned,autoload', { notes: 'why', sort_order: 6 });
        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev, next: { ...prev, relationship: 'autoload' },
        }]).catch(e => e);

        const c = calls();
        expect(c.map(x => x.method)).toEqual(['DELETE', 'POST']);
        expect(c[1].body[0]).toMatchObject({
            agent_fk: 2, relationship: 'owned,autoload', notes: 'why', sort_order: 6,
        });
        // Put back, so the original error is still the headline.
        expect(err).not.toBeInstanceOf(LinkRollbackError);
    });

    it('issues NO cleanup DELETE for a step that wrote nothing — it would destroy the row', async () => {
        // THE REGRESSION THIS PINS, and it is the reason the leading-DELETE repair
        // is a bare POST. A cleanup DELETE is 404-TOLERANT, which is not the same as
        // a no-op: against a row that is genuinely still there it SUCCEEDS and
        // removes it. The commonest failure of all is the database REFUSING the
        // leading DELETE with the row untouched — so issuing a "just in case"
        // cleanup on this path makes the rollback destroy the very link it exists to
        // save, and the loss is then unreportable (`restoreNeeded` is false, so it
        // is not `lost`; a restore was attempted, so it is not `orphaned`).
        //
        // A step whose leading DELETE threw has written nothing. There is nothing of
        // its own to clean up, and the lone POST is safe in both directions: it
        // restores a row that really was removed, and collides harmlessly with one
        // that was not.
        scriptCalls((i) => (i === 1 ? 'fail' : 'ok'));

        await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev: link(2, 'referenced'), next: null,
        }]).catch(e => e);

        const c = calls();
        expect(c.filter(x => x.method === 'DELETE')).toHaveLength(1);   // the failed one only
        expect(c.map(x => x.method)).toEqual(['DELETE', 'POST']);
    });

    it('does NOT claim a loss when the leading DELETE never established one', async () => {
        // REPAIR and REPORT are decided separately, and this is why. A leading
        // DELETE that threw may or may not have committed, so the repair is
        // attempted — but if the repair also fails, nothing ever established that a
        // link went missing. Claiming one here would fire a false alarm on the
        // COMMON path (the database simply refusing the DELETE, where nothing
        // changed at all) to cover a rare lost-response.
        //   1 DEL(2) FAIL   2 POST(2) FAIL
        scriptCalls(() => 'fail');

        const prev = link(2, 'owned,autoload');
        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev, next: { ...prev, relationship: 'autoload' },
        }]).catch(e => e);

        // The repair WAS attempted — that is the half worth having.
        expect(calls().map(x => x.method)).toEqual(['DELETE', 'POST']);
        expect(err).not.toBeInstanceOf(LinkRollbackError);
        // ...and it is not mistaken for an orphan either: `prev` existed, so any row
        // sitting in that slot is its, not one this step invented.
        expect(err.orphaned).toBeUndefined();
    });

    it('restores prev when the re-INSERT fails on a SINGLE relink', async () => {
        // The regression this pins, and the reason `applied` is recorded before the
        // insert rather than after it: the DELETE has already committed by the time
        // the INSERT fails, so a rollback that never saw this step would leave the
        // link permanently missing — the exact silent loss this module exists to
        // prevent, and the commonest shape of it.
        scriptCalls((i, method) => (i === 2 && method === 'POST' ? 'fail' : 'ok'));

        const prev = link(2, 'owned,autoload', { notes: 'why', sort_order: 6 });
        await expect(applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev, next: { ...prev, relationship: 'autoload' },
        }])).rejects.toBeTruthy();

        const restore = calls().at(-1);
        expect(restore.method).toBe('POST');
        expect(restore.body[0]).toMatchObject({
            agent_fk: 2, relationship: 'owned,autoload', notes: 'why', sort_order: 6,
        });
    });

    it('does not report a loss when the only failed step wrote nothing', async () => {
        // A pure unlink that fails has removed nothing and written nothing.
        scriptCalls(() => 'fail');
        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev: link(2, 'referenced'), next: null,
        }]).catch(e => e);
        expect(err).not.toBeInstanceOf(LinkRollbackError);
    });
});

describe('setAgentDocumentLink', () => {
    it('is a one-step plan, so it inherits the rollback', async () => {
        const prev = link(2, 'referenced', { notes: 'n', sort_order: 8 });
        await setAgentDocumentLink(URI, TOKEN, {
            prev, next: { ...prev, relationship: 'curated,referenced' },
        });

        const c = calls();
        expect(c.map(x => x.method)).toEqual(['DELETE', 'POST']);
        expect(c[1].body[0]).toMatchObject({
            agent_fk: 2, document_fk: 10,
            relationship: 'curated,referenced', notes: 'n', sort_order: 8,
        });
    });

    it('preserves sort_order through a role-only edit', async () => {
        // The likeliest silent defect in this area: sort_order is the agent's
        // per-agent document order, owned by AgentDetail. A re-POST that dropped it
        // would reset that order from a control that has nothing to do with it.
        const prev = link(2, 'autoload', { sort_order: 12 });
        await setAgentDocumentLink(URI, TOKEN, {
            prev, next: { ...prev, relationship: 'autoload,referenced' },
        });
        expect(calls()[1].body[0].sort_order).toBe(12);
    });
});

// ===========================================================================
// A STATEFUL agent_documents (req #3294).
//
// `scriptCalls` above answers by CALL INDEX, which is enough to ask "what does
// the rollback do when call 4 fails" and structurally unable to ask "what is in
// the table afterwards". The defect this section exists for is invisible to it:
// every call succeeds, the plan is correctly rejected, and a row nobody touched
// is gone. Only real state can catch that, so the table is real here and the
// assertions are about ROWS, not about call sequences.
//
// It models the three things about this junction that decide the answer, and no
// more: the composite PRIMARY key, `uq_agent_documents_owner` (one `owned` per
// DOCUMENT), and `uq_agent_documents_principles` (one `principles` per AGENT).
// ===========================================================================

const jKey = (agent_fk, document_fk) => `${agent_fk}:${document_fk}`;

/**
 * A 409 shaped exactly as Lambda-Rest sends one — verified against
 * `compose_conflict_response` in rest_api_utils.py, not assumed. `error` is
 * UPPERCASE, and `constraint` arrives UNQUALIFIED because `constraint_name`
 * rsplits MySQL 8's `for key 'agent_documents.PRIMARY'` on the dot.
 */
const conflict = (constraint) => Promise.reject({
    data: null,
    httpStatus: {
        httpMethod: 'POST',
        httpStatus: 409,
        httpMessage: `Duplicate entry for key '${constraint}'`,
        httpDetail: {
            error: 'CONFLICT', errno: 1062, constraint,
            table: 'agent_documents',
            message: `Duplicate entry for key '${constraint}'`,
        },
    },
});

const hasRole = (rel, role) => parseRoles(rel).includes(role);

/**
 * Install a stateful `agent_documents` behind call_rest_api.
 *
 * @param initial rows already in the junction before the test runs
 * @param fault   (callIndex, method, body) => undefined | 'refuse' | 'lost'
 *                  'refuse' — the statement never ran; the table is untouched.
 *                  'lost'   — the statement COMMITTED and the response was lost.
 *                The two are indistinguishable to the caller and have opposite
 *                consequences, which is the whole reason the rollback exists.
 */
const makeJunction = (initial = [], fault = () => undefined) => {
    const rows = new Map();
    for (const r of initial) rows.set(jKey(r.agent_fk, r.document_fk), { ...r });
    let i = 0;

    call_rest_api.mockImplementation((url, method, body) => {
        i += 1;
        const table = url.split('/').pop();
        // A wrong-table call would otherwise be silently accepted and make every
        // assertion below meaningless.
        if (table !== 'agent_documents') {
            return Promise.reject(new Error(`simulator models agent_documents only, got ${table}`));
        }
        const verdict = fault(i, method, body);
        // A mistyped verdict must not fall through to the SUCCESS path — a test
        // reading as a failure test while asserting the happy path is worse than
        // no test.
        if (verdict !== undefined && verdict !== 'refuse' && verdict !== 'lost') {
            return Promise.reject(new Error(`unknown fault verdict: ${verdict}`));
        }
        if (verdict === 'refuse') return rejectWith(500, 'SQL FAILED');

        if (method === 'DELETE') {
            const k = jKey(body.agent_fk, body.document_fk);
            // rest_delete.py: `affected_rows == 0` is 404, otherwise 200 'OK'.
            // NOT 204 — this table's DELETE has always answered 200.
            if (!rows.has(k)) return rejectWith(404, 'NOT FOUND');
            rows.delete(k);
            if (verdict === 'lost') return rejectWith(500, 'SQL FAILED');
            return Promise.resolve(ok(200));
        }

        // POST is ONE multi-value INSERT, and it is modelled the way InnoDB
        // actually applies one: ROW BY ROW, clustered index (the composite PK)
        // before the secondaries, against a working set that already carries the
        // rows earlier in the SAME statement — so a batch that collides with
        // ITSELF is caught, and a batch where row 1 trips a unique key and row 2
        // trips the PK reports row 1's constraint, as MySQL would.
        //
        // It still applies ATOMICALLY: the working set is discarded on any
        // violation and `rows` is untouched, matching _rest_post_bulk's
        // conn.rollback(). Validate-all-then-apply-all would have got the
        // atomicity right and the ORDER wrong.
        const incoming = body.map(r => ({ ...r }));
        const staged = new Map(rows);
        for (const r of incoming) {
            const k = jKey(r.agent_fk, r.document_fk);
            if (staged.has(k)) return conflict('PRIMARY');
            const seen = [...staged.values()];
            if (hasRole(r.relationship, 'owned')
                && seen.some(x => x.document_fk === r.document_fk && hasRole(x.relationship, 'owned'))) {
                return conflict('uq_agent_documents_owner');
            }
            if (hasRole(r.relationship, 'principles')
                && seen.some(x => x.agent_fk === r.agent_fk && hasRole(x.relationship, 'principles'))) {
                return conflict('uq_agent_documents_principles');
            }
            staged.set(k, r);
        }
        rows.clear();
        for (const [k, r] of staged) rows.set(k, r);
        if (verdict === 'lost') return rejectWith(500, 'SQL FAILED');
        return Promise.resolve(ok(201, { inserted: incoming.length }));
    });

    return {
        get: (agent_fk, document_fk) => rows.get(jKey(agent_fk, document_fk)) || null,
        has: (agent_fk, document_fk) => rows.has(jKey(agent_fk, document_fk)),
        size: () => rows.size,
        /** A write by SOMEBODY ELSE, bypassing the API — another tab, or the daemon. */
        insert: (r) => rows.set(jKey(r.agent_fk, r.document_fk), { ...r }),
        snapshot: () => [...rows.values()]
            .map(r => ({ ...r }))
            .sort((a, b) => a.agent_fk - b.agent_fk || a.document_fk - b.document_fk),
    };
};

/** A stored row, as the junction holds it (already serialized). */
const row = (agent_fk, relationship, extra = {}) => ({
    agent_fk, document_fk: 10, relationship, notes: null, sort_order: 1, ...extra,
});

describe('the stateful junction models what it claims to', () => {
    it('409s on the composite PRIMARY key, leaving the incumbent row alone', async () => {
        const j = makeJunction([row(5, 'referenced', { notes: 'mine' })]);
        await expect(linkAgentDocument(URI, TOKEN, row(5, 'curated'))).rejects.toMatchObject({
            httpStatus: { httpStatus: 409, httpDetail: { errno: 1062, constraint: 'PRIMARY' } },
        });
        expect(j.get(5, 10).relationship).toBe('referenced');
        expect(j.get(5, 10).notes).toBe('mine');
    });

    it('409s on uq_agent_documents_owner for a SECOND owner of one document', async () => {
        makeJunction([row(2, 'owned')]);
        await expect(linkAgentDocument(URI, TOKEN, row(5, 'owned'))).rejects.toMatchObject({
            httpStatus: { httpDetail: { constraint: 'uq_agent_documents_owner' } },
        });
    });

    it('409s on uq_agent_documents_principles for a SECOND principles doc of one agent', async () => {
        makeJunction([row(2, 'principles')]);
        await expect(
            linkAgentDocument(URI, TOKEN, { ...row(2, 'principles'), document_fk: 11 }),
        ).rejects.toMatchObject({
            httpStatus: { httpDetail: { constraint: 'uq_agent_documents_principles' } },
        });
    });

    it('catches a batch that collides with ITSELF, and lands none of it', async () => {
        // One multi-value INSERT is not a loop of inserts: MySQL sees row 2
        // against a clustered index that already holds row 1, and the statement
        // fails as a unit. A simulator that validated only against the
        // pre-statement rows would accept this and quietly bless a bad batch.
        const j = makeJunction();
        await expect(linkAgentDocuments(URI, TOKEN, [
            row(5, 'owned'),
            { ...row(6, 'owned'), document_fk: 10 },
        ])).rejects.toMatchObject({
            httpStatus: { httpDetail: { constraint: 'uq_agent_documents_owner' } },
        });
        expect(j.size()).toBe(0);          // atomic — row 1 did not land either
    });

    it('404s a DELETE that matched nothing, and removes the row when it did', async () => {
        const j = makeJunction([row(2, 'referenced')]);
        await expect(unlinkAgentDocument(URI, TOKEN, 2, 10)).resolves.toBe(true);
        expect(j.has(2, 10)).toBe(false);
        await expect(unlinkAgentDocument(URI, TOKEN, 2, 10)).resolves.toBe(false);
    });

    it("'lost' commits the statement and THEN fails — the shape the rollback exists for", async () => {
        const j = makeJunction([], () => 'lost');
        await expect(linkAgentDocument(URI, TOKEN, row(5, 'owned'))).rejects.toBeTruthy();
        expect(j.has(5, 10)).toBe(true);          // it landed anyway
    });
});

describe('applyLinkPlan on real state — the pre-existing link survives (req #3294)', () => {
    it('does NOT delete a link its INSERT collided with', async () => {
        // THE ACCEPTANCE TEST. A plan built from a cache that has gone stale: the
        // UI believed agent 5 had no link to document 10, so it planned a CREATE.
        // Another writer put one there in the meantime — a second tab or the MCP
        // daemon, never a different user: `agent_documents` is derived-scoped
        // through `agents.creator_fk`, so this is a same-identity race, not a
        // cross-tenant one. The INSERT hits the composite PK and 409s.
        //
        // Every call in this test succeeds at what it was asked to do. Before the
        // fix the rollback then issued its 404-TOLERANT cleanup DELETE against a
        // row this step did not create, that DELETE SUCCEEDED, and the link was
        // gone — with no `lost` entry (this step removed nothing) and no
        // `orphaned` entry (the cleanup worked), so the user was told only that
        // their edit was rejected.
        const incumbent = row(5, 'referenced', { notes: 'put here by another tab', sort_order: 7 });
        const j = makeJunction([incumbent]);

        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 5, document_fk: 10, prev: null, next: row(5, 'curated'),
        }]).catch(e => e);

        // The link is STILL THERE, and unchanged in every field.
        expect(j.get(5, 10)).toEqual(incumbent);
        expect(j.size()).toBe(1);

        // No cleanup DELETE was ever issued for it.
        expect(calls().filter(c => c.method === 'DELETE')).toHaveLength(0);

        // The user gets the real answer — their edit was rejected — and nothing
        // claims the database is broken, because it is not.
        expect(err).not.toBeInstanceOf(LinkRollbackError);
        expect(err.httpStatus.httpStatus).toBe(409);
    });

    it('does NOT delete the row a THIRD PARTY wrote into the key it just vacated', async () => {
        // THE POPOVER-SAVE RACE, and the highest-value shape of this defect: it is
        // reachable from one click on a control the user uses constantly.
        //
        // setAgentDocumentLink is a one-step plan, so a role edit is a DELETE and
        // a fresh INSERT across two non-atomic Lambda invocations. The DELETE
        // COMMITS — the user's own row is genuinely gone — and in the window
        // before the re-INSERT another writer (a second tab, or the MCP daemon)
        // claims that same composite key. Our INSERT then 409s on the PK.
        //
        // Before the fix the rollback deleted THAT row: measured, the junction
        // ended holding the user's original 'referenced' link and the third
        // party's row was destroyed, while the thrown error said only "that
        // document is already linked to this agent".
        const incumbent = row(3, 'referenced', { notes: 'mine' });
        const j = makeJunction([incumbent], (i, method) => {
            // Between the DELETE and the POST, somebody else takes the key.
            if (i === 1 && method === 'DELETE') {
                queueMicrotask(() => j.insert(row(3, 'owned', { notes: 'THIRD PARTY' })));
            }
            return undefined;
        });

        const err = await setAgentDocumentLink(URI, TOKEN, {
            prev: incumbent, next: { ...incumbent, relationship: 'curated' },
        }).catch(e => e);

        // THE THIRD PARTY'S ROW SURVIVES, untouched.
        expect(j.get(3, 10)).toEqual(row(3, 'owned', { notes: 'THIRD PARTY' }));
        expect(j.size()).toBe(1);

        // The only DELETE issued was the leading one. No cleanup went near it.
        expect(calls().filter(c => c.method === 'DELETE')).toHaveLength(1);

        // And the report is honest about the one thing that DID change: the
        // user's own link was removed and could not be put back, because the
        // restore collides with the row now sitting in that slot.
        expect(err).toBeInstanceOf(LinkRollbackError);
        expect(err.lost).toHaveLength(1);
        expect(err.lost[0].cleanupFailed).toBe(false);
        expect(err.orphaned).toHaveLength(0);
        expect(err.message).toMatch(/now missing/);
        expect(err.message).toMatch(/Reload the page/);
        // Not "still carries the rejected value" — the slot holds neither `prev`
        // nor `next` but a third value, and that phrasing would be a lie.
        expect(err.message).not.toMatch(/still carr/);
    });

    it('rolls the EARLIER steps back correctly around a collision mid-plan', async () => {
        // The suppression must not cost the rest of the plan its rollback. Step 1
        // legitimately re-classifies agent 2; step 2 collides with a pre-existing
        // agent-5 link. Agent 5's row must survive AND agent 2 must be put back.
        const incumbent = row(5, 'referenced', { notes: 'not ours' });
        const before = row(2, 'owned,autoload', { notes: 'why 2 owns it', sort_order: 3 });
        const j = makeJunction([before, incumbent]);

        const err = await applyLinkPlan(URI, TOKEN, [
            { agent_fk: 2, document_fk: 10, prev: before, next: { ...before, relationship: 'autoload' } },
            { agent_fk: 5, document_fk: 10, prev: null, next: row(5, 'owned') },
        ]).catch(e => e);

        expect(j.get(5, 10)).toEqual(incumbent);          // untouched
        expect(j.get(2, 10)).toEqual(before);             // restored to its ORIGINAL roles
        expect(j.size()).toBe(2);
        expect(err).not.toBeInstanceOf(LinkRollbackError);
    });

    it('STILL cleans up when the INSERT committed and only its response was lost', async () => {
        // The other half of the same decision, and the reason the suppression is
        // keyed on a definite 1062 rather than on "the INSERT failed". Here the row
        // really is this step's, so the cleanup must go ahead and remove it.
        const j = makeJunction([], (i, method) => (method === 'POST' ? 'lost' : undefined));

        await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 5, document_fk: 10, prev: null, next: row(5, 'owned'),
        }]).catch(e => e);

        expect(j.size()).toBe(0);                          // the orphan was removed
        expect(calls().map(c => c.method)).toEqual(['POST', 'DELETE']);
    });

    it('does NOT suppress the cleanup for uq_agent_documents_owner', async () => {
        // THE DELIBERATE NON-SUPPRESSION. Same errno, same table, different
        // situation: a second ownership claim means the INSERT genuinely did not
        // land, so there is nothing of ours behind it and the cleanup must be
        // allowed to run. Told apart by CONSTRAINT NAME, never by accident.
        const owner = row(2, 'owned', { notes: 'incumbent owner' });
        const j = makeJunction([owner]);

        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 5, document_fk: 10, prev: null, next: row(5, 'owned'),
        }]).catch(e => e);

        // The cleanup WAS issued (and 404s harmlessly, since nothing landed).
        const deletes = calls().filter(c => c.method === 'DELETE');
        expect(deletes).toHaveLength(1);
        expect(deletes[0].body).toEqual({ agent_fk: 5, document_fk: 10 });

        // The incumbent owner is untouched and the table is exactly as it started.
        expect(j.snapshot()).toEqual([owner]);
        expect(err.httpStatus.httpDetail.constraint).toBe('uq_agent_documents_owner');
        expect(err).not.toBeInstanceOf(LinkRollbackError);
    });

    it('does NOT suppress the cleanup for uq_agent_documents_principles either', async () => {
        // The same reasoning on the mirror key (one principles doc per AGENT).
        const held = { ...row(2, 'principles'), document_fk: 11 };
        const j = makeJunction([held]);

        await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev: null, next: row(2, 'principles'),
        }]).catch(e => e);

        expect(calls().filter(c => c.method === 'DELETE')).toHaveLength(1);
        expect(j.snapshot()).toEqual([held]);
    });

    it('completes an ownership transfer, leaving exactly the two rows it should', async () => {
        // The happy path, asserted on ROWS rather than on a call sequence: agent 2
        // hands document 10 to agent 5. The order is forced —
        // uq_agent_documents_owner rejects the claim while the incumbent still
        // holds `owned` — and the simulator enforces that, so a plan in the wrong
        // order would fail here rather than pass silently.
        const j = makeJunction([row(2, 'owned,autoload', { sort_order: 3 })]);

        await applyLinkPlan(URI, TOKEN, [
            { agent_fk: 2, document_fk: 10, prev: row(2, 'owned,autoload', { sort_order: 3 }),
              next: row(2, 'autoload', { sort_order: 3 }) },
            { agent_fk: 5, document_fk: 10, prev: null, next: row(5, 'owned') },
        ]);

        expect(j.snapshot()).toEqual([
            row(2, 'autoload', { sort_order: 3 }),
            row(5, 'owned'),
        ]);
    });

    it('leaves the table byte-for-byte as it started when the transfer is refused', async () => {
        // The failure the rollback exists for, measured end to end. Agent 2
        // releases `owned`, agent 5's claim is refused, and the junction must end
        // where it began — not merely "a POST was issued".
        const start = [row(2, 'owned,autoload', { notes: 'why 2 owns it', sort_order: 3 })];
        const j = makeJunction(start, (i, method) => (i === 3 && method === 'POST' ? 'refuse' : undefined));

        const err = await applyLinkPlan(URI, TOKEN, [
            { agent_fk: 2, document_fk: 10, prev: start[0], next: { ...start[0], relationship: 'autoload' } },
            { agent_fk: 5, document_fk: 10, prev: null, next: row(5, 'owned') },
        ]).catch(e => e);

        expect(j.snapshot()).toEqual(start);
        expect(err).not.toBeInstanceOf(LinkRollbackError);
    });

    it('reports a LOSS, and does not invent one, when the restore truly cannot land', async () => {
        // The rollback's worst case on real state: the release commits, the claim
        // is refused, and the restore is refused too. The row really is gone, and
        // that — not the ownership conflict — is what the user must be told.
        const start = [row(2, 'owned,autoload', { sort_order: 3 })];
        const j = makeJunction(start, (i, method) => (method === 'POST' ? 'refuse' : undefined));

        const err = await applyLinkPlan(URI, TOKEN, [{
            agent_fk: 2, document_fk: 10, prev: start[0], next: { ...start[0], relationship: 'autoload' },
        }]).catch(e => e);

        expect(j.size()).toBe(0);
        expect(err).toBeInstanceOf(LinkRollbackError);
        expect(err.lost).toHaveLength(1);
        expect(err.orphaned).toHaveLength(0);
        expect(err.message).toMatch(/now missing/);
    });
});

describe('isDuplicateLink', () => {
    const err409 = (constraint, table, errno = 1062) => ({
        httpStatus: { httpStatus: 409, httpDetail: { errno, constraint, table } },
    });

    it('is true only for 1062 on the composite PRIMARY key of the NAMED table', () => {
        expect(isDuplicateLink(err409('PRIMARY', 'agent_documents'), 'agent_documents')).toBe(true);
    });

    it('is FALSE when the table argument is missing — never a wildcard', () => {
        // The trap this closes: `err.httpDetail.table === undefined` compares
        // equal to a forgotten argument, so without an explicit guard a caller
        // that omitted the table would match EVERY table's PRIMARY key — the
        // exact over-match the argument exists to prevent.
        const err = { httpStatus: { httpStatus: 409, httpDetail: { errno: 1062, constraint: 'PRIMARY' } } };
        expect(isDuplicateLink(err, undefined)).toBe(false);
        expect(isDuplicateLink(err, '')).toBe(false);
        expect(isDuplicateLink(err409('PRIMARY', 'agent_documents'), undefined)).toBe(false);
    });

    it('is FALSE for the same key on a different table', () => {
        // `constraint` arrives unqualified and every table has a PRIMARY, so
        // ignoring `table` would suppress a cleanup on evidence about another one.
        expect(isDuplicateLink(err409('PRIMARY', 'agent_instructions'), 'agent_documents')).toBe(false);
    });

    it('is FALSE for the OTHER 1062s this table raises', () => {
        // Both mean the INSERT did not land, so both must leave the cleanup on.
        expect(isDuplicateLink(err409('uq_agent_documents_owner', 'agent_documents'), 'agent_documents')).toBe(false);
        expect(isDuplicateLink(err409('uq_agent_documents_principles', 'agent_documents'), 'agent_documents')).toBe(false);
    });

    it('is FALSE for a non-1062 conflict and for any non-409 status', () => {
        // 1452 is a missing parent — a different problem with a different repair.
        expect(isDuplicateLink(err409('PRIMARY', 'agent_documents', 1452), 'agent_documents')).toBe(false);
        expect(isDuplicateLink({ httpStatus: { httpStatus: 500 } }, 'agent_documents')).toBe(false);
        expect(isDuplicateLink({ httpStatus: { httpStatus: 404 } }, 'agent_documents')).toBe(false);
    });

    it('is FALSE — never a throw — on a malformed or missing error', () => {
        // It is read from inside a catch block; throwing there would replace a
        // recoverable failure with an unhandled one.
        expect(isDuplicateLink(undefined, 'agent_documents')).toBe(false);
        expect(isDuplicateLink(null, 'agent_documents')).toBe(false);
        expect(isDuplicateLink(new Error('boom'), 'agent_documents')).toBe(false);
        expect(isDuplicateLink({ httpStatus: { httpStatus: 409 } }, 'agent_documents')).toBe(false);
        expect(isDuplicateLink({ httpStatus: { httpStatus: 409, httpDetail: null } }, 'agent_documents')).toBe(false);
    });
});
