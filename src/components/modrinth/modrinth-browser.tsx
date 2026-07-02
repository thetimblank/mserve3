import React from 'react';
import { ChevronLeft, ChevronRight, CircleX, Download, Heart, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Container } from '@/components/ui/container';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
	MODRINTH_PAGE_SIZE,
	MODRINTH_SORT_OPTIONS,
	formatCompactCount,
	formatModrinthCategoryLabel,
	formatModrinthDate,
	getModrinthTags,
	searchModrinthProjects,
	type ModrinthProjectType,
	type ModrinthSearchHit,
	type ModrinthSearchResult,
	type ModrinthSortIndex,
	type ModrinthTags,
	type ModrinthVersion,
} from '@/lib/modrinth-service';
import ModrinthProjectDetail, { type ModrinthInstallTarget } from './modrinth-project-detail';
import ModrinthProjectIcon from './modrinth-project-icon';

const ANY_VERSION = '__any__';

export type ModrinthBrowserProps = {
	projectType: ModrinthProjectType;
	/** Loader facets matching the target server; shown as a compatibility pin. */
	pinnedLoaders?: string[];
	/** The target server's Minecraft version; shown as a version pin. */
	pinnedGameVersion?: string | null;
	/** File names already present in the target, to mark versions as installed. */
	installedFiles?: string[];
	installLabel?: string;
	installDisabled?: boolean;
	installDisabledReason?: string;
	onInstallVersion: (version: ModrinthVersion, project: ModrinthInstallTarget) => Promise<void>;
};

