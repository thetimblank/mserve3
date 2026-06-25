import { vi } from 'vitest';

// Central registry backing the mocked `@tauri-apps/api` surface. Tests register
// command handlers with `mockInvoke(...)` and push backend events with
// `emitTauriEvent(...)`. The actual `vi.mock(...)` wiring lives in setup.ts and
// delegates to the `invokeMock` / `listenMock` spies below.

type InvokeHandler = (args: Record<string, unknown> | undefined) => unknown;
type TauriEvent = { event: string; payload: unknown; id: number };
type EventCallback = (event: TauriEvent) => void;

const invokeHandlers = new Map<string, InvokeHandler>();
const eventListeners = new Map<string, Set<EventCallback>>();
let nextEventId = 1;

/** The spy that the mocked `invoke` delegates to. Asserts call counts/args. */
export const invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
	const handler = invokeHandlers.get(cmd);
	if (!handler) {
		// Unregistered commands resolve to `undefined` rather than throwing, so
		// fire-and-forget invokes in effects don't produce unhandled rejections.
		// Register an explicit handler with `mockInvoke` when the result matters.
		return undefined;
	}
	return handler(args);
});

/** The spy that the mocked `listen` delegates to. Returns an unlisten fn. */
export const listenMock = vi.fn(async (event: string, cb: EventCallback) => {
	let set = eventListeners.get(event);
	if (!set) {
		set = new Set();
		eventListeners.set(event, set);
	}
	set.add(cb);
	return () => {
		eventListeners.get(event)?.delete(cb);
	};
});

/** Register the result (or thrown error) for `invoke(cmd, ...)`. */
export function mockInvoke(cmd: string, handler: InvokeHandler): void {
	invokeHandlers.set(cmd, handler);
}

/** Deliver a backend event to every active `listen(event, ...)` subscriber. */
export function emitTauriEvent(event: string, payload: unknown): void {
	const set = eventListeners.get(event);
	if (!set) return;
	const evt: TauriEvent = { event, payload, id: nextEventId++ };
	// Snapshot to a copy so a listener that unsubscribes mid-dispatch is safe.
	for (const cb of [...set]) cb(evt);
}

/** Reset all handlers, listeners, and spy state. Called in `afterEach`. */
export function resetTauriMocks(): void {
	invokeHandlers.clear();
	eventListeners.clear();
	invokeMock.mockClear();
	listenMock.mockClear();
}
