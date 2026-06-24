/**
 * Tracks which servers are currently "owned" by an open server detail page.
 *
 * The server detail page ({@link useServerRuntime}) runs a rich runtime loop
 * (terminal output, backups, auto-restart, telemetry). The app-wide
 * {@link ServerRuntimeMonitor} runs a leaner version of the same loop for every
 * *other* page so that starting a server from the dashboard or network view
 * still reaches a real online/offline state.
 *
 * To avoid the two loops fighting over the same server's status, the detail page
 * claims its server here on mount and releases it on unmount; the global monitor
 * skips any server that is currently claimed. This is plain module state (not
 * React state) because the monitor reads it imperatively each poll tick.
 */
const claimedServerIds = new Set<string>();

export const claimServerRuntime = (id: string): void => {
	claimedServerIds.add(id);
};

export const releaseServerRuntime = (id: string): void => {
	claimedServerIds.delete(id);
};

export const isServerRuntimeClaimed = (id: string): boolean => claimedServerIds.has(id);
