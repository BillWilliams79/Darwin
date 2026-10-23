// @vitest-environment jsdom
//
// Req #3661 — a requirement's title edited in place on its row. Pinned here:
// the layout tells the editor where the title column is (the same hanging
// indent its wrap honours), the editor box is derived from what the renderer
// drew (line 1 shifted past packed pills and shortened to the layout's own
// characters), and the wrapping editor commits / cancels like the name editor.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import {
    computePlanLayout, wrapReqText, reqHangChars, REQ_MIN_HANG_CHARS, CARD_SEP_CHARS,
} from '../pipelinePlanLayout';
import {
    reqTitleEditorBox, updateRequirementTitle, titleLineStarts, prevCharIndex,
    wordStartBefore, wordEndAfter,
} from '../planReqTitleEdit';
import PlanInPlaceTitleArea from '../PlanInPlaceTitleArea';

vi.mock('../../../RestApi/RestApi', () => ({ default: vi.fn() }));
import call_rest_api from '../../../RestApi/RestApi';

afterEach(cleanup);

const row = (id, reqIds) => ({
    id, initiative: 'E', initiativeId: 1, title: `Epic ${id}`, reqIds, depIds: [], state: 'pending',
});

describe('layout — the title column (req #3661)', () => {
    it('reqHangChars is the hang wrapReqText honours', () => {
        expect(reqHangChars(28, 7)).toBe(7);
        expect(reqHangChars(10, 10 - REQ_MIN_HANG_CHARS + 1)).toBe(0);
        const long = '3661 - ' + 'word '.repeat(20);
        const lines = wrapReqText(long, 28, 3, 7);
        expect(lines[1].startsWith(' '.repeat(reqHangChars(28, 7)))).toBe(true);
    });

    it('every req label carries titleHang / titleStart / titleRoom', () => {
        const titles = new Map([[3661, 'edit requirement title in place'], [42, 'x']]);
        const pills = new Map([[3661, { terminal: { label: 'Terminal 6' } }]]);
        const layout = computePlanLayout([row(1, [3661, 42])], {
            epicLabel: 'title', reqLabel: 'title', reqTitles: titles, reqPills: pills,
        });
        const reqs = layout.labels.filter((l) => l.kind === 'req');
        expect(reqs).toHaveLength(2);
        const [withPill, bare] = reqs;
        expect(withPill.titleHang).toBe(4 + CARD_SEP_CHARS);
        // id + 3 + "Terminal 6" + the 3-space separator
        expect(withPill.titleStart).toBe(withPill.idText.length + CARD_SEP_CHARS);
        expect(withPill.titleStart).toBeGreaterThan(withPill.titleHang);
        expect(bare.titleHang).toBe(2 + CARD_SEP_CHARS);
        expect(bare.titleStart).toBe(bare.titleHang);
        // The room is the whole row less the hang — what continuation lines hold.
        const maxChars = withPill.titleRoom + withPill.titleHang;
        expect(bare.titleRoom + bare.titleHang).toBe(maxChars);
        expect(withPill.lines[0].length).toBeLessThanOrEqual(maxChars);
    });

    it('the layout re-wraps around a draft title (the editor follows the lines)', () => {
        const short = computePlanLayout([row(1, [7])], {
            epicLabel: 'title', reqLabel: 'title', reqTitles: new Map([[7, 'short']]),
        }).labels.find((l) => l.kind === 'req');
        const long = computePlanLayout([row(1, [7])], {
            epicLabel: 'title', reqLabel: 'title',
            reqTitles: new Map([[7, 'a much longer title that has to wrap onto more lines']]),
        }).labels.find((l) => l.kind === 'req');
        expect(short.lines).toHaveLength(1);
        expect(long.lines.length).toBeGreaterThan(1);
    });
});

