import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	assigneeLocator,
	conversationLocator,
	locatorValue,
	resolveConversationId,
	text,
} from '../shared/descriptions';
import { miniDeskApiRequest, miniDeskApiRequestAllItems } from '../shared/transport';

const show = (operation: string[]) => ({
	show: { resource: ['conversation'], operation },
});

const priorityOptions = [
	{ name: 'Low', value: 'low' },
	{ name: 'Normal', value: 'normal' },
	{ name: 'High', value: 'high' },
	{ name: 'Urgent', value: 'urgent' },
];

const customerNameField: INodeProperties = {
	displayName: 'Customer Name',
	name: 'customerName',
	type: 'string',
	default: '',
	placeholder: 'e.g. Dana Smith',
	description: 'The name your team sees for this customer',
};

const categoryField: INodeProperties = {
	displayName: 'Category',
	name: 'category',
	type: 'string',
	default: '',
	placeholder: 'e.g. Billing',
	description: 'A label for the conversation, up to 60 characters',
};

const languageField: INodeProperties = {
	displayName: 'Language',
	name: 'language',
	type: 'string',
	default: '',
	placeholder: 'e.g. fr',
	description:
		"The language of the message, as a code such as fr or en-GB. miniDesk's own detection takes priority.",
};

const priorityField: INodeProperties = {
	displayName: 'Priority',
	name: 'priority',
	type: 'options',
	options: priorityOptions,
	default: 'normal',
	description: 'How urgent the conversation is. If left out, miniDesk sets it.',
};

export const conversationDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['conversation'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description:
					"Save a message a customer sent you elsewhere as a new conversation. The message must be the customer's own words. miniDesk's AI may email them an answer.",
				action: 'Create conversation from what the customer wrote and AI may reply',
			},
			{
				name: 'Get',
				value: 'get',
				description: "Get a conversation. Turn off 'Simplify' to include its messages.",
				action: 'Get conversation',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many conversations',
				action: 'Get many conversations',
			},
			{
				name: 'Mark as Spam',
				value: 'markAsSpam',
				description: 'Move a conversation out of the inbox into spam',
				action: 'Mark conversation as spam',
			},
			{
				name: 'Message Customer',
				value: 'messageCustomer',
				description:
					'Email a customer from your team to start a new conversation. This reaches a real person.',
				action: 'Email customer to start conversation that reaches a real person',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Change the status, priority, category or assignee of a conversation',
				action: 'Update conversation',
			},
		],
		default: 'get',
	},

	// Create
	{
		displayName: 'Customer Email',
		name: 'customerEmail',
		type: 'string',
		default: '',
		placeholder: 'e.g. dana@example.com',
		description: "Who wrote the message. Add this or an 'External ID'.",
		displayOptions: show(['create']),
	},
	{
		displayName: 'Message',
		name: 'body',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description:
			"What the customer wrote. It is saved as the customer's own words, and miniDesk's AI may reply to it.",
		displayOptions: show(['create']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['create']),
		options: [
			categoryField,
			customerNameField,
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				placeholder: 'e.g. user-42',
				description:
					'Your own ID for this person. Send it only if your system has verified who they are. A customer miniDesk already knows by email does not get it.',
			},
			languageField,
			priorityField,
		],
	},

	// Message Customer
	{
		displayName: 'Customer Email',
		name: 'customerEmail',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. dana@example.com',
		description: 'The address miniDesk emails',
		displayOptions: show(['messageCustomer']),
	},
	{
		displayName: 'Message',
		name: 'body',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description:
			'The text miniDesk emails to the customer from your team. This reaches a real person.',
		displayOptions: show(['messageCustomer']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['messageCustomer']),
		options: [categoryField, customerNameField, languageField, priorityField],
	},

	// Get, Update, Mark as Spam
	{ ...conversationLocator, displayOptions: show(['get', 'update', 'markAsSpam']) },

	// Get Many
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
			show: { resource: ['conversation'], operation: ['getAll'], returnAll: [false] },
		},
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['getAll']),
		options: [
			{
				...assigneeLocator,
				description: 'Only conversations assigned to this team member',
			},
			{
				...categoryField,
				description: 'Only conversations in this category',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: priorityOptions,
				default: 'normal',
				description: 'Only conversations with this priority',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				placeholder: 'e.g. refund',
				description:
					'Words to find in customer details and messages, or a reference such as ACME-4F2KQ7',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'multiOptions',
				options: [
					{ name: 'Closed', value: 'closed' },
					{ name: 'New', value: 'new' },
					{ name: 'Open', value: 'open' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Resolved', value: 'resolved' },
				],
				default: [],
				description: 'Only conversations in these statuses',
			},
		],
	},

	// Update
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['update']),
		options: [
			{
				...assigneeLocator,
				description: 'The team member to assign the conversation to',
			},
			{
				...categoryField,
				description: 'A new label for the conversation, up to 60 characters',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: priorityOptions,
				default: 'normal',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				// Nothing can go back to New, so it is not offered.
				options: [
					{ name: 'Open', value: 'open' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Resolved', value: 'resolved' },
					{ name: 'Closed', value: 'closed' },
				],
				default: 'open',
				description: 'A closed conversation can only go back to Open',
			},
			{
				displayName: 'Unassign',
				name: 'unassign',
				type: 'boolean',
				default: false,
				description: 'Whether to remove the current assignee',
			},
		],
	},

	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: show(['create', 'messageCustomer', 'get', 'getAll']),
	},
];

