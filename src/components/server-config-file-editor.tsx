import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link } from 'react-router-dom';
import { Info, Loader, RefreshCcw, Save, Star, Trash } from 'lucide-react';
import { toast } from 'sonner';
import * as TOML from '@iarna/toml';
import * as YAML from 'yaml';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
	type ManagedConfigFileReadPayload,
	type ManagedConfigFileReadResult,
	type ManagedConfigFileWritePayload,
	type ManagedConfigPropertyDefinition,
	type ManagedServerConfigFileDefinition,
} from '@/lib/server-config-files';

type ServerConfigFileEditorProps = {
	serverDirectory: string;
	definition: ManagedServerConfigFileDefinition;
	disabled?: boolean;
	onSaved?: () => Promise<void> | void;
};

type PropertyValues = Record<string, string>;
type TomlRoot = Record<string, unknown>;

const UNSAVED_TOAST_STYLE = {
	'--width': 'min(32rem, calc(100vw - 2rem))',
} as React.CSSProperties;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toErrorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const defaultValueToString = (value: ManagedConfigPropertyDefinition['defaultValue']) => {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) return value.map((entry) => String(entry)).join('\n');
	if (isRecord(value)) return JSON.stringify(value, null, 2);
	return '';
};

const normalizeJsonContent = (content: string) => `${JSON.stringify(JSON.parse(content), null, 2)}\n`;

const normalizeYamlContent = (content: string) => {
	const parsed = YAML.parse(content);
	return `${YAML.stringify(parsed).trimEnd()}\n`;
};

const normalizeTomlContent = (content: string) => `${TOML.stringify(TOML.parse(content)).trimEnd()}\n`;

const parsePropertiesMap = (content: string) => {
	const values = new Map<string, string>();

	for (const rawLine of content.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
			continue;
		}

		const equalsIndex = rawLine.indexOf('=');
		const colonIndex = rawLine.indexOf(':');
		let separatorIndex = -1;

		if (equalsIndex >= 0 && colonIndex >= 0) {
			separatorIndex = Math.min(equalsIndex, colonIndex);
		} else {
			separatorIndex = equalsIndex >= 0 ? equalsIndex : colonIndex;
		}

		if (separatorIndex < 0) {
			throw new Error(`Invalid properties line: ${rawLine}`);
		}

		const key = rawLine.slice(0, separatorIndex).trim();
		const value = rawLine.slice(separatorIndex + 1).trim();
		if (!key) {
			throw new Error(`Invalid properties line: ${rawLine}`);
		}

		values.set(key, value);
	}

	return values;
};

const serializePropertiesMap = (values: Map<string, string>, featuredKeys: string[]) => {
	const orderedKeys: string[] = [];

	for (const key of featuredKeys) {
		if (values.has(key) && !orderedKeys.includes(key)) {
			orderedKeys.push(key);
		}
	}

	for (const key of Array.from(values.keys()).sort((left, right) => left.localeCompare(right))) {
		if (!orderedKeys.includes(key)) {
			orderedKeys.push(key);
		}
	}

	return `${orderedKeys.map((key) => `${key}=${values.get(key) ?? ''}`).join('\n')}\n`;
};

const createPropertyValues = (
	properties: ManagedConfigPropertyDefinition[],
	rawValues: Record<string, unknown>,
): PropertyValues => {
	const nextValues: PropertyValues = {};

	for (const property of properties) {
		const rawValue = rawValues[property.key];
		if (typeof rawValue === 'string') {
			nextValues[property.key] = rawValue;
			continue;
		}

		if (typeof rawValue === 'number') {
			nextValues[property.key] = String(rawValue);
			continue;
		}

		if (typeof rawValue === 'boolean') {
			nextValues[property.key] = rawValue ? 'true' : 'false';
			continue;
		}

		if (Array.isArray(rawValue)) {
			nextValues[property.key] = rawValue.map((entry) => String(entry)).join('\n');
			continue;
		}

		if (isRecord(rawValue)) {
			nextValues[property.key] = JSON.stringify(rawValue, null, 2);
			continue;
		}

		nextValues[property.key] = defaultValueToString(property.defaultValue);
	}

	return nextValues;
};

