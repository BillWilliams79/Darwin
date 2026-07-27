// darwinDevMcp.ts — drive the Darwin MCP tools against `darwin_dev` from a test
// (req #3118).
//
// The mutation-replay half of the acceptance battery must exercise the REAL MCP
// tools — create_pipeline_step, set_step_deps, drop_pipeline_step — through the
// REAL wrapper (`scripts/mcp/darwin-tool.sh`, the always-via-wrapper policy of
// req #2365). It must not exercise them against production `darwin`, where
// `pipelines` stays EMPTY until the Primary's live-plan cutover.
//
// Those two constraints meet at `scripts/mcp/darwin-dev-mcp.sh`: a second daemon,
// same code, `DARWIN_DATABASE=darwin_dev`, its own port and pid file. This module
// is only the thin Node side of it — start it, point `MCP_URL` at it, run the
// ordinary wrappers, parse what they print.
//
// IDENTITY NOTE. That daemon authenticates as the USER's Darwin account (the MCP
// credentials), not as the E2E test user the browser specs use. So the rows this
// module creates are owned by the user and are invisible to pipelines.spec.ts —
// which is the intent: the two halves of the battery share a database and
// nothing else.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// The workspace root is the directory that owns `scripts/` — found by walking up
// from the working directory rather than counted in `../`s from the module.
// Playwright loads these files as ESM (no `__dirname`), the suite can be invoked
// from either the workspace root or Darwin/, and req #3077 already moved this
// tree once; a search that names what it is looking for survives all three.
function findRepoRoot(): string {
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
        if (existsSync(path.join(dir, 'scripts/mcp/darwin-dev-mcp.sh'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error('darwinDevMcp: could not locate scripts/mcp/darwin-dev-mcp.sh '
        + `above ${process.cwd()}`);
}

const REPO_ROOT = findRepoRoot();
const DEV_MCP = path.join(REPO_ROOT, 'scripts/mcp/darwin-dev-mcp.sh');
const READ = path.join(REPO_ROOT, 'scripts/mcp/darwin-read.sh');
const TOOL = path.join(REPO_ROOT, 'scripts/mcp/darwin-tool.sh');

let mcpUrl: string | null = null;

async function sh(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
    return execFileAsync('bash', [script, ...args], {
        cwd: REPO_ROOT,
        env: { ...process.env, ...env },
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
    });
}

/**
 * Start (or adopt) the darwin_dev daemon. Idempotent; returns its MCP URL.
 *
 * The script writes its diagnostics (`error=`, `remedy=`, `detail=`) to STDOUT
 * and exits non-zero, which makes execFile REJECT — and Node's rejection message
 * is `Command failed: <cmd>` plus stderr, which is empty here. Catching and
 * re-throwing with `stdout` attached is what keeps the script's carefully
 * written failure text from being discarded at exactly the moment it matters.
 */
export async function ensureDevMcp(): Promise<string> {
    let stdout: string;
    try {
        ({ stdout } = await sh(DEV_MCP, ['ensure']));
    } catch (err) {
        const out = (err as { stdout?: string }).stdout || '';
        throw new Error(`darwin-dev-mcp ensure failed:\n${out}\n${String(err)}`);
    }
    const status = /^status=(\S+)$/m.exec(stdout)?.[1];
    const url = /^url=(\S+)$/m.exec(stdout)?.[1];
    const database = /^database=(\S+)$/m.exec(stdout)?.[1];
    if ((status !== 'started' && status !== 'already_running') || !url) {
        throw new Error(`darwin-dev-mcp ensure failed:\n${stdout}`);
    }
    // The script probes the live daemon for this rather than echoing what it
    // set — re-checking it here costs nothing and means no caller can reach the
    // mutation tools without production having been ruled out twice.
    if (database !== 'darwin_dev') {
        throw new Error(`refusing to run mutations against database '${database}':\n${stdout}`);
    }
    mcpUrl = url;
    return url;
}

export async function stopDevMcp(): Promise<void> {
    try { await sh(DEV_MCP, ['stop']); } catch { /* best-effort */ }
    mcpUrl = null;
}

function requireUrl(): string {
    if (!mcpUrl) throw new Error('ensureDevMcp() must run before any darwin_dev MCP call');
    return mcpUrl;
}

/**
 * The wrappers print the tool/resource text content on stdout and their
 * telemetry markers on stderr, so the payload is stdout's first non-marker line.
 */
function parsePayload(stdout: string, what: string): unknown {
    const line = stdout.split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('{') || l.startsWith('['));
    if (!line) throw new Error(`${what}: no JSON payload in wrapper output:\n${stdout}`);
    try {
        return JSON.parse(line);
    } catch (err) {
        throw new Error(`${what}: unparseable payload: ${line.slice(0, 400)}`);
    }
}

/** Read a darwin:// resource from the darwin_dev daemon. */
export async function devRead<T = unknown>(uri: string): Promise<T> {
    const { stdout } = await sh(READ, [uri], { MCP_URL: requireUrl() });
    return parsePayload(stdout, `read ${uri}`) as T;
}

/**
 * Call an MCP tool against darwin_dev and return its echo.
 *
 * Every pipeline tool answers with the FULL affected state read back from the
 * database (req #3113), and a refusal comes back as `{error: ...}` with a zero
 * exit code — so an unchecked call looks exactly like a successful one. This
 * throws on `error`, which is what makes "verify the echo, never trust the send"
 * (req #2828) enforceable from a test.
 */
export async function devTool<T = Record<string, unknown>>(
    name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { stdout } = await sh(TOOL, [name, JSON.stringify(args)], { MCP_URL: requireUrl() });
    const payload = parsePayload(stdout, `tool ${name}`) as Record<string, unknown>;
    if (payload && typeof payload === 'object' && 'error' in payload) {
        throw new Error(`tool ${name} refused: ${String(payload.error)}`);
    }
    return payload as T;
}

/**
 * Call a tool that is EXPECTED to refuse, and return the refusal message.
 *
 * Design rules 4 and 8 are only real if the guards fire, so the battery asserts
 * the refusals as carefully as the successes — and a guard that silently stopped
 * refusing would otherwise read as a pass.
 */
export async function devToolExpectError(
    name: string, args: Record<string, unknown> = {}): Promise<string> {
    const { stdout } = await sh(TOOL, [name, JSON.stringify(args)], { MCP_URL: requireUrl() });
    const payload = parsePayload(stdout, `tool ${name}`) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object' || !('error' in payload)) {
        throw new Error(`tool ${name} was expected to refuse but returned: `
            + `${JSON.stringify(payload).slice(0, 400)}`);
    }
    return String(payload.error);
}
