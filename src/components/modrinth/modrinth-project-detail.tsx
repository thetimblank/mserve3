import React from 'react';
import {
	ArrowLeft,
	ArrowUpRightFromSquare,
	Check,
	CircleX,
	Download,
	Heart,
	Loader2,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
	formatCompactCount,
	formatModrinthCategoryLabel,
	formatModrinthDate,
	formatModrinthFileSize,
	getModrinthProject,
	getModrinthProjectPageUrl,
	listModrinthProjectVersions,
	type ModrinthProjectDetails,
	type ModrinthProjectType,
	type ModrinthSearchHit,
	type ModrinthVersion,
	type ModrinthVersionChannel,
} from '@/lib/modrinth-service';
import ModrinthProjectIcon from './modrinth-project-icon';

export type ModrinthInstallTarget = {
	projectId: string;
	slug: string;
	title: string;
	pageUrl: string;
};

type ModrinthProjectDetailProps = {
	projectType: ModrinthProjectType;
	hit: ModrinthSearchHit;
	loaders: string[];
	gameVersions: string[];
	onBack: () => void;
	installLabel?: string;
	installedFiles?: string[];
	installDisabled?: boolean;
	installDisabledReason?: string;
	onInstallVersion: (version: ModrinthVersion, project: ModrinthInstallTarget) => Promise<void>;
};

