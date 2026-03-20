/**
 * @module cyclemeter/types
 * JSDoc typedefs for the Cyclemeter ETL pipeline.
 */

/**
 * @typedef {Object} EtlConfig
 * @property {string} mapTitle - Title for the KML document
 * @property {string} mapDescription - Description for the KML document
 * @property {string} outputFilename - Filename for the downloaded KML
 * @property {number} minDelta - Minimum distance (meters) between GPS points for distance optimizer
 * @property {number} precision - Number of decimal places for coordinate precision (0 = skip)
 * @property {QueryFilter} queryFilter - Filter to select which runs to extract
 */

/**
 * @typedef {Object} QueryFilter
 * @property {number[]} [routeIDs] - Extract runs matching these route IDs
 * @property {string} [notesLike] - Extract runs where notes LIKE this string
 * @property {{ start: string, end: string }} [dateRange] - Extract runs within date range (ISO strings)
 */

/**
 * @typedef {Object} Coordinate
 * @property {number} latitude
 * @property {number} longitude
 * @property {number} [altitude]
 * @property {number} [horizontalAccuracy]
 * @property {number} [verticalAccuracy]
 * @property {number} [speed]
 * @property {number} [course]
 * @property {string} [timestamp]
 */

/**
 * @typedef {Object} Run
 * @property {number} runID
 * @property {number} routeID
 * @property {number} activityID
 * @property {string} name - Route name from Cyclemeter
 * @property {string} startTime - ISO format start time (raw from DB)
 * @property {number} runTime - Run duration in seconds
 * @property {number} stoppedTime - Stopped duration in seconds
 * @property {number} distance - Distance in meters (raw from DB)
 * @property {number} ascent - Ascent in meters (raw from DB)
 * @property {number} descent - Descent in meters (raw from DB)
 * @property {number} calories
 * @property {number} maxSpeed - Max speed in m/s (raw from DB)
 * @property {string} notes
 * @property {Coordinate[]} coordinates - GPS points for this run
 * @property {number} extractedPoints - Points extracted from DB
 * @property {number} currentPoints - Points after optimization
 * @property {number} strippedPoints - Points removed by distance optimizer
 * @property {string} activityName - 'Ride' or 'Hike'
 * @property {number} lineIconId - 1522 (ride) or 1596 (hike)
 * @property {string} lineColorId - Hex color ID (e.g., '1167b1')
 */

/**
 * @typedef {Object} TransformedRun
 * @property {number} runID
 * @property {number} routeID
 * @property {number} activityID
 * @property {string} name
 * @property {Date} startTime - Date object (TZ-adjusted)
 * @property {string} titleFormattedStart - "DAY :: DD MMM YYYY"
 * @property {string} descFormattedStart - "HH:MM AM/PM"
 * @property {string} runTime - "HH:MM:SS" formatted
 * @property {string} stoppedTime - "HH:MM:SS" formatted
 * @property {number} distance - Miles (1 decimal)
 * @property {number} ascent - Feet (integer)
 * @property {number} descent - Feet (integer)
 * @property {number} calories - Integer
 * @property {number} maxSpeed - MPH (1 decimal)
 * @property {number} averageSpeed - MPH (2 decimals)
 * @property {string} notes
 * @property {Coordinate[]} coordinates
 * @property {number} extractedPoints
 * @property {number} currentPoints
 * @property {number} strippedPoints
 * @property {string} activityName
 * @property {number} lineIconId
 * @property {string} lineColorId
 */

/**
 * @typedef {Object} EtlStats
 * @property {number} totalRuns
 * @property {number} totalDistance - Total distance in miles
 * @property {number} totalExtracted - Total GPS points extracted
 * @property {number} totalStripped - Total GPS points stripped
 * @property {number} totalRemaining - Total GPS points remaining
 * @property {number} percentReduction - Percentage of points removed
 */

export {};
