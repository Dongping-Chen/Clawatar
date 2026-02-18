import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { networkInterfaces } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const configPath = join(__dirname, '..', 'clawatar.config.json')

let config = { server: { vitePort: 3000, wsPort: 8765 } }
try { config = JSON.parse(readFileSync(configPath, 'utf-8')) } catch {}

const vitePort = config.server?.vitePort || 3000
const wsPort = config.server?.wsPort || 8765

function getLocalNetworkIPs() {
  const interfaces = networkInterfaces()
  const ips = new Set()

  for (const iface of Object.values(interfaces)) {
    if (!iface) continue
    for (const addr of iface) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      ips.add(addr.address)
    }
  }

  return Array.from(ips)
}

function printConnectionInfo() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const localIPs = getLocalNetworkIPs()
  if (localIPs.length === 0) {
    console.log(`🌐 VRM Viewer: http://localhost:${vitePort}`)
    console.log(`🔌 WebSocket:  ws://localhost:${wsPort}`)
  } else {
    for (const ip of localIPs) {
      console.log(`🌐 VRM Viewer: http://${ip}:${vitePort}`)
      console.log(`🔌 WebSocket:  ws://${ip}:${wsPort}`)
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

printConnectionInfo()

const vite = spawn('npx', ['vite', '--host', '0.0.0.0', '--port', String(vitePort)], {
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
