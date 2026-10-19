import { createHmac } from 'crypto';
import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { MiniDeskTrigger } from '../nodes/MiniDeskTrigger/MiniDeskTrigger.node';
import { fakeHookContext, fakeWebhookContext } from './helpers/fake-context';

const url = 'https://n8n.example.com/webhook/abc';
const secret = 'whsec_example_dummy';
const stored = { webhookId: 'wh-1', webhookSecret: secret };
const registered = { id: 'wh-1', url, events: ['conversation.created'], status: 'active' };
const notFound = { statusCode: 404, body: { error: { code: 'not_found', message: 'Not found' } } };

const hooks = new MiniDeskTrigger().webhookMethods.default;

const sign = (rawBody: string, key = secret) => {
	const timestamp = Math.floor(Date.now() / 1000);
	const v1 = createHmac('sha256', key).update(`${timestamp}.${rawBody}`).digest('hex');

	return `t=${timestamp},v1=${v1}`;
};

async function rejection(promise: Promise<unknown>): Promise<Error> {
	const error = await promise.then(
		() => undefined,
		(thrown: unknown) => thrown,
	);

	expect(error).toBeInstanceOf(Error);

	return error as Error;
}

type WebhookInput = Parameters<typeof fakeWebhookContext>[0];

// A delivery signed with the stored secret, for a node that listens to new conversations.
async function deliver(event: IDataObject, overrides: Partial<WebhookInput> = {}) {
	const rawBody = JSON.stringify(event);
	const { context, response } = fakeWebhookContext({
		params: { events: ['conversation.created'] },
		staticData: stored,
		headers: { 'minidesk-signature': sign(rawBody) },
		rawBody: Buffer.from(rawBody),
		body: event,
		...overrides,
	});
	const result = await new MiniDeskTrigger().webhook.call(context);

	return { result, response };
}

const conversation = { id: 't-1', reference: 'ACME-4F2KQ7', status: 'new' };
const message = { id: 'm-1', body: 'Where is my order?', author: 'dana@example.com' };
const created = {
	id: 'evt_1',
	type: 'conversation.created',
	created_at: '2026-10-17T09:00:00Z',
	data: { conversation, message },
};

