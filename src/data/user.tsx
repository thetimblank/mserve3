import React from 'react';

export interface UserData {
	accessibility: {
		logo_animation: boolean;
		reduced_motion: boolean;
	};
	completed_setup_hosting_ports: number[];
	initial_setup_hosting_tutorial_completed: boolean;
	createdAt: Date;
	updatedAt: Date;
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

const toDate = (value?: string | Date): Date => {
	if (value instanceof Date) return value;
	if (!value) return new Date();
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const normalizePortList = (ports?: number[]) =>
	Array.from(
		new Set(
			(ports ?? [])
				.map((port) => Number(port))
				.filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535),
		),
	).sort((a, b) => a - b);

export const createDefaultUserData = (): UserData => {
	const now = new Date();
	return {
		accessibility: {
			logo_animation: true,
			reduced_motion: false,
		},
		completed_setup_hosting_ports: [],
		initial_setup_hosting_tutorial_completed: false,
		createdAt: now,
		updatedAt: now,
	};
};

export const normalizeUserData = (user: Partial<UserData> | null | undefined): UserData => {
	const fallback = createDefaultUserData();
	return {
		accessibility: {
			logo_animation: user?.accessibility?.logo_animation ?? false,
			reduced_motion: user?.accessibility?.reduced_motion ?? false,
		},
		completed_setup_hosting_ports: normalizePortList(user?.completed_setup_hosting_ports),
		initial_setup_hosting_tutorial_completed: user?.initial_setup_hosting_tutorial_completed ?? false,
		createdAt: toDate(user?.createdAt ?? fallback.createdAt),
		updatedAt: toDate(user?.updatedAt ?? fallback.updatedAt),
	};
};

const hasLocalStorage = () => {
	try {
		return typeof window !== 'undefined' && !!window.localStorage;
	} catch {
		return false;
	}
};

const loadUserData = async (): Promise<UserData> => {
	if (!hasLocalStorage()) {
		if (memoryStore) return memoryStore;
		const defaults = createDefaultUserData();
		memoryStore = defaults;
		return defaults;
	}

	const stored = window.localStorage.getItem(STORAGE_KEY);
	if (!stored) {
		const defaults = createDefaultUserData();
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
		return defaults;
	}

	try {
		const parsed = JSON.parse(stored) as Partial<UserData>;
		return normalizeUserData(parsed);
	} catch {
		const defaults = createDefaultUserData();
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
		return defaults;
	}
};

const saveUserData = async (user: UserData): Promise<void> => {
	if (!hasLocalStorage()) {
		memoryStore = user;
		return;
	}

	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
	} catch {
		// Ignore storage errors
	}
};

const UserContext = React.createContext<UserContextValue | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [user, setUserState] = React.useState<UserData>(createDefaultUserData());
	const [isReady, setIsReady] = React.useState(false);

	React.useEffect(() => {
		let active = true;
		loadUserData().then((loaded) => {
			if (!active) return;
			setUserState(loaded);
			setIsReady(true);
		});
		return () => {
			active = false;
		};
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
				createdAt: previous.createdAt,
				updatedAt: new Date(),
			});
		});
	}, []);

	const updateUser = React.useCallback((update: Partial<UserData>) => {
		setUserState((previous) =>
			normalizeUserData({
				...previous,
				...update,
				createdAt: previous.createdAt,
				updatedAt: new Date(),
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
					createdAt: previous.createdAt,
					updatedAt: new Date(),
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
