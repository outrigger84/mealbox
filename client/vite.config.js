import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/mealbox/',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: {
    proxy: {
      '/mealbox/api': { target: 'http://localhost:3011', changeOrigin: true }
    }
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: true
  }
})
