// Sums a swarm_start row's four raw token factors (input, cache write, cache
// read, output). `null` when every factor is null/undefined — an unmeasured
// invocation is not the same fact as a zero-token one, and callers (the table's
// dash rendering, the stats page's running sums) need to be able to tell the
// two apart rather than picking one meaning for both. A caller that wants the
// old "untracked contributes 0" behavior for a running sum should write
// `swarmStartTokenTotal(row) ?? 0` explicitly at the call site.
export function swarmStartTokenTotal(row) {
    const { tokens_input, tokens_cache_write, tokens_cache_read, tokens_output } = row;
    const hasAny = tokens_input != null || tokens_cache_write != null ||
        tokens_cache_read != null || tokens_output != null;
    if (!hasAny) return null;
    return (Number(tokens_input) || 0) + (Number(tokens_cache_write) || 0) +
        (Number(tokens_cache_read) || 0) + (Number(tokens_output) || 0);
}
