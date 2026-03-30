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

// ─── SELLER INTENT OVERRIDE ───────────────────────────────────────────────────
// Nếu bài viết match regex này → đây là SELLER đang TÌM KIẾM dịch vụ.
// Override PROVIDER_REGEX: bỏ qua provider check, đẩy thẳng lên AI.
const SELLER_SEEKING_REGEX = /(đang tìm.{0,40}(?:đơn vị|kho|dịch vụ|fulfillment|warehouse|supplier|forwarder|3pl|partner)|cần tìm.{0,40}(?:đơn vị|kho|dịch vụ|fulfillment|warehouse|supplier)|ai đang dùng.{0,30}(?:kho|dịch vụ|fulfillment|warehouse|3pl)|ai.{0,10}(?:recommend|giới thiệu|biết).{0,30}(?:kho|fulfillment|warehouse|3pl|đơn vị|supplier)|nhờ mọi người.{0,20}(?:recommend|tư vấn|giới thiệu)|tìm đơn vị.{0,30}(?:ship|fulfillment|warehouse|giao hàng|tốt|uy tín)|vendor.{0,30}(?:chậm quá|tệ quá|không ổn|fail|hay lỗi|kém|disappointing|unreliable)|switching.{0,30}(?:fulfillment|warehouse|3pl|vendor|supplier)|looking for.{0,40}(?:fulfillment|warehouse|3pl|supplier|partner|agent)|need.{0,30}(?:fulfillment center|warehouse|3pl partner|new supplier|new fulfillment)|anyone.{0,30}(?:recommend|use|using|know).{0,30}(?:fulfillment|warehouse|3pl|forwarder)|muốn đổi.{0,30}(?:kho|đơn vị|fulfillment|vendor|supplier)|thay đổi vendor|chán vendor|vendor fail|tìm nhà cung cấp mới|tìm supplier mới|cần đổi.{0,20}(?:kho|đơn vị|fulfillment)|đang cần.{0,20}(?:kho us|warehouse us|fulfillment us|3pl us)|ship từ vn.{0,30}(?:tìm|cần|ai)|gửi hàng từ vn.{0,30}(?:tìm|cần|ai)|cần.{0,10}kho.{0,10}(?:mỹ|us|tốt|uy tín|giá tốt))/i;

const PROVIDER_REGEX = /(chúng tôi nhận gửi|quy trình gửi hàng|lợi ích khi gửi hàng với chúng tôi|nhận gửi hàng đi|chuyên tuyến việt|cước phí cạnh tranh|cam kết giao tận tay|we offer fulfillment|shipping services from us|dịch vụ vận chuyển uy tín|không phát sinh chi phí|bao thuế bao luật|nhận pick up|đóng gói miễn phí|hút chân không|dạ em nhận|em chuyên nhận|em chuyên vận chuyển|em chuyên gửi|em nhận ship|em nhận gửi|nhận vận chuyển|tham khảo ngay|viettel post|epacket|saigonbay|nhận ship hàng|dịch vụ ship|đặt ship ngay|chuyên gửi|nhận gửi|dịch vụ gửi|giao hàng nhanh|ship cod|bên em chuyên|bên em nhận.{0,25}(?:ship|giao|vận chuyển|order|đơn|hàng ngay)|bên mình chuyên|bên mình nhận.{0,25}(?:ship|giao|vận chuyển|order|đơn|hàng ngay)|giải pháp gửi hàng|ready to scale|from warehousing|we ship|we offer|just launched.*(fulfillment|warehouse)|moving into our new|ecoli express|free quote|get started today|our warehouse|customs clearance|mở rộng sản xuất|sẵn sàng cùng seller|xưởng.*sản xuất|fulfill trực tiếp|giá xưởng|giá gốc|cần thêm thông tin.*nhắn|siêu lợi nhuận|ưu đãi.*seller|chương trình.*ưu đãi|sẵn sàng phục vụ|phục vụ.*seller|cung cấp dịch vụ|chúng tôi cung cấp|we\s+provide|we\s+specialize|our\s+service|đường sea chỉ từ|đường bay chỉ từ|bay cargo|cước.{0,10}\d+[eđdk]\/kg|hỗ trợ đóng gói|hỗ trợ lưu kho|pick.?up tận nơi|pick.?up tận nhà|free nhận đồ|free nhận hàng|nhận đồ tại nhà|xử lý trọn gói|đừng bỏ lỡ|mở ưu đãi|cước.*chỉ\s*(?:tử\s*)?\d|bay thẳng.*\d+[eđdk]|chuyên tuyến Mỹ|chuyên tuyến Úc|chuyên tuyến EU|ship mỹ giá|ship úc giá|ship hàng giá rẻ|vận chuyển giá rẻ|logistics giá rẻ|giá cước siêu|lh zalo|gửi hàng giá rẻ|quốc tế giá rẻ|vận tải quốc tế|chào các seller|chào các shop|em có line|mình có line|line bao thuế|đi bay 3-5 ngày|đi sea 15-20 ngày|đi bay bao|đi sea bao|giá bao thuế|sẵn kho hỗ trợ|em có kho hỗ trợ|mình có kho hỗ trợ|support seller|basecost|base cost|moq tối thiểu|không yêu cầu moq|nhận gia công|bỏ sỉ|nguồn sỉ|nhà máy sản xuất|cảnh báo có items|tư vấn tạo acc|bán tài khoản|mở khóa tài khoản|cung cấp vps|thuê vps|nhận fulfillment|bảng giá|inbox nhận giá|nhận đào tạo|chuyên cung cấp|chiết khấu|giảm cước|dm (for|us) (rates|pricing|quote|info)|contact us for (rates|pricing|a quote|more info)|inbox (us|me) for (rates|pricing|details)|we (handle|fulfill|pack|store) (your |all )?(orders|shipments|inventory)|let us handle your|we take care of (your )?(shipping|fulfillment|orders)|from our (us |vietnam )?(warehouse|facility)|our (fulfillment|shipping|logistics) (service|solution|team|rates)|message us (for|to get)|reach out (for|to get) (a quote|rates|pricing)|starting at \$\d|rates starting|per (lb|kg|unit|order) shipped|competitive (rates|pricing) for sellers|serving (amazon|etsy|shopify|tiktok) sellers|we support (pod|dropship|fba)|our pod service|our dropship service|fulfillment partner for)/i;

