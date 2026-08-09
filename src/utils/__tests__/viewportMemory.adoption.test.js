// Req #3431 — the ADOPTION rule, enforced instead of merely written down.
//
// `viewportMemory.js` is durable since this requirement, and its own doctrine
// says `SwarmView/KonvaSwarmCanvas.jsx` must never restore a camera across page
// loads: req #2799 measured exactly that bug ("late-May affinity") on the swarm
// canvas and removed it. Before #3431 the store itself made the rule impossible
// to break — sessionStorage cannot outlive a page load. Flipping to localStorage
// removed that guarantee and left only a comment, and a comment is not a
// mechanism (req #3246). This is the mechanism.
//
// A SOURCE GUARD, following `requirementStatusWriters.sourceGuard.test.js`. It
// reads the file rather than importing it: the swarm canvas pulls in Konva and
// the whole visualizer model, and this assertion is about what the file SAYS,
// not what it does.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(
    fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('viewportMemory adoption', () => {
    // If this ever needs to change, the answer is NOT to delete the assertion.
    // The swarm canvas may have camera memory the day it has a store that does
    // not outlive the page load — its own sessionStorage-backed pair, or an
    // explicit clear on load. What it may not have is this one, silently.
    it('is not imported by KonvaSwarmCanvas (req #2799 would return)', () => {
        expect(src('SwarmView/KonvaSwarmCanvas.jsx')).not.toMatch(/viewportMemory/);
        expect(src('SwarmView/KonvaSwarmCanvas.jsx')).not.toMatch(/useSavedViewport/);
    });

    // The other two cameras Darwin owns. The build canvas is cleared to adopt
    // (the module's ADOPTION note says so) and simply has not yet; this asserts
    // the state of the world rather than a prohibition, so that an adoption is a
    // deliberate edit here and not an accident nobody reviews.
    it('has exactly one canvas caller today', () => {
        expect(src('SwarmView/pipelines/PipelinePlanVisualizer.jsx'))
            .toMatch(/useSavedViewport/);
        expect(src('BuildVisualizer/KonvaBuildCanvas.jsx')).not.toMatch(/useSavedViewport/);
    });
});
