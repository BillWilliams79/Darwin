import { describe, it, expect } from 'vitest';
import { parseSummary } from '../SwarmStartsPage';

describe('parseSummary (req #2422)', () => {
    it('returns empty for null/empty input', () => {
        expect(parseSummary(null)).toEqual([]);
        expect(parseSummary('')).toEqual([]);
    });

    it('parses the compact pipe-delimited multi-session format with synthesized headers', () => {
        const summary = [
            '4-session batch launch (auto-start via req-keyword)',
            '',
            'Req #2419 — Dev Server encode terminal # | feature/2419-dev-server-encode-terminal-1 | implemented | iTerm 258 ⌥⌘2 | Config PR 170 + Darwin PR 469',
            'Req #2412 — new requirement left edge is off | feature/2412-new-requirement-left-edge-is-off-1 | implemented | iTerm 260 ⌥⌘3 | Config PR 171 + Darwin PR 470',
        ].join('\n');

        const blocks = parseSummary(summary);
        // Block 0: title text. Block 1: 2-row table with 5 synthesized headers.
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({ kind: 'text', text: '4-session batch launch (auto-start via req-keyword)' });
        expect(blocks[1].kind).toBe('table');
        expect(blocks[1].headers).toEqual(['Session', 'Branch', 'Coordination', 'Terminal', 'PRs']);
        expect(blocks[1].rows).toHaveLength(2);
        expect(blocks[1].rows[0][0]).toBe('Req #2419 — Dev Server encode terminal #');
        expect(blocks[1].rows[0][2]).toBe('implemented');
    });

    it('parses standard markdown tables with real headers', () => {
        const summary = [
            '**Fix login timeout**',
            '',
            '| Detail | Value |',
            '|---|---|',
            '| Source | Swarm #4 |',
            '| Branch | feature/2422-swarm-start-data-type-1 |',
            '| Wall clock | 2m 22s |',
            '',
            'One swarm launched successfully.',
        ].join('\n');

        const blocks = parseSummary(summary);
        // Block 0: bold text. Block 1: table with 2 cols, 3 rows. Block 2: footer text.
        expect(blocks[0]).toEqual({ kind: 'text', text: 'Fix login timeout', bold: true });
        expect(blocks[1].kind).toBe('table');
        expect(blocks[1].headers).toEqual(['Detail', 'Value']);
        expect(blocks[1].rows).toHaveLength(3);
        expect(blocks[1].rows[0]).toEqual(['Source', 'Swarm #4']);
        expect(blocks[2]).toMatchObject({ kind: 'text', text: 'One swarm launched successfully.' });
    });

    it('preserves uneven row column counts by padding to the widest row', () => {
        const summary = [
            'Mixed-width batch',
            '',
            'a | b | c | d | e',
            'f | g | h',
        ].join('\n');

        const blocks = parseSummary(summary);
        const table = blocks.find(b => b.kind === 'table');
        expect(table.rows[0]).toHaveLength(5);
        expect(table.rows[1]).toHaveLength(5);
        expect(table.rows[1].slice(3)).toEqual(['', '']);
    });

    it('handles plain-text-only summaries (no tables)', () => {
        const blocks = parseSummary('Just a single line, no pipes here.');
        expect(blocks).toEqual([
            { kind: 'text', text: 'Just a single line, no pipes here.', bold: false },
        ]);
    });
});
