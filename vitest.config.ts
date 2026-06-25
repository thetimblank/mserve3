import { defineConfig } from 'vitest/config';
import path from 'path';
import react from '@vitejs/plugin-react';

// Standalone Vitest config — intentionally separate from vite.config.ts so the
// Tauri-tailored dev-server/tailwind setup doesn't leak into tests. We only need
// the React plugin (for JSX/TSX) and the `@` path alias here.
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/test/setup.ts'],
		// Frontend tests only — the Rust suite is driven by `cargo test`.
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		css: false,
	},
});
