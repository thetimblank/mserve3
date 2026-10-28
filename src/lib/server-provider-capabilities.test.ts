import { describe, expect, it } from 'vitest';
import { inferProviderFromJarPath, inferVersionFromJarPath } from './server-provider-capabilities';

describe('inferProviderFromJarPath', () => {
	it('recognizes provider jar names', () => {
		expect(inferProviderFromJarPath('paper-1.21.4-232.jar')).toBe('paper');
		expect(inferProviderFromJarPath('purpur-1.21.4-2416.jar')).toBe('purpur');
		expect(inferProviderFromJarPath('velocity-3.4.0-SNAPSHOT-500.jar')).toBe('velocity');
		expect(inferProviderFromJarPath('minecraft_server.1.21.4.jar')).toBe('vanilla');
		expect(inferProviderFromJarPath('server.jar')).toBe('vanilla');
	});

	it('prefers specific providers over vanilla aliases inside the name', () => {
		expect(inferProviderFromJarPath('fabric-server-mc.1.21.1-loader.0.16.9-launcher.1.0.1.jar')).toBe('fabric');
		expect(inferProviderFromJarPath('forge-1.20.1-47.2.0-server.jar')).toBe('forge');
		expect(inferProviderFromJarPath('neoforge-21.1.77-server.jar')).toBe('neoforge');
	});

	it('ignores the directories in a full path', () => {
		expect(inferProviderFromJarPath('C:\\Users\\me\\Minecraft\\servers\\fabric-launch.jar')).toBe('fabric');
		expect(inferProviderFromJarPath('/home/paperboy/servers/custom.jar')).toBeNull();
	});
});

describe('inferVersionFromJarPath', () => {
	it('extracts only the Minecraft version, not the build or extension', () => {
		expect(inferVersionFromJarPath('paper-1.20.1-196.jar')).toBe('1.20.1');
		expect(inferVersionFromJarPath('C:\\servers\\1.19\\purpur-1.21.4-2416.jar')).toBe('1.21.4');
		expect(inferVersionFromJarPath('minecraft_server.1.21-pre1.jar')).toBe('1.21-pre1');
		expect(inferVersionFromJarPath('server.jar')).toBeNull();
	});
});
