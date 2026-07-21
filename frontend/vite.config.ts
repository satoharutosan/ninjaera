import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { devProxyTarget } from './electron/shared/backendEnv'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  // Keep web dep cache separate from electron-vite (both default to node_modules/.vite
  // and invalidate each other → 504 Outdated Optimize Dep in the browser).
  cacheDir: path.resolve(__dirname, 'node_modules/.vite-web'),
  optimizeDeps: {
    include: [
      '@mui/material',
      '@mui/material/Badge',
      '@emotion/react',
      '@emotion/styled',
      '@mui/icons-material/Home',
      '@mui/icons-material/Info',
      '@mui/icons-material/MenuBook',
      '@mui/icons-material/Groups',
      '@mui/icons-material/ContactSupport',
      '@mui/icons-material/Login',
      '@mui/icons-material/PersonAdd',
      '@mui/icons-material/Menu',
      '@mui/icons-material/Close',
      '@mui/icons-material/DarkMode',
      '@mui/icons-material/LightMode',
      '@mui/icons-material/Notifications',
      '@mui/icons-material/Send',
      '@mui/icons-material/ChevronRight',
      '@mui/icons-material/Facebook',
      '@mui/icons-material/X',
      '@mui/icons-material/YouTube',
      '@mui/icons-material/WhatsApp',
      '@mui/icons-material/AdminPanelSettings',
      '@mui/icons-material/Logout',
      '@mui/icons-material/Person',
      '@mui/icons-material/ChatBubble',
    ],
  },
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': { target: devProxyTarget(), changeOrigin: true },
      '/uploads': { target: devProxyTarget(), changeOrigin: true },
      '/externals': { target: devProxyTarget(), changeOrigin: true },
      '/socket.io': { target: devProxyTarget(), ws: true, changeOrigin: true },
    },
  },
  build: {
    // Avoid inlining large PNGs into JS (hurts free-tier transfer + parse).
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@mui') || id.includes('@emotion')) return 'mui'
          if (id.includes('socket.io')) return 'socket'
          if (id.includes('react-virtuoso')) return 'virtuoso'
          if (id.includes('recharts')) return 'recharts'
          if (id.includes('react-dom') || id.includes('/react/')) return 'react'
        },
      },
    },
  },
  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
