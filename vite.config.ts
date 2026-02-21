import { defineConfig, type Plugin } from 'vite'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// Read config for port
let vitePort = 3000
try {
  const config = JSON.parse(readFileSync('clawatar.config.json', 'utf-8'))
  vitePort = config.server?.vitePort || 3000
} catch {}

// Serve clawatar.config.json from project root
function serveConfig(): Plugin {
  return {
    name: 'serve-config',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/clawatar.config.json') {
          const p = resolve('clawatar.config.json')
          if (existsSync(p)) {
            res.setHeader('Content-Type', 'application/json')
            res.end(readFileSync(p, 'utf-8'))
            return
          }
        }
        next()
      })
    }
  }
}

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: vitePort,
  },
  preview: {
    host: '0.0.0.0',
    port: vitePort,
  },
  base: './',
  build: {
    target: 'ES2020',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'embed.html'),
        preview: resolve(__dirname, 'preview.html'),
        bgonly: resolve(__dirname, 'bgonly.html'),
      },
    },
  },
  plugins: [serveConfig()],
})
