import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const configPath = join(__dirname, '..', 'clawatar.config.json')

let config = { server: { vitePort: 3000 } }
try { config = JSON.parse(readFileSync(configPath, 'utf-8')) } catch {}

const vite = spawn('npx', ['vite', '--port', String(config.server?.vitePort || 3000)], {
  stdio: 'inherit', shell: true, cwd: join(__dirname, '..')
})
const ws = spawn('npx', ['tsx', 'server/ws-server.ts'], {
  stdio: 'inherit', shell: true, cwd: join(__dirname, '..')
})

function cleanup() {
  vite.kill()
  ws.kill()
  process.exit()
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
vite.on('exit', cleanup)
