import { invoke } from '@tauri-apps/api/core';

/**
 * The server icon (`server-icon.png`) shown next to a server in the multiplayer
 * list. Minecraft only shows a 64×64 PNG, so any picked image is cover-cropped
 * to a square and scaled on a canvas here; the backend validates and writes it.
 */

export const SERVER_ICON_SIZE = 64;

export const SERVER_ICON_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico'] as const;

const MIME_BY_EXTENSION: Record<(typeof SERVER_ICON_EXTENSIONS)[number], string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
};

const resolveExtension = (path: string) => {
	const fileName = path.split(/[\\/]/).pop() ?? '';
	const dot = fileName.lastIndexOf('.');
	return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
};

const isServerIconExtension = (extension: string): extension is (typeof SERVER_ICON_EXTENSIONS)[number] =>
	(SERVER_ICON_EXTENSIONS as readonly string[]).includes(extension);

export const isServerIconSourcePath = (path: string) => isServerIconExtension(resolveExtension(path));

/** The largest centered square in a `width`×`height` image (a "cover" crop). */
export const computeCoverCrop = (width: number, height: number) => {
	const side = Math.min(width, height);
	return { sx: (width - side) / 2, sy: (height - side) / 2, side };
};

/**
 * Canvas sizes to draw through, ending at 64. A big image is halved step by
 * step (a single huge downscale aliases badly); the first step is capped at
 * 1024 px so a camera photo never allocates a giant canvas.
 */
export const planIconResizeSteps = (side: number): number[] => {
	const start = Math.min(side, 1024);
	const doublings = start > SERVER_ICON_SIZE ? Math.floor(Math.log2(start / SERVER_ICON_SIZE)) : 0;
	return Array.from({ length: doublings + 1 }, (_, index) => SERVER_ICON_SIZE * 2 ** (doublings - index));
};

const loadImage = async (bytes: ArrayBuffer, mime: string) => {
	const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		return image;
	} catch {
		throw new Error('This image could not be read. Try a PNG or JPG instead.');
	} finally {
		// The decoded image stays usable after its URL is revoked.
		URL.revokeObjectURL(url);
	}
};

const canvasToPng = (canvas: HTMLCanvasElement) =>
	new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Could not create the icon image.'))),
			'image/png',
		);
	});

/** Cover-crops the image to a square and scales it to a 64×64 PNG. */
export const renderServerIconPng = async (bytes: ArrayBuffer, mime: string): Promise<Uint8Array> => {
	const image = await loadImage(bytes, mime);
	const { naturalWidth: width, naturalHeight: height } = image;
	if (!width || !height) {
		throw new Error('This image is empty.');
	}

	const crop = computeCoverCrop(width, height);
	let source: CanvasImageSource = image;
	let sourceRect = { x: crop.sx, y: crop.sy, side: crop.side };
	let canvas: HTMLCanvasElement | null = null;

	for (const size of planIconResizeSteps(crop.side)) {
		canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Could not create the icon image.');
		// Smooth when shrinking; keep small pixel-art icons crisp when enlarging.
		context.imageSmoothingEnabled = size < sourceRect.side;
		context.imageSmoothingQuality = 'high';
		context.drawImage(source, sourceRect.x, sourceRect.y, sourceRect.side, sourceRect.side, 0, 0, size, size);
		source = canvas;
		sourceRect = { x: 0, y: 0, side: size };
	}

	if (!canvas) throw new Error('Could not create the icon image.');
	return new Uint8Array(await (await canvasToPng(canvas)).arrayBuffer());
};

/** Reads a picked or dropped image file (through the backend; a native drop only gives a path). */
const readServerIconSource = (path: string) => invoke<ArrayBuffer>('read_server_icon_source', { path });

/** The current icon as a `data:` URL, or null when the server has none. */
export const loadServerIcon = (directory: string) => invoke<string | null>('get_server_icon', { directory });

/** Turns the image at `path` into a 64×64 PNG and writes it as the server's icon. */
export const setServerIconFromPath = async (directory: string, path: string) => {
	const extension = resolveExtension(path);
	if (!isServerIconExtension(extension)) {
		throw new Error('Pick a PNG, JPG, WebP, GIF, BMP or ICO image.');
	}
	const png = await renderServerIconPng(await readServerIconSource(path), MIME_BY_EXTENSION[extension]);
	await invoke('set_server_icon', { directory, pngBytes: Array.from(png) });
};
