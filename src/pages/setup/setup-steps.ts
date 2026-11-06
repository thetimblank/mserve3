/** How friends outside the home network reach the server. */
export type HostingPath = 'tunnel' | 'forward';

export type SetupStepId =
	| 'intro'
	| 'choose'
	| 'tunnel-account'
	| 'tunnel-server'
	| 'forward-prereq'
	| 'forward-router'
	| 'forward-firewall'
	| 'forward-address'
	| 'forward-start';

const SHARED_STEPS: readonly SetupStepId[] = ['intro', 'choose'];

const BRANCH_STEPS: Record<HostingPath, readonly SetupStepId[]> = {
	tunnel: ['tunnel-account', 'tunnel-server'],
	forward: ['forward-prereq', 'forward-router', 'forward-firewall', 'forward-address', 'forward-start'],
};

/** Index of the first slide after the path choice. */
export const FIRST_BRANCH_STEP_INDEX = SHARED_STEPS.length;

/** The slides of the hosting setup: the shared intro + choice, then the chosen branch. */
export const resolveSetupSteps = (path: HostingPath | null): SetupStepId[] =>
	path ? [...SHARED_STEPS, ...BRANCH_STEPS[path]] : [...SHARED_STEPS];

export const DEFAULT_MINECRAFT_PORT = 25565;

/** A TCP port a server (and a forward/firewall rule) can use. */
export const isValidPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;
