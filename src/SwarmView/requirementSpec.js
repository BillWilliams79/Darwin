// THE default requirement (req #3573): Swarm-Ready · Implemented · Opus · High.
// Every create path spreads this rather than spelling out its own four literals.
//
// The five-letter spec codes (SRIOH, SRISM, ...) are a shorthand the user TYPES
// to Claude — accepted as the `spec` input on darwin-mcp's create_requirement /
// update_requirement (darwin-mcp/services/requirement_spec.py). They are not a
// field: no column, no editor input, not on any read (req #3595). The one place
// the browser SHOWS one is the Requirement Filer's popup (req #3815) — derived,
// display only (RequirementFiler/requirementFilerModel.js specCode). That popup
// starts its first requirement at SRDOH, not this default — the user's ruling.
export const DEFAULT_REQUIREMENT_SPEC = Object.freeze({
    requirement_status: 'swarm_ready',
    coordination_type:  'implemented',
    ai_model:           'opus',
    effort:             'high',
});
