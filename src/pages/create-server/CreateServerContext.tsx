import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useServers } from '@/data/servers';
import { useUser } from '@/data/user';
import { buildCreatedServer } from '@/lib/mserve-server-mapper';
import type { Provider } from '@/lib/mserve-schema';
import { createDefaultServerSetupForm, type ServerSetupFormData } from '@/lib/mserve-sync';
import { getDefaultServersRootPath } from '@/lib/server-root-path';
import {
	CREATE_SERVER_SLIDE_INDEX,
	getCreateServerCurrentStep,
	getCreateServerNextSlide,
	getCreateServerPreviousSlide,
	getCreateServerStepSlides,
	getCreateServerVisibleSlide,
} from './create-server-flow';

type InitServerPayload = {
	directory: string;
	create_directory_if_missing: boolean;
	file: string;
	ram: number;
	storage_limit: number;
	auto_restart: boolean;
	auto_backup: string[];
	auto_backup_interval: number;
	auto_agree_eula: boolean;
	java_installation: string;
	provider: Provider;
};

type InitServerResult = {
	ok: boolean;
	message: string;
	id: string;
	file: string;
	directory: string;
};

export type PathValidationResult = {
	exists: boolean;
	isDirectory: boolean;
	isFile: boolean;
};

const DONE_SLIDE_INDEX = CREATE_SERVER_SLIDE_INDEX.done;
const DEFAULT_FORM = createDefaultServerSetupForm();

const sameArray = (left: string[], right: string[]) => {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
};

const normalizeName = (value: string) => value.trim().toLowerCase();

const joinPath = (basePath: string, name: string) => {
	const base = basePath.trim();
	const trimmedName = name.trim();
	if (!base || !trimmedName) return '';
	if (base.endsWith('\\') || base.endsWith('/')) {
		return `${base}${trimmedName}`;
	}
	const separator = base.includes('\\') ? '\\' : '/';
	return `${base}${separator}${trimmedName}`;
};

const isFormDirty = (form: ServerSetupFormData, serverName: string) => {
	if (serverName.trim().length > 0) return true;
	if (form.file !== DEFAULT_FORM.file) return true;
	if (form.ram !== DEFAULT_FORM.ram) return true;
	if (form.storage_limit !== DEFAULT_FORM.storage_limit) return true;
	if (form.auto_restart !== DEFAULT_FORM.auto_restart) return true;
	if (!sameArray(form.auto_backup, DEFAULT_FORM.auto_backup)) return true;
	if (form.auto_backup_interval !== DEFAULT_FORM.auto_backup_interval) return true;
	if (form.auto_agree_eula !== DEFAULT_FORM.auto_agree_eula) return true;
	if (form.java_installation !== DEFAULT_FORM.java_installation) return true;
	if (JSON.stringify(form.provider) !== JSON.stringify(DEFAULT_FORM.provider)) return true;
	return false;
};

type CreateServerContextValue = {
	form: ServerSetupFormData;
	serverName: string;
	serversRootPath: string;
	isResolvingServersRootPath: boolean;
	resolvedDirectory: string;
	slide: number;
	activeSlide: number;
	doneSlideIndex: number;
	totalSteps: number;
	currentStep: number;
	showBackButton: boolean;
	showStepIndicator: boolean;
	hasStarted: boolean;
	isDirty: boolean;
	createdServerId: string | null;
	error: string | null;
	isSubmitting: boolean;
	updateField: <K extends keyof ServerSetupFormData>(key: K, value: ServerSetupFormData[K]) => void;
	setServerName: (value: string) => void;
	setSlide: (slide: number) => void;
	nextSlide: () => void;
	prevSlide: () => void;
	continueToNext: () => void;
	startFlow: () => void;
	setCreatedServerId: (serverId: string | null) => void;
	setError: (message: string | null) => void;
	clearError: () => void;
	createServer: () => Promise<void>;
	goToCreatedServer: () => void;
	resetDraft: () => void;
};

const CreateServerContext = React.createContext<CreateServerContextValue | undefined>(undefined);

