// Render rules for the SHARED TELEMETRY ENVELOPE (req #3202).
//
// The tests that matter here are all one rule: **NULL means NOT MEASURED and
// must never render as 0.** Roughly 1,900 pre-#3202 rows carry NULL in every
// envelope column, with no backfill possible — their transcripts are rotated or
// deleted, so any number written now would be fabricated. A page that prints
// "0 tokens" for one of those is making a false claim about a real run, and a
// total that sums NULLs as zeros silently understates every aggregate.

import { describe, it, expect } from 'vitest';
import {
    NOT_MEASURED,
    TOKEN_FIELDS,
    envelopeCost,
    envelopePrompt,
    formatTokenCount,
    formatWallMs,
    hasEnvelope,
} from '../telemetryEnvelope';

describe('formatWallMs — the ONE wall-clock unit', () => {
    it('renders not-measured as an em-dash, never as 0s', () => {
        expect(formatWallMs(null)).toBe(NOT_MEASURED);
        expect(formatWallMs(undefined)).toBe(NOT_MEASURED);
    });

    it('keeps sub-second precision instead of collapsing it to 0s', () => {
        // An agent's boot latency is a real sub-second measurement — it is why
        // the envelope chose milliseconds over the seconds Domain A used.
        expect(formatWallMs(412)).toBe('412ms');
        expect(formatWallMs(0)).toBe('0ms');
    });

    it('reads as a duration once past a second', () => {
        expect(formatWallMs(1000)).toBe('1s');
        expect(formatWallMs(252431)).toBe('4m 12s');
        expect(formatWallMs(3_600_000)).toBe('1h');
    });

    it('refuses junk rather than printing it', () => {
        expect(formatWallMs('abc')).toBe(NOT_MEASURED);
        expect(formatWallMs(-5)).toBe(NOT_MEASURED);
    });
});

describe('formatTokenCount', () => {
    it('renders not-measured as an em-dash', () => {
        expect(formatTokenCount(null)).toBe(NOT_MEASURED);
    });

    it('renders a measured zero as zero — it is a real measurement', () => {
        expect(formatTokenCount(0)).toBe('0');
    });

    it('compacts large counts', () => {
        expect(formatTokenCount(789)).toBe('789');
        expect(formatTokenCount(45_600)).toBe('45.6k');
        expect(formatTokenCount(12_300_000)).toBe('12.3M');
    });
});

describe('envelopeCost — measured is reported separately from the total', () => {
    it('reports an unmeasured run as measured:false with a null total', () => {
        const cost = envelopeCost({ id: 1 });
        expect(cost.measured).toBe(false);
        expect(cost.total).toBeNull();
        for (const field of TOKEN_FIELDS) expect(cost.parts[field]).toBeNull();
    });

    it('distinguishes a genuinely zero-cost run from an unmeasured one', () => {
        const zero = envelopeCost({
            tokens_input: 0, tokens_cache_write: 0,
            tokens_cache_read: 0, tokens_output: 0,
        });
        expect(zero.measured).toBe(true);
        expect(zero.total).toBe(0);
    });

    it('totals only the types that were measured', () => {
        const cost = envelopeCost({ tokens_output: 40, tokens_input: 2 });
        expect(cost.total).toBe(42);
        expect(cost.parts.tokens_cache_read).toBeNull();
        expect(cost.measured).toBe(true);
    });

    it('treats an unreadable value as unmeasured, not as zero', () => {
        const cost = envelopeCost({ tokens_output: 'lots' });
        expect(cost.parts.tokens_output).toBeNull();
        expect(cost.measured).toBe(false);
    });
});

describe('envelopePrompt — the stored text is a bounded prefix', () => {
    it('is null when no prompt was captured', () => {
        expect(envelopePrompt({})).toBeNull();
        expect(envelopePrompt({ prompt_text: '' })).toBeNull();
    });

    it('marks a clipped prompt as clipped, by comparing against the FULL length', () => {
        const prompt = envelopePrompt({
            prompt_text: 'x'.repeat(2000),
            prompt_chars: 5400,
            prompt_sha256: 'abcdef0123456789',
        });
        expect(prompt.truncated).toBe(true);
        expect(prompt.chars).toBe(5400);
        expect(prompt.shaShort).toBe('abcdef012345');
    });

    it('does not claim truncation for a prompt that fit', () => {
        const prompt = envelopePrompt({ prompt_text: 'short', prompt_chars: 5 });
        expect(prompt.truncated).toBe(false);
    });

    it('does not guess truncation when the full length is unknown', () => {
        const prompt = envelopePrompt({ prompt_text: 'x'.repeat(2000) });
        expect(prompt.truncated).toBe(false);
        expect(prompt.chars).toBeNull();
    });
});

describe('hasEnvelope — a pre-#3202 row shows no panel of em-dashes', () => {
    it('is false for a row that measured nothing', () => {
        expect(hasEnvelope({ id: 1, label: 'old capture' })).toBe(false);
        expect(hasEnvelope(null)).toBe(false);
    });

    it('is true on any single measured field, including a genuine zero', () => {
        expect(hasEnvelope({ wall_ms: 0 })).toBe(true);
        expect(hasEnvelope({ tokens_output: 0 })).toBe(true);
        expect(hasEnvelope({ prompt_sha256: 'abc' })).toBe(true);
    });
});
