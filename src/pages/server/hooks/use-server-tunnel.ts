import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';

import type { PlayitTunnelStateEvent, ServerTunnelInfo, TunnelStatus } from '../server-types';

export type ServerTunnel = {
	/** Whether tunneling is enabled for this server. */
	enabled: boolean;
	status: TunnelStatus;
	address: string | null;
	error: string | null;
	busy: boolean;
	/** Enables/disables tunneling for this server. */
	setEnabled: (next: boolean) => Promise<void>;
};

/**
 * Drives the per-server playit.gg tunnel: loads the tunnel snapshot, subscribes to
 * `playit-tunnel-state` for this server, and exposes the enable toggle. The global
 * account (claim/connect) is a separate, install-wide concern — see
 * `usePlayitAccount`. All state is owned by the backend; this hook is a thin
 * consumer of its commands + events.
 */
export function useServerTunnel(directory: string): ServerTunnel {
	const [enabled, setEnabledState] = React.useState(false);
	const [status, setStatus] = React.useState<TunnelStatus>('disabled');
	const [address, setAddress] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState(false);

	// Initial tunnel snapshot.
	React.useEffect(() => {
		let active = true;

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

	return { enabled, status, address, error, busy, setEnabled };
}
