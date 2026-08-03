// Req #3298 — every icon-only IconButton/ToggleButton in src/ must have an
// accessible name.
//
// MUI's SvgIcon sets aria-hidden unless it is given `titleAccess`, so a button
// whose only child is an icon has NO accessible name of its own. Screen readers
// announce it as an unlabelled "button". Two shapes produce that, and neither
// is visible by reading the JSX casually:
//
//   1. NO WRAPPER AT ALL — <IconButton><DeleteIcon /></IconButton>. There is no
//      title text anywhere, so there is nothing to inject correctly or
//      incorrectly. This is the shape req #3298 found on MapsPage's chart-type
//      toggle, and the sweep behind that requirement found it on 55 sites.
//
//   2. <Tooltip><span><IconButton/></span></Tooltip> — the <span> exists so the
//      Tooltip's POPPER can open over a DISABLED button (MUI sets
//      pointer-events: none on a disabled child). But Tooltip clones and
//      injects its title onto its DIRECT child, which is now the <span>. The
//      span gets a name; the button does not. Seven sites had this.
//
// Req #3281 fixed a third shape — a Tooltip nested INSIDE the icon — by hand,
// and its sweep only looked for that one shape. Prose describing a rule is not
// a mechanism (req #3246): this test is, so none of the three can come back
// silently. `memory/view-switchable-pages.md` § I V5 carries the rationale.
//
// THE RULE: a button passes if it carries aria-label / aria-labelledby / title
// itself, OR is the direct child of a <Tooltip> (which injects one), OR has
// real text children.
//
// PREFER AN EXPLICIT aria-label over relying on Tooltip injection. Not for the
// reason #3281 recorded — that a disabled child never receives the injected
// name. Read against @mui/material@7.3.7, Tooltip.js:544-552 assigns
// aria-label inside cloneElement unconditionally; `disabled` suppresses the
// visual popper, not the name. The real reasons: injection happens only when
// `title` is a string (title={<Box/>} or describeChild yields nothing), and it
// targets the DIRECT child — which shape 2 moves out from under the button.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OPEN = /<(IconButton|ToggleButton)(?=[\s/>])/g;
// An empty or nulled name is no name — `aria-label=""` must not satisfy this.
const NAME_ATTR =
    /\b(aria-label|aria-labelledby|title)\s*=\s*(?!""|''|\{\s*(''|""|null|undefined)?\s*\})/;
const TOOLTIP_DIRECT = /<Tooltip\b[^>]*>\s*$/;
const JSX_COMMENT = /\{\s*\/\*[\s\S]*?\*\/\s*\}/g;

/** Replace JSX comments with equivalent whitespace so line numbers survive. */
const blankComments = (src) =>
    src.replace(JSX_COMMENT, (m) => m.replace(/[^\n]/g, ' '));

/** From the '<' of an opening tag, find the index just past its '>'. */
function findTagEnd(src, start) {
    let depth = 0;
    let quote = null;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '{') {
            depth++;
        } else if (c === '}') {
            depth--;
        } else if (c === '>' && depth === 0) {
            return { end: i + 1, selfClosing: src[i - 1] === '/' };
        }
    }
    return { end: src.length, selfClosing: false };
}

/** From just past an opening tag, find the index of its matching close tag. */
function findClose(src, from, tag) {
    const pat = new RegExp(`<(/?)${tag}(?=[\\s/>])`, 'g');
    pat.lastIndex = from;
    let nest = 0;
    let m;
    while ((m = pat.exec(src)) !== null) {
        if (m[1] === '/') {
            if (nest === 0) return m.index;
            nest--;
        } else {
            const { end, selfClosing } = findTagEnd(src, m.index);
            if (!selfClosing) nest++;
            pat.lastIndex = end;
        }
    }
    return src.length;
}

