import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import { API_BASE_URL } from '../nodes/MiniDesk/shared/constants';

export class MiniDeskApi implements ICredentialType {
	name = 'miniDeskApi';

	displayName = 'miniDesk API';

	icon: Icon = { light: 'file:../icons/minidesk.svg', dark: 'file:../icons/minidesk.dark.svg' };

	documentationUrl = 'https://docs.minidesk.ai/integrations/n8n';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. mdsk_api_example_key',
			description:
				'Create one in miniDesk under Settings → API. Use a key just for n8n so you can revoke it on its own.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
	};

	// The cheapest read: one conversation at most.
	test: ICredentialTestRequest = {
		request: { baseURL: API_BASE_URL, url: '/tickets', method: 'GET', qs: { limit: 1 } },
	};
}