// Ten fields, with the customer pulled up from `requester`.
function simplifyConversation(ticket: IDataObject): IDataObject {
	const requester = (ticket.requester ?? null) as IDataObject | null;

	return {
		id: ticket.id,
		reference: ticket.reference,
		status: ticket.status,
		priority: ticket.priority,
		category: ticket.category,
		language: ticket.language,
		customer_email: requester?.email ?? null,
		customer_name: requester?.name ?? null,
		created_at: ticket.created_at,
		updated_at: ticket.updated_at,
	};
}

export async function executeConversation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const node = this.getNode();

	switch (operation) {
		case 'create':
		case 'messageCustomer': {
			const additional = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
			const email = text(this.getNodeParameter('customerEmail', itemIndex, ''));
			// Only Create offers an External ID.
			const externalId = operation === 'create' ? text(additional.externalId) : undefined;

			if (operation === 'create' && email === undefined && externalId === undefined) {
				throw new NodeOperationError(
					node,
					`Add a 'Customer Email' or an 'External ID' [Item ${itemIndex}]`,
					{ itemIndex, description: 'miniDesk needs one of them to know who wrote the message.' },
				);
			}

			if (operation === 'messageCustomer' && email === undefined) {
				throw new NodeOperationError(node, `Add a 'Customer Email' [Item ${itemIndex}]`, {
					itemIndex,
					description: 'miniDesk emails the message to this address.',
				});
			}

			const requester: IDataObject = {};
			const name = text(additional.customerName);

			if (email !== undefined) requester.email = email;
			if (name !== undefined) requester.name = name;
			if (externalId !== undefined) requester.external_id = externalId;

			const body: IDataObject = {
				body: this.getNodeParameter('body', itemIndex) as string,
				requester,
			};

			for (const field of ['priority', 'category', 'language']) {
				const value = text(additional[field]);

				if (value !== undefined) body[field] = value;
			}

			if (operation === 'messageCustomer') body.first_message_from = 'team';

			const ticket = await miniDeskApiRequest.call(this, 'POST', '/tickets', { body, itemIndex });

			if (!(this.getNodeParameter('simplify', itemIndex, true) as boolean)) return ticket;

			const simplified = simplifyConversation(ticket);

			// "sent" or "held": whether the email went out is the point of Message Customer.
			if (ticket.delivery !== undefined) simplified.delivery = ticket.delivery;

			return simplified;
		}

		case 'get': {
			const id = await resolveConversationId.call(this, itemIndex);
			const ticket = await miniDeskApiRequest.call(
				this,
				'GET',
				`/tickets/${encodeURIComponent(id)}`,
				{ itemIndex },
			);

			return (this.getNodeParameter('simplify', itemIndex, true) as boolean)
				? simplifyConversation(ticket)
				: ticket;
		}

		case 'getAll': {
			const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
			const statuses = Array.isArray(filters.status) ? (filters.status as string[]) : [];

			const tickets = await miniDeskApiRequestAllItems.call(
				this,
				'/tickets',
				{
					status: statuses.length > 0 ? statuses.join(',') : undefined,
					priority: text(filters.priority),
					category: text(filters.category),
					assignee_id: locatorValue(filters.assignee),
					q: text(filters.search),
				},
				returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number),
				itemIndex,
			);

			return (this.getNodeParameter('simplify', itemIndex, true) as boolean)
				? tickets.map(simplifyConversation)
				: tickets;
		}

		case 'update': {
			const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
			const assigneeId = locatorValue(fields.assignee);
			const body: IDataObject = {};

			if (fields.unassign === true && assigneeId !== '') {
				throw new NodeOperationError(
					node,
					`Choose either 'Assignee' or 'Unassign', not both [Item ${itemIndex}]`,
					{ itemIndex },
				);
			}

			for (const field of ['status', 'priority', 'category']) {
				const value = text(fields[field]);

				if (value !== undefined) body[field] = value;
			}

			if (assigneeId !== '') body.assignee_id = assigneeId;
			if (fields.unassign === true) body.assignee_id = null;

			if (Object.keys(body).length === 0) {
				throw new NodeOperationError(
					node,
					`Add at least one field to 'Update Fields' [Item ${itemIndex}]`,
					{ itemIndex },
				);
			}

			const id = await resolveConversationId.call(this, itemIndex);

			return await miniDeskApiRequest.call(this, 'PATCH', `/tickets/${encodeURIComponent(id)}`, {
				body,
				itemIndex,
			});
		}

		case 'markAsSpam': {
			const id = await resolveConversationId.call(this, itemIndex);

			return await miniDeskApiRequest.call(
				this,
				'POST',
				`/tickets/${encodeURIComponent(id)}/spam`,
				{ itemIndex },
			);
		}

		default:
			throw new NodeOperationError(
				node,
				`The operation '${operation}' is not available for conversations [Item ${itemIndex}]`,
				{ itemIndex },
			);
	}
}
