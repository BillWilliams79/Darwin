import { ACTIVITY_RIDE_ID, ICON_RIDE, ICON_HIKE, LINE_COLOR_ID } from '../cyclemeter/config';

const pad2 = n => n < 10 ? '0' + n : String(n);

export function formatDuration(s) {
    s = Math.floor(s);
    return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/**
 * Reconstruct a TransformedRun object from SQL data + coordinates,
 * matching the shape expected by generateKml().
 */
export function reconstructRun(sqlRun, coordinates, routeName) {
    // Parse start_time as UTC
    const startTimeStr = sqlRun.start_time;
    const startDate = new Date(startTimeStr.endsWith('Z') ? startTimeStr : startTimeStr + 'Z');

    // Timezone adjustment (month-based PST/PDT, matches transform.js)
    const month = startDate.getUTCMonth() + 1;
    const offsetHours = [1, 2, 3, 11, 12].includes(month) ? 8 : 7;
    const localDate = new Date(startDate.getTime() - offsetHours * 3600 * 1000);

    // Format date strings for KML (matches formatTitleDate/formatDescriptionTime)
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const titleFormattedStart = `${days[localDate.getUTCDay()]} :: ${pad2(localDate.getUTCDate())} ${months[localDate.getUTCMonth()]} ${localDate.getUTCFullYear()}`;
    let hours = localDate.getUTCHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const descFormattedStart = `${pad2(hours)}:${pad2(localDate.getUTCMinutes())} ${ampm}`;

    return {
        runID: sqlRun.run_id,
        routeID: sqlRun.map_route_fk,
        activityID: sqlRun.activity_id,
        activityName: sqlRun.activity_name,
        name: routeName || '',
        startTime: localDate,
        titleFormattedStart,
        descFormattedStart,
        runTime: formatDuration(sqlRun.run_time_sec),
        stoppedTime: formatDuration(sqlRun.stopped_time_sec || 0),
        distance: Number(sqlRun.distance_mi),
        ascent: sqlRun.ascent_ft != null ? Number(sqlRun.ascent_ft) : 0,
        descent: sqlRun.descent_ft != null ? Number(sqlRun.descent_ft) : 0,
        maxSpeed: sqlRun.max_speed_mph != null ? Number(sqlRun.max_speed_mph) : 0,
        averageSpeed: sqlRun.avg_speed_mph != null ? Number(sqlRun.avg_speed_mph) : 0,
        calories: sqlRun.calories != null ? Number(sqlRun.calories) : 0,
        notes: sqlRun.notes || '',
        lineIconId: sqlRun.activity_id === ACTIVITY_RIDE_ID ? ICON_RIDE : ICON_HIKE,
        lineColorId: LINE_COLOR_ID,
        coordinates: coordinates.map(c => ({
            latitude: Number(c.latitude),
            longitude: Number(c.longitude),
            altitude: c.altitude != null ? Number(c.altitude) : 0,
        })),
        extractedPoints: coordinates.length,
        currentPoints: coordinates.length,
        strippedPoints: 0,
    };
}
