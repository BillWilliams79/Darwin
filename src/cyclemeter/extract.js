/**
 * @module cyclemeter/extract
 * Extract cycling/hiking data from a Cyclemeter SQLite database (Meter.db).
 * Uses sql.js (SQLite compiled to WASM) to run in the browser.
 * Matches Python's gps_extract.py → cm_sqlite3_extract().
 */

import { ACTIVITY_RIDE_ID, ICON_RIDE, ICON_HIKE, LINE_COLOR_ID } from './config';

/**
 * Filter coordinates to only those within the ride trim window.
 * @param {import('./types').Coordinate[]} coordinates - All coordinates for a run
 * @param {number} runTimeBegin - Trim start in seconds (-1 = no begin trim)
 * @param {number} runTimeEnd - Trim end in seconds (-1 = no end trim)
 * @returns {{ trimmed: import('./types').Coordinate[], trimmedCount: number }}
 */
export function applyRideTrim(coordinates, runTimeBegin, runTimeEnd) {
    const beginTrim = runTimeBegin > 0 ? runTimeBegin : -Infinity;
    const endTrim = runTimeEnd > 0 ? runTimeEnd : Infinity;

    if (beginTrim === -Infinity && endTrim === Infinity) {
        return { trimmed: coordinates, trimmedCount: 0 };
    }

    const trimmed = coordinates.filter(
        c => c.timeOffset >= beginTrim && c.timeOffset <= endTrim
    );
    return { trimmed, trimmedCount: coordinates.length - trimmed.length };
}

/**
 * Build the SQL WHERE clause from a query filter config.
 * @param {import('./types').QueryFilter} filter
 * @returns {string}
 */
function buildWhereClause(filter) {
    if (filter.routeIDs && filter.routeIDs.length > 0) {
        const conditions = filter.routeIDs.map(id => `run.routeID=${id}`);
        return conditions.join(' OR ');
    }
    if (filter.notesLike) {
        return `run.notes LIKE '%${filter.notesLike.replace(/'/g, "''")}%'`;
    }
    if (filter.dateRange) {
        return `(run.startTime BETWEEN '${filter.dateRange.start}' AND '${filter.dateRange.end}')`;
    }
    // Default: all runs
    return '1=1';
}

/**
 * Extract runs and GPS coordinates from a Cyclemeter SQLite database.
 * @param {ArrayBuffer} arrayBuffer - The Meter.db file contents
 * @param {import('./types').EtlConfig} config
 * @returns {Promise<import('./types').Run[]>}
 */
export async function extractFromCyclemeter(arrayBuffer, config) {
    const { default: initSqlJs } = await import('sql.js');
    const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
    const db = new SQL.Database(new Uint8Array(arrayBuffer));

    const whereClause = buildWhereClause(config.queryFilter);

    const runQuery = `
        SELECT
            run.runID,
            run.routeID,
            activityID,
            route.name,
            startTime,
            runTime,
            runTimeBegin,
            runTimeEnd,
            stoppedTime,
            distance,
            ascent,
            descent,
            calories,
            maxSpeed,
            notes
        FROM
            run
        JOIN
            route USING(routeID)
        WHERE
            ${whereClause}
        ORDER BY
            run.startTime ASC
    `;

    const runResults = db.exec(runQuery);
    if (runResults.length === 0) {
        db.close();
        return [];
    }

    const columns = runResults[0].columns;
    const rows = runResults[0].values;

    const runs = rows.map(row => {
        const run = {};
        columns.forEach((col, i) => { run[col] = row[i]; });

        // Assign activity metadata
        run.activityName = run.activityID === ACTIVITY_RIDE_ID ? 'Ride' : 'Hike';
        run.lineIconId = run.activityID === ACTIVITY_RIDE_ID ? ICON_RIDE : ICON_HIKE;
        run.lineColorId = LINE_COLOR_ID;

        // Extract coordinates for this run
        const coordResults = db.exec(`SELECT * FROM coordinate WHERE runID=${run.runID}`);
        if (coordResults.length > 0) {
            const coordCols = coordResults[0].columns;
            run.coordinates = coordResults[0].values.map(coordRow => {
                const coord = {};
                coordCols.forEach((col, i) => { coord[col] = coordRow[i]; });
                return coord;
            });
        } else {
            run.coordinates = [];
        }

        // Apply ride trim filtering
        const { trimmed, trimmedCount } = applyRideTrim(
            run.coordinates, run.runTimeBegin, run.runTimeEnd
        );
        run.coordinates = trimmed;
        run.trimmedPoints = trimmedCount;

        // Track point counts (post-trim)
        run.extractedPoints = run.coordinates.length;
        run.currentPoints = run.coordinates.length;
        run.strippedPoints = 0;

        return run;
    });

    db.close();
    return runs;
}
