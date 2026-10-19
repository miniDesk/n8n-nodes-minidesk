import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { conversationLocator, resolveConversationId, text } from '../shared/descriptions';
import { miniDeskApiRequest } from '../shared/transport';

const show = (operation: string[]) => ({
	show: { resource: ['message'], operation },
});

export const messageDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['message'] } },
		options: [
			{
				name: 'Send Reply',
				value: 'sendReply',
				description:
					'Send a reply to the customer. This reaches a real person and cannot be unsent.',
				action: 'Send reply to customer that reaches a real person',
			},
			{
				name: 'Add Internal Note',
				value: 'addNote',
				description: 'Add internal note to conversation',
				action: 'Add internal note to conversation',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many messages in conversation',
				action: 'Get many messages in conversation',
			},
		],
		default: 'sendReply',
	},

	{ ...conversationLocator, displayOptions: show(['sendReply', 'addNote', 'getAll']) },

	{
		displayName: 'Message',
		name: 'body',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'Sent to the customer. This reaches a real person and cannot be unsent.',
		displayOptions: show(['sendReply']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['sendReply']),
		options: [
			{
				displayName: 'Draft ID',
				name: 'draftId',
				type: 'string',
				default: '',
				description:
					"The ID from 'AI Draft: Create'. miniDesk marks that draft as sent and records it in the AI activity log.",
			},
		],
	},

	{
		displayName: 'Note',
		name: 'body',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'Only your team sees it. The customer never does.',
		displayOptions: show(['addNote']),
	},

	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(['getAll']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['message'], operation: ['getAll'], returnAll: [false] },
		},
	},
];

export async function executeMessage(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const node = this.getNode();

	switch (operation) {
		case 'sendReply': {
			const id = await resolveConversationId.call(this, itemIndex);
			const additional = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
			const body: IDataObject = {
				body: this.getNodeParameter('body', itemIndex) as string,
				visibility: 'public',
			};
			const draftId = text(additional.draftId);

			if (draftId !== undefined) body.draft_id = draftId;

			return await miniDeskApiRequest.call(
				this,
				'POST',
				`/tickets/${encodeURIComponent(id)}/messages`,
				{ body, itemIndex },
			);
		}

		case 'addNote': {
			const id = await resolveConversationId.call(this, itemIndex);
			const body: IDataObject = {
				body: this.getNodeParameter('body', itemIndex) as string,
				visibility: 'internal',
			};

			return await miniDeskApiRequest.call(
				this,
				'POST',
				`/tickets/${encodeURIComponent(id)}/messages`,
				{ body, itemIndex },
			);
		}

		case 'getAll': {
			const id = await resolveConversationId.call(this, itemIndex);
			const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const response = await miniDeskApiRequest.call(
				this,
				'GET',
				`/tickets/${encodeURIComponent(id)}/messages`,
				{ itemIndex },
			);
			const messages = (response.data as IDataObject[] | undefined) ?? [];

			return returnAll
				? messages
				: messages.slice(0, this.getNodeParameter('limit', itemIndex, 50) as number);
		}

		default:
			throw new NodeOperationError(
				node,
				`The operation '${operation}' is not available for messages [Item ${itemIndex}]`,
				{ itemIndex },
			);
	}
}
