/**
 * DirectoryScanner.js
 * Recursively walks a FileSystemDirectoryHandle and yields media file entries.
 */

export const MEDIA_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tiff',
    '.mov', '.mp4', '.m4v', '.avi',
]);

const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v', '.avi']);

// macOS package extensions that may contain media files inside.
// The browser reports these as kind:'file' even though they're directories on disk.
// We force directory access via getDirectoryHandle() on the parent.
const PACKAGE_EXTENSIONS = new Set(['.photoslibrary']);

// Inside a .photoslibrary, scan originals (best metadata) + resources (always-local display copies).
// Skip 'database', 'private', 'internal', 'external', 'scopes'.
const PHOTOSLIBRARY_ALLOWED_DIRS = new Set(['originals', 'resources']);

/**
 * Returns the lowercase file extension including the dot, e.g. ".jpg"
 */
function getExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

/**
 * Async generator that recursively walks a directory handle.
 * Yields { name, path, handle, size, mediaType } for each media file found.
 *
 * Handles macOS packages (.photoslibrary) that the browser reports as files
 * by forcing directory access through the parent handle.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} basePath - relative path prefix (used in recursion)
 */
export async function* walkDirectory(dirHandle, basePath = '', diag = null, insidePhotosLibrary = false) {
    let entries;
    try {
        entries = dirHandle.entries();
    } catch (err) {
        if (diag) diag(`ERR entries() on "${basePath || '/'}" → ${err.name}: ${err.message}`);
        return;
    }

    let entryCount = 0;
    for await (const [name, handle] of entries) {
        entryCount++;
        const fullPath = basePath ? `${basePath}/${name}` : name;
        if (handle.kind === 'directory') {
            // Detect .photoslibrary packages entered as directories (after Full Disk Access)
            const isPhotosPackage = name.endsWith('.photoslibrary');
            const enteringPhotosLibrary = insidePhotosLibrary || isPhotosPackage;

            // Inside a .photoslibrary top level, only descend into 'originals'
            if (insidePhotosLibrary && !isPhotosPackage && !PHOTOSLIBRARY_ALLOWED_DIRS.has(name)) {
                if (diag) diag(`SKIP dir "${fullPath}" (not in originals)`);
                continue;
            }

            // Once inside originals/, allow all subdirectories (hex buckets 0-F)
            const childInsidePhotosLibrary = isPhotosPackage;

            if (diag && entryCount <= 20) diag(`DIR  ${fullPath}${isPhotosPackage ? ' [photos package]' : ''}`);
            try {
                yield* walkDirectory(handle, fullPath, diag, childInsidePhotosLibrary);
            } catch (err) {
                if (diag) diag(`ERR  recurse "${fullPath}" → ${err.name}: ${err.message}`);
                // Surface TCC-blocked directories so the caller can report them
                if (err.name === 'NoModificationAllowedError') {
                    yield { name, path: fullPath, handle: null, mediaType: '_blocked', error: err.message };
                }
            }
        } else {
            const ext = getExtension(name);
            if (MEDIA_EXTENSIONS.has(ext)) {
                const mediaType = VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image';
                yield { name, path: fullPath, handle, mediaType };
            } else if (PACKAGE_EXTENSIONS.has(ext)) {
                if (diag) diag(`PKG  ${fullPath} (kind:${handle.kind}) — trying getDirectoryHandle...`);
                try {
                    const pkgHandle = await dirHandle.getDirectoryHandle(name);
                    if (diag) diag(`PKG  ${fullPath} → opened as directory, recursing into originals only`);
                    yield* walkDirectory(pkgHandle, fullPath, diag, true);
                } catch (err) {
                    if (diag) diag(`PKG  ${fullPath} → FAILED: ${err.name}: ${err.message}`);
                }
            } else if (diag && entryCount <= 20) {
                diag(`SKIP ${fullPath} (kind:${handle.kind}, ext:${ext})`);
            }
        }
    }
    if (diag && (basePath === '' || basePath.split('/').length <= 2)) {
        diag(`DONE "${basePath || '/'}" — ${entryCount} entries`);
    }
}

/**
 * Navigates a path string through a root FileSystemDirectoryHandle to reach a file handle.
 * Used to lazily resolve file handles from stored index paths.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} path - relative path, e.g. "originals/A/uuid.jpg"
 * @returns {Promise<FileSystemFileHandle>}
 */
export async function getFileHandle(rootHandle, path) {
    const parts = path.split('/');
    let current = rootHandle;
    for (const part of parts.slice(0, -1)) {
        current = await current.getDirectoryHandle(part);
    }
    return await current.getFileHandle(parts[parts.length - 1]);
}

/**
 * Try to resolve a file handle with fallback for Apple Photos Library items.
 * Tries the primary path first (originals/). If that fails (iCloud stub or missing),
 * provides a descriptive error. Derivative fallback can be added here later without
 * changing callers.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} primaryPath - e.g. "originals/A/IMG_1234.HEIC"
 * @returns {Promise<FileSystemFileHandle>}
 */
export async function getFileHandleWithFallback(rootHandle, primaryPath) {
    try {
        return await getFileHandle(rootHandle, primaryPath);
    } catch {
        // TODO: try derivative paths for iCloud stubs
        // e.g. resources/derivatives/{uuid_prefix}/...
        throw new Error(`Could not resolve: ${primaryPath}`);
    }
}
