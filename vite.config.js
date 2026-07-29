import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

function devserverMarker() {
  const markerPath = path.resolve(import.meta.dirname, '.devserver')

  function cleanup() {
    try { fs.unlinkSync(markerPath) } catch {}
  }

  return {
    name: 'devserver-marker',
    configureServer(server) {
      server.httpServer?.on('listening', () => {
        const addr = server.httpServer.address()
        const port = typeof addr === 'object' ? addr.port : addr
        // Format is `port:pid` — intentionally NO deep-link route (req #2867).
        // The deep-link route is a launch-time concept owned by the
        // /devops-devserver-start skill and surfaces only in its `url=` output.
        // Vite has no knowledge of which page the session's changes target, and
        // this workspace marker's only consumers — devserver-stop.sh and
        // run-e2e.sh — need just the port/pid, not the route.
        fs.writeFileSync(markerPath, `${port}:${process.pid}`)
      })

      process.on('SIGINT', () => { cleanup(); process.exit() })
      process.on('SIGTERM', () => { cleanup(); process.exit() })
      process.on('exit', cleanup)
    },
  }
}

// Dev-only: mount the private Topology repo's systems2/ subdir on /systems2/*.
// `apply: 'serve'` excludes this plugin (and therefore the asset payload) from
// `vite build`, so production bundles have zero topology content. See req #2521.
// V1 (systems/ subdir, /systems route) was retired in req #2525.
function topologyDevAssets(command) {
  const darwinRoot = import.meta.dirname
  const hasTopologyEntrypoint = p => {
    try {
      if (!fs.statSync(p).isDirectory()) return false
      return fs.statSync(path.join(p, 'systems2', 'nvlink_topology.html')).isFile()
    } catch { return false }
  }
  const candidates = [
    process.env.TOPOLOGY_PATH,
    path.resolve(darwinRoot, '..', 'Topology'),
    path.resolve(darwinRoot, '..', '..', 'Topology'),
    // Canonical clone location. Needed by the primary Claude session, whose
    // Darwin/ is a symlink to /Users/billw/Desktop/darwin — `darwinRoot` resolves
    // through the symlink, so the relative candidates land in Desktop/ and miss
    // the real clone at ~/Projects/DarwinAI/Topology/. Workers don't need this
    // (their Darwin/ is a real worktree dir → two-up already resolves correctly).
    path.resolve(os.homedir(), 'Projects', 'DarwinAI', 'Topology'),
  ].filter(Boolean)
  // Require the candidate to be a directory AND contain the systems2 entrypoint.
  // An empty/uninitialized submodule directory satisfies isDirectory() but lacks
  // the asset payload, causing every /systems2 request to silently 404. Probing
  // the actual entrypoint file lets the loop fall through to the next candidate
  // (typically the canonical $HOME/Projects/DarwinAI/Topology clone). Req #2519.
  let topologyPath = candidates.find(hasTopologyEntrypoint)

  // Shared-machine fallback (req #3155), dev-server only — a session whose
  // affectedRepos didn't include Topology has no `../Topology` sibling of its
  // own, and on WSL (legacy layout, req #3086 not yet cut over) there is no
  // canonical ~/Projects/DarwinAI/Topology clone either — every candidate
  // above misses, and /systems2 404s with only a misleading WebSocket/bfcache
  // line in the browser console. resolve-primary-root.sh resolves this
  // machine's primary DarwinAI-Config checkout (workspace root on legacy
  // layout, <workspace>/primary on the target layout) regardless of which
  // repos this session happens to have cloned, so its sibling Topology/ clone
  // — checked out once per machine, not per session — is reachable as a last
  // resort. Only shelled out to when the cheap candidates already missed and
  // only for `vite serve` — `vite build` never needs Topology at all (see
  // `apply: 'serve'` below) and must not pay a subprocess for nothing.
  //
  // Does NOT reach the reference Mac's primary session, whose Darwin/ is a
  // symlink through which `darwinRoot` resolves (see the comment on candidate
  // 4 above) — `resolve-primary-root.sh` lives beside the REAL checkout, not
  // the symlink target, so the script path below misses there. Candidate 4
  // is what covers that layout; this fallback is WSL/session-clone-specific.
  //
  // req #3155 was exactly a case where the only diagnostic lived in a log
  // nobody looked at — so a failure here must not repeat that silence.
  // `fallbackDiagnostic` carries the reason forward to the not-found error
  // below instead of a bare swallowed catch.
  let fallbackDiagnostic = null
  if (!topologyPath && command === 'serve') {
    const resolverScript = path.resolve(darwinRoot, '..', 'scripts', 'lib', 'resolve-primary-root.sh')
    if (!fs.existsSync(resolverScript)) {
      fallbackDiagnostic = `resolver script not found at ${resolverScript}`
    } else {
      try {
        const primaryRoot = execSync(`bash "${resolverScript}"`, {
          timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        const fallback = primaryRoot ? path.resolve(primaryRoot, 'Topology') : null
        if (fallback && hasTopologyEntrypoint(fallback)) {
          topologyPath = fallback
        } else if (fallback) {
          fallbackDiagnostic = `primary root ${primaryRoot} has no systems2/nvlink_topology.html at ${fallback}`
        } else {
          fallbackDiagnostic = 'resolve-primary-root.sh returned no output'
        }
      } catch (err) {
        const stderr = err.stderr ? String(err.stderr).trim() : err.message
        fallbackDiagnostic = `resolve-primary-root.sh failed: ${stderr}`
      }
    }
  }

  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  }

  return {
    name: 'topology-dev-assets',
    apply: 'serve',
    configureServer(server) {
      if (!topologyPath) {
        // Error (not warn) so the message renders in red and survives runs
        // configured with `logLevel: 'warn'` or stricter — a silent warn
        // previously hid the failure until users hit a broken iframe. Options:
        // `clear: false` skips clearing the current screen on emit; `timestamp:
        // true` adds a time prefix that anchors the failure in time. Neither
        // option immunizes against future log lines, but error-level + red is
        // visually loud enough to catch on next glance. See req #2540.
        server.config.logger.error(
          '[topology-dev-assets] no Topology clone found; /systems2 routes will 404. ' +
          'Set TOPOLOGY_PATH, clone https://github.com/BillWilliams79/Topology to ' +
          '~/Projects/DarwinAI/Topology/, or check this machine\'s primary DarwinAI-Config ' +
          "checkout for a Topology/ clone (req #3155 fallback)." +
          (fallbackDiagnostic ? ` [fallback diagnostic: ${fallbackDiagnostic}]` : ''),
          { clear: false, timestamp: true }
        )
        return
      }
      server.config.logger.info(`[topology-dev-assets] serving /systems2 from ${topologyPath}`)

      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        const match = url.match(/^\/systems2(?:\/(.*?))?(?:\?.*)?$/)
        if (!match) return next()
        const rest = match[1]
        // Bare /systems2 (with or without trailing slash) must fall through to
        // the SPA router so the React wrapper mounts inside the Darwin app shell
        // (navbar + auth). Without this guard, hitting the path directly or
        // hard-refreshing bypassed React entirely and served the raw HTML,
        // dropping the Darwin navbar (req #2524). The middleware now only serves
        // explicit /systems2/<filename> asset paths; SystemsPage2.jsx points its
        // iframe at the entry HTML file so the assets still load via this
        // middleware.
        if (!rest) return next()
        // Path-traversal guard: reject any segment that resolves to ".."
        if (rest.split('/').some(seg => seg === '..' || seg === '')) return next()

        const subdirRoot = path.resolve(topologyPath, 'systems2')
        const filePath = path.resolve(subdirRoot, rest)
        // Defense-in-depth: after path.resolve, ensure the resolved path is
        // still under subdirRoot. The segment-level check above already
        // blocks `..` and empty segments; this catches anything exotic
        // (symlink escape, normalized weirdness) that slipped past.
        if (filePath !== subdirRoot && !filePath.startsWith(subdirRoot + path.sep)) {
          return next()
        }
        let stat
        try { stat = fs.statSync(filePath) } catch { return next() }
        if (!stat.isFile()) return next()

        const ext = path.extname(filePath).toLowerCase()
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
        res.setHeader('Content-Length', stat.size)
        // Disable browser caching for Topology assets in dev (req #2524). Without this,
        // edits to nvlink_topology.html / styles.css / topology.js are masked by the
        // browser's stale cache on plain Cmd+R reloads — the symptom was an unstyled
        // navbar (stale styles.css) requiring tab close+reopen. The middleware doesn't
        // participate in Vite's HMR (the Topology repo lives outside Vite's module
        // graph), so manual reload is the iteration loop and it must serve fresh files.
        res.setHeader('Cache-Control', 'no-store')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

export default defineConfig(({ command }) => {
  // Read swarm manifest only in dev server mode — skipped during production builds
  let devReqId = ''
  let devReqTitle = ''
  if (command === 'serve') {
    const manifestPath = path.resolve(import.meta.dirname, '..', '.swarm-manifest.json')
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        const reqId = manifest.reqId ?? ''
        const taskName = manifest.taskName ?? ''
        if (reqId) {
          devReqId = String(reqId)
          const darwinRead = path.resolve(import.meta.dirname, '..', 'scripts', 'mcp', 'darwin-read.sh')
          try {
            const out = execSync(
              `MCP_CALL_SCRIPT=vite-config bash "${darwinRead}" "darwin://requirements/${reqId}"`,
              { timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
            )
            const req = JSON.parse(out.trim())
            devReqTitle = req.title ?? taskName
          } catch {
            devReqTitle = taskName
          }
        }
      } catch {}
    }
  }

  return {
    plugins: [react(), basicSsl(), devserverMarker(), topologyDevAssets(command)],
    define: {
      global: 'globalThis',
      'import.meta.env.VITE_DEV_REQ_ID': JSON.stringify(devReqId),
      'import.meta.env.VITE_DEV_REQ_TITLE': JSON.stringify(devReqTitle),
    },
    resolve: {
      alias: { buffer: 'buffer/' },
      // Force a single instance of these packages. A worktree's deps can be
      // reachable via more than one physical path (e.g. a stray symlink into
      // another clone's node_modules), and Vite's optimizeDeps will then
      // nondeterministically resolve a subset of modules through the second
      // path — loading two copies of @emotion/react + @mui. Two emotion caches
      // means ThemeProvider's theme is invisible to half the components, which
      // renders as random, partial dark-mode breakage. dedupe guarantees one
      // instance regardless of how the package is reached. See req #2774.
      dedupe: [
        'react',
        'react-dom',
        '@emotion/react',
        '@emotion/styled',
        '@mui/material',
        '@mui/system',
      ],
    },
    worker: {
      format: 'es',
    },
    server: {
      port: 3000,
      proxy: {
        '/photos': {
          target: 'http://localhost:8091',
          changeOrigin: true,
        },
      },
    },
  }
})
