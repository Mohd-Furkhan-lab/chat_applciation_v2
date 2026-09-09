import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiRoots = ['/users', '/chat', '/groups', '/admin', '/ws']

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(apiRoots.map((root) => [root, {
      target: 'http://localhost:8000',
      changeOrigin: true,
      ws: true,
      configure(proxy) {
        proxy.on('proxyRes', (proxyResponse) => {
          const cookies = proxyResponse.headers['set-cookie']
          if (cookies) proxyResponse.headers['set-cookie'] = cookies.map((cookie) => cookie.replace(/;\s*SameSite=None/ig, '; SameSite=Lax'))
        })
      },
    }])),
  },
})
