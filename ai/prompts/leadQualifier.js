/**
 * SIS v2 Lead Qualifier — Signal-Centric Classification
 * 
 * Replaces legacy Lead Qualifier with a high-resolution signal processor.
 * 1. ZERO-COST SIEVE: Filters out obvious noise/domestic using regex.
 * 2. SYMBOLIC GRADING: AI grades signal across 6 commercial metrics.
 * 3. LANE ROUTING: Maps signals to Resolved, Partial, Anonymous, or Competitor.
 * 4. DB INTEGRATION: Saves to raw_posts and post_classifications.
 */

const aiProvider = require('../aiProvider');
const { buildSystemPrompt, buildUserPrompt, buildBatchPrompt } = require('../agents/promptBuilder');
const { saveClassification: saveToMemory } = require('../agents/memoryStore');
const database = require('../../backend/core/data_store/database');

// ═══════════════════════════════════════════════════════
// REGEX SIEVE (Zero-Cost Noise Filtering)
// ═══════════════════════════════════════════════════════

const PROVIDER_REGEX = /(chúng tôi nhận gửi|quy trình gửi hàng|lợi ích khi gửi hàng với chúng tôi|nhận gửi hàng đi|chuyên tuyến việt|cước phí cạnh tranh|cam kết giao tận tay|we offer fulfillment|shipping services from us|dịch vụ vận chuyển uy tín|không phát sinh chi phí|bao thuế bao luật|nhận pick up|đóng gói miễn phí|hút chân không|dạ em nhận|em chuyên nhận|em chuyên vận chuyển|em chuyên gửi|em nhận ship|em nhận gửi|nhận vận chuyển|tham khảo ngay|viettel post|epacket|saigonbay|nhận ship hàng|dịch vụ ship|đặt ship ngay|chuyên gửi|nhận gửi|dịch vụ gửi|giao hàng nhanh|ship cod|bên em chuyên|bên em nhận|bên mình chuyên|bên mình nhận|giải pháp gửi hàng|ready to scale|from warehousing|we ship|we offer|just launched.*(fulfillment|warehouse)|moving into our new|ecoli express|free quote|get started today|our warehouse|customs clearance|mở rộng sản xuất|sẵn sàng cùng seller|xưởng.*sản xuất|fulfill trực tiếp|giá xưởng|giá gốc|cần thêm thông tin.*nhắn|siêu lợi nhuận|ưu đãi.*seller|chương trình.*ưu đãi|sẵn sàng phục vụ|phục vụ.*seller|cung cấp dịch vụ|chúng tôi cung cấp|we\s+provide|we\s+specialize|our\s+service|đường sea chỉ từ|đường bay chỉ từ|bay cargo|cước.{0,10}\d+[eđdk]\/kg|hỗ trợ đóng gói|hỗ trợ lưu kho|pick.?up tận nơi|pick.?up tận nhà|free nhận đồ|free nhận hàng|nhận đồ tại nhà|xử lý trọn gói|đừng bỏ lỡ|mở ưu đãi|cước.*chỉ\s*(?:tử\s*)?\d|bay thẳng.*\d+[eđdk]|chuyên tuyến Mỹ|chuyên tuyến Úc|chuyên tuyến EU|ship mỹ giá|ship úc giá|ship hàng giá rẻ|vận chuyển giá rẻ|logistics giá rẻ|giá cước siêu|lh zalo|gửi hàng giá rẻ|quốc tế giá rẻ|vận tải quốc tế|chào các seller|chào các shop|em có line|mình có line|line bao thuế|đi bay 3-5 ngày|đi sea 15-20 ngày|đi bay bao|đi sea bao|giá bao thuế|sẵn kho hỗ trợ|em có kho hỗ trợ|mình có kho hỗ trợ|support seller|basecost|base cost|moq tối thiểu|không yêu cầu moq|nhận gia công|bỏ sỉ|nguồn sỉ|nhà máy sản xuất|cảnh báo có items|tư vấn tạo acc|bán tài khoản|mở khóa tài khoản|cung cấp vps|thuê vps)/i;
const IRRELEVANT_REGEX = /(hướng dẫn.*(pod|dropship|cách làm|chạy ads|bán hàng)|cách (làm|tạo|bắt đầu).*(pod|dropship|tiktok shop|etsy)|chia sẻ kinh nghiệm.*(pod|dropship)|recipe|cooking|football|soccer|gaming|movie|trailer|music video|crypto airdrop|token launch|weight loss|diet pill|korean bbq|beef|chicken|salad|mushroom|makeup|skincare|nail art|hair style|workout|gym|fitness|bible verse|prayer|astrology|horoscope|ritual|spell|food stamp|military|warzone|nuclear|missile|burmese|myanmar|capcut pioneer|kpop|anime|concert|healing|meditation|tạo acc etsy|thuê cổng thanh toán)/i;
const DOMESTIC_VN_REGEX = /(giao hàng nhanh nội|ship cod toàn quốc|chuyển phát nội tỉnh|vận chuyển nội địa|giao tận nơi trong nước|ship nội thành|giao hàng toàn quốc|giao hàng tiết kiệm|giao hàng nhanh j&t|viettel post nội địa|nhất tín logistics|ghn nội địa)/i;
const IMPORT_VN_REGEX = /(nhập khẩu từ|nhập.*từ.*về|về việt nam|về vn|từ mỹ về|từ us về|từ nhật về|từ hàn về|từ úc về|từ uk về|từ châu âu về|order taobao|nhập hàng trung|nhập hàng mỹ|mua hộ hàng)/i;
const RECRUITMENT_REGEX = /(tuyển dụng|cần tuyển|tìm việc|ứng tuyển|gửi cv|lương cứng|thu nhập hấp dẫn|tuyển dropship|tuyển seller|tuyển ctv|cộng tác viên|tuyển nhân viên|looking for va|virtual assistant|hiring|cần tìm việc|ai có việc|tuyển affiliate|phỏng vấn|tuyển gấp)/i;
const MUST_HAVE_KEYWORDS = /(ship|vận chuyển|fulfillment|fulfill|pod|dropship|gửi hàng|tuyến|kho|warehouse|giá|báo giá|tìm đơn vị|logistics|3pl|fba|ecommerce|e-commerce|seller|bán hàng|order|đơn hàng|tracking|inventory|supplier|basecost|print on demand|freight|cargo|express|đóng gói|cần tìm|xưởng|prep|xin|nhờ|hỏi|tìm|cần|review|recommend|line us|ddp|forwarder|thông quan|customs|lcl|fcl|cbm|pallet|container|amazon|tiktok shop|etsy|shopify|mua hàng|hàng từ|gửi về|ship về|nhờ ai|ai biết|chỗ nào|ở đâu|mua ở|đặt hàng|order hàng|mua sỉ|nhập hàng|nguồn hàng|đồ từ|hàng việt|hàng trung|gom hàng|in áo|mẫu in)/i;