describe('reqTitleEditorBox (req #3661)', () => {
    const t = { x: 10, y: 20, k: 2 };
    const base = {
        x: 100, y: 50, titleHang: 7, titleStart: 7, titleRoom: 21, lines: ['a', 'b'],
    };
    const measure = (s) => s.length * 8;    // an 8px mono advance

    it('a bare row: column at the hang, no indent, no slack', () => {
        const b = reqTitleEditorBox({
            label: base, firstLine: '3661 - edit', measure, chw: 9, t, lineH: 20, fontSize: 13,
        });
        expect(b.left).toBe((100 + 56) * 2 + 10);
        expect(b.top).toBe(50 * 2 + 20);
        expect(b.indent).toBe('0px');
        expect(b.width).toBe('22ch');
        expect(b.height).toBe(2 * 20 * 2);
        expect(b.fontSize).toBe(26);
        expect(b.lineHeight).toBe('40px');
    });

    it('a pill row: line 1 starts after the PACKED tail', () => {
        const label = { ...base, titleStart: 20 };    // 10 chars of pill + 3 blanks
        const firstLine = '3661   Terminal 6   ';
        // The renderer packed the tail 30px left of its reserved characters and
        // collapsed its blank lead to one space, which stands at index 19.
        const tail = { x: 100 + 17 * 8 - 30, text: ' ', start: 19 };
        const b = reqTitleEditorBox({
            label, firstLine, measure, chw: 9, tail, t, lineH: 20, fontSize: 13, insetTop: 4,
        });
        const colX = 100 + 7 * 8;
        const line1X = tail.x + 1 * 8;
        expect(b.indent).toBe(`${(line1X - colX) * 2}px`);
        expect(b.top).toBe(50 * 2 + 20 - 4);
    });

    // req #3683 — the renderer draws everything after the id `REQ_SEP_PULL`
    // left of the layout's characters; the editor's column and line 1 follow.
    it('a pulled row: column and line 1 both move left by the pull', () => {
        const label = { ...base, titleStart: 9 };
        const b = reqTitleEditorBox({
            label, firstLine: '3661   Terminal', measure, chw: 9, t, lineH: 20, fontSize: 13,
            pull: 4,
        });
        expect(b.left).toBe((100 - 4 + 56) * 2 + 10);
        expect(b.indent).toBe(`${2 * 8 * 2}px`);
    });

    it('falls back to the layout advance with no canvas to measure', () => {
        const b = reqTitleEditorBox({
            label: base, firstLine: '3661 - edit', measure: () => null, chw: 9, t,
            lineH: 20, fontSize: 13,
        });
        expect(b.left).toBe((100 + 63) * 2 + 10);
    });
});

describe('updateRequirementTitle (req #3661)', () => {
    it('PUTs one row and throws on a refusal', async () => {
        call_rest_api.mockResolvedValueOnce({ httpStatus: { httpStatus: 200 }, data: [] });
        await updateRequirementTitle('https://api/darwin_dev', 'tok', 5, 'New');
        expect(call_rest_api).toHaveBeenCalledWith('https://api/darwin_dev/requirements',
            'PUT', [{ id: 5, title: 'New' }], 'tok');
        call_rest_api.mockResolvedValueOnce({ httpStatus: { httpStatus: 500, httpMessage: 'x' } });
        await expect(updateRequirementTitle('u', 't', 5, 'N')).rejects.toThrow(/HTTP 500/);
    });
});

