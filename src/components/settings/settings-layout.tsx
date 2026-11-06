/**
 * The shared settings shell used by the global `/settings` page and a server's
 * Settings tab: a sidebar (search + grouped section list) beside one section
 * page at a time. Structure follows Discord's settings: small uppercase group
 * headings, a ~720px content column with the page title on top.
 *
 *   <SettingsLayout groups={[{ id: 'app', title: 'App' }]} sections={sections} />
 *
 * A `#section-id` hash in the URL opens that section (on mount and whenever the
 * hash changes), so deep links such as `/settings#java` work.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { Loader2, Search } from 'lucide-react';

import EmptyState from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type SettingsSection = {
	/** Stable id, also the `#hash` that deep-links to this section. */
	id: string;
	/** The `id` of the group this section is listed under. */
	group: string;
	title: string;
	/** One muted line under the page title. Searched along with the title. */
	description?: string;
	/** Extra search terms that don't appear in the title or description. */
	keywords?: string[];
	/** Rendered next to the page title (a HelpButton, a badge). */
	titleAddon?: React.ReactNode;
	/** `destructive` colors the page title, for a danger zone. */
	tone?: 'default' | 'destructive';
	render: () => React.ReactNode;
};

export type SettingsGroup = {
	id: string;
	/** Small uppercase heading. Untitled groups get a divider instead. */
	title?: string;
	/** While set, a spinner row with this text sits under the group's sections. */
	loadingLabel?: string;
};

type SettingsLayoutProps = {
	groups: SettingsGroup[];
	sections: SettingsSection[];
	/** Disables search and switching sections (e.g. while a save is running). */
	navigationDisabled?: boolean;
	/** Drawn over the active section's body (under its title), e.g. a lock notice. */
	renderOverlay?: (section: SettingsSection) => React.ReactNode;
	searchPlaceholder?: string;
	className?: string;
};

const normalizeQuery = (value: string) => value.trim().toLowerCase();

export const matchesSettingsSection = (section: SettingsSection, query: string) => {
	const normalized = normalizeQuery(query);
	if (!normalized) return true;

	return [section.title, section.description ?? '', ...(section.keywords ?? [])]
		.join(' ')
		.toLowerCase()
		.includes(normalized);
};

/** Sections that match `query`, bucketed and ordered by `groups`. */
export const groupSettingsSections = (
	groups: SettingsGroup[],
	sections: SettingsSection[],
	query: string,
) =>
	groups.map((group) => ({
		group,
		sections: sections.filter(
			(section) => section.group === group.id && matchesSettingsSection(section, query),
		),
	}));

const truncateQuery = (query: string) => (query.length > 24 ? `${query.slice(0, 24)}...` : query);

