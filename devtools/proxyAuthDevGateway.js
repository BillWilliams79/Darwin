// proxyAuthDevGateway.js — a DEV-ONLY stand-in for the internal product's front door (req #4076).
//
// In `proxy` auth mode the browser holds no credential: on the VM, nginx
// authenticates the user and the internal API Gateway (req #4079) maps them to
// a `profiles` row. A dev server has neither, so without this a proxy-auth
// product cannot be reviewed before the VM API exists. This plugin plays that
// part on the Vite dev server only (`apply: 'serve'`, so it is never in a
// build): every `/api/<internal db>/…` request is forwarded to the darwin.one
// API's `darwin_dev` database, authorised SERVER-SIDE with the developer's own
// headless Cognito identity (the darwin-mcp daemon's, ~/.darwin-credentials/
// mcp_credentials.sh — the same USER_PASSWORD_AUTH flow as
// darwin-mcp/darwin_rest/auth.py). The browser never sees the token, exactly
// as it never sees one behind nginx.
//
// Default upstream: always `darwin_dev`, never darwin.one production — a review
// server writes test data.
//
// SECOND UPSTREAM (req #4151): `VITE_DEV_GATEWAY_UPSTREAM=internal` forwards
// instead to the REAL internal API Gateway on chn-vm-topology — the internal
// product's own `internal` database, with no AWS anywhere on the path — signed
// with the gateway's interim basic-auth login, held server-side as above
// (~/.darwin-credentials/internal_mcp_credentials.sh, written by
// `bash scripts/mcp/darwin-target.sh setup internal`, whose CA file pins the
// VM's self-signed certificate). That is what lets a dev server show the
// internal Swarm pages with the data the internal swarm writes, before the
// app is deployed to the VM. The path is pinned to `/internal/` the same way.
// That database is the internal product's LIVE one (it has no dev copy): a
// write made on such a dev server is a real internal write, exactly as the
// internal swarm's own daemon makes them. Opt-in only.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import https from 'node:https'

const DEV_DATABASE = 'darwin_dev'
const REFRESH_MARGIN_S = 300

