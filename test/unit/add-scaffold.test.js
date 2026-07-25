'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { findCandidateShells, patchBootstrapFlag, copySnippet, resolveNamespace } = require('../../dist/lib/add-scaffold')

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-ui-telemetry-add-'))
}

function writeIndexHtml(appDir, bootstrapTag) {
  fs.mkdirSync(path.join(appDir, 'webapp'), { recursive: true })
  fs.writeFileSync(path.join(appDir, 'webapp', 'index.html'), bootstrapTag, 'utf8')
}

const REAL_BOOTSTRAP = `<!DOCTYPE html>
<html>
<head>
<script id="sap-ui-bootstrap"
  src="https://sapui5.hana.ondemand.com/resources/sap-ui-core.js"
  data-sap-ui-theme="sap_horizon"
  data-sap-ui-async="true"
  data-sap-ui-on-init="module:sap/ui/core/ComponentSupport">
</script>
</head>
<body></body>
</html>`

let root

beforeEach(() => {
  root = tmpProject()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('findCandidateShells', () => {
  it('returns an empty array when there is no app/ directory', () => {
    expect(findCandidateShells(root)).toEqual([])
  })

  it('finds a single UI5 app with a sap-ui-bootstrap tag', () => {
    writeIndexHtml(path.join(root, 'app', 'myshell'), REAL_BOOTSTRAP)
    expect(findCandidateShells(root)).toEqual([path.join('app', 'myshell')])
  })

  it('finds multiple candidates', () => {
    writeIndexHtml(path.join(root, 'app', 'shell1'), REAL_BOOTSTRAP)
    writeIndexHtml(path.join(root, 'app', 'shell2'), REAL_BOOTSTRAP)
    expect(findCandidateShells(root).sort()).toEqual([path.join('app', 'shell1'), path.join('app', 'shell2')].sort())
  })

  it('excludes app folders without a webapp/index.html', () => {
    fs.mkdirSync(path.join(root, 'app', 'empty'), { recursive: true })
    expect(findCandidateShells(root)).toEqual([])
  })

  it('excludes index.html files that are not a UI5 bootstrap page', () => {
    writeIndexHtml(path.join(root, 'app', 'notui5'), '<html><body>plain page</body></html>')
    expect(findCandidateShells(root)).toEqual([])
  })
})

describe('patchBootstrapFlag', () => {
  it('inserts data-sap-ui-fesr="true" before data-sap-ui-on-init', () => {
    const indexHtml = path.join(root, 'index.html')
    fs.writeFileSync(indexHtml, REAL_BOOTSTRAP, 'utf8')

    const result = patchBootstrapFlag(indexHtml)
    expect(result).toBe('patched')

    const patched = fs.readFileSync(indexHtml, 'utf8')
    expect(patched).toContain('data-sap-ui-fesr="true"')
    expect(patched.indexOf('data-sap-ui-fesr')).toBeLessThan(patched.indexOf('data-sap-ui-on-init'))
  })

  it('is idempotent — does not duplicate the attribute on a second call', () => {
    const indexHtml = path.join(root, 'index.html')
    fs.writeFileSync(indexHtml, REAL_BOOTSTRAP, 'utf8')

    patchBootstrapFlag(indexHtml)
    const result = patchBootstrapFlag(indexHtml)

    expect(result).toBe('already-present')
    const patched = fs.readFileSync(indexHtml, 'utf8')
    expect(patched.match(/data-sap-ui-fesr/g)).toHaveLength(1)
  })

  it('falls back to inserting before the closing > when there is no data-sap-ui-on-init', () => {
    const indexHtml = path.join(root, 'index.html')
    const bootstrap = `<script id="sap-ui-bootstrap" src="https://example.com/sap-ui-core.js"></script>`
    fs.writeFileSync(indexHtml, bootstrap, 'utf8')

    patchBootstrapFlag(indexHtml)

    const patched = fs.readFileSync(indexHtml, 'utf8')
    expect(patched).toContain('data-sap-ui-fesr="true"')
    expect(patched).toContain('id="sap-ui-bootstrap"')
  })
})

describe('copySnippet', () => {
  it('copies FesrEnrichment.js into a fresh target directory', () => {
    const targetDir = path.join(root, 'webapp', 'telemetry')
    const result = copySnippet('FesrEnrichment.js', targetDir, false)

    expect(result).toBe('copied')
    const content = fs.readFileSync(path.join(targetDir, 'FesrEnrichment.js'), 'utf8')
    expect(content).toContain('sap.ui.define')
    expect(content).toContain('registerFesrEnrichment')
  })

  it('copies ErrorReporter.js', () => {
    const targetDir = path.join(root, 'webapp', 'telemetry')
    const result = copySnippet('ErrorReporter.js', targetDir, false)

    expect(result).toBe('copied')
    const content = fs.readFileSync(path.join(targetDir, 'ErrorReporter.js'), 'utf8')
    expect(content).toContain('ErrorReporter')
  })

  it('skips an existing file when force is false', () => {
    const targetDir = path.join(root, 'webapp', 'telemetry')
    fs.mkdirSync(targetDir, { recursive: true })
    fs.writeFileSync(path.join(targetDir, 'FesrEnrichment.js'), '// customized by the user', 'utf8')

    const result = copySnippet('FesrEnrichment.js', targetDir, false)

    expect(result).toBe('skipped-exists')
    expect(fs.readFileSync(path.join(targetDir, 'FesrEnrichment.js'), 'utf8')).toBe('// customized by the user')
  })

  it('overwrites an existing file when force is true', () => {
    const targetDir = path.join(root, 'webapp', 'telemetry')
    fs.mkdirSync(targetDir, { recursive: true })
    fs.writeFileSync(path.join(targetDir, 'FesrEnrichment.js'), '// stale copy', 'utf8')

    const result = copySnippet('FesrEnrichment.js', targetDir, true)

    expect(result).toBe('copied')
    expect(fs.readFileSync(path.join(targetDir, 'FesrEnrichment.js'), 'utf8')).toContain('sap.ui.define')
  })
})

describe('resolveNamespace', () => {
  it('reads the namespace from data-sap-ui-resource-roots when present', () => {
    const indexHtml = path.join(root, 'index.html')
    fs.writeFileSync(
      indexHtml,
      `<script id="sap-ui-bootstrap" data-sap-ui-resource-roots='{"taskqueue": "./"}'></script>`,
      'utf8',
    )
    expect(resolveNamespace(indexHtml, 'task-queue')).toBe('taskqueue')
  })

  it('falls back to the folder name when there is no resourceRoots attribute', () => {
    const indexHtml = path.join(root, 'index.html')
    fs.writeFileSync(indexHtml, REAL_BOOTSTRAP, 'utf8')
    expect(resolveNamespace(indexHtml, 'myshell')).toBe('myshell')
  })

  it('falls back to the folder name when the file does not exist', () => {
    expect(resolveNamespace(path.join(root, 'missing.html'), 'myshell')).toBe('myshell')
  })
})
