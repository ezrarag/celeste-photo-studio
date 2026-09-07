import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  css: {
    postcss: {}
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        switcher: resolve(__dirname, 'switcher.html'),
        prototype: resolve(__dirname, 'admin-feedback-prototype.html')
      }
    }
  }
});
