/**
 * Responses <-> Chat Completions translation.
 *
 * The beta hub proxies native dialects; this module adds the direction Codex needs most:
 * a Responses client talking to a Chat Completions bridge (DeepSeek today).
 * Text, usage and function calls are translated; images are rejected explicitly.
 */

const TEXT_CONTENT_TYPES = new Set(["input_text", "output_text", "text", "summary_text"]);

export class TranslateError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
}

/** Convert a Responses request body into a Chat Completions request body. */
export function responsesRequestToChat(body, upstreamModel) {
  if (!body || typeof body !== "object") throw new TranslateError("invalid_request_error", "body must be an object");
  const messages = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions });
  }
  const input = body.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) messages.push(...responseItemToChat(item));
  } else if (input !== undefined) {
    throw new TranslateError("invalid_request_error", "input must be a string or an array");
  }
  if (messages.length === 0) {
    throw new TranslateError("invalid_request_error", "input produced no chat messages");
  }
  const chat = { model: upstreamModel, messages };
  if (body.stream === true) chat.stream = true;
  if (Number.isFinite(body.max_output_tokens)) chat.max_tokens = body.max_output_tokens;
  if (body.temperature !== undefined) chat.temperature = body.temperature;
  if (body.top_p !== undefined) chat.top_p = body.top_p;
  if (Array.isArray(body.tools)) chat.tools = responsesToolsToChat(body.tools);
  if (body.tool_choice !== undefined) chat.tool_choice = responsesToolChoiceToChat(body.tool_choice);
  if (body.parallel_tool_calls !== undefined) chat.parallel_tool_calls = body.parallel_tool_calls;
  return chat;
}

function responseItemToChat(item) {
  if (!item || typeof item !== "object") throw new TranslateError("invalid_request_error", "input item must be an object");
  switch (item.type) {
    case undefined:
    case "message": {
      const role = item.role === "developer" ? "system" : item.role;
      if (!["user", "assistant", "system"].includes(role)) {
        throw new TranslateError("invalid_request_error", `unsupported message role: ${String(item.role)}`);
      }
      return [{ role, content: contentToChatText(item.content) }];
    }
    case "function_call": {
      return [{
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id ?? item.id ?? `call_${item.name ?? "tool"}`,
          type: "function",
          function: { name: String(item.name ?? ""), arguments: typeof item.arguments === "string" ? item.arguments : "{}" },
        }],
      }];
    }
    case "function_call_output": {
      return [{
        role: "tool",
        tool_call_id: String(item.call_id ?? ""),
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      }];
    }
    case "reasoning":
      // Reasoning items are provider state; the Chat dialect has no equivalent slot.
      return [];
    default:
      throw new TranslateError("unsupported_input", `unsupported input item type: ${String(item.type)}`);
  }
}

function contentToChatText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new TranslateError("invalid_request_error", "message content must be a string or an array");
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== "object") throw new TranslateError("invalid_request_error", "content part must be an object");
    if (TEXT_CONTENT_TYPES.has(part.type)) {
      parts.push(String(part.text ?? ""));
      continue;
    }
    if (part.type === "input_image" || part.type === "image_url" || part.type === "image") {
      throw new TranslateError("unsupported_input", "image input is not supported by this bridge translation (text only)");
    }
    if (part.type === "input_file" || part.type === "file") {
      throw new TranslateError("unsupported_input", "file input is not supported by this bridge translation");
    }
    throw new TranslateError("unsupported_input", `unsupported content part: ${String(part.type)}`);
  }
  return parts.join("");
}

function responsesToolsToChat(tools) {
  return tools
    .filter(tool => tool && (tool.type === undefined || tool.type === "function"))
    .map(tool => ({
      type: "function",
      function: {
        name: String(tool.name ?? ""),
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.parameters ?? { type: "object", properties: {} },
      },
    }));
}

function responsesToolChoiceToChat(choice) {
  if (typeof choice === "string") return choice;
  if (choice && typeof choice === "object" && (choice.type === "function" || choice.name)) {
    return { type: "function", function: { name: String(choice.name ?? "") } };
  }
  return "auto";
}

