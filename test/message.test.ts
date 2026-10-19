import { describe, expect, it } from 'vitest';

import { MiniDesk } from '../nodes/MiniDesk/MiniDesk.node';
import { fakeExecuteContext } from './helpers/fake-context';

type RunInput = Parameters<typeof fakeExecuteContext>[0];

async function run(input: RunInput) {
	const fake = fakeExecuteContext(input);
	const output = await new MiniDesk().execute.call(fake.context);

	return { ...fake, output: output[0] };
}

describe('miniDesk node, Message resource', () => {
	it('send reply posts a public message', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'message',
				operation: 'sendReply',
				conversation: { mode: 'id', value: 't-1' },
				body: 'Your refund is on its way',
				additionalFields: {},
			},
			responses: [
				{
					statusCode: 201,
					body: { id: 'm-1', visibility: 'public', created_at: '2026-10-17T09:00:00Z' },
				},
			],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets/t-1/messages');
		expect(calls[0].body).toEqual({ body: 'Your refund is on its way', visibility: 'public' });
		expect(calls[0].headers?.['Idempotency-Key']).toMatch(/^n8n-[0-9a-f]{64}$/);
		expect(output).toHaveLength(1);
		expect(output[0].json).toEqual({
			id: 'm-1',
			visibility: 'public',
			created_at: '2026-10-17T09:00:00Z',
		});
	});

	it('send reply passes the draft ID so miniDesk logs the AI draft', async () => {
		const { calls } = await run({
			params: {
				resource: 'message',
				operation: 'sendReply',
				conversation: { mode: 'id', value: 't-1' },
				body: 'Your refund is on its way',
				additionalFields: { draftId: 'd-1' },
			},
			responses: [
				{
					statusCode: 201,
					body: { id: 'm-1', visibility: 'public', created_at: '2026-10-17T09:00:00Z' },
				},
			],
		});

		expect(calls[0].body).toEqual({
			body: 'Your refund is on its way',
			visibility: 'public',
			draft_id: 'd-1',
		});
	});

	it('add internal note posts an internal message', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'message',
				operation: 'addNote',
				conversation: { mode: 'id', value: 't-1' },
				body: 'Customer called, was happy with the resolution',
			},
			responses: [
				{
					statusCode: 201,
					body: { id: 'm-2', visibility: 'internal', created_at: '2026-10-17T10:00:00Z' },
				},
			],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets/t-1/messages');
		expect(calls[0].body).toEqual({
			body: 'Customer called, was happy with the resolution',
			visibility: 'internal',
		});
		expect(output[0].json).toEqual({
			id: 'm-2',
			visibility: 'internal',
			created_at: '2026-10-17T10:00:00Z',
		});
	});

	it('get many messages returns each message as an item and honours the limit', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'message',
				operation: 'getAll',
				conversation: { mode: 'id', value: 't-1' },
				returnAll: false,
				limit: 2,
			},
			responses: [
				{
					statusCode: 200,
					body: {
						data: [
							{
								id: 'm-1',
								author_type: 'customer',
								author_name: 'Dana',
								body: 'My order never arrived',
								created_at: '2026-10-17T09:00:00Z',
							},
							{
								id: 'm-2',
								author_type: 'agent',
								author_name: 'Alex',
								body: 'Your refund is on its way',
								created_at: '2026-10-17T10:00:00Z',
							},
							{
								id: 'm-3',
								author_type: 'customer',
								author_name: 'Dana',
								body: 'Thank you',
								created_at: '2026-10-17T11:00:00Z',
							},
						],
					},
				},
			],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets/t-1/messages');
		expect(output).toHaveLength(2);
		expect(output[0].json.id).toBe('m-1');
		expect(output[1].json.id).toBe('m-2');
	});
});

describe('miniDesk node, Message description', () => {
	it('tells an AI agent that Send Reply reaches a real person', () => {
		const operations = new MiniDesk().description.properties.find(
			(property) =>
				property.name === 'operation' &&
				property.displayOptions?.show?.resource?.includes('message'),
		);
		const sendReply = (
			operations?.options as Array<{ value: string; description: string; action: string }>
		).find(({ value }) => value === 'sendReply');

		expect(sendReply).toMatchObject({
			description: 'Send a reply to the customer. This reaches a real person and cannot be unsent.',
			action: 'Send reply to customer that reaches a real person',
		});
	});
});

describe('miniDesk node, AI Draft resource', () => {
	it('create draft returns the waiting draft as it is', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'aiDraft',
				operation: 'create',
				conversation: { mode: 'id', value: 't-1' },
			},
			responses: [
				{
					statusCode: 200,
					body: {
						id: 'd-1',
						body: 'Hi Dana',
						created_at: '2026-10-17T09:00:00Z',
						existing: true,
					},
				},
			],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets/t-1/draft');
		expect(calls[0].headers?.['Idempotency-Key']).toMatch(/^n8n-[0-9a-f]{64}$/);
		expect(output).toHaveLength(1);
		expect(output[0].json).toEqual({
			id: 'd-1',
			body: 'Hi Dana',
			created_at: '2026-10-17T09:00:00Z',
			existing: true,
		});
	});

	it('create draft explains when AI is off', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'aiDraft',
				operation: 'create',
				conversation: { mode: 'id', value: 't-1' },
			},
			continueOnFail: true,
			responses: [
				{
					statusCode: 409,
					body: {
						error: {
							code: 'ai_disabled',
							message: 'AI is not enabled for this workspace',
						},
					},
				},
			],
		});

		expect(calls).toHaveLength(1);
		expect(output).toHaveLength(1);
		expect(output[0].json.error).toBe('AI is turned off for this workspace [Item 0]');
	});
});
