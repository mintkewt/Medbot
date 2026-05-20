// Lightweight JS “interface” pattern for providers
class IAIProvider {
    async generateResponse(prompt, context, history = [], opts = {}) {
      throw new Error("Method 'generateResponse()' must be implemented.");
    }

    async generateResponseStream(prompt, context, history = [], onChunk) {
        throw new Error("Method 'generateResponseStream()' must be implemented.");
    }
}
module.exports = IAIProvider;