const parsePropertyNumber = (property: ManagedConfigPropertyDefinition, value: string) => {
	const parsed = Number(value.trim());
	if (!Number.isInteger(parsed)) {
		throw new Error(`${property.label} must be a whole number.`);
	}

	if (property.key === 'server-port' && (parsed < 1 || parsed > 65535)) {
		throw new Error('Server port must be between 1 and 65535.');
	}

	if (property.key === 'spawn-protection' && parsed < 0) {
		throw new Error('Spawn protection must be 0 or greater.');
	}

	if (parsed < 0) {
		throw new Error(`${property.label} must be 0 or greater.`);
	}

	return String(parsed);
};

const renderHeader = (
	definition: ManagedServerConfigFileDefinition,
	isDirty: boolean,
	onReload: () => Promise<void> | void,
	disabled: boolean,
) => (
	<div className='flex flex-wrap items-start justify-between gap-4'>
		<div className='space-y-1'>
			<p className='text-xl font-semibold'>{definition.title}</p>
			<p className='text-sm text-muted-foreground'>{definition.description}</p>
		</div>
		<div className='flex flex-wrap items-center gap-2'>
			{isDirty && (
				<span className='rounded-md border-2 font-semibold border-destructive px-3 text-sm py-1 text-destructive'>
					Unsaved
				</span>
			)}
			<Button type='button' variant='secondary' onClick={onReload} disabled={disabled}>
				<RefreshCcw />
				Reload
			</Button>
		</div>
	</div>
);

const renderNetworkingDisclaimer = (definition: ManagedServerConfigFileDefinition) => {
	if (!definition.networkingDisclaimer) return null;

	return (
		<div className='rounded-md border-2 border-warning bg-warning/10 font-semibold p-4 text-sm text-warning-foreground flex gap-3 items-center'>
			<Info className='text-warning-foreground size-10' />
			<div>
				Server networking is automatically managed by MSERVE. You may still enter values when in{' '}
				<Link to='/settings' className='font-medium text-foreground underline underline-offset-4'>
					advanced mode
				</Link>{' '}
				to override mserve's automatic networking (not recommended).
			</div>
		</div>
	);
};

const useUnsavedChangesToast = ({
	toastId,
	isDirty,
	isLocked,
	isSaving,
	onReset,
	onSave,
}: {
	toastId: string;
	isDirty: boolean;
	isLocked: boolean;
	isSaving: boolean;
	onReset: () => void;
	onSave: () => Promise<void>;
}) => {
	React.useEffect(() => {
		if (isLocked || !isDirty) {
			toast.dismiss(toastId);
			return;
		}

		toast('You have unsaved changes', {
			id: toastId,
			duration: Number.POSITIVE_INFINITY,
			dismissible: false,
			style: UNSAVED_TOAST_STYLE,
			action: (
				<div className='ml-auto flex items-center gap-2'>
					<Button type='button' variant='destructive-secondary' onClick={onReset}>
						<Trash className='size-4' /> Reset
					</Button>
					<Button type='button' onClick={() => void onSave()}>
						{isSaving ? <Loader className='size-4 animate-spin' /> : <Save className='size-4' />}
						{isSaving ? 'Saving...' : 'Save file'}
					</Button>
				</div>
			),
		});

		return () => {
			toast.dismiss(toastId);
		};
	}, [isDirty, isLocked, isSaving, onReset, onSave, toastId]);
};

const MotdPreview: React.FC<{ value: string }> = ({ value }) => {
	const lines = value.split(/\r?\n/);
	return (
		<div className='rounded-md bg-neutral-900 px-4 py-3 text-sm leading-relaxed text-white shadow-inner font-minecraft'>
			{lines.length > 0 ? (
				lines.map((line, index) => (
					<div key={`${index}-${line}`} className='min-h-5'>
						{line.length > 0 ? line : '\u00a0'}
					</div>
				))
			) : (
				<div className='text-white/50'>Your MOTD preview will appear here.</div>
			)}
		</div>
	);
};

const propertyLabel = (property: ManagedConfigPropertyDefinition) => (
	<span className='flex items-center gap-2'>
		<Star className='size-4 shrink-0 fill-warning text-warning' />
		<span>{property.label}</span>
	</span>
);

