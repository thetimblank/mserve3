import React from 'react';

interface P {
	value: number;
	onChange?: (value: number) => void;
	disabled?: boolean;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(Math.max(value, min), max);

const Progress: React.FC<P> = ({ value, onChange, disabled = false }) => {
	const safeValue = clamp(value);
	const percent = Math.min(safeValue * 100, 100);

	return (
		<input
			type='range'
			min={0}
			max={1}
			step={0.001}
			value={safeValue}
			disabled={disabled}
			aria-label='Goal progress'
			onChange={(event) => onChange?.(Number(event.target.value))}
			className='goal-progress w-full h-1 rounded-full cursor-pointer transition-all duration-300'
			style={{
				background: `linear-gradient(to right, #22c55e 0%, #22c55e ${percent}%, var(--border) ${percent}%, var(--border) 100%)`,
				appearance: 'none',
				WebkitAppearance: 'none',
				MozAppearance: 'none',
			}}
		/>
	);
};

export default Progress;