const CALL = /\b[A-Za-z_$][\w$]*\s*\(/;

/**
 * Split a JSX body into its top-level {...} expression containers and the rest.
 *
 * An earlier detector stripped only `<...>` and asked whether anything was
 * left. That counted the RESIDUE of an expression as a text child, so
 * `{getCoordinationIcon()}` exempted its button — which is how three unnamed
 * buttons survived req #3298's first pass, RequirementRow's coordination
 * toggle among them. Any `>` inside an expression (`{n > 1}`, an arrow
 * function) had the same effect.
 */
function splitExpressions(body) {
    let literal = '';
    const expressions = [];
    let i = 0;
    while (i < body.length) {
        const c = body[i];
        if (c === '<') {
            // Skip the whole tag, attributes included. An attribute's own
            // {...} is NOT an expression child — reading `sx={{ fontSize: 16 }}`
            // as one made this detector exempt ten already-defective buttons.
            i = findTagEnd(body, i).end;
        } else if (c === '{') {
            let depth = 0;
            const start = i;
            while (i < body.length) {
                if (body[i] === '{') depth++;
                else if (body[i] === '}' && --depth === 0) { i++; break; }
                i++;
            }
            expressions.push(body.slice(start + 1, i - 1));
        } else {
            literal += c;
            i++;
        }
    }
    return { literal, expressions };
}

/**
 * Does the body hold anything that gives the button a name — i.e. real text?
 *
 * Literal text counts wherever it sits, nested elements included: a
 * `<span>Save</span>` child names its button. An expression container counts only if
 * it plainly renders text: `{r.label}` labels its ToggleButton "7d" and needs
 * no aria-label (adding one would override the visible text — WCAG 2.5.3). But
 * an expression holding a JSX element (`{cond ? <A/> : <B/>}`) renders icons,
 * and one that CALLS a function (`{getCoordinationIcon()}`) is opaque here —
 * both are treated as no text, so the button must carry an explicit name.
 *
 * KNOWN LIMIT: `{formatSomething(x)}` returning a string would be a false
 * positive. No such site exists in src/ today; if one appears, give that
 * button an aria-label or narrow this rule — do not widen it back.
 */
function hasTextChildren(body) {
    const { literal, expressions } = splitExpressions(body);
    if (literal.trim().length > 0) return true;
    return expressions.some(
        (e) => e.trim().length > 0 && !/<[A-Za-z]/.test(e) && !CALL.test(e)
    );
}

// Test files are excluded — they ship no UI, and this file's own header quotes
// the defective shapes it exists to forbid.
function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
            walk(full, out);
        } else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function findUnnamedButtons() {
    const findings = [];
    for (const file of walk(SRC)) {
        const src = blankComments(fs.readFileSync(file, 'utf8'));
        OPEN.lastIndex = 0;
        let m;
        while ((m = OPEN.exec(src)) !== null) {
            const tag = m[1];
            const start = m.index;
            const { end, selfClosing } = findTagEnd(src, start);
            const opening = src.slice(start, end);
            if (NAME_ATTR.test(opening)) continue;
            if (TOOLTIP_DIRECT.test(src.slice(Math.max(0, start - 600), start))) continue;
            if (!selfClosing) {
                const close = findClose(src, end, tag);
                if (hasTextChildren(src.slice(end, close))) continue;
            }
            findings.push(
                `${path.relative(SRC, file)}:${src.slice(0, start).split('\n').length}  <${tag}>`
            );
        }
    }
    return findings;
}

describe('icon-only buttons carry an accessible name (req #3298)', () => {
    it('finds every IconButton/ToggleButton in src/', () => {
        // Guards the walker itself: a broken glob would make the real assertion
        // pass by scanning nothing.
        const count = walk(SRC)
            .map((f) => (fs.readFileSync(f, 'utf8').match(OPEN) || []).length)
            .reduce((a, b) => a + b, 0);
        expect(count).toBeGreaterThan(100);
    });

    it('leaves none of them without one', () => {
        const findings = findUnnamedButtons();
        expect(
            findings,
            `Icon-only button(s) with no accessible name. Add an explicit ` +
            `aria-label to each (see the header of this file):\n  ` +
            findings.join('\n  ')
        ).toEqual([]);
    });
});
