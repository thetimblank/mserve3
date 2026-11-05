import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DurationPicker, type DurationPickerCustomInput } from './duration-picker';

type HarnessProps = {
	initial: number;
	onChange?: (minutes: number) => void;
	custom?: DurationPickerCustomInput;
	min?: number;
	max?: number;
	presets?: number[];
	disabled?: boolean;
};

const Harness: React.FC<HarnessProps> = ({ initial, onChange, ...props }) => {
	const [value, setValue] = React.useState(initial);
	return (
		<>
			<DurationPicker
				aria-label='Backup interval'
				value={value}
				onValueChange={(next) => {
					setValue(next);
					onChange?.(next);
				}}
				{...props}
			/>
			<output data-testid='value'>{value}</output>
		</>
	);
};

const currentValue = () => Number(screen.getByTestId('value').textContent);

describe('DurationPicker presets', () => {
	it('shows the default presets with the matching one pressed', () => {
		render(<Harness initial={60} />);
		for (const name of ['15 minutes', '30 minutes', '1 hour', '3 hours', '6 hours', '12 hours', '24 hours']) {
			expect(screen.getByRole('radio', { name })).toBeInTheDocument();
		}
		expect(screen.getByRole('radio', { name: '1 hour' })).toHaveAttribute('data-state', 'on');
		expect(screen.queryByRole('spinbutton', { name: 'Hours' })).toBeNull();
	});

	it('sets the value from a preset', () => {
		const onChange = vi.fn();
		render(<Harness initial={60} onChange={onChange} />);
		fireEvent.click(screen.getByRole('radio', { name: '3 hours' }));
		expect(onChange).toHaveBeenCalledWith(180);
	});

	it('opens the custom input for a value that is not a preset', () => {
		render(<Harness initial={95} />);
		expect(screen.getByRole('radio', { name: 'Custom' })).toHaveAttribute('data-state', 'on');
		expect(screen.getByRole('spinbutton', { name: 'Hours' })).toHaveAttribute('aria-valuenow', '1');
		expect(screen.getByRole('spinbutton', { name: 'Minutes' })).toHaveAttribute('aria-valuetext', '35 minutes');
	});

	it('opens Custom without changing the value, and a preset closes it', () => {
		const onChange = vi.fn();
		render(<Harness initial={30} onChange={onChange} />);
		fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
		expect(onChange).not.toHaveBeenCalled();
		expect(screen.getByRole('spinbutton', { name: 'Minutes' })).toHaveAttribute('aria-valuenow', '30');

		fireEvent.click(screen.getByRole('radio', { name: '6 hours' }));
		expect(currentValue()).toBe(360);
		expect(screen.queryByRole('spinbutton', { name: 'Hours' })).toBeNull();
	});

	it('keeps Custom open when the wheel lands on a preset value', () => {
		render(<Harness initial={25} />);
		fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Minutes' }), { key: 'ArrowUp' });
		expect(currentValue()).toBe(30);
		expect(screen.getByRole('radio', { name: 'Custom' })).toHaveAttribute('data-state', 'on');
		expect(screen.getByRole('spinbutton', { name: 'Hours' })).toBeInTheDocument();
	});

	it('follows an outside change back onto a preset', () => {
		const { rerender } = render(<DurationPicker aria-label='Interval' value={95} onValueChange={vi.fn()} />);
		expect(screen.getByRole('radio', { name: 'Custom' })).toHaveAttribute('data-state', 'on');
		rerender(<DurationPicker aria-label='Interval' value={60} onValueChange={vi.fn()} />);
		expect(screen.getByRole('radio', { name: '1 hour' })).toHaveAttribute('data-state', 'on');
		expect(screen.queryByRole('spinbutton', { name: 'Hours' })).toBeNull();
	});

	it('takes custom presets and hides those outside min/max', () => {
		render(<Harness initial={10} presets={[5, 10, 20, 600]} min={10} max={120} />);
		expect(screen.queryByRole('radio', { name: '5 minutes' })).toBeNull();
		expect(screen.queryByRole('radio', { name: '10 hours' })).toBeNull();
		expect(screen.getByRole('radio', { name: '10 minutes' })).toHaveAttribute('data-state', 'on');
		expect(screen.getByRole('radio', { name: '20 minutes' })).toBeInTheDocument();
		expect(screen.queryByRole('radio', { name: '15 minutes' })).toBeNull();
	});
});

