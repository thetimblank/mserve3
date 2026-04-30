import type { JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { Server } from '@/data/servers';
import ServerSettingsPanel from './server-settings-panel';

interface Props {
	clearTerminalSession: () => void;
	server: Server;
	javaRuntimes: JavaRuntimeInfo[];
	isBusy: boolean;
	setIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
	syncServerContents: () => Promise<void>;
}

export default function ServerSettingsTab({
	clearTerminalSession,
	server,
	javaRuntimes,
	isBusy,
	setIsBusy,
	syncServerContents,
}: Props) {
	return (
		<ServerSettingsPanel
			{...{ clearTerminalSession, server, javaRuntimes, isBusy, setIsBusy, syncServerContents }}
		/>
	);
}
