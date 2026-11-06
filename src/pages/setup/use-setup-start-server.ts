import * as React from 'react';
import { type Server, useServers } from '@/data/servers';
import { useServerJavaResolver } from '@/data/java-download';
import { startServer } from '@/lib/server-controls';

/** Starts a server from the hosting setup (resolving its Java first), one at a time. */
export const useSetupStartServer = () => {
	const { setServerStatus, updateServerStats } = useServers();
	const resolveServerJava = useServerJavaResolver();
	const [isBusy, setIsBusy] = React.useState(false);
	const busyRef = React.useRef(false);

	const start = React.useCallback(
		async (server: Server) => {
			if (busyRef.current) return;
			busyRef.current = true;
			setIsBusy(true);
			try {
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
