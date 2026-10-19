import { describe, expect, it } from 'vitest';

import { API_BASE_URL } from '../nodes/MiniDesk/shared/constants';

describe('API_BASE_URL', () => {
	it('points at production, so a local testing edit cannot be published', () => {
		expect(API_BASE_URL).toBe('https://api.minidesk.ai/v1');
	});
});
