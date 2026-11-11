import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { type Server, useServers } from '@/data/servers';
import { useServerJavaResolver } from '@/data/java-download';
import { startServer } from '@/lib/server-controls';
import { getErrorMessage } from '@/lib/utils';

/** Turns on automatic router forwarding (UPnP) for a server; failures only warn. */
export const enableServerUpnp = async (server: Server) => {
	try {
		await invoke('set_server_upnp', { directory: server.directory, enabled: true });
	} catch (err) {
		toast.error(getErrorMessage(err, `Couldn't turn on router forwarding for ${server.name}.`));
	}
};

/** Starts a server from the hosting setup (resolving its Java first), one at a time. */
export const useSetupStartServer = () => {
	const { setServerStatus, updateServerStats } = useServers();
	const resolveServerJava = useServerJavaResolver();
	const [isBusy, setIsBusy] = React.useState(false);
	const busyRef = React.useRef(false);

	const start = React.useCallback(
		async (server: Server, options?: { upnp?: boolean }) => {
			if (busyRef.current) return;
			busyRef.current = true;
			setIsBusy(true);
			try {
				// Saved before the start so the backend forwards the port as it boots.
				if (options?.upnp) await enableServerUpnp(server);
				const javaExecutable = await resolveServerJava(server);
				if (!javaExecutable) return;
				await startServer({ server, javaExecutable, setServerStatus, updateServerStats });
			} finally {
				busyRef.current = false;
				setIsBusy(false);
			}
		},
		[resolveServerJava, setServerStatus, updateServerStats],
	);

	return { start, isBusy };
};
