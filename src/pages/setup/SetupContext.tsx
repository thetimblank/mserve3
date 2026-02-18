import React, { createContext, useContext, useEffect, useState } from 'react';

export interface SetupData {
	port: number;
	ip: string;
	domain: string;
	ip_hidden: boolean;
}

interface SetupContextType {
	data: SetupData;
	slide: number;
	updateData: <K extends keyof SetupData>(key: K, value: SetupData[K]) => void;
	nextSlide: () => void;
	prevSlide: () => void;
}

const SetupContext = createContext<SetupContextType | undefined>(undefined);

export const SetupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [slide, setSlide] = useState(0);
	const [data, setData] = useState<SetupData>({
		port: 25565,
		ip: '',
		domain: '',
		ip_hidden: true,
	});

	const updateData = <K extends keyof SetupData>(key: K, value: SetupData[K]) => {
		setData((prev) => ({ ...prev, [key]: value }));
	};

	useEffect(() => {
		const fetchIp = async () => {
			try {
				// TODO: locally fetch the IP through rust
				const response = await fetch('https://api.ipify.org?format=json');
				const { ip } = await response.json();
				updateData('ip', ip);
			} catch (err) {
				console.error(err);
			}
		};
		fetchIp();
	}, []);

	const nextSlide = () => setSlide((prev) => prev + 1);
	const prevSlide = () => setSlide((prev) => (prev > 0 ? prev - 1 : prev));

	return (
		<SetupContext.Provider value={{ data, slide, updateData, nextSlide, prevSlide }}>
			{children}
		</SetupContext.Provider>
	);
};

export const useSetup = () => {
	const context = useContext(SetupContext);
	if (!context) {
		throw new Error('useSetup must be used within a SetupProvider');
	}
	return context;
};