const PropertyField: React.FC<{
	property: ManagedConfigPropertyDefinition;
	value: string;
	onChange: (nextValue: string) => void;
	disabled?: boolean;
}> = ({ property, value, onChange, disabled }) => {
	const id = `managed-config-${property.key}`;

	if (property.type === 'boolean') {
		return (
			<div className='space-y-2 max-w-lg'>
				<Label className='text-xl'>{propertyLabel(property)}</Label>
				<p className='text-sm text-muted-foreground'>{property.description}</p>
				<Label className='flex items-center gap-3'>
					<Checkbox
						id={id}
						checked={value.trim().toLowerCase() === 'true'}
						onCheckedChange={(checked) => onChange(checked === true ? 'true' : 'false')}
						disabled={disabled}
					/>
					Enabled
				</Label>
			</div>
		);
	}

	if (property.type === 'number') {
		const min = property.key === 'spawn-protection' ? 0 : 1;

		return (
			<div className='space-y-2 max-w-lg'>
				<Label htmlFor={id} className='text-xl'>
					{propertyLabel(property)}
				</Label>
				<p className='text-sm text-muted-foreground'>{property.description}</p>
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
			</div>
		);
	}

	if (property.type === 'enum') {
		return (
			<div className='space-y-2 max-w-lg'>
				<Label htmlFor={id} className='text-xl'>
					{propertyLabel(property)}
				</Label>
				<p className='text-sm text-muted-foreground'>{property.description}</p>
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
			</div>
		);
	}

	if (property.type === 'list') {
		return (
			<div className='space-y-2 max-w-lg'>
				<Label htmlFor={id} className='text-xl'>
					{propertyLabel(property)}
				</Label>
				<p className='text-sm text-muted-foreground'>{property.description}</p>
				<Textarea
					id={id}
					className='min-h-40 font-mono text-sm'
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					spellCheck={false}
				/>
			</div>
		);
	}

	if (property.type === 'map') {
		return (
			<div className='space-y-2 max-w-lg'>
				<Label htmlFor={id} className='text-xl'>
					{propertyLabel(property)}
				</Label>
				<p className='text-sm text-muted-foreground'>{property.description}</p>
				<Textarea
					id={id}
					className='min-h-40 font-mono text-sm'
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					spellCheck={false}
				/>
			</div>
		);
	}

	return (
		<div className='space-y-2 max-w-lg'>
			<Label htmlFor={id} className='text-xl'>
				{propertyLabel(property)}
			</Label>
			<p className='text-sm text-muted-foreground'>{property.description}</p>
			{property.multiline ? (
				<>
					<Textarea
						id={id}
						className='min-h-28 font-mono text-sm'
						value={value}
						onChange={(event) => onChange(event.target.value)}
						disabled={disabled}
						spellCheck={false}
					/>
					{property.key === 'motd' && <MotdPreview value={value} />}
				</>
			) : (
				<Input
					id={id}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
				/>
			)}
		</div>
	);
};

