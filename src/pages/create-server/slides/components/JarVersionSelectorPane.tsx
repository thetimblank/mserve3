import * as React from 'react';
import { CircleCheck, CircleHelp, Search } from 'lucide-react';
import {
	filterJarRows,
	formatStabilityLabel,
	getJarFiltersForTab,
	isJarRowDownloadable,
	type JarFilterId,
	type JarTab,
	type JarVersionRow,
} from '@/lib/jar-download-service';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

type JarVersionSelectorPaneProps = {
	tab: JarTab;
	rows: JarVersionRow[];
	selectedRowId: string | null;
	onSelectRow: (row: JarVersionRow | null) => void;
};

const JarVersionSelectorPane: React.FC<JarVersionSelectorPaneProps> = ({
	tab,
	rows,
	selectedRowId,
	onSelectRow,
}) => {
	const filters = React.useMemo(() => getJarFiltersForTab(tab), [tab]);
	const [searchTerm, setSearchTerm] = React.useState('');
	const [activeFilterIds, setActiveFilterIds] = React.useState<JarFilterId[]>(
		filters.map((filter) => filter.id),
	);

	React.useEffect(() => {
		setSearchTerm('');
		setActiveFilterIds(filters.map((filter) => filter.id));
		onSelectRow(null);
	}, [filters, onSelectRow]);

	const visibleRows = React.useMemo(
		() => filterJarRows(rows, searchTerm, activeFilterIds),
		[activeFilterIds, rows, searchTerm],
	);

	React.useEffect(() => {
		if (!selectedRowId) return;
		const selectedStillVisible = visibleRows.some((row) => row.id === selectedRowId);
		if (!selectedStillVisible) {
			onSelectRow(null);
		}
	}, [onSelectRow, selectedRowId, visibleRows]);

	const toggleFilter = (filterId: JarFilterId, checked: boolean) => {
		setActiveFilterIds((prev) => {
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
		<div className='space-y-4'>
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

			<div className='rounded-md border p-3 space-y-3'>
				<p className='text-sm font-medium'>Filters</p>
				<div className='grid gap-2 sm:grid-cols-2'>
					{filters.map((filter) => {
						const checked = activeFilterIds.includes(filter.id);
						return (
							<div
								key={filter.id}
								className='flex items-center justify-between rounded-md border px-3 py-2'>
								<label className='flex items-center gap-2 text-sm'>
									<Checkbox
										checked={checked}
										onCheckedChange={(next) => toggleFilter(filter.id, Boolean(next))}
									/>
									<span>{filter.label}</span>
								</label>
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
							</div>
						);
					})}
				</div>
			</div>

			<div className='rounded-md border overflow-hidden'>
				<table className='w-full text-sm'>
					<thead className='bg-secondary/80'>
						<tr>
							<th className='text-left font-medium px-3 py-2'>Provider</th>
							<th className='text-left font-medium px-3 py-2'>Version</th>
						</tr>
					</thead>
					<tbody>
						{visibleRows.map((row) => {
							const disabled = !isJarRowDownloadable(row);
							const selected = selectedRowId === row.id;

							return (
								<tr
									key={row.id}
									onClick={() => {
										if (disabled) return;
										onSelectRow(row);
									}}
									className={[
										'border-t transition-colors',
										disabled ? 'opacity-55' : 'cursor-pointer hover:bg-secondary/50',
										selected ? 'bg-primary/10' : '',
									]
										.filter(Boolean)
										.join(' ')}>
									<td className='px-3 py-2'>
										<div className='flex items-center gap-2'>
											{selected && <CircleCheck className='size-4 text-primary' />}
											<span>{row.provider}</span>
										</div>
									</td>
									<td className='px-3 py-2'>
										<div className='flex flex-col'>
											<span>
												{row.version}
												{row.stability ? ` (${formatStabilityLabel(row.stability)})` : ''}
											</span>
											{disabled && (
												<span className='text-xs text-muted-foreground'>
													Unavailable right now
												</span>
											)}
										</div>
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
			</div>
		</div>
	);
};

export default JarVersionSelectorPane;
