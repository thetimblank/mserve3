/**
 * Minimal gradient area sparkline for the overview metric cards. Pure
 * presentation: no axes, grid, tooltip or legend — just the recent trend.
 */
import React from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';

import type { ChartPoint } from './stats-utils';

type Props = {
	data: ChartPoint[];
	dataKey: keyof ChartPoint;
	color: string;
	/** Fixed YAxis domain, e.g. [0, 100] for percentages. */
	domain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
	className?: string;
};

const TelemetrySparkline: React.FC<Props> = ({ data, dataKey, color, domain = ['auto', 'auto'], className }) => {
	const gradientId = React.useId().replace(/:/g, '');

	const hasData = data.some((point) => point[dataKey] != null);
	if (!hasData) {
		return <div className={className} aria-hidden />;
	}

	return (
		<div className={className}>
			<ResponsiveContainer width='100%' height='100%'>
				<AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
					<defs>
						<linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
							<stop offset='0%' stopColor={color} stopOpacity={0.35} />
							<stop offset='100%' stopColor={color} stopOpacity={0} />
						</linearGradient>
					</defs>
					<YAxis hide domain={domain} />
					<Area
						type='monotone'
						dataKey={dataKey as string}
						stroke={color}
						strokeWidth={1.75}
						fill={`url(#${gradientId})`}
						isAnimationActive={false}
						connectNulls
						dot={false}
					/>
				</AreaChart>
			</ResponsiveContainer>
		</div>
	);
};

export default React.memo(TelemetrySparkline);
