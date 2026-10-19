import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { documentLocator, locatorValue } from '../shared/descriptions';
import { miniDeskApiRequest, miniDeskApiRequestAllItems } from '../shared/transport';

const show = (operation: string[]) => ({
	show: { resource: ['knowledge'], operation },
});

export const knowledgeDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['knowledge'] } },
		options: [
			{
				name: 'Add Document',
				value: 'addDocument',
				description: 'Add reference document',
				action: 'Add reference document',
			},
			{
				name: 'Update Document',
				value: 'updateDocument',
				description: 'Update reference document',
				action: 'Update reference document',
			},
			{
				name: 'Delete Document',
				value: 'deleteDocument',
				description: 'Delete reference document',
				action: 'Delete reference document',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many reference documents',
				action: 'Get many reference documents',
			},
		],
		default: 'addDocument',
	},

	{
		displayName: 'Notice',
		name: 'notice',
		type: 'notice',
		default:
			'Documents added from n8n are saved switched off. An owner approves them in miniDesk before the AI reads them.',
		displayOptions: show(['addDocument']),
	},

	{
		displayName: 'Notice',
		name: 'noticeUpdate',
		type: 'notice',
		default:
			'Documents added from n8n are saved switched off. An owner approves them in miniDesk before the AI reads them. The updated document waits for approval again.',
		displayOptions: show(['updateDocument']),
	},

	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Refund policy',
		description: 'The document title, up to 200 characters',
		displayOptions: show(['addDocument', 'updateDocument']),
	},

	{
		displayName: 'Content',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 10 },
		required: true,
		default: '',
		description: 'The document content, up to 80000 characters',
		displayOptions: show(['addDocument', 'updateDocument']),
	},

	{ ...documentLocator, displayOptions: show(['updateDocument', 'deleteDocument']) },

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
			show: { resource: ['knowledge'], operation: ['getAll'], returnAll: [false] },
		},
	},
];

export async function executeKnowledge(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const node = this.getNode();

	switch (operation) {
		case 'addDocument': {
			const title = this.getNodeParameter('title', itemIndex) as string;
			const content = this.getNodeParameter('content', itemIndex) as string;

			return await miniDeskApiRequest.call(this, 'POST', '/knowledge', {
				body: { title, content },
				itemIndex,
			});
		}

		case 'updateDocument': {
			const raw = this.getNodeParameter('document', itemIndex) as unknown;
			const documentId = locatorValue(raw);

			if (documentId === '') {
				throw new NodeOperationError(node, `'Document' is empty [Item ${itemIndex}]`, {
					itemIndex,
				});
			}

			const title = this.getNodeParameter('title', itemIndex) as string;
			const content = this.getNodeParameter('content', itemIndex) as string;

			return await miniDeskApiRequest.call(
				this,
				'PUT',
				`/knowledge/${encodeURIComponent(documentId)}`,
				{ body: { title, content }, itemIndex },
			);
		}

		case 'deleteDocument': {
			const raw = this.getNodeParameter('document', itemIndex) as unknown;
			const documentId = locatorValue(raw);

			if (documentId === '') {
				throw new NodeOperationError(node, `'Document' is empty [Item ${itemIndex}]`, {
					itemIndex,
				});
			}

			return await miniDeskApiRequest.call(
				this,
				'DELETE',
				`/knowledge/${encodeURIComponent(documentId)}`,
				{ itemIndex },
			);
		}

		case 'getAll': {
			const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;

			return await miniDeskApiRequestAllItems.call(
				this,
				'/knowledge',
				{},
				returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number),
				itemIndex,
			);
		}

		default:
			throw new NodeOperationError(
				node,
				`The operation '${operation}' is not available for knowledge [Item ${itemIndex}]`,
				{ itemIndex },
			);
	}
}