describe('titleLineStarts — the editor draws the layout\'s lines (req #3661)', () => {
    // The row a requirement is drawn as, rebuilt from the editor's runs: line 0
    // is the prefix + the separator + its run, later lines the hang + their run, each
    // run less the space its break consumed.
    const rebuild = (title, label) => {
        const starts = titleLineStarts(title, label);
        const pad = ' '.repeat(label.titleHang);
        return starts.map((s, i) => {
            const run = title.slice(s, starts[i + 1] ?? title.length);
            const body = i < starts.length - 1 ? run.replace(/ $/, '') : run;
            return i === 0 ? `${label.idText}${' '.repeat(CARD_SEP_CHARS)}${body}`.replace(/ $/, '')
                : pad + body;
        });
    };
    const words = ['a', 'to', 'edit', 'requirement', 'title', 'Pipeline', 'visualizer',
        'requirements.ai_model', '--dangerously-skip-permissions', 'x',
        'supercalifragilisticexpialidocious', 'in', 'place'];

    it('matches every line the layout draws, over generated titles, pills or not', () => {
        let seed = 11;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        let checked = 0;
        for (let n = 0; n < 400; n++) {
            const id = 3000 + Math.floor(rnd() * 999);
            const pills = rnd() < 0.4
                ? new Map([[id, { terminal: { label: 'Terminal 6' } }]]) : null;
            const title = Array.from({ length: 1 + Math.floor(rnd() * 12) },
                () => words[Math.floor(rnd() * words.length)]).join(' ');
            const label = computePlanLayout([row(1, [id])], {
                epicLabel: 'title', reqLabel: 'title',
                reqTitles: new Map([[id, title]]), reqPills: pills,
            }).labels.find((l) => l.kind === 'req');
            const drawn = rebuild(title, label);
            const maxChars = label.titleHang + label.titleRoom;
            // The layout's own lines, uncapped, are the reference; the layout
            // DRAWS the first two verbatim and truncates the third.
            const ref = wrapReqText(`${label.idText}${' '.repeat(CARD_SEP_CHARS)}${title}`, maxChars, 1e9,
                String(id).length + CARD_SEP_CHARS);
            expect(drawn).toEqual(ref);
            label.lines.slice(0, 2).forEach((ln, i) => {
                if (i < label.lines.length - 1) expect(drawn[i]).toBe(ln);
            });
            if (label.lines.length === drawn.length) expect(drawn).toEqual(label.lines);
            expect(titleLineStarts(title, label).reduce((acc, s, i, a) =>
                acc + title.slice(s, a[i + 1] ?? title.length), '')).toBe(title);
            checked++;
        }
        expect(checked).toBe(400);
    });

    it('a first word too long for line 1 leaves line 1 holding no title', () => {
        const label = { reqId: 3037, idText: '3037', titleHang: 6, titleRoom: 22 };
        const t = 'supercalifragilisticexpialidocious rest';
        expect(titleLineStarts(t, label)[0]).toBe(0);
        expect(titleLineStarts(t, label)[1]).toBe(0);
    });

    it('caret helpers', () => {
        expect(prevCharIndex('ab😀', 4)).toBe(2);
        expect(wordStartBefore('one two  ', 9)).toBe(4);
        expect(wordEndAfter('one two', 3)).toBe(7);
    });
});

