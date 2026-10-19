import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { miniDeskApiRequest } from './transport';

/** Conversation picked from a list, by ID, or by its reference (e.g. ACME-4F2KQ7). */
export const conversationLocator: INodeProperties = {
	displayName: 'Conversation',
	name: 'conversation',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The conversation to work on',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchConversations', searchable: true },
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 3f0c2a52-8d1e-4b7a-9c3f-2a1b0c9d8e7f',
		},
		{
			displayName: 'By Reference',
			name: 'reference',
			type: 'string',
			placeholder: 'e.g. ACME-4F2KQ7',
			validation: [
				{
					type: 'regex',
					properties: {
						// A workspace prefix, then a code of letters and digits.
						regex: '^[A-Za-z0-9]+-[A-Za-z0-9]+$',
						errorMessage: 'Enter a reference such as ACME-4F2KQ7',
					},
				},
			],
		},
	],
};

/** Team member picked from a list or by ID; the ID is what `assignee_id` takes. */
export const assigneeLocator: INodeProperties = {
	displayName: 'Assignee',
	name: 'assignee',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	description: 'The team member who owns the conversation',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchMembers', searchable: true },
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 7b9d4e1a-2c3f-4a5b-8e6d-1f0a9b8c7d6e',
		},
	],
};

/** Reference document picked from a list or by ID. */
export const documentLocator: INodeProperties = {
	displayName: 'Document',
	name: 'document',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The reference document to work on',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchDocuments', searchable: true },
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 3f0c2a52-8d1e-4b7a-9c3f-2a1b0c9d8e7f',
		},
	],
};

/** A trimmed string, or undefined when empty, so optional fields stay out of requests. */
export function text(value: unknown): string | undefined {
	const trimmed = typeof value === 'string' ? value.trim() : '';

	return trimmed === '' ? undefined : trimmed;
}

/** The trimmed value of a resource locator (or of a plain string), '' when unset. */
export function locatorValue(raw: unknown): string {
	const value = raw !== null && typeof raw === 'object' ? (raw as { value?: unknown }).value : raw;

	return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

/** The conversation's ID; a reference is looked up and must match exactly. */
export async function resolveConversationId(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<string> {
	const raw = this.getNodeParameter('conversation', itemIndex) as unknown;
	const mode = raw !== null && typeof raw === 'object' ? (raw as { mode?: unknown }).mode : 'id';
	const value = locatorValue(raw);

	if (value === '') {
		throw new NodeOperationError(this.getNode(), `'Conversation' is empty [Item ${itemIndex}]`, {
			itemIndex,
			description: 'Pick a conversation from the list, or enter its ID or reference.',
		});
	}

	if (mode !== 'reference') return value;

	// Search also finds conversations whose messages mention the reference, so only an
	// exact match counts, and it may sit on a later page.
	let cursor: string | undefined;

	do {
		const page = await miniDeskApiRequest.call(this, 'GET', '/tickets', {
			qs: { q: value, limit: 100, cursor },
			itemIndex,
		});
		const match = ((page.data as IDataObject[] | undefined) ?? []).find(
			(ticket) =>
				typeof ticket.reference === 'string' &&
				ticket.reference.toLowerCase() === value.toLowerCase(),
		);

		if (match !== undefined) return String(match.id);

		// A cursor that comes back unchanged would loop forever.
		cursor =
			typeof page.next_cursor === 'string' && page.next_cursor !== '' && page.next_cursor !== cursor
				? page.next_cursor
				: undefined;
	} while (cursor !== undefined);

	throw new NodeOperationError(
		this.getNode(),
		`No conversation with reference '${value}' [Item ${itemIndex}]`,
		{
			itemIndex,
			description:
				'Check the reference shown on the conversation in miniDesk, or pick the conversation from the list.',
		},
	);
}
