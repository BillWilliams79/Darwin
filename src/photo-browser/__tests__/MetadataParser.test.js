import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock exifr before importing MetadataParser
vi.mock('exifr', () => ({
    default: {
        parse: vi.fn(),
    },
}));

// Mock mp4box
vi.mock('mp4box', () => ({
    default: {
        createFile: vi.fn(),
    },
}));

import exifr from 'exifr';
import { getImageMetadata, getVideoMetadata, getMediaMetadata } from '../MetadataParser.js';

function makeFile(name, type = 'image/jpeg') {
    return { name, type, arrayBuffer: async () => new ArrayBuffer(0) };
}

describe('getImageMetadata', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns DateTimeOriginal and GPS when present', async () => {
        const date = new Date('2026-03-15T07:30:00');
        exifr.parse.mockResolvedValue({
            DateTimeOriginal: date,
            latitude: 37.7749,
            longitude: -122.4194,
        });

        const result = await getImageMetadata(makeFile('photo.jpg'));
        expect(result.date).toEqual(date);
        expect(result.lat).toBeCloseTo(37.7749);
        expect(result.lon).toBeCloseTo(-122.4194);
    });

    it('falls back to CreateDate when DateTimeOriginal is absent', async () => {
        const date = new Date('2026-03-15T08:00:00');
        exifr.parse.mockResolvedValue({ CreateDate: date });

        const result = await getImageMetadata(makeFile('photo.jpg'));
        expect(result.date).toEqual(date);
    });

    it('returns null date when no EXIF date fields present', async () => {
        exifr.parse.mockResolvedValue({ Make: 'Apple' });

        const result = await getImageMetadata(makeFile('photo.jpg'));
        expect(result.date).toBeNull();
        expect(result.lat).toBeNull();
        expect(result.lon).toBeNull();
    });

    it('returns all nulls when exifr returns null', async () => {
        exifr.parse.mockResolvedValue(null);

        const result = await getImageMetadata(makeFile('photo.jpg'));
        expect(result).toEqual({ date: null, lat: null, lon: null });
    });

    it('returns all nulls when exifr throws', async () => {
        exifr.parse.mockRejectedValue(new Error('Parse error'));

        const result = await getImageMetadata(makeFile('photo.jpg'));
        expect(result).toEqual({ date: null, lat: null, lon: null });
    });

    it('returns null GPS when lat/lon not numbers', async () => {
        exifr.parse.mockResolvedValue({
            DateTimeOriginal: new Date(),
            latitude: 'invalid',
            longitude: null,
        });

        const result = await getImageMetadata(makeFile('photo.jpg'));
        expect(result.lat).toBeNull();
        expect(result.lon).toBeNull();
    });
});

describe('getVideoMetadata', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns null for .avi files without calling mp4box', async () => {
        const result = await getVideoMetadata(makeFile('clip.avi', 'video/avi'));
        expect(result).toEqual({ date: null, lat: null, lon: null });
    });

    it('returns null for unknown extension', async () => {
        const result = await getVideoMetadata(makeFile('clip.webm', 'video/webm'));
        expect(result).toEqual({ date: null, lat: null, lon: null });
    });
});

describe('getMediaMetadata', () => {
    beforeEach(() => vi.clearAllMocks());

    it('dispatches to getImageMetadata for image type', async () => {
        const date = new Date('2026-03-15T09:00:00');
        exifr.parse.mockResolvedValue({ DateTimeOriginal: date });

        const result = await getMediaMetadata(makeFile('photo.jpg'), 'image');
        expect(result.date).toEqual(date);
    });

    it('dispatches to getVideoMetadata for video type', async () => {
        const result = await getMediaMetadata(makeFile('clip.avi', 'video/avi'), 'video');
        // .avi returns null
        expect(result.date).toBeNull();
    });
});
