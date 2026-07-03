import React from 'react';
import {
	CircleAlert,
	CircleCheck,
	Info,
	Loader2,
	ShieldCheck,
	TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { Skeleton } from '@/components/ui/skeleton';
import ModrinthProjectIcon from '@/components/modrinth/modrinth-project-icon';
import { formatCompactCount } from '@/lib/modrinth-service';
import {
	SEVERITY_ORDER,
	summarizeSecurityFindings,
	type SecurityFinding,
	type SecuritySeverity,
} from '@/lib/server-security-audit';
import { isStoppedStatus, type Server } from '@/data/servers';
import { useSecurityAudit } from './use-security-audit';
import { useAntiBotCatalog } from './use-antibot-catalog';

type Props = { server: Server; onContentChanged?: () => void | Promise<void> };

const SEVERITY_META: Record<
	SecuritySeverity,
	{ icon: React.ElementType; className: string; label: string }
> = {
	critical: { icon: CircleAlert, className: 'text-destructive', label: 'Critical' },
	warn: { icon: TriangleAlert, className: 'text-amber-500', label: 'Warning' },
	info: { icon: Info, className: 'text-sky-500', label: 'Suggestion' },
	pass: { icon: CircleCheck, className: 'text-emerald-500', label: 'OK' },
};

const FindingRow: React.FC<{
	finding: SecurityFinding;
	canFix: boolean;
	isApplying: boolean;
	onFix: (finding: SecurityFinding) => void;
}> = ({ finding, canFix, isApplying, onFix }) => {
	const meta = SEVERITY_META[finding.severity];
	const Icon = meta.icon;
	const hasPropertyFix = finding.fix?.kind === 'properties';

	return (
		<div className='flex items-start gap-3 py-3'>
			<Icon className={`mt-0.5 size-5 shrink-0 ${meta.className}`} />
			<div className='min-w-0 flex-1 space-y-1'>
				<p className='font-medium'>{finding.title}</p>
				<p className='text-sm text-muted-foreground'>{finding.explanation}</p>
			</div>
			{hasPropertyFix && (
				<Button
					size='sm'
					variant='secondary'
					className='shrink-0'
					disabled={!canFix || isApplying}
					title={canFix ? undefined : 'Stop the server to change server.properties.'}
					onClick={() => onFix(finding)}>
					Fix
				</Button>
			)}
		</div>
	);
};

const SecuritySettingsSection: React.FC<Props> = ({ server, onContentChanged }) => {
	const { findings, isLoading, isApplying, applyPropertyUpdates, applyAllRecommended, refresh } =
		useSecurityAudit(server);
	const antiBot = useAntiBotCatalog(server);

	// server.properties is read at boot, so fixes only make sense while stopped.
	const canFix = isStoppedStatus(server.status);
	const counts = summarizeSecurityFindings(findings);

	const sorted = React.useMemo(
		() => [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
		[findings],
	);

	const hasRecommendedFixes = findings.some((finding) => finding.fix?.kind === 'properties');

	const handleFix = (finding: SecurityFinding) => {
		if (finding.fix?.kind === 'properties') {
			void applyPropertyUpdates(finding.fix.updates, `Applied fix: ${finding.title}.`);
		}
	};

	return (
		<div className='space-y-8 p-1'>
			<div className='space-y-2 max-w-2xl'>
				<div className='flex items-center gap-2'>
					<ShieldCheck className='size-6 text-primary' />
					<p className='text-xl font-semibold'>Security</p>
				</div>
				<p className='text-sm text-muted-foreground'>
					A quick audit of this server’s exposure and bot-attack surface, with one-click hardening.
					{!canFix && ' Stop the server to apply property changes.'}
				</p>
				{!isLoading && (
					<div className='flex flex-wrap gap-3 text-sm'>
						<span className='text-destructive'>{counts.critical} critical</span>
						<span className='text-amber-500'>{counts.warn} warnings</span>
						<span className='text-sky-500'>{counts.info} suggestions</span>
						<span className='text-emerald-500'>{counts.pass} passing</span>
					</div>
				)}
			</div>

			<Container className='divide-y divide-border'>
				{isLoading ? (
					<div className='space-y-3 py-2'>
						<Skeleton className='h-6 w-2/3' />
						<Skeleton className='h-6 w-1/2' />
						<Skeleton className='h-6 w-3/5' />
					</div>
				) : (
					sorted.map((finding) => (
						<FindingRow
							key={finding.id}
							finding={finding}
							canFix={canFix}
							isApplying={isApplying}
							onFix={handleFix}
						/>
					))
				)}
			</Container>

			{hasRecommendedFixes && (
				<Button disabled={!canFix || isApplying} onClick={() => void applyAllRecommended()}>
					{isApplying && <Loader2 className='size-4 animate-spin' />}
					Apply all recommended fixes
				</Button>
			)}

			<div className='space-y-3 max-w-2xl'>
				<div className='space-y-1'>
					<p className='text-lg font-semibold'>Anti-bot plugins</p>
					<p className='text-sm text-muted-foreground'>
						Proven, actively-maintained plugins that stop bot floods and verify real players.
						Installed from Modrinth for this server’s version.
					</p>
				</div>

				{antiBot.isLoading ? (
					<div className='space-y-2'>
						<Skeleton className='h-16 w-full' />
						<Skeleton className='h-16 w-full' />
					</div>
				) : antiBot.resolved.length === 0 ? (
					<p className='text-sm text-muted-foreground'>
						No compatible anti-bot plugin was found for this server’s loader and version.
					</p>
				) : (
					antiBot.resolved.map((entry) => (
						<Container key={entry.slug} className='flex items-center gap-3'>
							<ModrinthProjectIcon
								iconUrl={entry.project.iconUrl}
								title={entry.project.title}
								className='size-12'
							/>
							<div className='min-w-0 flex-1 space-y-0.5'>
								<p className='font-medium'>{entry.project.title}</p>
								<p className='truncate text-sm text-muted-foreground'>{entry.note}</p>
								<p className='text-xs text-muted-foreground'>
									{formatCompactCount(entry.project.downloads)} downloads
								</p>
							</div>
							<Button
								size='sm'
								className='shrink-0'
								disabled={antiBot.installingSlug !== null}
								onClick={() => void antiBot.install(entry, onContentChanged ?? refresh)}>
								{antiBot.installingSlug === entry.slug && (
									<Loader2 className='size-4 animate-spin' />
								)}
								Install
							</Button>
						</Container>
					))
				)}
			</div>
		</div>
	);
};

export default SecuritySettingsSection;
