// Req #3051 — the pure helpers behind the editable documents registry.
//
// Its own file rather than more cases in agentRegistryUtils.test.js: that file is
// already the instruction-side contract, and the two sets of validators differ in
// ways that matter (characters vs bytes, SET vs scalar). Keeping them apart stops
// a reader assuming a rule proven for one applies to the other.
//
// Everything here is a pure function, which is the whole reason these tests are
// worth more than their length: each one encodes a database behaviour that fails
// SILENTLY in production, so a unit test is the only place the failure is ever
// loud.

import { describe, it, expect } from 'vitest';

import {
    parseRoles, serializeRoles, relationshipSetError, relationshipSetHint,
    documentNameTaken, documentNameError, documentLocationError,
    documentUrlError, documentNotesError, docTypeError,
    documentOwnerLink, nextDocumentSortOrder, planOwnerTransfer,
    charLength, restErrorMessage, relationshipLabel, documentHref,
    resolveRoleConflicts, documentTarget, documentBlobHref,
    DOCUMENT_NAME_MAX, DOCUMENT_LOCATION_MAX, DOCUMENT_URL_MAX, DOCUMENT_NOTES_MAX,
} from '../agentRegistryUtils';

// ---------------------------------------------------------------------------
// serializeRoles — the single highest-consequence helper in the change.
//
// `agent_documents.relationship` is a MySQL SET and RDS runs a NON-STRICT
// sql_mode, so a member MySQL does not recognise does not raise: the whole
// assignment stores as ''. A link with an empty SET is not owned, not autoloaded
// and not referenced — it renders as a bland dash and a document silently loses
// its owner. A single space is enough to cause it.
// ---------------------------------------------------------------------------

describe('serializeRoles (req #3051)', () => {
    it('joins with a BARE comma — a space would empty the SET', () => {
        expect(serializeRoles(['owned', 'autoload'])).toBe('owned,autoload');
        expect(serializeRoles(['owned', 'autoload'])).not.toMatch(/\s/);
    });

    it('emits precedence order regardless of input order, so equal sets store identically', () => {
        expect(serializeRoles(['autoload', 'owned'])).toBe('owned,autoload');
        expect(serializeRoles(['owned', 'autoload'])).toBe('owned,autoload');
        expect(serializeRoles(['referenced', 'curated'])).toBe('curated,referenced');
    });

    it('drops members MySQL would not recognise rather than passing them through', () => {
        // Passing 'onwed' through would store '' — losing the three GOOD roles
        // alongside the typo. Dropping it keeps the rest.
        expect(serializeRoles(['owned', 'onwed', 'autoload'])).toBe('owned,autoload');
    });

    it('de-duplicates', () => {
        expect(serializeRoles(['owned', 'owned', 'autoload'])).toBe('owned,autoload');
    });

    it('trims members, so a hand-split string cannot smuggle in a space', () => {
        expect(serializeRoles([' owned', 'autoload '])).toBe('owned,autoload');
    });

    it('survives a round trip through relationshipLabel, which is DISPLAY-only', () => {
        // This is the exact bug the helper exists to prevent: relationshipLabel
        // joins with ", " for humans, and sending its output to the API stores ''.
        const label = relationshipLabel('owned,autoload');
        expect(label).toBe('owned, autoload');            // display form has a space
        expect(serializeRoles(label)).toBe('owned,autoload');   // wire form does not
        expect(serializeRoles(label)).not.toMatch(/\s/);
    });

    it('accepts a stored SET string as well as an array', () => {
        expect(serializeRoles('owned,autoload')).toBe('owned,autoload');
    });

    it('returns an empty string for an empty or fully-unknown set', () => {
        expect(serializeRoles([])).toBe('');
        expect(serializeRoles(['nonsense'])).toBe('');
    });

    it('is the exact inverse of parseRoles', () => {
        for (const stored of ['owned', 'referenced', 'owned,autoload', 'curated,referenced']) {
            expect(serializeRoles(parseRoles(stored))).toBe(stored);
        }
    });

    // req #3101, finding 3b — the invariant now lives HERE rather than at one
    // call site. `serializeRoles` is the last thing every junction write crosses
    // (documentsApi's `linkRow` calls it), so a call site that has not been
    // written yet cannot reintroduce the combination the way the first version of
    // `planOwnerTransfer` did.
    it('drops a role another role in the set already supersedes', () => {
        expect(serializeRoles(['owned', 'referenced'])).toBe('owned');
        expect(serializeRoles(['principles', 'autoload', 'referenced']))
            .toBe('principles,autoload');
    });

    it('drops the superseded member whichever order it arrives in', () => {
        expect(serializeRoles(['referenced', 'owned'])).toBe('owned');
        expect(serializeRoles('referenced,owned')).toBe('owned');
    });

    it('leaves roles that are merely ORTHOGONAL to ownership alone', () => {
        // `autoload` and `curated` say nothing about precedence — an owner very
        // often still reads the file at boot, and dropping that would be a second
        // change nobody asked for.
        expect(serializeRoles(['owned', 'autoload', 'curated']))
            .toBe('owned,curated,autoload');
    });
});

