import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';

import type { ServerUpnpInfo, ServerUpnpStateEvent, UpnpStatus } from '../server-types';
import { getErrorMessage } from '@/lib/utils';

export type ServerUpnp = {
	/** Whether automatic router forwarding is on for this server. */
	enabled: boolean;
	status: UpnpStatus;
	/** Public `ip:port` while the forward is active. */
	address: string | null;
	error: string | null;
	busy: boolean;
	/** Turns automatic router forwarding on/off for this server. */
	setEnabled: (next: boolean) => Promise<void>;
};

/**
 * Drives a server's UPnP router forward: loads the snapshot, follows
 * `server-upnp-state` for this server, and exposes the toggle. The backend owns
 * the mapping (it forwards on start, renews, and removes it on stop).
 */
export function useServerUpnp(directory: string): ServerUpnp {
	const [enabled, setEnabledState] = React.useState(false);
	const [status, setStatus] = React.useState<UpnpStatus>('disabled');
	const [address, setAddress] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState(false);

	React.useEffect(() => {
		let active = true;
		invoke<ServerUpnpInfo>('get_server_upnp', { directory })
			.then((info) => {
				if (!active) return;
				setEnabledState(info.enabled);
				setStatus(info.status);
				setAddress(info.address);
				setError(info.error);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [directory]);

	React.useEffect(() => {
		let active = true;
		let unlisten: (() => void) | undefined;

		listen<ServerUpnpStateEvent>('server-upnp-state', (event) => {
			if (event.payload.directory !== directory) return;
			setStatus(event.payload.status);
			setAddress(event.payload.address);
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
				await invoke('set_server_upnp', { directory, enabled: next });
				setEnabledState(next);
				setError(null);
				if (!next) {
					setStatus('disabled');
					setAddress(null);
				} else {
					setStatus((current) => (current === 'disabled' ? 'off' : current));
				}
			} catch (err) {
				toast.error(getErrorMessage(err, 'Failed to update router forwarding.'));
			} finally {
				setBusy(false);
			}
		},
		[directory],
	);

	return { enabled, status, address, error, busy, setEnabled };
}
