import { describe, expect, it } from 'vitest';

import { MiniDeskApi } from '../credentials/MiniDeskApi.credentials';

describe('MiniDeskApi', () => {
	it('has one password field for the key and no base URL field', () => {
		const credential = new MiniDeskApi();

		expect(credential.properties.map((p) => p.name)).toEqual(['apiKey']);
		expect(credential.properties[0].typeOptions).toEqual({ password: true });
	});

	it('sends the key as a bearer token', () => {
		expect(new MiniDeskApi().authenticate).toEqual({
			type: 'generic',
			properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
		});
	});

	it('tests the key with the cheapest read', () => {
		expect(new MiniDeskApi().test.request).toEqual({
			baseURL: 'https://api.minidesk.ai/v1',
			url: '/tickets',
			method: 'GET',
			qs: { limit: 1 },
		});
	});
});
