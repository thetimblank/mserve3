import { RotateCcw, RefreshCcw } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import JavaRuntimeSelect from '@/components/java-runtime-select';
import { useUser } from '@/data/user';
import { useJavaRuntimes } from '@/data/java-runtimes';

const SettingsJavaCard: React.FC = () => {
	const { user, updateUserField } = useUser();
	const { runtimes, isLoading, rescan } = useJavaRuntimes();
	const advancedMode = user.advanced_mode;

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
		<Card>
			<CardHeader>
				<CardTitle>Java runtime</CardTitle>
				<CardDescription>
					Choose the Java used when a server is set to Automatic. Leave on Automatic to let each
					server pick the version that matches its Minecraft version.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className='space-y-4 max-w-lg'>
					<div className='space-y-2'>
						<div className='flex items-center justify-between gap-2'>
							<Label htmlFor='settings-java-default'>Default Java installation</Label>
							<Button
								type='button'
								variant='ghost'
								size='sm'
								onClick={handleRescan}
								disabled={isLoading}>
								<RefreshCcw className={isLoading ? 'animate-spin' : undefined} />
								Rescan
							</Button>
						</div>
						<JavaRuntimeSelect
							id='settings-java-default'
							javaRuntimes={runtimes}
							value={javaDefault}
							onChange={commitJavaDefault}
						/>
						<p className='text-sm text-muted-foreground'>
							Saved automatically. Used as the default when a server doesn't pick its own runtime.
						</p>
					</div>

					{advancedMode && (
						<div className='space-y-2'>
							<Label htmlFor='settings-java-default-path'>Manual path override</Label>
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
							<p className='text-sm text-muted-foreground'>
								Point to a specific <span className='font-mono'>java</span> executable. Leave blank
								for Automatic.
							</p>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
};

export default SettingsJavaCard;
