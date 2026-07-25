// Req #3049 — the pure helpers behind editable instructions.
//
// The load-order helpers carry the two invariants that make reordering safe:
// a swap must never renumber (the live registry uses BANDED slots — per-agent
// instructions at 1..N, the shared common-* rows together at 100..102), and a
// failed write must never be able to strip an agent's whole instruction set,
// which is why the write set stays as small as the move allows.
//
// The req #3053 model-pin suite below shares this file: both branches added an
// `agentRegistryUtils.test.js` and they were merged rather than one replacing
// the other.

import { describe, it, expect } from 'vitest';
import {
    nextInstructionSortOrder, planInstructionSwap, repairInstructionOrders,
    instructionNameTaken, restErrorMessage,
    agentModelChipProps, agentModelLabel,
} from '../agentRegistryUtils';

const link = (instruction_fk, sort_order, agent_fk = 7) =>
    ({ agent_fk, instruction_fk, sort_order });

describe('nextInstructionSortOrder', () => {
    it('returns 1 for an agent with no links', () => {
        expect(nextInstructionSortOrder(7, new Map())).toBe(1);
    });

    it('lands past the highest existing slot', () => {
        const links = new Map([[7, [link(1, 1), link(2, 2), link(3, 5)]]]);
        expect(nextInstructionSortOrder(7, links)).toBe(6);
    });

    it('ignores NULL slots rather than treating them as zero', () => {
        const links = new Map([[7, [link(1, 3), link(2, null)]]]);
        expect(nextInstructionSortOrder(7, links)).toBe(4);
    });

    it('returns 1 when every existing slot is NULL', () => {
        const links = new Map([[7, [link(1, null), link(2, null)]]]);
        expect(nextInstructionSortOrder(7, links)).toBe(1);
    });

    it('does not leak one agent\'s slots into another\'s', () => {
        const links = new Map([[7, [link(1, 9)]], [8, [link(2, 1, 8)]]]);
        expect(nextInstructionSortOrder(8, links)).toBe(2);
    });
});

describe('repairInstructionOrders', () => {
    it('leaves an already-valid list completely alone', () => {
        const links = [link(10, 1), link(11, 2), link(12, 3)];
        expect(repairInstructionOrders(links).map(l => l.sort_order)).toEqual([1, 2, 3]);
    });

    it('keeps a deliberate outlier instead of flattening to 1..N', () => {
        // The real registry shape: per-agent slots in a low run, then the shared
        // common-* band starting at 100. A NULL in the middle must not collapse
        // the two bands into one.
        const links = [link(10, 1), link(11, null), link(12, 100)];
        expect(repairInstructionOrders(links).map(l => l.sort_order)).toEqual([1, 2, 100]);
    });

    it('repairs only the duplicate, keeping the values around it', () => {
        const links = [link(10, 4), link(11, 4), link(12, 9)];
        expect(repairInstructionOrders(links).map(l => l.sort_order)).toEqual([4, 5, 9]);
    });

    it('repairs a value that would go backwards', () => {
        const links = [link(10, 5), link(11, 2), link(12, 8)];
        expect(repairInstructionOrders(links).map(l => l.sort_order)).toEqual([5, 6, 8]);
    });

    it('skips slots reserved by links it is not rewriting (closed links)', () => {
        const links = [link(10, null), link(11, null)];
        expect(repairInstructionOrders(links, [1, 3]).map(l => l.sort_order)).toEqual([2, 4]);
    });

    it('will not KEEP a stored value that a reserved link already holds', () => {
        const links = [link(10, 1), link(11, 2)];
        expect(repairInstructionOrders(links, [2]).map(l => l.sort_order)).toEqual([1, 3]);
    });

    it('never produces a duplicate, whatever the input', () => {
        const links = [link(10, null), link(11, 1), link(12, 1), link(13, null)];
        const orders = repairInstructionOrders(links).map(l => l.sort_order);
        expect(new Set(orders).size).toBe(orders.length);
    });

    it('keeps a deliberate 0 or negative slot instead of rewriting it', () => {
        const links = [link(10, -5), link(11, 0), link(12, 2)];
        expect(repairInstructionOrders(links).map(l => l.sort_order)).toEqual([-5, 0, 2]);
    });

    it('still floors a NEWLY assigned slot at 1', () => {
        const links = [link(10, null), link(11, null)];
        expect(repairInstructionOrders(links).map(l => l.sort_order)).toEqual([1, 2]);
    });

    it('preserves the live banded shape (per-agent 1..N, common 100..102)', () => {
        // The real registry: verified live 2026-07-24 on all 12 architects.
        const links = [link(1, 1), link(2, 2), link(3, 3),
                       link(4, 100), link(5, 101), link(6, 102)];
        expect(repairInstructionOrders(links).map(l => l.sort_order))
            .toEqual([1, 2, 3, 100, 101, 102]);
    });
});