/** Convert a non-streaming Chat Completions response into a Responses response. */
export function chatJsonToResponsesJson(chat, { model, id }) {
  if (!chat || typeof chat !== "object") throw new TranslateError("provider_error", "upstream returned an invalid body");
  const choice = Array.isArray(chat.choices) ? chat.choices[0] : undefined;
  const message = choice?.message ?? {};
  const output = [];
  const text = typeof message.content === "string" ? message.content : "";
  if (text) {
    output.push({
      id: `msg_${id}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    });
  }
  for (const [index, call] of (Array.isArray(message.tool_calls) ? message.tool_calls : []).entries()) {
    output.push({
      id: `fc_${id}_${index}`,
      type: "function_call",
      status: "completed",
      call_id: call.id ?? `call_${index}`,
      name: call.function?.name ?? "",
      arguments: call.function?.arguments ?? "{}",
    });
  }
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output,
    parallel_tool_calls: false,
    tool_choice: "auto",
    tools: [],
    usage: usageToResponses(chat.usage),
  };
}

function usageToResponses(usage) {
  const input = Number(usage?.prompt_tokens ?? 0);
  const output = Number(usage?.completion_tokens ?? 0);
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: Number(usage?.total_tokens ?? input + output),
  };
}

/**
 * Streaming translator: Chat Completions SSE in, Responses SSE out.
 *
 * Emits the minimal event sequence Codex consumes (created, output item/part, deltas,
 * done events, completed with usage). Reasoning deltas stay on the wire as reasoning text.
 */
export class ChatToResponsesTransform {
  constructor({ model, responseId }) {
    this.model = model;
    this.responseId = responseId;
    this.buffer = "";
    this.started = false;
    this.text = "";
    this.messageItemId = `msg_${responseId}`;
    this.messageStarted = false;
    this.outputIndex = 0;
    this.toolCalls = new Map();
    this.usage = null;
    this.finished = false;
    this.controller = null;
  }

  setController(controller) {
    this.controller = controller;
  }

  feed(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      this.handleLine(line);
    }
  }

  handleLine(line) {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      this.finish();
      return;
    }
    if (!payload) return;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }
    this.ensureStarted();
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    const delta = choice?.delta ?? {};
    if (typeof delta.content === "string" && delta.content) this.emitText(delta.content);
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      this.emitReasoning(delta.reasoning_content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) this.emitToolCall(call);
    }
    if (chunk.usage) this.usage = chunk.usage;
  }

  ensureStarted() {
    if (this.started) return;
    this.started = true;
    this.emit("response.created", {
      type: "response.created",
      response: this.baseResponse("in_progress"),
    });
    this.emit("response.in_progress", {
      type: "response.in_progress",
      response: this.baseResponse("in_progress"),
    });
  }

  emitText(text) {
    this.ensureStarted();
    if (!this.messageStarted) {
      this.messageStarted = true;
      const item = {
        id: this.messageItemId,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [{ type: "output_text", text: "", annotations: [] }],
      };
      this.emit("response.output_item.added", {
        type: "response.output_item.added",
        output_index: this.outputIndex,
        item,
      });
      this.emit("response.content_part.added", {
        type: "response.content_part.added",
        item_id: this.messageItemId,
        output_index: this.outputIndex,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      });
    }
    this.text += text;
    this.emit("response.output_text.delta", {
      type: "response.output_text.delta",
      item_id: this.messageItemId,
      output_index: this.outputIndex,
      content_index: 0,
      delta: text,
    });
  }

  emitReasoning(text) {
    this.ensureStarted();
    this.emit("response.reasoning_text.delta", {
      type: "response.reasoning_text.delta",
      item_id: `rs_${this.responseId}`,
      output_index: this.outputIndex,
      content_index: 0,
      delta: text,
    });
  }

  emitToolCall(call) {
    this.ensureStarted();
    const index = Number.isInteger(call.index) ? call.index : 0;
    let state = this.toolCalls.get(index);
    if (!state) {
      state = {
        itemId: `fc_${this.responseId}_${index}`,
        callId: call.id ?? `call_${this.responseId}_${index}`,
        name: call.function?.name ?? "",
        arguments: "",
        outputIndex: this.outputIndex++,
        added: false,
      };
      this.toolCalls.set(index, state);
    }
    if (!state.added) {
      state.added = true;
      this.emit("response.output_item.added", {
        type: "response.output_item.added",
        output_index: state.outputIndex,
        item: {
          id: state.itemId,
          type: "function_call",
          status: "in_progress",
          call_id: state.callId,
          name: state.name,
          arguments: "",
        },
      });
    }
    const delta = call.function?.arguments;
    if (typeof delta === "string" && delta) {
      state.arguments += delta;
      this.emit("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        item_id: state.itemId,
        output_index: state.outputIndex,
        delta,
      });
    }
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.ensureStarted();
    const output = [];
    if (this.messageStarted) {
      this.emit("response.output_text.done", {
        type: "response.output_text.done",
        item_id: this.messageItemId,
        output_index: 0,
        content_index: 0,
        text: this.text,
      });
      this.emit("response.content_part.done", {
        type: "response.content_part.done",
        item_id: this.messageItemId,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: this.text, annotations: [] },
      });
      this.emit("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          id: this.messageItemId,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: this.text, annotations: [] }],
        },
      });
      output.push({
        id: this.messageItemId,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: this.text, annotations: [] }],
      });
    }
    for (const state of [...this.toolCalls.values()].sort((left, right) => left.outputIndex - right.outputIndex)) {
      this.emit("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: state.itemId,
        output_index: state.outputIndex,
        arguments: state.arguments,
      });
      this.emit("response.output_item.done", {
        type: "response.output_item.done",
        output_index: state.outputIndex,
        item: {
          id: state.itemId,
          type: "function_call",
          status: "completed",
          call_id: state.callId,
          name: state.name,
          arguments: state.arguments,
        },
      });
      output.push({
        id: state.itemId,
        type: "function_call",
        status: "completed",
        call_id: state.callId,
        name: state.name,
        arguments: state.arguments,
      });
    }
    this.emit("response.completed", {
      type: "response.completed",
      response: {
        ...this.baseResponse("completed"),
        output,
        usage: usageToResponses(this.usage),
      },
    });
  }

  baseResponse(status) {
    return {
      id: this.responseId,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status,
      model: this.model,
      output: [],
    };
  }

  emit(type, payload) {
    if (!this.controller) return;
    this.controller.enqueue(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
}

export function newResponseId() {
  return `resp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Convert a Chat Completions request body into a Responses request body. */
export function chatRequestToResponses(body, upstreamModel) {
  if (!body || typeof body !== "object") throw new TranslateError("invalid_request_error", "body must be an object");
  const input = [];
  const instructions = [];
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    if (!message || typeof message !== "object") throw new TranslateError("invalid_request_error", "message must be an object");
    if (message.role === "system" || message.role === "developer") {
      instructions.push(chatContentToText(message.content));
      continue;
    }
    if (message.role === "user") {
      input.push({ type: "message", role: "user", content: [{ type: "input_text", text: chatContentToText(message.content) }] });
      continue;
    }
    if (message.role === "assistant") {
      const text = chatContentToText(message.content);
      if (text) input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        input.push({
          type: "function_call",
          call_id: call.id ?? `call_${input.length}`,
          name: call.function?.name ?? "",
          arguments: call.function?.arguments ?? "{}",
        });
      }
      continue;
    }
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id ?? "",
        output: chatContentToText(message.content),
      });
      continue;
    }
    throw new TranslateError("invalid_request_error", `unsupported chat role: ${String(message.role)}`);
  }
  if (input.length === 0) throw new TranslateError("invalid_request_error", "messages produced no Responses input");
  const responses = { model: upstreamModel, input };
  if (instructions.length > 0) responses.instructions = instructions.join("\n\n");
  if (body.stream === true) responses.stream = true;
  if (Number.isFinite(body.max_tokens)) responses.max_output_tokens = body.max_tokens;
  if (body.temperature !== undefined) responses.temperature = body.temperature;
  if (body.top_p !== undefined) responses.top_p = body.top_p;
  if (Array.isArray(body.tools)) {
    responses.tools = body.tools
      .filter(tool => tool && (tool.type === undefined || tool.type === "function"))
      .map(tool => ({
        type: "function",
        name: String(tool.function?.name ?? tool.name ?? ""),
        ...(tool.function?.description ? { description: tool.function.description } : {}),
        parameters: tool.function?.parameters ?? { type: "object", properties: {} },
      }));
  }
  if (body.tool_choice !== undefined) responses.tool_choice = chatToolChoiceToResponses(body.tool_choice);
  return responses;
}

