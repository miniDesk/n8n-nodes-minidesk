import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import {
	ExecutionBaseError,
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

import { miniDeskApiRequest } from '../MiniDesk/shared/transport';
import { verifySignature } from './signature';

export class MiniDeskTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'miniDesk Trigger',
		name: 'miniDeskTrigger',
		icon: { light: 'file:../../icons/minidesk.svg', dark: 'file:../../icons/minidesk.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts a workflow when something happens in your miniDesk inbox',
		defaults: { name: 'miniDesk Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'miniDeskApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				// A 200 with no body. Without it n8n answers the literal text "firstEntryJson".
				responseData: 'noData',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				options: [
					{
						name: 'Conversation Assigned',
						value: 'conversation.assigned',
						description: 'A conversation gets a new assignee, or loses its assignee',
					},
					{
						name: 'Conversation Status Changed',
						value: 'conversation.status_changed',
						description: 'A conversation moves to another status, e.g. resolved',
					},
					{
						name: 'New Conversation',
						value: 'conversation.created',
						description: 'A customer starts a conversation. Its first message comes with it.',
					},
					{
						name: 'New Customer Message',
						value: 'message.received',
						description: 'A customer writes again in a conversation that already exists',
					},
				],
				description: 'The events that start the workflow',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');

				// Without a secret every delivery is refused, so `create` must issue a new one.
				if (
					typeof staticData.webhookId !== 'string' ||
					typeof staticData.webhookSecret !== 'string' ||
					staticData.webhookSecret === ''
				) {
					return false;
				}

				let webhook: IDataObject;

				try {
					webhook = await miniDeskApiRequest.call(
						this,
						'GET',
						`/webhooks/${encodeURIComponent(staticData.webhookId)}`,
					);
				} catch (error) {
					// Deleted in miniDesk: forget it so `create` registers a new one.
					if (error instanceof NodeApiError && error.httpCode === '404') {
						delete staticData.webhookId;
						delete staticData.webhookSecret;

						return false;
					}

					throw error instanceof ExecutionBaseError
						? error
						: new NodeOperationError(this.getNode(), error as Error);
				}

				const selected = [...(this.getNodeParameter('events') as string[])].sort();
				const events = Array.isArray(webhook.events)
					? [...(webhook.events as string[])].sort()
					: [];

				return (
					webhook.status === 'active' &&
					webhook.url === this.getNodeWebhookUrl('default') &&
					JSON.stringify(events) === JSON.stringify(selected)
				);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				let webhook: IDataObject;

				// No item index, so no Idempotency-Key: a re-registration must get a fresh answer.
				try {
					webhook = await miniDeskApiRequest.call(this, 'POST', '/webhooks', {
						body: {
							url: this.getNodeWebhookUrl('default'),
							events: this.getNodeParameter('events') as string[],
						},
					});
				} catch (error) {
					// n8n's "could not activate" banner shows only the message, so the hint joins it.
					if (
						error instanceof NodeApiError &&
						typeof error.description === 'string' &&
						error.description !== ''
					) {
						error.message = `${error.message}. ${error.description}`;
					}

					throw error instanceof ExecutionBaseError
						? error
						: new NodeOperationError(this.getNode(), error as Error);
				}

				// Registering a URL again resumes the same webhook with a new secret, so keep what comes back.
				staticData.webhookId = webhook.id;
				staticData.webhookSecret = webhook.secret;

				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');

				if (typeof staticData.webhookId !== 'string') return true;

				try {
					await miniDeskApiRequest.call(
						this,
						'DELETE',
						`/webhooks/${encodeURIComponent(staticData.webhookId)}`,
					);
				} catch (error) {
					// Already gone counts as done. Anything else, an owner's pause too, keeps the ID.
					if (!(error instanceof NodeApiError && error.httpCode === '404')) return false;
				}

				delete staticData.webhookId;
				delete staticData.webhookSecret;

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const response = this.getResponseObject();
		let event: IDataObject | undefined;

		// Fails closed: anything missing, odd or throwing before a valid signature is a 401.
		try {
			const raw: unknown = this.getRequestObject().rawBody;
			// Only the bytes miniDesk signed: never `getBodyData()` serialised again.
			const rawBody = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
			// n8n lowercases header names. Node joins a repeated header with commas, which the check refuses.
			const header = this.getHeaderData()['minidesk-signature'];
			const secret = this.getWorkflowStaticData('node').webhookSecret;

			if (
				typeof rawBody === 'string' &&
				typeof header === 'string' &&
				typeof secret === 'string' &&
				verifySignature(rawBody, header, secret, Math.floor(Date.now() / 1000))
			) {
				const parsed: unknown = JSON.parse(rawBody);

				if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
					event = parsed as IDataObject;
				}
			}
		} catch {
			event = undefined;
		}

		if (event === undefined) {
			response.status(401).send('Unauthorized').end();

			return { noWebhookResponse: true };
		}

		// miniDesk's test call: answer it, start nothing.
		if (event.type === 'ping') {
			response.status(200).send({ ok: true }).end();

			return { noWebhookResponse: true };
		}

		const selected = this.getNodeParameter('events', []) as string[];

		if (typeof event.type !== 'string' || !selected.includes(event.type)) return {};

		const { id, type, created_at, data } = event;

		return {
			workflowData: [
				this.helpers.returnJsonArray([{ id, type, created_at, ...(data as IDataObject) }]),
			],
		};
	}
}
