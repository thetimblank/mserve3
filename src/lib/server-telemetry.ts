/**
 * Shared helpers for turning backend runtime/telemetry events into the frontend
 * store shape. The backend supervisor is authoritative: it already decides which
 * metrics are available (emitting `null` when a provider can't report one), so
 * the frontend no longer does any provider-capability gating here.
 */
import type { Server, ServerStatus } from '@/data/servers';
import type { ServerRuntimeState, TelemetrySample } from '@/pages/server/server-types';

const toUptimeDate = (value: string | null): Date | null => {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Maps a backend {@link ServerRuntimeState} to the UI's {@link ServerStatus}.
 * `running-external` (a server we adopted) reads as online; `crashed` reads as
 * offline for status purposes — the crash itself is surfaced via a toast and
 * drives auto-restart elsewhere.
 */
export const mapRuntimeStateToStatus = (state: ServerRuntimeState): ServerStatus => {
	switch (state) {
		case 'starting':
			return 'starting';
		case 'online':
		case 'running-external':
			return 'online';
		case 'stopping':
			return 'closing';
		case 'crashed':
		case 'offline':
		default:
			return 'offline';
	}
};

/** Maps a live telemetry sample to a {@link Server.stats} patch. */
export const mapSampleToStats = (
	sample: TelemetrySample,
	options?: { fallbackUptime?: Date | null },
): Partial<Server['stats']> => ({
	online: sample.online,
	players_online: sample.playersOnline,
	players_max: sample.playersMax,
	server_version: sample.serverVersion,
	provider_version: sample.providerVersion,
	tps: sample.tps,
	ram_used: sample.ramUsed,
	cpu_used: sample.cpuUsed,
	uptime: toUptimeDate(sample.uptime) ?? options?.fallbackUptime ?? null,
});
