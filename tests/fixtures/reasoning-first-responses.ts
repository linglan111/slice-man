/** Documented Responses shape: reasoning is output 0, assistant message is output 1. */
export function reasoningFirstResponses(answer: string): Record<string, unknown>[] {
  const reasoningPart = { type: "reasoning_text", text: "PRIVATE_REASONING_NOT_SAVED" };
  const reasoning = { id: "reasoning-0", type: "reasoning", summary: [], content: [reasoningPart], status: "completed" };
  const message = { id: "message-1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: answer, annotations: [] }] };
  return [
    { type: "response.created", response: { id: "response-1", status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...reasoning, content: [], status: "in_progress" } },
    { type: "response.content_part.added", output_index: 0, content_index: 0, item_id: reasoning.id, part: { type: "reasoning_text", text: "" } },
    { type: "response.reasoning_text.delta", output_index: 0, content_index: 0, item_id: reasoning.id, delta: "PRIVATE_REASONING_NOT_SAVED" },
    { type: "response.reasoning_text.done", output_index: 0, content_index: 0, item_id: reasoning.id, text: "PRIVATE_REASONING_NOT_SAVED" },
    { type: "response.content_part.done", output_index: 0, content_index: 0, item_id: reasoning.id, part: reasoningPart },
    { type: "response.output_item.done", output_index: 0, item: reasoning },
    { type: "response.output_item.added", output_index: 1, item: { ...message, status: "in_progress", content: [] } },
    { type: "response.content_part.added", output_index: 1, content_index: 0, item_id: message.id, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", output_index: 1, content_index: 0, item_id: message.id, delta: answer.slice(0, 5) },
    { type: "response.output_text.delta", output_index: 1, content_index: 0, item_id: message.id, delta: answer.slice(5) },
    { type: "response.output_text.done", output_index: 1, content_index: 0, item_id: message.id, text: answer },
    { type: "response.content_part.done", output_index: 1, content_index: 0, item_id: message.id, part: message.content[0] },
    { type: "response.output_item.done", output_index: 1, item: message },
    { type: "response.completed", response: { id: "response-1", status: "completed", output: [reasoning, message], usage: { input_tokens: 12, output_tokens: 7, output_tokens_details: { reasoning_tokens: 3 } } } },
  ];
}
