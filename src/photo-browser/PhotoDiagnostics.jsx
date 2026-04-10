/**
 * PhotoDiagnostics.jsx
 * Connection diagnostics panel for the Photos proxy.
 * Runs multiple probe techniques to diagnose browser security blocking
 * (mixed content, Private Network Access, CORS, etc.)
 *
 * Always rendered — works whether proxy is connected or not.
 */

import React, { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';

import { PHOTOS_PROXY_URL } from './proxyConfig.js';

const DIRECT_PROXY_URL = 'http://localhost:8091';
const PROBE_TIMEOUT = 4000;

// ── Environment snapshot (no network) ────────────────────────────────

function collectEnvironment() {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    let browserVersion = null;
    let macosVersion = null;

    if (ua.includes('Firefox')) {
        browser = 'Firefox';
        browserVersion = ua.match(/Firefox\/([\d.]+)/)?.[1] ?? null;
    } else if (ua.includes('Edg/')) {
        browser = 'Edge';
        browserVersion = ua.match(/Edg\/([\d.]+)/)?.[1] ?? null;
    } else if (ua.includes('Chrome') && !ua.includes('Edg')) {
        browser = 'Chrome';
        browserVersion = ua.match(/Chrome\/([\d.]+)/)?.[1] ?? null;
    } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
        browser = 'Safari';
        browserVersion = ua.match(/Version\/([\d.]+)/)?.[1] ?? null;
    }

    // Parse macOS version from UA: "Mac OS X 10_15_7" or "Mac OS X 15_3"
    const macMatch = ua.match(/Mac OS X (\d+[_.\d]+)/);
    if (macMatch) {
        macosVersion = macMatch[1].replace(/_/g, '.');
    }

    // Check for CSP meta tag
    const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');

    return {
        browser,
        browserVersion,
        macosVersion,
        userAgent: ua,
        platform: navigator.platform,
        isSecureContext: window.isSecureContext,
        protocol: window.location.protocol,
        origin: window.location.origin,
        cookieEnabled: navigator.cookieEnabled,
        serviceWorkerRegistered: 'serviceWorker' in navigator,
        connectionType: navigator.connection?.effectiveType ?? null,
        language: navigator.language,
        cspMetaTag: cspMeta ? cspMeta.getAttribute('content') : null,
        isDev: import.meta.env.DEV,
        appProxyUrl: PHOTOS_PROXY_URL || '(empty — Vite proxy)',
        directProxyUrl: DIRECT_PROXY_URL,
    };
}

// ── Probe helpers ────────────────────────────────────────────────────

/** Probe the actual app code path (uses PHOTOS_PROXY_URL, which may be Vite-proxied in dev) */
async function probeAppPath() {
    const url = `${PHOTOS_PROXY_URL}/photos/health`;
    const start = Date.now();
    try {
        const resp = await fetch(url, {
            signal: AbortSignal.timeout(PROBE_TIMEOUT),
        });
        const data = await resp.json();
        return { success: true, elapsed: Date.now() - start, url, data };
    } catch (err) {
        return { success: false, elapsed: Date.now() - start, url, error: err.message, errorType: err.name };
    }
}

/** Probe direct to proxy (always http://localhost:8091, bypasses Vite proxy) */
async function probeFetchDirect() {
    const start = Date.now();
    try {
        const resp = await fetch(`${DIRECT_PROXY_URL}/photos/health`, {
            signal: AbortSignal.timeout(PROBE_TIMEOUT),
        });
        const data = await resp.json();
        return { success: true, elapsed: Date.now() - start, data };
    } catch (err) {
        return { success: false, elapsed: Date.now() - start, error: err.message, errorType: err.name };
    }
}

async function probeFetchNoCors() {
    const start = Date.now();
    try {
        const resp = await fetch(`${DIRECT_PROXY_URL}/photos/health`, {
            mode: 'no-cors',
            signal: AbortSignal.timeout(PROBE_TIMEOUT),
        });
        // Opaque response: status=0, can't read body, but no throw = request reached server
        return { success: true, elapsed: Date.now() - start, responseType: resp.type, status: resp.status };
    } catch (err) {
        return { success: false, elapsed: Date.now() - start, error: err.message, errorType: err.name };
    }
}

function probeImage() {
    const start = Date.now();
    return new Promise((resolve) => {
        const img = new Image();
        const timeout = setTimeout(() => {
            img.onload = img.onerror = null;
            resolve({ success: false, elapsed: Date.now() - start, error: 'Timeout' });
        }, PROBE_TIMEOUT);
        img.onload = () => {
            clearTimeout(timeout);
            resolve({ success: true, elapsed: Date.now() - start });
        };
        img.onerror = () => {
            clearTimeout(timeout);
            resolve({ success: false, elapsed: Date.now() - start, error: 'Image load blocked or failed' });
        };
        img.src = `${DIRECT_PROXY_URL}/photos/probe.gif?t=${Date.now()}`;
    });
}

