import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { apiError } from '../nodes/MiniDesk/shared/errors';
import {
	idempotencyKey,
	miniDeskApiRequest,
	miniDeskApiRequestAllItems,
} from '../nodes/MiniDesk/shared/transport';
import { fakeExecuteContext, fakeLoadOptionsContext } from './helpers/fake-context';

const ticket = { statusCode: 201, body: { id: 't-1' } };

const keyOf = (call: IHttpRequestOptions) => call.headers?.['Idempotency-Key'];

async function keyFor(
	run: { runIndex?: number },
	path: string,
	body: IDataObject | undefined,
): Promise<unknown> {
	const { context, calls } = fakeExecuteContext({ params: {}, responses: [ticket], ...run });

	await miniDeskApiRequest.call(context, 'POST', path, { body, itemIndex: 0 });

	return keyOf(calls[0]);
}

async function refusal(
	response: { statusCode: number; body: unknown; headers?: IDataObject },
	itemIndex?: number,
): Promise<NodeApiError> {
	const { context } = fakeExecuteContext({ params: {}, responses: [response] });
	const result = await miniDeskApiRequest
		.call(context, 'POST', '/tickets/t-1/draft', { itemIndex })
		.then(
			() => undefined,
			(error: unknown) => error,
		);

	expect(result).toBeInstanceOf(NodeApiError);

	return result as NodeApiError;
}

describe('miniDeskApiRequest', () => {
	it('calls miniDesk through the miniDeskApi credential', async () => {
		const { context, calls, credentialTypes } = fakeExecuteContext({
			params: {},
			responses: [{ statusCode: 200, body: { data: [], next_cursor: null } }],
		});

		const body = await miniDeskApiRequest.call(context, 'GET', '/tickets');

		expect(body).toEqual({ data: [], next_cursor: null });
		expect(calls).toHaveLength(1);
		expect(credentialTypes).toEqual(['miniDeskApi']);
		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: 'https://api.minidesk.ai/v1/tickets',
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		});
	});

	it('sends the same Idempotency-Key when the same item is retried', async () => {
		const { context, calls } = fakeExecuteContext({ params: {}, responses: [ticket, ticket] });
		const send = () =>
			miniDeskApiRequest.call(context, 'POST', '/tickets/t-1/messages', {
				body: { body: 'Your refund is on its way', visibility: 'public' },
				itemIndex: 0,
			});

		await send();
		await send();

		expect(keyOf(calls[0])).toMatch(/^n8n-[0-9a-f]{64}$/);
		expect(keyOf(calls[1])).toBe(keyOf(calls[0]));
	});

	it('uses a different key for another run or another path', async () => {
		const note = { body: 'a' };

		// The fake's getExecuteData() has no runIndex, like n8n's outside AI tool calls.
		expect(await keyFor({ runIndex: 0 }, '/tickets/t-1/messages', note)).not.toBe(
			await keyFor({ runIndex: 1 }, '/tickets/t-1/messages', note),
		);
		expect(await keyFor({}, '/tickets/1/spam', note)).not.toBe(
			await keyFor({}, '/tickets/2/spam', note),
		);
	});

	it('keeps the key when a retry of the same item sends a new body', async () => {
		// e.g. a body built from {{$now}}: the API answers 409 instead of sending twice.
		expect(await keyFor({}, '/tickets/t-1/messages', { body: 'a' })).toBe(
			await keyFor({}, '/tickets/t-1/messages', { body: 'b' }),
		);
	});

	it('sends no Idempotency-Key on GET or DELETE', async () => {
		const { context, calls } = fakeExecuteContext({
			params: {},
			responses: [
				{ statusCode: 200, body: { id: 't-1' } },
				{ statusCode: 200, body: { deleted: true } },
			],
		});

		await miniDeskApiRequest.call(context, 'GET', '/tickets/t-1', { itemIndex: 0 });
		await miniDeskApiRequest.call(context, 'DELETE', '/knowledge/k-1', { itemIndex: 0 });

		expect(keyOf(calls[0])).toBeUndefined();
		expect(keyOf(calls[1])).toBeUndefined();
	});

	it('sends no Idempotency-Key on a POST made without an item index', async () => {
		const { context, calls } = fakeExecuteContext({
			params: {},
			responses: [{ statusCode: 201, body: { id: 'wh-1' } }],
		});

		await miniDeskApiRequest.call(context, 'POST', '/webhooks', {
			body: { url: 'https://n8n.example.com/webhook/abc', events: ['conversation.created'] },
		});

		expect(keyOf(calls[0])).toBeUndefined();
	});

	it('leaves empty query values out, since miniDesk refuses them', async () => {
		const { context, calls } = fakeExecuteContext({
			params: {},
			responses: [{ statusCode: 200, body: { data: [], next_cursor: null } }],
		});

		await miniDeskApiRequest.call(context, 'GET', '/customers', {
			qs: { q: '', email: undefined, cursor: null, limit: 50 },
		});

		expect(calls[0].qs).toEqual({ limit: 50 });
	});

	it('turns an API refusal into a NodeApiError with the item number', async () => {
		const error = await refusal(
			{ statusCode: 409, body: { error: { code: 'ai_disabled', message: 'AI is turned off' } } },
			2,
		);

		expect(error.message).toBe('AI is turned off for this workspace [Item 2]');
		expect(error.description).toBe('An owner can turn it on in miniDesk.');
		expect(error.httpCode).toBe('409');
	});

	it('explains a refused key', async () => {
		const error = await refusal({
			statusCode: 401,
			body: { error: { code: 'invalid_credential', message: 'Invalid API key' } },
		});

		expect(error.message.startsWith('miniDesk refused the API key')).toBe(true);
	});

	it('says how long to wait when rate limited', async () => {
		const error = await refusal({
			statusCode: 429,
			body: { error: { code: 'rate_limited', message: 'Too many requests' } },
			headers: { 'retry-after': '12' },
		});

		expect(error.description).toContain('Wait 12 seconds');
	});
});

