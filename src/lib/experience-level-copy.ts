import { Gauge, Signpost, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { EXPERIENCE_LEVELS, type ExperienceLevel } from '@/data/user';

type ExperienceLevelCopy = {
	value: ExperienceLevel;
	label: string;
	icon: LucideIcon;
	description: string;
};

const COPY: Record<ExperienceLevel, Omit<ExperienceLevelCopy, 'value'>> = {
	beginner: {
		label: 'Beginner',
		icon: Signpost,
		description: 'Simple defaults and guidance. Only the settings most servers need.',
	},
	standard: {
		label: 'Standard',
		icon: SlidersHorizontal,
		description: 'The full app with safe defaults. Fine-tune memory, telemetry, and config files.',
	},
	advanced: {
		label: 'Advanced',
		icon: Gauge,
		description: 'Every option: custom Java flags, manual jars, raw config files, forwarding secrets.',
	},
};

/** Label, icon, and one-line description per tier, in tier order. Shared by onboarding and Settings. */
export const EXPERIENCE_LEVEL_COPY: readonly ExperienceLevelCopy[] = EXPERIENCE_LEVELS.map((value) => ({
	value,
	...COPY[value],
}));

export const getExperienceLevelCopy = (level: ExperienceLevel): ExperienceLevelCopy => ({
	value: level,
	...COPY[level],
});
