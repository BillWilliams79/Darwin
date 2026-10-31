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
// Always `darwin_dev`, never production: a review server writes test data.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

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
// for anything outside the internal database (nginx answers those 404).
export function upstreamUrl(url, { apiBase, database, upstreamBase }) {
  const prefix = `${apiBase}/${database}`
  if (url !== prefix && !url.startsWith(`${prefix}/`) && !url.startsWith(`${prefix}?`)) return null
  return `${upstreamBase}/${DEV_DATABASE}${url.slice(prefix.length)}`
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

export function proxyAuthDevGateway(command, product, env) {
  return {
    name: 'proxy-auth-dev-gateway',
    apply: 'serve',
    configureServer(server) {
      if (command !== 'serve' || product.authMode !== 'proxy') return
      const log = server.config.logger
      const database = env.VITE_DARWIN_DATABASE
      const credsPath = env.VITE_DEV_GATEWAY_CREDENTIALS
        || path.join(process.env.HOME || '', '.darwin-credentials', 'mcp_credentials.sh')
      let creds
      try {
        creds = parseCredentialsFile(fs.readFileSync(credsPath, 'utf8'))
      } catch (err) {
        log.error(`[proxy-auth-dev-gateway] cannot read ${credsPath}: ${err.message} — /api requests will 502`,
          { timestamp: true })
      }
      const upstreamBase = (creds?.DARWIN_API_BASE || '').replace(/\/(darwin|darwin_dev)\/?$/, '').replace(/\/+$/, '')
      const idToken = creds ? makeTokenProvider(creds) : null
      log.info(`[proxy-auth-dev-gateway] ${product.apiBase}/${database}/* → ${upstreamBase}/${DEV_DATABASE}/* `
        + '(server-side identity; dev only)')

      server.middlewares.use(async (req, res, next) => {
        const target = upstreamUrl(req.url || '', { apiBase: product.apiBase, database, upstreamBase })
        if (!target) {
          if ((req.url || '').startsWith(`${product.apiBase}/`)) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            return res.end(JSON.stringify('NOT FOUND'))
          }
          return next()
        }
        try {
          if (!idToken || !upstreamBase) throw new Error('no dev gateway credentials')
          const chunks = []
          for await (const c of req) chunks.push(c)
          const upstream = await fetch(target, {
            method: req.method,
            headers: { 'Content-Type': 'application/json', Authorization: await idToken() },
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
          })
          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
          res.end(Buffer.from(await upstream.arrayBuffer()))
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
