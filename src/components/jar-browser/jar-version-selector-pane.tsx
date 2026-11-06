import * as React from 'react';
import { Check, CircleCheck, Loader2, X } from 'lucide-react';
import {
	filterJarRows,
	formatStabilityLabel,
	getJarFiltersForTab,
	resolveLatestJarRowIds,
	UNSTABLE_STABILITY_IDS,
	type JarProviderFilterId,
	type JarTab,
	type JarVersionRow,
} from '@/lib/jar-download-service';
import {
	chooseBestInstalledJava,
	evaluateJavaCompatibilityStatus,
	resolveJavaRequirement,
} from '@/lib/java-compatibility';
import type { ProviderName } from '@/lib/mserve-schema';
import { FilterBar, type FilterBarFilter } from '@/components/filter-bar';
import { Container } from '@/components/ui/container';

type JavaCompatibilityFilter = 'compatible' | 'any';

const JAVA_FILTER_OPTIONS = [
	{ value: 'compatible', label: 'Compatible only' },
	{ value: 'any', label: 'Any Java' },
] as const;

/** Which release channels are listed: the stable one, both, or only the unstable one. */
type StabilityScope = 'stable' | 'all' | 'unstable';

type JarVersionSelectorPaneProps = {
	tab: JarTab;
	/** Only this provider's versions are listed (no Provider filter or column). */
	provider?: ProviderName;
	rows: JarVersionRow[];
	installedMajors?: number[];
	isCheckingJavaCompatibility?: boolean;
	/** Rows are (re)loading; the filters stay as they are. */
	isLoading?: boolean;
	selectedRowId: string | null;
	onSelectRow: (row: JarVersionRow | null) => void;
	onRequestUnstableVersions?: () => void;
};

/**
 * Version table with a `FilterBar` on top. Stability and Java default to the safe
 * pick (stable builds, compatible with an installed runtime) and reset back to it.
 * Provider (only when the tab has several) starts empty, which means every provider.
 */
