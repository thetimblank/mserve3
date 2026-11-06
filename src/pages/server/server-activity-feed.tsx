import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
	CircleCheck,
	FileText,
	Gauge,
	type LucideIcon,
	LogIn,
	LogOut,
	MemoryStick,
	MessageSquare,
	Play,
	Power,
	Puzzle,
	ShieldX,
	Unplug,
	UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import EmptyState from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { buildWhitelistAddCommand, type ActivityEvent, type ActivityEventKind, type ActivityTone } from '@/lib/console-events';
import { cn, getErrorMessage } from '@/lib/utils';

const KIND_ICONS: Record<ActivityEventKind, LucideIcon> = {
	'player-joined': LogIn,
	'player-left': LogOut,
	chat: MessageSquare,
	'server-starting': Play,
	'server-ready': CircleCheck,
	'server-stopping': Power,
	'server-slow': Gauge,
	'port-in-use': Unplug,
	'eula-required': FileText,
	'plugin-failed': Puzzle,
	'not-whitelisted': ShieldX,
	'out-of-memory': MemoryStick,
	'low-tps': Gauge,
	'high-ram': MemoryStick,
};

const TONE_ICON_CLASS: Record<ActivityTone, string> = {
	info: 'bg-secondary text-muted-foreground',
	success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
	warning: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
	error: 'bg-destructive/15 text-destructive',
};

const formatTime = (at: number | null) =>
	at == null ? null : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

type RowProps = {
	event: ActivityEvent;
	canSendCommands: boolean;
	whitelisted: boolean;
	onAddToWhitelist: (player: string) => void;
};

const ActivityRow: React.FC<RowProps> = ({ event, canSendCommands, whitelisted, onAddToWhitelist }) => {
	const Icon = KIND_ICONS[event.kind];
	const time = formatTime(event.at);
	const isChat = event.kind === 'chat';
	const whitelistPlayer = event.kind === 'not-whitelisted' ? event.player : undefined;

	return (
		<li className='flex items-start gap-3 py-2.5'>
			<span
				className={cn(
					'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
					TONE_ICON_CLASS[event.tone],
				)}>
				<Icon />
			</span>
			<div className='min-w-0 flex-1'>
				<p className='text-sm'>
					<span className='font-medium'>{event.title}</span>
					{isChat && event.detail && <span className='break-words'>: {event.detail}</span>}
					{event.count > 1 && <span className='ml-1.5 text-xs text-muted-foreground'>×{event.count}</span>}
				</p>
				{!isChat && event.detail && <p className='text-sm text-muted-foreground'>{event.detail}</p>}
				{whitelistPlayer && (
					<Button
						size='sm'
						variant='secondary'
						className='mt-2'
						disabled={!canSendCommands || whitelisted}
						onClick={() => onAddToWhitelist(whitelistPlayer)}>
						<UserPlus />
						{whitelisted ? 'Added to whitelist' : 'Add to whitelist'}
					</Button>
				)}
			</div>
			{time && <span className='shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums'>{time}</span>}
		</li>
	);
};

type Props = {
	directory: string;
	events: ActivityEvent[];
	/** The server can take console commands (it is online). */
	canSendCommands: boolean;
	showRawConsole: boolean;
	onShowRawConsoleChange: (value: boolean) => void;
	/** The raw terminal, rendered in place of the feed when `showRawConsole`. */
	children: React.ReactNode;
};

/**
 * The beginner overview's console area: a readable activity feed by default,
 * with a toggle to reveal the raw terminal.
 */
const ServerActivityFeed: React.FC<Props> = ({
	directory,
	events,
	canSendCommands,
	showRawConsole,
	onShowRawConsoleChange,
	children,
}) => {
	const [whitelisted, setWhitelisted] = React.useState<ReadonlySet<string>>(() => new Set());

	React.useEffect(() => {
		setWhitelisted(new Set());
	}, [directory]);

	const handleAddToWhitelist = React.useCallback(
		async (player: string) => {
			const command = buildWhitelistAddCommand(player);
			if (!command) return;
			try {
				await invoke('send_server_command', { directory, command });
				setWhitelisted((previous) => new Set(previous).add(player));
				toast.success(`Added ${player} to the whitelist. Ask them to join again.`);
			} catch (error) {
				toast.error(getErrorMessage(error, `Failed to add ${player} to the whitelist.`));
			}
		},
		[directory],
	);

	return (
		<div className='flex min-w-0 flex-1 flex-col'>
			<div className='flex items-center justify-between gap-4 border-x-2 border-b-2 bg-card px-6 py-3 dark:border-none dark:bg-secondary/40'>
				<h3 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
					{showRawConsole ? 'Console' : 'Activity'}
				</h3>
				<Label htmlFor='server-activity-raw-console' className='font-normal text-muted-foreground'>
					<Checkbox
						id='server-activity-raw-console'
						checked={showRawConsole}
						onCheckedChange={(checked) => onShowRawConsoleChange(checked === true)}
					/>
					Show raw console
				</Label>
			</div>
			{showRawConsole ? (
				children
			) : (
				<div className='flex-1 rounded-b-xl border-x-2 border-b-2 bg-card px-6 dark:border-none dark:bg-secondary/40'>
					{events.length === 0 ? (
						<EmptyState
							title='Nothing has happened yet'
							description='Players joining, chat, and anything that needs your attention show up here.'
						/>
					) : (
						<ul className='max-h-185 divide-y overflow-y-auto app-scroll-area'>
							{events.map((event) => (
								<ActivityRow
									key={event.id}
									event={event}
									canSendCommands={canSendCommands}
									whitelisted={event.player != null && whitelisted.has(event.player)}
									onAddToWhitelist={(player) => void handleAddToWhitelist(player)}
								/>
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	);
};

export default React.memo(ServerActivityFeed);
