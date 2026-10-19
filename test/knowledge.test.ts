import { describe, expect, it } from 'vitest';

import { MiniDesk } from '../nodes/MiniDesk/MiniDesk.node';
import { fakeExecuteContext } from './helpers/fake-context';

type RunInput = Parameters<typeof fakeExecuteContext>[0];

async function run(input: RunInput) {
	const fake = fakeExecuteContext(input);
	const output = await new MiniDesk().execute.call(fake.context);

	return { ...fake, output: output[0] };
}

describe('miniDesk node, Knowledge resource', () => {
	it('add document posts the title and content', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'knowledge',
				operation: 'addDocument',
				title: 'Refund policy',
				content: 'We offer full refunds within 30 days.',
			},
			responses: [
				{
					statusCode: 201,
					body: {
						id: 'k-1',
						title: 'Refund policy',
						kind: 'text',
						status: 'proposed',
						created_at: '2026-10-19T10:00:00Z',
						updated_at: '2026-10-19T10:00:00Z',
					},
				},
			],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/knowledge');
		expect(calls[0].body).toEqual({
			title: 'Refund policy',
			content: 'We offer full refunds within 30 days.',
		});
		expect(output).toHaveLength(1);
		expect(output[0].json.status).toBe('proposed');
	});

	it('the add document form says it waits for an owner', () => {
		const { description } = new MiniDesk();
		const notice = description.properties.find(
			(property) =>
				property.name === 'notice' &&
				property.type === 'notice' &&
				property.displayOptions?.show?.resource?.includes('knowledge') &&
				property.displayOptions?.show?.operation?.includes('addDocument'),
		);

		expect(notice?.default).toContain('Documents added from n8n are saved switched off');
		expect(notice?.default).toContain('An owner approves them in miniDesk before the AI reads them');
	});

	it('delete document returns deleted true', async () => {
		const { calls, output } = await run({
			params: {
				resource: 'knowledge',
				operation: 'deleteDocument',
				document: { mode: 'id', value: 'k-1' },
			},
			responses: [{ statusCode: 200, body: { deleted: true } }],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('DELETE');
		expect(calls[0].url).toBe('https://api.minidesk.ai/v1/knowledge/k-1');
		expect(calls[0].headers?.['Idempotency-Key']).toBeUndefined();
		expect(output).toHaveLength(1);
		expect(output[0].json).toEqual({ deleted: true });
	});

	it('team members leave out inactive members unless asked', async () => {
		const { output } = await run({
			params: {
				resource: 'teamMember',
				operation: 'getAll',
				returnAll: true,
			},
			responses: [
				{
					statusCode: 200,
					body: {
						data: [
							{ id: 'm-1', name: 'Dana Scully', role: 'agent', is_active: true },
							{ id: 'm-2', name: 'Fox Mulder', role: 'owner', is_active: false },
						],
					},
				},
			],
		});

		expect(output).toHaveLength(1);
		expect(output[0].json.id).toBe('m-1');

		const { output: outputWithInactive } = await run({
			params: {
				resource: 'teamMember',
				operation: 'getAll',
				returnAll: true,
				includeInactive: true,
			},
			responses: [
				{
					statusCode: 200,
					body: {
						data: [
							{ id: 'm-1', name: 'Dana Scully', role: 'agent', is_active: true },
							{ id: 'm-2', name: 'Fox Mulder', role: 'owner', is_active: false },
						],
					},
				},
			],
		});

		expect(outputWithInactive).toHaveLength(2);
	});
});
