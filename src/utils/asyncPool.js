/**
 * Concurrency-limited parallel execution.
 * Processes tasks with at most `limit` running concurrently.
 *
 * @param {number} limit - Maximum concurrent tasks
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function called with (item, index)
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<Array>} - Promise.allSettled results
 */
export const asyncPool = async (limit, items, fn, signal) => {
    const results = [];
    const executing = new Set();

    for (const [index, item] of items.entries()) {
        if (signal?.aborted) throw new Error('Save cancelled');

        const p = fn(item, index).finally(() => executing.delete(p));
        results.push(p);
        executing.add(p);

        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }

    return Promise.allSettled(results);
};
