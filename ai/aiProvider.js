/**
 * aiProvider.js — Strict OpenAI Integration
 * 
 * Implements a split Two-Tier AI Architecture (Cost-Optimization):
 * - gpt-4o-mini: Used for high-volume worker filtering & parsing (cheap, low latency)
 * - gpt-4o: Used for top-tier strategic copilot tasks (high value, high intellect)
 * 
 * Legacy providers (Cerebras, Sambanova, Ollama, Groq) have been permanently purged
 * to prevent rate limits and ensure consistent format compliance.
 */
'use strict';

const OpenAI = require('openai');
const config = require('../backend/config');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let openaiClient = null;

if (config.OPENAI_API_KEY) {
    openaiClient = new OpenAI({
        apiKey: config.OPENAI_API_KEY,
    });
    console.log(`[AIProvider] ✅ OpenAI loaded via Project API Key.`);
} else {
    console.error(`[AIProvider] ❌ CRITICAL: OPENAI_API_KEY is missing from .env`);
}

/**
 * Generate text using the official OpenAI integration.
 * @param {string} systemPrompt - Standard system prompt
 * @param {string} userPrompt - User prompt to be appended
 * @param {object} options - { model: 'gpt-4o-mini' | 'gpt-4o', maxTokens, temperature, jsonMode }
 * @returns {string|null} Generated text or JSON string
 */
async function generateText(systemPrompt, userPrompt, options = {}) {
    if (!openaiClient) {
        console.error('[AIProvider] ❌ No OpenAI client available.');
        return null;
    }

    const {
        model = 'gpt-4o-mini',
        maxTokens = 2000,
        temperature = 0.3,
        jsonMode = false
    } = options;

    let retryCount = 0;
    while (retryCount < 3) {
        try {
            const params = {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt || 'Please output based on the system instructions.' }
                ],
                temperature: temperature,
                max_tokens: maxTokens,
            };

            // OpenAI strict JSON Object response format
            if (jsonMode) {
                params.response_format = { type: 'json_object' };
            }

            const response = await openaiClient.chat.completions.create(params);
            const text = response.choices[0].message.content;
            if (text) return text;

        } catch (err) {
            const msg = err.message || '';
            const isLimit = msg.includes('429') || msg.includes('rate_limit') || msg.includes('Too Many Requests');

            if (isLimit) {
                console.warn(`[AIProvider] ⚠️ Output Rate Limit on OpenAI. Retrying in 5s...`);
                await sleep(5000);
                retryCount++;
                continue;
            }

            console.error(`[AIProvider] ❌ OpenAI Error: ${msg.substring(0, 150)}`);
            break; // Non-retryable error
        }
    }

    console.error(`[AIProvider] ❌ Failed to generate from model: ${model} after retries.`);
    return null;
}

module.exports = {
    generateText,
    sleep
};