describe('planInstructionSwap', () => {
    const clean = [link(10, 1), link(11, 2), link(12, 3)];
    const orderOf = (plan, id) =>
        plan.writes.find(r => r.instruction_fk === id)?.sort_order;

    it('swaps two adjacent rows and writes nothing else', () => {
        const plan = planInstructionSwap(clean, 1, 0);
        expect(plan.writes).toHaveLength(2);
        expect(orderOf(plan, 11)).toBe(1);
        expect(orderOf(plan, 10)).toBe(2);
        // Row 12 is never written — that is the blast-radius guarantee.
        expect(plan.writes.some(r => r.instruction_fk === 12)).toBe(false);
    });

    it('preserves the high common band instead of renumbering it', () => {
        const seeded = [link(1, 1), link(2, 2), link(3, 100)];
        const plan = planInstructionSwap(seeded, 2, 1);
        expect(plan.writes.map(r => r.sort_order).sort((a, b) => a - b)).toEqual([2, 100]);
        expect(orderOf(plan, 3)).toBe(2);     // moved up
        expect(orderOf(plan, 2)).toBe(100);   // 100 survives; nothing collapses to 3
    });

    it('returns rollback originals aligned with the writes', () => {
        const plan = planInstructionSwap(clean, 0, 1);
        expect(plan.originals).toHaveLength(plan.writes.length);
        plan.writes.forEach((w, i) => {
            expect(plan.originals[i].instruction_fk).toBe(w.instruction_fk);
        });
        expect(plan.originals.map(o => o.sort_order)).toEqual([1, 2]);
    });

    it('repairs NULL slots as part of the same single write set', () => {
        const dirty = [link(10, 1), link(11, null), link(12, null)];
        const plan = planInstructionSwap(dirty, 0, 1);
        // Display order [10,11,12] with 10 moved down one → [11,10,12].
        expect(orderOf(plan, 11)).toBe(1);
        expect(orderOf(plan, 10)).toBe(2);
        expect(orderOf(plan, 12)).toBe(3);
    });

    it('repairs a duplicated slot without flattening the list', () => {
        const dupes = [link(10, 4), link(11, 4), link(12, 9)];
        const plan = planInstructionSwap(dupes, 0, 2);
        expect(orderOf(plan, 12)).toBe(4);
        expect(orderOf(plan, 10)).toBe(9);
        expect(orderOf(plan, 11)).toBe(5);   // the repaired duplicate
    });

    it('writes nothing extra for a merely sparse list', () => {
        const sparse = [link(10, 2), link(11, 40), link(12, 700)];
        const plan = planInstructionSwap(sparse, 0, 1);
        expect(plan.writes).toHaveLength(2);
        expect(orderOf(plan, 10)).toBe(40);
        expect(orderOf(plan, 11)).toBe(2);
    });

    it('avoids a closed link\'s reserved slot when repairing', () => {
        const links = [link(10, null), link(11, null)];
        const plan = planInstructionSwap(links, 0, 1, [1]);
        expect(plan.writes.map(r => r.sort_order).sort((a, b) => a - b)).toEqual([2, 3]);
    });

    it('returns null at the bounds and for a no-op move', () => {
        expect(planInstructionSwap(clean, 0, -1)).toBeNull();
        expect(planInstructionSwap(clean, 2, 3)).toBeNull();
        expect(planInstructionSwap(clean, 1, 1)).toBeNull();
        expect(planInstructionSwap([], 0, 1)).toBeNull();
    });

    it('does not mutate the input links', () => {
        const input = [link(10, 1), link(11, 2)];
        planInstructionSwap(input, 0, 1);
        expect(input.map(l => l.sort_order)).toEqual([1, 2]);
    });
});