const PlainTextConfigFileEditor: React.FC<ServerConfigFileEditorProps> = ({
	serverDirectory,
	definition,
	disabled,
	onSaved,
}) => {
	const [content, setContent] = React.useState('');
	const [originalContent, setOriginalContent] = React.useState('');
	const [isLoading, setIsLoading] = React.useState(true);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const isDirty = content !== originalContent;
	const toastId = React.useMemo(
		() => `managed-config-${serverDirectory}-${definition.fileName}`,
		[definition.fileName, serverDirectory],
	);

	const loadContent = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await invoke<ManagedConfigFileReadResult>('read_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
				} as ManagedConfigFileReadPayload,
			});
			setContent(result.content);
			setOriginalContent(result.content);
		} catch (err) {
			setError(toErrorMessage(err, `Could not load ${definition.fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [definition.fileName, serverDirectory]);

	React.useEffect(() => {
		void loadContent();
	}, [loadContent]);

	const handleReset = React.useCallback(() => {
		setContent(originalContent);
		setError(null);
	}, [originalContent]);

	const handleReload = React.useCallback(async () => {
		await loadContent();
	}, [loadContent]);

	const handleSave = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			let normalizedContent = content;
			switch (definition.format) {
				case 'json':
					normalizedContent = normalizeJsonContent(content);
					break;
				case 'yaml':
					normalizedContent = normalizeYamlContent(content);
					break;
				case 'toml':
					normalizedContent = normalizeTomlContent(content);
					break;
				default:
					break;
			}

			const result = await invoke<ManagedConfigFileReadResult>('write_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
					content: normalizedContent,
				} as ManagedConfigFileWritePayload,
			});

			setContent(result.content);
			setOriginalContent(result.content);
			toast.success(`${definition.title} saved.`);
			await onSaved?.();
		} catch (err) {
			setError(toErrorMessage(err, `Could not save ${definition.fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [content, definition, isLocked, onSaved, serverDirectory]);

	useUnsavedChangesToast({
		toastId,
		isDirty,
		isLocked,
		isSaving,
		onReset: handleReset,
		onSave: handleSave,
	});

	return (
		<div className='space-y-6'>
			{renderHeader(definition, isDirty, handleReload, isLocked)}
			{renderNetworkingDisclaimer(definition)}
			{isLoading ? (
				<div className='flex items-center gap-2 text-sm text-muted-foreground'>
					<Loader className='size-4 animate-spin' />
					<span>Loading file contents...</span>
				</div>
			) : (
				<Textarea
					className='min-h-120 font-mono text-sm'
					value={content}
					onChange={(event) => {
						setContent(event.target.value);
						setError(null);
					}}
					disabled={isLocked}
					spellCheck={false}
				/>
			)}
			{error && <p className='text-sm text-destructive'>{error}</p>}
		</div>
	);
};

const ServerPropertiesFileEditor: React.FC<ServerConfigFileEditorProps> = ({
	serverDirectory,
	definition,
	disabled,
	onSaved,
}) => {
	const [values, setValues] = React.useState<PropertyValues>({});
	const [originalValues, setOriginalValues] = React.useState<PropertyValues>({});
	const [sourceValues, setSourceValues] = React.useState<Map<string, string>>(new Map());
	const [isLoading, setIsLoading] = React.useState(true);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const isDirty = React.useMemo(
		() =>
			definition.featuredProperties.some(
				(property) => values[property.key] !== originalValues[property.key],
			),
		[definition.featuredProperties, originalValues, values],
	);
	const toastId = React.useMemo(
		() => `managed-config-${serverDirectory}-${definition.fileName}`,
		[definition.fileName, serverDirectory],
	);

	const loadContent = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await invoke<ManagedConfigFileReadResult>('read_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
				} as ManagedConfigFileReadPayload,
			});

			const parsedValues = parsePropertiesMap(result.content);
			const nextValues = createPropertyValues(
				definition.featuredProperties,
				Object.fromEntries(parsedValues.entries()),
			);
			setSourceValues(parsedValues);
			setValues(nextValues);
			setOriginalValues(nextValues);
		} catch (err) {
			setError(toErrorMessage(err, `Could not load ${definition.fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [definition.featuredProperties, definition.fileName, serverDirectory]);

	React.useEffect(() => {
		void loadContent();
	}, [loadContent]);

	const handleReset = React.useCallback(() => {
		setValues(originalValues);
		setError(null);
	}, [originalValues]);

	const handleReload = React.useCallback(async () => {
		await loadContent();
	}, [loadContent]);

	const handleSave = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			const nextValues = new Map(sourceValues);

			for (const property of definition.featuredProperties) {
				const currentValue = values[property.key]?.trim() ?? '';

				if (property.type === 'number') {
					nextValues.set(property.key, parsePropertyNumber(property, currentValue));
					continue;
				}

				if (property.type === 'boolean') {
					nextValues.set(property.key, currentValue.toLowerCase() === 'true' ? 'true' : 'false');
					continue;
				}

				if (property.type === 'enum') {
					if (!property.options?.some((option) => option.value === currentValue)) {
						throw new Error(`${property.label} must be one of the supported options.`);
					}
					nextValues.set(property.key, currentValue);
					continue;
				}

				if (property.type === 'string') {
					nextValues.set(property.key, values[property.key] ?? '');
					continue;
				}
			}

			const normalizedContent = serializePropertiesMap(
				nextValues,
				definition.featuredProperties.map((property) => property.key),
			);

			const result = await invoke<ManagedConfigFileReadResult>('write_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
					content: normalizedContent,
				} as ManagedConfigFileWritePayload,
			});

			const parsedValues = parsePropertiesMap(result.content);
			const nextFeaturedValues = createPropertyValues(
				definition.featuredProperties,
				Object.fromEntries(parsedValues.entries()),
			);
			setSourceValues(parsedValues);
			setValues(nextFeaturedValues);
			setOriginalValues(nextFeaturedValues);
			toast.success(`${definition.title} saved.`);
			await onSaved?.();
		} catch (err) {
			setError(toErrorMessage(err, `Could not save ${definition.fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [
		definition.featuredProperties,
		definition.fileName,
		isLocked,
		onSaved,
		serverDirectory,
		sourceValues,
		values,
	]);

	useUnsavedChangesToast({
		toastId,
		isDirty,
		isLocked,
		isSaving,
		onReset: handleReset,
		onSave: handleSave,
	});

	return (
		<div className='space-y-8'>
			{renderHeader(definition, isDirty, handleReload, isLocked)}
			{renderNetworkingDisclaimer(definition)}
			{definition.featuredProperties.map((property) => (
				<PropertyField
					key={property.key}
					property={property}
					value={values[property.key] ?? ''}
					onChange={(nextValue) => {
						setValues((prev) => ({ ...prev, [property.key]: nextValue }));
						setError(null);
					}}
					disabled={isLocked}
				/>
			))}
			{error && <p className='text-sm text-destructive'>{error}</p>}
		</div>
	);
};

const VelocityTomlEditor: React.FC<ServerConfigFileEditorProps> = ({
	serverDirectory,
	definition,
	disabled,
	onSaved,
}) => {
	const [values, setValues] = React.useState<PropertyValues>({});
	const [originalValues, setOriginalValues] = React.useState<PropertyValues>({});
	const [root, setRoot] = React.useState<TomlRoot>({});
	const [isLoading, setIsLoading] = React.useState(true);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const isDirty = React.useMemo(
		() =>
			definition.featuredProperties.some(
				(property) => values[property.key] !== originalValues[property.key],
			),
		[definition.featuredProperties, originalValues, values],
	);
	const toastId = React.useMemo(
		() => `managed-config-${serverDirectory}-${definition.fileName}`,
		[definition.fileName, serverDirectory],
	);

	const loadContent = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await invoke<ManagedConfigFileReadResult>('read_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
				} as ManagedConfigFileReadPayload,
			});

			const parsedRoot = TOML.parse(result.content) as TomlRoot;
			const serversTable = isRecord(parsedRoot.servers) ? parsedRoot.servers : {};
			const serverEntries: TomlRoot = { ...serversTable };
			delete serverEntries.try;

			const nextValues: PropertyValues = {};
			for (const property of definition.featuredProperties) {
				if (property.key === 'servers') {
					nextValues[property.key] = JSON.stringify(serverEntries, null, 2);
					continue;
				}

				if (property.key === 'try') {
					nextValues[property.key] = Array.isArray(serversTable.try)
						? serversTable.try.map((entry) => String(entry)).join('\n')
						: defaultValueToString(property.defaultValue);
					continue;
				}

				nextValues[property.key] = createPropertyValues([property], {
					[property.key]: parsedRoot[property.key],
				})[property.key];
			}

			setRoot(parsedRoot);
			setValues(nextValues);
			setOriginalValues(nextValues);
		} catch (err) {
			setError(toErrorMessage(err, `Could not load ${definition.fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [definition.featuredProperties, definition.fileName, serverDirectory]);

	React.useEffect(() => {
		void loadContent();
	}, [loadContent]);

	const handleReset = React.useCallback(() => {
		setValues(originalValues);
		setError(null);
	}, [originalValues]);

	const handleReload = React.useCallback(async () => {
		await loadContent();
	}, [loadContent]);

	const parseJsonTextarea = (property: ManagedConfigPropertyDefinition, input: string) => {
		const trimmed = input.trim();
		if (!trimmed) return {};

		const parsed = JSON.parse(trimmed);
		if (!isRecord(parsed)) {
			throw new Error(`${property.label} must be a JSON object.`);
		}

		return parsed;
	};

	const parseListTextarea = (input: string) =>
		input
			.split(/\r?\n/)
			.map((entry) => entry.trim())
			.filter(Boolean);

	const handleSave = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			const nextRoot: TomlRoot = { ...root };
			const nextServers = isRecord(nextRoot.servers) ? { ...nextRoot.servers } : {};

			for (const property of definition.featuredProperties) {
				const currentValue = values[property.key]?.trim() ?? '';

				if (property.type === 'number') {
					nextRoot[property.key] = Number.parseInt(parsePropertyNumber(property, currentValue), 10);
					continue;
				}

				if (property.type === 'boolean') {
					nextRoot[property.key] = currentValue.toLowerCase() === 'true';
					continue;
				}

				if (property.type === 'enum') {
					if (!property.options?.some((option) => option.value === currentValue)) {
						throw new Error(`${property.label} must be one of the supported options.`);
					}
					nextRoot[property.key] = currentValue;
					continue;
				}

				if (property.key === 'servers') {
					Object.assign(nextServers, parseJsonTextarea(property, currentValue));
					continue;
				}

				if (property.key === 'try') {
					nextServers.try = parseListTextarea(currentValue);
					continue;
				}

				nextRoot[property.key] = values[property.key] ?? '';
			}

			nextRoot.servers = nextServers;
			const normalizedContent = `${TOML.stringify(nextRoot as TOML.JsonMap).trimEnd()}\n`;
			const result = await invoke<ManagedConfigFileReadResult>('write_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
					content: normalizedContent,
				} as ManagedConfigFileWritePayload,
			});

			const parsedRoot = TOML.parse(result.content) as TomlRoot;
			const serversTable = isRecord(parsedRoot.servers) ? parsedRoot.servers : {};
			const serverEntries: TomlRoot = { ...serversTable };
			delete serverEntries.try;
			const nextValues: PropertyValues = {};
			for (const property of definition.featuredProperties) {
				if (property.key === 'servers') {
					nextValues[property.key] = JSON.stringify(serverEntries, null, 2);
					continue;
				}
				if (property.key === 'try') {
					nextValues[property.key] = Array.isArray(serversTable.try)
						? serversTable.try.map((entry) => String(entry)).join('\n')
						: '';
					continue;
				}
				nextValues[property.key] = createPropertyValues([property], {
					[property.key]: parsedRoot[property.key],
				})[property.key];
			}

			setRoot(parsedRoot);
			setValues(nextValues);
			setOriginalValues(nextValues);
			toast.success(`${definition.title} saved.`);
			await onSaved?.();
		} catch (err) {
			setError(toErrorMessage(err, `Could not save ${definition.fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [definition.featuredProperties, definition.fileName, isLocked, onSaved, root, serverDirectory, values]);

	useUnsavedChangesToast({
		toastId,
		isDirty,
		isLocked,
		isSaving,
		onReset: handleReset,
		onSave: handleSave,
	});

	return (
		<div className='space-y-8'>
			{renderHeader(definition, isDirty, handleReload, isLocked)}
			{renderNetworkingDisclaimer(definition)}
			{definition.featuredProperties.map((property) => (
				<PropertyField
					key={property.key}
					property={property}
					value={values[property.key] ?? ''}
					onChange={(nextValue) => {
						setValues((prev) => ({ ...prev, [property.key]: nextValue }));
						setError(null);
					}}
					disabled={isLocked}
				/>
			))}
			{error && <p className='text-sm text-destructive'>{error}</p>}
		</div>
	);
};

export default function ServerConfigFileEditor(props: ServerConfigFileEditorProps) {
	if (props.definition.kind === 'server-properties') {
		return <ServerPropertiesFileEditor {...props} />;
	}

	if (props.definition.kind === 'velocity-toml') {
		return <VelocityTomlEditor {...props} />;
	}

	return <PlainTextConfigFileEditor {...props} />;
}
