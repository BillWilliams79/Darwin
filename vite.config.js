import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import fs from 'node:fs'
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

// Dev-only: mount the private Topology repo's systems/ and systems2/ subdirs
// on /systems/* and /systems2/* URLs. `apply: 'serve'` excludes this plugin
// (and therefore the asset payload) from `vite build`, so production bundles
// have zero topology content. See req #2521.
function topologyDevAssets() {
  const darwinRoot = import.meta.dirname
  const candidates = [
    process.env.TOPOLOGY_PATH,
    path.resolve(darwinRoot, '..', 'Topology'),
    path.resolve(darwinRoot, '..', '..', 'Topology'),
  ].filter(Boolean)
  const topologyPath = candidates.find(p => {
    try { return fs.statSync(p).isDirectory() } catch { return false }
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
        server.config.logger.warn(
          '[topology-dev-assets] no Topology clone found; /systems* routes will 404. ' +
          'Set TOPOLOGY_PATH or clone https://github.com/BillWilliams79/Topology to ~/Projects/DarwinAI/Topology/.'
        )
        return
      }
      server.config.logger.info(`[topology-dev-assets] serving /systems and /systems2 from ${topologyPath}`)

      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        const match = url.match(/^\/(systems2?)(?:\/(.*?))?(?:\?.*)?$/)
        if (!match) return next()
        const subdir = match[1]
        const rest = match[2] || 'nvlink_topology.html'
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
