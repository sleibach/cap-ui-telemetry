'use strict'
// Thin shim — delegates to the compiled TypeScript output.
// CAP discovers this file because package.json "main" points here.
module.exports = require('./dist/cds-plugin')
