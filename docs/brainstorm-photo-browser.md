# Photo/Video Browser — File System Access API Brainstorm

**Status:** Brainstorm / Future exploration
**Date:** 2026-03-20
**Category:** Darwin → Mapping

## Problem Statement

Select photos and videos from a user's local library filtered by a specific date and
time window — without building a native iOS/Android app. Use case: after a bike ride or
trip, pull all media from that date range for mapping, journaling, or sharing.

## Chosen Approach: File System Access API

The [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
lets a web app request read access to a local directory. The user picks a folder (e.g.,
their Photos library), and the app can recursively walk it, read file metadata, and
present a filterable UI — all client-side, no uploads required.

## How It Works — Step by Step

### 1. Request Directory Access

```javascript
const dirHandle = await window.showDirectoryPicker({
  mode: 'read',         // read-only access
  startIn: 'pictures',  // hint to start in Pictures folder
});
```

- Browser shows a native folder picker dialog
- User explicitly grants permission — no silent access
- Returns a `FileSystemDirectoryHandle` — a persistent reference to that folder
- Permission can be persisted across sessions (see Section 7)

### 2. Recursively Walk the Directory

```javascript
async function* walkDirectory(dirHandle, path = '') {
  for await (const [name, handle] of dirHandle.entries()) {
    const fullPath = path ? `${path}/${name}` : name;
    if (handle.kind === 'directory') {
      yield* walkDirectory(handle, fullPath);
    } else {
      yield { name, path: fullPath, handle };
    }
  }
}
```

- Iterates all files and subdirectories recursively
- Apple Photos on macOS stores originals in `~/Pictures/Photos Library.photoslibrary/originals/`
  - This is a package (directory) — `showDirectoryPicker` can navigate into it
  - Subdirectories organized by media type: `0/`, `1/`, etc. with UUID-named files
- For non-Apple workflows, user might point at a `DCIM/` folder, Dropbox camera uploads, etc.

### 3. Filter to Media Files

```javascript
const MEDIA_EXTENSIONS = new Set([
  // Images
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tiff', '.raw', '.cr2', '.nef', '.arw',
  // Videos
  '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm',
]);

function isMediaFile(name) {
  const ext = name.toLowerCase().substring(name.lastIndexOf('.'));
  return MEDIA_EXTENSIONS.has(ext);
}
```

### 4. Extract Date Taken from EXIF / Metadata

This is the most important and nuanced step. `File.lastModified` is the **filesystem
date** (when the file was copied/moved), not when the photo was taken.

#### For Images — EXIF parsing

```javascript
import exifr from 'exifr';  // ~45KB, handles JPEG, HEIC, TIFF, PNG

async function getImageDate(fileHandle) {
  const file = await fileHandle.getFile();
  const exif = await exifr.parse(file, {
    pick: ['DateTimeOriginal', 'CreateDate', 'GPSDateStamp'],
  });

  // Priority: DateTimeOriginal > CreateDate > file lastModified
  return exif?.DateTimeOriginal
      ?? exif?.CreateDate
      ?? new Date(file.lastModified);
}
```

**EXIF fields (priority order):**

| Field | Meaning | Reliability |
|-------|---------|-------------|
| `DateTimeOriginal` | Shutter press time | Best — set by camera hardware |
| `CreateDate` | File creation in camera | Good — usually matches DateTimeOriginal |
| `ModifyDate` | Last edit time | Unreliable — changes on crop/filter |
| `GPSDateStamp` | GPS fix date (UTC) | Good but only if GPS was active |
| `File.lastModified` | OS filesystem date | Fallback only — changes on copy |

**HEIC support:** `exifr` handles HEIC natively. This matters because iPhones shoot HEIC
by default since iOS 11.

#### For Videos — MP4 metadata parsing

Videos don't have EXIF. Metadata lives in the MP4/MOV container (the `moov` atom).

```javascript
// Option A: mp4box.js — full MP4 parser (~120KB)
import MP4Box from 'mp4box';

async function getVideoDate(fileHandle) {
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  const mp4 = MP4Box.createFile();

  return new Promise((resolve) => {
    mp4.onReady = (info) => {
      // info.created is a Date from the mvhd atom
      resolve(info.created ?? new Date(file.lastModified));
    };
    buffer.fileStart = 0;
    mp4.appendBuffer(buffer);
    mp4.flush();
  });
}
```

```javascript
// Option B: Lightweight — read just the moov/mvhd atom manually
// The creation_time field is at a known offset in the mvhd atom
// Smaller payload but more fragile across container variants
```

**Video duration** is also in `info.duration / info.timescale` (seconds).

**MOV files** (iPhone default): Same container format as MP4, same parsing approach.

#### GPS Coordinates (Bonus)

EXIF also contains GPS data when available:

```javascript
const exif = await exifr.parse(file, {
  pick: ['GPSLatitude', 'GPSLongitude', 'GPSAltitude'],
  gps: true,  // auto-converts to decimal degrees
});
// exif.latitude, exif.longitude — ready for mapping
```

This is directly relevant to the Mapping category — photos could be plotted on a map
alongside Cyclemeter ride tracks.

### 5. Build a Scannable Index

Walking thousands of files and parsing EXIF is slow on the main thread. Use a Web Worker:

```javascript
// scanner.worker.js
self.onmessage = async ({ data: { dirHandle } }) => {
  const index = [];
  let scanned = 0;

  for await (const entry of walkDirectory(dirHandle)) {
    if (!isMediaFile(entry.name)) continue;

    const file = await entry.handle.getFile();
    const dateTaken = await getDateTaken(entry.handle, file);

    index.push({
      name: entry.name,
      path: entry.path,
      dateTaken,
      size: file.size,
      type: file.type,
      handle: entry.handle,  // keep for later thumbnail/full-res access
    });

    scanned++;
    if (scanned % 50 === 0) {
      self.postMessage({ type: 'progress', scanned });
    }
  }

  self.postMessage({ type: 'complete', index });
};
```

**Performance considerations:**
- A typical iPhone photo library: 5,000–50,000 files
- EXIF parse per file: ~1-5ms (exifr is fast, reads only requested tags)
- Full scan of 10,000 photos: ~30-60 seconds in a worker
- **Optimization**: Read only the first 64KB of each file for EXIF (sufficient for headers)
- **Caching**: Store the index in IndexedDB keyed by directory path + file count, invalidate on change

### 6. Date/Time Range Filter UI

```
┌─────────────────────────────────────────────────────┐
│  Photo Browser                                       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  📁 ~/Pictures/Photos Library   [Change Folder]      │
│  12,847 media files indexed                          │
│                                                      │
│  ┌─── Filter ───────────────────────────────────┐   │
│  │ Date: [2026-03-15] to [2026-03-15]           │   │
│  │ Time: [07:00 AM  ] to [11:30 AM  ]           │   │
│  │                                               │   │
│  │ Types: [x] Photos  [x] Videos                │   │
│  │ [Apply Filter]                  23 matches    │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐     │
│  │thumb1│ │thumb2│ │thumb3│ │thumb4│ │thumb5│      │
│  │7:02am│ │7:15am│ │8:30am│ │9:12am│ │10:45 │      │
│  │ [x]  │ │ [x]  │ │ [ ]  │ │ [x]  │ │ [x]  │      │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘     │
│                                                      │
│  [Select All] [Select None]    4 selected            │
│  [Download Selected as ZIP]  [Export to KML]         │
└─────────────────────────────────────────────────────┘
```

**Thumbnails:** Generate via `createImageBitmap()` + `OffscreenCanvas` in the worker,
or lazily via `<img src={URL.createObjectURL(file)}>` with intersection observer.

### 7. Persistent Permissions

The File System Access API supports persisting directory handles in IndexedDB:

```javascript
// Save handle
const db = await openDB('photo-browser', 1, { /* schema */ });
await db.put('handles', dirHandle, 'photos-folder');

// Restore on next visit
const savedHandle = await db.get('handles', 'photos-folder');
if (savedHandle) {
  const permission = await savedHandle.queryPermission({ mode: 'read' });
  if (permission === 'granted') {
    // Good to go — no picker needed
  } else {
    // Must re-request (browser requires user gesture)
    const result = await savedHandle.requestPermission({ mode: 'read' });
  }
}
```

User doesn't have to re-pick the folder every visit, but the browser may require a
one-click re-grant on each new session (security measure).

## Browser Compatibility

| Browser | showDirectoryPicker | OPFS | Notes |
|---------|-------------------|------|-------|
| Chrome 86+ | Yes | Yes | Full support, best target |
| Edge 86+ | Yes | Yes | Chromium-based, same as Chrome |
| Safari | **No** | Partial | No directory picker — dealbreaker on iOS |
| Firefox | **No** | Partial | Behind flag, not shipping |

**Impact:** This feature would work on desktop Chrome/Edge only. Not on iPhone Safari.
For Darwin (primarily desktop-used), this is acceptable for a brainstorm/exploration feature.

**Progressive fallback for unsupported browsers:**
```javascript
if (!('showDirectoryPicker' in window)) {
  // Fall back to <input type="file" multiple accept="image/*,video/*">
  // User manually selects files — no folder walking, but date filtering still works
}
```

## Integration with Darwin / Mapping

### Cyclemeter Ride Correlation

The most compelling use case: match photos to bike rides.

1. User loads a Cyclemeter ride (existing ETL pipeline produces KML with timestamps)
2. Ride has a date + start/end time
3. Photo browser auto-suggests that date/time window
4. Selected photos plotted on the map at their GPS coordinates alongside the ride track

```
Ride: 2026-03-15 7:00 AM → 10:30 AM
  → Auto-filter photos to that window
  → 12 photos found, 8 have GPS
  → Plot on map alongside KML track
```

### Architecture Fit

```
Darwin/src/
├── cyclemeter/          # Existing — SQLite ETL → KML
├── photo-browser/       # New — directory scanning + EXIF parsing
│   ├── PhotoBrowser.jsx        # Main component
│   ├── DirectoryScanner.js     # File system walking logic
│   ├── MetadataParser.js       # EXIF/MP4 date extraction
│   ├── scanner.worker.js       # Web Worker for background scanning
│   ├── ThumbnailGrid.jsx       # Virtualized photo grid
│   ├── DateRangeFilter.jsx     # Filter controls
│   └── index.js
└── mapping/             # Future — unified map view
    ├── MapView.jsx             # Leaflet/MapLibre map
    ├── layers/
    │   ├── KmlLayer.jsx        # Cyclemeter tracks
    │   └── PhotoLayer.jsx      # Geotagged photos as markers
    └── index.js
```

### Route

```javascript
// Add to Darwin router
{ path: '/photos', element: <PhotoBrowser /> }
// Or nested under mapping
{ path: '/mapping/photos', element: <PhotoBrowser /> }
```

## Dependencies (New)

| Package | Size | Purpose |
|---------|------|---------|
| `exifr` | ~45KB | EXIF parsing (JPEG, HEIC, TIFF, PNG) |
| `mp4box` | ~120KB | MP4/MOV metadata (video date, duration) |
| `idb` | ~5KB | IndexedDB wrapper (handle persistence, index cache) |
| `jszip` | ~45KB | ZIP download of selected files (optional) |
| `react-window` | ~15KB | Virtualized grid for thousands of thumbnails |

Total: ~230KB additional bundle weight (tree-shakeable).

No server-side dependencies. No uploads. Everything runs in the browser.

## Privacy & Security

- **No data leaves the device.** All scanning, parsing, and filtering is client-side.
- **Explicit user consent** required at every step (folder picker, permission grant).
- **Read-only access** — the API is requested with `mode: 'read'`, app cannot modify files.
- **No indexing or caching of actual images** — only metadata (date, name, size, GPS) is cached.
- **File handles in IndexedDB** are origin-scoped and cannot be accessed by other sites.

## Effort Estimate

| Component | Complexity | Notes |
|-----------|-----------|-------|
| Directory scanning + walking | Low | Straightforward async iterator |
| EXIF date extraction | Low | exifr handles the hard parts |
| Video metadata extraction | Medium | MP4 container parsing, edge cases |
| Web Worker pipeline | Medium | Message passing, progress reporting |
| IndexedDB caching | Medium | Schema design, invalidation |
| Thumbnail generation | Medium | Performance at scale, memory management |
| Date/time filter UI | Low | MUI DatePicker + TimePicker |
| Virtualized photo grid | Medium | react-window or similar |
| GPS → map plotting | Medium | Leaflet integration, marker clustering |
| Cyclemeter ride correlation | Low | Date matching against existing KML data |

**Total: Medium project — probably 2-3 focused sessions.**

## Open Questions

1. **Apple Photos library structure** — Is `Photos Library.photoslibrary/originals/` stable
   across macOS versions? Need to test.
2. **HEIC thumbnail generation** — Can `createImageBitmap()` handle HEIC? May need a
   decoder polyfill.
3. **Large libraries** — What's the UX for 50,000+ files? Progressive scanning with
   cancel? Background indexing?
4. **iCloud Photos** — Files stored in iCloud show as stubs locally. Reading them triggers
   a download. Need to detect and handle gracefully.
5. **Google Photos** — Users who sync to Google Photos have files in a different structure.
   The directory picker approach is agnostic to structure, but naming conventions differ.
6. **Video thumbnails** — Extracting a frame requires decoding. Use `<video>` element +
   canvas capture? Performance implications for many videos.
7. **Time zones** — EXIF DateTimeOriginal has no timezone info (it's local time at capture).
   GPS timestamp is UTC. Need a strategy for reconciling these.
8. **Mapping library** — Leaflet (free, lightweight) vs. MapLibre GL (vector tiles, smoother)
   vs. Google Maps (familiar but API key + costs).
