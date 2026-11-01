import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createApiMiddleware } from './server/apiMiddleware.js';

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: 'qr-menu-admin-api',
      configureServer(server) {
        server.middlewares.use(createApiMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createApiMiddleware());
      }
    }
  ],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    watch: {
      ignored: [
        '**/public/data/**',
        '**/public/uploads/**',
        '**/dist/**',
        '**/.admin-auth.json'
      ]
    }
  }
});
