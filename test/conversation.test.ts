import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { ExpressionError, NodeApiError, NodeHelpers, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { MiniDesk } from '../nodes/MiniDesk/MiniDesk.node';
import { searchConversations, searchDocuments, searchMembers } from '../nodes/MiniDesk/listSearch';
import { fakeExecuteContext, fakeLoadOptionsContext } from './helpers/fake-context';

const ticket = {
	id: 't-1',
	reference: 'ACME-4F2KQ7',
	status: 'new',
	priority: 'normal',
	category: null,
	source: 'api',
	language: 'en',
	requester: { id: 'r-1', email: 'dana@example.com', name: 'Dana', is_verified: false },
	created_at: '2026-10-17T09:00:00Z',
	updated_at: '2026-10-17T09:00:00Z',
};

const simplifiedKeys = [
	'id',
	'reference',
	'status',
	'priority',
	'category',
	'language',
	'customer_email',
	'customer_name',
	'created_at',
	'updated_at',
];

type RunInput = Parameters<typeof fakeExecuteContext>[0];

async function run(input: RunInput) {
	const fake = fakeExecuteContext(input);
	const output = await new MiniDesk().execute.call(fake.context);

	return { ...fake, output: output[0] as INodeExecutionData[] };
}

async function refusal(input: RunInput) {
	const fake = fakeExecuteContext(input);
	const error = await new MiniDesk().execute.call(fake.context).then(
		() => undefined,
		(thrown: unknown) => thrown,
	);

	expect(error).toBeInstanceOf(Error);

	return { ...fake, error: error as Error };
}

const byId = { mode: 'id', value: 't-1' };

describe('miniDesk node, Conversation resource', () => {
	it("create saves the text as the customer's message", async () => {
		const { calls } = await run({
			params: {
				resource: 'conversation',
				operation: 'create',
				customerEmail: 'dana@example.com',
				body: 'My order never arrived',
				additionalFields: {},
			},
			responses: [{ statusCode: 201, body: ticket }],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets');
		expect(calls[0].body).toEqual({
			body: 'My order never arrived',
			requester: { email: 'dana@example.com' },
		});
		expect(calls[0].body).not.toHaveProperty('first_message_from');
		expect(calls[0].headers?.['Idempotency-Key']).toMatch(/^n8n-[0-9a-f]{64}$/);
	});

	it('create sends the optional fields only when they are set', async () => {
		const { calls } = await run({
			params: {
				resource: 'conversation',
				operation: 'create',
				customerEmail: '',
				body: 'My order never arrived',
				additionalFields: {
					customerName: 'Dana',
					externalId: 'user-42',
					priority: 'high',
					category: '',
					language: 'fr',
				},
			},
			responses: [{ statusCode: 201, body: ticket }],
		});

		expect(calls[0].body).toEqual({
			body: 'My order never arrived',
			requester: { name: 'Dana', external_id: 'user-42' },
			priority: 'high',
			language: 'fr',
		});
	});

	it('create refuses without an email or external ID before calling miniDesk', async () => {
		const { error, calls } = await refusal({
			params: {
				resource: 'conversation',
				operation: 'create',
				customerEmail: '',
				body: 'My order never arrived',
				additionalFields: { customerName: 'Dana' },
			},
			responses: [],
		});

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toBe("Add a 'Customer Email' or an 'External ID' [Item 0]");
		expect(calls).toHaveLength(0);
	});

	it('message customer sends first_message_from team and passes delivery through', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'conversation',
				operation: 'messageCustomer',
				customerEmail: 'dana@example.com',
				body: 'Your replacement ships today',
				additionalFields: { customerName: 'Dana' },
				simplify: true,
			},
			responses: [{ statusCode: 201, body: { ...ticket, source: 'agent', delivery: 'held' } }],
		});

		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets');
		expect(calls[0].body).toEqual({
			body: 'Your replacement ships today',
			requester: { email: 'dana@example.com', name: 'Dana' },
			first_message_from: 'team',
		});
		expect(calls[0].headers?.['Idempotency-Key']).toMatch(/^n8n-[0-9a-f]{64}$/);
		expect(output).toHaveLength(1);
		expect(output[0].json.delivery).toBe('held');
		expect(output[0].json.customer_email).toBe('dana@example.com');
		expect(output[0].json).not.toHaveProperty('requester');
	});

	it('message customer refuses without an email before calling miniDesk', async () => {
		const { error, calls } = await refusal({
			params: {
				resource: 'conversation',
				operation: 'messageCustomer',
				customerEmail: '  ',
				body: 'Your replacement ships today',
				additionalFields: {},
			},
			responses: [],
		});

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toBe("Add a 'Customer Email' [Item 0]");
		expect(calls).toHaveLength(0);
	});

	it('get resolves a reference to the exact conversation', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'conversation',
				operation: 'get',
				conversation: { mode: 'reference', value: 'ACME-4F2KQ7' },
			},
			responses: [
				{
					statusCode: 200,
					body: {
						// Search also finds conversations whose messages mention the reference.
						data: [
							{ id: 't-2', reference: 'ACME-9HW3RT' },
							{ id: 't-1', reference: 'ACME-4F2KQ7' },
						],
						next_cursor: null,
					},
				},
				{ statusCode: 200, body: { ...ticket, messages: [] } },
			],
		});

		expect(calls).toHaveLength(2);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets');
		expect(calls[0].qs).toEqual({ q: 'ACME-4F2KQ7', limit: 100 });
		expect(calls[1].method).toBe('GET');
		expect(calls[1].url).toBe('https://api.minidesk.ai/v1/tickets/t-1');
		expect(output[0].json.id).toBe('t-1');
	});

	it('get matches a reference typed in another case', async () => {
		const { calls } = await run({
			params: {
				resource: 'conversation',
				operation: 'get',
				conversation: { mode: 'reference', value: ' acme-4f2kq7 ' },
			},
			responses: [
				{
					statusCode: 200,
					body: { data: [{ id: 't-1', reference: 'ACME-4F2KQ7' }], next_cursor: null },
				},
				{ statusCode: 200, body: { ...ticket, messages: [] } },
			],
		});

		expect(calls[0].qs).toEqual({ q: 'acme-4f2kq7', limit: 100 });
		expect(calls[1].url).toBe('https://api.minidesk.ai/v1/tickets/t-1');
	});

	it('get keeps paging until it finds the exact reference', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'conversation',
				operation: 'get',
				conversation: { mode: 'reference', value: 'ACME-4F2KQ7' },
			},
			responses: [
				{
					statusCode: 200,
					body: { data: [{ id: 't-2', reference: 'ACME-9HW3RT' }], next_cursor: 'c1' },
				},
				{
					statusCode: 200,
					body: { data: [{ id: 't-1', reference: 'ACME-4F2KQ7' }], next_cursor: 'c2' },
				},
				{ statusCode: 200, body: { ...ticket, messages: [] } },
			],
		});

		expect(calls).toHaveLength(3);
		expect(calls[0].qs).toEqual({ q: 'ACME-4F2KQ7', limit: 100 });
		expect(calls[1].qs).toEqual({ q: 'ACME-4F2KQ7', limit: 100, cursor: 'c1' });
		expect(calls[2].url).toBe('https://api.minidesk.ai/v1/tickets/t-1');
		expect(output[0].json.id).toBe('t-1');
	});

	it('get explains when no conversation has that reference', async () => {
		const { error, calls } = await refusal({
			params: {
				resource: 'conversation',
				operation: 'get',
				conversation: { mode: 'reference', value: 'ACME-4F2KQ7' },
			},
			responses: [
				{
					statusCode: 200,
					body: { data: [{ id: 't-2', reference: 'ACME-9HW3RT' }], next_cursor: 'c1' },
				},
				{
					statusCode: 200,
					body: { data: [{ id: 't-3', reference: 'ACME-7KX4PQ' }], next_cursor: null },
				},
			],
		});

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toBe("No conversation with reference 'ACME-4F2KQ7' [Item 0]");
		expect(calls).toHaveLength(2);
	});

	it('get refuses an empty conversation before calling miniDesk', async () => {
		const { error, calls } = await refusal({
			params: {
				resource: 'conversation',
				operation: 'get',
				conversation: { mode: 'id', value: '' },
			},
			responses: [],
		});

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toBe("'Conversation' is empty [Item 0]");
		expect(calls).toHaveLength(0);
	});

	it('get simplifies to ten fields by default', async () => {
		const { calls, output } = await run({
			params: { resource: 'conversation', operation: 'get', conversation: byId },
			responses: [{ statusCode: 200, body: { ...ticket, messages: [{ id: 'm-1' }] } }],
		});

		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets/t-1');
		expect(Object.keys(output[0].json)).toEqual(simplifiedKeys);
		expect(output[0].json).toMatchObject({
			customer_email: 'dana@example.com',
			customer_name: 'Dana',
		});
	});

	it('get returns the raw conversation with its messages when simplify is off', async () => {
		const raw = { ...ticket, messages: [{ id: 'm-1' }] };
		const { output } = await run({
			params: { resource: 'conversation', operation: 'get', conversation: byId, simplify: false },
			responses: [{ statusCode: 200, body: raw }],
		});

		expect(output[0].json).toEqual(raw);
	});

	it('get many sends the filters as miniDesk expects', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'conversation',
				operation: 'getAll',
				returnAll: false,
				limit: 50,
				filters: {
					status: ['open', 'pending'],
					search: 'refund',
					category: '',
					assignee: { mode: 'id', value: 'm-1' },
				},
			},
			responses: [{ statusCode: 200, body: { data: [ticket], next_cursor: null } }],
		});

		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets');
		expect(calls[0].qs).toMatchObject({
			status: 'open,pending',
			q: 'refund',
			assignee_id: 'm-1',
			limit: 50,
		});
		expect(calls[0].qs).not.toHaveProperty('category');
		expect(calls[0].qs).not.toHaveProperty('priority');
		expect(output).toHaveLength(1);
		expect(Object.keys(output[0].json)).toEqual(simplifiedKeys);
	});

	it('get many with return all follows every page', async () => {
		const { calls, output } = await run({
			params: { resource: 'conversation', operation: 'getAll', returnAll: true, filters: {} },
			responses: [
				{ statusCode: 200, body: { data: [ticket], next_cursor: 'c1' } },
				{ statusCode: 200, body: { data: [{ ...ticket, id: 't-2' }], next_cursor: null } },
			],
		});

		expect(calls).toHaveLength(2);
		expect(calls[0].qs).toEqual({ limit: 100 });
		expect(calls[1].qs).toEqual({ limit: 100, cursor: 'c1' });
		expect(output.map((item) => item.json.id)).toEqual(['t-1', 't-2']);
	});

	it('update refuses an empty update before calling miniDesk', async () => {
		const { error, calls } = await refusal({
			params: {
				resource: 'conversation',
				operation: 'update',
				conversation: byId,
				updateFields: { category: '', unassign: false },
			},
			responses: [],
		});

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toBe("Add at least one field to 'Update Fields' [Item 0]");
		expect(calls).toHaveLength(0);
	});

	it('update can unassign', async () => {
		const { calls } = await run({
			params: {
				resource: 'conversation',
				operation: 'update',
				conversation: byId,
				updateFields: { unassign: true },
			},
			responses: [{ statusCode: 200, body: ticket }],
		});

		expect(calls[0].method).toBe('PATCH');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets/t-1');
		expect(calls[0].body).toEqual({ assignee_id: null });
	});

	it('update sends the fields that are set and the assignee picked from the list', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'conversation',
				operation: 'update',
				conversation: byId,
				updateFields: {
					status: 'pending',
					priority: 'urgent',
					assignee: { mode: 'list', value: 'm-1' },
				},
			},
			responses: [{ statusCode: 200, body: ticket }],
		});

		expect(calls[0].body).toEqual({ status: 'pending', priority: 'urgent', assignee_id: 'm-1' });
		expect(output[0].json).toEqual(ticket);
	});

	it('update refuses an assignee and unassign together', async () => {
		const { error, calls } = await refusal({
			params: {
				resource: 'conversation',
				operation: 'update',
				conversation: byId,
				updateFields: { assignee: { mode: 'id', value: 'm-1' }, unassign: true },
			},
			responses: [],
		});

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toBe("Choose either 'Assignee' or 'Unassign', not both [Item 0]");
		expect(calls).toHaveLength(0);
	});

	it('mark as spam posts to the spam endpoint', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'conversation',
				operation: 'markAsSpam',
				conversation: { mode: 'list', value: 't-1' },
			},
			responses: [{ statusCode: 200, body: { id: 't-1', spam: true } }],
		});

		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets/t-1/spam');
		expect(calls[0].headers?.['Idempotency-Key']).toMatch(/^n8n-[0-9a-f]{64}$/);
		expect(output).toEqual([{ json: { id: 't-1', spam: true }, pairedItem: { item: 0 } }]);
	});

	it('pairs each output item with the input item it came from', async () => {
		const { output } = await run({
			params: { resource: 'conversation', operation: 'get', conversation: byId },
			items: 2,
			responses: [
				{ statusCode: 200, body: ticket },
				{ statusCode: 200, body: { ...ticket, id: 't-2' } },
			],
		});

		expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
	});

	it('continue on fail turns a refusal into an output item', async () => {
		const { output } = await run({
			params: { resource: 'conversation', operation: 'get', conversation: byId },
			continueOnFail: true,
			responses: [
				{ statusCode: 404, body: { error: { code: 'not_found', message: 'Ticket not found' } } },
			],
		});

		expect(output).toEqual([
			{ json: { error: 'miniDesk could not find that item [Item 0]' }, pairedItem: { item: 0 } },
		]);
	});

	it('continue on fail keeps the item number of the item that was refused', async () => {
		const { output } = await run({
			params: { resource: 'conversation', operation: 'get', conversation: byId },
			continueOnFail: true,
			items: 2,
			responses: [
				{ statusCode: 200, body: ticket },
				{ statusCode: 404, body: { error: { code: 'not_found', message: 'Ticket not found' } } },
			],
		});

		expect(output[1]).toEqual({
			json: { error: 'miniDesk could not find that item [Item 1]' },
			pairedItem: { item: 1 },
		});
	});

	it.each([
		[
			'n8n refuses the connection',
			() =>
				new NodeApiError(fakeExecuteContext({ params: {}, responses: [] }).context.getNode(), {
					message: 'connect ECONNREFUSED 203.0.113.7:443',
				}),
			NodeApiError,
			'The service refused the connection - perhaps it is offline [Item 0]',
		],
		[
			'an expression cannot be resolved, and keeps it an expression refusal',
			() => new ExpressionError('invalid syntax', { parameter: 'body' }),
			ExpressionError,
			'invalid syntax [Item 0]',
		],
		[
			'something unexpected is thrown',
			() => new TypeError('Cannot read the reply'),
			NodeOperationError,
			'Cannot read the reply [Item 0]',
		],
	])('adds the item number when %s', async (_case, makeThrown, errorClass, message) => {
		const fake = fakeExecuteContext({
			params: { resource: 'conversation', operation: 'get', conversation: byId },
			responses: [],
		});

		(fake.context.helpers as unknown as IDataObject).httpRequestWithAuthentication = async () => {
			throw makeThrown();
		};

		const error = await new MiniDesk().execute.call(fake.context).then(
			() => undefined,
			(thrown: unknown) => thrown,
		);

		expect(error).toBeInstanceOf(errorClass);
		expect((error as Error).message).toBe(message);
	});

	it('explains a resource that is not wired yet instead of a missing operation', async () => {
		const fake = fakeExecuteContext({ params: { resource: 'webhook' }, responses: [] });
		const read = fake.context.getNodeParameter;

		// Like n8n: a parameter the selected resource does not show cannot be read.
		(fake.context as unknown as IDataObject).getNodeParameter = (
			name: string,
			...rest: unknown[]
		) => {
			if (name === 'operation') throw new Error('Could not get parameter "operation"');

			return (read as (...args: unknown[]) => unknown)(name, ...rest);
		};

		const error = await new MiniDesk().execute.call(fake.context).then(
			() => undefined,
			(thrown: unknown) => thrown,
		);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as Error).message).toBe("The resource 'webhook' is not available yet [Item 0]");
		expect(fake.calls).toHaveLength(0);
	});
});

