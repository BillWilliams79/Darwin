import { describe, it, expect, beforeEach } from 'vitest';
import useScanStore from '../useScanStore.js';

// Reset store between tests
beforeEach(() => {
    useScanStore.setState({
        dirHandle: null,
        folderName: '',
        index: [],
        scanState: 'idle',
        scanProgress: { scanned: 0 },
        scanElapsed: 0,
        scanError: null,
        selectedPaths: new Set(),
    });
});

describe('useScanStore initial state', () => {
    it('has correct defaults', () => {
        const s = useScanStore.getState();
        expect(s.dirHandle).toBeNull();
        expect(s.folderName).toBe('');
        expect(s.index).toEqual([]);
        expect(s.scanState).toBe('idle');
        expect(s.scanProgress).toEqual({ scanned: 0 });
        expect(s.scanElapsed).toBe(0);
        expect(s.scanError).toBeNull();
        expect(s.selectedPaths.size).toBe(0);
    });
});

describe('setIndex', () => {
    it('replaces the index array', () => {
        const items = [
            { name: 'a.jpg', path: 'a.jpg', dateTaken: null, mediaType: 'image' },
            { name: 'b.mp4', path: 'b.mp4', dateTaken: null, mediaType: 'video' },
        ];
        useScanStore.getState().setIndex(items);
        expect(useScanStore.getState().index).toEqual(items);
    });
});

describe('toggleSelection', () => {
    it('adds a path to selectedPaths', () => {
        useScanStore.getState().toggleSelection('originals/A/photo.jpg');
        expect(useScanStore.getState().selectedPaths.has('originals/A/photo.jpg')).toBe(true);
    });

    it('removes a path that is already selected', () => {
        useScanStore.getState().toggleSelection('originals/A/photo.jpg');
        useScanStore.getState().toggleSelection('originals/A/photo.jpg');
        expect(useScanStore.getState().selectedPaths.has('originals/A/photo.jpg')).toBe(false);
    });

    it('handles multiple distinct paths', () => {
        useScanStore.getState().toggleSelection('a.jpg');
        useScanStore.getState().toggleSelection('b.jpg');
        expect(useScanStore.getState().selectedPaths.size).toBe(2);
    });
});

describe('clearSelection', () => {
    it('empties selectedPaths', () => {
        useScanStore.getState().toggleSelection('a.jpg');
        useScanStore.getState().toggleSelection('b.jpg');
        useScanStore.getState().clearSelection();
        expect(useScanStore.getState().selectedPaths.size).toBe(0);
    });
});

describe('selectAll', () => {
    it('fills selectedPaths with given paths', () => {
        const paths = ['a.jpg', 'b.jpg', 'c.mp4'];
        useScanStore.getState().selectAll(paths);
        const selected = useScanStore.getState().selectedPaths;
        expect(selected.size).toBe(3);
        expect(selected.has('a.jpg')).toBe(true);
        expect(selected.has('c.mp4')).toBe(true);
    });

    it('replaces any previous selection', () => {
        useScanStore.getState().toggleSelection('old.jpg');
        useScanStore.getState().selectAll(['new.jpg']);
        const selected = useScanStore.getState().selectedPaths;
        expect(selected.has('old.jpg')).toBe(false);
        expect(selected.has('new.jpg')).toBe(true);
    });
});

describe('setScanState', () => {
    it('updates scanState', () => {
        useScanStore.getState().setScanState('scanning');
        expect(useScanStore.getState().scanState).toBe('scanning');
        useScanStore.getState().setScanState('complete');
        expect(useScanStore.getState().scanState).toBe('complete');
    });
});

describe('setScanProgress', () => {
    it('updates scanProgress', () => {
        useScanStore.getState().setScanProgress({ scanned: 500 });
        expect(useScanStore.getState().scanProgress.scanned).toBe(500);
    });
});
