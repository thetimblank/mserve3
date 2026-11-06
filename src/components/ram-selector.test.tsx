import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RamSelector from './ram-selector';
import { mockInvoke } from '@/test/tauri-mock';
import { createProvider } from '@/lib/server-provider';

vi.mock('@/data/user', () => ({
	useExperience: () => ({ atLeast: () => false }),
}));

const plan = {
	kind: 'plugin',
	estimateGb: 5,
	capGb: 3,
	initialGb: 0.75,
	minimumGb: 1,
	systemCapGb: 3,
	totalMemoryGb: 8,
	otherServersGb: 2,
	exceedsSystemCap: true,
};

describe('RamSelector', () => {
	it('shows the auto cap and switches between auto and a preset', async () => {
		mockInvoke('get_system_memory_gb', () => 16);
		mockInvoke('get_auto_ram_plan', () => plan);
		const updateField = vi.fn();
		render(<RamSelector provider={createProvider('paper')} ram={4} ramMode='auto' updateField={updateField} />);

		expect(await screen.findByText('Up to 3 GB')).toBeInTheDocument();
		expect(screen.getByText(/would like 5 GB/)).toBeInTheDocument();

		fireEvent.click(screen.getByText('Medium'));
		expect(updateField).toHaveBeenCalledWith('ram', 4);
		expect(updateField).toHaveBeenLastCalledWith('ram_mode', 'manual');

		fireEvent.click(screen.getByText('Auto'));
		expect(updateField).toHaveBeenLastCalledWith('ram_mode', 'auto');
	});
});
