import React from 'react';
import { hasLocalStorage, readStoredJson, toDate, writeStoredString } from '@/lib/local-storage';

export interface UserData {
	accessibility: {
		logo_animation: boolean;
		reduced_motion: boolean;
	};
	java_installation_default: string;
	servers_root_path: string;
	advanced_mode: boolean;
	suppress_close_warning: boolean;
	auto_check_server_updates: boolean;
	completed_setup_hosting_ports: number[];
	initial_setup_hosting_tutorial_completed: boolean;
	/** Ordered list of dashboard bento card ids (see DASHBOARD_CARD_IDS). */
	dashboard_card_order: string[];
	/** Dashboard bento card ids the user has hidden (see DASHBOARD_CARD_IDS). */
	dashboard_hidden_cards: string[];
	/** True once the first-launch welcome tour has been finished or skipped. */
	onboarding_completed: boolean;
	created_at: Date;
	updated_at: Date;
}

interface UserContextValue {
	user: UserData;
	isReady: boolean;
	setUser: (next: UserData | ((previous: UserData) => UserData)) => void;
	updateUser: (update: Partial<UserData>) => void;
	updateUserField: <K extends keyof UserData>(
		key: K,
		value: UserData[K] | ((previous: UserData[K]) => UserData[K]),
	) => void;
	resetUser: () => void;
}

const STORAGE_KEY = 'mserve.user.v1';
let memoryStore: UserData | null = null;

const normalizePortList = (ports?: number[]) =>
	Array.from(
		new Set(
			(ports ?? [])
				.map((port) => Number(port))
				.filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535),
		),
	).sort((a, b) => a - b);

const toTrimmedString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '');

/**
 * The rearrangeable/hideable bento cards on the dashboard, in default display
 * order. The headline metric tiles and the "Edit Layout" tile are a fixed anchor
 * zone and deliberately not part of this set. Bumping this list is safe: the
 * normalizers below drop unknown ids and append any newly-added ones.
 */
export const DASHBOARD_CARD_IDS = ['servers', 'storage', 'activity', 'attention', 'networks'] as const;
export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

/** Normalize a persisted order: keep known ids in their saved order, then append
 *  any card ids that weren't stored yet (e.g. after an app update adds a card). */
const normalizeDashboardCardOrder = (value: unknown): string[] => {
	const stored = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
	const seen = new Set<string>();
	const order: string[] = [];
	for (const id of stored) {
		if ((DASHBOARD_CARD_IDS as readonly string[]).includes(id) && !seen.has(id)) {
			seen.add(id);
			order.push(id);
		}
	}
	for (const id of DASHBOARD_CARD_IDS) {
		if (!seen.has(id)) order.push(id);
	}
	return order;
};

const normalizeDashboardHiddenCards = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return DASHBOARD_CARD_IDS.filter((id) => value.includes(id));
};

const normalizeJavaDefault = (value: unknown): string => {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	if (!trimmed) return '';
	return trimmed.toLowerCase() === 'java' || trimmed.toLowerCase() === 'java.exe' ? '' : trimmed;
};

const createDefaultUserData = (): UserData => {
	const now = new Date();
	return {
		accessibility: {
			logo_animation: true,
			reduced_motion: false,
		},
		java_installation_default: '',
		servers_root_path: '',
		advanced_mode: false,
		suppress_close_warning: false,
		auto_check_server_updates: true,
		completed_setup_hosting_ports: [],
		initial_setup_hosting_tutorial_completed: false,
		dashboard_card_order: [...DASHBOARD_CARD_IDS],
		dashboard_hidden_cards: [],
		onboarding_completed: false,
		created_at: now,
		updated_at: now,
	};
};

const normalizeUserData = (user: Partial<UserData> | null | undefined): UserData => {
	const fallback = createDefaultUserData();
	return {
		accessibility: {
			logo_animation: user?.accessibility?.logo_animation ?? fallback.accessibility.logo_animation,
			reduced_motion: user?.accessibility?.reduced_motion ?? fallback.accessibility.reduced_motion,
		},
		// '' = Automatic (each server resolves its own runtime). Legacy values of
		// `java`/`java.exe` were the old "use system PATH" sentinel — migrate them
		// to Automatic so resolution picks a real, compatible runtime.
		java_installation_default: normalizeJavaDefault(user?.java_installation_default),
		servers_root_path: toTrimmedString(user?.servers_root_path),
		advanced_mode: user?.advanced_mode ?? false,
		suppress_close_warning: user?.suppress_close_warning ?? false,
		auto_check_server_updates: user?.auto_check_server_updates ?? true,
		completed_setup_hosting_ports: normalizePortList(user?.completed_setup_hosting_ports),
		initial_setup_hosting_tutorial_completed: user?.initial_setup_hosting_tutorial_completed ?? false,
		dashboard_card_order: normalizeDashboardCardOrder(user?.dashboard_card_order),
		dashboard_hidden_cards: normalizeDashboardHiddenCards(user?.dashboard_hidden_cards),
		onboarding_completed: user?.onboarding_completed ?? false,
		created_at: toDate(user?.created_at ?? fallback.created_at),
		updated_at: toDate(user?.updated_at ?? fallback.updated_at),
	};
};

const loadUserData = (): UserData => {
	if (!hasLocalStorage()) return memoryStore ?? createDefaultUserData();
	const stored = readStoredJson(STORAGE_KEY);
	return stored && typeof stored === 'object' ? normalizeUserData(stored as Partial<UserData>) : createDefaultUserData();
};

const saveUserData = (user: UserData): void => {
	if (!hasLocalStorage()) {
		memoryStore = user;
		return;
	}
	writeStoredString(STORAGE_KEY, JSON.stringify(user));
};

const UserContext = React.createContext<UserContextValue | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [user, setUserState] = React.useState<UserData>(createDefaultUserData());
	const [isReady, setIsReady] = React.useState(false);

	React.useEffect(() => {
		setUserState(loadUserData());
		setIsReady(true);
	}, []);

	React.useEffect(() => {
		if (!isReady) return;
		saveUserData(user);
	}, [user, isReady]);

	const setUser = React.useCallback((next: UserData | ((previous: UserData) => UserData)) => {
		setUserState((previous) => {
			const resolved = typeof next === 'function' ? next(previous) : next;
			return normalizeUserData({
				...resolved,
				created_at: previous.created_at,
				updated_at: new Date(),
			});
		});
	}, []);

	const updateUser = React.useCallback((update: Partial<UserData>) => {
		setUserState((previous) =>
			normalizeUserData({
				...previous,
				...update,
				created_at: previous.created_at,
				updated_at: new Date(),
			}),
		);
	}, []);

	const updateUserField = React.useCallback(
		<K extends keyof UserData>(key: K, value: UserData[K] | ((previous: UserData[K]) => UserData[K])) => {
			setUserState((previous) => {
				const resolvedValue =
					typeof value === 'function'
						? (value as (previousValue: UserData[K]) => UserData[K])(previous[key])
						: value;

				return normalizeUserData({
					...previous,
					[key]: resolvedValue,
					created_at: previous.created_at,
					updated_at: new Date(),
				});
			});
		},
		[],
	);

	const resetUser = React.useCallback(() => {
		setUserState(createDefaultUserData());
	}, []);

	const value: UserContextValue = {
		user,
		isReady,
		setUser,
		updateUser,
		updateUserField,
		resetUser,
	};

	return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useUser = () => {
	const context = React.useContext(UserContext);
	if (!context) {
		throw new Error('useUser must be used within a UserProvider');
	}
	return context;
};
