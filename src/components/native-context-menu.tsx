import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * App-wide replacement for the native WebView (WebView2 / WebKitGTK) context menu.
 *
 * The native menu leaks browser affordances that make no sense in a desktop app —
 * "Print", "Inspect", "More tools", "Open link in new window", "Copy link",
 * "Save link as", etc. We can't remove individual native entries from the web
 * layer (it's all-or-nothing), so instead we suppress the native menu everywhere
 * and render our own curated menu that keeps only the safe/useful actions:
 * navigation (Back / Forward / Reload) plus clipboard operations in text fields.
 *
 * Composition with existing right-click menus: the listener runs on `window`
 * during the bubble phase, which is after React's delegated handlers. Any element
 * that owns its own context menu (e.g. a Radix `ContextMenuTrigger`) calls
 * `preventDefault()` before the event reaches us, so we bail on
 * `event.defaultPrevented` and let that menu win.
 */

type MenuItem =
	| { kind: 'separator' }
	| { kind: 'item'; label: string; disabled?: boolean; onSelect: () => void };

type MenuState = { x: number; y: number; items: MenuItem[] };

const TEXT_INPUT_TYPES = new Set([
	'text',
	'search',
	'url',
	'tel',
	'email',
	'password',
	'number',
	'',
]);

/** Walks up from the event target to find an editable field, if any. */
const findEditable = (start: EventTarget | null): HTMLElement | null => {
	let node = start instanceof HTMLElement ? start : null;
	while (node) {
		if (node instanceof HTMLTextAreaElement && !node.disabled && !node.readOnly) return node;
		if (
			node instanceof HTMLInputElement &&
			!node.disabled &&
			!node.readOnly &&
			TEXT_INPUT_TYPES.has(node.type)
		) {
			return node;
		}
		if (node.isContentEditable) return node;
		node = node.parentElement;
	}
	return null;
};

const runEditableCommand = (el: HTMLElement, command: 'cut' | 'copy' | 'selectAll') => {
	el.focus();
	// execCommand is deprecated but is the only API that mutates the editable and
	// fires the input/selection events React listens to; well supported in WebView2.
	document.execCommand(command);
};

const pasteInto = async (el: HTMLElement) => {
	el.focus();
	try {
		const text = await navigator.clipboard.readText();
		// insertText replaces the current selection and dispatches a native input
		// event, so React-controlled inputs stay in sync.
		if (text) document.execCommand('insertText', false, text);
	} catch {
		// Clipboard read can be denied; nothing useful to do but ignore.
	}
};

const buildItems = (event: MouseEvent): MenuItem[] => {
	const items: MenuItem[] = [
		{ kind: 'item', label: 'Back', onSelect: () => window.history.back() },
		{ kind: 'item', label: 'Forward', onSelect: () => window.history.forward() },
		{ kind: 'item', label: 'Reload', onSelect: () => window.location.reload() },
	];

	const editable = findEditable(event.target);
	const selectionText = window.getSelection()?.toString() ?? '';

	if (editable) {
		const hasSelection = selectionText.length > 0;
		items.push(
			{ kind: 'separator' },
			{ kind: 'item', label: 'Cut', disabled: !hasSelection, onSelect: () => runEditableCommand(editable, 'cut') },
			{ kind: 'item', label: 'Copy', disabled: !hasSelection, onSelect: () => runEditableCommand(editable, 'copy') },
			{ kind: 'item', label: 'Paste', onSelect: () => void pasteInto(editable) },
			{ kind: 'item', label: 'Select all', onSelect: () => runEditableCommand(editable, 'selectAll') },
		);
	} else if (selectionText) {
		items.push(
			{ kind: 'separator' },
			{
				kind: 'item',
				label: 'Copy',
				onSelect: () => void navigator.clipboard.writeText(selectionText).catch(() => {}),
			},
		);
	}

	return items;
};

export function NativeContextMenu() {
	const [menu, setMenu] = useState<MenuState | null>(null);
	const ref = useRef<HTMLDivElement | null>(null);

	const close = useCallback(() => setMenu(null), []);

	useEffect(() => {
		const handleContextMenu = (event: MouseEvent) => {
			// Yield to any element that renders its own context menu.
			if (event.defaultPrevented) return;
			event.preventDefault();
			setMenu({ x: event.clientX, y: event.clientY, items: buildItems(event) });
		};

		window.addEventListener('contextmenu', handleContextMenu);
		return () => window.removeEventListener('contextmenu', handleContextMenu);
	}, []);

	useEffect(() => {
		if (!menu) return;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') close();
		};
		const onPointerDown = (event: PointerEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) close();
		};

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('resize', close);
		window.addEventListener('blur', close);
		window.addEventListener('scroll', close, true);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('resize', close);
			window.removeEventListener('blur', close);
			window.removeEventListener('scroll', close, true);
		};
	}, [menu, close]);

	// Keep the menu inside the viewport once its real size is known.
	useLayoutEffect(() => {
		if (!menu || !ref.current) return;
		const { offsetWidth, offsetHeight } = ref.current;
		const maxX = window.innerWidth - offsetWidth - 8;
		const maxY = window.innerHeight - offsetHeight - 8;
		const x = Math.max(8, Math.min(menu.x, maxX));
		const y = Math.max(8, Math.min(menu.y, maxY));
		if (x !== menu.x || y !== menu.y) {
			setMenu((prev) => (prev ? { ...prev, x, y } : prev));
		}
	}, [menu]);

	if (!menu) return null;

	return (
		<div
			ref={ref}
			role='menu'
			style={{ top: menu.y, left: menu.x }}
			onContextMenu={(event) => event.preventDefault()}
			className='fixed z-9999 min-w-[10rem] overflow-hidden rounded-md border-2 bg-popover p-1 text-popover-foreground shadow-md'>
			{menu.items.map((item, index) =>
				item.kind === 'separator' ? (
					<div key={`sep-${index}`} className='-mx-1 my-1 h-px bg-border' />
				) : (
					<button
						key={item.label}
						type='button'
						role='menuitem'
						disabled={item.disabled}
						onClick={() => {
							item.onSelect();
							close();
						}}
						className={cn(
							'relative flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none',
							'hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
							'disabled:pointer-events-none disabled:opacity-50',
						)}>
						{item.label}
					</button>
				),
			)}
		</div>
	);
}

export default NativeContextMenu;
