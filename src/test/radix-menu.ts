import { fireEvent, screen } from '@testing-library/react';

/** Radix opens menus on pointerdown or Enter; jsdom has no PointerEvent, so use the key. */
export const openMenu = (trigger: HTMLElement): HTMLElement => {
	fireEvent.keyDown(trigger, { key: 'Enter' });
	return screen.getByRole('menu');
};