function probeJSONP() {
    const start = Date.now();
    const cbName = `__darwinProbe_${Date.now()}`;
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            cleanup();
            resolve({ success: false, elapsed: Date.now() - start, error: 'Timeout' });
        }, PROBE_TIMEOUT);

        const script = document.createElement('script');

        function cleanup() {
            clearTimeout(timeout);
            delete window[cbName];
            script.remove();
        }

        window[cbName] = (data) => {
            cleanup();
            resolve({ success: true, elapsed: Date.now() - start, data });
        };

        script.onerror = () => {
            cleanup();
            resolve({ success: false, elapsed: Date.now() - start, error: 'Script load blocked or failed' });
        };

        script.src = `${DIRECT_PROXY_URL}/photos/probe.js?cb=${cbName}&t=${Date.now()}`;
        document.head.appendChild(script);
    });
}

function probeXHR() {
    const start = Date.now();
    return new Promise((resolve) => {
        try {
            const xhr = new XMLHttpRequest();
            const timeout = setTimeout(() => {
                xhr.abort();
                resolve({ success: false, elapsed: Date.now() - start, error: 'Timeout' });
            }, PROBE_TIMEOUT);
            xhr.open('GET', `${DIRECT_PROXY_URL}/photos/health`);
            xhr.onload = () => {
                clearTimeout(timeout);
                try {
                    const data = JSON.parse(xhr.responseText);
                    resolve({ success: true, elapsed: Date.now() - start, status: xhr.status, data });
                } catch {
                    resolve({ success: true, elapsed: Date.now() - start, status: xhr.status });
                }
            };
            xhr.onerror = () => {
                clearTimeout(timeout);
                resolve({ success: false, elapsed: Date.now() - start, error: 'XHR blocked or network error' });
            };
            xhr.send();
        } catch (err) {
            resolve({ success: false, elapsed: Date.now() - start, error: err.message });
        }
    });
}

function getPerformanceEntries() {
    try {
        const entries = performance.getEntriesByType('resource')
            .filter(e => e.name.includes('localhost:8091') || e.name.includes('probe') || e.name.includes('/photos/health'))
            .slice(-10)
            .map(e => ({
                name: e.name.replace(/.*localhost:\d+/, '').replace(/https?:\/\/[^/]+/, ''),
                duration: Math.round(e.duration),
                transferSize: e.transferSize,
                blocked: e.duration === 0 && e.transferSize === 0,
            }));
        return entries.length > 0 ? entries : null;
    } catch {
        return null;
    }
}

// ── CSP violation capture ────────────────────────────────────────────

function createCSPCapture() {
    const violations = [];
    const handler = (e) => {
        violations.push({
            blockedURI: e.blockedURI,
            violatedDirective: e.violatedDirective,
            originalPolicy: e.originalPolicy?.slice(0, 200),
        });
    };
    document.addEventListener('securitypolicyviolation', handler);
    return {
        violations,
        cleanup: () => document.removeEventListener('securitypolicyviolation', handler),
    };
}

// ── Diagnosis logic ──────────────────────────────────────────────────

