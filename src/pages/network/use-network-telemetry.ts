/**
 * Polls live telemetry for every server referenced by the active network while
 * the Network page is mounted, so the canvas node metrics stay fresh. Telemetry
 * is otherwise only polled on the server detail page, so without this the network
 * view would show stale stats. Reuses the shared {@link mapTelemetryToStats}.
 */
import React from 'react';
import { invoke } from '@tauri-apps/api/core';

import type { Server } from '@/data/servers';
import { useServers } from '@/data/servers';
import { getNetworkServerIds, type ManagedNetwork } from '@/lib/network-schema';
import { mapTelemetryToStats, providerSupportsOnlinePing } from '@/lib/server-telemetry';
import type { ServerTelemetryResult } from '@/pages/server/server-types';

const TELEMETRY_POLL_INTERVAL_MS = 5000;

export const useNetworkTelemetry = (network: ManagedNetwork | null, servers: Server[]) => {
	const { updateServerStats } = useServers();

	// Keep the latest server list in a ref so the polling effect doesn't restart
	// every time stats update (which would reset the interval each tick).
	const serversRef = React.useRef(servers);
	serversRef.current = servers;

	const serverIds = network ? getNetworkServerIds(network) : [];
	const serverIdsKey = serverIds.join(',');

	React.useEffect(() => {
		if (!serverIdsKey) return;
		const ids = serverIdsKey.split(',');
		const inFlight = new Set<string>();
		let active = true;

		const poll = async () => {
			const byId = new Map(serversRef.current.map((server) => [server.id, server]));
			await Promise.all(
				ids.map(async (id) => {
					const server = byId.get(id);
					if (!server || inFlight.has(id)) return;
					inFlight.add(id);
					try {
						const telemetry = await invoke<ServerTelemetryResult>('get_server_telemetry', {
							directory: server.directory,
						});
						if (!active) return;
						updateServerStats(id, mapTelemetryToStats(server, telemetry));
					} catch {
						if (!active) return;
						if (providerSupportsOnlinePing(server)) {
							updateServerStats(id, {
								online: false,
								players_online: null,
								players_max: null,
								server_version: null,
							});
						}
					} finally {
						inFlight.delete(id);
					}
				}),
			);
		};

		void poll();
		const interval = setInterval(() => void poll(), TELEMETRY_POLL_INTERVAL_MS);
		return () => {
			active = false;
			clearInterval(interval);
		};
	}, [serverIdsKey, updateServerStats]);
};
