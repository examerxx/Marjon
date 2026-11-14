// Запускает offline-sync.e2e.mjs в Node-режиме Electron: better-sqlite3 собран
// под ABI Electron, обычный node его не загрузит.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const script = fileURLToPath(new URL('offline-sync.e2e.mjs', import.meta.url))

const child = spawn(electron, [script], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
child.on('exit', (code) => process.exit(code ?? 1))
