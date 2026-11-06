/**
 * First-launch welcome tour. Shown once (until finished or skipped,
 * `user.onboarding_completed`), it personalizes the app in under a minute:
 * experience level, theme, where quick help lives, and what the user wants to
 * build. Picking a goal finishes the tour and opens the matching place
 * (the wizard with its provider preselected, Networks, or the dashboard).
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import {
	ArrowLeft,
	ArrowRight,
	Blocks,
	ChevronRight,
	CircleHelp,
	Compass,
	Moon,
	MonitorCog,
	Network,
	Plug,
	Sun,
	Swords,
} from 'lucide-react';
import clsx from 'clsx';

import Logo from '@/components/logo';
import { HelpButton } from '@/components/help/help-button';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { type ExperienceLevel, useUser } from '@/data/user';
import { EXPERIENCE_LEVEL_COPY } from '@/lib/experience-level-copy';
import type { CreateServerPreset } from '@/pages/create-server/create-server-flow';

export type OnboardingGoal = 'survival' | 'modded' | 'plugins' | 'network' | 'explore';

type GoalDestination = { to: string; state?: CreateServerPreset };

/** Where each goal leads. Wizard goals preselect the provider through C1's router-state preset. */
export const ONBOARDING_GOAL_DESTINATIONS: Record<OnboardingGoal, GoalDestination> = {
	survival: { to: '/servers/new', state: { provider: 'vanilla' } },
	modded: { to: '/servers/new', state: { provider: 'fabric' } },
	plugins: { to: '/servers/new', state: { provider: 'paper' } },
	network: { to: '/network' },
	explore: { to: '/' },
};

const GOALS: { id: OnboardingGoal; icon: React.ElementType; title: string; description: string }[] = [
	{
		id: 'survival',
		icon: Swords,
		title: 'Survival Multiplayer',
		description: 'Classic SMP for friends on the latest Vanilla Minecraft version.',
	},
	{
		id: 'modded',
		icon: Blocks,
		title: 'A modded server',
		description: 'Fabric mods. You can switch to a Modrinth modpack in the wizard.',
	},
	{
		id: 'plugins',
		icon: Plug,
		title: 'Plugins & minigames',
		description: 'A Paper server with plugins from Modrinth.',
	},
	{
		id: 'network',
		icon: Network,
		title: 'A multi-server network',
		description: 'Several servers behind one Velocity proxy.',
	},
	{
		id: 'explore',
		icon: Compass,
		title: 'Just looking around',
		description: 'Start on the dashboard. Import existing servers from All Servers.',
	},
];

/** Slide order. Add a slide here and the dots, Continue, and Back follow. */
const SLIDES = ['welcome', 'level', 'theme', 'help', 'goal'] as const;
type SlideId = (typeof SLIDES)[number];
const TOTAL_SLIDES = SLIDES.length;
const GOAL_SLIDE = SLIDES.indexOf('goal');

const slideVariants = {
	enter: (direction: 1 | -1) => ({ x: direction * 64, opacity: 0 }),
	center: { x: 0, opacity: 1 },
	exit: (direction: 1 | -1) => ({ x: direction * -64, opacity: 0 }),
};

const CardIcon: React.FC<{ icon: React.ElementType; highlighted: boolean; className?: string }> = ({
	icon: Icon,
	highlighted,
	className,
}) => (
	<span
		className={clsx(
			'flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors',
			highlighted ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
			className,
		)}>
		<Icon className='size-5' />
	</span>
);

const CardText: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
	<span className='min-w-0 flex-1'>
		<span className='font-semibold'>{title}</span>
		{description && <span className='block text-sm text-muted-foreground'>{description}</span>}
	</span>
);

/** A single-choice card: stays on the slide and shows which option is picked. */
const ChoiceCard: React.FC<{
	icon: React.ElementType;
	title: string;
	description?: string;
	selected: boolean;
	onSelect: () => void;
}> = ({ icon, title, description, selected, onSelect }) => (
	<button
		type='button'
		aria-pressed={selected}
		onClick={onSelect}
		className={clsx(
			'flex w-full cursor-pointer items-center gap-3 rounded-2xl border-2 p-4 text-left transition-all',
			selected
				? 'border-primary bg-primary/5 ring-2 ring-primary/25'
				: 'border-border hover:border-muted-foreground/40 hover:bg-muted/40',
		)}>
		<CardIcon icon={icon} highlighted={selected} />
		<CardText title={title} description={description} />
	</button>
);

/** A card that acts on click (finishes the tour and navigates), so it reads like a link. */
const ActionCard: React.FC<{
	icon: React.ElementType;
	title: string;
	description: string;
	onClick: () => void;
}> = ({ icon, title, description, onClick }) => (
	<button
		type='button'
		onClick={onClick}
		className='group flex w-full cursor-pointer items-center gap-3 rounded-2xl border-2 border-border p-4 text-left transition-all hover:border-primary/60 hover:bg-primary/5'>
		<CardIcon icon={icon} highlighted={false} className='group-hover:bg-primary/15 group-hover:text-primary' />
		<CardText title={title} description={description} />
		<ChevronRight className='size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary' />
	</button>
);

