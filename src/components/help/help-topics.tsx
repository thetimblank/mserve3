/**
 * Registry of quick-help topics rendered by {@link file://./help-slideshow.tsx}.
 * Each topic is a short slide deck (Robinhood-style "learn" cards) opened from
 * a {@link file://./help-button.tsx} anywhere in the app. Big/advanced topics
 * additionally deep-link to their full interactive page via `learnMore`.
 */
import type { ReactNode } from 'react';
import {
	Archive,
	ArrowDownUp,
	BadgeCheck,
	Boxes,
	CalendarClock,
	Coffee,
	Cpu,
	Globe,
	KeyRound,
	Layers,
	ListFilter,
	Lock,
	MemoryStick,
	Network,
	Package,
	RefreshCcw,
	Rocket,
	Route,
	Settings2,
	ShieldCheck,
	ThumbsUp,
	Timer,
	UploadCloud,
	Wifi,
	type LucideIcon,
} from 'lucide-react';

import { ConnectionAddresses } from './help-connection-addresses';

type HelpSlide = {
	icon: LucideIcon;
	title: string;
	/** Plain-text explanation (a one-liner, or the lead-in for `bullets`). */
	body?: string;
	/** Short, scannable facts rendered as a list below `body`. Prefer these over a long `body`. */
	bullets?: string[];
	/** Live/interactive content rendered below (or instead of) `body`. */
	content?: ReactNode;
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
	| 'port-forwarding'
	| 'connecting';

export const HELP_TOPICS: Record<HelpTopicId, HelpTopic> = {
	backups: {
		title: 'Backups',
		slides: [
			{
				icon: Archive,
				title: 'Snapshots of your server',
				body: 'A backup is a full copy of your chosen server contents at a moment in time.',
				bullets: [
					'Restore any backup with one click if a world corrupts or an update goes wrong.',
					'mserve snapshots the current state first, so a restore is never destructive.',
				],
			},
			{
				icon: CalendarClock,
				title: 'Automatic backups',
				body: "Set these up in the server's Settings:",
				bullets: [
					'When the server starts',
					'When it stops',
					'On a timer while it runs',
					'Manual backups can be named, like "before 1.21 update".',
				],
			},
			{
				icon: Layers,
				title: 'Choose what gets saved',
				body: 'Backups capture your worlds (with their datapacks) by default. You can also include:',
				bullets: ['Plugins or mods, with their configs', 'Core config files like server.properties and the whitelist'],
			},
			{
				icon: ListFilter,
				title: 'Smart retention',
				body: 'The smart policy keeps useful history without filling your disk:',
				bullets: [
					'Every backup from the last 2 days',
					'Older ones thinned to one per day, one per week, and one per month',
					'Count, age, and storage limits can cap it further',
				],
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
				bullets: [
					'The proxy is the front door: it owns the public port.',
					'Your normal servers become "backends" that only talk to the proxy.',
					'mserve assigns each backend a private port automatically.',
				],
			},
			{
				icon: KeyRound,
				title: 'Secure forwarding',
				body: 'Modern forwarding lets backends trust the proxy with player identities. mserve generates a shared secret and syncs it to the proxy and every Paper/Folia backend for you.',
			},
			{
				icon: UploadCloud,
				title: 'Nothing changes until you apply',
				body: 'Edits on the canvas are just a plan.',
				bullets: [
					'"Apply changes" shows exactly which config files will be written, with before/after.',
					'Nothing is written until you confirm.',
					'Servers must be stopped at that moment.',
				],
			},
			{
				icon: Rocket,
				title: 'Run it as one unit',
				bullets: [
					'The Run menu starts the whole network in order: backends first, proxy last.',
					'Stopping happens in reverse.',
					'Right-click any node for per-server controls.',
				],
			},
		],
	},
	ram: {
		title: 'Server memory (RAM)',
		slides: [
			{
				icon: MemoryStick,
				title: 'What the slider sets',
				body: "This sets the Java heap (-Xms/-Xmx): the memory reserved for the Minecraft server itself. It's the biggest single factor in how many players and mods a server can handle smoothly.",
			},
			{
				icon: Settings2,
				title: 'How much is enough?',
				bullets: [
					'Small vanilla or Paper server: 2–4 GB',
					'Add roughly 1 GB per 10 extra players',
					'Modpacks: 6–8 GB or more',
					'Proxies: very little (512 MB–1 GB)',
				],
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
				body: 'Every server jar needs a Java runtime, and each Minecraft version has requirements:',
				bullets: ['1.21+ needs Java 21', '1.17–1.20 needs Java 17+', 'Older versions often need older Java'],
			},
			{
				icon: BadgeCheck,
				title: 'mserve handles it',
				body: 'Servers resolve a compatible installed Java automatically. If a start fails on the wrong version, mserve:',
				bullets: ['Steps down through your other runtimes', 'Or offers to download the right JDK for you'],
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
				body: 'Stopping from the UI, the terminal ("stop"), or a restart never triggers an extra start. Only unexpected exits do.',
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
				body: 'The provider is the server software that runs your world:',
				bullets: [
					"Vanilla: Mojang's original",
					'Paper: a faster fork with plugin support',
					'Fabric, Forge, NeoForge: load mods',
				],
			},
			{
				icon: Package,
				title: 'Plugins vs. mods',
				bullets: [
					'Plugins (Paper/Spigot/Folia) extend the server only. Players join with a normal client.',
					"Mods (Fabric/Forge/NeoForge) change the game itself and usually must be installed on every player's client too.",
				],
			},
			{
				icon: Globe,
				title: 'Proxies are special',
				body: "Velocity and BungeeCord don't host worlds at all. They route players between servers in a network, which is why proxy servers have no worlds, datapacks, or backups tabs.",
			},
			{
				icon: ThumbsUp,
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
				body: 'Tunneling (via playit.gg) gives your server a public address that friends can join from anywhere.',
				bullets: [
					'No router settings',
					'Works where forwarding is blocked (CGNAT, dorms, apartments)',
					'Your home IP stays hidden',
				],
			},
			{
				icon: ArrowDownUp,
				title: 'How it works',
				body: "A lightweight agent inside mserve keeps an outbound connection to the playit network. Player traffic enters through playit's servers and rides that connection back to you.",
			},
			{
				icon: Timer,
				title: 'The trade-offs',
				bullets: [
					'A bit more ping, depending on the nearest playit location',
					'Depends on playit.gg being up and on your account',
					"Players show up with a local address, so IP bans don't work (ban by name)",
				],
			},
			{
				icon: ShieldCheck,
				title: 'One account, per-server tunnels',
				body: 'Claim your free playit account once in mserve, then flip the tunnel switch on any server. The public address stays the same across restarts.',
			},
		],
		learnMore: { label: 'Open the hosting setup', to: '/setup' },
	},
	'port-forwarding': {
		title: 'Hosting & ports',
		slides: [
			{
				icon: Globe,
				title: 'Why ports matter',
				body: 'Friends outside your home network can only reach your server if its port (default 25565) is reachable from the internet. You can skip forwarding only when:',
				bullets: [
					'Everyone is on your Wi-Fi or home network (they use the local IP)',
					'You use a tunnel',
					'Your router opens ports on its own (UPnP), which the Minecraft server does not ask for',
				],
			},
			{
				icon: ArrowDownUp,
				title: 'Two ways in',
				bullets: [
					'Port forwarding: the classic route. Fast and direct, but needs router access and shares your IP.',
					'Tunneling: no router setup and hides your IP, at the cost of a small detour.',
				],
			},
			{
				icon: Route,
				title: 'What to forward',
				bullets: [
					'Port 25565 (or your server port), protocol TCP, incoming',
					"Point it at this PC's local IP, and reserve that IP in the router (DHCP reservation)",
				],
			},
			{
				icon: Network,
				title: 'When forwarding cannot work',
				body: 'Behind CGNAT (common on 5G home internet, Starlink and some fiber), your provider shares one public IP between many homes, so a forward never receives players. Use a tunnel.',
			},
			{
				icon: ShieldCheck,
				title: 'Firewall too',
				body: "Your OS firewall must also allow the port. mserve's hosting setup can create the firewall rule for you on Windows and Linux.",
			},
		],
		learnMore: { label: 'Open the hosting setup', to: '/setup' },
	},
	connecting: {
		title: 'Connecting to your server',
		slides: [
			{
				icon: Wifi,
				title: "Why can't people connect?",
				body: "It almost always comes down to one thing: the address your friend is using isn't reachable from where they are. Which address works depends on whether they're on your network or out on the internet.",
			},
			{
				icon: Network,
				title: 'Local IP vs. public IP',
				bullets: [
					'Local IP: only works for devices on the same Wi-Fi/network as this computer. Great for family or roommates.',
					'Public IP: how the internet sees you. It only works once the port is forwarded or a tunnel is running.',
				],
			},
			{
				icon: Globe,
				title: 'Your addresses',
				body: "Here's what to share, blurred by default. Local for people on your network, public for everyone else.",
				content: <ConnectionAddresses />,
			},
			{
				icon: ArrowDownUp,
				title: 'Two ways to open your server',
				body: 'Either one lets outside friends in:',
				bullets: [
					'Port forwarding: direct and fast, but needs router access and exposes your public IP.',
					'Tunneling (playit.gg): no router setup and hides your IP, at the cost of a small routing detour.',
				],
			},
			{
				icon: ShieldCheck,
				title: 'Still stuck?',
				body: 'Check that:',
				bullets: [
					'The server is actually online',
					'The port forward (TCP, to this PC) or the tunnel is set up, and your OS firewall allows the port',
					'Your friend uses the address that matches where they are (local or public)',
					'Behind CGNAT, only a tunnel works',
				],
			},
		],
		learnMore: { label: 'Open the full hosting guide', to: '/setup' },
	},
};
