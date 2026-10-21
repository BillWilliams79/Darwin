// PlanInPlaceTitleArea.jsx — a requirement title, edited in place on its own
// row of the Plan visualizer (req #3661).
//
// User: "long click to edit a requirement title from the visualizer screen,
// have it fit the screen exactly as it will be displayed whether editing or
// not." So this is not a box laid over the row: it IS the row's title, in the
// row's own font, size, weight, colour and line pitch, on the canvas's own card
// (the background stays transparent), broken into exactly the lines the row is
// drawn on.
//
// ── IT DRAWS THE LAYOUT'S LINES; THE BROWSER NEVER WRAPS ────────────────────
// Browser wrapping cannot be made to agree with `wrapReqText` (measured — see
// `planReqTitleEdit.js`), so the text is laid out `white-space: pre`, one run
// per line from `titleLineStarts`, joined by <br>. Every run carries the space
// its break consumed, so the runs concatenate back to the title exactly and a
// DOM position converts to a title offset by counting text (`offsetOf`).
//
// That makes the edits this component's to apply: a native edit would mutate
// the runs (a Backspace at a line's start deletes the <br>, which changes no
// text at all), so `beforeinput` is cancelled and each input type is applied
// to the title string, which is then re-laid out with the caret restored. Paste,
// copy and cut go through the clipboard as the plain title. An input-method
// composition cannot be cancelled, so it runs natively and is reconciled from
// the DOM's text when it ends; any input type not handled here is reconciled
// the same way. Undo/redo keep their own history (driven from the keys as well
// as `historyUndo`), because the browser's history never sees a cancelled edit.
//
// Ending (Enter / blur commit, Escape cancels, unmounted = commit) is the name
// editor's own rule, shared through `useInPlaceEnding`.

import { useEffect, useLayoutEffect, useRef } from 'react';
import Box from '@mui/material/Box';

import { MONO, TITLE_MAX, useInPlaceEnding } from './PlanInPlaceInput';
import { PLAN_VIZ_PALETTE as P } from './pipelinePlanLayout';
import {
    titleLineStarts, prevCharIndex, nextCharIndex, wordStartBefore, wordEndAfter,
} from './planReqTitleEdit';
import { domCaretAt } from './planCaretPoint';

// A title is one line of text that merely wraps: a line break that gets in
// (a paste, a drop) is a space, and a non-breaking space is stored as a space.
const clean = (s) => String(s ?? '').replace(/\r\n|\r|\n/g, ' ').replace(/ /g, ' ')
    .slice(0, TITLE_MAX);
const HISTORY_MAX = 100;

// `data` into `text` over [a, b) — the INSERTION capped at the room left, so a
// paste into a long title loses its own tail, never the title's.
const splice = (text, a, b, data) => {
    const room = Math.max(0, TITLE_MAX - (text.length - (b - a)));
    const d = data.slice(0, room);
    return [text.slice(0, a) + d + text.slice(b), a + d.length];
};

