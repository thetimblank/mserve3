/**
 * Registry of quick-help topics rendered by {@link file://./help-slideshow.tsx}.
 * Each topic is a short slide deck (Robinhood-style "learn" cards) opened from
 * a {@link file://./help-button.tsx} anywhere in the app. Big/advanced topics
 * additionally deep-link to their full interactive page via `learnMore`.
 */
import {
	Archive,
	ArrowDownUp,
	Boxes,
	CalendarClock,
	Coffee,
	Cpu,
	Globe,
	KeyRound,
	Layers,
	Lock,
	MemoryStick,
	Network,
	Package,
	RefreshCcw,
	Rocket,
	Route,
	Settings2,
	ShieldCheck,
	Timer,
	UploadCloud,
	Wand2,
	Wifi,
	type LucideIcon,
} from 'lucide-react';

export type HelpSlide = {
	icon: LucideIcon;
	title: string;
	body: string;
};

export type HelpTopic = {
	title: string;
	slides: HelpSlide[];
	/** Optional deep-dive: a full interactive page for the topic. */
	learnMore?: { label: string; to: string };
};

export type HelpTopicId =
	| 'backups'
	| 'networks'
	| 'ram'
	| 'java'
	| 'auto-restart'
	| 'providers'
	| 'tunneling'
	| 'port-forwarding';

