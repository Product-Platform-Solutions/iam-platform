import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Fail instead of drifting to 5174: Keycloak only allows the redirect URIs listed in the realm file.
    strictPort: true,
  },
})