describe('miniDesk Trigger, webhook registration', () => {
	it('create registers the n8n URL with the selected events and stores id and secret', async () => {
		const { context, calls, staticData } = fakeHookContext({
			params: { events: ['conversation.created'] },
			webhookUrl: url,
			responses: [{ statusCode: 201, body: { ...registered, secret } }],
		});

		await expect(hooks.create.call(context)).resolves.toBe(true);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			method: 'POST',
			url: 'https://api.minidesk.ai/v1/webhooks',
			body: { url, events: ['conversation.created'] },
		});
		expect(staticData).toEqual({ webhookId: 'wh-1', webhookSecret: secret });
	});

	it('create sends no Idempotency-Key', async () => {
		const { context, calls } = fakeHookContext({
			params: { events: ['conversation.created'] },
			responses: [{ statusCode: 200, body: { ...registered, secret } }],
		});
		// Even a context able to build a key gets none: a re-registration must never replay an old answer.
		Object.assign(context, {
			getExecutionId: () => 'exec-1',
			getWorkflowDataProxy: () => ({ $runIndex: 0 }),
		});

		await hooks.create.call(context);

		const headerNames = Object.keys(calls[0].headers ?? {}).map((name) => name.toLowerCase());

		expect(headerNames).not.toContain('idempotency-key');
	});

	it('create explains when n8n has no public https address', async () => {
		const { context, staticData } = fakeHookContext({
			params: { events: ['conversation.created'] },
			responses: [
				{
					statusCode: 400,
					body: {
						error: {
							code: 'validation_failed',
							field: 'url',
							message: 'This address is not allowed.',
						},
					},
				},
			],
		});

		const error = await rejection(hooks.create.call(context));

		expect(error.message).toMatch(/^miniDesk can only send events to a public https address/);
		expect(error.message).toContain('Set WEBHOOK_URL');
		expect(staticData).toEqual({});
	});

	it("create surfaces an owner's pause", async () => {
		const paused = 'An owner paused this webhook. Ask them to resume it in miniDesk.';
		const { context, calls, staticData } = fakeHookContext({
			params: { events: ['conversation.created'] },
			staticData: stored,
			responses: [{ statusCode: 409, body: { error: { code: 'conflict', message: paused } } }],
		});

		const error = await rejection(hooks.create.call(context));

		expect(error.message).toContain(paused);
		expect(staticData).toEqual(stored);
		expect(calls).toHaveLength(1);
	});

	it('create passes on a failure that is not a miniDesk refusal', async () => {
		const { context, staticData } = fakeHookContext({
			params: { events: ['conversation.created'] },
			responses: [],
		});
		Object.assign(context.helpers, {
			httpRequestWithAuthentication: async () => {
				throw new Error('socket hang up');
			},
		});

		const error = await rejection(hooks.create.call(context));

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toBe('socket hang up');
		expect(staticData).toEqual({});
	});

	it('checkExists returns false when nothing is stored', async () => {
		const { context, calls } = fakeHookContext({
			params: { events: ['conversation.created'] },
			responses: [],
		});

		await expect(hooks.checkExists.call(context)).resolves.toBe(false);
		expect(calls).toHaveLength(0);
	});

	it('checkExists returns false and forgets the webhook when miniDesk no longer has it', async () => {
		const { context, calls, staticData } = fakeHookContext({
			params: { events: ['conversation.created'] },
			staticData: stored,
			responses: [notFound],
		});

		await expect(hooks.checkExists.call(context)).resolves.toBe(false);
		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: 'https://api.minidesk.ai/v1/webhooks/wh-1',
		});
		expect(staticData).not.toHaveProperty('webhookId');
		expect(staticData).not.toHaveProperty('webhookSecret');
	});

	it('checkExists keeps the webhook when miniDesk fails for another reason', async () => {
		const { context, calls, staticData } = fakeHookContext({
			params: { events: ['conversation.created'] },
			staticData: stored,
			responses: [{ statusCode: 500, body: { error: { code: 'internal', message: 'req_1' } } }],
		});

		await rejection(hooks.checkExists.call(context));

		expect(calls).toHaveLength(1);
		expect(staticData).toEqual(stored);
	});

	it('checkExists returns false when the secret is missing, so create issues a new one', async () => {
		for (const webhookSecret of [undefined, '', 42]) {
			const { context, calls } = fakeHookContext({
				params: { events: ['conversation.created'] },
				webhookUrl: url,
				staticData: { webhookId: 'wh-1', webhookSecret },
				responses: [{ statusCode: 200, body: registered }],
			});

			await expect(hooks.checkExists.call(context)).resolves.toBe(false);
			expect(calls).toHaveLength(0);
		}
	});

	it('checkExists returns false when the webhook is paused', async () => {
		const { context, staticData } = fakeHookContext({
			params: { events: ['conversation.created'] },
			webhookUrl: url,
			staticData: stored,
			responses: [{ statusCode: 200, body: { ...registered, status: 'paused' } }],
		});

		await expect(hooks.checkExists.call(context)).resolves.toBe(false);
		expect(staticData.webhookId).toBe('wh-1');
	});

	it('checkExists returns false when the selected events changed', async () => {
		const { context } = fakeHookContext({
			params: { events: ['conversation.created', 'message.received'] },
			webhookUrl: url,
			staticData: stored,
			responses: [{ statusCode: 200, body: registered }],
		});

		await expect(hooks.checkExists.call(context)).resolves.toBe(false);
	});

	it('checkExists returns false when the n8n URL changed', async () => {
		const { context } = fakeHookContext({
			params: { events: ['conversation.created'] },
			webhookUrl: 'https://automations.example.com/webhook/abc',
			staticData: stored,
			responses: [{ statusCode: 200, body: registered }],
		});

		await expect(hooks.checkExists.call(context)).resolves.toBe(false);
	});

	it('checkExists returns true for an active webhook with the same URL and events', async () => {
		const { context, staticData } = fakeHookContext({
			params: { events: ['message.received', 'conversation.created'] },
			webhookUrl: url,
			staticData: stored,
			responses: [
				{
					statusCode: 200,
					body: { ...registered, events: ['conversation.created', 'message.received'] },
				},
			],
		});

		await expect(hooks.checkExists.call(context)).resolves.toBe(true);
		expect(staticData).toEqual(stored);
	});

	it('delete removes the webhook and tolerates a 404', async () => {
		for (const response of [{ statusCode: 204, body: '' }, notFound]) {
			const { context, calls, staticData } = fakeHookContext({
				params: { events: ['conversation.created'] },
				staticData: stored,
				responses: [response],
			});

			await expect(hooks.delete.call(context)).resolves.toBe(true);
			expect(calls).toHaveLength(1);
			expect(calls[0]).toMatchObject({
				method: 'DELETE',
				url: 'https://api.minidesk.ai/v1/webhooks/wh-1',
			});
			expect(staticData).toEqual({});
		}
	});

	it('delete does nothing when nothing is stored', async () => {
		const { context, calls } = fakeHookContext({
			params: { events: ['conversation.created'] },
			responses: [],
		});

		await expect(hooks.delete.call(context)).resolves.toBe(true);
		expect(calls).toHaveLength(0);
	});

	it('delete keeps the stored webhook when miniDesk refuses (owner pause)', async () => {
		const paused = 'An owner paused this webhook. Ask them to resume or delete it in miniDesk.';
		const { context, calls, staticData } = fakeHookContext({
			params: { events: ['conversation.created'] },
			staticData: stored,
			responses: [{ statusCode: 409, body: { error: { code: 'conflict', message: paused } } }],
		});

		await expect(hooks.delete.call(context)).resolves.toBe(false);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			method: 'DELETE',
			url: 'https://api.minidesk.ai/v1/webhooks/wh-1',
		});
		expect(staticData).toEqual(stored);
	});

	it('delete keeps the webhook when miniDesk refuses for another reason', async () => {
		const { context, staticData } = fakeHookContext({
			params: { events: ['conversation.created'] },
			staticData: stored,
			responses: [{ statusCode: 500, body: { error: { code: 'internal', message: 'req_1' } } }],
		});

		await expect(hooks.delete.call(context)).resolves.toBe(false);
		expect(staticData).toEqual(stored);
	});
});

