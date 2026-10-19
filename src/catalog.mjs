export const DIALECTS = { chat: "chat", responses: "responses" };

export function buildModelsResponse(config) {
  return {
    object: "list",
    data: config.providers.flatMap(provider => provider.models.map(model => ({
      id: model.hubId,
      object: "model",
      created: 0,
      owned_by: provider.id,
      provider: provider.id,
      display_name: model.displayName,
      context_window: model.contextWindow,
      dialect: provider.dialect,
      capabilities: {
        streaming: true,
        // The beta proxies each bridge's native dialect; tools/images are provider-owned.
        tools: false,
        images: false,
        thinking: model.thinking,
      },
    }))),
  };
}

/** OpenAI-style error envelope used by both frontends. */
export function errorBody(type, message) {
  return { error: { type, message } };
}