describe('instructionNameTaken', () => {
    const catalog = [
        { id: 1, name: 'common-documents', closed: 0 },
        { id: 2, name: 'Retired-Rule', closed: 1 },
    ];

    it('detects a collision', () => {
        expect(instructionNameTaken('common-documents', catalog)).toBe(true);
    });

    it('collides against a CLOSED row — the unique key does not exclude them', () => {
        expect(instructionNameTaken('retired-rule', catalog)).toBe(true);
    });

    it('is case- and whitespace-insensitive, matching MySQL collation', () => {
        expect(instructionNameTaken('  COMMON-Documents ', catalog)).toBe(true);
    });

    it('does not collide a row with itself', () => {
        expect(instructionNameTaken('common-documents', catalog, 1)).toBe(false);
    });

    it('treats an empty name as not taken (the required-field check owns that)', () => {
        expect(instructionNameTaken('   ', catalog)).toBe(false);
    });

    it('allows a genuinely new name', () => {
        expect(instructionNameTaken('new-rule', catalog)).toBe(false);
    });
});

describe('restErrorMessage', () => {
    const thrown = (httpMessage) => ({ httpStatus: { httpStatus: 500, httpMessage } });

    it('maps a duplicate instruction name', () => {
        const err = thrown("HTTP PUT SQL FAILED: 1062 Duplicate entry 'x' for key 'instructions.uq_instructions_name'");
        expect(restErrorMessage(err, 'fallback')).toMatch(/already in use/);
    });

    it('maps a duplicate agent link', () => {
        const err = thrown("HTTP POST bulk failed: 1062 Duplicate entry '10-6' for key 'agent_instructions.PRIMARY'");
        expect(restErrorMessage(err, 'fallback')).toMatch(/already bound/);
    });

    it('maps a foreign key failure', () => {
        const err = thrown('HTTP POST bulk failed: 1452 Cannot add or update a child row: a foreign key constraint fails');
        expect(restErrorMessage(err, 'fallback')).toMatch(/no longer exists/);
    });

    it('falls back for an unrecognised error', () => {
        expect(restErrorMessage(thrown('HTTP PUT SQL FAILED: 2013 Lost connection'), 'fallback'))
            .toBe('fallback');
    });

    it('falls back when the thrown value has no message at all', () => {
        expect(restErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
        expect(restErrorMessage(undefined, 'fallback')).toBe('fallback');
    });
});

// req #3053 — the Agents card's model pin chip used a hardcoded black text +
// pastel fill regardless of theme.palette.mode. Against a white light-mode
// card the pastel fill measures well under 3:1 (verified with dataviz's
// validate_palette.js `contrast()`), reading as a washed-out, near-grey patch
// even though the black text on it is independently legible. agentModelChipProps
// now resolves its fill through modelChipStyles.js's mode-aware modelFillColor.

const lightTheme = { palette: { mode: 'light' } };
const darkTheme = { palette: { mode: 'dark' } };

describe('agentModelChipProps (req #3053)', () => {
    it('extracts the base model from the frontmatter-style pin ("opus[1m]" -> opus)', () => {
        expect(agentModelChipProps('opus[1m]').sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
    });

    it('keeps the original ramp unchanged in dark mode (already clears the dark card)', () => {
        expect(agentModelChipProps('haiku').sx(darkTheme)).toEqual({ bgcolor: '#e57373', color: '#000' });
        expect(agentModelChipProps('opus[1m]').sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(agentModelChipProps('fable[1m]').sx(darkTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
    });

    it('darkens the pastel rungs (not fable) in light mode so the fill clears 3:1 on white', () => {
        expect(agentModelChipProps('haiku').sx(lightTheme)).toEqual({ bgcolor: 'rgb(217, 109, 109)', color: '#000' });
        expect(agentModelChipProps('opus[1m]').sx(lightTheme)).toEqual({ bgcolor: 'rgb(99, 153, 101)', color: '#000' });
        expect(agentModelChipProps('fable[1m]').sx(lightTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
    });

    it('falls back to opus styling for null/unknown, per mode', () => {
        expect(agentModelChipProps(null).sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(agentModelChipProps(null).sx(lightTheme)).toEqual({ bgcolor: 'rgb(99, 153, 101)', color: '#000' });
    });

    it('agentModelLabel shows the stored value verbatim (keeps the [1m] suffix)', () => {
        expect(agentModelLabel('opus[1m]')).toBe('opus[1m]');
        expect(agentModelLabel(null)).toBe('—');
    });
});
