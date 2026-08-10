// Batched GET /map_coordinates — req #3166.
//
// THE PREMISE THE REQUIREMENT WAS WRITTEN ON IS FALSE, AND IT MAKES THIS EASIER.
// #3166 says "no IN-filter in Lambda-Rest generic GET, so the aggregator fetches
// per run". `rest_get_table.py` has supported `?col=(1,2,3)` -> `col IN (...)`
// all along, parameterized, and two production call sites already use it
// (BuildVisualizer/useBuildVisualizerData.js,
// SwarmView/detail/useOrchestrationIndex.js — req #3435 replaced the
// `useEpicPipelineLocation.js` named here originally). Nothing had to change in
// Lambda-Rest; only a client that knows how to ASK for N runs at once, which is
// this module.
//
// WHY A ROW BUDGET AND NOT A RUN COUNT — the one real hazard here.
// Batching trades request count for response size, and response size is the
// documented cliff on this stack: Lambda caps a synchronous response at 6 MB
// (memory/lambda-patterns.md, req #3078), above which the caller sees a 502 with
// no useful diagnosis. Coordinate rows per run are NOT uniform, so "N runs per
// request" has an unbounded worst case that depends entirely on which rides the
// user filtered to. Measured on production 2026-08-03: 1,528,251 rows over 2,547
// runs — 600.0 average, but 4,370 in the largest single run, a 7x spread, and a
// longer tour imported tomorrow widens it further.
//
// So a batch is packed against a MEASURED row count, obtained from one grouped-
// count probe, and never against a guess about run size. That makes the response
// ceiling a property of this module rather than of the user's filter.
//
// COST, counted rather than estimated (and asserted in this module's tests).
// At 200 runs of the production-average 600 rows the aggregator goes from 200
// requests to 9 — 7 track reads plus 2 count probes. Packing is greedy, so a
// batch takes 33 runs (a 34th would overrun the budget) and 200 runs need 7
// reads where perfect packing would need 6; the probe count is 200 ids over
// COORD_ID_BUDGET. A whole-library export (2,547 runs, ~1.53M rows) is ~87 reads
// + 17 probes = ~104 requests. Against the requirement's ~13x estimate that is
// ~22x for the aggregator.

// Rows in ONE batched response. At the 92 bytes/row measured against production
// data (`JSON_OBJECT` of map_run_fk + latitude + longitude + altitude, the exact
// payload rest_get_table.py emits) this is ~1.8 MB — a 3x margin under Lambda's
// 6 MB ceiling, which is deliberate: the margin absorbs both a future column and
// a run whose altitude values are all non-null. The export path passes a FIFTH
// column (`seq`), which the same budget still covers at ~2.3 MB. Raising this
// trades that margin for a request count that is already negligible.
//
// TWO THINGS THIS BUDGET SILENTLY DEPENDS ON, both worth knowing before moving it:
//   • `group_concat_max_len` on RDS parameter group `mysql84-darwin` is 10 MB.
//     MySQL's DEFAULT is 1024 bytes and overflow is TRUNCATED TO A WARNING, not
//     an error — which would hand the client a short, invalid-JSON array. The
//     batch raises the per-request GROUP_CONCAT payload ~33x (55 KB -> 1.8 MB),
//     so this stopped being a theoretical dependency. Asserted by
//     Lambda-Rest/tests/test_map_coordinates_batched_read.py.
//   • A single run larger than the budget gets its own request and OVERRUNS it
//     (see packRunsByRowBudget). That is bounded only by the largest run in the
//     data: at the measured 4,370-row maximum it is ~400 KB, but a ~60,000-row
//     import would reach the 6 MB ceiling and 502. Splitting a run needs
//     LIMIT/OFFSET, which this API does not have (req #3078).
export const COORD_ROW_BUDGET = 20_000;

// Run ids in ONE URL, for both the probe and the track read. 150 ids is ~900
// characters of query string, far inside API Gateway's 8 KB request-line limit,
// and it bounds the `IN (...)` list MySQL has to plan.
export const COORD_ID_BUDGET = 150;

// Batched reads in flight at once. Each one is now heavy (up to COORD_ROW_BUDGET
// rows) and each is one Lambda invocation holding one fresh RDS connection, so
// this stays well below the per-run fan-out's old cap of 15.
export const COORD_REQUEST_CONCURRENCY = 4;

// The row shape every coordinate consumer shares. Cache entries under
// mapCoordinateKeys.byRun are only interchangeable while every writer asks for
// the same fields, so the aggregator and RouteMapThumbnail both use this.
export const COORD_TRACK_FIELDS = 'latitude,longitude,altitude';

