# @minidesk/n8n-nodes-minidesk

n8n community nodes for miniDesk. Work your support inbox and start workflows when conversations arrive or change.

## What It Does

This package gives you two nodes:

- **miniDesk**: read conversations and customers, create drafts, send replies, manage reference documents, and message customers.
- **miniDesk Trigger**: start workflows when a conversation is created, when a customer writes again, when a conversation is assigned, or when its status changes.

## Install

In self-hosted n8n, install the package from **Settings → Community Nodes → Install**. Enter `@minidesk/n8n-nodes-minidesk`. Once n8n verifies the package, it also appears in the nodes panel. An instance owner may need to allow verified community nodes first.

## Credentials

Create an API key in miniDesk under **Settings → API**. Use keys made just for n8n, so you can revoke them on their own. Add the key to an n8n credential named **miniDesk API**.

## Operations

All operations are grouped by resource.

### AI Draft

- **Create**: ask miniDesk's AI to write a draft reply. The draft waits in the conversation for review. If a draft is already waiting, you get that one.

Pass the draft's ID in Send Reply's **Draft ID** field, so the AI activity log shows the text came from the AI draft.

### Conversation

- **Create**: save a message a customer sent you elsewhere as a new conversation. The message must be the customer's own words, and miniDesk may email them an AI answer. miniDesk's AI may change the category and priority after the conversation arrives.
- **Get**: get a conversation. Turn off Simplify to include its messages.
- **Get Many**: get many conversations. Filter by status, priority, category, assignee, or search words.
- **Mark as Spam**: move a conversation out of the inbox into spam.
- **Message Customer**: email a customer from your team to start a new conversation. This reaches a real person. Returns `delivery` as `sent` or `held`. Held means the email did not go out, usually because a sending limit kept it back.
- **Update**: change the status, priority, category, or assignee of a conversation.

### Customer

- **Create or Update**: create a new customer record, or update the current one if it already exists. If the customer exists, only the name and note change. The email and external ID are set only when the customer is created.
- **Get**: get a customer by ID or email.
- **Get Many**: get many customers. Filter by search words.

### Knowledge

- **Add Document**: add a reference document. Documents added from n8n are saved switched off. An owner approves them in miniDesk before the AI reads them.
- **Update Document**: update a reference document. The updated document waits for approval again.
- **Delete Document**: delete a reference document.
- **Get Many**: get many reference documents.

### Message

- **Send Reply**: send a reply to the customer. This reaches a real person and cannot be unsent.
- **Add Internal Note**: add an internal note to the conversation. Only your team sees it. The customer never does.
- **Get Many**: get many messages in a conversation. It never returns internal notes.

### Team Member

- **Get Many**: get many team members. Choose whether to include members who have left or were deactivated.

## Trigger

The **miniDesk Trigger** node starts workflows on these events:

- **New Conversation**: a customer starts a conversation. Its first message comes with it.
- **New Customer Message**: a customer writes again in a conversation that already exists.
- **Conversation Assigned**: a conversation gets a new assignee, or loses its assignee.
- **Conversation Status Changed**: a conversation moves to another status, e.g. resolved.

When you activate the workflow, n8n registers a webhook in miniDesk. miniDesk emails the workspace owners when a webhook is added. The test event button adds a temporary webhook each time and removes it afterwards.

The trigger never fires for changes made with the same API key, so a workflow cannot trigger itself. This covers every workflow that uses that credential. If one workflow should start another, give the trigger its own credential with a second key.

Every request is signature-checked, and unsigned ones are refused. miniDesk retries failed deliveries, so n8n does not need to. Deliveries can arrive more than once, so deduplicate on the event `id`.

`WEBHOOK_URL` (`N8N_WEBHOOK_URL` on newer n8n versions) on the n8n instance must be its public https address.

If miniDesk pauses the webhook after failed deliveries, n8n keeps showing the workflow as active while events are dropped. Resume the webhook in miniDesk under **Settings → Webhooks**, or turn the workflow off and on. An owner's pause can only be lifted in miniDesk. If an owner paused the webhook in miniDesk, activation fails with "An owner paused this webhook. Ask them to resume it in miniDesk."

## Safety

Send Reply and Message Customer reach real people. Reference documents wait for an owner's approval.

An AI agent that reads customer messages must not have both a tool that reads other people's data (Customer: Get or Get Many, Conversation: Get or Get Many, Message: Get Many) and a tool that sends (Send Reply or Message Customer). A customer can write instructions into a message, for example asking for your customer list, and the agent may follow them. Let the agent draft or add notes. Let a person or a fixed step send.

When the miniDesk node is a tool for an AI agent, set **Tool Description** to **Set Manually** and write the **Description** field by hand. The agent otherwise sees only a short action line, such as "Send reply to customer that reaches a real person in miniDesk".

## Examples

### New Conversation to Slack

1. Add the **miniDesk Trigger** node. Select the **New Conversation** event.
2. Add the **Slack** node. Choose **Send Message**. In the message, include the conversation reference, customer email, and first message from the trigger output.

### Notion Page to Reference Document

1. Add the **Notion Trigger** node. Listen for new pages in a database.
2. Add the **miniDesk** node. Choose **Knowledge: Add Document**. Set the title and content from the Notion page.
3. Approve the document in miniDesk under **AI Agent → Knowledge** before the AI reads it.

## Compatibility

Tested with n8n 2.43.7.

## Links

- [miniDesk n8n integration guide](https://docs.minidesk.ai/integrations/n8n)
- [miniDesk webhooks documentation](https://docs.minidesk.ai/guides/webhooks)

## License

MIT
