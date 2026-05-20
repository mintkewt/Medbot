const axios = require("axios");
const IAIProvider = require("./ai.interface");
const PROMPTS = require("../config/prompts");
const logger = require("../utils/logger");

class OneMinProvider extends IAIProvider {
  constructor() {
    super();
    // this.model = 'gemini-2.5-flash';
    this.model = "gpt-4o-mini";
  }

  async generateResponse(userQuestion, context, history = [], opts = {}) {
    const hackPrompt = opts.raw
      ? userQuestion
      : PROMPTS.ONEMIN_PROMPT(context, history, userQuestion);

    const payload = {
      type: "CONTENT_GENERATOR_EMAIL_REPLY",
      model: this.model,
      conversationId: "CONTENT_GENERATOR_EMAIL_REPLY",
      promptObject: {
        tone: "professional",
        language: "English",
        prompt: hackPrompt,
      },
    };

    try {
      logger.debug("onemin.request", { model: this.model });

      const response = await axios.post(
        "https://api.1min.ai/api/features",
        payload,
        {
          headers: {
            "API-KEY": process.env.ONEMIN_API_KEY,
            "Content-Type": "application/json",
          },
          timeout: 18_000,
        },
      );

      let rawData = response.data;

      if (typeof rawData === "string") {
        try {
          rawData = JSON.parse(rawData);
        } catch (e) {
          logger.debug("onemin.response.plain_string", {
            parseError: e.message,
          });
        }
      }

      if (rawData?.aiRecord?.status === "FAILURE") {
        const errMsg =
          rawData.aiRecord?.aiRecordDetail?.resultObject?.message ||
          "1min.ai API failure";
        throw new Error(errMsg);
      }

      const extractedText =
        rawData?.aiRecord?.aiRecordDetail?.resultObject?.[0];

      if (extractedText) {
        return extractedText;
      }

      const fallbackText = rawData?.output || rawData?.result || rawData?.text;
      if (fallbackText) return fallbackText;

      logger.warn("onemin.extract.miss", {
        sample:
          typeof rawData === "object" && rawData
            ? Object.keys(rawData).slice(0, 12)
            : typeof rawData,
      });
      return PROMPTS.ERROR_1MIN_FORMAT;
    } catch (error) {
      logger.error("onemin.request.failed", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error("1minAI Provider Failed");
    }
  }

  async generateResponseStream(userQuestion, context, history = [], onChunk) {
    const finalPrompt = PROMPTS.ONEMIN_PROMPT(context, history, userQuestion);

    const payload = {
      type: "UNIFY_CHAT_WITH_AI",
      model: this.model,
      promptObject: {
        prompt: finalPrompt,
        settings: {
          webSearchSettings: { webSearch: false },
          historySettings: { isMixed: false },
        },
      },
    };

    logger.debug("onemin.stream.request", { model: this.model });

    const response = await axios.post(
      "https://api.1min.ai/api/chat-with-ai?isStreaming=true",
      payload,
      {
        headers: {
          "API-KEY": process.env.ONEMIN_API_KEY,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        responseType: "stream",
        timeout: 60000,
      },
    );

    return new Promise((resolve, reject) => {
      let fullText = "";
      let buffer = "";

      response.data.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const dataStr = trimmed.substring(5).trim();
          if (!dataStr || dataStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(dataStr);

            if (parsed.aiRecord?.status === "FAILURE") {
              const errMsg =
                parsed.aiRecord?.aiRecordDetail?.resultObject?.message ||
                "1min.ai stream failure";
              reject(new Error(errMsg));
              return;
            }

            const content = parsed.content || parsed.text || "";
            if (content) {
              fullText += content;
              if (onChunk) onChunk(content);
            }
          } catch (_) {
            // non-JSON data lines (event: done, etc.)
          }
        }
      });

      response.data.on("end", () => resolve(fullText));
      response.data.on("error", (err) => {
        logger.error("onemin.stream.data.error", { message: err.message });
        reject(err);
      });
    });
  }
}

module.exports = OneMinProvider;
