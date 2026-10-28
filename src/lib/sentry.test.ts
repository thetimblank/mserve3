import { describe, expect, it } from 'vitest';
import { scrubHomeDirs } from './sentry';

describe('scrubHomeDirs', () => {
	it('replaces the account name in Windows, Linux and macOS home paths', () => {
		const event = {
			message: 'Failed to read C:\\Users\\alex\\mserve\\servers\\survival\\mserve.json',
			extra: { java: '/home/alex/.jdks/temurin-21/bin/java', mac: '/Users/alex/servers' },
		};
		expect(scrubHomeDirs(event)).toEqual({
			message: 'Failed to read C:\\Users\\~\\mserve\\servers\\survival\\mserve.json',
			extra: { java: '/home/~/.jdks/temurin-21/bin/java', mac: '/Users/~/servers' },
		});
	});

	it('leaves other paths alone', () => {
		expect(scrubHomeDirs({ message: 'D:\\servers\\lobby' })).toEqual({ message: 'D:\\servers\\lobby' });
	});
});