function diagnose(results) {
    if (!results) return null;

    const { appPath, fetchDirect, fetchNoCors, image, jsonp, xhr } = results.probes;

    // App path works (even if direct fails) — the app code path is functional
    if (appPath.success && !fetchDirect.success) {
        return {
            severity: 'success',
            message: 'App connection working via Vite proxy. Direct localhost access is blocked (expected in dev mode). Photos will work.',
        };
    }

    // Everything works
    if (appPath.success && fetchDirect.success) {
        return { severity: 'success', message: 'All connections working. Proxy is fully reachable via both app path and direct access.' };
    }

    // App path fails but direct works — unusual
    if (!appPath.success && fetchDirect.success) {
        return { severity: 'warning', message: 'Direct proxy access works but the app code path fails. Check PHOTOS_PROXY_URL configuration.' };
    }

    // Both fail — check patterns
    const directProbes = [fetchDirect, fetchNoCors, image, jsonp, xhr];
    const allBlocked = directProbes.every(p => !p.success);
    const allFast = directProbes.every(p => p.elapsed < 50);

    // CSP violations detected
    if (results.cspViolations?.length > 0) {
        return {
            severity: 'error',
            message: `Content Security Policy is blocking connections. Directive: ${results.cspViolations[0].violatedDirective}. CSP must allow connect-src to localhost:8091.`,
        };
    }

    // fetch blocked but passive probes work → mixed content
    if (!fetchDirect.success && (image.success || jsonp.success)) {
        return {
            severity: 'error',
            message: 'Mixed content blocking detected. Browser blocks fetch/XHR to http://localhost from this HTTPS page, but passive loads (images/scripts) work. Fix: proxy needs HTTPS support.',
        };
    }

    // Everything blocked instantly → browser security policy
    if (allBlocked && allFast) {
        const browser = results.environment.browser;
        const msg = browser === 'Safari'
            ? 'All probes blocked instantly by Safari. Safari prevents all access from HTTPS pages to HTTP localhost. Fix: proxy needs HTTPS support, or check System Settings > Privacy & Security > Local Network for Safari.'
            : 'All probes blocked instantly. Browser is preventing all access to localhost from this HTTPS page.';
        return { severity: 'error', message: msg };
    }

    // Everything blocked with slow timing → proxy not running
    if (allBlocked && !allFast) {
        return {
            severity: 'warning',
            message: 'All probes failed with network timeouts. The Photos proxy may not be running on port 8091. Check that Darwin Photos is launched.',
        };
    }

    // no-cors works but cors doesn't → CORS header issue
    if (!fetchDirect.success && fetchNoCors.success) {
        return {
            severity: 'warning',
            message: 'Server is reachable (no-cors probe passed) but CORS headers may be misconfigured. The proxy may need updated CORS or Private Network Access headers.',
        };
    }

    return { severity: 'info', message: 'Partial connectivity. Review individual probe results below for details.' };
}

// ── Probe definitions for display ────────────────────────────────────

const PROBE_DEFS = [
    { key: 'appPath', label: 'App code path', desc: 'The actual fetch path the app uses (Vite proxy in dev, direct in prod)' },
    { key: 'fetchDirect', label: 'fetch() direct', desc: 'Direct to http://localhost:8091 — tests cross-origin/mixed content' },
    { key: 'fetchNoCors', label: 'fetch(no-cors)', desc: 'Opaque request — tests if server is reachable at all' },
    { key: 'image', label: '<img> probe', desc: 'Passive mixed content — browsers may allow images when fetch is blocked' },
    { key: 'jsonp', label: '<script> JSONP', desc: 'Script tag — different mixed content rules than fetch' },
    { key: 'xhr', label: 'XMLHttpRequest', desc: 'Legacy XHR — may have different behavior than fetch' },
];

// ── Component ────────────────────────────────────────────────────────

