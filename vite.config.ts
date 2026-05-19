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
  build: {
    // The etebase E2E SDK (libsodium/crypto) is a single ~770 kB vendor
    // chunk that can't be split further. Size the warning to that floor so
    // it stays meaningful — i.e. fires only if something *new* blows up,
    // not permanently for a known-irreducible dependency.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split the big, rarely-changing libraries out of the app chunk
        // so they cache independently and the entry stays small. The
        // calendar module is additionally route-split via React.lazy.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (id.includes('ical.js')) return 'ical'
          if (id.includes('etebase')) return 'etebase'
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          )
            return 'react'
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