describe('list search', () => {
	it('searchConversations shows the reference and the customer', async () => {
		const { context, calls } = fakeLoadOptionsContext({
			responses: [
				{
					statusCode: 200,
					body: {
						data: [
							{
								id: 't-1',
								reference: 'ACME-4F2KQ7',
								requester: { email: 'dana@example.com', name: null },
							},
						],
						next_cursor: 'c1',
					},
				},
			],
		});

		const result = await searchConversations.call(context, 'acme');

		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/tickets');
		expect(calls[0].qs).toEqual({ q: 'acme', limit: 50 });
		expect(result).toEqual({
			results: [{ name: 'ACME-4F2KQ7 (dana@example.com)', value: 't-1' }],
			paginationToken: 'c1',
		});
	});

	it('searchConversations names the customer when there is no email, and asks for the next page', async () => {
		const { context, calls } = fakeLoadOptionsContext({
			responses: [
				{
					statusCode: 200,
					body: {
						data: [
							{ id: 't-1', reference: 'ACME-4F2KQ7', requester: { email: null, name: 'Dana' } },
							{ id: 't-2', reference: 'ACME-7KX4PQ', requester: null },
						],
						next_cursor: null,
					},
				},
			],
		});

		const result = await searchConversations.call(context, undefined, 'c1');

		expect(calls[0].qs).toEqual({ limit: 50, cursor: 'c1' });
		expect(result.results).toEqual([
			{ name: 'ACME-4F2KQ7 (Dana)', value: 't-1' },
			{ name: 'ACME-7KX4PQ (unknown customer)', value: 't-2' },
		]);
		expect(result.paginationToken).toBeUndefined();
	});

	it('searchMembers lists the active members whose name matches', async () => {
		const { context, calls } = fakeLoadOptionsContext({
			responses: [
				{
					statusCode: 200,
					body: {
						data: [
							{ id: 'm-1', name: 'Dana Scully', role: 'agent', is_active: true },
							{ id: 'm-2', name: 'Fox Mulder', role: 'owner', is_active: true },
							{ id: 'm-3', name: 'Dana Katz', role: 'agent', is_active: false },
						],
					},
				},
			],
		});

		const result = await searchMembers.call(context, 'DANA');

		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/members');
		expect(result).toEqual({ results: [{ name: 'Dana Scully', value: 'm-1' }] });
	});

	it('searchDocuments filters titles and pages with the cursor', async () => {
		const { context, calls } = fakeLoadOptionsContext({
			responses: [
				{
					statusCode: 200,
					body: {
						data: [
							{ id: 'k-1', title: 'Refund policy' },
							{ id: 'k-2', title: 'Shipping times' },
						],
						next_cursor: 'c2',
					},
				},
			],
		});

		const result = await searchDocuments.call(context, 'refund', 'c1');

		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/knowledge');
		expect(calls[0].qs).toEqual({ limit: 100, cursor: 'c1' });
		expect(result).toEqual({
			results: [{ name: 'Refund policy', value: 'k-1' }],
			paginationToken: 'c2',
		});
	});

	it('searchDocuments keeps fetching when filter set and page has no match', async () => {
		const { context, calls } = fakeLoadOptionsContext({
			responses: [
				{
					statusCode: 200,
					body: {
						data: [
							{ id: 'k-1', title: 'Shipping times' },
							{ id: 'k-2', title: 'Returns' },
						],
						next_cursor: 'c1',
					},
				},
				{
					statusCode: 200,
					body: {
						data: [
							{ id: 'k-3', title: 'Refund policy' },
							{ id: 'k-4', title: 'Contact' },
						],
						next_cursor: 'c2',
					},
				},
			],
		});

		const result = await searchDocuments.call(context, 'refund');

		expect(calls).toHaveLength(2);
		expect(calls[0].qs).toEqual({ limit: 100 });
		expect(calls[1].qs).toEqual({ limit: 100, cursor: 'c1' });
		expect(result).toEqual({
			results: [{ name: 'Refund policy', value: 'k-3' }],
			paginationToken: 'c2',
		});
	});

	it('searchDocuments stops after 5 pages and returns the cursor', async () => {
		const { context, calls } = fakeLoadOptionsContext({
			responses: [
				{
					statusCode: 200,
					body: { data: [{ id: 'k-1', title: 'Shipping' }], next_cursor: 'c1' },
				},
				{
					statusCode: 200,
					body: { data: [{ id: 'k-2', title: 'Returns' }], next_cursor: 'c2' },
				},
				{
					statusCode: 200,
					body: { data: [{ id: 'k-3', title: 'Contact' }], next_cursor: 'c3' },
				},
				{
					statusCode: 200,
					body: { data: [{ id: 'k-4', title: 'About' }], next_cursor: 'c4' },
				},
				{
					statusCode: 200,
					body: { data: [{ id: 'k-5', title: 'FAQ' }], next_cursor: 'c5' },
				},
			],
		});

		const result = await searchDocuments.call(context, 'refund');

		expect(calls).toHaveLength(5);
		expect(result).toEqual({
			results: [],
			paginationToken: 'c5',
		});
	});

	it('searchDocuments without filter makes 1 call', async () => {
		const { context, calls } = fakeLoadOptionsContext({
			responses: [
				{
					statusCode: 200,
					body: {
						data: [
							{ id: 'k-1', title: 'Refund policy' },
							{ id: 'k-2', title: 'Shipping times' },
						],
						next_cursor: 'c1',
					},
				},
			],
		});

		const result = await searchDocuments.call(context);

		expect(calls).toHaveLength(1);
		expect(calls[0].qs).toEqual({ limit: 100 });
		expect(result).toEqual({
			results: [
				{ name: 'Refund policy', value: 'k-1' },
				{ name: 'Shipping times', value: 'k-2' },
			],
			paginationToken: 'c1',
		});
	});

	it('the node offers the three searches to its locators', () => {
		const node = new MiniDesk();

		expect(Object.keys(node.methods.listSearch).sort()).toEqual([
			'searchConversations',
			'searchDocuments',
			'searchMembers',
		]);
	});
});