export function chunkList(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

// One grouped count per run. Returns 404 (-> []) when NO run in the list has a
// single coordinate, which is a real case — a manually entered ride carries no
// GPS at all — and is why the caller must tolerate a missing entry rather than
// treat it as an error.
export function buildCountUri(darwinUri, runIds) {
    return `${darwinUri}/map_coordinates?map_run_fk=(${runIds.join(',')})&fields=count(*),map_run_fk`;
}

// `map_run_fk` is projected so the flat response can be split back per run, and
// the sort is TWO columns because one is not enough: `seq:asc` alone would
// interleave runs, and the split would then have to re-sort every track.
// `map_run_fk:asc,seq:asc` makes each run's rows contiguous AND in recorded
// order within each run — verified against darwin_dev.
//
// BOTH HALVES ARE LOAD-BEARING AND NEITHER IS FREE. `rest_get_table.py` places
// `sort=` INSIDE the `GROUP_CONCAT`, where MySQL sorts with its own tree and
// never consults the access path — measured on production 2026-08-03, the plan
// for the real statement reports `used_key_parts: ["map_run_fk"]`, `key_len 4`,
// so `idx_map_coordinates_run_seq`'s second column is not used and the sort
// happens regardless. Do NOT drop either sort key on the theory that the index
// supplies the order: the batched plan drives from `map_runs` via
// `uq_creator_run (creator_fk, run_id)`, so arrival order follows `run_id`, and
// that agrees with `map_run_fk` only by coincidence in the current data.
export function buildTrackUri(darwinUri, runIds, fields = COORD_TRACK_FIELDS) {
    return `${darwinUri}/map_coordinates?map_run_fk=(${runIds.join(',')})`
        + `&fields=map_run_fk,${fields}&sort=map_run_fk:asc,seq:asc`;
}

// The SINGLE-run read, shared with useMapCoordinates so the two writers of a
// mapCoordinateKeys.byRun cache entry cannot drift apart in URI or row shape.
export function buildRunTrackUri(darwinUri, runId, fields = COORD_TRACK_FIELDS) {
    return `${darwinUri}/map_coordinates?map_run_fk=${runId}&fields=${fields}&sort=seq:asc`;
}

// Grouped-count rows arrive as {"count(*)": n, "map_run_fk": id}. The key really
// does contain the parentheses — rest_get_table.py builds the JSON key from the
// literal `fields=` token.
export function parseRowCounts(countRows = []) {
    const counts = new Map();
    for (const row of countRows) {
        const runId = Number(row?.map_run_fk);
        const rows = Number(row?.['count(*)']);
        if (Number.isFinite(runId) && Number.isFinite(rows)) counts.set(runId, rows);
    }
    return counts;
}

// Greedy pack, in id order so batches stay contiguous and readable in the network
// panel. Two escapes from the budget, both deliberate:
//   • a run the probe reported ZERO rows for (or did not report at all) is left
//     out of every batch — there is nothing to fetch, and asking would spend a
//     request to be told 404;
//   • a run BIGGER than the whole budget gets a batch to itself and overruns it.
//     Splitting one run across requests would need LIMIT/OFFSET, which this API
//     does not have (req #3078), and a lone oversized run is exactly the request
//     the per-run code already made — so this is never worse than the status quo.
export function packRunsByRowBudget(runIds, rowCounts, {
    rowBudget = COORD_ROW_BUDGET,
    idBudget = COORD_ID_BUDGET,
} = {}) {
    const batches = [];
    let current = [];
    let currentRows = 0;

    for (const runId of runIds) {
        const rows = rowCounts.get(runId) || 0;
        if (rows === 0) continue;
        const wouldOverflow = current.length > 0
            && (currentRows + rows > rowBudget || current.length >= idBudget);
        if (wouldOverflow) {
            batches.push(current);
            current = [];
            currentRows = 0;
        }
        current.push(runId);
        currentRows += rows;
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

// Split a flat batched response back into one track per run, dropping the
// `map_run_fk` discriminator. Dropping it is not cosmetic: these rows are written
// straight into the mapCoordinateKeys.byRun cache entries that RouteMapThumbnail
// and RouteDetailView read through useMapCoordinates, so they have to be
// identical to what the per-run read returns, key for key.
export function groupTracksByRun(rows = []) {
    const tracks = new Map();
    for (const row of rows) {
        const runId = Number(row?.map_run_fk);
        if (!Number.isFinite(runId)) continue;
        const { map_run_fk, ...coordinate } = row;
        if (!tracks.has(runId)) tracks.set(runId, []);
        tracks.get(runId).push(coordinate);
    }
    return tracks;
}

// Every caller's `fetchJson` is supposed to resolve an array (404 -> []), but
// two of the three do NOT throw on every non-2xx: `call_rest_api` RETURNS a
// {data: {}, httpStatus: 503} object on a transport/CORS failure, and both
// export wrappers pass `result.data || []` straight through — so a 503 arrives
// here as `{}`, not as a rejection. Iterating that would be a TypeError deep in
// parseRowCounts; treating it as empty would be worse, silently exporting a
// ride with no track. Fail at the boundary.
//
// The message names the run ids and NOT the URI: ExportDialog surfaces
// `err.message` straight into its on-screen error banner, and an API endpoint
// with the caller's database in it does not belong there.
function assertRows(rows, runIds, kind) {
    if (!Array.isArray(rows)) {
        throw new Error(
            `map_coordinates ${kind} did not return rows for ${runIds.length} run(s)`
        );
    }
    return rows;
}

// Run `tasks` with at most `limit` in flight, preserving result order.
async function withConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
        while (next < tasks.length) {
            const index = next++;
            results[index] = await tasks[index]();
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * Coordinates for a set of runs, in as few requests as the row budget allows.
 *
 * Transport-agnostic on purpose: `fetchJson` is the caller's own GET, so the
 * TanStack hook passes `fetchEntity`, the export service passes its `safeGet`,
 * and the export dialog passes a `call_rest_api` wrapper — one batching
 * implementation, three callers, no shared React or query-client dependency.
 * `fetchJson` MUST resolve a 404 to `[]` (all three already do); anything else it
 * rejects with propagates, so a failed batch fails the whole call LOUDLY rather
 * than silently returning fewer tracks than runs.
 *
 * `onTracks` is called with each batch's runs AS THAT BATCH LANDS, before any
 * later batch has been awaited, and it is what makes a retry cheap. The
 * per-run fan-out this replaced was incrementally durable for free — each run
 * seeded its own cache entry on success, so a retry re-fetched only the
 * failures. A single `await` over every batch loses that: one rejection
 * discards six successful batches, and the client-wide `retry: 2` then re-reads
 * all 120,000 rows three times. Handing each batch over on arrival restores it.
 *
 * @returns {Promise<Map<number, object[]>>} an entry for EVERY requested run id,
 *   including runs with no coordinates at all (empty array).
 */
export async function fetchCoordinatesForRuns({
    fetchJson,
    darwinUri,
    runIds = [],
    fields = COORD_TRACK_FIELDS,
    rowBudget = COORD_ROW_BUDGET,
    idBudget = COORD_ID_BUDGET,
    concurrency = COORD_REQUEST_CONCURRENCY,
    onTracks,
}) {
    const ids = [...new Set(runIds.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
    const tracks = new Map(ids.map(id => [id, []]));
    if (ids.length === 0) return tracks;

    const deliver = (batchTracks) => {
        for (const [runId, track] of batchTracks) {
            if (tracks.has(runId)) tracks.set(runId, track);
        }
        if (onTracks) onTracks(batchTracks);
    };

    const countResponses = await withConcurrency(
        chunkList(ids, idBudget).map(chunk => async () => assertRows(
            await fetchJson(buildCountUri(darwinUri, chunk)), chunk, 'count probe',
        )),
        concurrency,
    );
    const rowCounts = parseRowCounts(countResponses.flat());

    // A run the probe counted at zero is settled NOW: it needs no read, and
    // handing it over here means a later batch failure cannot make a retry
    // re-probe it either.
    deliver(new Map(ids.filter(id => !rowCounts.get(id)).map(id => [id, []])));

    await withConcurrency(
        packRunsByRowBudget(ids, rowCounts, { rowBudget, idBudget }).map(batch => async () => {
            const rows = assertRows(
                await fetchJson(buildTrackUri(darwinUri, batch, fields)), batch, 'batched read',
            );
            const grouped = groupTracksByRun(rows);
            // Keyed off the BATCH, not off the response: a run whose rows
            // vanished between probe and read still gets a settled empty track
            // rather than being left to look un-fetched.
            deliver(new Map(batch.map(id => [id, grouped.get(id) || []])));
        }),
        concurrency,
    );

    return tracks;
}