describe('PlanInPlaceTitleArea (req #3661)', () => {
    const label = { reqId: 3661, idText: '3661', titleHang: 6, titleRoom: 22 };
    const mount = (props = {}) => {
        const onCommit = vi.fn();
        const onCancel = vi.fn();
        const onDraft = vi.fn();
        const utils = render(
            <PlanInPlaceTitleArea initial="edit requirement title in place" label={label}
                                  onCommit={onCommit} onCancel={onCancel} onDraft={onDraft}
                                  testId="ed" ariaLabel="Rename" lineHeight="20px"
                                  color="#fff" {...props} />);
        return { ...utils, el: utils.getByTestId('ed'), onCommit, onCancel, onDraft };
    };
    const lines = (el) => {
        const out = [''];
        el.childNodes.forEach((n) => {
            if (n.nodeName === 'BR') out.push('');
            else out[out.length - 1] += n.textContent;
        });
        return out;
    };
    const caretAt = (el, node, off) => {
        const r = document.createRange();
        r.setStart(node, off);
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
    };
    const input = (el, inputType, data = null) => {
        const ev = new InputEvent('beforeinput', {
            inputType, data, bubbles: true, cancelable: true,
        });
        el.dispatchEvent(ev);
        return ev;
    };

    it('opens on the title laid out as the row\'s lines, all selected', () => {
        const { el, getByTestId } = mount();
        // "3661  edit requirement title in place": 28-char line 1, 22-char hang.
        expect(lines(el)).toEqual(['edit requirement title ', 'in place']);
        expect(el.getAttribute('contenteditable')).toBe('plaintext-only');
        expect(getByTestId('ed-box').getAttribute('data-viz-chrome')).toBe('edit');
        expect(window.getSelection().toString()).toBe('edit requirement title in place');
    });

    it('typing is applied to the title and re-wrapped, the draft reported', () => {
        const { el, onDraft } = mount();
        const ev = input(el, 'insertText', 'X');
        expect(ev.defaultPrevented).toBe(true);
        expect(onDraft).toHaveBeenLastCalledWith('X');
        expect(lines(el)).toEqual(['X']);
        input(el, 'insertText', ' and a much longer title');
        expect(lines(el)).toEqual(['X and a much longer ', 'title']);
    });

    it('Backspace at a line start deletes the character before, not the break', () => {
        const { el, onDraft } = mount();
        // caret at the start of line 2 ("in place")
        caretAt(el, el.childNodes[2], 0);
        input(el, 'deleteContentBackward');
        expect(onDraft).toHaveBeenLastCalledWith('edit requirement titlein place');
    });

    it('a pasted line break becomes a space', () => {
        const { el, onDraft } = mount();
        const ev = new Event('paste', { bubbles: true, cancelable: true });
        ev.clipboardData = { getData: () => 'one\ntwo' };
        el.dispatchEvent(ev);
        expect(onDraft).toHaveBeenLastCalledWith('one two');
    });

    it('undo puts the title back', () => {
        const { el, onDraft } = mount();
        input(el, 'insertText', 'X');
        input(el, 'historyUndo');
        expect(onDraft).toHaveBeenLastCalledWith('edit requirement title in place');
        expect(lines(el)).toEqual(['edit requirement title ', 'in place']);
    });

    it('Cmd/Ctrl+Z undoes and Shift+Cmd+Z redoes, from the keys', () => {
        const { el, onDraft } = mount();
        input(el, 'insertText', 'X');
        fireEvent.keyDown(el, { key: 'z', metaKey: true });
        expect(onDraft).toHaveBeenLastCalledWith('edit requirement title in place');
        fireEvent.keyDown(el, { key: 'z', metaKey: true, shiftKey: true });
        expect(onDraft).toHaveBeenLastCalledWith('X');
    });

    it('Enter commits the typed title exactly once', () => {
        const { el, onCommit } = mount();
        input(el, 'insertText', 'New title');
        fireEvent.keyDown(el, { key: 'Enter' });
        fireEvent.blur(el);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith('New title', 'edit requirement title in place');
    });

    it('a paste at the length limit drops its own tail, never the title\'s', () => {
        const long = 'a'.repeat(250);
        const { el, onDraft } = mount({ initial: long });
        const r = document.createRange();
        // An unbroken title leaves line 1 holding none of it — the first RUN.
        r.setStart([...el.childNodes].find((n) => n.nodeType === 3), 10);
        r.collapse(true);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(r);
        const ev = new Event('paste', { bubbles: true, cancelable: true });
        ev.clipboardData = { getData: () => 'b'.repeat(20) };
        el.dispatchEvent(ev);
        const v = onDraft.mock.lastCall[0];
        expect(v).toHaveLength(256);
        expect(v.endsWith('a'.repeat(240))).toBe(true);
        expect(v.slice(10, 16)).toBe('bbbbbb');
    });

    it('Escape cancels and the blur after it does not commit', () => {
        const { el, onCommit, onCancel } = mount();
        input(el, 'insertText', 'Discard');
        fireEvent.keyDown(el, { key: 'Escape' });
        fireEvent.blur(el);
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('being taken away unended commits what was typed', async () => {
        const { el, onCommit, unmount } = mount();
        input(el, 'insertText', 'Kept');
        unmount();
        await new Promise((r) => setTimeout(r, 0));
        expect(onCommit).toHaveBeenCalledWith('Kept', 'edit requirement title in place');
    });

    it('goes read-only while saving', () => {
        const { el } = mount({ saving: true });
        expect(el.getAttribute('contenteditable')).toBe('false');
        expect(el.getAttribute('aria-busy')).toBe('true');
    });
});
