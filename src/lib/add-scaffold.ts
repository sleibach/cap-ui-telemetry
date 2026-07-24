import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Package-root ui5-snippets/, resolved relative to this compiled file
// (dist/lib/add-scaffold.js -> ../../ui5-snippets -> <pkg>/ui5-snippets).
export const SNIPPETS_DIR = join(__dirname, '..', '..', 'ui5-snippets')

const SNIPPET_SOURCE_FILES: Record<string, string> = {
  'FesrEnrichment.js': 'fesr-enrichment.js',
  'ErrorReporter.js': 'ErrorReporter.js',
}

/** Finds app/*\/webapp/index.html files that look like a UI5 bootstrap page. */
export function findCandidateShells(root: string): string[] {
  const appDir = join(root, 'app')
  if (!existsSync(appDir)) return []

  return readdirSync(appDir)
    .filter((name) => {
      const full = join(appDir, name)
      if (!statSync(full).isDirectory()) return false
      const indexHtml = join(full, 'webapp', 'index.html')
      return existsSync(indexHtml) && readFileSync(indexHtml, 'utf8').includes('sap-ui-bootstrap')
    })
    .map((name) => join('app', name))
}

export type PatchResult = 'patched' | 'already-present'

/** Adds data-sap-ui-fesr="true" to the bootstrap tag. Idempotent. */
export function patchBootstrapFlag(indexHtmlPath: string): PatchResult {
  const html = readFileSync(indexHtmlPath, 'utf8')
  if (html.includes('data-sap-ui-fesr')) return 'already-present'

  // Insert right before data-sap-ui-on-init (present on every ComponentSupport
  // bootstrap tag) or, failing that, right before the tag's closing '>'.
  const patched = /data-sap-ui-on-init=/.test(html)
    ? html.replace(/([ \t]*)(data-sap-ui-on-init=)/, '$1data-sap-ui-fesr="true"\n$1$2')
    : html.replace(/(<script[^>]*id=["']sap-ui-bootstrap["'][^>]*)(>)/, '$1\n\tdata-sap-ui-fesr="true"$2')

  writeFileSync(indexHtmlPath, patched, 'utf8')
  return 'patched'
}

export type CopyResult = 'copied' | 'skipped-exists'

/** Copies one of the shipped ui5-snippets into the target directory. */
export function copySnippet(name: keyof typeof SNIPPET_SOURCE_FILES, targetDir: string, force: boolean): CopyResult {
  const target = join(targetDir, name)
  if (existsSync(target) && !force) return 'skipped-exists'

  mkdirSync(targetDir, { recursive: true })
  copyFileSync(join(SNIPPETS_DIR, SNIPPET_SOURCE_FILES[name]), target)
  return 'copied'
}