const JarVersionSelectorPane: React.FC<JarVersionSelectorPaneProps> = ({
	tab,
	provider,
	rows,
	installedMajors = [],
	isCheckingJavaCompatibility = false,
	isLoading = false,
	selectedRowId,
	onSelectRow,
	onRequestUnstableVersions,
}) => {
	const { providers, stabilities } = React.useMemo(() => {
		const filters = getJarFiltersForTab(tab);
		return provider
			? { ...filters, providers: filters.providers.filter((filter) => filter.id === provider) }
			: filters;
	}, [provider, tab]);
	const showProviders = providers.length > 1;
	const columnCount = showProviders ? 4 : 3;
	const latestRowIds = React.useMemo(() => resolveLatestJarRowIds(rows), [rows]);
	const unstableStabilityId = UNSTABLE_STABILITY_IDS[tab];
	const stableStability = stabilities.find((filter) => filter.id !== unstableStabilityId) ?? stabilities[0];
	const unstableLabel =
		stabilities.find((filter) => filter.id === unstableStabilityId)?.label ?? unstableStabilityId;
	const [searchTerm, setSearchTerm] = React.useState('');
	// Empty = every provider of the tab.
	const [providerFilter, setProviderFilter] = React.useState<JarProviderFilterId[]>([]);
	// Unstable channels (snapshots / preview builds) are hidden by default.
	const [stabilityScope, setStabilityScope] = React.useState<StabilityScope>('stable');
	const [javaFilter, setJavaFilter] = React.useState<JavaCompatibilityFilter>('compatible');

	React.useEffect(() => {
		setSearchTerm('');
		setProviderFilter([]);
		setStabilityScope('stable');
		setJavaFilter('compatible');
		onSelectRow(null);
	}, [providers, onSelectRow]);

	const rowCompatibilityById = React.useMemo(() => {
		const map = new Map<
			string,
			{
				compatible: boolean;
				displayMajor: number;
			}
		>();

		for (const row of rows) {
			const requirement = resolveJavaRequirement(row.providerId, row.version);
			const status = evaluateJavaCompatibilityStatus(installedMajors, requirement);
			const compatible = status === 'compatible';
			const bestInstalled = chooseBestInstalledJava(installedMajors, requirement);
			map.set(row.id, {
				compatible,
				displayMajor: compatible ? (bestInstalled ?? requirement.minimumMajor) : requirement.minimumMajor,
			});
		}

		return map;
	}, [installedMajors, rows]);

	// Without a detected runtime every row would be "incompatible", so the Java
	// filter is hidden and the requirement tags are shown as-is.
	const canFilterByJava = !isCheckingJavaCompatibility && installedMajors.length > 0;

	const visibleRows = React.useMemo(() => {
		const preFiltered = filterJarRows(
			rows,
			searchTerm,
			providerFilter.length > 0 ? providerFilter : providers.map((filter) => filter.id),
			stabilityScope === 'stable'
				? [stableStability.id]
				: stabilityScope === 'unstable'
					? [unstableStabilityId]
					: stabilities.map((filter) => filter.id),
		);
		if (!canFilterByJava || javaFilter === 'any') {
			return preFiltered;
		}

		return preFiltered.filter((row) => rowCompatibilityById.get(row.id)?.compatible === true);
	}, [
		canFilterByJava,
		javaFilter,
		providerFilter,
		providers,
		rowCompatibilityById,
		rows,
		searchTerm,
		stabilities,
		stabilityScope,
		stableStability.id,
		unstableStabilityId,
	]);

	React.useEffect(() => {
		if (!selectedRowId) return;
		const selectedStillVisible = visibleRows.some((row) => row.id === selectedRowId);
		if (!selectedStillVisible) {
			onSelectRow(null);
		}
	}, [onSelectRow, selectedRowId, visibleRows]);

	const handleStabilityChange = (next: StabilityScope | null) => {
		const scope = next ?? 'stable';
		if (scope !== 'stable') {
			// Showing an unstable channel may require loading the larger unstable
			// version set from the backend.
			onRequestUnstableVersions?.();
		}
		setStabilityScope(scope);
	};

	const filters: FilterBarFilter[] = [];
	if (showProviders) {
		filters.push({
			id: 'provider',
			label: 'Provider',
			type: 'multi',
			options: providers.map((filter) => ({ value: filter.id, label: filter.label })),
			value: providerFilter,
			onValueChange: (next: JarProviderFilterId[]) => setProviderFilter(next),
		});
	}
	filters.push({
		id: 'stability',
		label: 'Stability',
		type: 'single',
		options: [
			{ value: 'stable', label: `${stableStability.label} only` },
			{ value: 'all', label: `${stableStability.label} and ${unstableLabel}` },
			{ value: 'unstable', label: `${unstableLabel} only` },
		],
		value: stabilityScope,
		defaultValue: 'stable',
		onValueChange: handleStabilityChange,
	});
	if (canFilterByJava) {
		filters.push({
			id: 'java',
			label: 'Java',
			type: 'single',
			options: JAVA_FILTER_OPTIONS,
			value: javaFilter,
			defaultValue: 'compatible',
			onValueChange: (next: JavaCompatibilityFilter | null) => setJavaFilter(next ?? 'compatible'),
		});
	}

	return (
		<div className='flex flex-col gap-3'>
			<FilterBar
				search={{
					value: searchTerm,
					onValueChange: setSearchTerm,
					placeholder: showProviders ? 'Search provider, version, or channel' : 'Search versions',
				}}
				filters={filters}
			/>
			{!isCheckingJavaCompatibility && installedMajors.length === 0 && (
				<p className='text-xs text-muted-foreground'>
					No Java runtimes detected yet, so every version is marked incompatible. The Java column
					shows which Java each one needs.
				</p>
			)}

			<Container className='w-full p-0 max-h-[55vh] overflow-y-auto app-scroll-area'>
				<table className='w-full text-sm'>
					<thead className='sticky top-0 z-10 bg-secondary'>
						<tr>
							{showProviders && <th className='text-left px-3 py-2'>Provider</th>}
							<th className='text-left px-3 py-2'>Version</th>
							<th className='text-left px-3 py-2'>Stability</th>
							<th className='text-left px-3 py-2'>Java</th>
						</tr>
					</thead>
					<tbody>
						{isLoading && (
							<tr>
								<td className='px-3 py-5 text-muted-foreground' colSpan={columnCount}>
									<span className='flex items-center justify-center gap-2'>
										<Loader2 className='size-4 animate-spin' />
										Loading versions...
									</span>
								</td>
							</tr>
						)}
						{!isLoading && visibleRows.map((row) => {
							const selected = selectedRowId === row.id;
							const compatibility = rowCompatibilityById.get(row.id);
							const isCompatible = compatibility?.compatible ?? false;
							const compatibilityLabel = `${isCompatible ? 'Compatible' : 'Incompatible'} JDK v${
								compatibility?.displayMajor ?? 0
							}`;

							return (
								<tr
									key={row.id}
									onClick={() => onSelectRow(row)}
									className={[
										'border-t transition-colors',
										selected
											? 'bg-accent text-accent-foreground'
											: 'cursor-pointer hover:bg-secondary/50',
									]
										.filter(Boolean)
										.join(' ')}>
									{showProviders && (
										<td className='px-3 py-2'>
											<div className='flex items-center gap-2'>
												{selected && <CircleCheck className='size-4' />}
												<span>{row.provider}</span>
											</div>
										</td>
									)}
									<td className='px-3 py-2'>
										<div className='flex items-center gap-2'>
											{selected && !showProviders && <CircleCheck className='size-4' />}
											<span>{row.version}</span>
											{latestRowIds.has(row.id) && (
												<span
													className={[
														'rounded-md px-2 py-0.5 text-xs font-semibold',
														selected
															? 'bg-accent-foreground/15'
															: 'bg-accent/15 text-accent',
													].join(' ')}>
													Latest
												</span>
											)}
										</div>
									</td>
									<td className='px-3 py-2'>{formatStabilityLabel(row.stability)}</td>
									<td className='px-3 py-2'>
										{isCheckingJavaCompatibility ? (
											<span className='mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400'>
												<Loader2 className='size-3 animate-spin' />
												Checking
											</span>
										) : (
											compatibility && (
												<span
													className={[
														'mt-1 inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-xs',
														isCompatible
															? 'bg-green-600/10 dark:bg-green-900/50 text-green-500'
															: 'bg-destructive/15 text-destructive',
													].join(' ')}>
													{isCompatible ? (
														<Check className='size-3' />
													) : (
														<X className='size-3' />
													)}
													{compatibilityLabel}
												</span>
											)
										)}
									</td>
								</tr>
							);
						})}
						{!isLoading && visibleRows.length === 0 && (
							<tr>
								<td className='px-3 py-5 text-muted-foreground text-center' colSpan={columnCount}>
									No versions found for the current search and filter selection.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</Container>
		</div>
	);
};

export default JarVersionSelectorPane;