/** Reduces Modrinth's markdown body to a readable plain-text preview. */
const stripMarkdown = (body: string): string =>
	body
		.replace(/<[^>]+>/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/[*_`~]/g, '')
		.replace(/^\s*[-+]\s+/gm, '• ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

const condenseList = (values: string[], max = 3): string => {
	if (values.length <= max) return values.join(', ');
	return `${values.slice(0, max).join(', ')} +${values.length - max}`;
};

const CHANNEL_LABELS: Record<ModrinthVersionChannel, string> = {
	release: 'Release',
	beta: 'Beta',
	alpha: 'Alpha',
};

const channelBadgeClass: Record<ModrinthVersionChannel, string> = {
	release: 'bg-green-600/10 dark:bg-green-900/50 text-green-500',
	beta: 'bg-amber-500/20 text-amber-400',
	alpha: 'bg-destructive/15 text-destructive',
};

const ModrinthProjectDetail: React.FC<ModrinthProjectDetailProps> = ({
	projectType,
	hit,
	loaders,
	gameVersions,
	onBack,
	installLabel = 'Install',
	installedFiles = [],
	installDisabled = false,
	installDisabledReason,
	onInstallVersion,
}) => {
	const [details, setDetails] = React.useState<ModrinthProjectDetails | null>(null);
	const [versions, setVersions] = React.useState<ModrinthVersion[] | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [busyVersionId, setBusyVersionId] = React.useState<string | null>(null);
	const [includeUnstable, setIncludeUnstable] = React.useState(false);

	const pageUrl = getModrinthProjectPageUrl(projectType, hit.slug);

	React.useEffect(() => {
		let cancelled = false;
		setDetails(null);
		setVersions(null);
		setError(null);

		void (async () => {
			try {
				const [project, projectVersions] = await Promise.all([
					getModrinthProject(hit.projectId),
					listModrinthProjectVersions(hit.projectId, { loaders, gameVersions }),
				]);
				if (cancelled) return;
				setDetails(project);
				setVersions(projectVersions);
			} catch (err) {
				if (cancelled) return;
				setError(typeof err === 'string' ? err : 'Failed to load project details.');
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [hit.projectId, loaders, gameVersions]);

	const visibleVersions = React.useMemo(() => {
		if (!versions) return [];
		if (includeUnstable) return versions;
		const releases = versions.filter((version) => version.versionType === 'release');
		// If a project only publishes beta/alpha builds, hiding them would show
		// nothing at all — fall back to the full list.
		return releases.length > 0 ? releases : versions;
	}, [versions, includeUnstable]);

	const installedFileSet = React.useMemo(
		() => new Set(installedFiles.map((file) => file.toLowerCase())),
		[installedFiles],
	);

	const handleInstall = async (version: ModrinthVersion) => {
		if (busyVersionId) return;
		setBusyVersionId(version.versionId);
		try {
			await onInstallVersion(version, {
				projectId: hit.projectId,
				slug: hit.slug,
				title: hit.title,
				pageUrl,
			});
		} finally {
			setBusyVersionId(null);
		}
	};

	const bodyPreview = React.useMemo(
		() => (details?.body ? stripMarkdown(details.body) : ''),
		[details?.body],
	);

	return (
		<div className='flex flex-col h-full min-h-0'>
			<div className='flex items-start gap-4 border-b-2 p-4'>
				<Button variant='ghost' size='icon' onClick={onBack} aria-label='Back to results'>
					<ArrowLeft />
				</Button>
				<ModrinthProjectIcon iconUrl={hit.iconUrl} title={hit.title} className='size-16' />
				<div className='flex-1 min-w-0'>
					<div className='flex items-center gap-3 flex-wrap'>
						<p className='text-xl font-bold'>{hit.title}</p>
						<p className='text-muted-foreground text-sm'>by {hit.author}</p>
					</div>
					<p className='text-sm text-muted-foreground mt-1'>{hit.description}</p>
					<div className='flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap'>
						<span className='flex items-center gap-1'>
							<Download className='size-4' />
							{formatCompactCount(details?.downloads ?? hit.downloads)}
						</span>
						<span className='flex items-center gap-1'>
							<Heart className='size-4' />
							{formatCompactCount(details?.followers ?? hit.follows)}
						</span>
						{details && <span>Updated {formatModrinthDate(details.updated)}</span>}
						<span className='flex gap-1 flex-wrap'>
							{(details?.categories ?? hit.displayCategories).slice(0, 5).map((category) => (
								<span
									key={category}
									className='rounded-md bg-secondary px-2 py-0.5 text-xs'>
									{formatModrinthCategoryLabel(category)}
								</span>
							))}
						</span>
					</div>
				</div>
				<Button variant='link' onClick={() => openUrl(pageUrl)}>
					View on Modrinth
					<ArrowUpRightFromSquare />
				</Button>
			</div>

			<div className='flex-1 min-h-0 overflow-y-auto'>
				{error && (
					<div className='m-4 rounded-lg border-2 border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive'>
						{error}
					</div>
				)}

				{!error && !details && (
					<div className='flex items-center justify-center gap-2 py-16 text-muted-foreground'>
						<Spinner /> Loading project…
					</div>
				)}

				{bodyPreview && (
					<div className='p-4 border-b-2'>
						<p className='text-sm whitespace-pre-wrap text-muted-foreground line-clamp-[12]'>
							{bodyPreview}
						</p>
					</div>
				)}

				{details && (
					<div className='p-4 flex flex-col gap-3'>
						<div className='flex items-center justify-between gap-4 flex-wrap'>
							<p className='font-bold'>
								Versions
								{gameVersions.length > 0 && (
									<span className='ml-2 text-sm text-muted-foreground font-normal'>
										for Minecraft {condenseList(gameVersions)}
									</span>
								)}
							</p>
							<label className='flex items-center gap-2 text-sm rounded-md bg-secondary cursor-pointer px-3 py-2'>
								<Checkbox
									checked={includeUnstable}
									onCheckedChange={(next) => setIncludeUnstable(Boolean(next))}
								/>
								Show beta & alpha
							</label>
						</div>

						{installDisabled && installDisabledReason && (
							<p className='text-sm text-amber-400'>{installDisabledReason}</p>
						)}

						{versions && visibleVersions.length === 0 && (
							<div className='my-10 text-muted-foreground text-center flex flex-col items-center gap-4'>
								<CircleX className='size-14' />
								<p>No matching versions for the current filters.</p>
							</div>
						)}

						<div className='rounded-md border-2 overflow-hidden'>
							{visibleVersions.length > 0 && (
								<table className='w-full text-sm'>
									<thead className='bg-secondary/50'>
										<tr>
											<th className='text-left px-3 py-2'>Version</th>
											<th className='text-left px-3 py-2'>Game versions</th>
											<th className='text-left px-3 py-2'>Channel</th>
											<th className='text-left px-3 py-2'>Published</th>
											<th className='text-left px-3 py-2'>Size</th>
											<th className='px-3 py-2' />
										</tr>
									</thead>
									<tbody>
										{visibleVersions.map((version) => {
											const isBusy = busyVersionId === version.versionId;
											const isInstalled = installedFileSet.has(
												version.fileName.toLowerCase(),
											);
											return (
												<tr key={version.versionId} className='border-t'>
													<td className='px-3 py-2'>
														<p className='font-medium'>{version.versionNumber}</p>
														<p className='text-xs text-muted-foreground'>
															{condenseList(version.loaders)}
														</p>
													</td>
													<td className='px-3 py-2'>
														<Tooltip>
															<TooltipTrigger asChild>
																<span>{condenseList(version.gameVersions)}</span>
															</TooltipTrigger>
															<TooltipContent className='max-w-72'>
																{version.gameVersions.join(', ')}
															</TooltipContent>
														</Tooltip>
													</td>
													<td className='px-3 py-2'>
														<span
															className={[
																'inline-flex rounded-md px-2 py-0.5 text-xs',
																channelBadgeClass[version.versionType] ??
																	channelBadgeClass.release,
															].join(' ')}>
															{CHANNEL_LABELS[version.versionType] ??
																version.versionType}
														</span>
													</td>
													<td className='px-3 py-2'>
														{formatModrinthDate(version.datePublished)}
													</td>
													<td className='px-3 py-2'>
														{formatModrinthFileSize(version.fileSizeBytes)}
													</td>
													<td className='px-3 py-2 text-right'>
														{isInstalled ? (
															<span className='inline-flex items-center gap-1 text-green-500 text-xs font-bold pr-2'>
																<Check className='size-4' />
																Installed
															</span>
														) : (
															<Button
																size='sm'
																disabled={installDisabled || Boolean(busyVersionId)}
																onClick={() => void handleInstall(version)}>
																{isBusy ? (
																	<Loader2 className='animate-spin' />
																) : (
																	<Download />
																)}
																{installLabel}
															</Button>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							)}
							{!versions && !error && (
								<div className='flex items-center justify-center gap-2 py-8 text-muted-foreground'>
									<Spinner /> Loading versions…
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

export default ModrinthProjectDetail;
