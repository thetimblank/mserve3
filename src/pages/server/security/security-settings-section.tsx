import React from 'react';
import {
	CircleAlert,
	CircleCheck,
	Info,
	Loader2,
	TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { Skeleton } from '@/components/ui/skeleton';
import {
	SEVERITY_ORDER,
	summarizeSecurityFindings,
	type SecurityFinding,
	type SecuritySeverity,
} from '@/lib/server-security-audit';
import { isStoppedStatus, type Server } from '@/data/servers';
import { useSecurityAudit } from './use-security-audit';
import SecurityPluginGuide from './security-plugin-guide';

type Props = { server: Server };

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

const SecuritySettingsSection: React.FC<Props> = ({ server }) => {
	const { findings, isLoading, isApplying, applyPropertyUpdates, applyAllRecommended } =
		useSecurityAudit(server);

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
		<div className='space-y-8'>
			<div className='space-y-2'>
				{!canFix && (
					<p className='text-sm text-muted-foreground'>Stop the server to apply property changes.</p>
				)}
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

			<SecurityPluginGuide server={server} />
		</div>
	);
};

export default SecuritySettingsSection;
