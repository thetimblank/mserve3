import * as React from 'react';
import { Check, CircleCheck, CircleHelp, Loader2, Search, X } from 'lucide-react';
import {
	filterJarRows,
	formatStabilityLabel,
	getJarFiltersForTab,
	isJarRowDownloadable,
	type JarProviderFilterId,
	type JarStabilityFilterId,
	type JarTab,
	type JarVersionRow,
} from '@/lib/jar-download-service';
import {
	chooseBestInstalledJava,
	evaluateJavaCompatibilityStatus,
	resolveJavaRequirement,
} from '@/lib/java-compatibility';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Container } from '@/components/ui/container';

type JarVersionSelectorPaneProps = {
	tab: JarTab;
	rows: JarVersionRow[];
	installedMajors?: number[];
	isCheckingJavaCompatibility?: boolean;
	selectedRowId: string | null;
	onSelectRow: (row: JarVersionRow | null) => void;
};

const JarVersionSelectorPane: React.FC<JarVersionSelectorPaneProps> = ({
	tab,
	rows,
	installedMajors = [],
	isCheckingJavaCompatibility = false,
	selectedRowId,
	onSelectRow,
}) => {
	const { providers, stabilities } = React.useMemo(() => getJarFiltersForTab(tab), [tab]);
	const [searchTerm, setSearchTerm] = React.useState('');
	const [activeProviderFilterIds, setActiveProviderFilterIds] = React.useState<JarProviderFilterId[]>(
		providers.map((filter) => filter.id),
	);
	const [activeStabilityFilterIds, setActiveStabilityFilterIds] = React.useState<JarStabilityFilterId[]>(
		stabilities.map((filter) => filter.id),
	);
	const [showCompatible, setShowCompatible] = React.useState(true);
	const [showIncompatible, setShowIncompatible] = React.useState(false);

	React.useEffect(() => {
		setSearchTerm('');
		setActiveProviderFilterIds(providers.map((filter) => filter.id));
		setActiveStabilityFilterIds(stabilities.map((filter) => filter.id));
		setShowCompatible(true);
		setShowIncompatible(false);
		onSelectRow(null);
	}, [providers, stabilities, onSelectRow]);

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

	const visibleRows = React.useMemo(() => {
		const preFiltered = filterJarRows(rows, searchTerm, activeProviderFilterIds, activeStabilityFilterIds);
		if (isCheckingJavaCompatibility || installedMajors.length === 0) {
			return preFiltered;
		}

		return preFiltered.filter((row) => {
			const compatibility = rowCompatibilityById.get(row.id);
			if (!compatibility) return false;
			if (compatibility.compatible && showCompatible) return true;
			if (!compatibility.compatible && showIncompatible) return true;
			return false;
		});
	}, [
		activeProviderFilterIds,
		activeStabilityFilterIds,
		isCheckingJavaCompatibility,
		installedMajors.length,
		rowCompatibilityById,
		rows,
		searchTerm,
		showCompatible,
		showIncompatible,
	]);

	React.useEffect(() => {
		if (!selectedRowId) return;
		const selectedStillVisible = visibleRows.some((row) => row.id === selectedRowId);
		if (!selectedStillVisible) {
			onSelectRow(null);
		}
	}, [onSelectRow, selectedRowId, visibleRows]);

	const toggleProviderFilter = (filterId: JarProviderFilterId, checked: boolean) => {
		setActiveProviderFilterIds((prev) => {
			if (checked) {
				if (prev.includes(filterId)) return prev;
				return [...prev, filterId];
			}

			if (prev.length === 1) {
				return prev;
			}

			return prev.filter((id) => id !== filterId);
		});
	};

	const toggleStabilityFilter = (filterId: JarStabilityFilterId, checked: boolean) => {
		setActiveStabilityFilterIds((prev) => {
			if (checked) {
				if (prev.includes(filterId)) return prev;
				return [...prev, filterId];
			}

			if (prev.length === 1) {
				return prev;
			}

			return prev.filter((id) => id !== filterId);
		});
	};

	return (
		<div className='flex gap-4'>
			<Container className='w-1/3 min-w-60 flex flex-col gap-1'>
				<InputGroup>
					<InputGroupInput
						placeholder='Search provider, version, or channel'
						value={searchTerm}
						onChange={(event) => setSearchTerm(event.target.value)}
					/>
					<InputGroupAddon>
						<Search />
					</InputGroupAddon>
				</InputGroup>

				<p className='mt-3'>Java compatibility</p>
				<div className='flex gap-2 flex-wrap'>
					<label className='flex items-center gap-2 text-sm rounded-md bg-secondary cursor-pointer px-3 py-2'>
						<Checkbox
							checked={showCompatible}
							onCheckedChange={(next) => setShowCompatible(Boolean(next))}
						/>
						Compatible JDK
					</label>
					<label className='flex items-center gap-2 text-sm rounded-md bg-secondary cursor-pointer px-3 py-2'>
						<Checkbox
							checked={showIncompatible}
							onCheckedChange={(next) => setShowIncompatible(Boolean(next))}
						/>
						Incompatible JDK
					</label>
				</div>
				{!isCheckingJavaCompatibility && installedMajors.length === 0 && (
					<p className='mt-2 text-xs text-muted-foreground'>
						No local Java runtimes detected yet. Compatibility tags are still shown by requirement.
					</p>
				)}

				<p className='mt-3'>Provider</p>
				<div className='flex gap-2 flex-wrap'>
					{providers.map((filter) => {
						const checked = activeProviderFilterIds.includes(filter.id);
						return (
							<label
								key={filter.id}
								className='flex items-center justify-between rounded-md bg-secondary cursor-pointer px-3 py-2 gap-2'>
								<div className='flex items-center gap-2 text-sm'>
									<Checkbox
										checked={checked}
										onCheckedChange={(next) => toggleProviderFilter(filter.id, Boolean(next))}
									/>
									<span>{filter.label}</span>
								</div>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type='button'
											aria-label={`About ${filter.label}`}
											className='text-muted-foreground hover:text-foreground'>
											<CircleHelp className='size-4' />
										</button>
									</TooltipTrigger>
									<TooltipContent sideOffset={8}>{filter.description}</TooltipContent>
								</Tooltip>
							</label>
						);
					})}
				</div>
				<p className='mt-3'>Stability</p>
				<div className='flex gap-2 flex-wrap'>
					{stabilities.map((filter) => {
						const checked = activeStabilityFilterIds.includes(filter.id);
						return (
							<label
								key={filter.id}
								className='flex items-center justify-between rounded-md bg-secondary cursor-pointer px-3 py-2 gap-2'>
								<div className='flex items-center gap-2 text-sm'>
									<Checkbox
										checked={checked}
										onCheckedChange={(next) => toggleStabilityFilter(filter.id, Boolean(next))}
									/>
									<span>{filter.label}</span>
								</div>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type='button'
											aria-label={`About ${filter.label}`}
											className='text-muted-foreground hover:text-foreground'>
											<CircleHelp className='size-4' />
										</button>
									</TooltipTrigger>
									<TooltipContent sideOffset={8}>{filter.description}</TooltipContent>
								</Tooltip>
							</label>
						);
					})}
				</div>
			</Container>

			<Container className='w-2/3 p-0 overflow-hidden'>
				<table className='w-full text-sm'>
					<thead className='bg-secondary/50'>
						<tr>
							<th className='text-left px-3 py-2'>Provider</th>
							<th className='text-left px-3 py-2'>Version</th>
							<th className='text-left px-3 py-2'>Stability</th>
							<th className='text-left px-3 py-2'>Compatibility</th>
						</tr>
					</thead>
					<tbody>
						{visibleRows.map((row) => {
							const disabled = !isJarRowDownloadable(row);
							const selected = selectedRowId === row.id;
							const compatibility = rowCompatibilityById.get(row.id);
							const isCompatible = compatibility?.compatible ?? false;
							const compatibilityLabel = `${isCompatible ? 'Compatible' : 'Incompatible'} JDK v${
								compatibility?.displayMajor ?? 0
							}`;

							return (
								<tr
									key={row.id}
									onClick={() => {
										if (disabled) return;
										onSelectRow(row);
									}}
									className={[
										'border-t transition-colors',
										disabled ? 'opacity-55' : '',
										selected
											? 'bg-accent text-accent-foreground'
											: 'cursor-pointer hover:bg-secondary/50',
									]
										.filter(Boolean)
										.join(' ')}>
									<td className='px-3 py-2'>
										<div className='flex items-center gap-2'>
											{selected && <CircleCheck className='size-4' />}
											<span>{row.provider}</span>
										</div>
									</td>
									<td className='px-3 py-2'>{row.version}</td>
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
										{disabled && (
											<span className='text-xs text-muted-foreground'>Unavailable right now</span>
										)}
									</td>
								</tr>
							);
						})}
						{visibleRows.length === 0 && (
							<tr>
								<td className='px-3 py-5 text-muted-foreground text-center' colSpan={2}>
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
