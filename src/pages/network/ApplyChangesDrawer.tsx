import React from 'react';
import { toast } from 'sonner';
import { CheckCircle2, FileCog, Loader2, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';

import type { Server } from '@/data/servers';
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import {
	applyNetworkPlan,
	planNetworkApply,
	type NetworkApplyPlan,
	type NetworkFileChange,
} from '@/lib/network-config-engine';
import type { ManagedNetwork } from '@/lib/network-schema';

interface ApplyChangesDrawerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	network: ManagedNetwork;
	servers: Server[];
	onApplied: () => void;
}

const FileChangeCard: React.FC<{ change: NetworkFileChange }> = ({ change }) => (
	<div className='rounded-xl border bg-card p-3'>
		<div className='flex items-center gap-2'>
			<FileCog className='size-4 text-primary' />
			<span className='font-mono text-sm font-semibold'>{change.label}</span>
			{change.before === null && (
				<span className='rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400'>
					new
				</span>
			)}
		</div>

		<ul className='mt-2 space-y-0.5'>
			{change.summary.map((line, index) => (
				<li key={index} className='font-mono text-xs text-muted-foreground'>
					{line}
				</li>
			))}
		</ul>

		<details className='mt-2'>
			<summary className='cursor-pointer text-[11px] text-muted-foreground hover:text-foreground'>
				View file contents
			</summary>
			<div className='mt-2 grid gap-2 md:grid-cols-2'>
				<div>
					<p className='mb-1 text-[10px] font-bold uppercase text-muted-foreground'>Before</p>
					<pre className='max-h-48 overflow-auto rounded-lg border bg-muted/40 p-2 text-[11px] leading-snug'>
						{change.before ?? '(file does not exist yet)'}
					</pre>
				</div>
				<div>
					<p className='mb-1 text-[10px] font-bold uppercase text-muted-foreground'>After</p>
					<pre className='max-h-48 overflow-auto rounded-lg border bg-muted/40 p-2 text-[11px] leading-snug'>
						{change.after}
					</pre>
				</div>
			</div>
		</details>
	</div>
);

export const ApplyChangesDrawer: React.FC<ApplyChangesDrawerProps> = ({
	open,
	onOpenChange,
	network,
	servers,
	onApplied,
}) => {
	const [plan, setPlan] = React.useState<NetworkApplyPlan | null>(null);
	const [loading, setLoading] = React.useState(false);
	const [applying, setApplying] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (!open) return;
		let active = true;
		setLoading(true);
		setError(null);
		setPlan(null);

		void (async () => {
			try {
				const result = await planNetworkApply(network, servers);
				if (active) setPlan(result);
			} catch (caught) {
				if (active) setError(caught instanceof Error ? caught.message : 'Failed to compute changes.');
			} finally {
				if (active) setLoading(false);
			}
		})();

		return () => {
			active = false;
		};
	}, [open, network, servers]);

	const grouped = React.useMemo(() => {
		const map = new Map<string, { serverName: string; changes: NetworkFileChange[] }>();
		for (const change of plan?.changes ?? []) {
			const entry = map.get(change.serverId) ?? { serverName: change.serverName, changes: [] };
			entry.changes.push(change);
			map.set(change.serverId, entry);
		}
		return Array.from(map.values());
	}, [plan]);

	const handleApply = async () => {
		if (!plan) return;
		setApplying(true);
		try {
			await applyNetworkPlan(plan);
			toast.success('Network configuration applied.');
			onApplied();
			onOpenChange(false);
		} catch (caught) {
			toast.error(caught instanceof Error ? caught.message : 'Failed to apply changes.');
		} finally {
			setApplying(false);
		}
	};

	const changeCount = plan?.changes.length ?? 0;

	return (
		<Drawer open={open} onOpenChange={onOpenChange} direction='right'>
			<DrawerContent className='!max-w-2xl'>
				<DrawerHeader>
					<DrawerTitle>Review network changes</DrawerTitle>
					<DrawerDescription>
						These edits will be written to your server config files. Nothing is changed until you apply.
					</DrawerDescription>
				</DrawerHeader>

				<div className='flex-1 overflow-y-auto px-4 pb-4'>
					{loading && (
						<div className='flex items-center gap-2 p-6 text-sm text-muted-foreground'>
							<Loader2 className='size-4 animate-spin' /> Computing changes…
						</div>
					)}

					{error && (
						<div className='flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive'>
							<TriangleAlert className='mt-0.5 size-4 shrink-0' />
							<span>{error}</span>
						</div>
					)}

					{!loading && !error && changeCount === 0 && (
						<div className='flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400'>
							<CheckCircle2 className='size-4' /> Everything is already in sync — no changes needed.
						</div>
					)}

					{!loading &&
						!error &&
						grouped.map((group) => (
							<div key={group.serverName} className='mb-4'>
								<p className='mb-2 text-sm font-bold'>{group.serverName}</p>
								<div className='flex flex-col gap-2'>
									{group.changes.map((change) => (
										<FileChangeCard key={`${change.serverId}-${change.target}`} change={change} />
									))}
								</div>
							</div>
						))}
				</div>

				<DrawerFooter className='flex-row justify-end gap-2'>
					<DrawerClose asChild>
						<Button variant='outline'>Cancel</Button>
					</DrawerClose>
					<Button
						onClick={handleApply}
						disabled={loading || applying || !!error || changeCount === 0}
						className={clsx(applying && 'pointer-events-none')}>
						{applying ? <Loader2 className='size-4 animate-spin' /> : null}
						Apply {changeCount > 0 ? `(${changeCount})` : ''}
					</Button>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
};
