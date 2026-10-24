// @vitest-environment jsdom
//
// Req #3813 — where a requirement was filed from: what it reads, what it never
// carries (credentials), the surface's deep-link form and the size cap. Since
// req #3815 it is the `filedFrom` category of the debug capture (filedFromNow).

import { describe, it, expect, beforeEach } from 'vitest';

import {
    FILED_FROM_MAX_CHARS, POINTED_AT_REASONS, POINTED_TEXT_MAX, REDACTED, captureFiledFrom, pointedAtNow, visibleText, cleanQuery, filedFromNow, queryObject, redact,
    registerPageOptions, routeIds, surfaceOf, viewState,
} from '../filedFromContext';
import { topologyPageOptions } from '../../Systems/SystemsPage2';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl';

describe('filedFromContext (req #3813)', () => {
    beforeEach(() => localStorage.clear());

    it('the Surface line is path?query without the filer parameter or credentials', () => {
        expect(surfaceOf('/systems2', '?opt=tpu8t-datacenter-3d&filer=new')).toBe('/systems2?opt=tpu8t-datacenter-3d');
        expect(surfaceOf('/swarm/pipeline/2', '?filer=1&mode=plan')).toBe('/swarm/pipeline/2?mode=plan');
        expect(surfaceOf('/maps', '?code=abc&id_token=x&view=cards')).toBe('/maps?view=cards');
        expect(surfaceOf('/maps', '')).toBe('/maps');
        // A page's own surface wins.
        expect(surfaceOf('/systems2', '?opt=a', '/systems2?opt=b')).toBe('/systems2?opt=b');
    });

    it('never carries a credential: names dropped, JWT-shaped values replaced', () => {
        expect(cleanQuery('?a=1&access_token=x&state=s&b=2')).toBe('?a=1&b=2');
        expect(cleanQuery('#id_token=x', '#')).toBe('');
        expect(queryObject('?tag=a&tag=b&refreshToken=z')).toEqual({ tag: ['a', 'b'] });
        expect(redact({ idToken: 'x', nested: { password: 'p', ok: JWT, keep: 1 }, list: [JWT, 'fine'] }))
            .toEqual({ nested: { ok: REDACTED, keep: 1 }, list: [REDACTED, 'fine'] });
    });

    it('view state: the owning app\'s allowlisted keys only, persist envelope unwrapped', () => {
        localStorage.setItem('darwin-swarm-view', 'table');
        localStorage.setItem('darwin_show_closed', JSON.stringify({ state: { met: true, authoring: false }, version: 2 }));
        localStorage.setItem('darwin-swarm-pipelines-place', JSON.stringify({ idToken: JWT, page: 3 }));
        localStorage.setItem('darwin-profile', JSON.stringify({ userName: 'u' }));
        localStorage.setItem('CognitoIdentityServiceProvider.abc.idToken', JWT);
        localStorage.setItem('pkce_code_verifier', 'v');
        localStorage.setItem('topology.lastOpt', 'H');
        localStorage.setItem('darwin-plan-unseated-box-size', 'x'.repeat(5000));
        expect(viewState('swarm')).toEqual({
            'darwin-plan-unseated-box-size': '[5000 chars — not copied]',
            'darwin-swarm-pipelines-place': { page: 3 },
            'darwin-swarm-view': 'table',
            darwin_show_closed: { met: true, authoring: false },
        });
        expect(viewState('systems')).toEqual({ 'topology.lastOpt': 'H' });
        expect(viewState(null)).toEqual({});
    });

    it('record ids come from the path', () => {
        expect(routeIds('/swarm/pipeline/2')).toEqual({ pipeline: 2 });
        expect(routeIds('/swarm/requirement/3813/edit')).toEqual({ requirement: 3813 });
        expect(routeIds('/maps')).toEqual({});
    });

    it('holds the size cap: view state first (names kept), then the popups, then the URL alone', () => {
        const args = (search, store) => ({ location: { pathname: '/systems2', search, hash: '' }, profile: {},
            database: 'darwin', theme: null, popupId: 'requirement-filer', popupStore: { open: true, dock: null } });
        for (let i = 0; i < 40; i++) localStorage.setItem(`topology.k${i}`, 'v'.repeat(1900));
        const capped = filedFromNow(args('?opt=H'));
        expect(JSON.stringify(capped).length).toBeLessThanOrEqual(FILED_FROM_MAX_CHARS);
        const vs = capped.options.viewState;
        expect(Object.keys(vs)).toHaveLength(40);
        expect(Object.values(vs).filter(v => /over the size cap/.test(v)).length).toBeGreaterThan(0);
        expect(Object.values(vs).filter(v => v === 'v'.repeat(1900)).length).toBeGreaterThan(0);
        localStorage.clear();

        // A query too big for anything: the surface and URL alone, clipped.
        const huge = filedFromNow({ ...args(`?ids=${'1,'.repeat(9000)}`), location: { pathname: '/swarm', search: `?ids=${'1,'.repeat(9000)}`, hash: '' } });
        expect(JSON.stringify(huge).length).toBeLessThanOrEqual(FILED_FROM_MAX_CHARS);
        expect(huge.surface.startsWith('/swarm?ids=1,1,')).toBe(true);
        expect(huge.omitted).toMatch(/size cap/);
        expect(huge.options).toBeUndefined();
    });

    it('a JWT under any name — query value, bare hash, a page\'s own surface — never reaches the block', () => {
        const unregister = registerPageOptions(() => ({ options: {}, surface: `/systems2?opt=H&code=abc&state=xyz&t=${JWT}` }));
        const ctx = captureFiledFrom({ location: { pathname: '/maps', search: `?view=cards&invite=${JWT}`, hash: `#${JWT}` },
            profile: {}, database: 'darwin', theme: null, popupId: 'requirement-filer', popupStore: null });
        unregister();
        const text = JSON.stringify(ctx);
        expect(text).not.toContain('eyJ');
        expect(text).not.toMatch(/code=abc|state=xyz/);
        expect(ctx.surface).toBe('/systems2?opt=H');
        expect(ctx.url.full).toBe('/maps?view=cards');
    });

    it('a capture that throws still records the URL and says so', () => {
        const ctx = filedFromNow({ location: { pathname: '/maps', search: '?a=1&filer=1', hash: '' },
            get profile() { throw new Error('boom'); } });
        expect(ctx.surface).toBe('/maps?a=1');
        expect(ctx.url.full).toBe('/maps?a=1');
        expect(ctx.captureError).toBe('boom');
    });

    it('the topology page reports the view on screen, not the one in the URL', () => {
        const doc = document.implementation.createHTMLDocument('t');
        doc.body.className = 'dark opt-tpu8t-datacenter-3d';
        doc.body.innerHTML = '<h1 id="main-title">TPU v8t Data Center</h1>';
        const frame = { contentDocument: doc, contentWindow: { location: { search: '?opt=H&filer=1' } } };
        localStorage.setItem('topology.lastOpt', 'H');
        expect(topologyPageOptions(frame, '?opt=H&filer=1&layout=virgo')).toEqual({
            options: { opt: 'tpu8t-datacenter-3d', title: 'TPU v8t Data Center', frameQuery: '?opt=H&filer=1', storedOpt: 'H' },
            surface: '/systems2?opt=tpu8t-datacenter-3d&layout=virgo',
        });
        expect(topologyPageOptions(null, '?opt=H&filer=1').surface).toBe('/systems2?opt=H');
    });

    it('the Virgo Simple view records its live Traffic pattern and step, not the URL\'s (req #3803)', () => {
        const doc = document.implementation.createHTMLDocument('t');
        doc.body.className = 'opt-tpu8t-virgo-simple';
        doc.body.dataset.vsTraffic = 'adaptive';
        doc.body.dataset.vsStep = '1';
        const frame = { contentDocument: doc, contentWindow: { location: { search: '' } } };
        const stale = '?opt=tpu8t-virgo-simple&traffic=incast&step=3&filer=1';
        expect(topologyPageOptions(frame, stale).surface).toBe('/systems2?opt=tpu8t-virgo-simple&traffic=adaptive&step=1');
        delete doc.body.dataset.vsTraffic;
        delete doc.body.dataset.vsStep;
        expect(topologyPageOptions(frame, stale).surface).toBe('/systems2?opt=tpu8t-virgo-simple');
        doc.body.className = 'opt-H';   // another view: a stale pattern on <body> is not this view's
        doc.body.dataset.vsTraffic = 'adaptive';
        expect(topologyPageOptions(frame, stale).surface).toBe('/systems2?opt=H');
    });
});

