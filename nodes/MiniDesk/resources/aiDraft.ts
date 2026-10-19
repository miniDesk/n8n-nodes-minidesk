import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { conversationLocator, resolveConversationId } from '../shared/descriptions';
import { miniDeskApiRequest } from '../shared/transport';

const show = (operation: string[]) => ({
	show: { resource: ['aiDraft'], operation },
});

export const aiDraftDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['aiDraft'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create AI draft reply',
				action: 'Create AI draft reply',
			},
		],
		default: 'create',
	},

	{ ...conversationLocator, displayOptions: show(['create']) },

	{
		displayName: 'Notice',
		name: 'notice',
		type: 'notice',
		default:
			"miniDesk's AI writes the draft and keeps it in the conversation for review. If a draft is already waiting, you get that one.",
		displayOptions: show(['create']),
	},
];

export async function executeAiDraft(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const node = this.getNode();

	switch (operation) {
		case 'create': {
			const id = await resolveConversationId.call(this, itemIndex);

			return await miniDeskApiRequest.call(
				this,
				'POST',
				`/tickets/${encodeURIComponent(id)}/draft`,
				{ itemIndex },
			);
		}

		default:
			throw new NodeOperationError(
				node,
				`The operation '${operation}' is not available for AI drafts [Item ${itemIndex}]`,
				{ itemIndex },
			);
	}
}
