import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { RuntimeCard } from './Slide2';

const runtime: JavaRuntimeInfo = {
	executablePath: 'C:/Program Files/Eclipse Adoptium/jdk-21.0.4.7-hotspot/bin/java.exe',
	majorVersion: 21,
	version: '21.0.4',
	source: 'common_install_dir',
};

describe('RuntimeCard', () => {
	const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
	afterEach(() => {
		if (original) Object.defineProperty(navigator, 'clipboard', original);
		else Reflect.deleteProperty(navigator, 'clipboard');
	});

	it('shows version and source, keeps the path behind a copy button', async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

		render(<RuntimeCard runtime={runtime} />);

		expect(screen.getByText('Java 21')).toBeInTheDocument();
		expect(screen.getByText('Installed JDK folder')).toBeInTheDocument();
		expect(screen.queryByText(runtime.executablePath)).not.toBeInTheDocument();

		const button = screen.getByRole('button', { name: `Copy path: ${runtime.executablePath}` });
		await act(async () => {
			fireEvent.click(button);
		});

		expect(writeText).toHaveBeenCalledWith(runtime.executablePath);
		expect(screen.getByRole('button', { name: 'Path copied' })).toBeInTheDocument();
	});
});
