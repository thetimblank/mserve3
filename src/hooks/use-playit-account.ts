import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';

import type { PlayitClaimStateEvent } from '@/pages/server/server-types';

export type PlayitClaimState = {
	status: 'idle' | 'pending' | 'claimed' | 'error';
	claimUrl: string | null;
	error: string | null;
};

export type PlayitAccount = {
	/** Whether the global playit.gg account has been claimed (`null` while loading). */
	claimed: boolean | null;
	claimState: PlayitClaimState;
	busy: boolean;
	/** Begins the account claim flow and opens the approval URL in the browser. */
	connectAccount: () => Promise<void>;
	/** Forgets the stored playit.gg secret. */
	disconnectAccount: () => Promise<void>;
};

/**
 * Drives the install-wide playit.gg account: loads the claim status, subscribes to
 * the global `playit-claim-state` event, and exposes connect/disconnect actions.
 * The account is global (one secret per install), so this hook is intentionally
 * directory-agnostic and can be mounted anywhere (global settings, per-server UI).
 * All state is owned by the backend; this is a thin consumer of its commands/events.
 */
export function usePlayitAccount(): PlayitAccount {
	const [claimed, setClaimed] = React.useState<boolean | null>(null);
	const [claimState, setClaimState] = React.useState<PlayitClaimState>({
		status: 'idle',
		claimUrl: null,
		error: null,
	});
	const [busy, setBusy] = React.useState(false);

	// Initial account snapshot.
	React.useEffect(() => {
		let active = true;

		invoke<{ claimed: boolean }>('get_playit_status')
			.then((result) => active && setClaimed(result.claimed))
			.catch(() => active && setClaimed(false));

		return () => {
			active = false;
		};
	}, []);

	// Account claim transitions (global, not per-server).
	React.useEffect(() => {
		let active = true;
		let unlisten: (() => void) | undefined;

		listen<PlayitClaimStateEvent>('playit-claim-state', (event) => {
			if (!active) return;
			const { status, claimUrl, error } = event.payload;
			setClaimState({ status, claimUrl, error });
			if (status === 'claimed') {
				setClaimed(true);
				toast.success('playit.gg account connected.');
			} else if (status === 'error') {
				toast.error(error ?? 'Failed to connect playit.gg account.');
			}
		})
			.then((cleanup) => {
				if (!active) {
					cleanup();
					return;
				}
				unlisten = cleanup;
			})
			.catch(() => {});

		return () => {
			active = false;
			unlisten?.();
		};
	}, []);

	const connectAccount = React.useCallback(async () => {
		setBusy(true);
		setClaimState({ status: 'pending', claimUrl: null, error: null });
		try {
			const url = await invoke<string>('start_playit_claim');
			setClaimState({ status: 'pending', claimUrl: url, error: null });
			await openUrl(url);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to start the claim.';
			setClaimState({ status: 'error', claimUrl: null, error: message });
			toast.error(message);
		} finally {
			setBusy(false);
		}
	}, []);

	const disconnectAccount = React.useCallback(async () => {
		setBusy(true);
		try {
			await invoke('disconnect_playit_account');
			setClaimed(false);
			setClaimState({ status: 'idle', claimUrl: null, error: null });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to disconnect.');
		} finally {
			setBusy(false);
		}
	}, []);

	return { claimed, claimState, busy, connectAccount, disconnectAccount };
}
