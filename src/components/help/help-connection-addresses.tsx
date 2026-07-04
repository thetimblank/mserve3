/**
 * Live local/public IP rows embedded in the "connecting" help topic — each
 * blurred until revealed and copyable, mirroring the connect-card idiom in
 * {@link file://../../pages/server/server-overview-panel.tsx}.
 */
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Clipboard, ClipboardCheck, Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const AddressRow: React.FC<{ label: string; value: string | null }> = ({ label, value }) => {
	const [hidden, setHidden] = React.useState(true);
	const [copied, setCopied] = React.useState(false);

	const copy = React.useCallback(() => {
		if (value == null) return;
		navigator.clipboard.writeText(value).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}, [value]);

	return (
		<div className='flex items-center gap-2 rounded-md bg-secondary/50 px-3 py-1.5 text-sm'>
			<span className='w-12 shrink-0 select-none text-left text-muted-foreground'>{label}</span>
			<span className='flex-1 truncate text-left font-mono'>
				{value == null ? (
					<span className='select-none text-muted-foreground'>Loading…</span>
				) : hidden ? (
					<span className='select-none blur-sm'>XXX.XXX.X.X</span>
				) : (
					value
				)}
			</span>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant='ghost'
						size='sm'
						className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
						onClick={() => setHidden((h) => !h)}>
						{hidden ? <Eye className='size-3.5' /> : <EyeOff className='size-3.5' />}
					</Button>
				</TooltipTrigger>
				<TooltipContent>{hidden ? 'Show' : 'Hide'}</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant='ghost'
						size='sm'
						className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
						disabled={value == null}
						onClick={copy}>
						{copied ? <ClipboardCheck className='size-3.5' /> : <Clipboard className='size-3.5' />}
					</Button>
				</TooltipTrigger>
				<TooltipContent>{copied ? 'Copied' : 'Copy'}</TooltipContent>
			</Tooltip>
		</div>
	);
};

export const ConnectionAddresses: React.FC = () => {
	const [localIp, setLocalIp] = React.useState<string | null>(null);
	const [publicIp, setPublicIp] = React.useState<string | null>(null);

	React.useEffect(() => {
		let active = true;
		invoke<string>('get_local_ip')
			.then((ip) => {
				if (active) setLocalIp(ip);
			})
			.catch(() => {});
		invoke<string>('get_public_ip')
			.then((ip) => {
				if (active) setPublicIp(ip);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);

	return (
		<div className='flex w-full flex-col gap-2'>
			<AddressRow label='Local' value={localIp} />
			<AddressRow label='Public' value={publicIp} />
		</div>
	);
};
