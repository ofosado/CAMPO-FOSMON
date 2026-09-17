import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// fix/actualizacion-pwa (2026-09-16): metadata de build inyectada como
// constantes de compilación. Netlify expone COMMIT_REF automáticamente;
// en local caemos a `git rev-parse`. Se muestran al usuario en el footer
// y en la pantalla de Login como "v2026-09-16 · 34f4c3f" para que reporte
// bugs con evidencia de qué versión ve.
const BUILD_SHA = (
  process.env.COMMIT_REF ||
  (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'dev'; } })()
).slice(0, 7);
const BUILD_DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_SHA__:  JSON.stringify(BUILD_SHA),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
  plugins: [
    react(),
    VitePWA({
      // registerType 'prompt' (antes 'autoUpdate'): el frontend decide cuándo
      // aplicar la actualización. La lógica vive en src/pwa-update.js y App.jsx:
      // dispara skipWaiting + reload silencioso al login o sin cambios pendientes,
      // y muestra banner cuando hay captura sin guardar.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        name: 'CAMPO — FOSMON',
        short_name: 'CAMPO',
        description: 'Control de Avance, Maquinaria, Personal y Obra — FOSMON Construcciones',
        theme_color: '#0D1619',
        background_color: '#0D1619',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'es-MX',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Excluir Firebase y CDNs externos del precache
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          },
          {
            // SheetJS y jsPDF viven en cdnjs.cloudflare.com — sin esta
            // regla, en PWA standalone el script tarda mucho o falla,
            // dejando el botón "Cargar nómina" pegado en spinner.
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdnjs-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          },
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'firestore-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }
            }
          }
        ]
      }
    })
  ]
})
