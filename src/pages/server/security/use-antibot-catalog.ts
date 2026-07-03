import React from 'react';
import { toast } from 'sonner';
import {
	getModrinthProject,
	getModrinthProjectPageUrl,
	installModrinthFile,
	listModrinthProjectVersions,
	resolveModrinthGameVersion,
	resolveModrinthPluginLoaders,
	type ModrinthProjectDetails,
	type ModrinthVersion,
} from '@/lib/modrinth-service';
import { candidatesForLoaders } from '@/lib/security-antibot-catalog';
import type { Server } from '@/data/servers';

export type ResolvedAntiBot = {
	slug: string;
	note: string;
	project: ModrinthProjectDetails;
	/** Best (newest release, loader/version-filtered) installable build. */
	version: ModrinthVersion;
};

/** Picks the newest release build, falling back to the newest of any channel. */
const pickBestVersion = (versions: ModrinthVersion[]): ModrinthVersion | null => {
	if (versions.length === 0) return null;
	const release = versions.filter((version) => version.versionType === 'release');
	const pool = release.length > 0 ? release : versions;
	return [...pool].sort(
		(a, b) => new Date(b.datePublished).getTime() - new Date(a.datePublished).getTime(),
	)[0];
};

/**
 * Resolves the curated anti-bot plugins against the live Modrinth API, keeping
 * only those that (a) exist and (b) have a build for this server's loader + game
 * version. Anything unresolvable is silently dropped so the UI never offers a
 * broken install.
 */
export const useAntiBotCatalog = (server: Server) => {
	const [resolved, setResolved] = React.useState<ResolvedAntiBot[]>([]);
	const [isLoading, setIsLoading] = React.useState(true);
	const [installingSlug, setInstallingSlug] = React.useState<string | null>(null);

	const loaders = React.useMemo(
		() => resolveModrinthPluginLoaders(server.provider),
		[server.provider],
	);
	const gameVersion = React.useMemo(
		() => resolveModrinthGameVersion(server.provider),
		[server.provider],
	);

	React.useEffect(() => {
		let active = true;
		setIsLoading(true);

		const candidates = candidatesForLoaders(loaders);
		void Promise.all(
			candidates.map(async (candidate): Promise<ResolvedAntiBot | null> => {
				try {
					const [project, versions] = await Promise.all([
						getModrinthProject(candidate.slug),
						listModrinthProjectVersions(candidate.slug, {
							loaders,
							gameVersions: gameVersion ? [gameVersion] : [],
						}),
					]);
					const version = pickBestVersion(versions);
					if (!version) return null;
					return { slug: candidate.slug, note: candidate.note, project, version };
				} catch {
					return null;
				}
			}),
		).then((results) => {
			if (!active) return;
			setResolved(results.filter((entry): entry is ResolvedAntiBot => entry !== null));
			setIsLoading(false);
		});

		return () => {
			active = false;
		};
	}, [loaders, gameVersion]);

	const install = React.useCallback(
		async (entry: ResolvedAntiBot, onInstalled?: () => void | Promise<void>) => {
			setInstallingSlug(entry.slug);
			try {
				await installModrinthFile({
					directory: server.directory,
					itemType: 'plugin',
					version: entry.version,
					projectTitle: entry.project.title,
					pageUrl: getModrinthProjectPageUrl('plugin', entry.slug),
				});
				toast.success(`Installed ${entry.project.title}.`);
				await onInstalled?.();
			} catch (err) {
				toast.error(err instanceof Error ? err.message : `Could not install ${entry.project.title}.`);
			} finally {
				setInstallingSlug(null);
			}
		},
		[server.directory],
	);

	return { resolved, isLoading, installingSlug, install };
};
