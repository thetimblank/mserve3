import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Server, useServers } from '@/data/servers';
import { requestMserveRepair } from '@/lib/mserve-repair-controller';
import {
	createDefaultServerSetupForm,
	repairServerMserveJson,
	syncServerMserveJson,
	type AutoBackupMode,
	type ServerSetupFormData,
	type SyncedMserveConfig,
} from '@/lib/mserve-sync';

type InitServerPayload = {
	directory: string;
	createDirectoryIfMissing: boolean;
	file: string;
	ram: number;
	storageLimit: number;
	autoRestart: boolean;
	autoBackup: AutoBackupMode[];
	autoBackupInterval: number;
	autoAgreeEula: boolean;
	javaInstallation: string;
	provider: string;
	version: string;
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

export type ServerDirectoryInspectionKind =
	| 'empty_input'
	| 'missing_directory'
	| 'new_directory'
	| 'not_directory'
	| 'empty_directory'
	| 'already_in_mserve'
	| 'import_mserve'
	| 'import_existing_server'
	| 'unsupported_existing';

export type ServerDirectoryInspectionResult = {
	kind: ServerDirectoryInspectionKind;
	exists: boolean;
	isDirectory: boolean;
	isEmpty: boolean;
	hasMserveJson: boolean;
	hasServerProperties: boolean;
	hasEulaTxt: boolean;
	firstJarFile: string | null;
	message: string;
};

const DONE_SLIDE_INDEX = 8;

const getDirectoryName = (directory: string) => {
	const segments = directory.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] || 'Server';
};

const joinDirectoryAndFile = (directory: string, fileName: string) => {
	if (!directory) return fileName;
	if (directory.endsWith('\\') || directory.endsWith('/')) {
		return `${directory}${fileName}`;
	}
	const separator = directory.includes('\\') ? '\\' : '/';
	return `${directory}${separator}${fileName}`;
};

const normalizeDirectoryPath = (value: string) =>
	value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const buildServer = (form: ServerSetupFormData, result: InitServerResult): Server => ({
	id: result.id,
	name: getDirectoryName(result.directory),
	directory: result.directory,
	status: 'offline',
	backups: [],
	datapacks: [],
	worlds: [],
	plugins: [],
	storage_limit: Math.max(1, Number(form.storageLimit) || 200),
	stats: {
		players: 0,
		capacity: 20,
		tps: 0,
		uptime: null,
	},
	file: result.file,
	ram: Math.max(1, Number(form.ram) || 1),
	auto_backup: form.autoBackup,
	auto_backup_interval: Math.max(1, Number(form.autoBackupInterval) || 120),
	auto_restart: form.autoRestart,
	java_installation: form.javaInstallation.trim() || undefined,
	provider: form.provider.trim() || undefined,
	version: form.version.trim() || undefined,
	created_at: new Date(),
});

const buildImportedServer = (
	result: InitServerResult,
	config: SyncedMserveConfig,
	storageLimit: number,
): Server => ({
	id: config.id || result.id,
	name: getDirectoryName(result.directory),
	directory: result.directory,
	status: 'offline',
	backups: [],
	datapacks: [],
	worlds: [],
	plugins: [],
	storage_limit: Math.max(1, Number(config.storage_limit ?? storageLimit) || 200),
	stats: {
		players: 0,
		capacity: 20,
		tps: 0,
		uptime: null,
	},
	file: config.file,
	ram: config.ram,
	auto_backup: config.auto_backup,
	auto_backup_interval: config.auto_backup_interval,
	auto_restart: config.auto_restart,
	java_installation: config.java_installation,
	custom_flags: config.custom_flags,
	provider: config.provider,
	version: config.version,
	created_at: new Date(config.created_at),
});

const getNextSlideIndex = (currentSlide: number, skipJarAndEula: boolean) => {
	if (!skipJarAndEula) return currentSlide + 1;
	if (currentSlide === 1) return 3;
	if (currentSlide === 5) return 7;
	return currentSlide + 1;
};

