import * as React from 'react';
import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useExperience } from '@/data/user';
import { useCreateServer } from '../CreateServerContext';
import { isSameProviderChoice, type ProviderChoice } from '../create-server-flow';
import { GOAL_OPTIONS, PROVIDER_GRID_OPTIONS, type ProviderOption } from '../provider-options';
import SlideShell from './SlideShell';

const ProviderCard: React.FC<{
	option: ProviderOption;
	selected: boolean;
	onSelect: () => void;
}> = ({ option, selected, onSelect }) => {
	const Icon = option.icon;
	return (
		<button
			type='button'
			onClick={onSelect}
			aria-pressed={selected}
			className={clsx(
				'flex w-full cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all',
				selected
					? 'border-primary bg-primary/5 ring-2 ring-primary/25'
					: 'border-border hover:border-muted-foreground/40 hover:bg-muted/40',
			)}>
			<span className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary'>
				<Icon className='size-5' />
			</span>
			<span>
				<span className='font-semibold'>{option.title}</span>
				<span className='block text-sm text-muted-foreground'>{option.description}</span>
			</span>
		</button>
	);
};

const SlideProvider: React.FC = () => {
	const { providerChoice, chooseProvider, nextSlide, clearError } = useCreateServer();
	const { isBeginner } = useExperience();
	const options = isBeginner ? GOAL_OPTIONS : PROVIDER_GRID_OPTIONS;

	const pick = (choice: ProviderChoice) => {
		chooseProvider(choice);
		clearError();
		nextSlide();
	};

	return (
		<SlideShell
			fullWidth
			className={isBeginner ? 'max-w-3xl' : 'max-w-5xl'}
			title={isBeginner ? 'What do you want to build?' : 'Choose the server software'}
			helpTopic='providers'
			description={
				isBeginner
					? 'Pick the closest match. You choose the version on the next step.'
					: 'Pick the software that runs your server. You choose the version on the next step.'
			}
			actions={
				<Button type='button' onClick={() => providerChoice && pick(providerChoice)} disabled={!providerChoice}>
					Continue <ArrowRight />
				</Button>
			}>
			<div
				className={clsx(
					'grid grid-cols-1 gap-3 sm:grid-cols-2',
					!isBeginner && 'lg:grid-cols-4',
				)}>
				{options.map((option) => (
					<ProviderCard
						key={option.id}
						option={option}
						selected={isSameProviderChoice(providerChoice, option.choice)}
						onSelect={() => pick(option.choice)}
					/>
				))}
			</div>
		</SlideShell>
	);
};

export default SlideProvider;
