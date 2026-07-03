import * as Sentry from '@sentry/react';

// Sentry is opt-in via a build-time env var. A DSN is safe to embed in the
// shipped binary (it only permits *sending* events, not reading them), but we
// still keep it out of source so forks/CI can inject their own. When the DSN is
// absent — e.g. local dev without a `.env` — every helper below is a no-op, so
// nothing breaks and no events are sent.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

const isEnabled = Boolean(dsn);

/**
 * Initialise error reporting. Call once, as early as possible, before the app
 * renders. Safe to call when no DSN is configured (does nothing).
 */
export function initSentry(): void {
	if (!isEnabled) {
		if (import.meta.env.DEV) {
			console.info('[sentry] VITE_SENTRY_DSN not set — error reporting is disabled.');
		}
		return;
	}

	Sentry.init({
		dsn,
		// Tag events with dev/production so local noise can be filtered out.
		environment: import.meta.env.MODE,
		// Lightweight: crash/error reporting only. No performance tracing or
		// session replay — those add bundle weight and network chatter we don't
		// need for "simple tracking".
		tracesSampleRate: 0,
		// This app has no user accounts; don't collect IPs or other PII.
		sendDefaultPii: false,
	});
}

/**
 * Manually report a caught error (the React error boundary uses this). No-op
 * when Sentry is disabled.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
	if (!isEnabled) return;
	Sentry.captureException(error, context ? { extra: context } : undefined);
}
