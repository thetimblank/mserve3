import React from 'react';
import {
	Activity,
	Archive,
	ArrowDownToLine,
	ArrowUpCircle,
	Boxes,
	CircleCheck,
	Clipboard,
	ClipboardCheck,
	Clock,
	Coffee,
	Cpu,
	Eye,
	EyeOff,
	Globe,
	MemoryStick,
	OctagonX,
	Package,
	RefreshCcw,
	TriangleAlert,
	Users,
	Wifi,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import OpenFolderButton from '@/components/open-folder-button';
import ServerStatus from '@/components/server-status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent } from '@/components/ui/card';
import type { Server } from '@/data/servers';
import { useUser } from '@/data/user';
import { useServerUpdates } from '@/data/server-updates';
import { type JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { javaResolutionLabel, resolveServerJavaExecutable } from '@/lib/java-resolution';
import { isProxyProvider } from '@/lib/server-provider';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import { getPrimaryMinecraftVersion } from '@/lib/utils';
import { formatBytes, formatUptime } from './server-utils';
import MetricCard from './stats/metric-card';
import { useServerTelemetryHistory } from './stats/use-server-telemetry-history';
import { METRIC_COLORS, formatPercent, toChartData } from './stats/stats-utils';

type Props = {
	server: Server;
	javaInstallationDefault: string;
	javaRuntimes: JavaRuntimeInfo[];
	isBusy: boolean;
	onStart: () => void;
	onStop: () => void;
	onRestart: () => void;
	onForceKill: () => void;
};

const UPTIME_REFRESH_MS = 1000;
// Short rolling window feeding the overview sparklines.
const SPARK_WINDOW_MS = 30 * 60 * 1000;

const UptimeText: React.FC<{ uptime: Date }> = React.memo(({ uptime }) => {
	const [, setTick] = React.useState(0);

	React.useEffect(() => {
		const intervalId = window.setInterval(() => {
			setTick((value) => value + 1);
		}, UPTIME_REFRESH_MS);

		return () => window.clearInterval(intervalId);
	}, [uptime]);

	return <>{formatUptime(uptime)}</>;
});

UptimeText.displayName = 'UptimeText';

const DetailItem: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({
	icon,
	label,
	children,
}) => (
	<div className='flex items-center gap-2 text-sm'>
		<span className='text-muted-foreground [&_svg]:size-4'>{icon}</span>
		<span className='text-muted-foreground'>{label}</span>
		<span className='ml-auto truncate font-medium'>{children}</span>
	</div>
);

const ServerOverviewPanel: React.FC<Props> = ({
	server,
	javaInstallationDefault,
	javaRuntimes,
	isBusy,
	onStart,
	onStop,
	onRestart,
	onForceKill,
}) => {
	const isOffline = server.status === 'offline';
	const isProxy = isProxyProvider(server.provider);
	const capabilities = getServerProviderCapabilities(server.provider);
	const { user } = useUser();
	const { getEntry: getUpdateEntry } = useServerUpdates();
	const updateEntry = getUpdateEntry(server.id);
	const availableUpdate =
		updateEntry.status === 'result' && updateEntry.check.status === 'update-available'
			? updateEntry.check
			: null;

	const [publicIp, setPublicIp] = React.useState<string | null>(null);
	const [ipHidden, setIpHidden] = React.useState(true);
	const [copied, setCopied] = React.useState(false);

	const copyToClipboard = React.useCallback((text: string | null) => {
		if (text == null) return;
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}, []);

	React.useEffect(() => {
		let active = true;
		invoke<string>('get_public_ip')
			.then((ip) => {
				if (active) setPublicIp(ip);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);

	const createdDateText = React.useMemo(() => {
		if (!server.created_at) return null;
		const value = new Date(server.created_at);
		if (Number.isNaN(value.getTime())) return null;
		return value.toLocaleDateString();
	}, [server.created_at]);

	const storageLimitBytes = React.useMemo(
		() => Math.max(1, Number(server.storage_limit) || 1) * 1024 * 1024 * 1024,
		[server.storage_limit],
	);
	const displayVersion = server.stats.server_version ?? server.provider.minecraft_version ?? null;
	const displayProviderVersion = server.stats.provider_version ?? server.provider.provider_version;
	const effectiveJavaRuntimeLabel = javaResolutionLabel(
		resolveServerJavaExecutable({
			provider: server.provider,
			javaInstallation: server.java_installation,
			globalDefault: javaInstallationDefault,
			runtimes: javaRuntimes,
		}),
	);
	const shouldShowWorldAndBackupSizes = !isProxy;
	const isBackupsNearStorageLimit = server.stats.backups_size_bytes >= Math.floor(storageLimitBytes * 0.9);

	// Recent history drives the metric sparklines; only while the server is up.
	const { points } = useServerTelemetryHistory(server.id, SPARK_WINDOW_MS, {
		maxPoints: 40,
		refreshMs: 10000,
		enabled: !isOffline,
	});
	const sparkData = React.useMemo(() => toChartData(points), [points]);

	const latestRamBytes = React.useMemo(() => {
		for (let i = sparkData.length - 1; i >= 0; i--) {
			const b = sparkData[i].ramBytes;
			if (b != null) return b;
		}
		return null;
	}, [sparkData]);

	const isRunning = server.status === 'online' || server.status === 'starting';

	return (
		<Card className='rounded-b-none'>
			<CardContent className='flex flex-col gap-6'>
				{/* Header: status + lifecycle actions */}
				<div className='flex items-center gap-x-8 gap-y-4'>
					<ServerStatus server={server} size='xl' />
					<div className='flex flex-col gap-2 flex-1 w-full'>
						<div className='flex flex-wrap gap-2 w-full'>
							{isRunning && (
								<Button onClick={onStop} disabled={isBusy}>
									<OctagonX />
									<p>Stop</p>
								</Button>
							)}
							{isRunning && (
								<Button variant='secondary' onClick={onRestart} disabled={isBusy}>
									<RefreshCcw />
									<p>Restart</p>
								</Button>
							)}
							{isOffline && (
								<Button onClick={onStart} disabled={isBusy}>
									<CircleCheck />
									<p>Serve</p>
								</Button>
							)}
							{!isOffline && (
								<Button variant='destructive-secondary' onClick={onForceKill} disabled={isBusy}>
									<OctagonX />
									<p>Force Kill</p>
								</Button>
							)}
							<OpenFolderButton directory={server.directory} disabled={isBusy} />
							{/* Connection address */}
							<div className='flex items-center gap-2 rounded-md bg-card dark:bg-secondary/50 border-2 dark:border-none px-3 py-1 text-sm'>
								<Wifi className='size-4 shrink-0 text-sky-500' />
								<p className='text-muted-foreground select-none'>Connect:</p>
								<p>
									<span className='font-mono text-sky-500'>
										{publicIp == null ? (
											<span className='blur-sm select-none text-muted-foreground'>
												Loading....
											</span>
										) : ipHidden ? (
											<span className='blur-sm select-none'>XXX.XXX.X.X</span>
										) : (
											publicIp
										)}
									</span>
									{server.telemetry_port != 25565 && (
										<span className='font-mono text-sky-500'>:{server.telemetry_port}</span>
									)}
								</p>
								<div className='flex'>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant='ghost'
												size='sm'
												className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
												onClick={() => setIpHidden((h) => !h)}>
												{ipHidden ? (
													<Eye className='size-3.5' />
												) : (
													<EyeOff className='size-3.5' />
												)}
											</Button>
										</TooltipTrigger>
										<TooltipContent>{ipHidden ? 'Show IP' : 'Hide IP'}</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant='ghost'
												size='sm'
												className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
												onClick={() =>
													copyToClipboard(
														server.telemetry_port === 25565
															? publicIp
															: publicIp + ':' + server.telemetry_port,
													)
												}>
												{copied ? (
													<ClipboardCheck className='size-3.5' />
												) : (
													<Clipboard className='size-3.5' />
												)}
											</Button>
										</TooltipTrigger>
										<TooltipContent>{copied ? 'Copied IP' : 'Copy IP'}</TooltipContent>
									</Tooltip>
								</div>
							</div>
						</div>
						{/* Live metric cards */}
						<div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
							<MetricCard
								icon={<Cpu />}
								label='CPU'
								color={METRIC_COLORS.cpu}
								value={
									isOffline || server.stats.cpu_used == null
										? null
										: formatPercent(server.stats.cpu_used)
								}
								sparkData={sparkData}
								sparkKey='cpuUsed'
								sparkDomain={[0, 100]}
							/>
							<MetricCard
								icon={<MemoryStick />}
								label='RAM'
								color={METRIC_COLORS.ram}
								value={
									isOffline || server.stats.ram_used == null ? null : user.advanced_mode &&
									  latestRamBytes != null ? (
										<>
											{formatPercent(server.stats.ram_used)}
											<div className='text-xs font-normal text-muted-foreground mt-0.5 leading-none'>
												{Math.round(latestRamBytes / 1048576)}mb / {server.ram * 1024}mb
											</div>
										</>
									) : (
										formatPercent(server.stats.ram_used)
									)
								}
								sparkData={sparkData}
								sparkKey='ramUsed'
								sparkDomain={[0, 100]}
							/>
							<MetricCard
								icon={<Users />}
								label='Players'
								color={METRIC_COLORS.players}
								value={
									server.status === 'online'
										? `${server.stats.players_online ?? 0}/${server.stats.players_max ?? 0}`
										: null
								}
								sparkData={sparkData}
								sparkKey='playersOnline'
								sparkDomain={[0, 'auto']}
							/>
							{capabilities.supportsTpsCommand && (
								<MetricCard
									icon={<Activity />}
									label='TPS'
									color={METRIC_COLORS.tps}
									value={isOffline || server.stats.tps == null ? null : server.stats.tps.toFixed(2)}
									sparkData={sparkData}
									sparkKey='tps'
									sparkDomain={[0, 20]}
								/>
							)}
							<MetricCard
								icon={<Clock />}
								label='Uptime'
								color={METRIC_COLORS.online}
								value={
									server.status === 'online' && server.stats.uptime ? (
										<UptimeText uptime={server.stats.uptime} />
									) : null
								}
							/>
						</div>
					</div>
				</div>

				{/* Static details */}
				<div className='space-y-3'>
					<h3 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
						Details
					</h3>
					<div className='grid gap-x-8 gap-y-2.5 sm:grid-cols-2'>
						{displayVersion &&
							(() => {
								const primary = getPrimaryMinecraftVersion(displayVersion);
								return (
									<DetailItem icon={<ArrowDownToLine />} label='Version'>
										{primary ? (
											<Tooltip>
												<TooltipTrigger asChild>
													<span>{primary}</span>
												</TooltipTrigger>
												<TooltipContent className='max-w-40 text-wrap text-white dark:text-black'>
													{displayVersion}
												</TooltipContent>
											</Tooltip>
										) : (
											displayVersion
										)}
									</DetailItem>
								);
							})()}
						<DetailItem icon={<Package />} label='Provider'>
							{server.provider.name}
						</DetailItem>
						{displayProviderVersion && (
							<DetailItem icon={<Boxes />} label='Detected runtime'>
								{displayProviderVersion}
							</DetailItem>
						)}
						<DetailItem icon={<Boxes />} label='Jar file'>
							{server.file}
						</DetailItem>
						{availableUpdate && (
							<DetailItem icon={<ArrowUpCircle />} label='Update'>
								<Link
									to={`/servers/${server.id}/settings#server-jar`}
									className='inline-flex items-center gap-1.5 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground hover:opacity-80'>
									<ArrowUpCircle className='size-3.5' />
									{availableUpdate.latestLabel} available
								</Link>
							</DetailItem>
						)}
						{server.ram != null && (
							<DetailItem icon={<MemoryStick />} label='Allocated RAM'>
								{server.ram}GB
							</DetailItem>
						)}
						{effectiveJavaRuntimeLabel && (
							<DetailItem icon={<Coffee />} label='Java runtime'>
								{effectiveJavaRuntimeLabel}
							</DetailItem>
						)}
						{shouldShowWorldAndBackupSizes && (
							<DetailItem icon={<Globe />} label='Worlds size'>
								{formatBytes(server.stats.worlds_size_bytes)}
							</DetailItem>
						)}
						{shouldShowWorldAndBackupSizes && (
							<DetailItem icon={<Archive />} label='Backups size'>
								{formatBytes(server.stats.backups_size_bytes)}
							</DetailItem>
						)}
						{createdDateText && (
							<DetailItem icon={<Clock />} label='Created'>
								{createdDateText}
							</DetailItem>
						)}
						{server.auto_restart && (
							<DetailItem icon={<RefreshCcw />} label='Auto-restart'>
								Enabled
							</DetailItem>
						)}
					</div>
					{shouldShowWorldAndBackupSizes && isBackupsNearStorageLimit && (
						<div className='flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400'>
							<TriangleAlert className='size-4 shrink-0' />
							<p>
								Backups are using at least <span className='font-bold'>90%</span> of the storage
								limit.
							</p>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
};

export default React.memo(ServerOverviewPanel);
