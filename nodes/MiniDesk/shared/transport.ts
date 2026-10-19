import { createHash } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

import { API_BASE_URL } from './constants';
import { apiError } from './errors';

export type IdempotencyParts = {
	executionId: string;
	nodeId: string;
	runIndex: number;
	itemIndex: number;
	method: string;
	path: string;
};

/**
 * One key per item, run and endpoint, so n8n's Retry On Fail replays the first answer.
 * The body stays out on purpose: a retry whose body changed (e.g. `{{$now}}`) keeps the
 * key, and the API answers 409 instead of sending a second reply.
 */
export function idempotencyKey(parts: IdempotencyParts): string {
	const material = JSON.stringify([
		parts.executionId,
		parts.nodeId,
		parts.runIndex,
		parts.itemIndex,
		parts.method,
		parts.path,
	]);

	return `n8n-${createHash('sha256').update(material).digest('hex')}`;
}

/** Calls `/v1<path>` with the miniDesk API credential; a refusal throws a NodeApiError. */
export async function miniDeskApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; qs?: IDataObject; itemIndex?: number } = {},
): Promise<IDataObject> {
	const { body, itemIndex } = options;
	// The API answers 400 to an empty value such as `?q=`, so those stay out.
	const qs = Object.fromEntries(
		Object.entries(options.qs ?? {}).filter(
			([, value]) => value !== undefined && value !== null && value !== '',
		),
	);
	const request: IHttpRequestOptions = {
		method,
		url: `${API_BASE_URL}${path}`,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	if (Object.keys(qs).length > 0) request.qs = qs;
	if (body !== undefined) request.body = body;

	// Only action node writes get a key. The trigger's webhook registration passes no item.
	if (
		(method === 'POST' || method === 'PUT') &&
		itemIndex !== undefined &&
		'getWorkflowDataProxy' in this
	) {
		request.headers = {
			'Idempotency-Key': idempotencyKey({
				executionId: this.getExecutionId(),
				nodeId: this.getNode().id,
				// getExecuteData().runIndex is only set for AI agent tool calls; $runIndex always is.
				runIndex: this.getWorkflowDataProxy(itemIndex).$runIndex as number,
				itemIndex,
				method,
				path,
			}),
		};
	}

	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'miniDeskApi',
		request,
	)) as { statusCode: number; body: unknown; headers?: IDataObject };

	if (response.statusCode >= 400) {
		throw apiError(
			this.getNode(),
			response.statusCode,
			response.body,
			response.headers ?? {},
			itemIndex,
		);
	}

	return response.body as IDataObject;
}

/** Follows `next_cursor` until it is null, or until `max` items are in. */
export async function miniDeskApiRequestAllItems(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	path: string,
	qs: IDataObject,
	max: number | undefined,
	itemIndex?: number,
): Promise<IDataObject[]> {
	const collected: IDataObject[] = [];
	let cursor: string | undefined;

	// A page can be empty and still have a next_cursor, so only the cursor ends the loop.
	while (max === undefined || collected.length < max) {
		const page = await miniDeskApiRequest.call(this, 'GET', path, {
			qs: {
				...qs,
				limit: max === undefined ? 100 : Math.min(100, max - collected.length),
				cursor,
			},
			itemIndex,
		});

		collected.push(...((page.data as IDataObject[] | undefined) ?? []));

		// A cursor that comes back unchanged would loop forever.
		if (
			typeof page.next_cursor !== 'string' ||
			page.next_cursor === '' ||
			page.next_cursor === cursor
		) {
			break;
		}

		cursor = page.next_cursor;
	}

	return max === undefined ? collected : collected.slice(0, max);
}
