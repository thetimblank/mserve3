/**
 * A titled telemetry timeline card for the Statistics page: a gradient area (or
 * stepped area) chart with formatted axes and a themed tooltip, built on the
 * shadcn `ChartContainer`. Shows an empty state when there is no data yet.
 */
import React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

import { formatAxisTime, formatTooltipTime, type ChartPoint } from './stats-utils';

type Props = {
	title: string;
	icon?: React.ReactNode;
	/** Small value shown to the right of the title (e.g. current reading). */
	badge?: React.ReactNode;
	config: ChartConfig;
	data: ChartPoint[];
	dataKey: keyof ChartPoint;
	color: string;
	rangeMs: number;
	valueFormatter: (value: number) => string;
	yDomain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
	yTicks?: number[];
	stepped?: boolean;
	className?: string;
};

const TelemetryAreaChart: React.FC<Props> = ({
	title,
	icon,
	badge,
	config,
	data,
	dataKey,
	color,
	rangeMs,
	valueFormatter,
	yDomain = ['auto', 'auto'],
	yTicks,
	stepped = false,
	className,
}) => {
	const gradientId = React.useId().replace(/:/g, '');
	const key = dataKey as string;
	const hasData = data.some((point) => point[dataKey] != null);

	return (
		<Card className={cn('gap-3 py-5', className)}>
			<CardHeader className='px-5'>
				<CardTitle className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
					{icon}
					<span>{title}</span>
					{badge != null && (
						<span className='ml-auto font-mono text-base font-semibold tabular-nums text-foreground'>
							{badge}
						</span>
					)}
				</CardTitle>
			</CardHeader>
			<CardContent className='px-2'>
				{hasData ? (
					<ChartContainer config={config} className='aspect-auto h-[180px] w-full'>
						<AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
							<defs>
								<linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
									<stop offset='5%' stopColor={color} stopOpacity={0.4} />
									<stop offset='95%' stopColor={color} stopOpacity={0.04} />
								</linearGradient>
							</defs>
							<CartesianGrid vertical={false} />
							<XAxis
								dataKey='timestamp'
								type='number'
								scale='time'
								domain={['dataMin', 'dataMax']}
								tickLine={false}
								axisLine={false}
								tickMargin={8}
								minTickGap={32}
								tickFormatter={(value: number) => formatAxisTime(value, rangeMs)}
							/>
							<YAxis
								width={44}
								domain={yDomain}
								ticks={yTicks}
								tickLine={false}
								axisLine={false}
								tickMargin={4}
								tickFormatter={(value: number) => valueFormatter(value)}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										labelFormatter={(_label, payload) => {
											const ts = payload?.[0]?.payload?.timestamp as number | undefined;
											return ts != null ? formatTooltipTime(ts) : '';
										}}
										formatter={(value) => valueFormatter(Number(value))}
									/>
								}
							/>
							<Area
								type={stepped ? 'stepAfter' : 'monotone'}
								dataKey={key}
								stroke={color}
								strokeWidth={2}
								fill={`url(#${gradientId})`}
								connectNulls
								isAnimationActive={false}
								dot={false}
							/>
						</AreaChart>
					</ChartContainer>
				) : (
					<div className='flex h-[180px] items-center justify-center text-sm text-muted-foreground'>
						No data for this range yet.
					</div>
				)}
			</CardContent>
		</Card>
	);
};

export default React.memo(TelemetryAreaChart);