describe('miniDesk node description', () => {
	const { description } = new MiniDesk();
	const operations = description.properties.find(
		(property) =>
			property.name === 'operation' &&
			property.displayOptions?.show?.resource?.includes('conversation'),
	);

	it('names every conversation action as the brief says', () => {
		expect(
			(operations?.options as Array<{ value: string; name: string; action: string }>).map(
				({ value, name, action }) => [value, name, action],
			),
		).toEqual([
			['create', 'Create', 'Create conversation from what the customer wrote and AI may reply'],
			['get', 'Get', 'Get conversation'],
			['getAll', 'Get Many', 'Get many conversations'],
			['markAsSpam', 'Mark as Spam', 'Mark conversation as spam'],
			[
				'messageCustomer',
				'Message Customer',
				'Email customer to start conversation that reaches a real person',
			],
			['update', 'Update', 'Update conversation'],
		]);
	});

	it("says Create saves the customer's own words and the AI may email them", () => {
		const create = (operations?.options as Array<{ value: string; description: string }>).find(
			({ value }) => value === 'create',
		);

		expect(create?.description).toBe(
			"Save a message a customer sent you elsewhere as a new conversation. The message must be the customer's own words. miniDesk's AI may email them an answer.",
		);
	});

	it('says Get drops the messages unless Simplify is off', () => {
		const get = (operations?.options as Array<{ value: string; description: string }>).find(
			({ value }) => value === 'get',
		);

		expect(get?.description).toBe(
			"Get a conversation. Turn off 'Simplify' to include its messages.",
		);
	});

	it('accepts a real reference such as ACME-7KX4PQ and flags anything else', () => {
		const issuesFor = (value: string) => {
			const node = {
				id: 'node-1',
				name: 'miniDesk',
				type: '@minidesk/n8n-nodes-minidesk.miniDesk',
				typeVersion: 1,
				position: [0, 0] as [number, number],
				parameters: {},
			};
			const parameters = NodeHelpers.getNodeParameters(
				description.properties,
				{
					resource: 'conversation',
					operation: 'get',
					conversation: { __rl: true, mode: 'reference', value },
				},
				true,
				false,
				node,
				description,
			);

			return NodeHelpers.getNodeParametersIssues(
				description.properties,
				{ ...node, parameters: parameters ?? {} },
				description,
			);
		};

		expect(issuesFor('ACME-7KX4PQ')).toBeNull();
		expect(issuesFor('ACME-4F2KQ7')).toBeNull();
		expect(issuesFor('not a ref')?.parameters).toEqual({
			conversation: ['Enter a reference such as ACME-4F2KQ7'],
		});
	});

	it('tells Create and Message Customer apart in their message descriptions', () => {
		const bodies = description.properties.filter(
			(property) =>
				property.name === 'body' &&
				property.displayOptions?.show?.resource?.includes('conversation'),
		);

		expect(
			bodies.map((property) => [property.displayOptions?.show?.operation, property.description]),
		).toEqual([
			[
				['create'],
				"What the customer wrote. It is saved as the customer's own words, and miniDesk's AI may reply to it.",
			],
			[
				['messageCustomer'],
				'The text miniDesk emails to the customer from your team. This reaches a real person.',
			],
		]);
	});

	it('offers every resource and can be used as an AI tool', () => {
		const resource = description.properties.find((property) => property.name === 'resource');

		expect(
			(resource?.options as Array<{ value: string }>).map(({ value }) => value).sort(),
		).toEqual(['aiDraft', 'conversation', 'customer', 'knowledge', 'message', 'teamMember']);
		expect(description.name).toBe('miniDesk');
		expect(description.usableAsTool).toBe(true);
		expect(description.credentials).toEqual([{ name: 'miniDeskApi', required: true }]);
	});
});
