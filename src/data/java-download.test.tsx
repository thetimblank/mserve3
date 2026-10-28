import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockInvoke } from '@/test/tauri-mock';
import { JavaRuntimesProvider } from './java-runtimes';
import { JavaDownloadProvider, useJavaDownload } from './java-download';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
	<MemoryRouter>
		<JavaRuntimesProvider>
			<JavaDownloadProvider>{children}</JavaDownloadProvider>
		</JavaRuntimesProvider>
	</MemoryRouter>
);

const runtime = (major: number) => ({
	executablePath: `C:/jdk${major}/bin/java.exe`,
	majorVersion: major,
	version: `${major}.0.1`,
	source: 'managed',
});

describe('ensureJava', () => {
	it('shares one prompt per major and queues other majors instead of cancelling them', async () => {
		mockInvoke('detect_java_runtimes', () => ({ runtimes: [], errors: [], scannedCandidates: 0 }));
		mockInvoke('download_java_runtime', (args) => runtime(Number(args?.majorVersion)));
		const { result } = renderHook(() => useJavaDownload(), { wrapper });

		let first!: Promise<unknown>;
		let second!: Promise<unknown>;
		let other!: Promise<unknown>;
		act(() => {
			first = result.current.ensureJava(21);
			second = result.current.ensureJava(21);
			other = result.current.ensureJava(17);
		});
		expect(second).toBe(first);

		fireEvent.click(await screen.findByRole('button', { name: 'Download Java 21' }));
		await expect(first).resolves.toEqual(runtime(21));

		// The Java 17 request survived and is shown next.
		fireEvent.click(await screen.findByRole('button', { name: 'Download Java 17' }));
		await expect(other).resolves.toEqual(runtime(17));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});
});
