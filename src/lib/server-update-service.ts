import { type Provider, type ProviderName } from '@/lib/mserve-schema';
import { getProviderDescriptor } from '@/lib/server-provider';
import {
	fetchJarRows,
	resolveJarRow,
	type JarStability,
	type JarTab,
	type JarVersionRow,
} from '@/lib/jar-download-service';

/** What a server should be updated to: the picker row plus its resolved build. */
export type ServerUpdateTarget = {
	row: JarVersionRow;
	provider: Provider;
};

export type ServerUpdateCheck =
	| {
			status: 'update-available';
			currentLabel: string;
			latestLabel: string;
			/** True when the jump crosses a major Minecraft version (e.g. 1.21 → 1.22). */
			isMajorMcChange: boolean;
			target: ServerUpdateTarget;
	  }
	| { status: 'up-to-date'; currentLabel: string; latestLabel: string }
	| { status: 'unsupported'; reason: string };

type VersionParts = {
	/** The version family that matches a picker row's `version` (MC version for
	 *  plugin/vanilla, the proxy version for Velocity). */
	family: string;
	/** Numeric build number when the provider has one; `null` for vanilla. */
	build: number | null;
};

/** Splits a provider's stored version into a comparable family + build. */
const parseVersionParts = (
	providerId: ProviderName | string,
	providerVersion: string,
	minecraftVersion: string,
): VersionParts => {
	const id = providerId.toString().trim().toLowerCase();
	const rawProviderVersion = providerVersion.trim();

	if (id === 'velocity') {
		// Velocity stores `<family>-<build>` (e.g. "3.3.0-SNAPSHOT-451").
		const match = rawProviderVersion.match(/^(.*)-(\d+)$/);
		if (match) {
			return { family: match[1], build: Number(match[2]) };
		}
		return { family: rawProviderVersion, build: null };
	}

	if (id === 'vanilla') {
		// Vanilla has no build; `provider_version` is just the channel kind.
		return { family: minecraftVersion.trim(), build: null };
	}

	// Paper / Folia: `provider_version` is the numeric build, family is the MC version.
	const build = Number(rawProviderVersion);
	return {
		family: minecraftVersion.trim(),
		build: Number.isFinite(build) ? build : null,
	};
};

/** Leading numeric dotted prefix of a version, e.g. "1.21.4" → [1,21,4]. */
const parseNumericVersion = (value: string): number[] | null => {
	const match = value.trim().match(/^\d+(?:\.\d+)*/);
	if (!match) return null;
	return match[0].split('.').map((part) => Number(part));
};

/** -1 / 0 / 1 comparing two version families, or null when not comparable. */
const compareVersionFamilies = (left: string, right: string): number | null => {
	const a = parseNumericVersion(left);
	const b = parseNumericVersion(right);
	if (!a || !b) return null;

	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const x = a[index] ?? 0;
		const y = b[index] ?? 0;
		if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
};

/** A major MC change = the first two numeric components differ (1.21.x → 1.22.x
 *  or 1.20 → 1.21). Proxies have no MC version, so they never count as major. */
const isMajorMinecraftChange = (
	providerId: ProviderName | string,
	currentFamily: string,
	latestFamily: string,
): boolean => {
	if (providerId.toString().trim().toLowerCase() === 'velocity') return false;
	if (currentFamily === latestFamily) return false;

	const current = parseNumericVersion(currentFamily);
	const latest = parseNumericVersion(latestFamily);
	// If either side is unparseable (e.g. a vanilla snapshot id) treat it as
	// major so the user is warned before a potentially breaking change.
	if (!current || !latest) return true;

	return (current[0] ?? 0) !== (latest[0] ?? 0) || (current[1] ?? 0) !== (latest[1] ?? 0);
};

const stabilityMatchesChannel = (stability: JarStability, wantStable: boolean): boolean =>
	wantStable
		? stability === 'stable' || stability === 'release'
		: stability === 'unstable' || stability === 'snapshot';

const formatVersionLabel = (parts: VersionParts): string =>
	parts.build != null ? `${parts.family} (build ${parts.build})` : parts.family;

/**
 * Determines whether a newer build exists for a server's provider. Targets the
 * latest available build overall (which may cross Minecraft versions) — see the
 * provider catalog in {@link file://./server-provider.ts}. Reuses the existing
 * `list_provider_versions` / `resolve_provider_version` backend commands so no
 * new IPC surface is needed.
 *
 * Throws on network/backend failure; callers surface that as an error state.
 */
export const checkServerJarUpdate = async (provider: Provider): Promise<ServerUpdateCheck> => {
	const descriptor = getProviderDescriptor(provider.name);
	if (!descriptor) {
		return { status: 'unsupported', reason: 'This provider does not support update checks.' };
	}

	const tab: JarTab = descriptor.tab;
	const providerId = descriptor.name;
	const wantStable = provider.stable;
	const rows = await fetchJarRows(tab, !wantStable);

	const channelRows = rows.filter(
		(row) => row.providerId === providerId && stabilityMatchesChannel(row.stability, wantStable),
	);
	if (channelRows.length === 0) {
		return { status: 'unsupported', reason: 'No published versions were found for this provider.' };
	}

	// The backend returns versions newest-first, so the latest is the head.
	const latestRow = channelRows[0];

	const current = parseVersionParts(providerId, provider.provider_version, provider.minecraft_version);

	// Vanilla has no build to resolve, so a version comparison is enough; other
	// providers need the resolved build number to detect same-version bumps.
	let latest: VersionParts;
	let resolvedTarget: Provider;
	if (tab === 'vanilla') {
		latest = { family: latestRow.version, build: null };
		const { provider: resolved } = await resolveJarRow(latestRow);
		resolvedTarget = resolved;
	} else {
		const { provider: resolved } = await resolveJarRow(latestRow);
		resolvedTarget = resolved;
		const resolvedParts = parseVersionParts(
			providerId,
			resolved.provider_version,
			resolved.minecraft_version,
		);
		latest = { family: latestRow.version, build: resolvedParts.build };
	}

	const currentLabel = formatVersionLabel(current);
	const latestLabel = formatVersionLabel(latest);

	const available = isUpdateAvailable(current, latest, channelRows);
	if (!available) {
		return { status: 'up-to-date', currentLabel, latestLabel };
	}

	return {
		status: 'update-available',
		currentLabel,
		latestLabel,
		isMajorMcChange: isMajorMinecraftChange(providerId, current.family, latest.family),
		target: { row: latestRow, provider: resolvedTarget },
	};
};

const isUpdateAvailable = (
	current: VersionParts,
	latest: VersionParts,
	channelRows: JarVersionRow[],
): boolean => {
	if (current.family === latest.family) {
		// Same family: only a higher build number counts as an update.
		if (latest.build == null || current.build == null) return false;
		return latest.build > current.build;
	}

	const comparison = compareVersionFamilies(latest.family, current.family);
	if (comparison !== null && comparison !== 0) {
		return comparison > 0;
	}

	// Families differ but aren't numerically comparable (e.g. vanilla snapshots).
	// Fall back to list order: the current version sitting below the head means a
	// newer one exists. If it isn't in the channel at all, stay quiet rather than
	// nag with a possibly-bogus update.
	const currentIndex = channelRows.findIndex((row) => row.version === current.family);
	if (currentIndex === -1) return false;
	return currentIndex > 0;
};
