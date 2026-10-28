import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';

// One lookup per app session: total RAM doesn't change while mserve runs.
let pending: Promise<number | null> | null = null;

const loadSystemMemoryGb = () => {
	pending ??= invoke<number>('get_system_memory_gb')
		.then((memoryGb) => {
			const parsed = Number(memoryGb);
			return Number.isFinite(parsed) && parsed >= 1 ? Math.ceil(parsed) : null;
		})
		.catch(() => {
			pending = null;
			return null;
		});
	return pending;
};

/** Total system memory in whole GB, or `null` until (or unless) the backend reports it. */
export function useSystemMemoryGb(): number | null {
	const [memoryGb, setMemoryGb] = React.useState<number | null>(null);

	React.useEffect(() => {
		let active = true;
		void loadSystemMemoryGb().then((value) => {
			if (active) setMemoryGb(value);
		});
		return () => {
			active = false;
		};
	}, []);

	return memoryGb;
}
