import { defineConfig } from 'vite';
import { volt } from '@voltjs/vite-plugin';

export default defineConfig({
  plugins: [volt()],
  build: { target: 'esnext' },
});
