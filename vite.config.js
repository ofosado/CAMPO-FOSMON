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
      includeAssets: [
        'favicon.svg', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png',
        'apple-touch-icon-180.png',
        'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
      ],
      manifest: {
        // `id` fijado a mano. No es decorativo: sin él, el navegador toma como
        // identidad de la app instalada el `start_url` resuelto, de modo que
        // cualquier día que alguien le ponga `start_url: '/?origen=pwa'` para
        // medir instalaciones, Android deja de reconocer la app que FOSMON ya
        // tiene en la pantalla de inicio y la siguiente visita ofrece
        // instalar una SEGUNDA. Con el `id` escrito, el `start_url` se puede
        // mover sin que la identidad se mueva. Vale `'/'` porque es lo que el
        // `start_url` resuelve HOY: la app instalada conserva su identidad
        // actual, que es justo lo que queremos al cambiarle nombre e íconos.
        // (En iOS esto no aplica: Safari no implementa `id` y la identidad la
        // da el `start_url`/`scope`, que tampoco se tocan.)
        id: '/',
        // Los nombres dejan de decir FOSMON: el manifiesto es del PRODUCTO, no
        // del cliente. El logotipo del municipio o de la constructora entra en
        // tiempo de ejecución desde `orgs/{orgId}/config/branding`, no aquí —
        // si el manifiesto fuera por cliente habría que compilar un build por
        // cliente, que es exactamente lo contrario de lo que se está armando.
        name: 'cotea · control de avance, maquinaria, personal y obra',
        short_name: 'cotea',
        description: 'Control de avance, maquinaria, personal y obra.',
        // Caliza de cotea. El `background_color` es el fondo de la pantalla de
        // arranque, detrás del ícono: va en el MISMO crema que tiene el ícono
        // de fondo, para que no aparezca un recuadro claro sobre negro durante
        // el segundo que dura el splash. Estaba en `#0D1619` los dos, que con
        // un ícono crema se vería como una calcomanía pegada.
        theme_color: '#14181C',
        background_color: '#F5F3EE',
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
