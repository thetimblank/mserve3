import React, { createContext, useContext, useState } from 'react';
import { useSlideshow } from '@/components/slideshow';
import { DEFAULT_MINECRAFT_PORT, FIRST_BRANCH_STEP_INDEX, type HostingPath } from './setup-steps';

type SetupData = {
	port: number;
	ip_hidden: boolean;
	/** The branch picked on the choice slide (`null` until then). */
	path: HostingPath | null;
	/** The router forwards the port on request (UPnP), so servers started here use it. */
	upnp: boolean;
};

type SetupContextType = {
	data: SetupData;
	updateData: <K extends keyof SetupData>(key: K, value: SetupData[K]) => void;
	/** Picks a branch and jumps to its first slide (also used to switch branches). */
	choosePath: (path: HostingPath) => void;
};

const SetupContext = createContext<SetupContextType | undefined>(undefined);

/** The answers the hosting setup slides share (slide navigation is `useSlideshow`). */
export const SetupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { goToSlide } = useSlideshow();
	const [data, setData] = useState<SetupData>({
		port: DEFAULT_MINECRAFT_PORT,
		ip_hidden: true,
		path: null,
		upnp: false,
	});

	const updateData = React.useCallback(<K extends keyof SetupData>(key: K, value: SetupData[K]) => {
		setData((prev) => ({ ...prev, [key]: value }));
	}, []);

	const choosePath = React.useCallback(
		(path: HostingPath) => {
			setData((prev) => ({ ...prev, path }));
			goToSlide(FIRST_BRANCH_STEP_INDEX);
		},
		[goToSlide],
	);

	const value = React.useMemo(() => ({ data, updateData, choosePath }), [data, updateData, choosePath]);

	return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
};

export const useSetup = () => {
	const context = useContext(SetupContext);
	if (!context) {
		throw new Error('useSetup must be used within a SetupProvider');
	}
	return context;
};
