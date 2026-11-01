// productShell.js — the product's name in the files React does not render (req #4076).
//
// index.html's <title>/<meta> and public/manifest.json are served before any
// JavaScript runs, so they cannot read config/product.js. This Vite plugin
// fills index.html's %PRODUCT_NAME% / %PRODUCT_DESCRIPTION% placeholders, and
// serves (dev) or emits (build) manifest.json with the product's names, both
// from the SAME resolved config the app's `__PRODUCT__` define carries. So a
// rename is still one value: VITE_PRODUCT_NAME.

import fs from 'node:fs'
import path from 'node:path'

const escapeHtml = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function productDescription(product) {
  return product.productTagline ? `${product.productName} ${product.productTagline}` : product.productName
}

export function productManifest(product, base) {
  return {
    ...base,
    short_name: product.productName,
    name: productDescription(product),
  }
}

// Files under public/ that belong to darwin.one's whole-app product only, so a
// scoped product (internal: Topology + Swarm) does not ship them (req #4077):
// docs/ is darwin.one's engineering documentation (no route links it) and
// downloads/ is the Maps photo shortcut. Mostly the word "Darwin" — the rename
// census found them as the only build files naming it.
export const WHOLE_APP_PUBLIC_PATHS = ['docs', 'downloads']
export function scopedOutPaths(product) {
  return product.apps.all ? [] : WHOLE_APP_PUBLIC_PATHS
}

export function productShell(product) {
  const manifestPath = path.resolve(import.meta.dirname, '..', 'public', 'manifest.json')
  const manifestJson = () => JSON.stringify(
    productManifest(product, JSON.parse(fs.readFileSync(manifestPath, 'utf8'))), null, 2) + '\n'

  return {
    name: 'product-shell',
    transformIndexHtml(html) {
      const fontLink = product.fontSource === 'local' ? ''
        : '<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap"/>'
      return html
        .replaceAll('%PRODUCT_FONT_LINK%', fontLink)
        .replaceAll('%PRODUCT_NAME%', escapeHtml(product.productName))
        .replaceAll('%PRODUCT_DESCRIPTION%', escapeHtml(productDescription(product).toLowerCase()
          .replace(/^./, (c) => c.toUpperCase())))
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url || '').split('?')[0] !== '/manifest.json') return next()
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
        res.end(manifestJson())
      })
    },
    // `public/` is copied verbatim; overwrite its manifest with the product's,
    // and (req #4077) drop what a scoped product does not contain.
    writeBundle(options) {
      const outDir = options.dir || path.resolve(import.meta.dirname, '..', 'dist')
      fs.writeFileSync(path.join(outDir, 'manifest.json'), manifestJson())
      for (const rel of scopedOutPaths(product)) {
        fs.rmSync(path.join(outDir, rel), { recursive: true, force: true })
      }
    },
  }
}
