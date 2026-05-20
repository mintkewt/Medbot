const { GoogleGenerativeAI } = require("@google/generative-ai");
const IAIProvider = require('./ai.interface');
const PROMPTS = require('../config/prompts');

class GeminiProvider extends IAIProvider {
  constructor() {
    super();
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  async generateResponse(prompt, context, history = [], opts = {}) {
    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        maxOutputTokens: 700,
        temperature: 0.5,
      },
    });
    
    // Use template from config
    const fullPrompt = opts.raw ? prompt : PROMPTS.GEMINI_PROMPT(context, history, prompt);
    
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    return response.text();
  }

  async generateResponseStream(prompt, context, history = [], onChunk) {
    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        maxOutputTokens: 700,
        temperature: 0.5,
      },
    });
    const fullPrompt = PROMPTS.GEMINI_PROMPT(context, history, prompt);
    
    const result = await model.generateContentStream(fullPrompt);

    let fullText = "";
    for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        if (onChunk) onChunk(chunkText);
    }
    return fullText;
  }
}
module.exports = GeminiProvider;