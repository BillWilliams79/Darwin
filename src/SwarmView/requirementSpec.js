// THE default requirement (req #3573): Swarm-Ready · Implemented · Opus · High.
// Every create path spreads this rather than spelling out its own four literals.
//
// The five-letter spec codes (SRIOH, SRISM, ...) are a shorthand the user TYPES
// to Claude — accepted as the `spec` input on darwin-mcp's create_requirement /
// update_requirement (darwin-mcp/services/requirement_spec.py). They are not a
// field: no column, no editor control, not on any read (req #3595).
export const DEFAULT_REQUIREMENT_SPEC = Object.freeze({
    requirement_status: 'swarm_ready',
    coordination_type:  'implemented',
    ai_model:           'opus',
    effort:             'high',
});
