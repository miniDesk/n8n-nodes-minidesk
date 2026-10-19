import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { ExecutionBaseError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { searchConversations, searchDocuments, searchMembers } from './listSearch';
import { aiDraftDescription, executeAiDraft } from './resources/aiDraft';
import { conversationDescription, executeConversation } from './resources/conversation';
import { customerDescription, executeCustomer } from './resources/customer';
import { executeKnowledge, knowledgeDescription } from './resources/knowledge';
import { executeMessage, messageDescription } from './resources/message';
import { executeTeamMember, teamMemberDescription } from './resources/teamMember';

type ResourceHandler = (
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
) => Promise<IDataObject | IDataObject[]>;

// One entry per wired resource.
const handlers: Record<string, ResourceHandler> = {
	aiDraft: executeAiDraft,
	conversation: executeConversation,
	customer: executeCustomer,
	knowledge: executeKnowledge,
	message: executeMessage,
	teamMember: executeTeamMember,
};

export class MiniDesk implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'miniDesk',
		name: 'miniDesk',
		icon: { light: 'file:../../icons/minidesk.svg', dark: 'file:../../icons/minidesk.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Work your miniDesk support inbox',
		defaults: { name: 'miniDesk' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'miniDeskApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'AI Draft', value: 'aiDraft' },
					{ name: 'Conversation', value: 'conversation' },
					{ name: 'Customer', value: 'customer' },
					{ name: 'Knowledge', value: 'knowledge' },
					{ name: 'Message', value: 'message' },
					{ name: 'Team Member', value: 'teamMember' },
				],
				default: 'conversation',
			},
			...aiDraftDescription,
			...conversationDescription,
			...customerDescription,
			...knowledgeDescription,
			...messageDescription,
			...teamMemberDescription,
		],
	};

	methods = {
		listSearch: { searchConversations, searchMembers, searchDocuments },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const handler = handlers[resource];

				// Checked before reading the operation, which an unwired resource does not have.
				if (handler === undefined) {
					throw new NodeOperationError(
						this.getNode(),
						`The resource '${resource}' is not available yet [Item ${i}]`,
						{ itemIndex: i },
					);
				}

				const operation = this.getNodeParameter('operation', i) as string;
				const result = await handler.call(this, operation, i);

				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(result), {
						itemData: { item: i },
					}),
				);
			} catch (error) {
				const suffix = `[Item ${i}]`;
				// n8n's own errors (API, operation, expression) keep their class and context.
				const known =
					error instanceof ExecutionBaseError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });

				// n8n's request helper and expression errors carry no item number in the message.
				if (!known.message.endsWith(suffix)) known.message = `${known.message} ${suffix}`;
				known.context.itemIndex = i;

				if (this.continueOnFail()) {
					returnData.push({ json: { error: known.message }, pairedItem: { item: i } });
					continue;
				}

				throw known;
			}
		}

		return [returnData];
	}
}
