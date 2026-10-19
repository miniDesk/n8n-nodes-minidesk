import type { IDataObject, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/** Turns a miniDesk refusal (`{ error: { code, message, field } }`) into copy that says what to do. */
export function apiError(
	node: INode,
	statusCode: number,
	body: unknown,
	headers: IDataObject,
	itemIndex: number | undefined,
): NodeApiError {
	// A proxy in front of miniDesk can answer with HTML, so nothing here assumes the shape.
	const error = ((body as { error?: unknown } | null | undefined)?.error ?? {}) as IDataObject;
	const field = typeof error.field === 'string' && error.field !== '' ? error.field : undefined;

	const apiMessage =
		typeof error.message === 'string' && error.message !== '' ? error.message : undefined;

	let message = 'miniDesk could not complete the request';
	let description = apiMessage;

	switch (error.code) {
		case 'invalid_credential':
			message = 'miniDesk refused the API key';
			description =
				"Check the key in the 'miniDesk API' credential. Keys are created in miniDesk under Settings → API, and a revoked key stops working at once.";
			break;
		case 'forbidden':
			message = 'miniDesk does not allow this API key to do that';
			break;
		case 'not_found':
			message = 'miniDesk could not find that item';
			description =
				'Check the ID or reference. It may have been deleted, or it may belong to another workspace.';
			break;
		case 'validation_failed':
			if (field === 'url') {
				message = 'miniDesk can only send events to a public https address';
				description =
					'Set WEBHOOK_URL (N8N_WEBHOOK_URL on newer n8n versions) on your n8n instance to its public https address, then activate the workflow again.';
			} else {
				message =
					field === undefined
						? 'miniDesk rejected the request'
						: `miniDesk rejected the value of '${field}'`;
			}
			break;
		case 'invalid_transition':
			message = 'miniDesk does not allow that status change';
			break;
		case 'conflict':
			message = 'miniDesk refused the request';
			break;
		case 'ai_disabled':
			message = 'AI is turned off for this workspace';
			description = 'An owner can turn it on in miniDesk.';
			break;
		case 'rate_limited': {
			const retryAfter = Object.entries(headers).find(
				([name]) => name.toLowerCase() === 'retry-after',
			)?.[1];
			const seconds = retryAfter === undefined ? undefined : String(retryAfter);
			const wait =
				seconds === undefined ? 'a moment' : `${seconds} ${seconds === '1' ? 'second' : 'seconds'}`;

			message = 'Too many requests to miniDesk with this API key';
			description = `Wait ${wait} and try again, or turn on 'Retry On Fail' in the node settings.`;
			break;
		}
		default:
			// The API's message carries the request ID on a 500; an HTML 502 or empty 504 has none.
			description =
				apiMessage ?? "Try again in a moment, or turn on 'Retry On Fail' in the node settings.";
	}

	return new NodeApiError(
		node,
		(typeof body === 'object' && body !== null ? body : { body }) as JsonObject,
		{
			message: itemIndex === undefined ? message : `${message} [Item ${itemIndex}]`,
			description,
			httpCode: String(statusCode),
			itemIndex,
		},
	);
}
