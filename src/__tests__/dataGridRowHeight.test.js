// req #3302 — § D rule 2 of `memory/view-switchable-pages.md`, as a MECHANISM.
//
// The rule: *"Do NOT use `getRowHeight={() => 'auto'}` — it causes visual
// corruption when sorting repeatedly (row virtualizer mis-measures on re-sort).
// Use fixed `rowHeight`."* It was prose for a year and `RequirementsTableView`
// broke it anyway, on the grid most able to trigger it (two `sortComparator`s and
// a sortable header on every column). Prose an author has to remember is not a
// mechanism (req #3246).
//
// Modelled on `iconButtonAccessibleName.test.js`: walk `src/`, fail on the
// pattern, and carry the exemptions as data with a stated reason each.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(fileURLToPath(new URL('../', import.meta.url)));

// Files allowed to keep auto height, each with the reason it is safe.
//
// `MapRunsView` PRE-DATES the discovery and is the Mapping Architect's, not this
// agent's — listing it is the honest form of "known, not mine to change".
// Converting it is its own requirement.
const EXEMPT = new Map([
    ['MapRuns/MapRunsView.jsx', 'pre-dates the rule; Mapping Architect owns it (see § D rule 2)'],
]);

// Strip comments AND string literals before matching, with a scanner rather than
// a regex — the first cut used `/(^|[^:])\/\/[^\n]*/g`, which eats from any `//`
// to end of line INCLUDING one inside a string (`title="a//b"`), silently taking
// the rest of that line's code with it. Both directions matter: a comment must not
// be flagged, and code must not be hidden.
const strip = (src) => {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const next = src[i + 1];
        if (c === '/' && next === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && next === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        if (c === '"' || c === "'" || c === '`') {
            // Keep the quotes and the content: `getRowHeight={() => 'auto'}` IS the
            // thing being detected, so string bodies cannot be discarded — only
            // their power to start a comment.
            const quote = c;
            out += c; i++;
            while (i < n) {
                if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
                out += src[i];
                if (src[i] === quote) { i++; break; }
                i++;
            }
            continue;
        }
        out += c; i++;
    }
    return out;
};

// `getRowHeight` anywhere near an `auto` string literal. Deliberately loose about
// what sits between them, because the shapes that reach 'auto' are many and a
// tight pattern is how the first cut MISSED five of them — a destructured param
// (`({ id }) => 'auto'`, which MUI's own docs use) broke a `[^}]*` window, the
// object-literal spread form (`{ getRowHeight: () => 'auto' }`) has no `={`, and
// a template literal is not in `['"]`.
//
// KNOWN AND UNREACHABLE BY ANY REGEX: `getRowHeight={autoHeightFn}` with the
// literal in another function. Named here rather than left as a silent hole; the
// review gate is the backstop for that shape.
const AUTO_HEIGHT = /getRowHeight\s*[:=]\s*[\s\S]{0,200}?['"`]auto['"`]/;

const violates = (source) => AUTO_HEIGHT.test(strip(source));

const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(jsx?|tsx?)$/.test(entry)) out.push(full);
    }
    return out;
};

describe('DataGrid row height (§ D rule 2)', () => {
    const offenders = walk(SRC)
        .map(f => ({ path: relative(SRC, f), source: readFileSync(f, 'utf8') }))
        .filter(f => violates(f.source))
        .map(f => f.path)
        .filter(p => !EXEMPT.has(p));

    it('no grid outside the exemption list uses auto row height', () => {
        expect(offenders, offenders.length
            ? `auto row height re-introduced in:\n  ${offenders.join('\n  ')}\n`
              + 'Use a fixed `rowHeight` and clamp prose cells; see § D rule 2 and '
              + 'RequirementsTableView.jsx for the worked example.'
            : undefined).toEqual([]);
    });

    // A detector that matches nothing proves nothing. The exempt file is the
    // live positive control: if it stops matching, the regex has rotted and the
    // guard has silently stopped guarding.
    it('the detector still fires on the known instance', () => {
        for (const [path] of EXEMPT) {
            const source = readFileSync(join(SRC, path), 'utf8');
            expect(violates(source), `${path} no longer matches — the pattern has rotted, `
                + 'or the file was converted and should be removed from EXEMPT').toBe(true);
        }
    });

    // The file that documents the prohibition must not be flagged for saying so.
    it('does not flag a file that only MENTIONS the pattern in a comment', () => {
        const documented = readFileSync(join(SRC, 'Agents/InstructionsTableView.jsx'), 'utf8');
        expect(documented.includes("getRowHeight"), 'precondition: that file does mention it').toBe(true);
        expect(violates(documented)).toBe(false);
    });

    it('the grid this rule was broken on now sets a fixed height', () => {
        const source = readFileSync(join(SRC, 'SwarmView/RequirementsTableView.jsx'), 'utf8');
        expect(violates(source)).toBe(false);
        expect(/rowHeight=\{ROW_HEIGHT\}/.test(source)).toBe(true);
    });

    // ── The detector's own coverage ──────────────────────────────────────────
    //
    // A source-scanning guard is only as good as the shapes it recognises, and a
    // review measured FIVE forms the first cut missed. Each one is a case here,
    // so a future "tidy-up" of the pattern cannot quietly re-open them.
    describe('the pattern catches every reachable shape', () => {
        it.each([
            ['canonical',            "<DataGrid getRowHeight={() => 'auto'} />"],
            ['double quotes',        '<DataGrid getRowHeight={() => "auto"} />'],
            ['template literal',     '<DataGrid getRowHeight={() => `auto`} />'],
            ['destructured param',   "<DataGrid getRowHeight={({ id }) => 'auto'} />"],
            ['MUI docs param',       "<DataGrid getRowHeight={({ densityFactor }) => 'auto'} />"],
            ['object literal',       "const props = { getRowHeight: () => 'auto' };"],
            ['block body',           "<DataGrid getRowHeight={() => { return 'auto'; }} />"],
            ['conditional return',   "<DataGrid getRowHeight={(p) => p.id ? 'auto' : 52} />"],
            ['extra spacing',        "<DataGrid  getRowHeight = { ()   =>   'auto' }  />"],
            ['multi-line',           "<DataGrid\n  getRowHeight={() =>\n    'auto'\n  }\n/>"],
        ])('flags the %s form', (_label, source) => {
            expect(violates(source)).toBe(true);
        });

        it.each([
            ['a line comment',       "// getRowHeight={() => 'auto'} stays forbidden"],
            ['a block comment',      "/* getRowHeight={() => 'auto'} is banned */"],
            ['a fixed height',       "<DataGrid rowHeight={72} />"],
            ['an unrelated auto',    "<Box sx={{ overflowY: 'auto' }} />"],
        ])('does not flag %s', (_label, source) => {
            expect(violates(source)).toBe(false);
        });

        // The comment stripper must not take code with it. `//` inside a string
        // is not a comment, and treating it as one hid the rest of that line.
        it('does not let a URL or a string swallow the code after it', () => {
            const src = `<Box title="https://x/y" /><DataGrid getRowHeight={() => 'auto'} />`;
            expect(violates(src)).toBe(true);
        });

        it('still reads code that follows a real comment on the same line', () => {
            const src = "const a = 1; // note\n<DataGrid getRowHeight={() => 'auto'} />";
            expect(violates(src)).toBe(true);
        });
    });
});
