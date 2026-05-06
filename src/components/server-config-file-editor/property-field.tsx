import React from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useUser } from '@/data/user';
import type { ManagedConfigPropertyDefinition } from '@/lib/server-config-files';

const propertyLabel = (property: ManagedConfigPropertyDefinition) => (
	<span className='flex items-center gap-2'>
		<span>{property.label}</span>
	</span>
);

const FieldShell = ({
	property,
	htmlFor,
	children,
}: {
	property: ManagedConfigPropertyDefinition;
	htmlFor?: string;
	children: React.ReactNode;
}) => (
	<div className='space-y-2 max-w-lg'>
		<Label htmlFor={htmlFor} className='text-xl'>
			{propertyLabel(property)}
		</Label>
		<p className='text-sm text-muted-foreground'>{property.description}</p>
		{children}
	</div>
);

const PropertyField: React.FC<{
	property: ManagedConfigPropertyDefinition;
	value: string;
	onChange: (nextValue: string) => void;
	disabled?: boolean;
}> = ({ property, value, onChange, disabled }) => {
	const { user } = useUser();
	const id = `managed-config-${property.key}`;

	if (property.network && !user.advanced_mode) return null;

	if (property.type === 'boolean') {
		return (
			<FieldShell property={property}>
				<Label className='flex items-center gap-3'>
					<Checkbox
						id={id}
						checked={value.trim().toLowerCase() === 'true'}
						onCheckedChange={(checked) => onChange(checked === true ? 'true' : 'false')}
						disabled={disabled}
					/>
					Enabled
				</Label>
			</FieldShell>
		);
	}

	if (property.type === 'number') {
		const min = property.key === 'spawn-protection' ? 0 : 1;

		return (
			<FieldShell property={property} htmlFor={id}>
				<InputGroup>
					<InputGroupInput
						id={id}
						type='number'
						min={min}
						max={property.key === 'server-port' ? 65535 : undefined}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						disabled={disabled}
					/>
					<InputGroupAddon className='font-mono font-bold uppercase text-xs' align='inline-end'>
						{property.unitLabel ?? 'Units'}
					</InputGroupAddon>
				</InputGroup>
			</FieldShell>
		);
	}

	if (property.type === 'enum') {
		return (
			<FieldShell property={property} htmlFor={id}>
				<Select value={value} onValueChange={onChange} disabled={disabled}>
					<SelectTrigger id={id} className='w-full'>
						<SelectValue placeholder='Select an option' />
					</SelectTrigger>
					<SelectContent>
						{property.options?.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</FieldShell>
		);
	}

	if (property.type === 'list' || property.type === 'map') {
		return (
			<FieldShell property={property} htmlFor={id}>
				<Textarea
					id={id}
					className='min-h-40 font-mono text-sm'
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					spellCheck={false}
				/>
			</FieldShell>
		);
	}

	return (
		<FieldShell property={property} htmlFor={id}>
			{property.multiline ? (
				<Textarea
					id={id}
					className='min-h-28 font-mono text-sm'
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					spellCheck={false}
				/>
			) : (
				<Input
					id={id}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
				/>
			)}
		</FieldShell>
	);
};

export default PropertyField;
