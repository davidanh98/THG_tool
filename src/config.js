require('dotenv').config();

module.exports = {
  // --- Apify (fallback only) ---
  APIFY_TOKEN: process.env.APIFY_TOKEN,

  // --- RapidAPI (primary scraping) ---
  RAPIDAPI_KEY: process.env.RAPIDAPI_KEY,

  // --- AI (Groq — scan & classify) ---
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  AI_MODEL: 'llama-3.3-70b-versatile',

  // --- AI (Gemini — auto-sale responses) ---
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: 'gemini-2.0-flash',

  // --- Telegram ---
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,

  // --- Lead scoring ---
  LEAD_SCORE_THRESHOLD: 60,

  // --- Cron schedule (every 30 minutes) ---
  CRON_SCHEDULE: '*/30 * * * *',

  // --- Server ---
  PORT: process.env.PORT || 3000,

  // --- Apify Actor IDs ---
  APIFY_ACTORS: {
    FB_SEARCH: 'apify/facebook-search-scraper',
    IG_HASHTAG: 'apify/instagram-hashtag-scraper',
    TIKTOK_SEARCH: 'clockworks/tiktok-scraper',
  },

  // --- Platforms to enable ---
  ENABLED_PLATFORMS: ['facebook', 'tiktok', 'instagram'],

  // --- Search keywords per platform ---
  // QUAN TRỌNG: Keywords phải tập trung vào BUYER INTENT (người ĐANG TÌM dịch vụ)
  // KHÔNG phải keywords của người CUNG CẤP dịch vụ (đối thủ)
  SEARCH_KEYWORDS: {
    facebook: [
      // Vietnamese — tìm DVVC/fulfill/kho TOÀN CẦU (không chỉ Mỹ)
      'cần tìm đơn vị vận chuyển quốc tế',
      'tìm kho fulfillment',
      'cần dịch vụ 3PL',
      'tìm supplier POD dropship',
      'cần vận chuyển từ Việt Nam',
      'tìm đơn vị vận chuyển Trung Quốc',
      // English — global shipping/fulfillment
      'need fulfillment center',
      'looking for 3PL shipping',
    ],
    instagram: [
      'vanchuyenquocte',
      'fulfillment',
      'shippingworldwide',
      'dropshipping',
      'PODfulfillment',
    ],
    tiktok: [
      'tìm đơn vị vận chuyển',
      'fulfillment warehouse',
      'ship hàng quốc tế',
    ],
  },

  // --- THG business context for AI ---
  THG_CONTEXT: `
THG là công ty logistics, express, fulfillment và warehouse phục vụ seller e-commerce VẬN CHUYỂN TOÀN CẦU (không chỉ Mỹ).

Dịch vụ THG cung cấp:
1. THG Express: Vận chuyển hàng từ VN/CN đi TOÀN THẾ GIỚI (Mỹ, Úc, UK, UAE, Đài Loan, Saudi, Chile, Colombia, Mexico…) — tuyến bay riêng, giá rẻ, tracking real-time
2. THG Fulfill (POD): Seller gửi file thiết kế → THG in ấn tại xưởng VN/CN/US → đóng gói → ship tới khách hàng
3. THG Fulfill (Dropship): Seller gửi link sản phẩm → THG mua hộ → ship quốc tế
4. THG Warehouse/3PL: Kho tại Mỹ (Pennsylvania, North Carolina) — nhập hàng trước, ship nội địa 2-5 ngày
5. E-packet lines: Chile, Colombia, Mexico, Saudi, UAE, Úc, Đài Loan...

Lợi thế THG:
- Xưởng in riêng ở VN, CN, Mỹ
- Tuyến bay riêng VN/CN → nhiều nước, giá rẻ hơn DHL/FedEx
- Kho fulfillment tại Mỹ
- Hệ thống OMS/WMS, tracking real-time
- Policy refund/return rõ ràng
- Hỗ trợ 24/7

MẪU BÀI VIẾT CỦA KHÁCH HÀNG TIỀM NĂNG (BUYER INTENT):
- "tìm đối tác POD/dropship giá tốt hơn Ali, có kho US càng tốt"
- "cần tìm đơn vị vận chuyển Trung Quốc - Saudi"
- "Tìm DVVC EPK VN-Đài Loan"
- "em tha thiết tìm bên dịch vụ 3PL"
- "tìm đơn vị vận chuyển sang UAE và Ai Cập"
- "cần tìm dịch vụ kho bên US"
- "cần tìm đơn vị vận chuyển từ VN-Úc"
- "cần Sup ff sản phẩm Car Air Freshener, ship đi US/UK"
- "đang cần tìm cho sp Bracelet"
- "Cần line E-packet: Chile, Colombia, Mexico"
- "Cần tìm kiếm đơn vị hợp tác ffm, vận chuyển"
- "cần vận chuyển hàng từ VN đi thế giới"

Khi gặp bài viết tương tự → BUYER (score cao). Nếu là bài quảng cáo dịch vụ → PROVIDER (bỏ qua).
  `.trim(),
};