describe('resolveRoleConflicts (req #3101)', () => {
    it('is order-independent', () => {
        expect(resolveRoleConflicts(['owned', 'referenced']).sort())
            .toEqual(resolveRoleConflicts(['referenced', 'owned']).sort());
    });

    it('accepts a stored SET string as well as an array', () => {
        expect(resolveRoleConflicts('owned,referenced')).toEqual(['owned']);
    });

    it('leaves a set with no conflict untouched', () => {
        expect(resolveRoleConflicts(['curated', 'referenced']).sort())
            .toEqual(['curated', 'referenced']);
    });

    it('de-duplicates but does NOT drop unknown members — that is serializeRoles\' job', () => {
        // Two helpers each owning half of one decision is how they drift. Unknown
        // members are dropped in exactly one place.
        expect(resolveRoleConflicts(['owned', 'owned', 'nonsense']).sort())
            .toEqual(['nonsense', 'owned']);
    });

    it('never empties a set that had any role at all', () => {
        for (const roles of [['referenced'], ['owned'], ['principles'], ['curated']]) {
            expect(resolveRoleConflicts(roles).length).toBeGreaterThan(0);
        }
    });
});

describe('relationshipSetError', () => {
    it('rejects an EMPTY set — a NOT NULL SET accepts \'\', so the DB would not', () => {
        // There is no stored value to fall back to either: the roles ARE the link.
        expect(relationshipSetError([])).toMatch(/at least one role/);
    });

    it('rejects an unknown member by name', () => {
        expect(relationshipSetError(['owned', 'onwed'])).toMatch(/onwed/);
    });

    it('blocks owned + referenced as self-referential', () => {
        // Instruction #83 makes an owned document outrank a referenced one, so a
        // link carrying both makes the precedence rule refer to itself.
        expect(relationshipSetError(['owned', 'referenced'])).toMatch(/cannot be both/);
    });

    it('allows every combination production actually uses', () => {
        expect(relationshipSetError(['owned', 'autoload'])).toBeNull();
        expect(relationshipSetError(['referenced'])).toBeNull();
        expect(relationshipSetError(['owned'])).toBeNull();
        expect(relationshipSetError(['curated', 'referenced'])).toBeNull();
        expect(relationshipSetError(['autoload'])).toBeNull();
    });
});