export const OnboardingOverlay: React.FC = () => {
	const navigate = useNavigate();
	const location = useLocation();
	const { user, isReady, updateUser } = useUser();
	const { theme, setTheme } = useTheme();

	const [[slide, direction], setSlideState] = React.useState<[number, 1 | -1]>([0, 1]);
	// `null` until the user picks: users from before the tour see it once too,
	// and their saved setting must not be replaced by the tour's default.
	const [levelChoice, setLevelChoice] = React.useState<ExperienceLevel | null>(null);
	const level = levelChoice ?? user.experience_level;

	if (!isReady || user.onboarding_completed) return null;

	const slideId: SlideId = SLIDES[slide];

	const goTo = (next: number, dir: 1 | -1) => setSlideState([Math.min(Math.max(next, 0), TOTAL_SLIDES - 1), dir]);

	const finish = (destination?: GoalDestination) => {
		updateUser(
			levelChoice === null
				? { onboarding_completed: true }
				: { experience_level: levelChoice, onboarding_completed: true },
		);
		// The tour usually runs on the dashboard: don't stack a second '/' entry.
		if (destination)
			navigate(destination.to, { state: destination.state, replace: destination.to === location.pathname });
	};

	return (
		// z-50 (not higher) so quick-help dialogs and tooltips, which portal to the
		// end of <body> at z-50, open on top of the tour. Mounted after <Nav /> so
		// it still covers the title bar.
		<div className='fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background'>
			<div className='flex w-full max-w-xl flex-col px-8 py-10'>
				<div className='relative min-h-105'>
					<AnimatePresence mode='popLayout' custom={direction} initial={false}>
						<m.div
							key={slide}
							custom={direction}
							variants={slideVariants}
							initial='enter'
							animate='center'
							exit='exit'
							transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
							className='flex flex-col items-center text-center'>
							{slideId === 'welcome' && (
								<>
									<Logo size='lg' className='mb-8 scale-125' />
									<h1 className='mb-3 text-4xl font-black'>Welcome to mserve</h1>
									<p className='mb-8 max-w-md text-muted-foreground'>
										Create, run, and manage Minecraft servers easily. Setup takes less than a minute.
									</p>
									<div className='flex flex-col items-center gap-2'>
										<Button size='lg' onClick={() => goTo(1, 1)}>
											Get started <ArrowRight />
										</Button>
										<Button
											variant='ghost'
											size='sm'
											className='text-muted-foreground'
											onClick={() => finish()}>
											Skip tour
										</Button>
									</div>
								</>
							)}

							{slideId === 'level' && (
								<>
									<h2 className='mb-2 text-2xl font-bold'>How hands-on do you want to be?</h2>
									<p className='mb-6 text-sm text-muted-foreground'>
										You can change this anytime in Settings.
									</p>
									<div className='flex w-full flex-col gap-3'>
										{EXPERIENCE_LEVEL_COPY.map((entry) => (
											<ChoiceCard
												key={entry.value}
												icon={entry.icon}
												title={entry.label}
												description={entry.description}
												selected={level === entry.value}
												onSelect={() => setLevelChoice(entry.value)}
											/>
										))}
									</div>
								</>
							)}

							{slideId === 'theme' && (
								<>
									<h2 className='mb-2 text-2xl font-bold'>Pick your look</h2>
									<p className='mb-6 text-sm text-muted-foreground'>You can change this anytime in Settings.</p>
									<div className='flex w-full flex-col gap-3'>
										<ChoiceCard
											icon={Moon}
											title='Dark'
											selected={theme === 'dark'}
											onSelect={() => setTheme('dark')}
										/>
										<ChoiceCard
											icon={Sun}
											title='Light'
											selected={theme === 'light'}
											onSelect={() => setTheme('light')}
										/>
										<ChoiceCard
											icon={MonitorCog}
											title='Sync with System'
											selected={theme === 'system'}
											onSelect={() => setTheme('system')}
										/>
									</div>
								</>
							)}

							{slideId === 'help' && (
								<>
									<span className='mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary'>
										<CircleHelp className='size-8' />
									</span>
									<h2 className='mb-2 text-2xl font-bold'>Help is one click away</h2>
									<p className='mb-6 max-w-sm text-sm text-muted-foreground'>
										See a question mark next to a heading or setting? Click it for a short explainer.
									</p>
									<div className='flex w-full max-w-sm items-center gap-3 rounded-2xl bg-muted/50 p-4 text-left'>
										<span className='flex-1'>
											<span className='block font-semibold'>Server memory (RAM)</span>
											<span className='block text-sm text-muted-foreground'>Try it: click the question mark.</span>
										</span>
										<HelpButton topic='ram' className='size-8 text-primary ring-2 ring-primary/30' />
									</div>
								</>
							)}

							{slideId === 'goal' && (
								<>
									<h2 className='mb-2 text-2xl font-bold'>What do you want to build first?</h2>
									<p className='mb-6 text-sm text-muted-foreground'>Pick one and we'll take you there.</p>
									<div className='flex w-full flex-col gap-2.5'>
										{GOALS.map((entry) => (
											<ActionCard
												key={entry.id}
												icon={entry.icon}
												title={entry.title}
												description={entry.description}
												onClick={() => finish(ONBOARDING_GOAL_DESTINATIONS[entry.id])}
											/>
										))}
									</div>
								</>
							)}
						</m.div>
					</AnimatePresence>
				</div>

				<div className='mt-8 grid grid-cols-[1fr_auto_1fr] items-center'>
					<div>
						{slide > 0 && (
							<Button variant='ghost' onClick={() => goTo(slide - 1, -1)}>
								<ArrowLeft /> Back
							</Button>
						)}
					</div>

					<div className='flex items-center gap-1.5'>
						{Array.from({ length: TOTAL_SLIDES }, (_, dot) => (
							<span
								key={dot}
								className={clsx(
									'h-1.5 rounded-full transition-all duration-300',
									dot === slide ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30',
								)}
							/>
						))}
					</div>

					<div className='flex justify-end'>
						{slide > 0 && slide < GOAL_SLIDE && (
							<Button onClick={() => goTo(slide + 1, 1)}>
								Continue <ArrowRight />
							</Button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};
