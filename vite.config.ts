import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/rps_web_app/',
  plugins: [react()],
  assetsInclude: ['**/*.geojson'],
})
