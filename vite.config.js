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
        fs.writeFileSync(markerPath, `${port}:${process.pid}`)
      })

      process.on('SIGINT', () => { cleanup(); process.exit() })
      process.on('SIGTERM', () => { cleanup(); process.exit() })
      process.on('exit', cleanup)
    },
  }
}

// Dev-only: mount the private Topology repo's systems2/ subdir on /systems2/*
// AND the build-visualizer/ subdir on /build-visualizer/* (req #2564).
// `apply: 'serve'` excludes this plugin (and therefore the asset payload) from
// `vite build`, so production bundles have zero topology content. See req #2521.
// V1 (systems/ subdir, /systems route) was retired in req #2525.
function topologyDevAssets() {
  const darwinRoot = import.meta.dirname
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
  const topologyPath = candidates.find(p => {
    try {
      if (!fs.statSync(p).isDirectory()) return false
      return fs.statSync(path.join(p, 'systems2', 'nvlink_topology.html')).isFile()
    } catch { return false }
  })

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
          'Set TOPOLOGY_PATH or clone https://github.com/BillWilliams79/Topology to ~/Projects/DarwinAI/Topology/.',
          { clear: false, timestamp: true }
        )
        return
      }
      server.config.logger.info(`[topology-dev-assets] serving /systems2 and /build-visualizer from ${topologyPath}`)

      // Persistence endpoint for the build visualizer (req #2564).
      // POST /build-visualizer/builds.json rewrites builds.json in the Topology
      // clone with the request body. Restricted to that exact path; refuses path
      // traversal; DEV-only (this plugin sets `apply: 'serve'`).
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST') return next()
        const url = req.url || ''
        if (!url.startsWith('/build-visualizer/builds.json')) return next()
        const target = path.resolve(topologyPath, 'build-visualizer', 'builds.json')
        const root = path.resolve(topologyPath, 'build-visualizer')
        if (!target.startsWith(root + path.sep)) {
          res.statusCode = 400
          res.end('bad path')
          return
        }
        const MAX_BYTES = 4 * 1024 * 1024 // 4 MB ceiling — JSON for ~thousands of builds tops out far below this
        let body = ''
        let aborted = false
        req.setEncoding('utf8')
        req.on('data', chunk => {
          if (aborted) return
          body += chunk
          if (body.length > MAX_BYTES) {
            aborted = true
            res.statusCode = 413
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end('payload too large')
            try { req.destroy() } catch {}
          }
        })
        req.on('end', () => {
          if (aborted) return
          try {
            JSON.parse(body) // validate
          } catch (e) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end('invalid JSON: ' + e.message)
            return
          }
          try {
            fs.writeFileSync(target, body)
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end('{"status":"ok"}')
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end('write failed: ' + e.message)
          }
        })
        req.on('error', () => {
          res.statusCode = 500
          res.end('request error')
        })
      })

      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        const match = url.match(/^\/(systems2|build-visualizer)(?:\/(.*?))?(?:\?.*)?$/)
        if (!match) return next()
        const subdir = match[1]
        const rest = match[2]
        // Bare /systems2 or /build-visualizer (with or without trailing slash)
        // must fall through to the SPA router so the React wrappers mount inside
        // the Darwin app shell (navbar + auth). Without this guard, hitting
        // those paths directly or hard-refreshing bypassed React entirely and
        // served the raw HTML, dropping the Darwin navbar (req #2524). The
        // middleware now only serves explicit /<subdir>/<filename> asset paths;
        // SystemsPage2.jsx and BuildVisualizerPage.jsx point their iframes at
        // the entry HTML files so the assets still load via this middleware.
        if (!rest) return next()
        // Path-traversal guard: reject any segment that resolves to ".."
        if (rest.split('/').some(seg => seg === '..' || seg === '')) return next()

        const subdirRoot = path.resolve(topologyPath, subdir)
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
    plugins: [react(), basicSsl(), devserverMarker(), topologyDevAssets()],
    define: {
      global: 'globalThis',
      'import.meta.env.VITE_DEV_REQ_ID': JSON.stringify(devReqId),
      'import.meta.env.VITE_DEV_REQ_TITLE': JSON.stringify(devReqTitle),
    },
    resolve: {
      alias: { buffer: 'buffer/' },
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
