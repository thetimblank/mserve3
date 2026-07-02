/** Best-effort OS detection for cosmetic decisions (example paths, hints).
 * The webview's user agent reflects the host OS under Tauri on every platform.
 * Never use this for behavior the backend owns — the backend cfg()s that. */
export const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');

/** Platform-appropriate example paths for input placeholders. */
export const examplePaths = isWindows
	? {
			serverDirectory: 'C:\\servers\\MyServer',
			serverJar: 'C:\\servers\\server-1.21.11.jar',
			javaExecutable: 'C:\\Program Files\\Java\\jdk-25\\bin\\java.exe',
			serversRoot: 'C:\\Users\\you\\mserve\\servers',
		}
	: {
			serverDirectory: '/home/you/servers/MyServer',
			serverJar: '/home/you/servers/server-1.21.11.jar',
			javaExecutable: '/usr/lib/jvm/jdk-25/bin/java',
			serversRoot: '/home/you/mserve/servers',
		};
