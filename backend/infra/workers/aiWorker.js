/**
 * SIS v2 AI Worker — Deep Context Synthesizer (GPT-4o)
 * 
 * This worker picks up qualified signals and handles the "Heavy Intelligence"
 * work: Mini Audits, Openers, and Next Best Actions.
 */

const database = require('../../core/data_store/database');
const { generateLeadCard } = require('../../../ai/prompts/salesCopilot');

const POLL_INTERVAL = 10000; // 10s
let isProcessing = false;

async function runSISAIWorker() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        // 1. Find a relevant classification that doesn't have a Lead Card yet
        const target = database._db.prepare(`
            SELECT pc.*, rp.id as raw_post_id
            FROM post_classifications pc
            JOIN raw_posts rp ON pc.raw_post_id = rp.id
            LEFT JOIN lead_cards lc ON pc.raw_post_id = lc.raw_post_id
            WHERE pc.is_relevant = 1 
            AND pc.recommended_lane IN ('resolved_lead', 'partial_lead')
            AND lc.id IS NULL
            ORDER BY pc.intent_score DESC
            LIMIT 1
        `).get();

        if (!target) {
            isProcessing = false;
            return;
        }

        console.log(`[SIS AI Worker] 🧠 Synthesizing Deep Strategy for Signal #${target.raw_post_id} (Lane: ${target.recommended_lane})`);

        // 2. Generate Lead Card (GPT-4o)
        await generateLeadCard(target.raw_post_id);

        console.log(`[SIS AI Worker] ✅ Strategy Synthesized for Signal #${target.raw_post_id}`);

    } catch (err) {
        console.error(`[SIS AI Worker] ❌ Loop error:`, err.message);
    } finally {
        isProcessing = false;
    }
}

// Start
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  🧠 SIS v2: Deep Context AI Synthesizer (GPT-4o)      ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log(`[SIS AI Worker] 🔄 Polling classifications every ${POLL_INTERVAL / 1000}s...`);

setInterval(runSISAIWorker, POLL_INTERVAL);
runSISAIWorker();
