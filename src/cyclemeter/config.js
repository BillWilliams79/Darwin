/**
 * @module cyclemeter/config
 * Constants and default configuration for the Cyclemeter ETL pipeline.
 */

// Unit conversion constants
export const METERS_TO_MILES = 1 / 1609;
export const METERS_TO_FEET = 3.281;
export const MS_TO_MPH = 2.237;

// Icon IDs for Google MyMaps KML
export const ICON_RIDE = 1522;
export const ICON_HIKE = 1596;

// Activity ID → name mapping (from Cyclemeter DB)
export const ACTIVITY_RIDE_ID = 4;

// Blue color descriptors (monochrome — no rainbow)
export const LINE_COLOR = 'ffb16711';   // KML AABBGGRR format
export const LINE_COLOR_ID = '1167b1';  // Hex RGB

// KML style constants
export const KML_ICON_URL = 'https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png';
export const KML_LINE_WIDTH = 5;
export const KML_LINE_WIDTH_HIGHLIGHT = 7.5;

// Max stopped time (24h - 1s) — matches Python's cap
export const MAX_STOPPED_TIME = 86399;

/** @type {import('./types').EtlConfig} */
export const DEFAULT_CONFIG = {
    mapTitle: 'Bill and Tim Cycle the SF Bay Trail',
    mapDescription: 'Scout and ride the complete SF Bay Trail Network. Cycling operations commenced May 6, 2016.',
    outputFilename: 'getterdone',
    minDelta: 10,
    precision: 4,
    queryFilter: { routeIDs: [56, 10] },
};
