import * as React from 'react';
import { RotateCcw } from 'lucide-react';
import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	isServerPageSectionShownByDefault,
	type ServerPageDisplayPrefs,
	useServerPageDisplay,
	useUser,
} from '@/data/user';
import { getExperienceLevelCopy } from '@/lib/experience-level-copy';

const SettingsServerPageSection: React.FC = () => {
	const { user, updateUserField } = useUser();
	const { showLiveStats, showDetails } = useServerPageDisplay();
	const prefs = user.server_page_display;
	const levelLabel = getExperienceLevelCopy(user.experience_level).label;
	const levelDefault = isServerPageSectionShownByDefault(user.experience_level) ? 'shown' : 'hidden';
	const hasOverride = prefs.show_live_stats !== null || prefs.show_details !== null;

	const handlePrefChange = (key: keyof ServerPageDisplayPrefs, checked: boolean | 'indeterminate') => {
		updateUserField('server_page_display', (previous) => ({ ...previous, [key]: checked === true }));
	};

	const defaultNote = `${levelLabel} default: ${levelDefault}.`;

	return (
		<SettingsRows>
			<SettingsRow
				title='Show live stats'
				htmlFor='settings-server-page-live-stats'
				description={`CPU, RAM, players, TPS, and uptime cards on a server's overview. ${defaultNote}`}
				control={
					<Checkbox
						id='settings-server-page-live-stats'
						checked={showLiveStats}
						onCheckedChange={(checked) => handlePrefChange('show_live_stats', checked)}
					/>
				}
			/>

			<SettingsRow
				title='Show server details'
				htmlFor='settings-server-page-details'
				description={`Version, provider, jar, RAM, Java, and sizes on a server's overview. ${defaultNote}`}
				control={
					<Checkbox
						id='settings-server-page-details'
						checked={showDetails}
						onCheckedChange={(checked) => handlePrefChange('show_details', checked)}
					/>
				}
			/>

			{hasOverride && (
				<SettingsRow
					title='Use level defaults'
					description='Forget these choices and follow your experience level again.'
					control={
						<Button
							variant='secondary'
							size='sm'
							onClick={() =>
								updateUserField('server_page_display', { show_live_stats: null, show_details: null })
							}>
							<RotateCcw /> Reset
						</Button>
					}
				/>
			)}
		</SettingsRows>
	);
};

export default SettingsServerPageSection;