// Lọc bài viết liên quan vấn đề tài khoản platform (không liên quan đến nhu cầu fulfillment/shipping)
const ACCOUNT_PLATFORM_ISSUES_REGEX = /(account.{0,20}(suspend|ban|deactivat|terminat|disabl|restrict|block|flag|review|appeal|reinstat)|suspend.{0,20}account|(bị|bị bị).{0,15}(ban|suspend|khóa|tắt|die|chết).{0,15}(acc|account|shop|store|listing)|acc.{0,15}(bị|die|chết|tắt|khóa|suspend|ban)|tài khoản.{0,20}(bị khóa|bị tắt|bị ban|bị suspend|bị die)|khóa.{0,15}(acc|account|shop)|die.{0,10}acc|chết.{0,10}acc|appeal.{0,20}(amazon|etsy|ebay|tiktok|shopify)|plan of action|root cause analysis|reinstate.{0,20}(account|listing|store)|policy violation|account health|seller.{0,20}(suspended|deactivated|terminated)|listing.{0,20}(removed|taken down|suspended)|bị report.{0,20}(acc|account|listing)|ip.{0,15}(ban|block).{0,10}(amazon|etsy|shopify)|payment.{0,20}hold|disbursement.{0,20}hold|payout.{0,20}hold|fund.{0,20}hold|tiền bị giữ lại|kháng cáo.{0,20}(amazon|etsy|tiktok|shopify)|xử lý.{0,15}(acc|account|shop).{0,15}(bị|die|tắt|khóa)|mất.{0,15}(acc|account|shop|store)|khôi phục.{0,20}(acc|account|shop|store)|lấy lại.{0,20}(acc|account|shop|store)|cần.{0,15}(lawyer|luật sư).{0,20}amazon|amazon.{0,20}(takedown|copyright|trademark|counterfeit|inauthentic)|verify.{0,20}(account|identity|bank|card).{0,20}(amazon|etsy|payoneer|stripe|paypal)|ungating.{0,20}amazon|gated.{0,20}categor|2fa.{0,15}(lost|mất|reset)|backup code.{0,15}(lost|mất))/i;

