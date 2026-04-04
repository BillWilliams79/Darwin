/**
 * @module cyclemeter
 * Pipeline orchestrator for the ETL pipeline.
 * Supports multiple input formats via extractor registry.
 * Extract → precisionOptimizer → formatRunData → distanceOptimizer → generateKml
 */

import { extractFromCyclemeter } from './extract';
import { extractFromStravaGpx } from './extractStrava';
import { extractFromCyclemeterKml } from './extractCyclemeterKml';
import { extractFromDarwinKml } from './extractDarwinKml';
import { extractFromMtbProjectGpx } from './extractMtbProject';
import { extractFromWahooFit } from './extractWahooFit';
import { precisionOptimizer, formatRunData, distanceOptimizer } from './transform';
import { generateKml } from './load/kml';

/**
 * Extractor registry — maps format IDs to extraction functions.
 * Format IDs match those returned by detectFormat() in formatDetector.js.
 */
const EXTRACTORS = {
    'wahoo-fit': extractFromWahooFit,
    'cyclemeter': extractFromCyclemeter,
    'cyclemeter-kml': extractFromCyclemeterKml,
    'darwin-kml': extractFromDarwinKml,
    'cyclemeter-gpx': extractFromStravaGpx,
    'strava-gpx': extractFromStravaGpx,
    'mtbproject-gpx': extractFromMtbProjectGpx,
};

/**
 * Run the full ETL pipeline.
 * @param {ArrayBuffer} dbBuffer - Meter.db file contents
 * @param {import('./types').EtlConfig} config
 * @returns {Promise<{ runs: import('./types').TransformedRun[], stats: import('./types').EtlStats, kml: string }>}
 */
export async function runPipeline(dbBuffer, config) {
    // Extract
    const runs = await extractFromCyclemeter(dbBuffer, config);

    // Transform (order matches Python's gps_cli_main.py)
    precisionOptimizer(runs, config.precision);
    formatRunData(runs);
    distanceOptimizer(runs, config.minDelta);

    // Load
    const kml = generateKml(runs, config);

    // Stats
    const stats = computeStats(runs);

    return { runs, stats, kml };
}

/**
 * Run the ETL pipeline for a detected format.
 * Routes to the correct extractor based on format ID; transform and load are format-agnostic.
 * @param {ArrayBuffer} buffer - File contents
 * @param {import('./types').EtlConfig} config
 * @param {string} format - Format ID from detectFormat() (e.g., 'cyclemeter', 'strava-gpx')
 * @returns {Promise<{ runs: import('./types').TransformedRun[], stats: import('./types').EtlStats, kml: string }>}
 */
export async function runPipelineForFormat(buffer, config, format) {
    const extractor = EXTRACTORS[format];
    if (!extractor) throw new Error(`No extractor registered for format: ${format}`);

    const runs = await extractor(buffer, config);

    precisionOptimizer(runs, config.precision);
    formatRunData(runs);
    distanceOptimizer(runs, config.minDelta);

    const kml = generateKml(runs, config);
    const stats = computeStats(runs);

    return { runs, stats, kml };
}

/**
 * Compute summary statistics from processed runs.
 * @param {import('./types').TransformedRun[]} runs
 * @returns {import('./types').EtlStats}
 */
export function computeStats(runs) {
    let totalDistance = 0;
    let totalExtracted = 0;
    let totalStripped = 0;
    let totalRemaining = 0;
    let totalTrimmed = 0;

    for (const run of runs) {
        totalDistance += run.distance;
        totalExtracted += run.extractedPoints;
        totalStripped += run.strippedPoints;
        totalRemaining += run.currentPoints;
        totalTrimmed += run.trimmedPoints || 0;
    }

    const percentReduction = totalExtracted > 0
        ? Math.round(1000 * totalStripped / totalExtracted) / 10
        : 0;

    return {
        totalRuns: runs.length,
        totalDistance: Math.round(totalDistance * 10) / 10,
        totalExtracted,
        totalStripped,
        totalTrimmed,
        totalRemaining,
        percentReduction,
    };
}

// Re-export individual modules for separate use
export { extractFromWahooFit } from './extractWahooFit';
export { extractFromCyclemeter, applyRideTrim } from './extract';
export { extractFromStravaGpx } from './extractStrava';
export { extractFromCyclemeterKml } from './extractCyclemeterKml';
export { extractFromDarwinKml } from './extractDarwinKml';
export { extractFromMtbProjectGpx } from './extractMtbProject';
export { detectFormat } from './formatDetector';
export { precisionOptimizer, formatRunData, distanceOptimizer } from './transform';
export { generateKml } from './load/kml';
export { downloadFile } from './load/download';
export { haversineDistance } from './geo';
export { DEFAULT_CONFIG } from './config';