// ═══════════════════════════════════════════════════════
// CLASSIFICATION WORKER
// ═══════════════════════════════════════════════════════

/**
 * Classify a batch of posts using SIS v2 logic
 * @param {Array} posts - Array of raw posts from scraper
 */
async function classifyPosts(posts) {
    console.log(`[SIS v2 Classifier] 🧠 Analyzing ${posts.length} signals...`);

    const toClassify = [];
    const results = [];

    // Layer 1: Sieve
    for (const post of posts) {
        const content = post.content || '';
        if (content.length < 10) continue;

        // [SIS v2.5] Aggressive Competitor Block (Zero-Cost Sieve)
        if (PROVIDER_REGEX.test(content)) {
            console.log(`[Sieve] 🛡️  Shield: Competitor/Provider detected: ${content.substring(0, 50)}`);
            const competitorResult = {
                ...post,
                recommended_lane: 'competitor_intel',
                is_relevant: true,
                entity_type: 'competitor',
                intent_score: 10,
                competitor_probability: 95,
                reason_summary: 'Obvious Provider/Logistics Ad (Sieve Block)'
            };
            await saveToSIS(competitorResult);
            results.push(competitorResult);
            continue;
        }

        if (DOMESTIC_VN_REGEX.test(content) || IRRELEVANT_REGEX.test(content) || IMPORT_VN_REGEX.test(content) || RECRUITMENT_REGEX.test(content)) {
            console.log(`[Sieve] 🚫 Discarded (Domestic/Irrelevant/Import/Recruit): ${content.substring(0, 50)}`);
            results.push({ ...post, recommended_lane: 'discard', is_relevant: false, reason_summary: 'Domestic, Irrelevant, Import, or Recruitment' });
            continue;
        }

        if (!MUST_HAVE_KEYWORDS.test(content) && content.length < 150) {
            console.log(`[Sieve] 🚫 Discarded (No Keywords): ${content.substring(0, 50)}`);
            results.push({ ...post, recommended_lane: 'discard', is_relevant: false, reason_summary: 'No business keywords' });
            continue;
        }

        toClassify.push(post);
    }

    console.log(`[SIS v2 Classifier] 🔍 Sieve: ${results.length} filtered, ${toClassify.length} -> AI Brain`);

    // Layer 2: AI Classification (Batch of 10)
    const BATCH_SIZE = 10;
    for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
        const batch = toClassify.slice(i, i + BATCH_SIZE);
        const sysPrompt = buildSystemPrompt(batch.map(b => b.content).join(' '));
        const usrPrompt = buildBatchPrompt(batch);

        try {
            const response = await aiProvider.generateText(sysPrompt, usrPrompt, {
                model: 'gpt-4o-mini',
                maxTokens: 2500,
                jsonMode: true
            });

            console.log(`[SIS v2 Classifier] 🤖 Raw AI Response: ${response.substring(0, 500)}`);

            let cleanJSON = response;
            if (response.includes('```json')) {
                cleanJSON = response.split('```json')[1].split('```')[0].trim();
            } else if (response.includes('```')) {
                cleanJSON = response.split('```')[1].split('```')[0].trim();
            }

            const outer = JSON.parse(cleanJSON);
            const aiResults = outer.results || outer.items || (Array.isArray(outer) ? outer : []);

            if (aiResults.length === 0 && !Array.isArray(outer)) {
                console.warn('[SIS v2 Classifier] ⚠️ AI response missing results array. Outer keys:', Object.keys(outer));
            }

            for (let j = 0; j < batch.length; j++) {
                const aiResult = aiResults[j] || { recommended_lane: 'discard', is_relevant: false };
                const merged = { ...batch[j], ...aiResult };

                // SAVE TO SIS v2 DB
                await saveToSIS(merged);

                results.push(merged);
            }
        } catch (err) {
            console.error(`[SIS v2 Classifier] ❌ Batch failed:`, err.message);
            for (const b of batch) results.push({ ...b, recommended_lane: 'discard', is_relevant: false, reason_summary: 'AI Analysis Error' });
        }
    }

    const qualified = results.filter(r => r.recommended_lane !== 'discard').length;
    console.log(`[SIS v2 Classifier] ✅ Done. Captured ${qualified} commercial signals.`);
    return results;
}

