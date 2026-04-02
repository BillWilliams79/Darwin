import { describe, it, expect } from 'vitest';
import { walkDirectory, getFileHandle, getFileHandleWithFallback, MEDIA_EXTENSIONS } from '../DirectoryScanner.js';

/**
 * Build a mock FileSystemDirectoryHandle from an object tree.
 * Tree format: { 'filename.jpg': null, 'subdir': { 'nested.png': null } }
 */
function makeHandle(name, tree) {
    async function* entriesGen() {
        for (const [childName, childTree] of Object.entries(tree)) {
            if (childTree === null) {
                yield [childName, { kind: 'file', name: childName }];
            } else {
                yield [childName, makeHandle(childName, childTree)];
            }
        }
    }

    return {
        kind: 'directory',
        name,
        entries: entriesGen,
        getDirectoryHandle: async (n) => {
            const child = tree[n];
            if (!child || child === null) throw new Error(`Not a dir: ${n}`);
            return makeHandle(n, child);
        },
        getFileHandle: async (n) => {
            if (!(n in tree) || tree[n] !== null) throw new Error(`No file: ${n}`);
            return { kind: 'file', name: n };
        },
    };
}

describe('walkDirectory', () => {
    it('yields media files in a flat directory', async () => {
        const dir = makeHandle('root', {
            'photo.jpg': null,
            'video.mp4': null,
            'doc.pdf': null,
            'text.txt': null,
        });

        const results = [];
        for await (const entry of walkDirectory(dir)) {
            results.push(entry);
        }

        expect(results).toHaveLength(2);
        expect(results.map(r => r.name).sort()).toEqual(['photo.jpg', 'video.mp4']);
    });

    it('recurses into subdirectories', async () => {
        const dir = makeHandle('root', {
            'top.jpg': null,
            'subdir': {
                'nested.png': null,
                'deep': {
                    'deeper.heic': null,
                },
            },
        });

        const results = [];
        for await (const entry of walkDirectory(dir)) {
            results.push(entry);
        }

        expect(results).toHaveLength(3);
        const names = results.map(r => r.name).sort();
        expect(names).toEqual(['deeper.heic', 'nested.png', 'top.jpg']);
    });

    it('builds correct relative paths', async () => {
        const dir = makeHandle('root', {
            'subdir': {
                'photo.jpg': null,
            },
        });

        const results = [];
        for await (const entry of walkDirectory(dir)) {
            results.push(entry);
        }

        expect(results[0].path).toBe('subdir/photo.jpg');
    });

    it('assigns mediaType image for image extensions', async () => {
        const dir = makeHandle('root', {
            'img.jpg': null,
            'img.heic': null,
            'img.png': null,
        });

        const results = [];
        for await (const entry of walkDirectory(dir)) {
            results.push(entry);
        }

        expect(results.every(r => r.mediaType === 'image')).toBe(true);
    });

    it('assigns mediaType video for video extensions', async () => {
        const dir = makeHandle('root', {
            'clip.mp4': null,
            'clip.mov': null,
            'clip.m4v': null,
            'clip.avi': null,
        });

        const results = [];
        for await (const entry of walkDirectory(dir)) {
            results.push(entry);
        }

        expect(results.every(r => r.mediaType === 'video')).toBe(true);
    });

    it('excludes non-media files', async () => {
        const dir = makeHandle('root', {
            'file.pdf': null,
            'file.docx': null,
            'file.zip': null,
            'file.txt': null,
        });

        const results = [];
        for await (const entry of walkDirectory(dir)) {
            results.push(entry);
        }

        expect(results).toHaveLength(0);
    });

    it('handles case-insensitive extensions', async () => {
        const dir = makeHandle('root', {
            'IMG_001.JPG': null,
            'VIDEO.MP4': null,
        });

        const results = [];
        for await (const entry of walkDirectory(dir)) {
            results.push(entry);
        }

        expect(results).toHaveLength(2);
    });
});

describe('getFileHandle', () => {
    it('resolves a flat path', async () => {
        const dir = makeHandle('root', { 'photo.jpg': null });
        const handle = await getFileHandle(dir, 'photo.jpg');
        expect(handle.name).toBe('photo.jpg');
    });

    it('resolves a nested path', async () => {
        const dir = makeHandle('root', {
            'originals': {
                'A': {
                    'uuid.jpg': null,
                },
            },
        });
        const handle = await getFileHandle(dir, 'originals/A/uuid.jpg');
        expect(handle.name).toBe('uuid.jpg');
    });

    it('throws on missing path', async () => {
        const dir = makeHandle('root', {});
        await expect(getFileHandle(dir, 'missing.jpg')).rejects.toThrow();
    });
});

describe('getFileHandleWithFallback', () => {
    it('resolves a valid path (delegates to getFileHandle)', async () => {
        const dir = makeHandle('root', {
            'originals': {
                'A': {
                    'uuid.jpg': null,
                },
            },
        });
        const handle = await getFileHandleWithFallback(dir, 'originals/A/uuid.jpg');
        expect(handle.name).toBe('uuid.jpg');
    });

    it('throws descriptive error on missing path', async () => {
        const dir = makeHandle('root', {});
        await expect(getFileHandleWithFallback(dir, 'originals/A/missing.jpg'))
            .rejects.toThrow('Could not resolve: originals/A/missing.jpg');
    });
});

describe('MEDIA_EXTENSIONS', () => {
    it('contains expected image extensions', () => {
        expect(MEDIA_EXTENSIONS.has('.jpg')).toBe(true);
        expect(MEDIA_EXTENSIONS.has('.heic')).toBe(true);
        expect(MEDIA_EXTENSIONS.has('.png')).toBe(true);
        expect(MEDIA_EXTENSIONS.has('.tiff')).toBe(true);
    });

    it('contains expected video extensions', () => {
        expect(MEDIA_EXTENSIONS.has('.mp4')).toBe(true);
        expect(MEDIA_EXTENSIONS.has('.mov')).toBe(true);
        expect(MEDIA_EXTENSIONS.has('.avi')).toBe(true);
    });

    it('does not contain non-media extensions', () => {
        expect(MEDIA_EXTENSIONS.has('.pdf')).toBe(false);
        expect(MEDIA_EXTENSIONS.has('.txt')).toBe(false);
        expect(MEDIA_EXTENSIONS.has('.zip')).toBe(false);
    });
});
