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