export const HELP_TOPICS: Record<HelpTopicId, HelpTopic> = {
	backups: {
		title: 'Backups',
		slides: [
			{
				icon: Archive,
				title: 'Snapshots of your server',
				body: 'A backup is a full copy of your chosen server contents at a moment in time. If a world corrupts or an update goes wrong, restore any backup with one click — mserve even snapshots the current state first, so a restore is never destructive.',
			},
			{
				icon: CalendarClock,
				title: 'Automatic backups',
				body: 'In Settings you can back up automatically when the server starts, when it stops, or on a timer while it runs. Manual backups can be named, like "before 1.21 update".',
			},
			{
				icon: Layers,
				title: 'Choose what gets saved',
				body: 'By default backups capture your worlds (with their datapacks). You can also include plugins or mods with their configs, and core config files like server.properties and the whitelist.',
			},
			{
				icon: Wand2,
				title: 'Smart retention',
				body: 'The smart policy keeps every backup from the last 2 days, then thins older ones to one per day, one per week, and one per month — so you keep useful history without filling your disk. Count, age, and storage limits can cap it further.',
			},
			{
				icon: Lock,
				title: 'Lock what matters',
				body: 'Lock any backup and no policy or storage limit will ever remove it. Great for milestones like a finished build or a pre-update snapshot.',
			},
		],
	},
	networks: {
		title: 'Server networks',
		slides: [
			{
				icon: Network,
				title: 'Many servers, one address',
				body: 'A network puts several servers behind one Velocity proxy. Players connect to a single address and can be moved between servers (survival, creative, minigames…) without reconnecting.',
			},
			{
				icon: Route,
				title: 'Proxy and backends',
				body: 'The proxy is the front door — it owns the public port. Your normal servers become "backends" that only talk to the proxy. mserve assigns each backend a private port automatically.',
			},
			{
				icon: KeyRound,
				title: 'Secure forwarding',
				body: 'Modern forwarding lets backends trust the proxy with player identities. mserve generates a shared secret and syncs it to the proxy and every Paper/Folia backend for you.',
			},
			{
				icon: UploadCloud,
				title: 'Nothing changes until you apply',
				body: 'Edits on the canvas are just a plan. "Apply changes" shows exactly which config files will be written — with before/after — and only writes when you confirm. Servers must be stopped at that moment.',
			},
			{
				icon: Rocket,
				title: 'Run it as one unit',
				body: 'The Run menu starts the whole network in the right order: backends first, proxy last (and stops in reverse). Right-click any node for per-server controls.',
			},
		],
	},
	ram: {
		title: 'Server memory (RAM)',
		slides: [
			{
				icon: MemoryStick,
				title: 'What the slider sets',
				body: "This sets the Java heap (-Xms/-Xmx) — the memory reserved for the Minecraft server itself. It's the biggest single factor in how many players and mods a server can handle smoothly.",
			},
			{
				icon: Settings2,
				title: 'How much is enough?',
				body: 'A small vanilla or Paper server runs well on 2–4 GB. Add roughly 1 GB per 10 extra players, and expect modpacks to want 6–8 GB or more. Proxies need very little (512 MB–1 GB).',
			},
			{
				icon: Cpu,
				title: "Don't give it everything",
				body: 'Leave a few GB for Windows/Linux and mserve itself. If your machine has 16 GB, keeping server heaps at or below ~10–12 GB total avoids swapping, which hurts far more than a smaller heap.',
			},
		],
	},
	java: {
		title: 'Java versions',
		slides: [
			{
				icon: Coffee,
				title: 'Minecraft runs on Java',
				body: 'Every server jar needs a Java runtime, and each Minecraft version has requirements: 1.21+ needs Java 21, 1.17–1.20 needs 17+. Older versions often need older Java.',
			},
			{
				icon: Wand2,
				title: 'mserve handles it',
				body: "Servers resolve a compatible installed Java automatically — and if a start fails on the wrong version, mserve steps down through your runtimes, or offers to download the right JDK for you.",
			},
			{
				icon: Settings2,
				title: 'Pin when you need to',
				body: 'You can pin a specific Java installation per server in its Settings, or set an app-wide default. When a fallback start succeeds, mserve remembers the working version for that server.',
			},
		],
		learnMore: { label: 'Open the full Java guide', to: '/java-guide' },
	},
	'auto-restart': {
		title: 'Auto restart',
		slides: [
			{
				icon: RefreshCcw,
				title: 'Back up after a crash',
				body: 'With auto restart on, mserve watches the server process. If it exits without you asking it to (a crash), the server is started again immediately.',
			},
			{
				icon: ShieldCheck,
				title: 'Intentional stops are respected',
				body: 'Stopping from the UI, the terminal ("stop"), or a restart never triggers an extra start — only unexpected exits do.',
			},
			{
				icon: Timer,
				title: 'Pairs well with backups',
				body: 'Enable "backup on stop" too: a crash then produces a snapshot before the restart, so whatever caused it can be rolled back.',
			},
		],
	},
	providers: {
		title: 'Server types (providers)',
		slides: [
			{
				icon: Boxes,
				title: 'What is a provider?',
				body: 'The provider is the server software that runs your world: Vanilla is Mojang\'s original, Paper is a faster fork with plugin support, and Fabric/Forge/NeoForge load mods.',
			},
			{
				icon: Package,
				title: 'Plugins vs. mods',
				body: 'Plugins (Paper/Spigot/Folia) extend the server only — players join with a normal client. Mods (Fabric/Forge/NeoForge) change the game itself and usually must be installed on every player\'s client too.',
			},
			{
				icon: Globe,
				title: 'Proxies are special',
				body: 'Velocity and BungeeCord don\'t host worlds at all — they route players between servers in a network. That\'s why proxy servers have no worlds, datapacks, or backups tabs.',
			},
			{
				icon: Wand2,
				title: 'Not sure? Pick Paper',
				body: 'Paper on the latest Minecraft version is the best default: fast, stable, compatible with vanilla worlds, and ready for plugins whenever you want them.',
			},
		],
	},
	tunneling: {
		title: 'Public tunneling',
		slides: [
			{
				icon: Wifi,
				title: 'Share without port forwarding',
				body: 'Tunneling (via playit.gg) gives your server a public address that friends can join from anywhere — no router settings, no exposing your home IP.',
			},
			{
				icon: ArrowDownUp,
				title: 'How it works',
				body: 'A lightweight agent inside mserve keeps an outbound connection to the playit network. Player traffic enters through playit\'s servers and rides that connection back to you.',
			},
			{
				icon: ShieldCheck,
				title: 'One account, per-server tunnels',
				body: 'Claim your free playit account once in mserve, then flip the tunnel switch on any server. The public address stays the same across restarts.',
			},
		],
	},
	'port-forwarding': {
		title: 'Hosting & ports',
		slides: [
			{
				icon: Globe,
				title: 'Why ports matter',
				body: 'Friends outside your home network can only reach your server if its port (default 25565) is reachable from the internet — either via port forwarding on your router or a tunnel.',
			},
			{
				icon: ArrowDownUp,
				title: 'Two ways in',
				body: 'Port forwarding is the classic route: fast and direct, but requires router access and shares your IP. Tunneling needs zero setup and hides your IP, at the cost of a small detour.',
			},
			{
				icon: ShieldCheck,
				title: 'Firewall too',
				body: "Your OS firewall must also allow the port. mserve's hosting setup can create the firewall rule for you on Windows and Linux.",
			},
		],
		learnMore: { label: 'Open the hosting setup', to: '/setup' },
	},
};
