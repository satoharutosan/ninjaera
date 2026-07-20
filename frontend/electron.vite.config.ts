import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { devProxyTarget } from './electron/shared/backendEnv'

/** Mirrors the web build's figma:asset resolver so reused feature modules resolve identically. */
function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': path.resolve(__dirname, 'electron/main'),
        '@shared-electron': path.resolve(__dirname, 'electron/shared'),
      },
    },
    build: {
      outDir: 'out/main',
      lib: { entry: path.resolve(__dirname, 'electron/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared-electron': path.resolve(__dirname, 'electron/shared'),
      },
    },
    build: {
      outDir: 'out/preload',
      lib: { entry: path.resolve(__dirname, 'electron/preload/index.ts') },
    },
  },
  renderer: {
    root: path.resolve(__dirname, 'desktop'),
    plugins: [figmaAssetResolver(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@desktop': path.resolve(__dirname, 'desktop'),
      },
    },
    assetsInclude: ['**/*.svg', '**/*.csv'],
    server: {
      // Allow importing reused modules from src/ and shared types from electron/ (outside the desktop root).
      fs: { allow: [path.resolve(__dirname)] },
      // Dev: same-origin proxy to the existing backend (no CORS, mirrors production app:// proxy).
      proxy: {
        '/api': { target: devProxyTarget(), changeOrigin: true },
        '/uploads': { target: devProxyTarget(), changeOrigin: true },
        '/externals': { target: devProxyTarget(), changeOrigin: true },
      },
    },
    build: {
      outDir: 'out/renderer',
      assetsInlineLimit: 4096,
      rollupOptions: {
        input: path.resolve(__dirname, 'desktop/index.html'),
        output: {
          manualChunks(id: string) {
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
  },
})
