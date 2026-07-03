/**
 * Curated list of proven anti-bot / anti-DDoS plugins hosted on Modrinth. The
 * security section resolves each candidate live and hides any that fail to
 * resolve or that have no build for the server's loader + game version, so this
 * list can never surface a broken install. Modrinth is the only content source
 * (matching the rest of mserve).
 */
export type AntiBotCandidate = {
	/** Modrinth project slug. */
	slug: string;
	/** Loaders (Modrinth loader ids) the plugin ships for. */
	loaders: string[];
	/** One-line description shown before the project resolves. */
	note: string;
};

export const ANTI_BOT_CANDIDATES: AntiBotCandidate[] = [
	{
		slug: 'sonar',
		loaders: ['bukkit', 'bungeecord', 'folia', 'paper', 'purpur', 'spigot', 'velocity', 'waterfall'],
		note: 'Lightweight, effective bot-join & attack protection.',
	},
	{
		slug: 'epicguard',
		loaders: ['folia', 'paper', 'purpur', 'velocity', 'waterfall'],
		note: 'Anti-bot and VPN/proxy protection with a verification flow.',
	},
];

/** Candidates that ship for at least one of the server's resolved loaders. */
export const candidatesForLoaders = (loaders: string[]): AntiBotCandidate[] => {
	if (loaders.length === 0) return ANTI_BOT_CANDIDATES;
	const wanted = new Set(loaders.map((loader) => loader.toLowerCase()));
	return ANTI_BOT_CANDIDATES.filter((candidate) =>
		candidate.loaders.some((loader) => wanted.has(loader.toLowerCase())),
	);
};
