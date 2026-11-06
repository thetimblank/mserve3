import React from 'react';
import { ChevronLeft, ChevronRight, Download, Heart } from 'lucide-react';
import EmptyState from '@/components/empty-state';
import { FilterBar, type FilterBarFilter } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
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
import { getErrorMessage } from '@/lib/utils';

/**
 * Which server pins narrow the search: both (the default, so results install on
 * the target server), only its loader, only its Minecraft version, or none.
 */
type CompatibilityScope = 'server' | 'loader' | 'version' | 'none';

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
	const [compatibility, setCompatibility] = React.useState<CompatibilityScope>('server');
	// null = any version (only used while the version pin is off).
	const [manualGameVersion, setManualGameVersion] = React.useState<string | null>(null);

	const [tags, setTags] = React.useState<ModrinthTags | null>(null);
	const [result, setResult] = React.useState<ModrinthSearchResult | null>(null);
	const [isLoading, setIsLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [selectedHit, setSelectedHit] = React.useState<ModrinthSearchHit | null>(null);

	const hasLoaderPin = pinnedLoaders.length > 0;
	const hasVersionPin = Boolean(pinnedGameVersion);
	const usePinnedLoaders = compatibility === 'server' || compatibility === 'loader';
	const usePinnedVersion = compatibility === 'server' || compatibility === 'version';
	// The manual game version only applies (and its chip only shows) without a version pin.
	const isVersionPinned = hasVersionPin && usePinnedVersion;

	// Pins (server loader / version) are not cleared here: they keep results
	// installable on this server, so only user-picked filters count.
	const hasClearableSearch =
		searchTerm.trim() !== '' ||
		activeCategories.length > 0 ||
		(!isVersionPinned && manualGameVersion !== null);
	const handleClearSearch = () => {
		setSearchTerm('');
		setActiveCategories([]);
		setManualGameVersion(null);
		setOffset(0);
	};

	// Key on the loader *values*, not array identity — parents rebuild the array
	// every render, which must not re-fire the search effect.
	const pinnedLoadersKey = pinnedLoaders.join(',');
	const effectiveLoaders = React.useMemo(
		() =>
			hasLoaderPin && usePinnedLoaders ? pinnedLoadersKey.split(',').filter(Boolean) : [],
		[hasLoaderPin, usePinnedLoaders, pinnedLoadersKey],
	);
	const effectiveGameVersions = React.useMemo(() => {
		if (isVersionPinned && pinnedGameVersion) return [pinnedGameVersion];
		if (manualGameVersion !== null) return [manualGameVersion];
		return [];
	}, [isVersionPinned, pinnedGameVersion, manualGameVersion]);

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
				setError(getErrorMessage(err, 'Search failed. Check your connection.'));
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

	const filters: FilterBarFilter[] = [];
	if (hasLoaderPin || hasVersionPin) {
		const loaderLabel = hasLoaderPin ? formatModrinthCategoryLabel(pinnedLoaders[0]) : '';
		const versionLabel = `Minecraft ${pinnedGameVersion}`;
		const options: { value: CompatibilityScope; label: string }[] =
			hasLoaderPin && hasVersionPin
				? [
						{ value: 'server', label: `This server (${loaderLabel}, ${versionLabel})` },
						{ value: 'loader', label: `${loaderLabel}, any version` },
						{ value: 'version', label: `${versionLabel}, any loader` },
					]
				: [{ value: 'server', label: `This server (${hasLoaderPin ? loaderLabel : versionLabel})` }];
		options.push({ value: 'none', label: 'Show everything' });
		filters.push({
			id: 'compatibility',
			label: 'Compatibility',
			type: 'single',
			options,
			value: compatibility,
			defaultValue: 'server',
			onValueChange: (next: CompatibilityScope | null) => {
				setCompatibility(next ?? 'server');
				setOffset(0);
			},
		});
	}
	if (!isVersionPinned) {
		filters.push({
			id: 'game-version',
			label: 'Game version',
			type: 'single',
			options: releaseGameVersions.map((tag) => ({ value: tag.version, label: tag.version })),
			value: manualGameVersion,
			// Options come from Modrinth's tags; nothing to pick until they load.
			disabled: releaseGameVersions.length === 0,
			onValueChange: (next) => {
				setManualGameVersion(next);
				setOffset(0);
			},
		});
	}
	if (tags && tags.categories.length > 0) {
		filters.push({
			id: 'categories',
			label: 'Categories',
			type: 'multi',
			options: tags.categories.map((category) => ({
				value: category.name,
				label: formatModrinthCategoryLabel(category.name),
			})),
			value: activeCategories,
			onValueChange: (next) => {
				setActiveCategories(next);
				setOffset(0);
			},
		});
	}

	const totalHits = result?.totalHits ?? 0;
	const pageStart = totalHits === 0 ? 0 : offset + 1;
	const pageEnd = Math.min(offset + MODRINTH_PAGE_SIZE, totalHits);

	return (
		<div className='flex flex-col gap-3 h-full min-h-0'>
			<FilterBar
				search={{
					value: searchTerm,
					onValueChange: setSearchTerm,
					placeholder: `Search ${projectType}s on Modrinth`,
				}}
				filters={filters}
				sort={{
					options: MODRINTH_SORT_OPTIONS.map((option) => ({ value: option.id, label: option.label })),
					value: sortIndex,
					onValueChange: (next: ModrinthSortIndex) => {
						setSortIndex(next);
						setOffset(0);
					},
				}}
			/>

			<Container className='flex-1 min-h-0 w-full p-0 overflow-hidden flex flex-col'>
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
								<EmptyState
									variant='no-results'
									className='my-16'
									title='No results'
									description='Nothing on Modrinth matches the current search and filters.'
									onClearSearch={hasClearableSearch ? handleClearSearch : undefined}
									clearSearchLabel={searchTerm.trim() ? 'Clear search' : 'Clear filters'}
								/>
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
