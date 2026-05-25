import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const certDir = resolve(process.cwd(), 'certs')
const certPath = resolve(certDir, 'server-cert.pem')
const keyPath = resolve(certDir, 'server-key.pem')
const hasCerts = existsSync(certPath) && existsSync(keyPath) && !process.env.VITE_NO_HTTPS

export default defineConfig({
  // Base public path. Override with VITE_BASE env var for GitHub Pages project
  // sites (e.g. VITE_BASE=/ALPRme/). Defaults to '/' for custom domains and
  // user/organization pages.
  base: process.env.VITE_BASE ?? '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    hmr: process.env.VITE_HMR !== 'false',
    host: process.env.VITE_HOST === 'true' || undefined,
    ...(hasCerts ? {
      https: {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      },
    } : {}),
  },
  preview: {
    host: process.env.VITE_HOST === 'true' || undefined,
    ...(hasCerts ? {
      https: {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      },
    } : {}),
  },
  plugins: [vue(), VitePWA({
    // autoUpdate so users in the field don't need to tap a "reload" prompt to
    // pick up improvements to the SW — important when the device may not be
    // online again for a while.
    registerType: 'autoUpdate',
    injectRegister: false,

    pwaAssets: {
      disabled: false,
      config: true,
    },

    manifest: {
      name: 'ALPRme',
      short_name: 'alprme',
      description: 'On-device license plate recognition',
      theme_color: '#000000',
      background_color: '#000000',
      display: 'standalone',
      display_override: ['standalone'],
      scope: '/',
      start_url: '/',
    },

    workbox: {
      // Include wasm (onnxruntime-web), webmanifest (PWA install metadata),
      // woff/woff2 (any fonts), and json (model configs that ship in /public).
      // Without wasm + json the app loads but inference fails offline.
      globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,woff,woff2,json,webmanifest,onnx}'],
      // iOS standalone PWAs load start_url '/' as a navigation request — without
      // a navigateFallback the SW returns nothing and Safari renders a white screen.
      navigateFallback: 'index.html',
      // Don't let navigation routing hijack model fetches (those go through
      // runtimeCaching CacheFirst below).
      navigateFallbackDenylist: [/^\/models\//],
      // ORT WASM (simd+threaded+jsep variant) ships at ~26 MB. Cap generously
      // so it lands in the precache — without it inference fails offline.
      maximumFileSizeToCacheInBytes: 40_000_000,
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      runtimeCaching: [
        {
          urlPattern: /\/models\/.*\.(onnx|json)$/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'models',
            expiration: {
              maxEntries: 10,
              maxAgeSeconds: 30 * 24 * 60 * 60,
            },
          },
        },
      ],
    },

    devOptions: {
      enabled: false,
      navigateFallback: 'index.html',
      suppressWarnings: true,
      type: 'module',
    },
  })],
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
})
