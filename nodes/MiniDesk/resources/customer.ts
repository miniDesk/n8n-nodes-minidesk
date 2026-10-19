import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { text } from '../shared/descriptions';
import { miniDeskApiRequest, miniDeskApiRequestAllItems } from '../shared/transport';

const show = (operation: string[]) => ({
	show: { resource: ['customer'], operation },
});

export const customerDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['customer'] } },
		options: [
			{
				name: 'Create or Update',
				value: 'upsert',
				description: 'Create a new record, or update the current one if it already exists (upsert)',
				action: 'Create or update customer',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get customer',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many customers',
				action: 'Get many customers',
			},
		],
		default: 'upsert',
	},

	{
		displayName: 'Notice',
		name: 'notice',
		type: 'notice',
		default:
			'If the customer exists, only the name and note change. The email and external ID are set only when the customer is created.',
		displayOptions: show(['upsert']),
	},

	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. dana@example.com',
		description: 'The customer email address',
		displayOptions: show(['upsert']),
	},

	{
		displayName: 'Lookup By',
		name: 'lookupBy',
		type: 'options',
		options: [
			{ name: 'By ID', value: 'id' },
			{ name: 'By Email', value: 'email' },
		],
		default: 'id',
		displayOptions: show(['get']),
	},

	{
		displayName: 'Customer ID',
		name: 'customerId',
		type: 'string',
		default: '',
		placeholder: 'e.g. 3f0c2a52-8d1e-4b7a-9c3f-2a1b0c9d8e7f',
		displayOptions: {
			show: { resource: ['customer'], operation: ['get'], lookupBy: ['id'] },
		},
	},

	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. dana@example.com',
		description: 'The customer email address',
		displayOptions: {
			show: { resource: ['customer'], operation: ['get'], lookupBy: ['email'] },
		},
	},

	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['upsert']),
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				placeholder: 'e.g. Dana Smith',
				description: 'The customer name',
			},
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				placeholder: 'e.g. user-42',
				description: 'Your own ID for this customer, up to 200 characters',
			},
			{
				displayName: 'Note',
				name: 'note',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'A note about the customer, up to 2000 characters',
			},
		],
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
			show: { resource: ['customer'], operation: ['getAll'], returnAll: [false] },
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
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				placeholder: 'e.g. dana',
				description: 'Words to find in customer email or name',
			},
		],
	},
];

export async function executeCustomer(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const node = this.getNode();

	switch (operation) {
		case 'upsert': {
			const email = text(this.getNodeParameter('email', itemIndex));

			if (email === undefined) {
				throw new NodeOperationError(node, `'Email' is empty [Item ${itemIndex}]`, { itemIndex });
			}

			const additional = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
			const body: IDataObject = { email };

			const name = text(additional.name);
			const externalId = text(additional.externalId);
			const note = text(additional.note);

			if (name !== undefined) body.name = name;
			if (externalId !== undefined) body.external_id = externalId;
			if (note !== undefined) body.note = note;

			return await miniDeskApiRequest.call(this, 'PUT', '/customers', { body, itemIndex });
		}

		case 'get': {
			const lookupBy = this.getNodeParameter('lookupBy', itemIndex) as string;

			if (lookupBy === 'id') {
				const customerId = text(this.getNodeParameter('customerId', itemIndex));

				if (customerId === undefined) {
					throw new NodeOperationError(node, `'Customer ID' is empty [Item ${itemIndex}]`, {
						itemIndex,
					});
				}

				return await miniDeskApiRequest.call(
					this,
					'GET',
					`/customers/${encodeURIComponent(customerId)}`,
					{ itemIndex },
				);
			}

			const email = text(this.getNodeParameter('email', itemIndex));

			if (email === undefined) {
				throw new NodeOperationError(node, `'Email' is empty [Item ${itemIndex}]`, { itemIndex });
			}

			const response = await miniDeskApiRequest.call(this, 'GET', '/customers', {
				qs: { email },
				itemIndex,
			});
			const customers = (response.data as IDataObject[] | undefined) ?? [];

			if (customers.length === 0) {
				throw new NodeOperationError(
					node,
					`No customer with email '${email}' [Item ${itemIndex}]`,
					{ itemIndex },
				);
			}

			return customers[0];
		}

		case 'getAll': {
			const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;

			return await miniDeskApiRequestAllItems.call(
				this,
				'/customers',
				{ q: text(filters.search) },
				returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number),
				itemIndex,
			);
		}

		default:
			throw new NodeOperationError(
				node,
				`The operation '${operation}' is not available for customers [Item ${itemIndex}]`,
				{ itemIndex },
			);
	}
}
