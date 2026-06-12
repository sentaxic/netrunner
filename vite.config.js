import { defineConfig } from 'vite'

// COOP/COEP headers enable SharedArrayBuffer, required by the CheerpX real-Linux VM.
// 'credentialless' lets the VM stream its disk image from the leaningtech CDN.
const coiHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  server: { port: 3009, headers: coiHeaders },
  preview: { port: 3009, headers: coiHeaders },
  build: { target: 'esnext' },
  optimizeDeps: { exclude: ['@leaningtech/cheerpx'] },
})
