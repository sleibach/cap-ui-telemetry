import cds = require('@sap/cds')
import { existsSync } from 'fs'
import { join } from 'path'
import { findCandidateShells, patchBootstrapFlag, copySnippet, resolveNamespace } from '../lib/add-scaffold'

// cds.add is only present under @sap/cds-dk (during `cds add`/`cds init`) —
// never at runtime, where only plain @sap/cds is installed. `extends undefined`
// would throw at class-definition time, so fall back to a harmless base class;
// registration below only happens when the real base class is actually there.
const AddPlugin = (cds as unknown as { add?: { Plugin: new (...args: unknown[]) => object } }).add?.Plugin

/**
 * `cds add ui-telemetry` — scaffolds the frontend half of cap-ui-telemetry:
 * enables FESR in the bootstrap and copies the two UI5 snippet modules.
 * Does NOT touch Component.js (structure varies too much project to project
 * to patch safely) — prints the exact snippet to add instead.
 */
export class UiTelemetryAddPlugin extends (AddPlugin ?? Object) {
  static help(): string {
    return 'Enables FESR and copies cap-ui-telemetry UI5 snippets into an app'
  }

  static hasInProduction(): boolean {
    // Scaffolding action, not a persisted config toggle — nothing to report as "in production".
    return false
  }

  async run(): Promise<void> {
    const root = cds.root
    // Not a --target CLI flag: cds-dk builds its per-command option allowlist
    // from already-registered plugins at cds-dk's own bootstrap time, before
    // this plugin's cds-plugin.js has necessarily been discovered — a custom
    // CLI option here is rejected as "Invalid option". An env var sidesteps
    // CLI arg validation entirely and works reliably instead.
    const target = process.env.CAP_UI_TELEMETRY_TARGET
    const force = !!(cds.cli?.options as Record<string, unknown> | undefined)?.force

    let appPath: string
    if (target) {
      appPath = target
    } else {
      const candidates = findCandidateShells(root)
      if (candidates.length === 0) {
        throw `No app/*/webapp/index.html with a sap-ui-bootstrap tag found under ${root}. Re-run with CAP_UI_TELEMETRY_TARGET=<path-to-app> npx cds add ui-telemetry.`
      }
      if (candidates.length > 1) {
        throw `Multiple UI5 apps found — re-run with CAP_UI_TELEMETRY_TARGET=<one-of-these> npx cds add ui-telemetry:\n  ${candidates.join('\n  ')}`
      }
      appPath = candidates[0]
    }

    const indexHtml = join(root, appPath, 'webapp', 'index.html')
    if (!existsSync(indexHtml)) throw `${indexHtml} not found.`

    const bootstrapResult = patchBootstrapFlag(indexHtml)
    const telemetryDir = join(root, appPath, 'webapp', 'telemetry')
    const fesrResult = copySnippet('FesrEnrichment.js', telemetryDir, force)
    const errorResult = copySnippet('ErrorReporter.js', telemetryDir, force)

    // The UI5 module namespace (for sap.ui.require paths) frequently does NOT
    // match the folder name (e.g. folder "task-queue" -> namespace "taskqueue") —
    // read it from index.html's actual resourceRoots rather than guessing.
    const namespace = resolveNamespace(indexHtml, appPath.split('/').pop() as string)

    console.log('cap-ui-telemetry:')
    console.log(`  ${appPath}/webapp/index.html — data-sap-ui-fesr="true": ${bootstrapResult}`)
    console.log(`  ${appPath}/webapp/telemetry/FesrEnrichment.js: ${fesrResult}`)
    console.log(`  ${appPath}/webapp/telemetry/ErrorReporter.js: ${errorResult}`)
    console.log('')
    console.log('Next — wire both into the Component.js that owns this bootstrap:')
    console.log(`
  sap.ui.define([
    "sap/ui/core/UIComponent",
    // ...your existing dependencies...
    "${namespace}/telemetry/FesrEnrichment",
    "${namespace}/telemetry/ErrorReporter"
  ], function (UIComponent, /* ... */ FesrEnrichment, ErrorReporter) {
    return UIComponent.extend("...", {
      init: function () {
        FesrEnrichment.register();
        // Standalone app: pass its own namespace. Shell with several embedded
        // apps: pass a resolver function instead (see INTEGRATION.md Step 4).
        new ErrorReporter({ appName: "${namespace}" }).start();
        UIComponent.prototype.init.apply(this, arguments);
        // ...
      }
    });
  });`)
    console.log('\nSee INTEGRATION.md (Steps 3-4) for details: https://github.com/sleibach/cap-ui-telemetry#readme')
  }
}

if (AddPlugin) {
  ;(cds as unknown as { add: { register: (name: string, plugin: unknown) => void } }).add.register(
    'ui-telemetry',
    UiTelemetryAddPlugin,
  )
}