export default function PlanInPlaceTitleArea({
    initial, label, onCommit, onCancel, onDraft, saving, ariaLabel, testId, style,
    indent = '0px', lineHeight, color, bold = false, caretAt = null,
}) {
    const boxRef = useRef(null);
    const ref = useRef(null);
    const textRef = useRef(null);
    const openedRef = useRef(null);
    if (textRef.current === null) {
        textRef.current = clean(initial);
        openedRef.current = textRef.current;
    }
    // The lines as last laid out: each one's title offset, its text node (null
    // for a line holding no title), and its index among the editable's children.
    const linesRef = useRef({ starts: [0], nodes: [null], idx: [0] });
    const labelRef = useRef(label);
    labelRef.current = label;
    const onDraftRef = useRef(onDraft);
    onDraftRef.current = onDraft;
    const undoRef = useRef([]);
    const redoRef = useRef([]);
    const composingRef = useRef(false);
    const savingRef = useRef(saving);
    savingRef.current = saving;

    // ── DOM position <-> title offset ───────────────────────────────────────
    // The text before a DOM position IS its title offset: <br> carries none.
    const offsetOf = (node, off) => {
        const el = ref.current;
        if (!el || !el.contains(node)) return textRef.current.length;
        const r = document.createRange();
        r.setStart(el, 0);
        r.setEnd(node, off);
        return r.toString().length;
    };
    // The line an offset lands on: the LAST line starting at or before it, so a
    // caret at a break sits at the start of the next line (where typed text
    // goes), and a caret at 0 skips a line 1 that holds no title.
    const lineAt = (o) => {
        const { starts } = linesRef.current;
        let i = 0;
        while (i + 1 < starts.length && starts[i + 1] <= o) i++;
        return i;
    };
    const positionOf = (o) => {
        const el = ref.current;
        const { starts, nodes, idx } = linesRef.current;
        const i = lineAt(o);
        const node = nodes[i];
        return node ? [node, Math.min(o - starts[i], node.length)] : [el, idx[i]];
    };
    const getSel = () => {
        const len = textRef.current.length;
        const sel = window.getSelection?.();
        const el = ref.current;
        if (!sel || !sel.rangeCount || !el || !el.contains(sel.anchorNode)) {
            return { a: len, b: len };
        }
        const r = sel.getRangeAt(0);
        const a = offsetOf(r.startContainer, r.startOffset);
        const b = offsetOf(r.endContainer, r.endOffset);
        return { a: Math.min(a, b), b: Math.max(a, b) };
    };
    // A caret past the lines the row shows scrolls them, as an input would.
    const reveal = () => {
        try {
            const box = boxRef.current;
            const sel = window.getSelection();
            if (!box || !sel.rangeCount) return;
            const rect = sel.getRangeAt(0).getBoundingClientRect();
            if (!rect || (!rect.height && !rect.top)) return;
            const b = box.getBoundingClientRect();
            if (rect.bottom > b.bottom) box.scrollTop += rect.bottom - b.bottom;
            else if (rect.top < b.top) box.scrollTop -= b.top - rect.top;
        } catch {
            // No layout to measure (jsdom) — nothing to scroll.
        }
    };
    const select = (a, b = a) => {
        const sel = window.getSelection?.();
        if (!sel || !ref.current) return;
        const [n1, o1] = positionOf(a);
        const [n2, o2] = positionOf(b);
        const r = document.createRange();
        r.setStart(n1, o1);
        r.setEnd(n2, o2);
        sel.removeAllRanges();
        sel.addRange(r);
        reveal();
    };

    // ── Lay the title out as the row's lines ────────────────────────────────
    const paint = (text, sel) => {
        const el = ref.current;
        if (!el) return;
        const starts = titleLineStarts(text, labelRef.current);
        const kids = [];
        const nodes = [];
        const idx = [];
        starts.forEach((s, i) => {
            if (i > 0) kids.push(document.createElement('br'));
            idx.push(kids.length);
            const run = text.slice(s, starts[i + 1] ?? text.length);
            const node = run ? document.createTextNode(run) : null;
            if (node) kids.push(node);
            nodes.push(node);
        });
        el.replaceChildren(...kids);
        linesRef.current = { starts, nodes, idx };
        if (sel) select(sel.a, sel.b);
    };
    const apply = (next, caret) => {
        const value = clean(next);
        if (value === textRef.current) { select(Math.min(caret, value.length)); return; }
        undoRef.current.push({ text: textRef.current, sel: getSel() });
        if (undoRef.current.length > HISTORY_MAX) undoRef.current.shift();
        redoRef.current = [];
        textRef.current = value;
        const at = Math.min(caret, value.length);
        paint(value, { a: at, b: at });
        onDraftRef.current?.(value);
    };
    const travel = (from, to) => {
        const entry = from.current.pop();
        if (!entry) return;
        to.current.push({ text: textRef.current, sel: getSel() });
        textRef.current = entry.text;
        paint(entry.text, entry.sel);
        onDraftRef.current?.(entry.text);
    };
    // Re-read the title from the DOM after an edit this component did not
    // apply (a composition, an input type it does not handle).
    const reconcile = () => {
        const el = ref.current;
        if (!el) return;
        const sel = getSel();
        const prev = textRef.current;
        const value = clean(el.textContent);
        if (value !== prev) {
            undoRef.current.push({ text: prev, sel: { a: sel.a, b: sel.a } });
            redoRef.current = [];
            textRef.current = value;
            onDraftRef.current?.(value);
        }
        paint(value, { a: Math.min(sel.a, value.length), b: Math.min(sel.b, value.length) });
    };

    // The commit carries the text the editor OPENED on as well, so the caller
    // can tell "unchanged" from "changed back to what is stored now".
    const finish = useInPlaceEnding({
        onCommit: (value) => onCommit(value, openedRef.current), onCancel, valueRef: textRef,
        // A long press puts the caret where the title was pressed (req
        // #3665): the editor lies over the very lines that were drawn, so the
        // press point is a place in this text. Short of the title (the id
        // beside it) is its start, past it its end.
        focusSelect: () => {
            const el = ref.current;
            if (!el) return;
            el.focus();
            if (!caretAt) { select(0, textRef.current.length); return; }
            const hit = domCaretAt(caretAt);
            if (hit && el.contains(hit[0])) { select(offsetOf(hit[0], hit[1])); return; }
            const r = el.getBoundingClientRect();
            select(caretAt.y < r.top || (caretAt.y <= r.bottom && caretAt.x < r.left)
                ? 0 : textRef.current.length);
        },
    });

    // Laid out on mount, and again whenever the row's wrap changes under the
    // editor (a pill appearing moves line 1's title start) — the caret kept.
    useLayoutEffect(() => {
        const focused = typeof document !== 'undefined' && document.activeElement === ref.current;
        paint(textRef.current, focused ? getSel() : null);
    }, [label.idText, label.titleHang, label.titleRoom, label.reqId]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── The edits ───────────────────────────────────────────────────────────
    // Native listeners: React's `onBeforeInput` is a synthetic of the legacy
    // `textInput` event and carries no `inputType`.
    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const onBeforeInput = (e) => {
            if (savingRef.current || composingRef.current || e.isComposing) return;
            const type = e.inputType || '';
            if (type === 'insertCompositionText') return;
            const text = textRef.current;
            let { a, b } = getSel();
            if (type === 'historyUndo' || type === 'historyRedo') {
                e.preventDefault();
                if (type === 'historyUndo') travel(undoRef, redoRef);
                else travel(redoRef, undoRef);
                return;
            }
            if (type === 'insertLineBreak' || type === 'insertParagraph'
                || type.startsWith('format')) {
                e.preventDefault();               // Enter commits (keydown)
                return;
            }
            if (type.startsWith('insert')) {
                // A spelling replacement names its own range, not the caret.
                const ranges = type === 'insertReplacementText' ? e.getTargetRanges?.() : null;
                if (ranges?.length) {
                    a = offsetOf(ranges[0].startContainer, ranges[0].startOffset);
                    b = offsetOf(ranges[0].endContainer, ranges[0].endOffset);
                }
                const data = clean(e.data ?? e.dataTransfer?.getData('text/plain') ?? '');
                e.preventDefault();
                apply(...splice(text, a, b, data));
                return;
            }
            if (type.startsWith('delete')) {
                if (a === b) {
                    const line = lineAt(a);
                    const { starts } = linesRef.current;
                    if (type === 'deleteContentBackward') a = prevCharIndex(text, a);
                    else if (type === 'deleteContentForward') b = nextCharIndex(text, b);
                    else if (type === 'deleteWordBackward') a = wordStartBefore(text, a);
                    else if (type === 'deleteWordForward') b = wordEndAfter(text, b);
                    else if (type === 'deleteSoftLineBackward'
                        || type === 'deleteHardLineBackward') {
                        a = a > starts[line] ? starts[line] : prevCharIndex(text, a);
                    } else if (type === 'deleteSoftLineForward'
                        || type === 'deleteHardLineForward') {
                        b = starts[line + 1] ?? text.length;
                    }
                }
                e.preventDefault();
                apply(text.slice(0, a) + text.slice(b), a);
            }
            // Anything else runs natively and is reconciled on `input`.
        };
        const onInput = () => { if (!composingRef.current) reconcile(); };
        const onCompStart = () => { composingRef.current = true; };
        const onCompEnd = () => { composingRef.current = false; reconcile(); };
        const onCopy = (e, cut) => {
            const { a, b } = getSel();
            e.preventDefault();
            e.clipboardData?.setData('text/plain', textRef.current.slice(a, b));
            if (cut && a < b && !savingRef.current) {
                const text = textRef.current;
                apply(text.slice(0, a) + text.slice(b), a);
            }
        };
        const onPaste = (e) => {
            e.preventDefault();
            if (savingRef.current) return;
            const { a, b } = getSel();
            const data = clean(e.clipboardData?.getData('text/plain') ?? '');
            apply(...splice(textRef.current, a, b, data));
        };
        // Arrow keys and clicks move the caret natively; one moved onto a line
        // scrolled out of the row's room brings it into view.
        const onSelChange = () => {
            const sel = window.getSelection?.();
            if (sel?.rangeCount && el.contains(sel.anchorNode)) reveal();
        };
        const onCopyEvt = (e) => onCopy(e, false);
        const onCutEvt = (e) => onCopy(e, true);
        // A title has nothing to drag within it.
        const noDrag = (e) => e.preventDefault();
        el.addEventListener('beforeinput', onBeforeInput);
        el.addEventListener('input', onInput);
        el.addEventListener('compositionstart', onCompStart);
        el.addEventListener('compositionend', onCompEnd);
        el.addEventListener('copy', onCopyEvt);
        el.addEventListener('cut', onCutEvt);
        el.addEventListener('paste', onPaste);
        el.addEventListener('dragstart', noDrag);
        el.addEventListener('drop', noDrag);
        document.addEventListener('selectionchange', onSelChange);
        return () => {
            document.removeEventListener('selectionchange', onSelChange);
            el.removeEventListener('beforeinput', onBeforeInput);
            el.removeEventListener('input', onInput);
            el.removeEventListener('compositionstart', onCompStart);
            el.removeEventListener('compositionend', onCompEnd);
            el.removeEventListener('copy', onCopyEvt);
            el.removeEventListener('cut', onCutEvt);
            el.removeEventListener('paste', onPaste);
            el.removeEventListener('dragstart', noDrag);
            el.removeEventListener('drop', noDrag);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <Box ref={boxRef} data-viz-chrome="edit"
             data-testid={testId ? `${testId}-box` : undefined}
             style={style}
             onClick={(ev) => ev.stopPropagation()}
             sx={{
                 boxSizing: 'content-box', m: 0, p: 0, overflow: 'hidden',
                 fontFamily: MONO, lineHeight,
                 outline: `1px solid ${P.accent}`, outlineOffset: '2px',
                 borderRadius: '2px', background: 'transparent',
                 opacity: saving ? 0.6 : 1,
             }}>
            <Box ref={ref} data-testid={testId} role="textbox" aria-label={ariaLabel}
                 aria-busy={saving || undefined} aria-readonly={saving || undefined}
                 contentEditable={saving ? 'false' : 'plaintext-only'}
                 spellCheck={false} tabIndex={0}
                 onKeyDown={(ev) => {
                     // Kept inside the editor: Space types a space, not a
                     // chip's Enter/Space handler.
                     ev.stopPropagation();
                     if (ev.nativeEvent?.isComposing) return;
                     if (ev.key === 'Enter') { ev.preventDefault(); finish(true); return; }
                     if (ev.key === 'Escape') { ev.preventDefault(); finish(false); return; }
                     // Undo/redo from the keys: Chromium sends no `historyUndo`
                     // while ITS history is empty, and it always is here.
                     const mod = ev.metaKey || ev.ctrlKey;
                     const k = ev.key.toLowerCase();
                     if (mod && !ev.altKey && (k === 'z' || (k === 'y' && ev.ctrlKey))) {
                         ev.preventDefault();
                         if (savingRef.current) return;
                         if (k === 'z' && !ev.shiftKey) travel(undoRef, redoRef);
                         else travel(redoRef, undoRef);
                     }
                 }}
                 onBlur={() => finish(true)}
                 sx={{
                     display: 'block', m: 0, p: 0, outline: 'none',
                     minHeight: lineHeight, lineHeight,
                     whiteSpace: 'pre', textIndent: indent,
                     fontWeight: bold ? 700 : 400, color, caretColor: color,
                     cursor: 'text',
                 }} />
        </Box>
    );
}