const IRRELEVANT_REGEX = /(hướng dẫn.*(pod|dropship|cách làm|chạy ads|bán hàng)|cách (làm|tạo|bắt đầu).*(pod|dropship|tiktok shop|etsy)|chia sẻ kinh nghiệm.*(pod|dropship)|recipe|cooking|football|soccer|gaming|movie|trailer|music video|crypto airdrop|token launch|weight loss|diet pill|korean bbq|beef|chicken|salad|mushroom|makeup|skincare|nail art|hair style|workout|gym|fitness|bible verse|prayer|astrology|horoscope|ritual|spell|food stamp|military|warzone|nuclear|missile|burmese|myanmar|capcut pioneer|kpop|anime|concert|healing|meditation|tạo acc etsy|thuê cổng thanh toán)/i;
const DOMESTIC_VN_REGEX = /(giao hàng nhanh nội|ship cod toàn quốc|chuyển phát nội tỉnh|vận chuyển nội địa|giao tận nơi trong nước|ship nội thành|giao hàng toàn quốc|giao hàng tiết kiệm|giao hàng nhanh j&t|viettel post nội địa|nhất tín logistics|ghn nội địa)/i;
const IMPORT_VN_REGEX = /(nhập khẩu từ|nhập.*từ.*về|về việt nam|về vn|từ mỹ về|từ us về|từ nhật về|từ hàn về|từ úc về|từ uk về|từ châu âu về|order taobao|nhập hàng trung|nhập hàng mỹ|mua hộ hàng)/i;
const RECRUITMENT_REGEX = /(tuyển dụng|cần tuyển|tìm việc|ứng tuyển|gửi cv|lương cứng|thu nhập hấp dẫn|tuyển dropship|tuyển seller|tuyển ctv|cộng tác viên|tuyển nhân viên|looking for va|virtual assistant|hiring|cần tìm việc|ai có việc|tuyển affiliate|phỏng vấn|tuyển gấp)/i;
const MUST_HAVE_KEYWORDS = /(ship|vận chuyển|fulfillment|fulfill|pod|dropship|gửi hàng|tuyến|kho|warehouse|giá|báo giá|tìm đơn vị|logistics|3pl|fba|ecommerce|e-commerce|seller|bán hàng|order|đơn hàng|tracking|inventory|supplier|basecost|print on demand|freight|cargo|express|đóng gói|cần tìm|xưởng|prep|xin|nhờ|hỏi|tìm|cần|review|recommend|line us|ddp|forwarder|thông quan|customs|lcl|fcl|cbm|pallet|container|amazon|tiktok shop|etsy|shopify|mua hàng|hàng từ|gửi về|ship về|nhờ ai|ai biết|chỗ nào|ở đâu|mua ở|đặt hàng|order hàng|mua sỉ|nhập hàng|nguồn hàng|đồ từ|hàng việt|hàng trung|gom hàng|in áo|mẫu in)/i;

// ─── THG Service → Staff Auto-Assignment Map ─────────────────────────────────
// Route lead theo DỊCH VỤ THG mà khách đang cần (không phải loại seller).
// Key = thg_service_needed từ AI output. Value = tên staff phụ trách dịch vụ đó.
//
// Phân công (Phase Mới):
//   warehouse     → Hạnh      (Warehouse CS: kho US, lưu kho, FBA prep, 3PL)
//   express       → Lê Huyền  (Express CS: ship nhanh US, express line)
//   pod           → Moon       (POD CS: in áo, mug, dropship fulfillment)
//   quote_needed  → Thư        (Vận hành & Báo giá: tư vấn, compare giá, onboard)
//   unknown       → null       (không auto-assign, để ops triage thủ công)
//
// Admin override: Settings → system_settings key 'SERVICE_STAFF_MAP' (JSON string)
const DEFAULT_SERVICE_STAFF_MAP = {
    warehouse:      'Hạnh',
    express:        'Lê Huyền',
    pod:            'Moon',
    quote_needed:   'Thư',
    unknown:        null
};

