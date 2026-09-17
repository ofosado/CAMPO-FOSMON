// fix/actualizacion-pwa (2026-09-16)
// ─────────────────────────────────────────────────────────────────────────────
// Puente entre vite-plugin-pwa (virtual:pwa-register) y la UI de la app.
// La UI (App.jsx) llama subscribeToPWAUpdates(callback) al montarse. Cuando el
// service worker detecta una versión nueva y queda en waiting, invocamos el
// callback pasando la función updateSW() para que App.jsx decida cuándo
// activarla según su lógica de sesión + cambiosPendientes.
//
// Además programamos un check periódico cada 30 min para reducir la latencia
// entre deploy y detección. Complementa el auto-check que hace el navegador al
// focar la ventana.
// ─────────────────────────────────────────────────────────────────────────────

import { registerSW } from 'virtual:pwa-register';

let _subscribers = [];
let _updateSW = null;   // función para aplicar el update (viene del registerSW)
let _needsUpdate = false;

/**
 * Registra el SW y arranca el chequeo periódico.
 * Debe llamarse una sola vez desde main.jsx antes del render.
 */
export function initPWAUpdates() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  _updateSW = registerSW({
    // Cuando hay una versión nueva instalada y esperando:
    onNeedRefresh() {
      _needsUpdate = true;
      console.log('[SW-PWA] update detected — waiting activation');
      _notify();
    },
    // Cuando el SW está listo para servir offline por primera vez.
    onOfflineReady() {
      console.log('[SW-PWA] app disponible offline');
    },
    // Falla al registrar. No es fatal, la app sigue funcionando sin caching.
    onRegisterError(err) {
      console.warn('[SW-PWA] registro falló', err?.message || err);
    },
  });

  // Check periódico cada 30 min. Solo dispara cuando la app está en foreground
  // (setInterval se pausa cuando la pestaña está en background en algunos
  // navegadores, es aceptable). Complementa el auto-check al focar la ventana.
  setInterval(() => {
    console.log('[SW-PWA] chequeando updates (30min tick)');
    _updateSW && _updateSW(false).catch(() => {}); // false = no aplicar, solo check
  }, 30 * 60 * 1000);
}

/**
 * Suscribe un callback que se dispara cuando hay update pendiente.
 * Retorna función para desuscribir.
 *
 * El callback recibe una función `aplicar(silencioso)`:
 *   · aplicar(true)  = skipWaiting + reload silencioso (para escenarios sin
 *                       cambios pendientes o sin sesión).
 *   · aplicar(false) = solo skipWaiting sin reload (el caller decide el reload).
 *
 * Uso típico:
 *   const unsub = subscribeToPWAUpdates((aplicar) => {
 *     if (safe) aplicar(true);
 *     else setMostrarBanner(true);   // el botón del banner llama aplicar(true)
 *   });
 */
export function subscribeToPWAUpdates(callback) {
  _subscribers.push(callback);
  // Si ya llegó el update antes de que se suscribiera, disparar inmediato.
  if (_needsUpdate) queueMicrotask(() => callback(_aplicar));
  return () => {
    _subscribers = _subscribers.filter(c => c !== callback);
  };
}

/** Aplica la actualización. silencioso=true recarga; false solo skipWaiting. */
function _aplicar(silencioso = true) {
  if (!_updateSW) {
    console.warn('[SW-PWA] aplicar llamado sin SW registrado');
    return Promise.resolve();
  }
  console.log('[SW-PWA] aplicando update (recarga=' + silencioso + ')');
  return _updateSW(silencioso);
}

function _notify() {
  for (const cb of _subscribers) {
    try { cb(_aplicar); } catch (e) { console.error('[SW-PWA] subscriber error', e); }
  }
}
