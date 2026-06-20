import * as React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {
	chooseBestInstalledJava,
	isJavaCompatible,
	resolveJavaRequirement,
} from '@/lib/java-compatibility';
import {
	findJavaRuntimeByExecutablePath,
	resolveJavaRuntimeForRequirement,
	type JavaRuntimeInfo,
} from '@/lib/java-runtime-service';

// Radix Select reserves the empty string, so the "automatic" choice uses a
// sentinel that maps back to '' (meaning: defer to the global Java default).
const AUTO_VALUE = '__auto__';
const CUSTOM_VALUE = '__custom__';

type JavaRuntimeSelectProps = {
	provider: { name: string; minecraft_version: string };
	javaRuntimes: JavaRuntimeInfo[];
	/** The server's java_installation override; '' means automatic. */
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	id?: string;
};

type CompatibilityTone = 'recommended' | 'compatible' | 'incompatible';

const CompatibilityTag: React.FC<{ tone: CompatibilityTone }> = ({ tone }) => {
	const compatible = tone !== 'incompatible';
	return (
		<span
			className={cn(
				'inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-xs',
				compatible
					? 'bg-green-600/10 text-green-600 dark:bg-green-900/50 dark:text-green-400'
					: 'bg-destructive/15 text-destructive',
			)}>
			{compatible ? <Check className='size-3' /> : <X className='size-3' />}
			{tone === 'recommended' ? 'Recommended' : tone === 'compatible' ? 'Compatible' : 'Too old'}
		</span>
	);
};

const JavaRuntimeSelect: React.FC<JavaRuntimeSelectProps> = ({
	provider,
	javaRuntimes,
	value,
	onChange,
	disabled,
	id,
}) => {
	const requirement = React.useMemo(
		() => resolveJavaRequirement(provider.name, provider.minecraft_version),
		[provider.name, provider.minecraft_version],
	);

	const recommendedMajor = React.useMemo(
		() => chooseBestInstalledJava(javaRuntimes.map((runtime) => runtime.majorVersion), requirement),
		[javaRuntimes, requirement],
	);

	const autoRuntime = React.useMemo(
		() => resolveJavaRuntimeForRequirement(javaRuntimes, requirement),
		[javaRuntimes, requirement],
	);

	const trimmed = value.trim();
	const matchedRuntime = React.useMemo(
		() => findJavaRuntimeByExecutablePath(trimmed, javaRuntimes),
		[javaRuntimes, trimmed],
	);

	const selectValue = trimmed === '' ? AUTO_VALUE : matchedRuntime ? matchedRuntime.executablePath : CUSTOM_VALUE;

	const handleValueChange = (next: string) => {
		if (next === CUSTOM_VALUE) return;
		onChange(next === AUTO_VALUE ? '' : next);
	};

	const toneFor = (runtime: JavaRuntimeInfo): CompatibilityTone => {
		if (!isJavaCompatible(runtime.majorVersion, requirement)) return 'incompatible';
		return runtime.majorVersion === recommendedMajor ? 'recommended' : 'compatible';
	};

	return (
		<Select value={selectValue} onValueChange={handleValueChange} disabled={disabled}>
			<SelectTrigger id={id} className='w-full max-w-lg'>
				<SelectValue placeholder='Select a Java runtime' />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={AUTO_VALUE}>
					<span className='flex items-center gap-2'>
						<span>Automatic</span>
						<span className='text-xs text-muted-foreground'>
							{autoRuntime
								? `Recommended · Java ${autoRuntime.majorVersion}`
								: `Needs Java ${requirement.recommendedMajor}`}
						</span>
					</span>
				</SelectItem>

				{javaRuntimes.map((runtime) => (
					<SelectItem key={runtime.executablePath} value={runtime.executablePath}>
						<span className='flex items-center gap-2'>
							<span>
								Java {runtime.majorVersion}
								{runtime.vendor ? ` · ${runtime.vendor}` : ''}
							</span>
							<CompatibilityTag tone={toneFor(runtime)} />
						</span>
					</SelectItem>
				))}

				{selectValue === CUSTOM_VALUE && (
					<SelectItem value={CUSTOM_VALUE}>
						<span className='flex items-center gap-2'>
							<span>Custom path</span>
							<span className='max-w-60 truncate font-mono text-xs text-muted-foreground'>
								{trimmed}
							</span>
						</span>
					</SelectItem>
				)}
			</SelectContent>
		</Select>
	);
};

export default JavaRuntimeSelect;
