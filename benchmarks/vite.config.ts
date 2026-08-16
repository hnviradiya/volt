import { defineConfig } from 'vite';
import { volt } from '@volt/vite-plugin';

export default defineConfig({
  plugins: [volt()],
  build: { target: 'esnext' },
});
