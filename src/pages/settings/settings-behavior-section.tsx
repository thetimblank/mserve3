import * as React from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { type ExperienceLevel, useUser } from '@/data/user';
import { EXPERIENCE_LEVEL_COPY, getExperienceLevelCopy } from '@/lib/experience-level-copy';

const EXPERIENCE_LEVEL_OPTIONS: SegmentedControlOption<ExperienceLevel>[] = EXPERIENCE_LEVEL_COPY.map(
	({ value, label, icon }) => ({ value, label, icon }),
);

const SettingsBehaviorSection: React.FC = () => {
	const { user, updateUserField } = useUser();

	const handleSuppressCloseWarningChange = (checked: boolean | 'indeterminate') => {
		const enabled = checked === true;
		updateUserField('suppress_close_warning', enabled);
		toast.success(enabled ? 'Close warning disabled.' : 'Close warning enabled.');
	};

	const handleExperienceLevelChange = (level: ExperienceLevel) => {
		updateUserField('experience_level', level);
		toast.success(`Experience level set to ${getExperienceLevelCopy(level).label}.`);
	};

	const handleAutoCheckServerUpdatesChange = (checked: boolean | 'indeterminate') => {
		const enabled = checked === true;
		updateUserField('auto_check_server_updates', enabled);
		toast.success(`Automatic server update checks ${enabled ? 'enabled' : 'disabled'}.`);
	};

	return (
		<SettingsRows>
			<SettingsRow
				title='Experience level'
				description={getExperienceLevelCopy(user.experience_level).description}>
				<SegmentedControl
					aria-label='Experience level'
					value={user.experience_level}
					onValueChange={handleExperienceLevelChange}
					options={EXPERIENCE_LEVEL_OPTIONS}
				/>
			</SettingsRow>

			<SettingsRow
				title='Skip close warning when servers are running'
				htmlFor='settings-suppress-close-warning'
				description='When enabled, closing MSERVE with active servers will force shut them down immediately without prompting. This may cause data loss.'
				control={
					<Checkbox
						id='settings-suppress-close-warning'
						checked={user.suppress_close_warning}
						onCheckedChange={handleSuppressCloseWarningChange}
					/>
				}
			/>

			<SettingsRow
				title='Check servers for updates on startup'
				htmlFor='settings-auto-check-server-updates'
				description="When enabled, MSERVE checks each server's provider for a newer jar build when the app loads and flags it in the server's jar settings. No update is ever installed automatically."
				control={
					<Checkbox
						id='settings-auto-check-server-updates'
						checked={user.auto_check_server_updates}
						onCheckedChange={handleAutoCheckServerUpdatesChange}
					/>
				}
			/>

			<SettingsRow
				title='Welcome tour'
				description='Runs the first-launch setup again: experience level, theme, and starting point.'
				control={
					<Button
						variant='secondary'
						size='sm'
						onClick={() => {
							updateUserField('onboarding_completed', false);
							toast.success('Welcome tour will replay now.');
						}}>
						<RotateCcw /> Replay welcome tour
					</Button>
				}
			/>
		</SettingsRows>
	);
};

export default SettingsBehaviorSection;
