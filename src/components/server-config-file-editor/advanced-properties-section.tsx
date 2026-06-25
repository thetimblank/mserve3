import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { PropertyValues, TomlValueKind } from './types';
import { prettifyKey } from './utils';

type AdvancedPropertyKind = TomlValueKind | 'multiline';

const usesTextarea = (kind: AdvancedPropertyKind) =>
	kind === 'list' || kind === 'json' || kind === 'multiline';

export const AdvancedPropertiesSection = ({
	fileName,
	keys,
	values,
	description,
	disabled,
	getKind,
	onChange,
}: {
	fileName: string;
	keys: string[];
	values: PropertyValues;
	description: string;
	disabled: boolean;
	getKind: (key: string, value: string) => AdvancedPropertyKind;
	onChange: (key: string, nextValue: string) => void;
}) => {
	if (keys.length === 0) return null;

	return (
		<section className='space-y-4'>
			<hr className='w-full border-b-2 my-10' />
			<div className='space-y-1'>
				<p className='text-3xl font-semibold'>Advanced properties</p>
				<p className='text-sm text-muted-foreground'>{description}</p>
			</div>
			<div className='grid gap-4'>
				{keys.map((key) => {
					const value = values[key] ?? '';
					const kind = getKind(key, value);
					const fieldId = `managed-config-${fileName}-${key}`;

					return (
						<div key={key} className='space-y-2 max-w-lg'>
							<Label htmlFor={fieldId} className='text-xl'>
								{prettifyKey(key)}
							</Label>
							{kind === 'boolean' ? (
								<Label className='flex items-center gap-3'>
									<Checkbox
										checked={value.trim().toLowerCase() === 'true'}
										onCheckedChange={(checked) =>
											onChange(key, checked === true ? 'true' : 'false')
										}
										disabled={disabled}
									/>
									Enabled
								</Label>
							) : usesTextarea(kind) ? (
								<Textarea
									id={fieldId}
									className='min-h-28 font-mono text-sm'
									value={value}
									onChange={(event) => onChange(key, event.target.value)}
									disabled={disabled}
									spellCheck={false}
								/>
							) : (
								<Input
									id={fieldId}
									type={kind === 'number' ? 'number' : undefined}
									value={value}
									onChange={(event) => onChange(key, event.target.value)}
									disabled={disabled}
								/>
							)}
						</div>
					);
				})}
			</div>
		</section>
	);
};
