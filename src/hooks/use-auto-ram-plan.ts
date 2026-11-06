import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';

/** What auto RAM would give a server right now (the Rust `AutoRamPlan`). */
export type AutoRamPlan = {
	kind: 'proxy' | 'vanilla' | 'plugin' | 'modded' | 'modpack';
	/** What the server would like before the machine caps it. */
	estimateGb: number;
	/** The max heap (`-Xmx`) auto mode uses. */
	capGb: number;
	/** The starting heap (`-Xms`). */
	initialGb: number;
	minimumGb: number;
	systemCapGb: number;
	totalMemoryGb: number;
	/** Max heaps of the other servers mserve is running. */
	otherServersGb: number;
	/** The estimate didn't fit, so `capGb` is lower than what the server wants. */
	exceedsSystemCap: boolean;
};

type Args = {
	/** The server folder (plugins, mods, max-players are read from it). Omit in the create wizard. */
	directory?: string;
	/** Provider name; overrides the one in mserve.json. */
	provider?: string | null;
	/** Size it as a modpack (the wizard, before the pack is installed). */
	modpack?: boolean;
	enabled?: boolean;
};

/**
 * Asks the backend (the one place the estimate lives) what auto RAM would pick.
 * `null` while loading or when it can't be computed.
 */
export function useAutoRamPlan({ directory, provider, modpack = false, enabled = true }: Args): AutoRamPlan | null {
	const [plan, setPlan] = React.useState<AutoRamPlan | null>(null);

	React.useEffect(() => {
		if (!enabled) return;
		let active = true;
		invoke<AutoRamPlan>('get_auto_ram_plan', {
			directory: directory || null,
			provider: provider || null,
			modpack,
		})
			.then((next) => {
				if (active) setPlan(next);
			})
			.catch(() => {
				if (active) setPlan(null);
			});
		return () => {
			active = false;
		};
	}, [directory, enabled, modpack, provider]);

	return plan;
}
