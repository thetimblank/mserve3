import React, { createContext, useContext, useState } from 'react';

type SetupData = {
	port: number;
	ip_hidden: boolean;
};

type SetupContextType = {
	data: SetupData;
	updateData: <K extends keyof SetupData>(key: K, value: SetupData[K]) => void;
};

const SetupContext = createContext<SetupContextType | undefined>(undefined);

/** The answers the hosting setup slides share (slide navigation is `useSlideshow`). */
export const SetupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [data, setData] = useState<SetupData>({ port: 25565, ip_hidden: true });

	const updateData = React.useCallback(<K extends keyof SetupData>(key: K, value: SetupData[K]) => {
		setData((prev) => ({ ...prev, [key]: value }));
	}, []);

	return <SetupContext.Provider value={{ data, updateData }}>{children}</SetupContext.Provider>;
};

export const useSetup = () => {
	const context = useContext(SetupContext);
	if (!context) {
		throw new Error('useSetup must be used within a SetupProvider');
	}
	return context;
};
