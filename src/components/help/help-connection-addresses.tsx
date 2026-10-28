/**
 * Live local/public IP rows embedded in the "connecting" help topic — each
 * blurred until revealed and copyable, mirroring the connect-card idiom in
 * {@link file://../../pages/server/server-overview-panel.tsx}.
 */
import React from 'react';
import { Clipboard, ClipboardCheck, Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useLocalIp, usePublicIp, type IpAddressValue } from '@/hooks/use-ip-address';

const AddressRow: React.FC<{ label: string; value: IpAddressValue }> = ({ label, value }) => {
	const [hidden, setHidden] = React.useState(true);
	const { copied, copy } = useCopyToClipboard();

	return (
		<div className='flex items-center gap-2 rounded-md bg-secondary/50 px-3 py-1.5 text-sm'>
			<span className='w-12 shrink-0 select-none text-left text-muted-foreground'>{label}</span>
			<span className='flex-1 truncate text-left font-mono'>
				{value === null ? (
					<span className='select-none text-muted-foreground'>Loading…</span>
				) : value === false ? (
					<span className='select-none text-muted-foreground'>Unavailable</span>
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
						disabled={!value}
						onClick={() => copy(value)}>
						{copied ? <ClipboardCheck className='size-3.5' /> : <Clipboard className='size-3.5' />}
					</Button>
				</TooltipTrigger>
				<TooltipContent>{copied ? 'Copied' : 'Copy'}</TooltipContent>
			</Tooltip>
		</div>
	);
};

export const ConnectionAddresses: React.FC = () => {
	const localIp = useLocalIp();
	const publicIp = usePublicIp();

	return (
		<div className='flex w-full flex-col gap-2'>
			<AddressRow label='Local' value={localIp} />
			<AddressRow label='Public' value={publicIp} />
		</div>
	);
};
