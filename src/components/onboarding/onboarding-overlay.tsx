/**
 * First-launch welcome tour. Shown once (until finished or skipped —
 * `user.onboarding_completed`), it personalizes the app in under a minute:
 * experience level (advanced mode), theme, and what the user wants to build,
 * then points them at the right starting place.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import {
	ArrowLeft,
	ArrowRight,
	Blocks,
	Compass,
	Gauge,
	Moon,
	MonitorCog,
	Network,
	Plug,
	Sparkles,
	Sun,
	Swords,
	Wand2,
} from 'lucide-react';
import clsx from 'clsx';

import Logo from '@/components/logo';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { useUser } from '@/data/user';

type OnboardingGoal = 'survival' | 'modded' | 'plugins' | 'network' | 'explore';

const GOALS: { id: OnboardingGoal; icon: React.ElementType; title: string; description: string }[] = [
	{
		id: 'survival',
		icon: Swords,
		title: 'A survival server for friends',
		description: 'Classic SMP on the latest Minecraft version.',
	},
	{
		id: 'modded',
		icon: Blocks,
		title: 'A modded server',
		description: 'Fabric/Forge mods or a full Modrinth modpack.',
	},
	{
		id: 'plugins',
		icon: Plug,
		title: 'Plugins & minigames',
		description: 'Paper server with plugins from Modrinth.',
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
		description: 'Import an existing server or explore first.',
	},
];

const GOAL_RECOMMENDATIONS: Record<OnboardingGoal, string> = {
	survival:
		'In the wizard, pick Paper on the newest Minecraft version — it\'s marked Recommended and runs vanilla worlds faster.',
	modded:
		'In the wizard, choose Fabric — or pick a whole Modrinth modpack and mserve installs everything for you.',
	plugins:
		'Pick Paper in the wizard, then install plugins straight from the built-in Modrinth browser on the server page.',
	network:
		'Create your servers first (Paper backends + a Velocity proxy), then wire them together on the Networks page.',
	explore:
		'The dashboard shows everything at a glance. You can import an existing server folder from the All Servers page.',
};

const slideVariants = {
	enter: (direction: 1 | -1) => ({ x: direction * 64, opacity: 0 }),
	center: { x: 0, opacity: 1 },
	exit: (direction: 1 | -1) => ({ x: direction * -64, opacity: 0 }),
};

const ChoiceCard: React.FC<{
	icon: React.ElementType;
	title: string;
	description: string;
	selected: boolean;
	onSelect: () => void;
}> = ({ icon: Icon, title, description, selected, onSelect }) => (
	<button
		type='button'
		onClick={onSelect}
		className={clsx(
			'flex w-full cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all',
			selected
				? 'border-primary bg-primary/5 ring-2 ring-primary/25'
				: 'border-border hover:border-muted-foreground/40 hover:bg-muted/40',
		)}>
		<span
			className={clsx(
				'flex size-10 shrink-0 items-center justify-center rounded-xl',
				selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
			)}>
			<Icon className='size-5' />
		</span>
		<span>
			<span className='block font-semibold'>{title}</span>
			<span className='block text-sm text-muted-foreground'>{description}</span>
		</span>
	</button>
);

export const OnboardingOverlay: React.FC = () => {
	const navigate = useNavigate();
	const { user, isReady, updateUser } = useUser();
	const { theme, setTheme } = useTheme();

	const [[slide, direction], setSlideState] = React.useState<[number, 1 | -1]>([0, 1]);
	const [advanced, setAdvanced] = React.useState(false);
	const [goal, setGoal] = React.useState<OnboardingGoal | null>(null);

	if (!isReady || user.onboarding_completed) return null;

	const totalSlides = 4;
	const goTo = (next: number, dir: 1 | -1) => setSlideState([Math.min(Math.max(next, 0), totalSlides - 1), dir]);

	const finish = (destination?: string) => {
		updateUser({ advanced_mode: advanced, onboarding_completed: true });
		if (destination) navigate(destination);
	};

	const goalCta = goal === 'network' ? '/network' : goal === 'explore' ? undefined : '/servers/new';

	return (
		<div className='fixed inset-0 z-100 flex items-center justify-center overflow-y-auto bg-background'>
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
							{slide === 0 && (
								<>
									<Logo size='lg' className='mb-8 scale-125' />
									<h1 className='mb-3 text-4xl font-black'>Welcome to mserve</h1>
									<p className='mb-8 max-w-md text-muted-foreground'>
										Create, run, and manage Minecraft servers without touching a config file — backups,
										plugins, networks, and sharing included. Let's set things up for you in under a
										minute.
									</p>
									<Button size='lg' onClick={() => goTo(1, 1)}>
										Get started <ArrowRight />
									</Button>
								</>
							)}

							{slide === 1 && (
								<>
									<h2 className='mb-2 text-2xl font-bold'>How hands-on do you want to be?</h2>
									<p className='mb-6 text-sm text-muted-foreground'>
										You can change this anytime in Settings.
									</p>
									<div className='flex w-full flex-col gap-3'>
										<ChoiceCard
											icon={Wand2}
											title='Guided'
											description='Sensible defaults and recommendations. Advanced options stay out of the way.'
											selected={!advanced}
											onSelect={() => setAdvanced(false)}
										/>
										<ChoiceCard
											icon={Gauge}
											title='Advanced'
											description='Show every knob: custom flags, manual jars, forwarding secrets, host overrides.'
											selected={advanced}
											onSelect={() => setAdvanced(true)}
										/>
									</div>
								</>
							)}

							{slide === 2 && (
								<>
									<h2 className='mb-2 text-2xl font-bold'>Pick your look</h2>
									<p className='mb-6 text-sm text-muted-foreground'>Applied instantly — see for yourself.</p>
									<div className='flex w-full flex-col gap-3'>
										<ChoiceCard
											icon={Moon}
											title='Dark'
											description='Easy on the eyes. The classic server-admin choice.'
											selected={theme === 'dark'}
											onSelect={() => setTheme('dark')}
										/>
										<ChoiceCard
											icon={Sun}
											title='Light'
											description='Bright and crisp.'
											selected={theme === 'light'}
											onSelect={() => setTheme('light')}
										/>
										<ChoiceCard
											icon={MonitorCog}
											title='System'
											description='Follow your operating system setting.'
											selected={theme === 'system'}
											onSelect={() => setTheme('system')}
										/>
									</div>
								</>
							)}

							{slide === 3 && (
								<>
									<h2 className='mb-2 text-2xl font-bold'>What do you want to build first?</h2>
									<p className='mb-6 text-sm text-muted-foreground'>
										We'll point you at the right starting place.
									</p>
									<div className='flex w-full flex-col gap-2.5'>
										{GOALS.map((entry) => (
											<ChoiceCard
												key={entry.id}
												icon={entry.icon}
												title={entry.title}
												description={entry.description}
												selected={goal === entry.id}
												onSelect={() => setGoal(entry.id)}
											/>
										))}
									</div>
									{goal && (
										<m.p
											initial={{ opacity: 0, y: 8 }}
											animate={{ opacity: 1, y: 0 }}
											className='mt-4 flex items-start gap-2 rounded-xl bg-primary/5 p-3 text-left text-sm text-muted-foreground'>
											<Sparkles className='mt-0.5 size-4 shrink-0 text-primary' />
											{GOAL_RECOMMENDATIONS[goal]}
										</m.p>
									)}
								</>
							)}
						</m.div>
					</AnimatePresence>
				</div>

				<div className='mt-8 flex items-center justify-between'>
					{slide === 0 ? (
						<Button variant='ghost' className='text-muted-foreground' onClick={() => finish()}>
							Skip tour
						</Button>
					) : (
						<Button variant='ghost' onClick={() => goTo(slide - 1, -1)}>
							<ArrowLeft /> Back
						</Button>
					)}

					<div className='flex items-center gap-1.5'>
						{Array.from({ length: totalSlides }, (_, dot) => (
							<span
								key={dot}
								className={clsx(
									'h-1.5 rounded-full transition-all duration-300',
									dot === slide ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30',
								)}
							/>
						))}
					</div>

					{slide === 0 ? (
						<span className='w-20' />
					) : slide < totalSlides - 1 ? (
						<Button onClick={() => goTo(slide + 1, 1)}>
							Continue <ArrowRight />
						</Button>
					) : (
						<Button onClick={() => finish(goalCta)} disabled={goal === null}>
							{goal === 'explore' ? 'Open the dashboard' : goal === 'network' ? 'Open Networks' : 'Create my first server'}
							<ArrowRight />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
};