function chatContentToText(content) {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new TranslateError("invalid_request_error", "content must be a string or an array");
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== "object") throw new TranslateError("invalid_request_error", "content part must be an object");
    if (part.type === "text" || part.type === "input_text" || part.type === "output_text") {
      parts.push(String(part.text ?? ""));
      continue;
    }
    if (part.type === "image_url" || part.type === "input_image") {
      throw new TranslateError("unsupported_input", "image input is not supported by this bridge translation (text only)");
    }
    throw new TranslateError("unsupported_input", `unsupported content part: ${String(part.type)}`);
  }
  return parts.join("");
}

function chatToolChoiceToResponses(choice) {
  if (typeof choice === "string") return choice;
  if (choice && typeof choice === "object" && choice.type === "function") {
    return { type: "function", name: String(choice.function?.name ?? "") };
  }
  return "auto";
}

/** Convert a non-streaming Responses response into a Chat Completions response. */
export function responsesJsonToChatJson(responses, { model, id }) {
  if (!responses || typeof responses !== "object") throw new TranslateError("provider_error", "upstream returned an invalid body");
  const output = Array.isArray(responses.output) ? responses.output : [];
  const text = output
    .filter(item => item.type === "message")
    .flatMap(item => (Array.isArray(item.content) ? item.content : []))
    .filter(part => part.type === "output_text")
    .map(part => part.text ?? "")
    .join("");
  const calls = output.filter(item => item.type === "function_call");
  const usage = responses.usage ?? {};
  const promptTokens = Number(usage.input_tokens ?? 0);
  const completionTokens = Number(usage.output_tokens ?? 0);
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text || (calls.length > 0 ? null : ""),
        ...(calls.length > 0 ? {
          tool_calls: calls.map((call, index) => ({
            id: call.call_id ?? `call_${index}`,
            type: "function",
            function: { name: call.name ?? "", arguments: call.arguments ?? "{}" },
          })),
        } : {}),
      },
      finish_reason: calls.length > 0 ? "tool_calls" : "stop",
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: Number(usage.total_tokens ?? promptTokens + completionTokens),
    },
  };
}

