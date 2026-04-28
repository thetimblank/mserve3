import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const containerVariants = cva('p-6 rounded-lg', {
	variants: {
		variant: {
			primary: 'border-2 dark:bg-secondary/50 dark:border-none',
			secondary: 'dark:bg-secondary/50 dark:border-none',
			destructive: 'border-2 border-destructive/50 dark:border-none dark:bg-destructive/10',
		},
	},
	defaultVariants: {
		variant: 'primary',
	},
});

type ContainerProps = React.HTMLAttributes<HTMLDivElement> &
	VariantProps<typeof containerVariants> & {
		asChild?: boolean;
	};

const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
	({ className, variant = 'primary', asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : 'div';

		return (
			<Comp
				ref={ref}
				data-slot='container'
				data-variant={variant}
				className={cn(containerVariants({ variant }), className)}
				{...props}
			/>
		);
	},
);

Container.displayName = 'Container';

export { Container, containerVariants };
