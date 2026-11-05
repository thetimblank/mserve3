import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Bug } from 'lucide-react';
import { SegmentedControl, type SegmentedControlOption } from './segmented-control';

type Mode = 'one' | 'two' | 'three';

const OPTIONS: SegmentedControlOption<Mode>[] = [
	{ value: 'one', label: 'One', icon: Bug },
	{ value: 'two', label: 'Two' },
	{ value: 'three', label: 'Three', disabled: true },
];

const Controlled: React.FC<{ onChange?: (value: Mode) => void }> = ({ onChange }) => {
	const [value, setValue] = React.useState<Mode>('one');
	return (
		<SegmentedControl
			aria-label='Mode'
			value={value}
			onValueChange={(next) => {
				setValue(next);
				onChange?.(next);
			}}
			options={OPTIONS}
		/>
	);
};

describe('SegmentedControl', () => {
	it('marks the selected option as pressed', () => {
		render(<Controlled />);
		expect(screen.getByRole('radio', { name: 'One' })).toHaveAttribute('data-state', 'on');
		expect(screen.getByRole('radio', { name: 'Two' })).toHaveAttribute('data-state', 'off');
	});

	it('selects another option on click', () => {
		const onChange = vi.fn();
		render(<Controlled onChange={onChange} />);
		fireEvent.click(screen.getByRole('radio', { name: 'Two' }));
		expect(onChange).toHaveBeenCalledWith('two');
		expect(screen.getByRole('radio', { name: 'Two' })).toHaveAttribute('data-state', 'on');
	});

	it('never deselects the active option', () => {
		const onChange = vi.fn();
		render(<Controlled onChange={onChange} />);
		fireEvent.click(screen.getByRole('radio', { name: 'One' }));
		expect(onChange).not.toHaveBeenCalled();
		expect(screen.getByRole('radio', { name: 'One' })).toHaveAttribute('data-state', 'on');
	});

	it('respects disabled options and a disabled group', () => {
		const { rerender } = render(<Controlled />);
		expect(screen.getByRole('radio', { name: 'Three' })).toBeDisabled();

		rerender(
			<SegmentedControl aria-label='Mode' value='one' onValueChange={vi.fn()} options={OPTIONS} disabled />,
		);
		for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
	});

	it('keeps the pressed state on options with a tooltip', () => {
		render(
			<SegmentedControl
				aria-label='Mode'
				value='one'
				onValueChange={vi.fn()}
				options={[
					{ value: 'one', label: 'One', tooltip: 'First' },
					{ value: 'two', label: 'Two', tooltip: 'Second' },
				]}
			/>,
		);
		expect(screen.getByRole('radio', { name: 'One' })).toHaveAttribute('data-state', 'on');
		expect(screen.getByRole('radio', { name: 'Two' })).toHaveAttribute('data-state', 'off');
		expect(screen.getByRole('radio', { name: 'One' })).toHaveAccessibleDescription('First');
	});

	it('renders the option icon', () => {
		render(<Controlled />);
		expect(screen.getByRole('radio', { name: 'One' }).querySelector('svg')).not.toBeNull();
	});
});
