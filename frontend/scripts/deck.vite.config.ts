import path from 'path';
import { defineConfig } from 'vite';
export default defineConfig({
  resolve: {
    alias: [
      { find: /^.*\/pdfjsSetup(\.ts)?$/, replacement: path.resolve(__dirname, 'harness-stubs/pdfjsSetup.ts') },
      { find: /^.*\/presentationImages(\.ts)?$/, replacement: path.resolve(__dirname, 'harness-stubs/presentationImages.ts') },
    ],
  },
});
