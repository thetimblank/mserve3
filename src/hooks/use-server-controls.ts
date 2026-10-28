import * as React from 'react';
import { useServers, type Server } from '@/data/servers';
import { useServerJavaResolver } from '@/data/java-download';
import {
	forceKillServer,
	restartServer,
	sleepServer,
	startServer,
	stopServer,
	type ServerControlContext,
} from '@/lib/server-controls';

type ControlAction = (context: ServerControlContext) => Promise<boolean>;

/**
 * Start/stop/restart/sleep/force-kill for one server, as used by the server
 * card, the dashboard tile and the network node menu. Start and restart resolve
 * a Java runtime first (offering a download when none fits); `isBusy` guards
 * against double clicks while an action is in flight.
 */
export function useServerControls(server: Server) {
	const { setServerStatus, updateServerStats } = useServers();
	const resolveServerJava = useServerJavaResolver();
	const [isBusy, setIsBusy] = React.useState(false);

	const run = async (action: ControlAction, needsJava: boolean) => {
		if (isBusy) return;
		setIsBusy(true);
		try {
			const javaExecutable = needsJava ? await resolveServerJava(server) : undefined;
			if (needsJava && !javaExecutable) return;
			await action({ server, javaExecutable: javaExecutable ?? undefined, setServerStatus, updateServerStats });
		} finally {
			setIsBusy(false);
		}
	};

	return {
		isBusy,
		start: () => void run(startServer, true),
		stop: () => void run(stopServer, false),
		sleep: () => void run(sleepServer, false),
		restart: () => void run(restartServer, true),
		forceKill: () => void run(forceKillServer, false),
	};
}