describe('miniDeskApiRequestAllItems', () => {
	it('keeps paging past an empty page until next_cursor is null', async () => {
		const { context, calls } = fakeExecuteContext({
			params: {},
			responses: [
				{ statusCode: 200, body: { data: [], next_cursor: 'c1' } },
				{ statusCode: 200, body: { data: [{ id: 'a' }, { id: 'b' }], next_cursor: 'c2' } },
				{ statusCode: 200, body: { data: [{ id: 'c' }], next_cursor: null } },
			],
		});

		const items = await miniDeskApiRequestAllItems.call(context, '/tickets', {}, undefined);

		expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
		expect(calls).toHaveLength(3);
		expect(calls[0].qs?.cursor).toBeUndefined();
		expect(calls[1].qs?.cursor).toBe('c1');
		expect(calls[2].qs?.cursor).toBe('c2');
		expect(calls.map((call) => call.qs?.limit)).toEqual([100, 100, 100]);
	});

	it('stops at the limit and asks only for what is left', async () => {
		const { context, calls } = fakeExecuteContext({
			params: {},
			responses: [
				{ statusCode: 200, body: { data: [{ id: 'a' }, { id: 'b' }], next_cursor: 'c1' } },
				{ statusCode: 200, body: { data: [{ id: 'c' }, { id: 'd' }], next_cursor: 'c2' } },
			],
		});

		const items = await miniDeskApiRequestAllItems.call(context, '/tickets', { status: 'open' }, 3);

		expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
		expect(calls).toHaveLength(2);
		expect(calls[0].qs).toEqual({ status: 'open', limit: 3 });
		expect(calls[1].qs).toEqual({ status: 'open', limit: 1, cursor: 'c1' });
	});

	it('stops when miniDesk sends back the cursor it was given', async () => {
		const { context, calls } = fakeExecuteContext({
			params: {},
			responses: [
				{ statusCode: 200, body: { data: [{ id: 'a' }], next_cursor: 'c1' } },
				{ statusCode: 200, body: { data: [{ id: 'b' }], next_cursor: 'c1' } },
			],
		});

		const items = await miniDeskApiRequestAllItems.call(context, '/tickets', {}, undefined);

		expect(items.map((item) => item.id)).toEqual(['a', 'b']);
		expect(calls).toHaveLength(2);
	});

	it('pages from a list search too', async () => {
		const { context, calls } = fakeLoadOptionsContext({
			responses: [{ statusCode: 200, body: { data: [{ id: 'k-1' }], next_cursor: null } }],
		});

		const items = await miniDeskApiRequestAllItems.call(context, '/knowledge', {}, undefined);

		expect(items).toEqual([{ id: 'k-1' }]);
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/knowledge');
	});

	it('carries the item number into a refusal', async () => {
		const { context } = fakeExecuteContext({
			params: {},
			responses: [{ statusCode: 401, body: { error: { code: 'invalid_credential' } } }],
		});

		await expect(
			miniDeskApiRequestAllItems.call(context, '/tickets', {}, undefined, 4),
		).rejects.toThrow('miniDesk refused the API key [Item 4]');
	});
});