// `export NAME=value` / `NAME="value"` lines; no shell is run.
export function parseCredentialsFile(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

// `/api/internal/profiles?x=1` → `<upstream>/darwin_dev/profiles?x=1`, or null
// for anything outside the internal database (nginx answers those 404) — and
// null for any dot segment, raw or percent-encoded: `fetch` normalises
// `darwin_dev/%2e%2e/darwin/…` to `/darwin/…`, which would put the developer's
// identity on PRODUCTION (code review, req #4076). The resolved target is then
// re-checked to sit under `<upstream>/darwin_dev/`, whatever the input was.
export function upstreamUrl(url, { apiBase, database, upstreamBase, upstreamDatabase = DEV_DATABASE }) {
  const prefix = `${apiBase}/${database}`
  if (url !== prefix && !url.startsWith(`${prefix}/`) && !url.startsWith(`${prefix}?`)) return null
  const rest = url.slice(prefix.length)
  const restPath = rest.split('?')[0]
  let decoded
  try { decoded = decodeURIComponent(restPath) } catch { return null }
  if (decoded.split('/').some(seg => seg === '.' || seg === '..') || decoded.includes('\\')) return null
  let target
  try { target = new URL(`${upstreamBase}/${upstreamDatabase}${rest}`) } catch { return null }
  const pinned = new URL(`${upstreamBase}/${upstreamDatabase}`)
  if (target.origin !== pinned.origin) return null
  if (target.pathname !== pinned.pathname && !target.pathname.startsWith(`${pinned.pathname}/`)) return null
  return target.href
}

// The gateway signs requests with the developer's identity server-side, so a
// request another site's page makes to localhost would be signed too. Only
// the dev server's own pages may use it: a cross-site `Origin`/`Sec-Fetch-Site`
// is refused (a same-origin GET may carry neither, which is fine).
export function isCrossSite(headers, host) {
  const site = headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return true
  const origin = headers.origin
  if (!origin) return false
  try { return new URL(origin).host !== host } catch { return true }
}

function makeTokenProvider(creds) {
  let cached = null
  return async function idToken() {
    const now = Date.now() / 1000
    if (cached && cached.exp - REFRESH_MARGIN_S > now) return cached.token
    const { COGNITO_CLIENT_ID: clientId, COGNITO_CLIENT_SECRET: secret,
      MCP_COGNITO_USERNAME: username, MCP_COGNITO_PASSWORD: password } = creds
    const secretHash = crypto.createHmac('sha256', secret).update(username + clientId).digest('base64')
    const res = await fetch(`https://cognito-idp.${creds.COGNITO_REGION || 'us-west-1'}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      },
      body: JSON.stringify({
        AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId,
        AuthParameters: { USERNAME: username, PASSWORD: password, SECRET_HASH: secretHash },
      }),
    })
    if (!res.ok) throw new Error(`Cognito InitiateAuth failed: HTTP ${res.status}`)
    const token = (await res.json()).AuthenticationResult.IdToken
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    cached = { token, exp: payload.exp }
    return token
  }
}

// The internal upstream's settings from its credentials file (req #4151):
// base URL, the one database it serves, the basic-auth header and the CA file.
// Refuses anything aimed at AWS or darwin.one — the internal product never is.
export function internalUpstream(creds) {
  const base = (creds.DARWIN_API_BASE || '').replace(/\/+$/, '')
  const database = creds.DARWIN_DATABASE || ''
  const user = creds.INTERNAL_API_USER || ''
  const password = creds.INTERNAL_API_PASSWORD || ''
  if (!base || !database || !user || !password) throw new Error('internal credentials incomplete')
  if (/amazonaws\.com|darwin\.one/i.test(base)) throw new Error(`internal upstream ${base} is not internal`)
  if (database !== 'internal') throw new Error(`internal upstream database ${database} is not internal`)
  return {
    upstreamBase: base,
    upstreamDatabase: database,
    authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64'),
    caFile: creds.DARWIN_CA_BUNDLE || '',
  }
}

// The internal credentials file only NAMES the gateway login (it sources
// internal_api_credentials.sh, so the secret has one home); read both.
function readInternalCreds(credsPath) {
  const creds = parseCredentialsFile(fs.readFileSync(credsPath, 'utf8'))
  const login = process.env.INTERNAL_GATEWAY_LOGIN_FILE
    || path.join(path.dirname(credsPath), 'internal_api_credentials.sh')
  if ((!creds.INTERNAL_API_USER || !creds.INTERNAL_API_PASSWORD) && fs.existsSync(login)) {
    Object.assign(creds, parseCredentialsFile(fs.readFileSync(login, 'utf8')))
  }
  return creds
}

// fetch() cannot take a CA bundle, so the internal upstream goes through
// node:https with the VM's certificate as the ONLY trusted root.
function httpsRequest(url, { method, headers, body, ca }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, ca, timeout: 30000 }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'], body: Buffer.concat(chunks) }))
    })
    req.on('timeout', () => req.destroy(new Error('upstream timeout')))
    req.on('error', reject)
    if (body && body.length) req.write(body)
    req.end()
  })
}

export function proxyAuthDevGateway(command, product, env) {
  return {
    name: 'proxy-auth-dev-gateway',
    apply: 'serve',
    configureServer(server) {
      if (command !== 'serve' || product.authMode !== 'proxy') return
      const log = server.config.logger
      const database = env.VITE_DARWIN_DATABASE
      const internal = env.VITE_DEV_GATEWAY_UPSTREAM === 'internal'
      const credsPath = env.VITE_DEV_GATEWAY_CREDENTIALS
        || path.join(process.env.HOME || '', '.darwin-credentials',
          internal ? 'internal_mcp_credentials.sh' : 'mcp_credentials.sh')
      let creds
      let upstream = null
      try {
        creds = internal ? readInternalCreds(credsPath) : parseCredentialsFile(fs.readFileSync(credsPath, 'utf8'))
        if (internal) {
          upstream = internalUpstream(creds)
          upstream.ca = upstream.caFile ? fs.readFileSync(upstream.caFile) : undefined
        }
      } catch (err) {
        creds = null
        log.error(`[proxy-auth-dev-gateway] cannot use ${credsPath}: ${err.message} — /api requests will 502`,
          { timestamp: true })
      }
      const upstreamBase = internal ? (upstream?.upstreamBase || '')
        : (creds?.DARWIN_API_BASE || '').replace(/\/(darwin|darwin_dev)\/?$/, '').replace(/\/+$/, '')
      const upstreamDatabase = internal ? 'internal' : DEV_DATABASE
      const idToken = creds && !internal ? makeTokenProvider(creds) : null
      log.info(`[proxy-auth-dev-gateway] ${product.apiBase}/${database}/* → ${upstreamBase}/${upstreamDatabase}/* `
        + `(${internal ? 'the internal VM gateway, basic auth' : 'server-side identity'}; dev only)`)

      server.middlewares.use(async (req, res, next) => {
        const target = upstreamUrl(req.url || '', { apiBase: product.apiBase, database, upstreamBase, upstreamDatabase })
        if (!target) {
          if ((req.url || '').startsWith(`${product.apiBase}/`)) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            return res.end(JSON.stringify('NOT FOUND'))
          }
          return next()
        }
        if (isCrossSite(req.headers || {}, req.headers?.host)) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify('FORBIDDEN'))
        }
        try {
          if ((!idToken && !upstream) || !upstreamBase) throw new Error('no dev gateway credentials')
          const chunks = []
          for await (const c of req) chunks.push(c)
          if (upstream) {
            const r = await httpsRequest(target, {
              method: req.method,
              headers: { 'Content-Type': 'application/json', Authorization: upstream.authorization },
              body: ['GET', 'HEAD'].includes(req.method) ? null : Buffer.concat(chunks),
              ca: upstream.ca,
            })
            res.statusCode = r.status
            res.setHeader('Content-Type', r.contentType || 'application/json')
            return res.end(r.body)
          }
          const upstreamRes = await fetch(target, {
            method: req.method,
            headers: { 'Content-Type': 'application/json', Authorization: await idToken() },
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
          })
          res.statusCode = upstreamRes.status
          res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/json')
          res.end(Buffer.from(await upstreamRes.arrayBuffer()))
        } catch (err) {
          log.error(`[proxy-auth-dev-gateway] ${req.method} ${req.url}: ${err.message}`, { timestamp: true })
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify('BAD GATEWAY'))
        }
      })
    },
  }
}
