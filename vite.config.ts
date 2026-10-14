import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Worker serves the page from its root.
export default defineConfig({
  base: '/',
  plugins: [react()],
})
