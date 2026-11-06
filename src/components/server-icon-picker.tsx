import * as React from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { PhysicalPosition } from '@tauri-apps/api/dpi';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { ImagePlus, ImageUp, Loader } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SERVER_ICON_EXTENSIONS } from '@/lib/server-icon';
import { cn } from '@/lib/utils';

/** Opens the native file picker for an icon image. Resolves to the path, or null when cancelled. */
export const pickServerIconPath = async (): Promise<string | null> => {
	const selected = await openDialog({
		directory: false,
		multiple: false,
		title: 'Choose a server icon',
		filters: [{ name: 'Images', extensions: [...SERVER_ICON_EXTENSIONS] }],
	});
	return typeof selected === 'string' ? selected : null;
};

type ServerIconPickerProps = {
	/** The current icon (`data:` URL), or null for the placeholder. */
	iconUrl: string | null;
	/** Called with the picked or dropped file's path. */
	onPickPath: (path: string) => void;
	disabled?: boolean;
	busy?: boolean;
	className?: string;
};

/**
 * A 64×64 icon tile, like the one in the multiplayer list. Click it to choose
 * an image or drop one on it.
 */
export const ServerIconPicker: React.FC<ServerIconPickerProps> = ({
	iconUrl,
	onPickPath,
	disabled = false,
	busy = false,
	className,
}) => {
	const tileRef = React.useRef<HTMLButtonElement | null>(null);
	const [isDragging, setIsDragging] = React.useState(false);
	const isInactive = disabled || busy;
	// Read from the drop listener, which is subscribed once.
	const latestRef = React.useRef({ isInactive, onPickPath });
	latestRef.current = { isInactive, onPickPath };

	// Tauri reports the drag position in physical pixels; the rect is in CSS pixels.
	const isOverTile = React.useCallback((position: PhysicalPosition) => {
		const element = tileRef.current;
		if (!element) return false;
		const { x, y } = position.toLogical(window.devicePixelRatio || 1);
		const rect = element.getBoundingClientRect();
		return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
	}, []);

	React.useEffect(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;

		void getCurrentWebview()
			.onDragDropEvent((event) => {
				const payload = event.payload;
				if (payload.type === 'over') {
					setIsDragging(!latestRef.current.isInactive && isOverTile(payload.position));
					return;
				}
				setIsDragging(false);
				if (payload.type !== 'drop' || latestRef.current.isInactive || !isOverTile(payload.position)) {
					return;
				}
				const [path] = payload.paths;
				if (path) latestRef.current.onPickPath(path);
			})
			.then((unlistenFn) => {
				if (disposed) unlistenFn();
				else unlisten = unlistenFn;
			})
			.catch(() => setIsDragging(false));

		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [isOverTile]);

	const handleClick = async () => {
		if (isInactive) return;
		const path = await pickServerIconPath().catch(() => null);
		if (path) onPickPath(path);
	};

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					ref={tileRef}
					type='button'
					aria-label={iconUrl ? 'Change server icon' : 'Add a server icon'}
					disabled={disabled}
					aria-busy={busy}
					onClick={() => void handleClick()}
					className={cn(
						'group relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-sm bg-black/35 outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:cursor-not-allowed',
						isDragging && 'ring-[3px] ring-primary',
						className,
					)}>
					{iconUrl ? (
						<img src={iconUrl} alt='' className='size-full [image-rendering:pixelated]' draggable={false} />
					) : (
						<ImagePlus className='absolute inset-0 m-auto size-6 text-white/55' />
					)}
					<span
						className={cn(
							'absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:opacity-0',
							(isDragging || busy) && 'opacity-100',
						)}>
						{busy ? <Loader className='size-5 animate-spin' /> : <ImageUp className='size-5' />}
					</span>
				</button>
			</TooltipTrigger>
			<TooltipContent>{iconUrl ? 'Change icon (click or drop an image)' : 'Add an icon (click or drop an image)'}</TooltipContent>
		</Tooltip>
	);
};
