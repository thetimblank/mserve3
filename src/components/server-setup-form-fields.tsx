import * as React from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ServerSetupFormData } from '@/lib/mserve-sync';
import { examplePaths } from '@/lib/platform';
import { AutoBackupFields } from '@/components/auto-backup-fields';
import RamSliderField from '@/components/ram-slider-field';

type ServerSetupFormFieldsProps = {
	form: ServerSetupFormData;
	onFieldChange: <K extends keyof ServerSetupFormData>(key: K, value: ServerSetupFormData[K]) => void;
	onPickDirectory?: () => Promise<void> | void;
	onPickServerFile: () => Promise<void> | void;
	idPrefix: string;
	showDirectory?: boolean;
	showCreateDirectoryIfMissing?: boolean;
	showAutoAgreeEula?: boolean;
};

export const ServerSetupFormFields: React.FC<ServerSetupFormFieldsProps> = ({
	form,
	onFieldChange,
	onPickDirectory,
	onPickServerFile,
	idPrefix,
	showDirectory = true,
	showCreateDirectoryIfMissing = true,
	showAutoAgreeEula = true,
}) => {
	return (
		<>
			{showDirectory && (
				<div className='space-y-2'>
					<Field>
						<Label htmlFor={`${idPrefix}-directory`}>Server Location</Label>
						<div className='flex gap-2'>
							<Input
								id={`${idPrefix}-directory`}
								placeholder={examplePaths.serverDirectory}
								value={form.directory}
								onChange={(event) => onFieldChange('directory', event.target.value)}
								required
							/>
							<Button type='button' variant='outline' onClick={onPickDirectory}>
								<FolderOpen /> Browse
							</Button>
						</div>
					</Field>
					{showCreateDirectoryIfMissing && (
						<Field>
							<Label className='flex items-center gap-3'>
								<Checkbox
									checked={form.create_directory_if_missing}
									onCheckedChange={(checked) =>
										onFieldChange(
											'create_directory_if_missing',
											typeof checked === 'boolean' ? checked : false,
										)
									}
								/>
								Create directory if it doesn't exist
							</Label>
						</Field>
					)}
				</div>
			)}

			<Field>
				<Label htmlFor={`${idPrefix}-file`}>Server Jar File Location</Label>
				<div className='flex gap-2'>
					<Input
						id={`${idPrefix}-file`}
						placeholder={examplePaths.serverJar}
						value={form.file}
						onChange={(event) => onFieldChange('file', event.target.value)}
						required
					/>
					<Button type='button' variant='outline' onClick={onPickServerFile}>
						<FolderOpen /> Browse
					</Button>
				</div>
			</Field>

			<RamSliderField
				id={`${idPrefix}-ram`}
				value={form.ram}
				onChange={(value) => onFieldChange('ram', value)}
			/>

			<Field>
				<Label htmlFor={`${idPrefix}-java-installation`}>Java installation override (optional)</Label>
				<Input
					id={`${idPrefix}-java-installation`}
					placeholder={examplePaths.javaExecutable}
					value={form.java_installation}
					onChange={(event) => onFieldChange('java_installation', event.target.value)}
				/>
			</Field>

			<AutoBackupFields values={form} onFieldChange={onFieldChange} idPrefix={idPrefix} />
			<Field>
				<Label className='flex items-center gap-3'>
					<Checkbox
						checked={form.auto_restart}
						onCheckedChange={(checked) =>
							onFieldChange('auto_restart', typeof checked === 'boolean' ? checked : false)
						}
					/>
					Auto restart server when it closes
				</Label>
			</Field>
			{showAutoAgreeEula && (
				<Field>
					<Label className='flex items-center gap-3'>
						<Checkbox
							checked={form.auto_agree_eula}
							onCheckedChange={(checked) =>
								onFieldChange('auto_agree_eula', typeof checked === 'boolean' ? checked : false)
							}
						/>
						Auto agree to eula.txt
					</Label>
				</Field>
			)}
		</>
	);
};
