import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server port. Defaults to 5173; override with VITE_PORT so multiple
// worktrees / instances can run side by side (e.g. a calendar worktree on
// 5174 alongside the main app on 5173). strictPort keeps a misconfigured
// port loud rather than silently shifting.
const port = Number(process.env.VITE_PORT) || 5173

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
