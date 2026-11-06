import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
	Ban,
	CloudSun,
	EllipsisVertical,
	Gamepad2,
	Heart,
	LogOut,
	Megaphone,
	Moon,
	Save,
	Shield,
	ShieldCheck,
	ShieldOff,
	Sun,
	User,
	UserPlus,
	Users,
	Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import EmptyState from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	BROADCAST_MAX_LENGTH,
	GAME_MODES,
	GAME_MODE_LABELS,
	buildBroadcastCommand,
	buildKeepInventoryCommand,
	buildPlayerActionCommand,
	buildWorldActionCommand,
	describePlayerAction,
	describeWorldAction,
	isPlayerActionAvailable,
	supportsModernCommands,
	type OnlinePlayer,
	type PlayerAction,
	type WorldAction,
} from '@/lib/player-actions';
import { cn, getErrorMessage } from '@/lib/utils';
import { useOnlinePlayers } from './hooks/use-online-players';

// ops.json / whitelist.json are written a moment after the command runs.
const REFRESH_AFTER_ACTION_MS = 1000;

type PlayerRowProps = {
	player: OnlinePlayer;
	modernCommands: boolean;
	disabled: boolean;
	onAction: (action: PlayerAction, player: string) => void;
};

const PlayerRow: React.FC<PlayerRowProps> = ({ player, modernCommands, disabled, onAction }) => {
	const run = (action: PlayerAction) => () => onAction(action, player.name);
	const available = (kind: PlayerAction['kind']) => isPlayerActionAvailable(kind, modernCommands);

	return (
		<li className='flex items-center gap-3 py-2'>
			<span className='flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground [&_svg]:size-4'>
				<User />
			</span>
			<div className='min-w-0 flex-1'>
				<p className='truncate text-sm font-medium'>{player.name}</p>
				{player.isOp && (
					<p className='flex items-center gap-1 text-xs text-muted-foreground'>
						<ShieldCheck className='size-3' />
						Operator
					</p>
				)}
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant='ghost'
						size='icon-sm'
						disabled={disabled}
						aria-label={`Actions for ${player.name}`}>
						<EllipsisVertical />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-52'>
					{player.isOp ? (
						<DropdownMenuItem onSelect={run({ kind: 'deop' })}>
							<ShieldOff /> Remove operator
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem onSelect={run({ kind: 'op' })}>
							<Shield /> Make operator
						</DropdownMenuItem>
					)}
					{!player.isWhitelisted && (
						<DropdownMenuItem onSelect={run({ kind: 'whitelist-add' })}>
							<UserPlus /> Add to whitelist
						</DropdownMenuItem>
					)}
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Gamepad2 /> Game mode
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{GAME_MODES.map((mode) => (
								<DropdownMenuItem key={mode} onSelect={run({ kind: 'gamemode', mode })}>
									{GAME_MODE_LABELS[mode]}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					{(available('heal') || available('lightning')) && <DropdownMenuSeparator />}
					{available('heal') && (
						<DropdownMenuItem onSelect={run({ kind: 'heal' })}>
							<Heart /> Heal
						</DropdownMenuItem>
					)}
					{available('lightning') && (
						<DropdownMenuItem onSelect={run({ kind: 'lightning' })}>
							<Zap /> Strike with lightning
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={run({ kind: 'kick' })}>
						<LogOut /> Kick
					</DropdownMenuItem>
					<DropdownMenuItem variant='destructive' onSelect={run({ kind: 'ban' })}>
						<Ban /> Ban
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</li>
	);
};

const WORLD_BUTTONS: { action: WorldAction; label: string; icon: React.ReactNode }[] = [
	{ action: 'day', label: 'Day', icon: <Sun /> },
	{ action: 'night', label: 'Night', icon: <Moon /> },
	{ action: 'clear-weather', label: 'Clear weather', icon: <CloudSun /> },
	{ action: 'save', label: 'Save world', icon: <Save /> },
];

type Props = {
	directory: string;
	/** The server's Minecraft version, to hide commands it doesn't know. */
	minecraftVersion: string | null;
	/** The live player count from telemetry; a change refreshes the list. */
	playersOnline: number | null;
	/** A lifecycle action is running: every action is disabled. */
	isBusy: boolean;
	className?: string;
};

/**
 * The beginner overview's players panel: who is online, a menu of quick
 * actions per player, and a row of world actions. Shown for an online game
 * server (proxies have no player list here). Every command is built by
 * `lib/player-actions.ts`, which refuses unsafe names and text.
 */
const ServerPlayersPanel: React.FC<Props> = ({ directory, minecraftVersion, playersOnline, isBusy, className }) => {
	const { data, error, refresh } = useOnlinePlayers({ directory, enabled: true, playersOnline });
	const [isSending, setIsSending] = React.useState(false);
	const [banTarget, setBanTarget] = React.useState<string | null>(null);
	const [broadcast, setBroadcast] = React.useState('');
	const [keepInventory, setKeepInventory] = React.useState<boolean | null>(null);
	const modernCommands = supportsModernCommands(minecraftVersion);
	const disabled = isBusy || isSending;

	// The server's answer replaces an optimistic toggle.
	React.useEffect(() => {
		setKeepInventory(data?.keepInventory ?? null);
	}, [data?.keepInventory]);

	const send = React.useCallback(
		async (command: string | null, success: string): Promise<boolean> => {
			if (!command) {
				toast.error('That action could not be sent safely.');
				return false;
			}
			setIsSending(true);
			try {
				await invoke('send_server_command', { directory, command });
				toast.success(success);
				window.setTimeout(refresh, REFRESH_AFTER_ACTION_MS);
				return true;
			} catch (err) {
				toast.error(getErrorMessage(err, 'The server did not take the command.'));
				return false;
			} finally {
				setIsSending(false);
			}
		},
		[directory, refresh],
	);

	const handlePlayerAction = React.useCallback(
		(action: PlayerAction, player: string) => {
			if (action.kind === 'ban') {
				setBanTarget(player);
				return;
			}
			void send(buildPlayerActionCommand(action, player), describePlayerAction(action, player));
		},
		[send],
	);

	const handleConfirmBan = () => {
		if (!banTarget) return;
		const action: PlayerAction = { kind: 'ban' };
		void send(buildPlayerActionCommand(action, banTarget), describePlayerAction(action, banTarget));
		setBanTarget(null);
	};

	const handleBroadcast = async (event: React.FormEvent) => {
		event.preventDefault();
		const command = buildBroadcastCommand(broadcast);
		if (!command) return;
		if (await send(command, 'Message sent to everyone.')) setBroadcast('');
	};

	const handleKeepInventoryChange = async (value: boolean) => {
		const rule = data?.keepInventoryRule;
		if (!rule) return;
		const previous = keepInventory;
		setKeepInventory(value);
		const sent = await send(
			buildKeepInventoryCommand(rule, value),
			value ? 'Players keep their items when they die.' : 'Players drop their items when they die.',
		);
		if (!sent) setKeepInventory(previous);
	};

	const players = data?.players ?? [];

	return (
		<section
			className={cn(
				'flex flex-col rounded-xl border-2 bg-card dark:border-none dark:bg-secondary/40',
				className,
			)}>
			<div className='flex items-center justify-between gap-4 border-b-2 px-6 py-3 dark:border-background/60'>
				<h3 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Players</h3>
				{data && (
					<span className='text-xs text-muted-foreground tabular-nums'>
						{data.online} / {data.max}
					</span>
				)}
			</div>

			<div className='px-6'>
				{!data ? (
					<p className='py-6 text-sm text-muted-foreground'>
						{error ? `Could not read the player list. ${error}` : 'Loading players…'}
					</p>
				) : players.length === 0 ? (
					<EmptyState
						icon={<Users />}
						title='No one is online'
						description='Players show up here when they join.'
					/>
				) : (
					<ul className='max-h-96 divide-y overflow-y-auto app-scroll-area'>
						{players.map((player) => (
							<PlayerRow
								key={player.name}
								player={player}
								modernCommands={modernCommands}
								disabled={disabled}
								onAction={handlePlayerAction}
							/>
						))}
					</ul>
				)}
			</div>

			<div className='mt-auto flex flex-col gap-3 border-t-2 px-6 py-4 dark:border-background/60'>
				<h3 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>World</h3>
				<div className='grid grid-cols-2 gap-2'>
					{WORLD_BUTTONS.map(({ action, label, icon }) => (
						<Button
							key={action}
							variant='secondary'
							size='sm'
							disabled={disabled}
							onClick={() => void send(buildWorldActionCommand(action), describeWorldAction(action))}>
							{icon}
							{label}
						</Button>
					))}
				</div>
				<Label htmlFor='server-players-keep-inventory' className='font-normal'>
					<Checkbox
						id='server-players-keep-inventory'
						checked={keepInventory === true}
						disabled={disabled || keepInventory === null || !data?.keepInventoryRule}
						onCheckedChange={(checked) => void handleKeepInventoryChange(checked === true)}
					/>
					Keep items after dying
				</Label>
				<form className='flex gap-2' onSubmit={(event) => void handleBroadcast(event)}>
					<Input
						value={broadcast}
						onChange={(event) => setBroadcast(event.target.value)}
						maxLength={BROADCAST_MAX_LENGTH}
						placeholder='Message everyone'
						aria-label='Message to broadcast'
						disabled={disabled}
					/>
					<Button
						type='submit'
						variant='secondary'
						disabled={disabled || !buildBroadcastCommand(broadcast)}
						aria-label='Broadcast'>
						<Megaphone />
						Send
					</Button>
				</form>
			</div>

			<AlertDialog open={banTarget !== null} onOpenChange={(open) => !open && setBanTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Ban {banTarget}?</AlertDialogTitle>
						<AlertDialogDescription>
							They are kicked and can't join again until you unban them with the console command{' '}
							<code>pardon {banTarget}</code>.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction variant='destructive' onClick={handleConfirmBan}>
							Ban
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
};

export default React.memo(ServerPlayersPanel);
