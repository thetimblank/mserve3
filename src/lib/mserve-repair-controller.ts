import type { PromptMserveRepairOptions, RepairMserveJsonPayload } from '@/lib/mserve-sync';

type Request = {
	options: PromptMserveRepairOptions;
	resolve: (value: RepairMserveJsonPayload | null) => void;
};

type Handler = (request: Request) => void;

let handler: Handler | null = null;

export const registerMserveRepairHandler = (nextHandler: Handler) => {
	handler = nextHandler;
	return () => {
		if (handler === nextHandler) {
			handler = null;
		}
	};
};

export const requestMserveRepair = (options: PromptMserveRepairOptions) =>
	new Promise<RepairMserveJsonPayload | null>((resolve) => {
		if (!handler) {
			resolve(null);
			return;
		}

		handler({ options, resolve });
	});