function getServiceStaffMap() {
    try {
        const override = database.getSetting('SERVICE_STAFF_MAP', null);
        if (override) return { ...DEFAULT_SERVICE_STAFF_MAP, ...JSON.parse(override) };
    } catch (e) { /* use default */ }
    return DEFAULT_SERVICE_STAFF_MAP;
}

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

        // [SIS v2.6] Seller-Seeking Override — detect BEFORE provider check.
        // A seller saying "đang tìm kho US, ai recommend?" must NOT be caught by PROVIDER_REGEX.
        const isSellerSeeking = SELLER_SEEKING_REGEX.test(content);

        // [SIS v2.5] Aggressive Competitor Block (Zero-Cost Sieve) — SKIP if seller is seeking
        if (!isSellerSeeking && PROVIDER_REGEX.test(content)) {
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

        if (ACCOUNT_PLATFORM_ISSUES_REGEX.test(content)) {
            console.log(`[Sieve] 🚫 Discarded (Platform Account Issue): ${content.substring(0, 50)}`);
            results.push({ ...post, recommended_lane: 'discard', is_relevant: false, reason_summary: 'Platform account issue (suspend/ban/appeal) - not a fulfillment need' });
            continue;
        }

        if (DOMESTIC_VN_REGEX.test(content) || IRRELEVANT_REGEX.test(content) || IMPORT_VN_REGEX.test(content) || RECRUITMENT_REGEX.test(content)) {
            console.log(`[Sieve] 🚫 Discarded (Domestic/Irrelevant/Import/Recruit): ${content.substring(0, 50)}`);
            results.push({ ...post, recommended_lane: 'discard', is_relevant: false, reason_summary: 'Domestic, Irrelevant, Import, or Recruitment' });
            continue;
        }

        if (!MUST_HAVE_KEYWORDS.test(content)) {
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
                const validated = validateLane({ ...batch[j], ...aiResult });

                // SAVE TO SIS v2 DB
                await saveToSIS(validated);
                const merged = validated;

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
 * Post-AI hard validation — correct obvious AI mistakes
 *
 * Rule A: competitor_probability > 85 + seller_likelihood < 25 → force competitor_intel
 * Rule B: AI discards but seller_likelihood >= 65 + pain_score >= 55 → rescue to partial_lead
 * Rule C: resolved_lead with resolution_confidence < 30 → downgrade to partial_lead
 */
function validateLane(aiResult) {
    const cp = aiResult.competitor_probability || 0;
    const sl = aiResult.seller_likelihood || 0;
    const ps = aiResult.pain_score || 0;
    const rc = aiResult.resolution_confidence || 0;
    const lane = aiResult.recommended_lane;

    if (cp > 85 && sl < 25 && lane !== 'competitor_intel' && lane !== 'discard') {
        console.log(`[Validate] ⚠️  Rule A: competitor override (cp=${cp}, sl=${sl}) → competitor_intel`);
        return { ...aiResult, recommended_lane: 'competitor_intel', is_relevant: true,
            reason_summary: `[ValidateA] cp=${cp} sl=${sl} - ${aiResult.reason_summary}` };
    }

    if (lane === 'discard' && sl >= 65 && ps >= 55) {
        console.log(`[Validate] ♻️  Rule B: rescue from discard (sl=${sl}, ps=${ps}) → partial_lead`);
        return { ...aiResult, recommended_lane: 'partial_lead', is_relevant: true,
            reason_summary: `[ValidateB] Rescued: sl=${sl} ps=${ps} - ${aiResult.reason_summary}` };
    }

    if (lane === 'resolved_lead' && rc < 30) {
        console.log(`[Validate] ⬇️  Rule C: downgrade resolved_lead (rc=${rc}) → partial_lead`);
        return { ...aiResult, recommended_lane: 'partial_lead',
            reason_summary: `[ValidateC] Low rc=${rc}, downgraded from resolved - ${aiResult.reason_summary}` };
    }

    return aiResult;
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

        // 2. Insert Classification (Only for high-value leads to save DB storage)
        const validLanes = ['resolved_lead', 'partial_lead', 'anonymous_signal'];
        if (validLanes.includes(data.recommended_lane)) {
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

            // 4. Auto-assign to staff based on thg_service_needed
            const serviceNeeded = data.thg_service_needed || 'unknown';
            const serviceMap = getServiceStaffMap();
            const assignTo = serviceMap[serviceNeeded] || serviceMap['unknown'];
            if (assignTo) {
                database.updateAssignedTo(rawPostId, assignTo);
                console.log(`[SIS v2 saveToSIS] 👤 Auto-assigned Post #${rawPostId} (${serviceNeeded}) → ${assignTo}`);
            }
        } else {
            console.log(`[SIS v2 saveToSIS] 🗑️ Skipped DB Storage for Junk/Competitor lane: ${data.recommended_lane}`);
        }

    } catch (err) {
        console.error(`[SIS v2 saveToSIS] ❌ Failed:`, err.message);
    }
}

module.exports = { classifyPost, classifyPosts };