describe('DurationPicker wheel', () => {
	it('steps with the arrow keys, Page Up/Down and Home/End', () => {
		render(<Harness initial={95} />);
		const hours = screen.getByRole('spinbutton', { name: 'Hours' });
		const minutes = screen.getByRole('spinbutton', { name: 'Minutes' });

		fireEvent.keyDown(hours, { key: 'ArrowUp' });
		expect(currentValue()).toBe(155);
		fireEvent.keyDown(minutes, { key: 'ArrowDown' });
		expect(currentValue()).toBe(150);
		fireEvent.keyDown(hours, { key: 'PageUp' });
		expect(currentValue()).toBe(7 * 60 + 30);
		fireEvent.keyDown(minutes, { key: 'End' });
		expect(currentValue()).toBe(7 * 60 + 55);
		fireEvent.keyDown(hours, { key: 'Home' });
		expect(currentValue()).toBe(55);
	});

	it('steps one item per mouse wheel notch and accumulates small trackpad deltas', () => {
		render(<Harness initial={95} />);
		const minutes = screen.getByRole('spinbutton', { name: 'Minutes' });

		fireEvent.wheel(minutes, { deltaY: 100 });
		expect(currentValue()).toBe(100);
		fireEvent.wheel(minutes, { deltaY: -100 });
		expect(currentValue()).toBe(95);

		fireEvent.wheel(minutes, { deltaY: 15 });
		fireEvent.wheel(minutes, { deltaY: 15 });
		expect(currentValue()).toBe(95);
		fireEvent.wheel(minutes, { deltaY: 15 });
		expect(currentValue()).toBe(100);
	});

	it('lets the page scroll when the column is already at its end', () => {
		render(<Harness initial={5} />);
		const hours = screen.getByRole('spinbutton', { name: 'Hours' });
		// fireEvent returns false when the listener called preventDefault.
		expect(fireEvent.wheel(hours, { deltaY: -100 })).toBe(true);
		expect(fireEvent.wheel(hours, { deltaY: 100 })).toBe(false);
		expect(currentValue()).toBe(65);
	});

	it('shows a stored value below min instead of a wrong item', () => {
		render(<DurationPicker aria-label='Interval' value={30} min={60} max={600} onValueChange={vi.fn()} />);
		expect(screen.getByRole('spinbutton', { name: 'Hours' })).toHaveAttribute('aria-valuemin', '0');
		expect(screen.getByRole('spinbutton', { name: 'Hours' })).toHaveAttribute('aria-valuenow', '0');
	});

	it('picks an item on click', () => {
		render(<Harness initial={95} />);
		const minutes = screen.getByRole('spinbutton', { name: 'Minutes' });
		fireEvent.click(within(minutes).getByText('45'));
		expect(currentValue()).toBe(105);
	});

	it('keeps the value within min and max', () => {
		render(<Harness initial={20} min={15} max={125} />);
		const hours = screen.getByRole('spinbutton', { name: 'Hours' });
		const minutes = screen.getByRole('spinbutton', { name: 'Minutes' });

		fireEvent.keyDown(minutes, { key: 'Home' });
		expect(currentValue()).toBe(15);
		fireEvent.keyDown(hours, { key: 'End' });
		expect(hours).toHaveAttribute('aria-valuemax', '2');
		fireEvent.keyDown(minutes, { key: 'End' });
		expect(currentValue()).toBe(125);
	});

	it('ignores input while disabled', () => {
		const onChange = vi.fn();
		render(<Harness initial={95} onChange={onChange} disabled />);
		const minutes = screen.getByRole('spinbutton', { name: 'Minutes' });
		fireEvent.keyDown(minutes, { key: 'ArrowUp' });
		fireEvent.wheel(minutes, { deltaY: 100 });
		expect(onChange).not.toHaveBeenCalled();
		for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
	});
});

describe('DurationPicker number-unit', () => {
	it('shows whole hours in hours and the rest in minutes', () => {
		const { unmount } = render(<Harness initial={120} presets={[]} custom='number-unit' />);
		expect(screen.getByRole('spinbutton', { name: 'Duration in hours' })).toHaveValue(2);
		expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveTextContent('hours');
		unmount();

		render(<Harness initial={95} custom='number-unit' />);
		expect(screen.getByRole('spinbutton', { name: 'Duration in minutes' })).toHaveValue(95);
		expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveTextContent('minutes');
	});

	it('emits valid input while typing and fixes out-of-range input on blur', () => {
		const onChange = vi.fn();
		render(<Harness initial={95} onChange={onChange} custom='number-unit' min={5} max={200} />);
		const input = screen.getByRole('spinbutton', { name: 'Duration in minutes' });

		fireEvent.change(input, { target: { value: '45' } });
		expect(onChange).toHaveBeenLastCalledWith(45);

		onChange.mockClear();
		fireEvent.change(input, { target: { value: '2' } });
		expect(onChange).not.toHaveBeenCalled();
		fireEvent.blur(input);
		expect(onChange).toHaveBeenLastCalledWith(5);
		expect(input).toHaveValue(5);

		fireEvent.change(input, { target: { value: '999' } });
		fireEvent.blur(input);
		expect(currentValue()).toBe(200);
		expect(input).toHaveValue(200);
	});

	it('restores the value when the input is cleared', () => {
		render(<Harness initial={95} custom='number-unit' />);
		const input = screen.getByRole('spinbutton', { name: 'Duration in minutes' });
		fireEvent.change(input, { target: { value: '' } });
		fireEvent.blur(input);
		expect(input).toHaveValue(95);
		expect(currentValue()).toBe(95);
	});

	it('follows a preset picked while the custom input is open', () => {
		render(<Harness initial={95} custom='number-unit' />);
		fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
		fireEvent.click(screen.getByRole('radio', { name: '30 minutes' }));
		expect(screen.queryByRole('spinbutton', { name: 'Duration in minutes' })).toBeNull();
		expect(currentValue()).toBe(30);
	});
});