const PhotoDiagnostics = () => {
    const [results, setResults] = useState(null);
    const [running, setRunning] = useState(false);
    const [copied, setCopied] = useState(false);

    const runDiagnostics = useCallback(async () => {
        setRunning(true);
        setResults(null);
        setCopied(false);

        // Clear previous performance entries for clean measurement
        performance.clearResourceTimings?.();

        const environment = collectEnvironment();

        // Start capturing CSP violations before probes
        const cspCapture = createCSPCapture();

        // Run all probes concurrently
        const [appPathResult, fetchDirectResult, fetchNoCorsResult, imageResult, jsonpResult, xhrResult] =
            await Promise.all([
                probeAppPath(),
                probeFetchDirect(),
                probeFetchNoCors(),
                probeImage(),
                probeJSONP(),
                probeXHR(),
            ]);

        // Small delay for CSP events and performance entries to settle
        await new Promise(r => setTimeout(r, 200));

        const perfEntries = getPerformanceEntries();
        const cspViolations = cspCapture.violations.length > 0 ? cspCapture.violations : null;
        cspCapture.cleanup();

        const report = {
            timestamp: new Date().toISOString(),
            pageUrl: window.location.href,
            environment,
            probes: {
                appPath: appPathResult,
                fetchDirect: fetchDirectResult,
                fetchNoCors: fetchNoCorsResult,
                image: imageResult,
                jsonp: jsonpResult,
                xhr: xhrResult,
            },
            cspViolations,
            performanceEntries: perfEntries,
        };

        setResults(report);
        setRunning(false);
    }, []);

    const handleCopy = useCallback(async () => {
        if (!results) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(results, null, 2));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = JSON.stringify(results, null, 2);
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }, [results]);

    const diagnosis = diagnose(results);

    return (
        <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>DIAGNOSTICS</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Tests multiple connection methods to diagnose browser security blocking.
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={running ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                    onClick={runDiagnostics}
                    disabled={running}
                >
                    {running ? 'Running...' : 'Run Diagnostics'}
                </Button>
                {results && (
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ContentCopyIcon />}
                        onClick={handleCopy}
                    >
                        {copied ? 'Copied!' : 'Copy Results'}
                    </Button>
                )}
            </Box>

            {/* Diagnosis summary */}
            {diagnosis && (
                <Box sx={{
                    p: 1.5, mb: 2, borderRadius: 1,
                    bgcolor: diagnosis.severity === 'success' ? 'success.main'
                        : diagnosis.severity === 'error' ? 'error.main'
                        : diagnosis.severity === 'warning' ? 'warning.main' : 'info.main',
                    color: diagnosis.severity === 'warning' ? 'warning.contrastText' : '#fff',
                }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {diagnosis.message}
                    </Typography>
                </Box>
            )}

            {/* Environment */}
            {results && (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                        ENVIRONMENT
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                        <Chip label={`${results.environment.browser} ${results.environment.browserVersion || ''}`} size="small" variant="outlined" />
                        {results.environment.macosVersion && (
                            <Chip label={`macOS ${results.environment.macosVersion}`} size="small" variant="outlined" />
                        )}
                        <Chip label={results.environment.protocol} size="small" variant="outlined" />
                        <Chip
                            label={results.environment.isSecureContext ? 'Secure Context' : 'Insecure Context'}
                            size="small" variant="outlined"
                            color={results.environment.isSecureContext ? 'success' : 'warning'}
                        />
                        <Chip label={results.environment.isDev ? 'DEV' : 'PROD'} size="small" variant="outlined"
                            color={results.environment.isDev ? 'info' : 'default'} />
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                        App proxy: {results.environment.appProxyUrl} | Direct: {results.environment.directProxyUrl}
                    </Typography>
                    {results.environment.cspMetaTag && (
                        <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.25, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                            CSP meta: {results.environment.cspMetaTag}
                        </Typography>
                    )}
                </Box>
            )}

            {/* CSP violations */}
            {results?.cspViolations && (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
                        CSP VIOLATIONS DETECTED
                    </Typography>
                    {results.cspViolations.map((v, i) => (
                        <Typography key={i} variant="caption" color="error.main" display="block"
                            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', mt: 0.25 }}>
                            {v.violatedDirective}: blocked {v.blockedURI}
                        </Typography>
                    ))}
                </Box>
            )}

            {/* Probe results */}
            {results && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                        PROBE RESULTS
                    </Typography>
                    {PROBE_DEFS.map(({ key, label, desc }) => {
                        const probe = results.probes[key];
                        if (!probe) return null;
                        return (
                            <Box
                                key={key}
                                sx={{
                                    display: 'flex', alignItems: 'flex-start', gap: 1,
                                    p: 1, borderRadius: 1, bgcolor: 'action.hover',
                                }}
                            >
                                {probe.success
                                    ? <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20, mt: 0.25 }} />
                                    : <CancelIcon sx={{ color: 'error.main', fontSize: 20, mt: 0.25 }} />
                                }
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="body2" sx={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                            {label}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {probe.elapsed}ms
                                        </Typography>
                                    </Box>
                                    <Typography variant="caption" color="text.secondary" display="block">
                                        {desc}
                                    </Typography>
                                    {probe.url && (
                                        <Typography variant="caption" color="text.secondary" display="block"
                                            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', mt: 0.25, opacity: 0.7 }}>
                                            {probe.url}
                                        </Typography>
                                    )}
                                    {probe.error && (
                                        <Typography variant="caption" color="error.main" display="block"
                                            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', mt: 0.25, wordBreak: 'break-all' }}>
                                            {probe.errorType ? `${probe.errorType}: ` : ''}{probe.error}
                                        </Typography>
                                    )}
                                    {probe.note && (
                                        <Typography variant="caption" color="text.secondary" display="block"
                                            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', mt: 0.25 }}>
                                            {probe.note}
                                        </Typography>
                                    )}
                                    {probe.data && (
                                        <Typography variant="caption" color="success.main" display="block"
                                            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', mt: 0.25 }}>
                                            {typeof probe.data === 'object' ? JSON.stringify(probe.data) : probe.data}
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            )}

            {/* Performance entries */}
            {results?.performanceEntries && (
                <Box sx={{ mt: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                        RESOURCE TIMING
                    </Typography>
                    <Box
                        component="pre"
                        sx={{
                            fontSize: '0.7rem', fontFamily: 'monospace',
                            bgcolor: 'action.hover', p: 1, borderRadius: 1,
                            maxHeight: 150, overflow: 'auto',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all', mt: 0.5,
                        }}
                    >
                        {results.performanceEntries.map((e) =>
                            `${e.name}  ${e.duration}ms  ${e.transferSize}B${e.blocked ? '  BLOCKED' : ''}`
                        ).join('\n')}
                    </Box>
                </Box>
            )}
        </Box>
    );
};

export default PhotoDiagnostics;