describe('relationshipSetHint', () => {
    it('flags owned + curated as redundant WITHOUT blocking it', () => {
        expect(relationshipSetHint(['owned', 'curated'])).toMatch(/Redundant/);
        expect(relationshipSetError(['owned', 'curated'])).toBeNull();
    });

    it('says nothing about an ordinary set', () => {
        expect(relationshipSetHint(['owned', 'autoload'])).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Length validation — CHARACTERS, not UTF-16 units.
// ---------------------------------------------------------------------------

describe('charLength counts what MySQL counts', () => {
    it('counts an astral character as ONE, where String.length counts two', () => {
        const emoji = '😀';
        expect(emoji.length).toBe(2);        // UTF-16 code units
        expect(charLength(emoji)).toBe(1);   // utf8mb4 characters
    });

    it('treats null and undefined as empty', () => {
        expect(charLength(null)).toBe(0);
        expect(charLength(undefined)).toBe(0);
    });
});

describe('documentNameError measures the column the way MySQL does', () => {
    it('accepts a name of exactly the column width in CHARACTERS', () => {
        const name = '😀'.repeat(DOCUMENT_NAME_MAX);       // 256 chars, 512 units
        expect(charLength(name)).toBe(DOCUMENT_NAME_MAX);
        expect(documentNameError(name, [])).toBeNull();
    });

    it('rejects one character over', () => {
        const name = '😀'.repeat(DOCUMENT_NAME_MAX + 1);
        expect(documentNameError(name, [])).toMatch(/Too long/);
    });

    it('does NOT reject a legal name whose String.length is over the limit', () => {
        // The bug this pins: `.length` on 200 emoji is 400, which a naive check
        // would reject even though MySQL stores it happily.
        const name = '😀'.repeat(200);
        expect(name.length).toBeGreaterThan(DOCUMENT_NAME_MAX);
        expect(documentNameError(name, [])).toBeNull();
    });

    it('treats an empty name as "abandon the edit", not as an error', () => {
        // `name` is NOT NULL, so an in-place field reverts. Reporting it would
        // leave a red field the user can only clear by retyping what was there.
        expect(documentNameError('   ', [])).toBeNull();
    });
});

describe('documentNameTaken', () => {
    // uq_architecture_documents_name does NOT exclude closed rows, so the check
    // must run against the UNFILTERED catalog — colliding with an invisible
    // closed row is the confusing failure this prevents.
    const catalog = [
        { id: 1, name: 'Agents Registry', closed: 0 },
        { id: 2, name: 'Retired Notes', closed: 1 },
    ];

    it('matches case-insensitively, as the server collation does', () => {
        expect(documentNameTaken('agents registry', catalog)).toBe(true);
    });

    it('matches on the trimmed value — MySQL 8 collation is NO PAD', () => {
        expect(documentNameTaken('  Agents Registry  ', catalog)).toBe(true);
    });

    it('collides with a CLOSED row, which the page hides by default', () => {
        expect(documentNameTaken('Retired Notes', catalog)).toBe(true);
        expect(documentNameError('Retired Notes', catalog)).toMatch(/may be closed/);
    });

    it('does not collide a row with itself', () => {
        expect(documentNameTaken('Agents Registry', catalog, 1)).toBe(false);
    });

    it('allows a genuinely new name', () => {
        expect(documentNameTaken('Brand New Doc', catalog)).toBe(false);
    });
});

describe('documentLocationError', () => {
    it('accepts a repo-relative path', () => {
        expect(documentLocationError('memory/agents-registry.md')).toBeNull();
    });

    it('accepts empty — the column is nullable and `url` may carry the link', () => {
        expect(documentLocationError('')).toBeNull();
        expect(documentLocationError(null)).toBeNull();
    });

    it('rejects a leading slash', () => {
        // documentHref interpolates this into a GitHub blob URL, where an absolute
        // path produces a double slash and a 404.
        expect(documentLocationError('/memory/foo.md')).toMatch(/no leading slash/);
    });

    it('rejects a .. segment', () => {
        expect(documentLocationError('memory/../../etc/passwd')).toMatch(/cannot be resolved/);
    });

    it('rejects embedded whitespace — the commonest silent typo', () => {
        expect(documentLocationError('memory/ foo.md')).toMatch(/whitespace/);
    });

    it('rejects over the column width, in characters', () => {
        expect(documentLocationError('a'.repeat(DOCUMENT_LOCATION_MAX + 1)))
            .toMatch(/Too long/);
        expect(documentLocationError('a'.repeat(DOCUMENT_LOCATION_MAX))).toBeNull();
    });
});

describe('documentUrlError guards a stored-href sink', () => {
    // `documentHref` returns `url` verbatim and the page renders it straight into
    // an anchor href. While the column was read-only that was inert — the only
    // writer was a seed. Making it editable turns it into a stored-script sink.
    it('rejects javascript:', () => {
        expect(documentUrlError('javascript:alert(1)')).toMatch(/Only http and https/);
    });

    it('rejects data:', () => {
        expect(documentUrlError('data:text/html;base64,PHNjcmlwdD4='))
            .toMatch(/Only http and https/);
    });

    it('rejects an unexpected novel scheme by DEFAULT, rather than blocklisting', () => {
        expect(documentUrlError('vbscript:msgbox(1)')).toMatch(/Only http and https/);
        expect(documentUrlError('file:///etc/passwd')).toMatch(/Only http and https/);
    });

    it('is not fooled by case or leading whitespace', () => {
        expect(documentUrlError('  JavaScript:alert(1)')).toMatch(/Only http and https/);
    });

    it('allows http and https', () => {
        expect(documentUrlError('https://github.com/x/y/blob/main/a.md')).toBeNull();
        expect(documentUrlError('http://example.test/a')).toBeNull();
    });

    it('allows a scheme-less relative path — same-origin and harmless', () => {
        expect(documentUrlError('/docs/a.html')).toBeNull();
    });

    it('allows empty — NULL is a real value that falls back to the blob URL', () => {
        expect(documentUrlError('')).toBeNull();
    });

    it('rejects over the column width', () => {
        expect(documentUrlError(`https://x.test/${'a'.repeat(DOCUMENT_URL_MAX)}`))
            .toMatch(/Too long/);
    });
});

describe('documentHref refuses a dangerous scheme AT THE RENDER BOUNDARY', () => {
    // documentUrlError guards this UI's writes, but it is not the only writer:
    // the MCP daemon's update_architecture_document accepts `url` with no scheme
    // check, and rows predate both. Rendering is where the harm happens — every
    // consumer feeds this into an anchor href, and React does not sanitize a
    // javascript: URL, it only warns in development.
    const BLOB = 'https://github.com/BillWilliams79/DarwinAI-Config/blob/main/memory/a.md';

    it('falls back to the blob URL for javascript:, rather than returning it', () => {
        expect(documentHref({ url: 'javascript:alert(1)', location: 'memory/a.md' })).toBe(BLOB);
    });

    it('falls back for data: and file: too', () => {
        expect(documentHref({ url: 'data:text/html,<script>', location: 'memory/a.md' })).toBe(BLOB);
        expect(documentHref({ url: 'file:///etc/passwd', location: 'memory/a.md' })).toBe(BLOB);
    });

    it('is not fooled by case or leading whitespace', () => {
        expect(documentHref({ url: '  JaVaScRiPt:alert(1)', location: 'memory/a.md' })).toBe(BLOB);
    });

    it('FALLS THROUGH rather than going dead — one bad column must not remove the link', () => {
        // Returning null would silently strip the page's most-used affordance.
        expect(documentHref({ url: 'javascript:alert(1)', location: 'memory/a.md' }))
            .not.toBeNull();
    });

    it('returns null only when there is genuinely nowhere to go', () => {
        expect(documentHref({ url: 'javascript:alert(1)', location: null })).toBeNull();
        expect(documentHref({})).toBeNull();
        expect(documentHref(null)).toBeNull();
    });

    it('still honours a legitimate stored url', () => {
        expect(documentHref({ url: 'https://example.test/a', location: 'memory/a.md' }))
            .toBe('https://example.test/a');
        expect(documentHref({ url: 'http://example.test/a', location: 'memory/a.md' }))
            .toBe('http://example.test/a');
    });

    it('allows a protocol-relative and a root-relative url', () => {
        expect(documentHref({ url: '//example.test/a' })).toBe('//example.test/a');
        expect(documentHref({ url: '/docs/a.html' })).toBe('/docs/a.html');
    });

    it('constructs the blob URL from location when url is absent', () => {
        expect(documentHref({ location: 'memory/a.md' })).toBe(BLOB);
    });
});

// ---------------------------------------------------------------------------
// documentTarget (req #3101, § 2) — what the row POINTS AT, as opposed to what
// it contains, which is nothing. This is the derivation behind the card's
// "Points at" row, and the whole point of it is that a registration is not a
// file: nothing here checks, fetches or resolves anything.
// ---------------------------------------------------------------------------

describe('documentTarget distinguishes a path from a URL from nothing', () => {
    const BLOB = 'https://github.com/BillWilliams79/DarwinAI-Config/blob/main/memory/a.md';

    it('reports a path-only row, and says the path is what opens', () => {
        const t = documentTarget({ location: 'memory/a.md', url: null });
        expect(t).toMatchObject({
            hasLocation: true, hasUrl: false, urlUsable: false, urlRejected: false,
            opens: 'path', href: BLOB, blobHref: BLOB,
        });
    });

    it('reports a url-only row, and says the url is what opens', () => {
        const t = documentTarget({ location: null, url: 'https://example.test/a' });
        expect(t).toMatchObject({
            hasLocation: false, hasUrl: true, urlUsable: true, urlRejected: false,
            opens: 'url', href: 'https://example.test/a', blobHref: null,
        });
    });

    it('reports BOTH when both are present, and url wins — matching documentHref', () => {
        const doc = { location: 'memory/a.md', url: 'https://example.test/a' };
        const t = documentTarget(doc);
        expect(t.hasLocation).toBe(true);
        expect(t.hasUrl).toBe(true);
        expect(t.opens).toBe('url');
        // The two must never disagree: `documentTarget` decides which chip is
        // drawn as the resolved one and `documentHref` decides where the button
        // actually goes, so a divergence would mislabel rather than fail.
        expect(t.href).toBe(documentHref(doc));
        // The blob URL is still reported, because the path is still registered
        // and an agent reads THAT, not the url.
        expect(t.blobHref).toBe(BLOB);
    });

    it('SURFACES a url the scheme guard rejected, which documentHref swallows', () => {
        // The one genuinely new fact. `documentHref` falls through to the blob URL
        // so the row keeps a working link — silently, so a row with an unusable
        // url column looked identical to a row with no url at all.
        const doc = { location: 'memory/a.md', url: 'javascript:alert(1)' };
        const t = documentTarget(doc);
        expect(t.hasUrl).toBe(true);
        expect(t.urlUsable).toBe(false);
        expect(t.urlRejected).toBe(true);
        expect(t.opens).toBe('path');
        expect(t.href).toBe(BLOB);
        expect(t.href).toBe(documentHref(doc));
    });

    it('reports a row that points at NOTHING rather than pretending it opens', () => {
        expect(documentTarget({ location: null, url: null })).toMatchObject({
            hasLocation: false, hasUrl: false, opens: null, href: null, blobHref: null,
        });
        expect(documentTarget({ location: null, url: 'javascript:alert(1)' }))
            .toMatchObject({ urlRejected: true, opens: null, href: null });
        expect(documentTarget(null)).toMatchObject({ opens: null, href: null });
    });

    it('treats whitespace-only columns as absent, matching what the fields store', () => {
        // The card writes NULL rather than '' for a cleared nullable column, but
        // MCP-written rows have not been past that normalizer.
        expect(documentTarget({ location: '   ', url: '  ' })).toMatchObject({
            hasLocation: false, hasUrl: false, opens: null,
        });
    });

    it('trims a padded location into the blob URL rather than embedding the padding', () => {
        expect(documentBlobHref('  memory/a.md  ')).toBe(BLOB);
        expect(documentBlobHref('')).toBeNull();
        expect(documentBlobHref(null)).toBeNull();
    });
});

describe('documentNotesError', () => {
    it('accepts up to the column width and rejects beyond it', () => {
        expect(documentNotesError('a'.repeat(DOCUMENT_NOTES_MAX))).toBeNull();
        expect(documentNotesError('a'.repeat(DOCUMENT_NOTES_MAX + 1))).toMatch(/Too long/);
    });

    it('accepts empty', () => {
        expect(documentNotesError('')).toBeNull();
    });
});

describe('docTypeError is the ONLY guard on doc_type', () => {
    // The column is VARCHAR(16), not an ENUM, and VALID_DOC_TYPES lives only in
    // the MCP daemon — which a browser write never passes through. A typo would
    // store fine and render as an ordinary chip.
    it('accepts the three registry types', () => {
        expect(docTypeError('markdown')).toBeNull();
        expect(docTypeError('html')).toBeNull();
        expect(docTypeError('text')).toBeNull();
    });

    it('rejects a near-miss typo', () => {
        expect(docTypeError('mrkdown')).toMatch(/Unknown document type/);
    });

    it('rejects empty and undefined', () => {
        expect(docTypeError('')).toMatch(/Unknown document type/);
        expect(docTypeError(undefined)).toMatch(/Unknown document type/);
    });
});

describe('documentOwnerLink', () => {
    it('finds the link carrying `owned` among several roles', () => {
        const links = [
            { agent_fk: 1, relationship: 'referenced' },
            { agent_fk: 2, relationship: 'owned,autoload' },
        ];
        expect(documentOwnerLink(links).agent_fk).toBe(2);
    });

    it('returns null for a genuinely unowned document', () => {
        expect(documentOwnerLink([{ agent_fk: 1, relationship: 'referenced' }])).toBeNull();
    });

    it('returns null for a link whose SET was silently emptied', () => {
        // The '' corruption state. It must read as unowned rather than as owned,
        // because that is what the database actually holds.
        expect(documentOwnerLink([{ agent_fk: 1, relationship: '' }])).toBeNull();
    });
});

describe('nextDocumentSortOrder', () => {
    const links = new Map([[7, [{ sort_order: 1 }, { sort_order: 4 }]]]);

    it('is max + 1', () => {
        expect(nextDocumentSortOrder(7, links)).toBe(5);
    });

    it('is 1-indexed for an agent with no links yet', () => {
        expect(nextDocumentSortOrder(99, links)).toBe(1);
    });

    it('ignores NULL slots rather than treating them as zero', () => {
        const withNulls = new Map([[7, [{ sort_order: null }, { sort_order: 2 }]]]);
        expect(nextDocumentSortOrder(7, withNulls)).toBe(3);
    });

    it('is 1 when every stored slot is NULL', () => {
        expect(nextDocumentSortOrder(7, new Map([[7, [{ sort_order: null }]]]))).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// planOwnerTransfer — the only multi-write action on the page.
// ---------------------------------------------------------------------------

describe('planOwnerTransfer', () => {
    const owner = {
        agent_fk: 2, document_fk: 10, relationship: 'owned,autoload',
        notes: 'why agent 2 owns it', sort_order: 3,
    };
    const ownerOnly = {
        agent_fk: 2, document_fk: 10, relationship: 'owned',
        notes: 'sole role', sort_order: 3,
    };

    it('releases BEFORE it claims — the unique key forces the order', () => {
        // uq_agent_documents_owner rejects the incoming claim while the incumbent
        // still holds `owned`, so a claim-first plan could never commit.
        const steps = planOwnerTransfer({
            documentId: 10, fromLink: owner, toLink: null, toAgentId: 5,
        });
        expect(steps).toHaveLength(2);
        expect(steps[0].agent_fk).toBe(2);      // release
        expect(steps[1].agent_fk).toBe(5);      // claim
    });

    it('DEMOTES a multi-role incumbent rather than unlinking it', () => {
        // An owned,autoload owner very likely still reads the file at boot.
        // Dropping the link would be a second change nobody asked for.
        const [release] = planOwnerTransfer({
            documentId: 10, fromLink: owner, toLink: null, toAgentId: 5,
        });
        expect(release.next).not.toBeNull();
        expect(release.next.relationship).toBe('autoload');
    });

    it('PRESERVES notes and sort_order verbatim on the demoted link', () => {
        // There is no PUT on this table, so the release is a DELETE and a fresh
        // INSERT. An INSERT that omits these does not leave them alone — it writes
        // NULL over them. This is the quietest way to lose data on the page.
        const [release] = planOwnerTransfer({
            documentId: 10, fromLink: owner, toLink: null, toAgentId: 5,
        });
        expect(release.next.notes).toBe('why agent 2 owns it');
        expect(release.next.sort_order).toBe(3);
    });

    it('parks an owner-ONLY link at referenced when keepOutgoing is true', () => {
        // Its notes die with the link otherwise, and 87 of 100 live links carry one.
        const [release] = planOwnerTransfer({
            documentId: 10, fromLink: ownerOnly, toLink: null, toAgentId: 5,
            keepOutgoing: true,
        });
        expect(release.next.relationship).toBe('referenced');
        expect(release.next.notes).toBe('sole role');
        expect(release.next.sort_order).toBe(3);
    });

    it('removes an owner-ONLY link entirely when keepOutgoing is false', () => {
        const [release] = planOwnerTransfer({
            documentId: 10, fromLink: ownerOnly, toLink: null, toAgentId: 5,
            keepOutgoing: false,
        });
        expect(release.next).toBeNull();
        expect(release.prev).toBe(ownerOnly);   // still rollback-able
    });

    it('REPLACES referenced when claiming, rather than stacking with it', () => {
        // The defect this pins: a blind union produced 'owned,referenced', which
        // relationshipSetError blocks — so the planner built a role set the
        // codebase itself rejects. All 32 live non-owner links are plain
        // `referenced`, making this the commonest transfer target of all.
        const toLink = {
            agent_fk: 5, document_fk: 10, relationship: 'referenced',
            notes: 'agent 5 consults it', sort_order: 9,
        };
        const steps = planOwnerTransfer({
            documentId: 10, fromLink: owner, toLink, toAgentId: 5,
        });
        const claim = steps[1];
        expect(claim.next.relationship).toBe('owned');
        expect(claim.next.notes).toBe('agent 5 consults it');
        expect(claim.next.sort_order).toBe(9);
    });

    it('MERGES autoload and curated when claiming — they are orthogonal to ownership', () => {
        const auto = {
            agent_fk: 5, document_fk: 10, relationship: 'autoload', notes: null, sort_order: 2,
        };
        expect(planOwnerTransfer({
            documentId: 10, fromLink: null, toLink: auto, toAgentId: 5,
        })[0].next.relationship).toBe('owned,autoload');

        const curated = {
            agent_fk: 5, document_fk: 10, relationship: 'curated,referenced',
            notes: null, sort_order: 2,
        };
        expect(planOwnerTransfer({
            documentId: 10, fromLink: null, toLink: curated, toAgentId: 5,
        })[0].next.relationship).toBe('owned,curated');
    });

    it('creates a bare `owned` link when the incoming agent has none', () => {
        const steps = planOwnerTransfer({
            documentId: 10, fromLink: null, toLink: null, toAgentId: 5,
        });
        expect(steps).toHaveLength(1);
        expect(steps[0].prev).toBeNull();
        expect(steps[0].next.relationship).toBe('owned');
        expect(steps[0].next.document_fk).toBe(10);
    });

    it('plans a RELEASE with no successor as a single step', () => {
        const steps = planOwnerTransfer({
            documentId: 10, fromLink: owner, toLink: null, toAgentId: null,
        });
        expect(steps).toHaveLength(1);
        expect(steps[0].next.relationship).toBe('autoload');
    });

    it('plans nothing at all when there is neither an incumbent nor a successor', () => {
        expect(planOwnerTransfer({ documentId: 10 })).toEqual([]);
    });

    // THE COMPOSITION TEST. This is the one that would have caught the
    // owned+referenced defect, and it is worth more than any individual case
    // above: it asserts the planner and the validator cannot disagree.
    it('never emits a role set its own validator would reject', () => {
        const incumbents = [null, owner, ownerOnly, {
            agent_fk: 2, document_fk: 10, relationship: 'owned,curated',
            notes: null, sort_order: 1,
        }];
        const incoming = [null,
            { agent_fk: 5, document_fk: 10, relationship: 'referenced', notes: null, sort_order: 1 },
            { agent_fk: 5, document_fk: 10, relationship: 'autoload', notes: null, sort_order: 1 },
            { agent_fk: 5, document_fk: 10, relationship: 'curated', notes: null, sort_order: 1 },
            { agent_fk: 5, document_fk: 10, relationship: 'autoload,referenced', notes: null, sort_order: 1 },
        ];

        for (const fromLink of incumbents) {
            for (const toLink of incoming) {
                for (const toAgentId of [null, 5]) {
                    for (const keepOutgoing of [true, false]) {
                        const steps = planOwnerTransfer({
                            documentId: 10, fromLink, toLink, toAgentId, keepOutgoing,
                        });
                        for (const step of steps) {
                            if (!step.next) continue;   // an unlink has no set to validate
                            const roles = parseRoles(step.next.relationship);
                            expect(
                                relationshipSetError(roles),
                                `rejected set "${step.next.relationship}" from `
                                + `from=${fromLink?.relationship ?? 'none'} `
                                + `to=${toLink?.relationship ?? 'none'} `
                                + `toAgentId=${toAgentId} keepOutgoing=${keepOutgoing}`,
                            ).toBeNull();
                            // And it must never be the silently-empty SET.
                            expect(step.next.relationship).not.toBe('');
                        }
                    }
                }
            }
        }
    });

    it('produces at most ONE owned link across the whole plan', () => {
        // Two `owned` steps would be rejected by the unique key at the second one,
        // leaving the plan half-applied.
        const steps = planOwnerTransfer({
            documentId: 10, fromLink: owner, toLink: null, toAgentId: 5,
        });
        const ownedSteps = steps.filter(
            s => s.next && parseRoles(s.next.relationship).includes('owned'));
        expect(ownedSteps).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// restErrorMessage — the document keys.
//
// Lambda-Rest answers a constraint violation with HTTP 409 and a structured
// `{ error, errno, constraint, table, message }` body (req #3059, landed on
// origin/master while this branch was in flight — this block was rewritten
// against that contract during the merge; it originally regexed pymysql prose
// off a synthetic HTTP 500, which no longer reflects what the API returns).
// `conflict()` mirrors the shared helper in agentRegistryUtils.test.js.
// ---------------------------------------------------------------------------

describe('restErrorMessage — the document keys (req #3051)', () => {
    const conflict = (errno, constraint, table) => ({
        httpStatus: {
            httpStatus: 409,
            httpMessage: `HTTP PUT SQL FAILED: ${errno} ...`,
            httpDetail: { error: 'CONFLICT', errno, constraint, table,
                message: `HTTP PUT SQL FAILED: ${errno} ...` },
        },
    });

    it('maps a duplicate document name and mentions the closed-row trap', () => {
        const err = conflict(1062, 'uq_architecture_documents_name', 'architecture_documents');
        expect(restErrorMessage(err, 'fallback')).toMatch(/already exists/);
        expect(restErrorMessage(err, 'fallback')).toMatch(/may be closed/);
    });

    it('maps a second ownership claim to advice, not to a raw constraint name', () => {
        const err = conflict(1062, 'uq_agent_documents_owner', 'agent_documents');
        expect(restErrorMessage(err, 'fallback')).toMatch(/already owns this document/);
    });

    it('maps a duplicate document link', () => {
        const err = conflict(1062, 'PRIMARY', 'agent_documents');
        expect(restErrorMessage(err, 'fallback')).toMatch(/already linked to this agent/);
    });

    // THE COLLISION THIS PINS: `constraint` arrives UNQUALIFIED — every table has
    // a `PRIMARY` — so agent_instructions.PRIMARY and agent_documents.PRIMARY are
    // indistinguishable without also reading `table`. Without that check this
    // would report the wrong entity: telling a user about an instruction when a
    // document link failed, or the reverse.
    it('does not confuse the two junctions\' PRIMARY keys', () => {
        const docErr = conflict(1062, 'PRIMARY', 'agent_documents');
        const instrErr = conflict(1062, 'PRIMARY', 'agent_instructions');

        expect(restErrorMessage(docErr, 'fallback')).toMatch(/document/);
        expect(restErrorMessage(docErr, 'fallback')).not.toMatch(/instruction/);
        expect(restErrorMessage(instrErr, 'fallback')).toMatch(/instruction/);
        expect(restErrorMessage(instrErr, 'fallback')).not.toMatch(/document/);
    });

    it('still maps the instruction keys it mapped before', () => {
        expect(restErrorMessage(
            conflict(1062, 'uq_instructions_name', 'instructions'), 'fallback'))
            .toMatch(/already in use/);
    });

    it('mentions documents in the foreign-key message now that this page can hit it', () => {
        expect(restErrorMessage(conflict(1452, 'agent_documents_ibfk_1', 'agent_documents'),
            'fallback')).toMatch(/document/);
        expect(restErrorMessage(conflict(1451, 'agent_documents_ibfk_2', 'agent_documents'),
            'fallback')).toMatch(/document/);
    });

    it('falls back for a 409 carrying an errno it has no wording for', () => {
        expect(restErrorMessage(conflict(1062, 'uq_something_else', 'architecture_documents'),
            'fb')).toBe('fb');
    });

    it('falls back for a 500 — the database really is broken, not merely conflicted', () => {
        // The whole point of the 409/500 split: a 500 must never render "that
        // name is taken", however duplicate-shaped its message looks.
        expect(restErrorMessage({ httpStatus: {
            httpStatus: 500,
            httpMessage: "HTTP PUT SQL FAILED: 1062 Duplicate entry 'x' for key "
                + "'architecture_documents.uq_architecture_documents_name'",
            httpDetail: null,
        } }, 'fb')).toBe('fb');
    });

    it('falls back on a 409 with no detail object rather than throwing', () => {
        expect(restErrorMessage(
            { httpStatus: { httpStatus: 409, httpMessage: 'CONFLICT', httpDetail: null } },
            'fb')).toBe('fb');
    });

    it('falls back when the thrown value has no status at all', () => {
        expect(restErrorMessage(new Error('boom'), 'fb')).toBe('fb');
        expect(restErrorMessage(undefined, 'fb')).toBe('fb');
    });
});
