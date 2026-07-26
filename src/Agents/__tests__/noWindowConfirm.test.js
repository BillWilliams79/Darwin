// Req #3071 — no `window.confirm` may return to /agents.
//
// This is a source scan rather than a behavioural test on purpose. Reqs #3063 and
// #3071 each removed a `window.confirm` from this directory, and #3071 exists only
// because #3063 left two behind — a per-call test can only pin the calls that
// someone remembered to write a test for, and the failure mode here is a NEW
// destructive action being added with the quick option.
//
// The cost of a regression is asymmetric and delayed. `window.confirm` blocks the
// JS thread until a native dialog is answered, and Playwright auto-dismisses
// nothing it was not told about — so the first E2E spec written against /agents
// (none exists yet, see #3067) HANGS on it rather than failing with a readable
// message. That is a debugging session, not a red test.
//
// Prose is skipped deliberately: the surrounding files discuss `window.confirm` at
// length in their headers, and those explanations are worth keeping.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// `__tests__` is skipped, and not just to spare this file from matching itself: a
// test is ALLOWED to write `window.confirm` — stubbing or asserting on it is how
// you would pin behaviour around one. The rule being enforced is about shipped
// components, so the scan covers shipped components.
const sourceFiles = (dir) => readdirSync(dir).flatMap((entry) => {
    if (entry === '__tests__') return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.jsx?$/.test(entry) ? [full] : [];
});

// A line is CODE unless it is a `//` line comment or a `*` block-comment
// continuation. Good enough to separate the calls from the essays about them, and
// it fails CLOSED: anything it cannot classify counts as code.
const isCommentLine = (line) => {
    const t = line.trim();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

describe('src/Agents — window.confirm stays gone', () => {
    it('has no window.confirm call in any source line', () => {
        const offenders = [];
        for (const file of sourceFiles(AGENTS_DIR)) {
            const lines = readFileSync(file, 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (isCommentLine(line)) return;
                if (/\bwindow\s*\.\s*confirm\s*\(/.test(line)) {
                    offenders.push(`${relative(AGENTS_DIR, file)}:${i + 1}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });

    it('scans a real, non-empty set of files — so an empty pass means something', () => {
        // A broken path would make the assertion above vacuously true forever.
        const files = sourceFiles(AGENTS_DIR).map(f => relative(AGENTS_DIR, f));
        expect(files).toContain('AgentDetail.jsx');
        expect(files).toContain('ContextPage.jsx');
    });
});
