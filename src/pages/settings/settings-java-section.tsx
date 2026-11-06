import { RotateCcw, RefreshCcw } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import JavaRuntimeSelect from '@/components/java-runtime-select';
import { useExperience, useUser } from '@/data/user';
import { useJavaRuntimes } from '@/data/java-runtimes';

const SettingsJavaSection: React.FC = () => {
	const { user, updateUserField } = useUser();
	const { runtimes, isLoading, rescan } = useJavaRuntimes();
	const { isAdvanced } = useExperience();

	const [javaDefault, setJavaDefault] = React.useState(user.java_installation_default);

	React.useEffect(() => {
		setJavaDefault(user.java_installation_default);
	}, [user.java_installation_default]);

	const commitJavaDefault = (next: string) => {
		const normalized = next.trim();
		setJavaDefault(normalized);
		if (normalized !== user.java_installation_default) {
			updateUserField('java_installation_default', normalized);
		}
	};

	const handleReset = () => {
		commitJavaDefault('');
		toast.success('Default Java set to Automatic.');
	};

	const handleRescan = async () => {
		const found = await rescan();
		toast.success(`Found ${found.length} Java runtime${found.length === 1 ? '' : 's'}.`);
	};

	const isAutomatic = javaDefault.trim() === '';

	return (
		<SettingsRows>
			<SettingsRow
				title='Default Java installation'
				htmlFor='settings-java-default'
				description="Saved automatically. Used as the default when a server doesn't pick its own runtime."
				control={
					<Button type='button' variant='secondary' size='sm' onClick={handleRescan} disabled={isLoading}>
						<RefreshCcw className={isLoading ? 'animate-spin' : undefined} />
						Rescan
					</Button>
				}>
				<JavaRuntimeSelect
					id='settings-java-default'
					javaRuntimes={runtimes}
					value={javaDefault}
					onChange={commitJavaDefault}
				/>
			</SettingsRow>

			{isAdvanced && (
				<SettingsRow
					title='Manual path override'
					htmlFor='settings-java-default-path'
					description={
						<>
							Point to a specific <span className='font-mono'>java</span> executable. Leave blank for
							Automatic.
						</>
					}>
					<InputGroup>
						<InputGroupInput
							id='settings-java-default-path'
							className='font-mono'
							placeholder='Automatic'
							value={javaDefault}
							onChange={(event) => setJavaDefault(event.target.value)}
							onBlur={(event) => commitJavaDefault(event.target.value)}
						/>
						<InputGroupAddon align='inline-end'>
							<InputGroupButton
								type='button'
								variant='ghost'
								size='icon-xs'
								aria-label='Reset to Automatic'
								onClick={handleReset}
								disabled={isAutomatic}>
								<RotateCcw />
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
				</SettingsRow>
			)}
		</SettingsRows>
	);
};

export default SettingsJavaSection;
