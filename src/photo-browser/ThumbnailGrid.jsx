import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Grid } from 'react-window';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';

import { getFileHandleWithFallback } from './DirectoryScanner.js';
import { PHOTOS_PROXY_URL } from './proxyConfig.js';

const CELL_SIZE = 160;
const CELL_GAP = 2;

/**
 * Build a proxy URL for a Photos Library path.
 * Strips the "Photos Library.photoslibrary/" prefix if present
 * (proxy paths are relative to the library root).
 */
export function proxyFileUrl(itemPath, { quality } = {}) {
    const libPrefix = 'Photos Library.photoslibrary/';
    const relPath = itemPath.startsWith(libPrefix) ? itemPath.slice(libPrefix.length) : itemPath;
    const qs = quality === 'full' ? '?quality=full' : '';
    // Encode each path segment individually, preserving slashes
    const encoded = relPath.split('/').map(encodeURIComponent).join('/');
    return `${PHOTOS_PROXY_URL}/photos/file/${encoded}${qs}`;
}

/**
 * Individual thumbnail cell — lazy-loads the image/video via FileSystem API.
 */
const ThumbnailCell = React.memo(({ item, dirHandle, isSelected, onToggleSelect, onOpenLightbox, index }) => {
    const [objectUrl, setObjectUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [isImageBlob, setIsImageBlob] = useState(false); // true when proxy served an image derivative (even for videos)
    const urlRef = useRef(null);

    useEffect(() => {
        if (!item) return;
        let cancelled = false;

        (async () => {
            // Try dirHandle first (works for loose folders)
            if (dirHandle) {
                try {
                    const handle = await getFileHandleWithFallback(dirHandle, item.path);
                    const file = await handle.getFile();
                    const url = URL.createObjectURL(file);
                    if (!cancelled) {
                        urlRef.current = url;
                        setObjectUrl(url);
                        setIsImageBlob(false);
                        setLoading(false);
                    } else {
                        URL.revokeObjectURL(url);
                    }
                    return;
                } catch {
                    // dirHandle failed — fall through to proxy
                }
            }

            // Fallback: fetch from proxy (Photos Library items)
            try {
                const url = proxyFileUrl(item.path);
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`${resp.status}`);
                const blob = await resp.blob();
                const blobUrl = URL.createObjectURL(blob);
                if (!cancelled) {
                    urlRef.current = blobUrl;
                    setObjectUrl(blobUrl);
                    // Proxy may serve JPEG derivative even for video items
                    setIsImageBlob(blob.type.startsWith('image/'));
                    setLoading(false);
                } else {
                    URL.revokeObjectURL(blobUrl);
                }
            } catch {
                if (!cancelled) {
                    setError(true);
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
        };
    }, [dirHandle, item?.path]);

    const handleImageClick = useCallback((e) => {
        e.stopPropagation();
        onOpenLightbox(index);
    }, [index, onOpenLightbox]);

    const handleCheckboxClick = useCallback((e) => {
        e.stopPropagation();
        onToggleSelect(item.path);
    }, [item?.path, onToggleSelect]);

    return (
        <Box
            sx={{
                width: CELL_SIZE,
                height: CELL_SIZE,
                position: 'relative',
                bgcolor: 'action.hover',
                overflow: 'hidden',
                cursor: 'pointer',
                boxSizing: 'border-box',
            }}
            onClick={handleImageClick}
        >
            {loading && !error && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                    <CircularProgress size={24} />
                </Box>
            )}

            {error && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                    <BrokenImageIcon sx={{ fontSize: 32, color: 'text.disabled' }} />
                </Box>
            )}

            {objectUrl && (
                (item.mediaType === 'video' && !isImageBlob) ? (
                    <video
                        src={objectUrl}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        muted
                        preload="metadata"
                    />
                ) : (
                    <img
                        src={objectUrl}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={() => { setError(true); setObjectUrl(null); }}
                    />
                )
            )}

            {/* Video badge — top-right */}
            {item?.mediaType === 'video' && (
                <PlayCircleOutlineIcon
                    sx={{
                        position: 'absolute', top: 4, right: 4,
                        fontSize: 20, color: 'white',
                        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))',
                    }}
                />
            )}

            {/* GPS dot — bottom-right */}
            {item?.lat != null && (
                <FiberManualRecordIcon
                    sx={{
                        position: 'absolute', bottom: 18, right: 4,
                        fontSize: 10, color: '#4CAF50',
                        filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.6))',
                    }}
                />
            )}

        </Box>
    );
});
ThumbnailCell.displayName = 'ThumbnailCell';

/**
 * react-window v2 cellComponent — receives { columnIndex, rowIndex, style, ...cellProps }
 */
const GridCell = ({ columnIndex, rowIndex, style, items, dirHandle, selectedPaths, onToggleSelect, onOpenLightbox, columnCount }) => {
    const idx = rowIndex * columnCount + columnIndex;
    if (idx >= items.length) return <div style={style} />;
    const item = items[idx];
    return (
        <div style={{ ...style, padding: CELL_GAP / 2 }}>
            <ThumbnailCell
                item={item}
                dirHandle={dirHandle}
                isSelected={selectedPaths.has(item.path)}
                onToggleSelect={onToggleSelect}
                onOpenLightbox={onOpenLightbox}
                index={idx}
            />
        </div>
    );
};

/**
 * ThumbnailGrid
 * Props:
 *   items: Array of index entries { name, path, dateTaken, lat, lon, size, mediaType }
 *   dirHandle: FileSystemDirectoryHandle (restored from IndexedDB)
 *   selectedPaths: Set<string>
 *   onToggleSelect: (path: string) => void
 *   onOpenLightbox: (index: number) => void
 *   height: number (container height in px, defaults to window.innerHeight - 300)
 */
const ThumbnailGrid = ({ items, dirHandle, selectedPaths, onToggleSelect, onOpenLightbox, height }) => {
    const containerRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => {
            setContainerWidth(entry.contentRect.width);
        });
        ro.observe(el);
        setContainerWidth(el.getBoundingClientRect().width);
        return () => ro.disconnect();
    }, []);

    const columnCount = Math.max(1, Math.floor(containerWidth / (CELL_SIZE + CELL_GAP)));
    const rowCount = Math.ceil(items.length / columnCount);
    const gridHeight = height ?? Math.max(300, window.innerHeight - 320);

    if (!items.length) {
        return (
            <Box sx={{ py: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">No photos match this filter.</Typography>
            </Box>
        );
    }

    return (
        <Box ref={containerRef} sx={{ width: '100%' }}>
            {containerWidth > 0 && (
                <Grid
                    key={items.length}
                    cellComponent={GridCell}
                    cellProps={{ items, dirHandle, selectedPaths, onToggleSelect, onOpenLightbox, columnCount }}
                    columnCount={columnCount}
                    columnWidth={CELL_SIZE + CELL_GAP}
                    defaultHeight={gridHeight}
                    defaultWidth={containerWidth}
                    rowCount={rowCount}
                    rowHeight={CELL_SIZE + CELL_GAP}
                    overscanCount={2}
                />
            )}
        </Box>
    );
};

export default ThumbnailGrid;
