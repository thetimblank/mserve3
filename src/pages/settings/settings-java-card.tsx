import { RotateCcw } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { useUser } from '@/data/user';

const SettingsJavaCard: React.FC = () => {
	const { user, updateUserField } = useUser();
	const [javaDefault, setJavaDefault] = React.useState(user.java_installation_default);

	React.useEffect(() => {
		setJavaDefault(user.java_installation_default);
	}, [user.java_installation_default]);

	// Autosaves on blur — no explicit save button. Empty input falls back to `java`.
	const commitJavaDefault = () => {
		const normalized = javaDefault.trim() || 'java';
		setJavaDefault(normalized);
		if (normalized !== user.java_installation_default) {
			updateUserField('java_installation_default', normalized);
		}
	};

	const handleResetJavaDefault = () => {
		setJavaDefault('java');
		updateUserField('java_installation_default', 'java');
		toast.success('Default Java installation reset to java.');
	};

	const isDefault = javaDefault.trim().toLowerCase() === 'java';

	return (
		<Card>
			<CardHeader>
				<CardTitle>Java runtime</CardTitle>
				<CardDescription>Set the Java used when a server has no override.</CardDescription>
			</CardHeader>
			<CardContent>
				<div className='space-y-2 max-w-lg'>
					<Label htmlFor='settings-java-default'>Default Java installation</Label>
					<InputGroup>
						<InputGroupInput
							id='settings-java-default'
							className='font-mono'
							placeholder='java'
							value={javaDefault}
							onChange={(event) => setJavaDefault(event.target.value)}
							onBlur={commitJavaDefault}
						/>
						<InputGroupAddon align='inline-end'>
							<InputGroupButton
								type='button'
								variant='ghost'
								size='icon-xs'
								aria-label='Reset to java'
								onClick={handleResetJavaDefault}
								disabled={isDefault}>
								<RotateCcw />
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
					<p className='text-sm text-muted-foreground'>
						Saved automatically. Used when a server does not set its own Java override.
					</p>
				</div>
			</CardContent>
		</Card>
	);
};

export default SettingsJavaCard;
