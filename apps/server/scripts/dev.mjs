/**
 * Dev runner for the server.
 *
 * Neither built-in watcher covers both cases we need:
 *
 *   - `tsx watch` watches .ts files but its `--include` flag cannot see dotfiles,
 *     so `.env` edits are invisible to it.
 *   - `node --watch --watch-path=.env` watches `.env` fine, but does not track
 *     .ts files loaded through the tsx loader.
 *
 * So: tsx watch owns TypeScript, and this wrapper restarts the whole child when
 * `.env` changes. Without it, editing an env var silently leaves the server
 * running the old config, which fails later at the first sign-in with an opaque
 * Google "wrong audience" error.
 */
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let child = null
let restarting = false

function start() {
  child = spawn('tsx', ['watch', '--clear-screen=false', 'src/index.ts'], {
    cwd: serverRoot,
    stdio: 'inherit',
    // Put the local tsx on PATH so this works via pnpm and when run directly.
    env: {
      ...process.env,
      PATH: `${resolve(serverRoot, 'node_modules/.bin')}:${process.env.PATH}`,
    },
  })

  child.on('exit', (code, signal) => {
    if (restarting) return
    if (signal !== null) return
    process.exit(code ?? 0)
  })
}

function restart() {
  if (child === null) return
  restarting = true
  child.kill('SIGTERM')
  // Give tsx watch a moment to tear down its own child before rebinding 4000,
  // otherwise the fresh process hits EADDRINUSE and dies.
  setTimeout(() => {
    start()
    restarting = false
  }, 300)
}

start()

let timer = null
watch(resolve(serverRoot, '.env'), () => {
  // Editors emit several events per save; collapse them into one restart.
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(restart, 150)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child?.kill('SIGTERM')
    process.exit(0)
  })
}