export function SettingsLayout({
	groups,
	sections,
	navigationDisabled = false,
	renderOverlay,
	searchPlaceholder = 'Search settings...',
	className,
}: SettingsLayoutProps) {
	const { hash } = useLocation();
	const navigate = useNavigate();
	const [query, setQuery] = React.useState('');
	const [activeId, setActiveId] = React.useState(() => hash.slice(1));
	const scrollRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		const requested = hash.slice(1);
		if (requested) setActiveId(requested);
	}, [hash]);

	const grouped = React.useMemo(
		() => groupSettingsSections(groups, sections, query),
		[groups, sections, query],
	);
	const orderedVisible = React.useMemo(() => grouped.flatMap((entry) => entry.sections), [grouped]);

	// Fall back to the first match without forgetting the chosen section, so a
	// section that appears later (config files found by a scan, a deep link
	// into one) still opens once it exists.
	const displayed = orderedVisible.find((section) => section.id === activeId) ?? orderedVisible[0] ?? null;
	const displayedId = displayed?.id ?? null;

	// While searching, the first match becomes the chosen section, so clearing
	// the search keeps the user where the search took them. A chosen section
	// that doesn't exist yet (a pending deep link) is left alone.
	const isPendingDeepLink = activeId !== '' && !sections.some((section) => section.id === activeId);
	React.useEffect(() => {
		if (normalizeQuery(query) && !isPendingDeepLink && displayedId && displayedId !== activeId) {
			setActiveId(displayedId);
		}
	}, [activeId, displayedId, isPendingDeepLink, query]);

	// Mirror the choice into the hash so a reload or Back/Forward reopens it.
	const selectSection = (id: string) => {
		setActiveId(id);
		navigate({ hash: id }, { replace: true });
	};

	React.useEffect(() => {
		if (scrollRef.current) scrollRef.current.scrollTop = 0;
	}, [displayedId]);

	const overlay = displayed ? renderOverlay?.(displayed) : null;
	const isSearching = normalizeQuery(query) !== '';
	const visibleGroups = grouped.filter(
		({ group, sections: groupSections }) =>
			groupSections.length > 0 || (group.loadingLabel && !isSearching),
	);

	return (
		<div className={cn('flex h-full min-h-0 gap-6 lg:gap-10', className)}>
			<div className='flex w-48 shrink-0 flex-col gap-4 lg:w-56'>
				<div className='relative'>
					<Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={searchPlaceholder}
						aria-label='Search settings'
						className='pl-9'
						disabled={navigationDisabled}
					/>
				</div>

				<nav
					aria-label='Settings sections'
					aria-disabled={navigationDisabled}
					className='app-scroll-area min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-6'>
					{visibleGroups.length === 0 ? (
						<p className='px-2.5 text-sm text-muted-foreground'>
							No sections match "{truncateQuery(query)}".
						</p>
					) : (
						visibleGroups.map(({ group, sections: groupSections }, index) => (
							<div key={group.id} className={cn(index > 0 && 'mt-5')}>
								{group.title ? (
									<p className='px-2.5 pb-1.5 text-xs font-bold tracking-wide text-muted-foreground uppercase'>
										{group.title}
									</p>
								) : (
									index > 0 && <div role='separator' className='mx-2.5 mb-3 h-px bg-border' />
								)}

								<AnimatePresence initial={false}>
									{groupSections.map((section) => {
										const isActive = section.id === displayedId;
										return (
											<m.div
												key={section.id}
												initial={{ height: 0, opacity: 0 }}
												animate={{ height: 'auto', opacity: 1 }}
												exit={{ height: 0, opacity: 0 }}
												transition={{ type: 'spring', duration: 0.25, bounce: 0 }}
												className='overflow-hidden'>
												<button
													type='button'
													aria-current={isActive ? 'page' : undefined}
													onClick={() => selectSection(section.id)}
													disabled={navigationDisabled}
													className={cn(
														'my-0.5 flex w-full rounded-md px-2.5 py-1.5 text-left font-medium transition-colors',
														isActive
															? 'bg-accent/25 text-foreground'
															: 'cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground',
														section.tone === 'destructive' && !isActive && 'text-destructive/80',
													)}>
													{section.title}
												</button>
											</m.div>
										);
									})}
								</AnimatePresence>

								{group.loadingLabel && !isSearching && (
									<div className='flex items-center gap-2 px-2.5 py-1.5 text-sm text-muted-foreground'>
										<Loader2 className='size-4 animate-spin' />
										<span>{group.loadingLabel}</span>
									</div>
								)}
							</div>
						))
					)}
				</nav>
			</div>

			<div ref={scrollRef} className='app-scroll-area min-h-0 min-w-0 flex-1 overflow-y-auto'>
				{displayed ? (
					// Side padding keeps focus rings inside the scroll clip. `@container`
					// lets section grids respond to the column width, not the window.
					<div className='@container max-w-180 pr-6 pb-16 pl-1'>
						<header className='mb-8 space-y-1.5'>
							<div className='flex flex-wrap items-center gap-2'>
								<h2
									className={cn(
										'text-2xl font-bold',
										displayed.tone === 'destructive' && 'text-destructive',
									)}>
									{displayed.title}
								</h2>
								{displayed.titleAddon}
							</div>
							{displayed.description && (
								<p className='text-sm text-muted-foreground'>{displayed.description}</p>
							)}
						</header>

						<div className='relative'>
							{overlay && <div className='absolute inset-x-0 top-0 z-10'>{overlay}</div>}
							<div key={displayed.id}>{displayed.render()}</div>
						</div>
					</div>
				) : (
					<EmptyState
						variant='no-results'
						title='No settings found'
						description={`Nothing matches "${truncateQuery(query)}".`}
						onClearSearch={() => setQuery('')}
					/>
				)}
			</div>
		</div>
	);
}