export const CreateServerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const navigate = useNavigate();
	const { servers, addServer } = useServers();
	const { user, updateUserField } = useUser();
	const [form, setForm] = React.useState<ServerSetupFormData>(DEFAULT_FORM);
	const [provider, setProvider] = React.useState<Provider | null>(DEFAULT_FORM.provider);
	const providerRef = React.useRef<Provider | null>(DEFAULT_FORM.provider);
	const [serverName, setServerNameState] = React.useState('');
	const [serversRootPath, setServersRootPath] = React.useState('');
	const [isResolvingServersRootPath, setIsResolvingServersRootPath] = React.useState(true);
	const [slide, setSlide] = React.useState(0);
	const [hasStarted, setHasStarted] = React.useState(false);
	const [createdServerId, setCreatedServerId] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = React.useState(false);

	React.useEffect(() => {
		const configuredRootPath = user.servers_root_path.trim();
		if (configuredRootPath) {
			setServersRootPath(configuredRootPath);
			setIsResolvingServersRootPath(false);
			return;
		}

		let active = true;
		setIsResolvingServersRootPath(true);
		void getDefaultServersRootPath()
			.then((path) => {
				if (!active) return;
				setServersRootPath(path);
				updateUserField('servers_root_path', path);
			})
			.catch(() => {
				if (!active) return;
				setServersRootPath('');
			})
			.finally(() => {
				if (!active) return;
				setIsResolvingServersRootPath(false);
			});

		return () => {
			active = false;
		};
	}, [updateUserField, user.servers_root_path]);

	const resolvedDirectory = React.useMemo(
		() => joinPath(serversRootPath, serverName),
		[serverName, serversRootPath],
	);

	const activeSlide = React.useMemo(
		() => getCreateServerVisibleSlide(slide, form.provider),
		[form.provider, slide],
	);

	React.useEffect(() => {
		providerRef.current = provider;
	}, [provider]);

	React.useEffect(() => {
		setForm((previous) => ({
			...previous,
			directory: resolvedDirectory,
			create_directory_if_missing: true,
		}));
	}, [resolvedDirectory]);

	const updateField = React.useCallback(
		<K extends keyof ServerSetupFormData>(key: K, value: ServerSetupFormData[K]) => {
			if (key === 'provider') {
				providerRef.current = value as Provider;
				setProvider(value as Provider);
			}
			setForm((prev) => ({ ...prev, [key]: value }));
			setHasStarted(true);
		},
		[],
	);

	const setServerName = React.useCallback((value: string) => {
		setServerNameState(value);
		setHasStarted(true);
	}, []);

	const nextSlide = React.useCallback(() => {
		setHasStarted(true);
		setSlide((prev) => getCreateServerNextSlide(prev, providerRef.current));
	}, []);

	const prevSlide = React.useCallback(() => {
		setSlide((prev) => getCreateServerPreviousSlide(prev, providerRef.current));
	}, []);

	const clearError = React.useCallback(() => {
		setError(null);
	}, []);

	const continueToNext = React.useCallback(() => {
		clearError();
		nextSlide();
	}, [clearError, nextSlide]);

	const startFlow = React.useCallback(() => {
		setHasStarted(true);
		setSlide(CREATE_SERVER_SLIDE_INDEX.directory);
	}, []);

	const resetDraft = React.useCallback(() => {
		setForm(createDefaultServerSetupForm());
		setProvider(DEFAULT_FORM.provider);
		setServerNameState('');
		setSlide(CREATE_SERVER_SLIDE_INDEX.intro);
		setHasStarted(false);
		setCreatedServerId(null);
		setError(null);
		setIsSubmitting(false);
	}, []);

	const goToCreatedServer = React.useCallback(() => {
		if (!createdServerId) return;
		const targetId = createdServerId;
		resetDraft();
		navigate(`/servers/${encodeURIComponent(targetId)}`);
	}, [createdServerId, navigate, resetDraft]);

	const findExistingServerByName = React.useCallback(
		(name: string) => {
			const normalized = normalizeName(name);
			if (!normalized) return null;
			return servers.find((server) => normalizeName(server.name) === normalized) ?? null;
		},
		[servers],
	);

	const createServer = React.useCallback(async () => {
		setError(null);

		if (isResolvingServersRootPath) {
			setError('Still resolving server root path. Please wait a moment and try again.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.directory);
			return;
		}

		if (!serversRootPath.trim()) {
			setError('Set your servers root path in Settings before creating a server.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.directory);
			return;
		}

		const trimmedName = serverName.trim();
		if (!trimmedName) {
			setError('Please enter a server name.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.directory);
			return;
		}

		if (/[/\\]/.test(trimmedName)) {
			setError('Server name cannot include path separators. Please choose another name.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.directory);
			return;
		}

		const existingByName = findExistingServerByName(trimmedName);
		if (existingByName) {
			setError(`Server name already exists as "${existingByName.name}". Please choose another name.`);
			setSlide(CREATE_SERVER_SLIDE_INDEX.directory);
			return;
		}

		const directory = joinPath(serversRootPath, trimmedName);
		if (!directory) {
			setError('Could not resolve the target server path. Please review your settings.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.directory);
			return;
		}

		const directoryValidation = await invoke<PathValidationResult>('validate_path', {
			path: directory,
		});
		if (directoryValidation.exists && !directoryValidation.isDirectory) {
			setError('Target path is not a directory. Please change the server name.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.directory);
			return;
		}

		if (directoryValidation.exists) {
			setError('A folder with this name already exists. Please change the server name.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.directory);
			return;
		}

		const file = form.file.trim();
		if (!file) {
			setError('Please choose a server jar file.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.jarFile);
			return;
		}

		if (!file.toLowerCase().endsWith('.jar')) {
			setError('Server file must be a .jar file.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.jarFile);
			return;
		}

		const fileValidation = await invoke<PathValidationResult>('validate_path', { path: file });
		if (!fileValidation.exists || !fileValidation.isFile) {
			setError('Please choose a valid server jar file.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.jarFile);
			return;
		}

		if (!form.provider) {
			setError('Provider details are required. Select provider metadata before continuing.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.jarFile);
			return;
		}

		const provider = {
			...form.provider,
			file,
		};

		if (!provider.minecraft_version.trim() || !provider.provider_version.trim()) {
			setError('Provider metadata must include minecraft and provider version details.');
			setSlide(CREATE_SERVER_SLIDE_INDEX.jarFile);
			return;
		}

		setIsSubmitting(true);
		try {
			const payload: InitServerPayload = {
				directory,
				create_directory_if_missing: true,
				file,
				ram: Math.max(1, Number(form.ram) || 3),
				storage_limit: Math.max(1, Number(form.storage_limit) || 200),
				auto_restart: form.auto_restart,
				auto_backup: form.auto_backup,
				auto_backup_interval: Math.max(1, Number(form.auto_backup_interval) || 120),
				auto_agree_eula: form.auto_agree_eula,
				java_installation: form.java_installation,
				provider,
			};

			const initializePromise = (async () => {
				const res = await invoke<InitServerResult>('initialize_server', { payload });
				if (!res.ok) {
					throw new Error(res.message || 'Failed to initialize server.');
				}
				return res;
			})();

			await toast.promise(initializePromise, {
				loading: 'Creating server...',
				success: () => `Server "${trimmedName}" has been created`,
				error: (err) => (err instanceof Error ? err.message : 'Failed to create server.'),
			});

			const result = await initializePromise;
			const serverId = addServer(
				buildCreatedServer(
					{
						...form,
						directory,
						create_directory_if_missing: true,
					},
					result,
				),
			);
			setCreatedServerId(serverId);
			setSlide(DONE_SLIDE_INDEX);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to initialize server.';
			setError(message);
		} finally {
			setIsSubmitting(false);
		}
	}, [addServer, findExistingServerByName, form, isResolvingServersRootPath, serverName, serversRootPath]);

	React.useEffect(() => {
		if (slide !== DONE_SLIDE_INDEX || !createdServerId) return;

		const timeout = window.setTimeout(() => {
			goToCreatedServer();
		}, 5000);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [createdServerId, goToCreatedServer, slide]);

	const visibleStepSlides = React.useMemo(() => getCreateServerStepSlides(form.provider), [form.provider]);
	const totalSteps = visibleStepSlides.length;
	const currentStep = getCreateServerCurrentStep(activeSlide, form.provider);
	const showBackButton = activeSlide > CREATE_SERVER_SLIDE_INDEX.intro && activeSlide < DONE_SLIDE_INDEX;
	const showStepIndicator = showBackButton;

	const value = React.useMemo<CreateServerContextValue>(
		() => ({
			form,
			serverName,
			serversRootPath,
			isResolvingServersRootPath,
			resolvedDirectory,
			slide,
			activeSlide,
			doneSlideIndex: DONE_SLIDE_INDEX,
			totalSteps,
			currentStep,
			showBackButton,
			showStepIndicator,
			hasStarted,
			isDirty: isFormDirty(form, serverName),
			createdServerId,
			error,
			isSubmitting,
			updateField,
			setServerName,
			setSlide,
			nextSlide,
			prevSlide,
			continueToNext,
			startFlow,
			setCreatedServerId,
			setError,
			clearError,
			createServer,
			goToCreatedServer,
			resetDraft,
		}),
		[
			activeSlide,
			clearError,
			continueToNext,
			createServer,
			createdServerId,
			currentStep,
			error,
			form,
			goToCreatedServer,
			hasStarted,
			isResolvingServersRootPath,
			isSubmitting,
			nextSlide,
			prevSlide,
			resetDraft,
			resolvedDirectory,
			serverName,
			serversRootPath,
			showBackButton,
			showStepIndicator,
			slide,
			startFlow,
			totalSteps,
			updateField,
			setServerName,
		],
	);

	return <CreateServerContext.Provider value={value}>{children}</CreateServerContext.Provider>;
};

export const useCreateServer = () => {
	const context = React.useContext(CreateServerContext);
	if (!context) {
		throw new Error('useCreateServer must be used within a CreateServerProvider');
	}

	return context;
};