const getPrevSlideIndex = (currentSlide: number, skipJarAndEula: boolean) => {
	if (!skipJarAndEula) return currentSlide > 0 ? currentSlide - 1 : currentSlide;
	if (currentSlide === 3) return 1;
	if (currentSlide === 7) return 5;
	return currentSlide > 0 ? currentSlide - 1 : currentSlide;
};

type CreateServerContextValue = {
	form: ServerSetupFormData;
	slide: number;
	doneSlideIndex: number;
	totalSteps: number;
	currentStep: number;
	showBackButton: boolean;
	showStepIndicator: boolean;
	hasStarted: boolean;
	isDirty: boolean;
	skipJarAndEula: boolean;
	directoryInspection: ServerDirectoryInspectionResult | null;
	createdServerId: string | null;
	error: string | null;
	isSubmitting: boolean;
	updateField: <K extends keyof ServerSetupFormData>(key: K, value: ServerSetupFormData[K]) => void;
	setSlide: (slide: number) => void;
	nextSlide: () => void;
	prevSlide: () => void;
	continueToNext: () => void;
	startFlow: () => void;
	setCreatedServerId: (serverId: string | null) => void;
	setSkipJarAndEula: (value: boolean) => void;
	setError: (message: string | null) => void;
	clearError: () => void;
	inspectServerDirectory: (options?: {
		directory?: string;
		createDirectoryIfMissing?: boolean;
		silent?: boolean;
	}) => Promise<ServerDirectoryInspectionResult | null>;
	importServerFromDirectory: () => Promise<void>;
	createServer: () => Promise<void>;
	goToCreatedServer: () => void;
	setDirectoryFromExistingServer: (jarFileName: string) => void;
	resetDraft: () => void;
};

const DEFAULT_FORM = createDefaultServerSetupForm();

const sameArray = (left: string[], right: string[]) => {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
};

const isFormDirty = (form: ServerSetupFormData) => {
	if (form.directory !== DEFAULT_FORM.directory) return true;
	if (form.createDirectoryIfMissing !== DEFAULT_FORM.createDirectoryIfMissing) return true;
	if (form.file !== DEFAULT_FORM.file) return true;
	if (form.ram !== DEFAULT_FORM.ram) return true;
	if (form.storageLimit !== DEFAULT_FORM.storageLimit) return true;
	if (form.autoRestart !== DEFAULT_FORM.autoRestart) return true;
	if (!sameArray(form.autoBackup, DEFAULT_FORM.autoBackup)) return true;
	if (form.autoBackupInterval !== DEFAULT_FORM.autoBackupInterval) return true;
	if (form.autoAgreeEula !== DEFAULT_FORM.autoAgreeEula) return true;
	if (form.javaInstallation !== DEFAULT_FORM.javaInstallation) return true;
	if (form.provider !== DEFAULT_FORM.provider) return true;
	if (form.version !== DEFAULT_FORM.version) return true;
	return false;
};

const CreateServerContext = React.createContext<CreateServerContextValue | undefined>(undefined);