/**
 * Streaming translator: Responses SSE in, Chat Completions SSE out.
 */
export class ResponsesToChatTransform {
  constructor({ model }) {
    this.model = model;
    this.buffer = "";
    this.messageStarted = false;
    this.tools = new Map();
    this.nextToolIndex = 0;
    this.finished = false;
    this.controller = null;
    this.usage = null;
  }

  setController(controller) {
    this.controller = controller;
  }

  feed(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      this.handleLine(line);
    }
  }

  handleLine(line) {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (event.type === "response.output_text.delta" && event.delta) {
      this.messageStarted = true;
      this.emitDelta({ content: event.delta });
      return;
    }
    if (event.type === "response.reasoning_text.delta" && event.delta) {
      this.emitDelta({ reasoning_content: event.delta });
      return;
    }
    if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
      const index = this.nextToolIndex++;
      this.tools.set(event.item.id, { index, id: event.item.call_id });
      this.emitDelta({
        tool_calls: [{
          index,
          id: event.item.call_id,
          type: "function",
          function: { name: event.item.name, arguments: "" },
        }],
      });
      return;
    }
    if (event.type === "response.function_call_arguments.delta") {
      const tool = this.tools.get(event.item_id);
      if (tool) this.emitDelta({ tool_calls: [{ index: tool.index, function: { arguments: event.delta } }] });
      return;
    }
    if (event.type === "response.completed") {
      this.usage = event.response?.usage ?? null;
      this.finish();
      return;
    }
    if (event.type === "response.failed" || event.type === "error") {
      this.emit({
        error: {
          type: "provider_error",
          message: event.response?.error?.message ?? event.error?.message ?? "Upstream response failed",
        },
      });
      this.finish();
    }
  }

  emitDelta(delta) {
    this.emit({ choices: [{ index: 0, delta, finish_reason: null }] });
  }

  emit(payload) {
    if (!this.controller) return;
    this.controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    const usage = this.usage ?? {};
    this.emit({
      choices: [{
        index: 0,
        delta: {},
        finish_reason: this.tools.size > 0 ? "tool_calls" : "stop",
      }],
      usage: {
        prompt_tokens: Number(usage.input_tokens ?? 0),
        completion_tokens: Number(usage.output_tokens ?? 0),
        total_tokens: Number(usage.total_tokens ?? 0),
      },
    });
    this.controller?.enqueue("data: [DONE]\n\n");
  }
}
