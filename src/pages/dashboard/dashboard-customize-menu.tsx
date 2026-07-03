/**
 * Gear menu for showing/hiding dashboard sections. Persists the hidden set to
 * user preferences (`dashboard_hidden_sections`).
 */
import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DASHBOARD_SECTION_IDS, type DashboardSectionId, useUser } from '@/data/user';

const SECTION_LABELS: Record<DashboardSectionId, string> = {
	metrics: 'Headline stats',
	attention: 'Needs attention',
	storage: 'Storage breakdown',
	activity: 'Activity insights',
	online: 'Running servers',
	'most-used': 'Most used',
	networks: 'Networks',
};

const DashboardCustomizeMenu: React.FC = () => {
	const { user, updateUserField } = useUser();
	const hidden = new Set(user.dashboard_hidden_sections);

	const toggle = (id: DashboardSectionId, visible: boolean) => {
		updateUserField('dashboard_hidden_sections', (prev) => {
			const next = new Set(prev);
			if (visible) next.delete(id);
			else next.add(id);
			return DASHBOARD_SECTION_IDS.filter((sectionId) => next.has(sectionId));
		});
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='outline' size='sm'>
					<SlidersHorizontal /> Customize
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-52'>
				<DropdownMenuLabel>Show sections</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{DASHBOARD_SECTION_IDS.map((id) => (
					<DropdownMenuCheckboxItem
						key={id}
						checked={!hidden.has(id)}
						onCheckedChange={(checked) => toggle(id, checked === true)}
						onSelect={(event) => event.preventDefault()}>
						{SECTION_LABELS[id]}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

export default DashboardCustomizeMenu;
