import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  
  return {
    root: path.resolve(__dirname, 'client'),
    plugins: [react()],
    
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://localhost:8081',
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: 'http://localhost:8081',
          ws: true,
          changeOrigin: true,
          rewrite: () => '/',
        }
      }
    },
    
    build: {
      outDir: path.resolve(__dirname, 'client/dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'client/index.html'),
          overlay: path.resolve(__dirname, 'client/overlay.html'),
        },
      },
    },
    
    define: {
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY)
    },
    
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'client/src'),
      }
    }
  };
});
