const fs = require('fs');
const path = require('path');

const buildHistoryText = (history) => {
    if (!history || history.length === 0) return "";
    return history.map(msg => `${msg.role === 'user' ? 'User' : 'Bot'}: ${msg.content}`).join('\n');
};

function structuredXmlToPlainText(inner) {
    return inner
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join('\n');
}

function loadSystemInstructionsFromXml() {
    const xmlPath = path.join(__dirname, 'systemprompt.xml');
    let raw = fs.readFileSync(xmlPath, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

    const cdata = raw.match(/<systemPrompt[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/systemPrompt>/i);
    if (cdata) {
        return cdata[1].trim();
    }

    const block = raw.match(/<systemPrompt[^>]*>([\s\S]*?)<\/systemPrompt>/i);
    if (!block) {
        throw new Error(
            `Invalid ${path.basename(xmlPath)}: wrap content in <systemPrompt>…</systemPrompt> or use CDATA inside it.`
        );
    }
    return structuredXmlToPlainText(block[1]);
}

const SYSTEM_INSTRUCTIONS = loadSystemInstructionsFromXml();

const buildPrompt = (context, history, question) => `${SYSTEM_INSTRUCTIONS}

[CONVERSATION HISTORY]
${buildHistoryText(history)}

[KNOWLEDGE CONTEXT]
${context}

[USER QUESTION]
${question}`;

module.exports = {
  GREETING_RESPONSE: "Hello. I am a medical assistant. I can only answer questions using the information in the system knowledge base.",

  ERROR_SYSTEM: "The system is busy. Please try again shortly.",

  ERROR_1MIN_FORMAT: "Sorry, I had a response but hit a display formatting error.",

  GEMINI_PROMPT: buildPrompt,
  ONEMIN_PROMPT: buildPrompt,

  SYSTEM_INSTRUCTIONS,
  buildHistoryText,
};
