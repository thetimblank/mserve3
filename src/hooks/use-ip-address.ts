import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';

/** `null` while loading, `false` when the lookup failed. */
export type IpAddressValue = string | null | false;

type IpCommand = 'get_public_ip' | 'get_local_ip';

// One successful lookup per app session; a failure is retried on the next mount.
const pending = new Map<IpCommand, Promise<string | false>>();

const loadIpAddress = (command: IpCommand) => {
	let lookup = pending.get(command);
	if (!lookup) {
		lookup = invoke<string>(command)
			.then((ip) => ip || false)
			.catch(() => false as const)
			.then((ip) => {
				if (!ip) pending.delete(command);
				return ip;
			});
		pending.set(command, lookup);
	}
	return lookup;
};

const useIpAddress = (command: IpCommand): IpAddressValue => {
	const [ip, setIp] = React.useState<IpAddressValue>(null);

	React.useEffect(() => {
		let active = true;
		void loadIpAddress(command).then((value) => {
			if (active) setIp(value);
		});
		return () => {
			active = false;
		};
	}, [command]);

	return ip;
};

/** This machine's public IP (what players outside the network connect to). */
export const usePublicIp = () => useIpAddress('get_public_ip');

/** This machine's LAN IP. */
export const useLocalIp = () => useIpAddress('get_local_ip');
