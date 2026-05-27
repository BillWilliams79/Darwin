// @vitest-environment jsdom
//
// Tests for the standalone-runtime persistence adapter (req #2703). The
// adapter lives in the Topology repo (BillWilliams79/Topology) and is
// imported here via the worktree-relative path so embedded-mode coverage
// and adapter coverage live in the same test runner.
//
// Why jsdom: the adapter relies on window.localStorage and the global Blob
// constructor. jsdom provides both. fetch is not provided by jsdom so each
// test that exercises a fetch path stubs global.fetch directly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LocalStorageAdapter,
  BV_LOCALSTORAGE_KEY,
  BV_ACTIVE_PATTERN_KEY,
} from '../../../../Topology/build-visualizer/localStorageAdapter.js';

const STARTER = {
  version: 1,
  currentMajor: 5,
  currentMinor: 0,
  nextBuildNumber: 1,
  nextBranchNumber: 1,
  initialBuildNumber: 1,
  branches: [{ id: 'main', type: 'main', name: 'Main', buildIds: [] }],
  builds: {},
};

const makeOkResponse = (body) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});

describe('LocalStorageAdapter', () => {
  let originalFetch;

  beforeEach(() => {
    window.localStorage.clear();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uses the documented storage key constant', () => {
    expect(BV_LOCALSTORAGE_KEY).toBe('darwin.buildVisualizer.builds.v1');
    expect(BV_ACTIVE_PATTERN_KEY).toBe('darwin.buildVisualizer.activePattern.v1');
    const a = new LocalStorageAdapter();
    expect(a.storageKey).toBe(BV_LOCALSTORAGE_KEY);
    expect(a.url).toBe('./builds.json');
  });

  it('honours parameterized url and storageKey (multi-pattern mode)', async () => {
    const a = new LocalStorageAdapter('./patterns/sprint.json', `${BV_LOCALSTORAGE_KEY}::sprint`);
    expect(a.url).toBe('./patterns/sprint.json');
    expect(a.storageKey).toBe(`${BV_LOCALSTORAGE_KEY}::sprint`);
    await a.save({ toJSON: () => STARTER });
    expect(window.localStorage.getItem(`${BV_LOCALSTORAGE_KEY}::sprint`)).not.toBeNull();
    // Default key untouched — proves per-pattern isolation.
    expect(window.localStorage.getItem(BV_LOCALSTORAGE_KEY)).toBeNull();
  });

  it('per-pattern adapters do not share storage', async () => {
    const a = new LocalStorageAdapter('./patterns/a.json', `${BV_LOCALSTORAGE_KEY}::a`);
    const b = new LocalStorageAdapter('./patterns/b.json', `${BV_LOCALSTORAGE_KEY}::b`);
    await a.save({ toJSON: () => ({ ...STARTER, marker: 'A' }) });
    await b.save({ toJSON: () => ({ ...STARTER, marker: 'B' }) });
    const fromA = JSON.parse(window.localStorage.getItem(`${BV_LOCALSTORAGE_KEY}::a`));
    const fromB = JSON.parse(window.localStorage.getItem(`${BV_LOCALSTORAGE_KEY}::b`));
    expect(fromA.marker).toBe('A');
    expect(fromB.marker).toBe('B');
  });

  describe('load()', () => {
    it('falls back to fetch when localStorage is empty', async () => {
      global.fetch = vi.fn().mockResolvedValue(makeOkResponse(STARTER));
      const a = new LocalStorageAdapter();
      const data = await a.load();
      expect(data).toEqual(STARTER);
      expect(global.fetch).toHaveBeenCalledWith('./builds.json', { cache: 'no-store' });
    });

    it('falls back to fetch when localStorage holds invalid JSON', async () => {
      window.localStorage.setItem(BV_LOCALSTORAGE_KEY, 'not-json{{{');
      global.fetch = vi.fn().mockResolvedValue(makeOkResponse(STARTER));
      const a = new LocalStorageAdapter();
      const data = await a.load();
      expect(data).toEqual(STARTER);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('returns the localStorage state when present and valid (no fetch)', async () => {
      const stored = { ...STARTER, version: 1, marker: 'from-localstorage' };
      window.localStorage.setItem(BV_LOCALSTORAGE_KEY, JSON.stringify(stored));
      global.fetch = vi.fn();
      const a = new LocalStorageAdapter();
      const data = await a.load();
      expect(data).toEqual(stored);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('propagates fetch failure when localStorage is empty', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const a = new LocalStorageAdapter();
      await expect(a.load()).rejects.toThrow(/Load failed: 404/);
    });
  });

  describe('save()', () => {
    it('round-trips through localStorage in the model.toJSON() shape', async () => {
      const a = new LocalStorageAdapter();
      const model = { toJSON: () => STARTER };
      await a.save(model);
      const stored = JSON.parse(window.localStorage.getItem(BV_LOCALSTORAGE_KEY));
      expect(stored).toEqual(STARTER);
    });

    it('propagates a thrown localStorage error (quota / private mode)', async () => {
      const a = new LocalStorageAdapter();
      const spy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
        const err = new Error('QuotaExceededError');
        throw err;
      });
      await expect(a.save({ toJSON: () => STARTER })).rejects.toThrow(/QuotaExceededError/);
      spy.mockRestore();
    });
  });

  describe('exportJson()', () => {
    // jsdom's Blob doesn't implement `.text()`; FileReader.readAsText works
    // because jsdom polyfills it (and it's the canonical pre-stream API).
    const blobText = (blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

    it('returns a Blob with the latest saved bytes', async () => {
      const a = new LocalStorageAdapter();
      await a.save({ toJSON: () => STARTER });
      const blob = a.exportJson();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/json');
      const text = await blobText(blob);
      expect(JSON.parse(text)).toEqual(STARTER);
    });

    it('returns an empty-object Blob when nothing has been saved', async () => {
      const a = new LocalStorageAdapter();
      const blob = a.exportJson();
      const text = await blobText(blob);
      expect(text).toBe('{}');
    });
  });

  describe('importJson()', () => {
    it('rejects non-JSON input', () => {
      const a = new LocalStorageAdapter();
      expect(() => a.importJson('not-json{{')).toThrow(/Invalid JSON/);
    });

    it('rejects arrays at the top level', () => {
      const a = new LocalStorageAdapter();
      expect(() => a.importJson(JSON.stringify([1, 2, 3]))).toThrow(/top-level must be an object/);
    });

    it('rejects objects missing branches[]', () => {
      const a = new LocalStorageAdapter();
      expect(() => a.importJson('{"version":1}')).toThrow(/missing branches\[\] array/);
    });

    it('writes valid input to localStorage and returns the parsed object', () => {
      const a = new LocalStorageAdapter();
      const result = a.importJson(JSON.stringify(STARTER));
      expect(result).toEqual(STARTER);
      const stored = JSON.parse(window.localStorage.getItem(BV_LOCALSTORAGE_KEY));
      expect(stored).toEqual(STARTER);
    });
  });

  describe('reset()', () => {
    it('clears localStorage and re-fetches the bundled starter', async () => {
      window.localStorage.setItem(BV_LOCALSTORAGE_KEY, JSON.stringify({ marker: 'stale' }));
      global.fetch = vi.fn().mockResolvedValue(makeOkResponse(STARTER));
      const a = new LocalStorageAdapter();
      const data = await a.reset();
      expect(data).toEqual(STARTER);
      expect(window.localStorage.getItem(BV_LOCALSTORAGE_KEY)).toBeNull();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('propagates fetch failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      const a = new LocalStorageAdapter();
      await expect(a.reset()).rejects.toThrow(/Reset failed: 500/);
    });
  });
});