const ModrinthBrowser: React.FC<ModrinthBrowserProps> = ({
	projectType,
	pinnedLoaders = [],
	pinnedGameVersion = null,
	installedFiles = [],
	installLabel,
	installDisabled,
	installDisabledReason,
	onInstallVersion,
}) => {
	const [searchTerm, setSearchTerm] = React.useState('');
	const [debouncedSearch, setDebouncedSearch] = React.useState('');
	const [sortIndex, setSortIndex] = React.useState<ModrinthSortIndex>('relevance');
	const [offset, setOffset] = React.useState(0);
	const [activeCategories, setActiveCategories] = React.useState<string[]>([]);
	const [usePinnedLoaders, setUsePinnedLoaders] = React.useState(true);
	const [usePinnedVersion, setUsePinnedVersion] = React.useState(true);
	const [manualGameVersion, setManualGameVersion] = React.useState<string>(ANY_VERSION);

	const [tags, setTags] = React.useState<ModrinthTags | null>(null);
	const [result, setResult] = React.useState<ModrinthSearchResult | null>(null);
	const [isLoading, setIsLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [selectedHit, setSelectedHit] = React.useState<ModrinthSearchHit | null>(null);

	const hasLoaderPin = pinnedLoaders.length > 0;
	const hasVersionPin = Boolean(pinnedGameVersion);

	// Key on the loader *values*, not array identity — parents rebuild the array
	// every render, which must not re-fire the search effect.
	const pinnedLoadersKey = pinnedLoaders.join(',');
	const effectiveLoaders = React.useMemo(
		() =>
			hasLoaderPin && usePinnedLoaders ? pinnedLoadersKey.split(',').filter(Boolean) : [],
		[hasLoaderPin, usePinnedLoaders, pinnedLoadersKey],
	);
	const effectiveGameVersions = React.useMemo(() => {
		if (hasVersionPin && usePinnedVersion && pinnedGameVersion) return [pinnedGameVersion];
		if (manualGameVersion !== ANY_VERSION) return [manualGameVersion];
		return [];
	}, [hasVersionPin, usePinnedVersion, pinnedGameVersion, manualGameVersion]);

	React.useEffect(() => {
		const handle = window.setTimeout(() => {
			setDebouncedSearch(searchTerm.trim());
			setOffset(0);
		}, 300);
		return () => window.clearTimeout(handle);
	}, [searchTerm]);

	React.useEffect(() => {
		let cancelled = false;
		void getModrinthTags(projectType)
			.then((loaded) => {
				if (!cancelled) setTags(loaded);
			})
			.catch(() => {
				// Filters degrade gracefully without tags; search still works.
			});
		return () => {
			cancelled = true;
		};
	}, [projectType]);

	React.useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		setError(null);

		void searchModrinthProjects({
			projectType,
			query: debouncedSearch,
			loaders: effectiveLoaders,
			gameVersions: effectiveGameVersions,
			categories: activeCategories,
			index: sortIndex,
			offset,
			limit: MODRINTH_PAGE_SIZE,
		})
			.then((loaded) => {
				if (cancelled) return;
				setResult(loaded);
				setIsLoading(false);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(typeof err === 'string' ? err : 'Search failed. Check your connection.');
				setIsLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [
		projectType,
		debouncedSearch,
		effectiveLoaders,
		effectiveGameVersions,
		activeCategories,
		sortIndex,
		offset,
	]);

	const releaseGameVersions = React.useMemo(
		() => (tags?.gameVersions ?? []).filter((tag) => tag.versionType === 'release'),
		[tags],
	);

	const toggleCategory = (name: string, checked: boolean) => {
		setOffset(0);
		setActiveCategories((prev) =>
			checked ? [...prev, name] : prev.filter((category) => category !== name),
		);
	};

	const totalHits = result?.totalHits ?? 0;
	const pageStart = totalHits === 0 ? 0 : offset + 1;
	const pageEnd = Math.min(offset + MODRINTH_PAGE_SIZE, totalHits);

	return (
		<div className='flex gap-4 h-full min-h-0'>
			<Container className='w-1/3 min-w-60 flex flex-col gap-1 overflow-y-auto'>
				<InputGroup>
					<InputGroupInput
						placeholder={`Search ${projectType}s on Modrinth`}
						value={searchTerm}
						onChange={(event) => setSearchTerm(event.target.value)}
					/>
					<InputGroupAddon>
						<Search />
					</InputGroupAddon>
				</InputGroup>

				<p className='mt-3'>Sort by</p>
				<Select
					value={sortIndex}
					onValueChange={(value) => {
						setSortIndex(value as ModrinthSortIndex);
						setOffset(0);
					}}>
					<SelectTrigger className='w-full'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{MODRINTH_SORT_OPTIONS.map((option) => (
							<SelectItem key={option.id} value={option.id}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{(hasLoaderPin || hasVersionPin) && (
					<>
						<p className='mt-3'>Compatibility</p>
						<div className='flex flex-col gap-2'>
							{hasLoaderPin && (
								<label className='flex items-center gap-2 text-sm rounded-md bg-secondary cursor-pointer px-3 py-2'>
									<Checkbox
										checked={usePinnedLoaders}
										onCheckedChange={(next) => {
											setUsePinnedLoaders(Boolean(next));
											setOffset(0);
										}}
									/>
									Compatible with this server ({pinnedLoaders[0]})
								</label>
							)}
							{hasVersionPin && (
								<label className='flex items-center gap-2 text-sm rounded-md bg-secondary cursor-pointer px-3 py-2'>
									<Checkbox
										checked={usePinnedVersion}
										onCheckedChange={(next) => {
											setUsePinnedVersion(Boolean(next));
											setOffset(0);
										}}
									/>
									Minecraft {pinnedGameVersion}
								</label>
							)}
						</div>
					</>
				)}

				{(!hasVersionPin || !usePinnedVersion) && (
					<>
						<p className='mt-3'>Game version</p>
						<Select
							value={manualGameVersion}
							onValueChange={(value) => {
								setManualGameVersion(value);
								setOffset(0);
							}}>
							<SelectTrigger className='w-full'>
								<SelectValue placeholder='Any version' />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ANY_VERSION}>Any version</SelectItem>
								{releaseGameVersions.map((tag) => (
									<SelectItem key={tag.version} value={tag.version}>
										{tag.version}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</>
				)}

				{tags && tags.categories.length > 0 && (
					<>
						<p className='mt-3'>Categories</p>
						<div className='flex gap-2 flex-wrap'>
							{tags.categories.map((category) => {
								const checked = activeCategories.includes(category.name);
								return (
									<label
										key={category.name}
										className='flex items-center gap-2 text-sm rounded-md bg-secondary cursor-pointer px-3 py-2'>
										<Checkbox
											checked={checked}
											onCheckedChange={(next) =>
												toggleCategory(category.name, Boolean(next))
											}
										/>
										{formatModrinthCategoryLabel(category.name)}
									</label>
								);
							})}
						</div>
					</>
				)}
			</Container>

			<Container className='w-2/3 p-0 overflow-hidden flex flex-col'>
				{selectedHit ? (
					<ModrinthProjectDetail
						projectType={projectType}
						hit={selectedHit}
						loaders={effectiveLoaders}
						gameVersions={effectiveGameVersions}
						onBack={() => setSelectedHit(null)}
						installLabel={installLabel}
						installedFiles={installedFiles}
						installDisabled={installDisabled}
						installDisabledReason={installDisabledReason}
						onInstallVersion={onInstallVersion}
					/>
				) : (
					<>
						<div className='flex-1 min-h-0 overflow-y-auto'>
							{error && (
								<div className='m-4 rounded-lg border-2 border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive'>
									{error}
								</div>
							)}

							{isLoading && (
								<div className='flex items-center justify-center gap-2 py-16 text-muted-foreground'>
									<Spinner /> Searching Modrinth…
								</div>
							)}

							{!isLoading && !error && result && result.hits.length === 0 && (
								<div className='my-16 text-muted-foreground text-center flex flex-col items-center gap-4'>
									<CircleX className='size-16' />
									<p>No results for the current search and filters.</p>
								</div>
							)}

							{!isLoading &&
								result?.hits.map((hit) => (
									<button
										key={hit.projectId}
										type='button'
										onClick={() => setSelectedHit(hit)}
										className='flex w-full items-start gap-4 border-b p-4 text-left transition-colors hover:bg-secondary/50 cursor-pointer'>
										<ModrinthProjectIcon
											iconUrl={hit.iconUrl}
											title={hit.title}
											className='size-14'
										/>
										<div className='flex-1 min-w-0'>
											<div className='flex items-baseline gap-2 flex-wrap'>
												<p className='font-bold'>{hit.title}</p>
												<p className='text-xs text-muted-foreground'>
													by {hit.author}
												</p>
											</div>
											<p className='text-sm text-muted-foreground line-clamp-2 mt-0.5'>
												{hit.description}
											</p>
											<div className='flex gap-1 flex-wrap mt-1.5'>
												{hit.displayCategories.slice(0, 4).map((category) => (
													<span
														key={category}
														className='rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground'>
														{formatModrinthCategoryLabel(category)}
													</span>
												))}
											</div>
										</div>
										<div className='flex flex-col items-end gap-1 text-sm text-muted-foreground shrink-0'>
											<span className='flex items-center gap-1'>
												<Download className='size-4' />
												{formatCompactCount(hit.downloads)}
											</span>
											<span className='flex items-center gap-1'>
												<Heart className='size-4' />
												{formatCompactCount(hit.follows)}
											</span>
											<span className='text-xs'>
												{formatModrinthDate(hit.dateModified)}
											</span>
										</div>
									</button>
								))}
						</div>

						<div className='flex items-center justify-between border-t-2 px-4 py-2 text-sm text-muted-foreground'>
							<span>
								{totalHits > 0
									? `${pageStart}–${pageEnd} of ${formatCompactCount(totalHits)}`
									: 'No results'}
							</span>
							<div className='flex items-center gap-2'>
								<Button
									variant='secondary'
									size='sm'
									disabled={offset === 0 || isLoading}
									onClick={() => setOffset(Math.max(0, offset - MODRINTH_PAGE_SIZE))}>
									<ChevronLeft />
									Previous
								</Button>
								<Button
									variant='secondary'
									size='sm'
									disabled={pageEnd >= totalHits || isLoading}
									onClick={() => setOffset(offset + MODRINTH_PAGE_SIZE)}>
									Next
									<ChevronRight />
								</Button>
							</div>
						</div>
					</>
				)}
			</Container>
		</div>
	);
};

export default ModrinthBrowser;
