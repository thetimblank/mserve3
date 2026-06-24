/**
 * Compact telemetry metric card for the server overview: an icon + label, a
 * large current value, and an optional gradient sparkline of the recent trend.
 * Falls back to a muted placeholder when the server is offline / value is null.
 */
import React from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import TelemetrySparkline from './telemetry-sparkline';
import type { ChartPoint } from './stats-utils';

type Props = {
	icon: React.ReactNode;
	label: string;
	/** Rendered current value, or null/undefined for the offline placeholder. */
	value: React.ReactNode;
	color: string;
	sparkData?: ChartPoint[];
	sparkKey?: keyof ChartPoint;
	sparkDomain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
	className?: string;
};

const MetricCard: React.FC<Props> = ({
	icon,
	label,
	value,
	color,
	sparkData,
	sparkKey,
	sparkDomain,
	className,
}) => {
	const hasValue = value != null && value !== '';

	return (
		<Card className={cn('relative gap-0 overflow-hidden py-0', className)}>
			<div className='flex flex-col gap-1 p-4 pb-1'>
				<div className='flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
					<span className='[&_svg]:size-3.5' style={{ color }}>
						{icon}
					</span>
					<span className='uppercase tracking-wide'>{label}</span>
				</div>
				<div
					className={cn(
						'text-2xl font-semibold tabular-nums',
						hasValue ? 'text-foreground' : 'text-muted-foreground/50',
					)}>
					{hasValue ? value : '—'}
				</div>
			</div>
			{sparkData && sparkKey && (
				<TelemetrySparkline
					data={sparkData}
					dataKey={sparkKey}
					color={color}
					domain={sparkDomain}
					className='h-10 w-full'
				/>
			)}
		</Card>
	);
};

export default React.memo(MetricCard);
