import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { miniDeskApiRequest } from '../shared/transport';

const show = (operation: string[]) => ({
	show: { resource: ['teamMember'], operation },
});

export const teamMemberDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['teamMember'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many team members',
				action: 'Get many team members',
			},
		],
		default: 'getAll',
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
			show: { resource: ['teamMember'], operation: ['getAll'], returnAll: [false] },
		},
	},
	{
		displayName: 'Include Inactive',
		name: 'includeInactive',
		type: 'boolean',
		default: false,
		description: 'Whether to include members who have left or were deactivated',
		displayOptions: show(['getAll']),
	},
];

export async function executeTeamMember(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const node = this.getNode();

	switch (operation) {
		case 'getAll': {
			const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const includeInactive = this.getNodeParameter('includeInactive', itemIndex, false) as boolean;
			const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number);

			const response = await miniDeskApiRequest.call(this, 'GET', '/members', { itemIndex });
			const members = ((response.data as IDataObject[] | undefined) ?? []).filter(
				(member) => includeInactive || member.is_active === true,
			);

			return limit === undefined ? members : members.slice(0, limit);
		}

		default:
			throw new NodeOperationError(
				node,
				`The operation '${operation}' is not available for team members [Item ${itemIndex}]`,
				{ itemIndex },
			);
	}
}
