import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EmptyState from './empty-state';

describe('EmptyState', () => {
	it('renders title, description and both actions', () => {
		const onPrimary = vi.fn();
		const onSecondary = vi.fn();
		render(
			<EmptyState
				title='No backups yet'
				description='Create one now.'
				action={{ label: 'Create Backup', onClick: onPrimary }}
				secondaryAction={{ label: 'Settings', onClick: onSecondary }}
			/>,
		);

		expect(screen.getByText('No backups yet')).toBeInTheDocument();
		expect(screen.getByText('Create one now.')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Create Backup' }));
		fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
		expect(onPrimary).toHaveBeenCalledOnce();
		expect(onSecondary).toHaveBeenCalledOnce();
	});

	it('offers "Clear search" only for no-results', () => {
		const onClear = vi.fn();
		const { rerender } = render(<EmptyState title='Nothing here' onClearSearch={onClear} />);
		expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

		rerender(<EmptyState variant='no-results' title='No matches' onClearSearch={onClear} />);
		fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
		expect(onClear).toHaveBeenCalledOnce();
	});

	it('renders no action row without actions', () => {
		render(<EmptyState title='Empty' />);
		expect(screen.queryByRole('button')).toBeNull();
	});
});