describe('idempotencyKey', () => {
	it('changes when any part of the request changes', () => {
		const base = {
			executionId: 'exec-1',
			nodeId: 'node-1',
			runIndex: 0,
			itemIndex: 0,
			method: 'POST',
			path: '/tickets',
		};
		const keys = [
			base,
			{ ...base, executionId: 'exec-2' },
			{ ...base, nodeId: 'node-2' },
			{ ...base, runIndex: 1 },
			{ ...base, itemIndex: 1 },
			{ ...base, method: 'PUT' },
			{ ...base, path: '/customers' },
		].map(idempotencyKey);

		expect(new Set(keys).size).toBe(keys.length);
		expect(idempotencyKey({ ...base })).toBe(keys[0]);
	});
});

describe('apiError', () => {
	const node = fakeExecuteContext({ params: {}, responses: [] }).context.getNode();
	const refuse = (statusCode: number, error: IDataObject, headers: IDataObject = {}) =>
		apiError(node, statusCode, { error }, headers, 0);

	it.each([
		[
			401,
			{ code: 'invalid_credential', message: 'Invalid API key' },
			'miniDesk refused the API key [Item 0]',
			"Check the key in the 'miniDesk API' credential. Keys are created in miniDesk under Settings → API, and a revoked key stops working at once.",
		],
		[
			403,
			{ code: 'forbidden', message: 'This key cannot read customers.' },
			'miniDesk does not allow this API key to do that [Item 0]',
			'This key cannot read customers.',
		],
		[
			404,
			{ code: 'not_found', message: 'Conversation not found' },
			'miniDesk could not find that item [Item 0]',
			'Check the ID or reference. It may have been deleted, or it may belong to another workspace.',
		],
		[
			400,
			{
				code: 'validation_failed',
				field: 'url',
				message: 'Use a public https address. This one is not allowed.',
			},
			'miniDesk can only send events to a public https address [Item 0]',
			'Set WEBHOOK_URL (N8N_WEBHOOK_URL on newer n8n versions) on your n8n instance to its public https address, then activate the workflow again.',
		],
		[
			400,
			{ code: 'validation_failed', field: 'requester.email', message: 'Enter a valid email.' },
			"miniDesk rejected the value of 'requester.email' [Item 0]",
			'Enter a valid email.',
		],
		[
			400,
			{ code: 'validation_failed', message: 'The body must be JSON.' },
			'miniDesk rejected the request [Item 0]',
			'The body must be JSON.',
		],
		[
			422,
			{ code: 'invalid_transition', message: 'A closed conversation cannot be reopened.' },
			'miniDesk does not allow that status change [Item 0]',
			'A closed conversation cannot be reopened.',
		],
		[
			409,
			{
				code: 'conflict',
				message: 'An owner paused this webhook. Ask them to resume it in miniDesk.',
			},
			'miniDesk refused the request [Item 0]',
			'An owner paused this webhook. Ask them to resume it in miniDesk.',
		],
		[
			409,
			{ code: 'ai_disabled', message: 'AI is turned off' },
			'AI is turned off for this workspace [Item 0]',
			'An owner can turn it on in miniDesk.',
		],
		[
			500,
			{ code: 'internal_error', message: 'Something went wrong (request req_example_123).' },
			'miniDesk could not complete the request [Item 0]',
			'Something went wrong (request req_example_123).',
		],
		[
			503,
			{ code: 'service_unavailable', message: 'miniDesk is busy. Try again shortly.' },
			'miniDesk could not complete the request [Item 0]',
			'miniDesk is busy. Try again shortly.',
		],
	])('explains a %i %o', (statusCode, error, message, description) => {
		const result = refuse(statusCode, error);

		expect(result).toBeInstanceOf(NodeApiError);
		expect(result.message).toBe(message);
		expect(result.description).toBe(description);
		expect(result.httpCode).toBe(String(statusCode));
	});

	it('gives the full rate limit advice', () => {
		const result = refuse(429, { code: 'rate_limited' }, { 'Retry-After': '1' });

		expect(result.message).toBe('Too many requests to miniDesk with this API key [Item 0]');
		expect(result.description).toBe(
			"Wait 1 second and try again, or turn on 'Retry On Fail' in the node settings.",
		);
	});

	it('leaves the item number out when there is no item', () => {
		const result = apiError(node, 404, { error: { code: 'not_found' } }, {}, undefined);

		expect(result.message).toBe('miniDesk could not find that item');
	});

	it.each([
		[502, '<html>Bad gateway</html>'],
		[504, ''],
		[503, undefined],
	])('says what to do when a %i has no miniDesk message', (statusCode, body) => {
		const result = apiError(node, statusCode, body, {}, 1);

		expect(result.message).toBe('miniDesk could not complete the request [Item 1]');
		expect(result.description).toBe(
			"Try again in a moment, or turn on 'Retry On Fail' in the node settings.",
		);
		expect(result.httpCode).toBe(String(statusCode));
	});
});