describe('miniDesk Trigger, deliveries', () => {
	it('answers a delivery that starts the workflow with 200 and no body', () => {
		const [webhook] = new MiniDeskTrigger().description.webhooks ?? [];

		expect(webhook).toMatchObject({ responseMode: 'onReceived', responseData: 'noData' });
	});

	it('webhook refuses an unsigned request with 401 and does not start the workflow', async () => {
		const { result, response } = await deliver(created, { headers: {} });

		expect(response.status).toBe(401);
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('webhook refuses a body changed after signing', async () => {
		const { result, response } = await deliver(created, {
			headers: { 'minidesk-signature': sign(JSON.stringify(created)) },
			rawBody: Buffer.from(JSON.stringify({ ...created, id: 'evt_9' })),
		});

		expect(response.status).toBe(401);
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('webhook refuses a signature made with another secret', async () => {
		const { result, response } = await deliver(created, {
			headers: { 'minidesk-signature': sign(JSON.stringify(created), 'whsec_other_dummy') },
		});

		expect(response.status).toBe(401);
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('webhook refuses a signature header sent twice', async () => {
		const rawBody = JSON.stringify(created);
		// Node joins a repeated header into one string with ", ".
		const { result, response } = await deliver(created, {
			headers: { 'minidesk-signature': `${sign(rawBody)}, ${sign(rawBody)}` },
		});

		expect(response.status).toBe(401);
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('webhook refuses when no secret is stored', async () => {
		const { result, response } = await deliver(created, { staticData: {} });

		expect(response.status).toBe(401);
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('webhook refuses when the raw body is missing', async () => {
		const { result, response } = await deliver(created, { rawBody: undefined });

		expect(response.status).toBe(401);
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('webhook refuses a signed body that is not JSON', async () => {
		const rawBody = 'not json';
		const { result, response } = await deliver(created, {
			headers: { 'minidesk-signature': sign(rawBody) },
			rawBody,
		});

		expect(response.status).toBe(401);
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('webhook answers a ping with 200 without starting the workflow', async () => {
		const { result, response } = await deliver({
			id: 'evt_2',
			type: 'ping',
			created_at: '2026-10-17T09:00:00Z',
			data: {},
		});

		expect(response.status).toBe(200);
		expect(response.sent).toEqual({ ok: true });
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('webhook ignores events that were not selected', async () => {
		const { result, response } = await deliver({ ...created, type: 'message.received' });

		expect(response.status).toBeUndefined();
		expect(result).toEqual({});
	});

	it('webhook outputs id, type, created_at and the event data', async () => {
		const { result, response } = await deliver(created);

		expect(response.status).toBeUndefined();
		expect(result).toEqual({
			workflowData: [
				[
					{
						json: {
							id: 'evt_1',
							type: 'conversation.created',
							created_at: '2026-10-17T09:00:00Z',
							conversation,
							message,
						},
					},
				],
			],
		});
	});

	it('webhook reads the event from the signed raw body, not the parsed body', async () => {
		const forged = { ...created, data: { conversation: { ...conversation, id: 't-2' } } };
		const { result } = await deliver(created, { body: forged });

		expect(result.workflowData?.[0][0].json.conversation).toEqual(conversation);
	});
});