export const CreateServerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const navigate = useNavigate();
	const { servers, addServer } = useServers();
	const [form, setForm] = React.useState<ServerSetupFormData>(DEFAULT_FORM);
	const [slide, setSlide] = React.useState(0);
	const [hasStarted, setHasStarted] = React.useState(false);
	const [skipJarAndEula, setSkipJarAndEula] = React.useState(false);
	const [directoryInspection, setDirectoryInspection] =
		React.useState<ServerDirectoryInspectionResult | null>(null);
	const [createdServerId, setCreatedServerId] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = React.useState(false);

	const updateField = React.useCallback(
		<K extends keyof ServerSetupFormData>(key: K, value: ServerSetupFormData[K]) => {
			setForm((prev) => ({ ...prev, [key]: value }));
			setHasStarted(true);
		},
		[],
	);

	const nextSlide = React.useCallback(() => {
		setHasStarted(true);
		setSlide((prev) => getNextSlideIndex(prev, skipJarAndEula));
	}, [skipJarAndEula]);

	const prevSlide = React.useCallback(() => {
		setSlide((prev) => getPrevSlideIndex(prev, skipJarAndEula));
	}, [skipJarAndEula]);

	const clearError = React.useCallback(() => {
		setError(null);
	}, []);

	const continueToNext = React.useCallback(() => {
		clearError();
		nextSlide();
	}, [clearError, nextSlide]);

	const startFlow = React.useCallback(() => {
		setHasStarted(true);
		setSlide(1);
	}, []);

	const resetDraft = React.useCallback(() => {
		setForm(createDefaultServerSetupForm());
		setSlide(0);
		setHasStarted(false);
		setSkipJarAndEula(false);
		setDirectoryInspection(null);
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

	const setDirectoryFromExistingServer = React.useCallback(
		(jarFileName: string) => {
			const directory = form.directory.trim();
			const resolvedJar = joinDirectoryAndFile(directory, jarFileName);
			updateField('file', resolvedJar);
			updateField('autoAgreeEula', true);
		},
		[form.directory, updateField],
	);

	const findExistingServerByDirectory = React.useCallback(
		(directory: string) => {
			const normalized = normalizeDirectoryPath(directory);
			if (!normalized) return null;
			return servers.find((server) => normalizeDirectoryPath(server.directory) === normalized) ?? null;
		},
		[servers],
	);

	const inspectServerDirectory = React.useCallback(
		async (options?: { directory?: string; createDirectoryIfMissing?: boolean; silent?: boolean }) => {
			const directory = (options?.directory ?? form.directory).trim();
			const createDirectoryIfMissing =
				typeof options?.createDirectoryIfMissing === 'boolean'
					? options.createDirectoryIfMissing
					: form.createDirectoryIfMissing;
			const silent = options?.silent ?? false;

			if (!directory) {
				setDirectoryInspection(null);
				return null;
			}

			const existingServer = findExistingServerByDirectory(directory);
			if (existingServer) {
				const result: ServerDirectoryInspectionResult = {
					kind: 'already_in_mserve',
					exists: true,
					isDirectory: true,
					isEmpty: false,
					hasMserveJson: false,
					hasServerProperties: false,
					hasEulaTxt: false,
					firstJarFile: null,
					message: `This server is already in MSERVE as "${existingServer.name}".`,
				};
				setDirectoryInspection(result);
				if (!silent) {
					setError(result.message);
				}
				return result;
			}

			try {
				const result = await invoke<ServerDirectoryInspectionResult>('inspect_server_directory', {
					directory,
					createDirectoryIfMissing,
				});
				setDirectoryInspection(result);
				return result;
			} catch (err) {
				if (!silent) {
					const reason = err instanceof Error ? err.message : 'Unknown backend error.';
					setError(`Failed to inspect server directory. ${reason}`);
				}
				return null;
			}
		},
		[findExistingServerByDirectory, form.createDirectoryIfMissing, form.directory],
	);

	const importServerFromDirectory = React.useCallback(async () => {
		const directory = form.directory.trim();
		if (!directory) {
			setError('Please choose a server directory.');
			setSlide(1);
			return;
		}

		setError(null);
		setIsSubmitting(true);
		try {
			const importPromise = (async () => {
				const res = await invoke<InitServerResult>('import_server', { directory });
				if (!res.ok) {
					throw new Error(res.message || 'Failed to import server.');
				}
				return res;
			})();

			const importAndSyncPromise = (async () => {
				const result = await importPromise;

				let synced = await syncServerMserveJson(result.directory);
				let usedRepairDialog = false;
				let storageLimit = 200;

				if (synced.status === 'needs_setup') {
					const repairPayload = await requestMserveRepair({
						directory: result.directory,
						file: result.file || 'server.jar',
						ram: synced.config?.ram ?? 3,
						storageLimit,
						autoBackup: synced.config?.auto_backup ?? [],
						autoBackupInterval: synced.config?.auto_backup_interval ?? 120,
						autoRestart: synced.config?.auto_restart ?? false,
						createDirectoryIfMissing: true,
						autoAgreeEula: true,
						javaInstallation: synced.config?.java_installation ?? '',
						customFlags: synced.config?.custom_flags ?? [],
						provider: synced.config?.provider,
						version: synced.config?.version,
					});

					if (!repairPayload) {
						throw new Error('Import cancelled because mserve.json rebuild was not completed.');
					}

					storageLimit = repairPayload.storageLimit;
					synced = await repairServerMserveJson(repairPayload);
					usedRepairDialog = true;
				}

				if (!synced.config) {
					throw new Error('Could not resolve valid mserve.json data for this server.');
				}

				const addedServerId = addServer(buildImportedServer(result, synced.config, storageLimit));
				return {
					serverId: addedServerId,
					usedRepairDialog,
					autoRepaired: synced.updated,
				};
			})();

			await toast.promise(importAndSyncPromise, {
				loading: 'Importing server...',
				success: (result) =>
					result.usedRepairDialog
						? `Server "${getDirectoryName(directory)}" was imported and rebuilt mserve.json`
						: result.autoRepaired
							? `Server "${getDirectoryName(directory)}" was imported and automatically repaired mserve.json`
							: `Server "${getDirectoryName(directory)}" has been imported`,
				error: (err) => (err instanceof Error ? err.message : 'Failed to import server.'),
			});

			const result = await importAndSyncPromise;
			setCreatedServerId(result.serverId);
			setSlide(DONE_SLIDE_INDEX);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to import server.';
			setError(message);
		} finally {
			setIsSubmitting(false);
		}
	}, [addServer, form.directory]);

	const createServer = React.useCallback(async () => {
		setError(null);

		const directory = form.directory.trim();
		if (!directory) {
			setError('Please choose a server directory.');
			setSlide(1);
			return;
		}

		const existingServer = findExistingServerByDirectory(directory);
		if (existingServer) {
			setError(`This server is already in MSERVE as "${existingServer.name}".`);
			setSlide(1);
			return;
		}

		const directoryValidation = await invoke<PathValidationResult>('validate_path', {
			path: directory,
		});
		if (directoryValidation.exists && !directoryValidation.isDirectory) {
			setError('Server location must be a directory.');
			setSlide(1);
			return;
		}

		if (!form.createDirectoryIfMissing && !directoryValidation.exists) {
			setError(
				"Directory does not exist. Enable 'Create directory if it doesn't exist' or choose another path.",
			);
			setSlide(1);
			return;
		}

		const file = form.file.trim();
		if (!file) {
			setError('Please choose a server jar file.');
			setSlide(skipJarAndEula ? 1 : 2);
			return;
		}

		if (!file.toLowerCase().endsWith('.jar')) {
			setError('Server file must be a .jar file.');
			setSlide(skipJarAndEula ? 1 : 2);
			return;
		}

		const fileValidation = await invoke<PathValidationResult>('validate_path', { path: file });
		if (!fileValidation.exists || !fileValidation.isFile) {
			setError('Please choose a valid server jar file.');
			setSlide(skipJarAndEula ? 1 : 2);
			return;
		}

		if (skipJarAndEula) {
			setIsSubmitting(true);
			try {
				const importPromise = (async () => {
					const res = await invoke<InitServerResult>('import_server', { directory });
					if (!res.ok) {
						throw new Error(res.message || 'Failed to import server.');
					}
					return res;
				})();

				const importAndRepairPromise = (async () => {
					const result = await importPromise;

					const repairPayload = {
						directory: result.directory,
						createDirectoryIfMissing: true,
						file,
						ram: Math.max(1, Number(form.ram) || 3),
						storageLimit: Math.max(1, Number(form.storageLimit) || 200),
						autoBackup: form.autoBackup,
						autoBackupInterval: Math.max(1, Number(form.autoBackupInterval) || 120),
						autoRestart: form.autoRestart,
						autoAgreeEula: true,
						javaInstallation: form.javaInstallation,
						customFlags: [],
						provider: form.provider || undefined,
						version: form.version || undefined,
					};

					const synced = await repairServerMserveJson(repairPayload);
					if (!synced.config) {
						throw new Error('Could not finalize mserve.json for this server.');
					}

					const addedServerId = addServer(
						buildImportedServer(result, synced.config, repairPayload.storageLimit),
					);

					return { serverId: addedServerId };
				})();

				await toast.promise(importAndRepairPromise, {
					loading: 'Importing existing server...',
					success: () => `Server "${getDirectoryName(directory)}" has been imported and configured`,
					error: (err) => (err instanceof Error ? err.message : 'Failed to import server.'),
				});

				const result = await importAndRepairPromise;
				setCreatedServerId(result.serverId);
				setSlide(DONE_SLIDE_INDEX);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to import server.';
				setError(message);
			} finally {
				setIsSubmitting(false);
			}

			return;
		}

		setIsSubmitting(true);
		try {
			const payload: InitServerPayload = {
				directory,
				createDirectoryIfMissing: form.createDirectoryIfMissing,
				file: file || 'server.jar',
				ram: Math.max(1, Number(form.ram) || 3),
				storageLimit: Math.max(1, Number(form.storageLimit) || 200),
				autoRestart: form.autoRestart,
				autoBackup: form.autoBackup,
				autoBackupInterval: Math.max(1, Number(form.autoBackupInterval) || 120),
				autoAgreeEula: form.autoAgreeEula,
				javaInstallation: form.javaInstallation,
				provider: form.provider,
				version: form.version,
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
				success: () => `Server "${getDirectoryName(directory)}" has been created`,
				error: (err) => (err instanceof Error ? err.message : 'Failed to create server.'),
			});

			const result = await initializePromise;
			const serverId = addServer(buildServer(form, result));
			setCreatedServerId(serverId);
			setSlide(DONE_SLIDE_INDEX);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to initialize server.';
			setError(message);
		} finally {
			setIsSubmitting(false);
		}
	}, [addServer, findExistingServerByDirectory, form, skipJarAndEula]);

	React.useEffect(() => {
		if (slide !== DONE_SLIDE_INDEX || !createdServerId) return;

		const timeout = window.setTimeout(() => {
			goToCreatedServer();
		}, 5000);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [createdServerId, goToCreatedServer, slide]);

	const visibleStepSlides = skipJarAndEula ? [1, 3, 4, 5, 7] : [1, 2, 3, 4, 5, 6, 7];
	const totalSteps = visibleStepSlides.length;
	const currentStepIndex = visibleStepSlides.indexOf(slide);
	const currentStep = currentStepIndex >= 0 ? currentStepIndex + 1 : 1;
	const showBackButton = slide > 0 && slide < DONE_SLIDE_INDEX;
	const showStepIndicator = showBackButton;

	const value = React.useMemo<CreateServerContextValue>(
		() => ({
			form,
			slide,
			doneSlideIndex: DONE_SLIDE_INDEX,
			totalSteps,
			currentStep,
			showBackButton,
			showStepIndicator,
			hasStarted,
			isDirty: isFormDirty(form),
			skipJarAndEula,
			directoryInspection,
			createdServerId,
			error,
			isSubmitting,
			updateField,
			setSlide,
			nextSlide,
			prevSlide,
			continueToNext,
			startFlow,
			setCreatedServerId,
			setSkipJarAndEula,
			setError,
			clearError,
			inspectServerDirectory,
			importServerFromDirectory,
			createServer,
			goToCreatedServer,
			setDirectoryFromExistingServer,
			resetDraft,
		}),
		[
			clearError,
			continueToNext,
			createServer,
			createdServerId,
			currentStep,
			directoryInspection,
			error,
			form,
			goToCreatedServer,
			hasStarted,
			importServerFromDirectory,
			inspectServerDirectory,
			isSubmitting,
			nextSlide,
			prevSlide,
			resetDraft,
			setDirectoryFromExistingServer,
			showBackButton,
			showStepIndicator,
			skipJarAndEula,
			slide,
			startFlow,
			totalSteps,
			updateField,
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
