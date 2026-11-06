import * as React from 'react';
import { ChevronLeft, Laptop } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Illustrated (not real, not a vendor screenshot) port forward forms for the
 * hosting guide's router slide. They show which fields a router asks for,
 * prefilled with this PC's values.
 */
type MockFormProps = {
	port: number;
	/** This PC's local IP, or a placeholder while it loads. */
	localIp: string;
	/** What the browser's address bar shows (the detected router address). */
	routerAddress?: string;
};

const MockValue: React.FC<{ label: string; value: string; mono?: boolean; className?: string }> = ({
	label,
	value,
	mono,
	className,
}) => (
	<div className={cn('flex flex-col gap-1', className)}>
		<span className='text-[11px] font-medium text-muted-foreground'>{label}</span>
		<span
			className={cn(
				'flex h-8 items-center rounded-md border bg-background px-2 text-xs',
				mono && 'font-mono',
			)}>
			{value}
		</span>
	</div>
);

const MockCaption: React.FC = () => (
	<figcaption className='mt-2 text-center text-xs text-muted-foreground'>
		Example only. Your router&apos;s screen looks different, but asks for the same things.
	</figcaption>
);

/** A router admin page in a browser window. */
export const WebsitePanelMock: React.FC<MockFormProps> = ({ port, localIp, routerAddress }) => (
	<figure className='w-full'>
		<div
			role='img'
			aria-label={`Example router page: a port forwarding rule named Minecraft, external and internal port ${port}, protocol TCP, sent to ${localIp}.`}
			className='overflow-hidden rounded-xl border bg-card shadow-sm'>
			<div aria-hidden className='flex items-center gap-2 border-b bg-secondary/60 px-3 py-2'>
				<span className='flex gap-1'>
					<span className='size-2.5 rounded-full bg-muted-foreground/30' />
					<span className='size-2.5 rounded-full bg-muted-foreground/30' />
					<span className='size-2.5 rounded-full bg-muted-foreground/30' />
				</span>
				<span className='flex-1 truncate rounded-md bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground'>
					http://{routerAddress ?? '192.168.1.1'}
				</span>
			</div>
			<div aria-hidden className='flex text-left'>
				<div className='hidden w-32 shrink-0 flex-col gap-1 border-r bg-secondary/30 p-2 text-xs text-muted-foreground sm:flex'>
					<span className='px-2 py-1'>Status</span>
					<span className='px-2 py-1'>Wireless</span>
					<span className='px-2 py-1'>Advanced</span>
					<span className='rounded-md bg-primary/15 px-2 py-1 font-medium text-foreground'>
						Port Forwarding
					</span>
				</div>
				<div className='flex-1 space-y-3 p-3'>
					<p className='text-sm font-semibold'>Add port forwarding rule</p>
					<div className='grid grid-cols-2 gap-2'>
						<MockValue label='Service name' value='Minecraft' className='col-span-2 sm:col-span-1' />
						<MockValue label='Protocol' value='TCP' className='col-span-2 sm:col-span-1' />
						<MockValue label='External port' value={String(port)} mono />
						<MockValue label='Internal port' value={String(port)} mono />
						<MockValue label='Device / internal IP' value={localIp} mono className='col-span-2' />
					</div>
					<div className='flex justify-end'>
						<span className='rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'>
							Save
						</span>
					</div>
				</div>
			</div>
		</div>
		<MockCaption />
	</figure>
);

const AppRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
	<div className='flex items-center justify-between gap-3 border-b px-3 py-2 text-xs last:border-b-0'>
		<span className='text-muted-foreground'>{label}</span>
		<span className={cn('font-medium', mono && 'font-mono')}>{value}</span>
	</div>
);

/** A router/ISP phone app (Xfinity, Google Home, Eero, Orbi, Deco style). */
export const AppMock: React.FC<MockFormProps> = ({ port, localIp }) => (
	<figure className='flex w-full flex-col items-center'>
		<div
			role='img'
			aria-label={`Example router app: a port forward for this PC (${localIp}) named Minecraft, port ${port}, protocol TCP.`}
			className='w-64 rounded-[2rem] border-4 border-secondary bg-card p-3 shadow-sm'>
			<div aria-hidden className='space-y-3 text-left'>
				<div className='mx-auto h-1.5 w-16 rounded-full bg-secondary' />
				<div className='flex items-center gap-1 text-sm font-semibold'>
					<ChevronLeft className='size-4 text-muted-foreground' />
					Port forwarding
				</div>
				<div className='flex items-center gap-2 rounded-xl bg-secondary/50 p-2'>
					<span className='flex size-8 items-center justify-center rounded-full bg-primary/15'>
						<Laptop className='size-4' />
					</span>
					<span className='min-w-0'>
						<span className='block text-xs font-medium'>This PC</span>
						<span className='block truncate font-mono text-[11px] text-muted-foreground'>{localIp}</span>
					</span>
				</div>
				<div className='overflow-hidden rounded-xl border'>
					<AppRow label='Name' value='Minecraft' />
					<AppRow label='Port' value={String(port)} mono />
					<AppRow label='Protocol' value='TCP' />
				</div>
				<span className='block rounded-full bg-primary py-1.5 text-center text-xs font-medium text-primary-foreground'>
					Save
				</span>
			</div>
		</div>
		<MockCaption />
	</figure>
);
