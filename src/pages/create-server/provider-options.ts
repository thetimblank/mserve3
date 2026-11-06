import { Blocks, Network, Package, Pickaxe, Puzzle, type LucideIcon } from 'lucide-react';
import type { ProviderName } from '@/lib/mserve-schema';
import { getProviderDescriptor, getProviderDisplayName } from '@/lib/server-provider';
import type { ProviderChoice } from './create-server-flow';

/** One card on the wizard's provider slide. */
export type ProviderOption = {
	id: string;
	choice: ProviderChoice;
	icon: LucideIcon;
	title: string;
	description: string;
};

/** Icon for the "Modpack" choice, which isn't a provider descriptor. */
export const MODPACK_ICON = Package;

const MODPACK_CHOICE: ProviderChoice = { source: 'modpack' };

/** Beginner tier: what they want to build, each mapped to one provider. */
export const GOAL_OPTIONS: ProviderOption[] = [
	{
		id: 'vanilla',
		choice: { source: 'software', provider: 'vanilla' },
		icon: Pickaxe,
		title: 'Just Minecraft',
		description: 'The official game with nothing added, on the latest version.',
	},
	{
		id: 'plugins',
		choice: { source: 'software', provider: 'paper' },
		icon: Puzzle,
		title: 'Plugins & minigames',
		description: 'Add plugins like minigames, land claims, or an economy.',
	},
	{
		id: 'mods',
		choice: { source: 'software', provider: 'fabric' },
		icon: Blocks,
		title: 'Mods',
		description: 'Change the game itself. Players install the same mods.',
	},
	{
		id: 'modpack',
		choice: MODPACK_CHOICE,
		icon: MODPACK_ICON,
		title: 'A modpack',
		description: 'A ready-made pack from Modrinth, installed for you.',
	},
	{
		id: 'network',
		choice: { source: 'software', provider: 'velocity' },
		icon: Network,
		title: 'A network proxy',
		description: 'Link several servers behind one address.',
	},
];

/** Short picker blurbs (the descriptors' descriptions are longer, for tooltips). */
const PROVIDER_BLURBS: Partial<Record<ProviderName, string>> = {
	paper: 'Fast and runs plugins. The usual pick.',
	purpur: 'Paper with extra gameplay settings.',
	folia: 'Multithreaded Paper for very busy servers.',
	vanilla: 'The official server from Mojang.',
	fabric: 'Lightweight mod loader.',
	velocity: 'Modern proxy that links servers into a network.',
	bungeecord: 'Classic proxy for server networks.',
};

const GRID_PROVIDERS: ProviderName[] = [
	'paper',
	'purpur',
	'folia',
	'vanilla',
	'fabric',
	'velocity',
	'bungeecord',
];

/** Standard/Advanced tiers: every downloadable provider, plus modpacks. */
export const PROVIDER_GRID_OPTIONS: ProviderOption[] = [
	...GRID_PROVIDERS.flatMap((name): ProviderOption[] => {
		const descriptor = getProviderDescriptor(name);
		// Detection-only providers (forge, neoforge, spigot) never reach the grid.
		if (!descriptor?.selectable) return [];
		return [
			{
				id: name,
				choice: { source: 'software', provider: name },
				icon: descriptor.icon,
				title: getProviderDisplayName(name),
				description: PROVIDER_BLURBS[name] ?? descriptor.description,
			},
		];
	}),
	{
		id: 'modpack',
		choice: MODPACK_CHOICE,
		icon: MODPACK_ICON,
		title: 'Modpack',
		description: 'A Modrinth pack with its loader, installed for you.',
	},
];
