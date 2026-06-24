/**
 * Shared mapping from a raw {@link ServerTelemetryResult} (the `get_server_telemetry`
 * Tauri command) to a partial {@link Server.stats} patch, honoring each provider's
 * `supported_telemetry` capabilities. Used by the server detail page runtime hook
 * and the network page poller so both interpret telemetry identically.
 */
import type { Server } from '@/data/servers';
import type { TelemetryKey } from '@/lib/mserve-schema';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import type { ServerTelemetryResult } from '@/pages/server/server-types';

const toUptimeDate = (value: string | null): Date | null => {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const mapTelemetryToStats = (
	server: Pick<Server, 'provider'>,
	telemetry: ServerTelemetryResult,
	options?: { fallbackUptime?: Date | null },
): Partial<Server['stats']> => {
	const supported = server.provider?.supported_telemetry ?? [];
	const supports = (key: TelemetryKey) => supported.includes(key);
	const capabilities = getServerProviderCapabilities(server.provider);
	const pingAvailable = supports('online') && telemetry.online;

	const nextStats: Partial<Server['stats']> = {
		uptime: toUptimeDate(telemetry.uptime) ?? options?.fallbackUptime ?? null,
		players_online: supports('list') && pingAvailable ? telemetry.playersOnline : null,
		players_max: supports('list') && pingAvailable ? telemetry.playersMax : null,
		server_version: supports('version') && pingAvailable ? telemetry.serverVersion : null,
		provider_version: supports('provider') ? telemetry.providerVersion : null,
		ram_used: supports('ram') ? telemetry.ramUsed : null,
		cpu_used: supports('cpu') ? telemetry.cpuUsed : null,
	};

	if (supports('online')) {
		nextStats.online = telemetry.online;
		if (!telemetry.online) {
			nextStats.players_online = null;
			nextStats.players_max = null;
			nextStats.server_version = null;
		}
	}

	if (!capabilities.supportsTpsCommand || !supports('tps')) {
		nextStats.tps = null;
	}

	return nextStats;
};

/** Whether a provider can report online/offline via a status ping. */
export const providerSupportsOnlinePing = (server: Pick<Server, 'provider'>): boolean =>
	(server.provider?.supported_telemetry ?? []).includes('online');
