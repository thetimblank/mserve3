import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';

import type {
	PlayitClaimStateEvent,
	PlayitTunnelStateEvent,
	ServerTunnelInfo,
	TunnelStatus,
} from '../server-types';

type ClaimState = {
	status: 'idle' | 'pending' | 'claimed' | 'error';
	claimUrl: string | null;
	error: string | null;
};

export type ServerTunnel = {
	/** Whether the global playit.gg account has been claimed (`null` while loading). */
	claimed: boolean | null;
	claimState: ClaimState;
	/** Whether tunneling is enabled for this server. */
	enabled: boolean;
	status: TunnelStatus;
	address: string | null;
	error: string | null;
	busy: boolean;
	/** Begins the account claim flow and opens the approval URL in the browser. */
	connectAccount: () => Promise<void>;
	/** Forgets the stored playit.gg secret. */
	disconnectAccount: () => Promise<void>;
	/** Enables/disables tunneling for this server. */
	setEnabled: (next: boolean) => Promise<void>;
};

/**
 * Drives the per-server playit.gg tunnel UI: loads the account + tunnel snapshot,
 * subscribes to `playit-claim-state` / `playit-tunnel-state`, and exposes the
 * connect/toggle actions. All state is owned by the backend; this hook is a thin
 * consumer of its commands + events.
 */
export function useServerTunnel(directory: string): ServerTunnel {
	const [claimed, setClaimed] = React.useState<boolean | null>(null);
	const [claimState, setClaimState] = React.useState<ClaimState>({
		status: 'idle',
		claimUrl: null,
		error: null,
	});
	const [enabled, setEnabledState] = React.useState(false);
	const [status, setStatus] = React.useState<TunnelStatus>('disabled');
	const [address, setAddress] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState(false);

	// Initial account + tunnel snapshot.
	React.useEffect(() => {
		let active = true;

		invoke<{ claimed: boolean }>('get_playit_status')
			.then((result) => active && setClaimed(result.claimed))
			.catch(() => active && setClaimed(false));

		invoke<ServerTunnelInfo>('get_server_tunnel', { directory })
			.then((info) => {
				if (!active) return;
				setEnabledState(info.enabled);
				setStatus(info.status);
				setAddress(info.address);
			})
			.catch(() => {});

		return () => {
			active = false;
		};
	}, [directory]);

	// Live tunnel transitions for this server.
	React.useEffect(() => {
		let active = true;
		let unlisten: (() => void) | undefined;

		listen<PlayitTunnelStateEvent>('playit-tunnel-state', (event) => {
			if (event.payload.directory !== directory) return;
			setStatus(event.payload.status);
			if (event.payload.address) setAddress(event.payload.address);
			if (event.payload.status === 'online') setEnabledState(true);
			setError(event.payload.error);
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
	}, [directory]);

	// Account claim transitions (global, not per-server).
	React.useEffect(() => {
		let active = true;
		let unlisten: (() => void) | undefined;

		listen<PlayitClaimStateEvent>('playit-claim-state', (event) => {
			if (!active) return;
			const { status: claimStatus, claimUrl, error: claimError } = event.payload;
			setClaimState({ status: claimStatus, claimUrl, error: claimError });
			if (claimStatus === 'claimed') {
				setClaimed(true);
				toast.success('playit.gg account connected.');
			} else if (claimStatus === 'error') {
				toast.error(claimError ?? 'Failed to connect playit.gg account.');
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
			setEnabledState(false);
			setStatus('disabled');
			setAddress(null);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to disconnect.');
		} finally {
			setBusy(false);
		}
	}, []);

	const setEnabled = React.useCallback(
		async (next: boolean) => {
			setBusy(true);
			try {
				await invoke('set_server_tunnel', { directory, enabled: next });
				setEnabledState(next);
				setError(null);
				if (!next) {
					setStatus('offline');
				} else if (status === 'disabled') {
					setStatus('offline');
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to update tunneling.';
				toast.error(message);
			} finally {
				setBusy(false);
			}
		},
		[directory, status],
	);

	return {
		claimed,
		claimState,
		enabled,
		status,
		address,
		error,
		busy,
		connectAccount,
		disconnectAccount,
		setEnabled,
	};
}
