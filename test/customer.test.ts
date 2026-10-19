import { describe, expect, it } from 'vitest';

import { MiniDesk } from '../nodes/MiniDesk/MiniDesk.node';
import { fakeExecuteContext } from './helpers/fake-context';

type RunInput = Parameters<typeof fakeExecuteContext>[0];

async function run(input: RunInput) {
	const fake = fakeExecuteContext(input);
	const output = await new MiniDesk().execute.call(fake.context);

	return { ...fake, output: output[0] };
}

describe('miniDesk node, Customer resource', () => {
	it('create or update sends only the fields that are set', async () => {
		const { calls } = await run({
			params: {
				resource: 'customer',
				operation: 'upsert',
				email: 'dana@example.com',
				additionalFields: { name: 'Dana' },
			},
			responses: [
				{
					statusCode: 201,
					body: {
						id: 'c-1',
						email: 'dana@example.com',
						name: 'Dana',
						external_id: null,
						is_verified: false,
						note: null,
						created_at: '2026-10-19T10:00:00Z',
					},
				},
			],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('PUT');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/customers');
		expect(calls[0].body).toEqual({ email: 'dana@example.com', name: 'Dana' });
		expect(calls[0].headers?.['Idempotency-Key']).toMatch(/^n8n-[0-9a-f]{64}$/);
	});

	it('create or update trims the email and refuses an empty one', async () => {
		const { calls } = await run({
			params: {
				resource: 'customer',
				operation: 'upsert',
				email: '  dana@example.com ',
				additionalFields: {},
			},
			responses: [{ statusCode: 200, body: { id: 'c-1', email: 'dana@example.com' } }],
		});

		expect(calls[0].body).toEqual({ email: 'dana@example.com' });

		const fake = fakeExecuteContext({
			params: { resource: 'customer', operation: 'upsert', email: '   ', additionalFields: {} },
			responses: [],
		});
		const error = await new MiniDesk().execute.call(fake.context).then(
			() => undefined,
			(thrown: unknown) => thrown,
		);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe("'Email' is empty [Item 0]");
		expect(fake.calls).toHaveLength(0);
	});

	it('get by email returns the one customer', async () => {
		const c1 = {
			id: 'c-1',
			email: 'dana@example.com',
			name: 'Dana',
			external_id: null,
			is_verified: true,
			note: null,
			created_at: '2026-10-19T10:00:00Z',
		};
		const { calls, output } = await run({
			params: {
				resource: 'customer',
				operation: 'get',
				lookupBy: 'email',
				email: 'dana@example.com',
			},
			responses: [{ statusCode: 200, body: { data: [c1], next_cursor: null } }],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/customers');
		expect(calls[0].qs).toEqual({ email: 'dana@example.com' });
		expect(output).toHaveLength(1);
		expect(output[0].json).toEqual(c1);
	});

	it('get by email explains when nobody has that email', async () => {
		const fake = fakeExecuteContext({
			params: {
				resource: 'customer',
				operation: 'get',
				lookupBy: 'email',
				email: 'dana@example.com',
			},
			responses: [{ statusCode: 200, body: { data: [], next_cursor: null } }],
		});
		const error = await new MiniDesk().execute.call(fake.context).then(
			() => undefined,
			(thrown: unknown) => thrown,
		);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe("No customer with email 'dana@example.com' [Item 0]");
	});

	it('get by id does not read or require email', async () => {
		const c1 = {
			id: 'c-1',
			email: 'dana@example.com',
			name: 'Dana',
			external_id: null,
			is_verified: true,
			note: null,
			created_at: '2026-10-19T10:00:00Z',
		};
		const { calls, output } = await run({
			params: {
				resource: 'customer',
				operation: 'get',
				lookupBy: 'id',
				customerId: 'c-1',
			},
			responses: [{ statusCode: 200, body: c1 }],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/customers/c-1');
		expect(calls[0].qs).toBeUndefined();
		expect(output).toHaveLength(1);
		expect(output[0].json).toEqual(c1);
	});
});