/**
 * Handle individual post classification (legacy compat)
 */
async function classifyPost(post) {
    const results = await classifyPosts([post]);
    return results[0];
}

/**
 * Internal: Save signal to SIS v2 tables
 */
async function saveToSIS(data) {
    try {
        // 1. Insert Raw Post (v2 structure)
        const rawPostId = database.insertRawPost({
            source_platform: data.platform || 'facebook',
            source_type: data.source_type || 'post',
            external_post_id: data.post_url || data.id,
            author_name: data.author_name || 'Unknown',
            author_profile_url: data.author_url || data.author_profile_url || '',
            post_url: data.post_url || '',
            post_text: data.content || '',
            post_language: data.language || 'vi',
            group_name: data.group_name || ''
        });

        // 2. Insert Classification (6-score SIS v2)
        database.insertClassification({
            raw_post_id: rawPostId,
            model_name: 'gpt-4o-mini',
            is_relevant: data.is_relevant ? 1 : 0,
            entity_type: data.entity_type || 'unknown',
            seller_likelihood: data.seller_likelihood || 0,
            pain_score: data.pain_score || 0,
            intent_score: data.intent_score || 0,
            resolution_confidence: data.resolution_confidence || 0,
            contactability_score: data.contactability_score || 0,
            competitor_probability: data.competitor_probability || 0,
            pain_tags: data.pain_tags || [],
            market_tags: data.market_tags || [],
            seller_stage_estimate: data.seller_stage_estimate || 'unknown',
            recommended_lane: data.recommended_lane || 'discard',
            reason_summary: (data.reason_summary || '').substring(0, 1000),
            confidence: data.confidence || 'low',
            raw_response: data
        });

        // 3. Update Memory Store for few-shot learning
        saveToMemory(data, {
            score: data.intent_score || 0,
            role: data.entity_type || 'unknown',
            service_match: data.recommended_lane || 'None',
            reasoning: data.reason_summary || ''
        });

    } catch (err) {
        console.error(`[SIS v2 saveToSIS] ❌ Failed:`, err.message);
    }
}

module.exports = { classifyPost, classifyPosts };