describe('what the filer points at (req #3829)', () => {
    // jsdom lays nothing out: each element's rect is given, and elementsFromPoint
    // answers from those rects, topmost (last appended) first.
    const rects = new Map();
    const place = (el, x, y, w, h) => {
        rects.set(el, { x, y, w, h });
        el.getBoundingClientRect = () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
        return el;
    };
    beforeEach(() => {
        document.body.innerHTML = '';
        rects.clear();
        document.elementsFromPoint = (px, py) => [...rects.entries()]
            .filter(([, r]) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)
            .map(([el]) => el).reverse();
    });
    const filer = (x, y, w, h) => ({ id: 'requirement-filer', racked: false, rect: { x, y, w, h } });

    function swarmPage() {
        document.body.innerHTML = `
            <div data-testid="category-card-862">
              <div data-testid="requirement-3829" role="listitem">
                <span>3829</span><span>SR</span>
                <div data-testid="req-title-3829"><textarea name="title">Requirement Filer: record the page</textarea>
                  <textarea aria-hidden="true" readonly>Requirement Filer: record the page</textarea></div>
              </div>
            </div>
            <div data-rack-id="requirement-filer" data-testid="requirement-filer"><span>Create</span></div>`;
        const card = place(document.querySelector('[data-testid="category-card-862"]'), 0, 0, 600, 400);
        place(document.querySelector('[data-testid="requirement-3829"]'), 10, 50, 580, 40);
        place(document.querySelector('[data-testid="req-title-3829"]'), 150, 52, 430, 36);
        const ta = document.querySelector('textarea[name="title"]');
        ta.value = 'Requirement Filer: record the page';
        place(ta, 150, 52, 430, 36);
        place(document.querySelector('[data-rack-id]'), 120, 50, 140, 40);
        place(document.querySelector('[data-rack-id] span'), 130, 55, 50, 20);
        return { card, ta };
    }

    it('ACCEPTANCE: over a requirement card it names the card — testid path, title text, rect — skipping the popup', () => {
        swarmPage();
        const { pointedAt, pointedAtReason } = pointedAtNow(filer(120, 50, 140, 40));
        expect(pointedAtReason).toBeUndefined();
        expect(pointedAt[0]).toMatchObject({
            points: ['centre', 'top-right', 'bottom-right'], tag: 'div', hit: 'textarea',
            testidPath: ['req-title-3829', 'requirement-3829', 'category-card-862'],
            field: { tag: 'textarea', name: 'title', copied: true },
            text: 'Requirement Filer: record the page', rect: { x: 150, y: 52, w: 430, h: 36 },
        });
        // The left corners land on the row itself, outside the title field.
        expect(pointedAt[1]).toMatchObject({ points: ['top-left', 'bottom-left'], role: 'listitem',
            testidPath: ['requirement-3829', 'category-card-862'], text: '3829 SR Requirement Filer: record the page',
            rect: { x: 10, y: 50, w: 580, h: 40 } });
        expect(JSON.stringify(pointedAt)).not.toContain('requirement-filer');
    });

    it('the field being typed in, and a password field, are named and never copied', () => {
        const { ta } = swarmPage();
        ta.focus();
        const { pointedAt } = pointedAtNow(filer(120, 50, 140, 40));
        expect(pointedAt[0].field).toEqual({ tag: 'textarea', name: 'title', copied: false });
        expect(pointedAt[0].text).toBe('');
        expect(JSON.stringify(pointedAt)).not.toContain('record the page');
        // Focus already moved to the filer by the click: the field focused as the press began still counts.
        ta.blur();
        const atPress = pointedAtNow(filer(120, 50, 140, 40), document, ta).pointedAt;
        expect(atPress[0].field.copied).toBe(false);
        expect(JSON.stringify(atPress)).not.toContain('record the page');
        expect(pointedAtNow(filer(120, 50, 140, 40)).pointedAt[0].field.copied).toBe(true);

        document.body.innerHTML = '<form data-testid="login"><label>Password</label><input type="password" name="pw"><input name="apiKey"><input name="note"></form>';
        const form = document.querySelector('form');
        form.querySelector('[name="pw"]').value = 'hunter2';
        form.querySelector('[name="apiKey"]').value = 'k-123';
        form.querySelector('[name="note"]').value = 'kept';
        expect(visibleText(form)).toBe('Password kept');

        // A credential named only by its <label>; a focused editing host whose child carries the testid.
        document.body.innerHTML = '<div data-testid="f"><label for="k">API key</label><input id="k"></div>'
            + '<div contenteditable="true" id="ed"><p data-testid="para">draft words</p></div>';
        document.getElementById('k').value = 'k-123';
        expect(visibleText(document.querySelector('[data-testid="f"]'))).toBe('API key');
        const ed = document.getElementById('ed');
        const para = document.querySelector('[data-testid="para"]');
        if (!('isContentEditable' in para) || !para.isContentEditable) {
            for (const el of [ed, para]) Object.defineProperty(el, 'isContentEditable', { value: true });
        }
        ed.focus();
        expect(visibleText(para)).toBe('');
    });

    it('racked points at nothing, with the reason; so does a filer over nothing, with its own', () => {
        swarmPage();
        expect(pointedAtNow({ id: 'requirement-filer', racked: true, rect: { x: 120, y: 50, w: 140, h: 40 } }))
            .toEqual({ pointedAt: null, pointedAtReason: POINTED_AT_REASONS.racked });
        expect(pointedAtNow(null)).toEqual({ pointedAt: null, pointedAtReason: POINTED_AT_REASONS.notDrawn });
        expect(pointedAtNow(filer(700, 500, 100, 40))).toEqual({ pointedAt: [], pointedAtReason: POINTED_AT_REASONS.nothing });
    });

    it('text is clipped and token-shaped text never kept', () => {
        document.body.innerHTML = `<div data-testid="note"><p>${'word '.repeat(100)}</p></div><div data-testid="t">${JWT}</div>`;
        expect(visibleText(document.querySelector('[data-testid="note"]')).length).toBe(POINTED_TEXT_MAX + 1);
        expect(visibleText(document.querySelector('[data-testid="t"]'))).toBe(REDACTED);
    });

    it('over the size cap, it keeps the first element and counts the rest', () => {
        // Other popups' ids are what is left after the trims before it: grow them until
        // only dropping pointedAt[1] fits the cap.
        const press = () => filedFromNow({ location: { pathname: '/swarm', search: '', hash: '' }, profile: {},
            database: 'darwin_dev', theme: null, popupId: 'requirement-filer', popupStore: { open: true, dock: null } });
        let hit = null;
        for (let n = 100; n <= 160 && !hit; n++) {
            swarmPage();
            document.body.insertAdjacentHTML('beforeend', Array.from({ length: n },
                (_, i) => `<div data-rack-id="${String(i).padStart(98, 'p')}"></div>`).join(''));
            const ctx = press();
            expect(JSON.stringify(ctx).length).toBeLessThanOrEqual(FILED_FROM_MAX_CHARS);
            if (ctx.pointedAtOmitted) hit = ctx;
            else if (ctx.omitted) {
                expect(ctx.pointedAt).toBeNull();
                expect(ctx.pointedAtReason).toBe(POINTED_AT_REASONS.overCap);
                break;
            }
        }
        expect(hit).not.toBeNull();
        expect(hit.pointedAt).toHaveLength(1);
        expect(hit.pointedAtOmitted).toBe(1);
        expect(hit.pointedAt[0].testidPath[0]).toBe('req-title-3829');
    });

    it('rides in the capture as filedFrom.pointedAt', () => {
        swarmPage();
        const ctx = captureFiledFrom({ location: { pathname: '/swarm', search: '', hash: '' }, profile: {},
            database: 'darwin_dev', theme: null, popupId: 'requirement-filer', popupStore: { open: true, dock: null } });
        expect(ctx.popup.rect).toEqual({ x: 120, y: 50, w: 140, h: 40 });
        expect(ctx.pointedAt[0].testidPath[0]).toBe('req-title-3829');
    });
});
