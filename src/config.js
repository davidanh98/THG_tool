require('dotenv').config();

module.exports = {
  // --- SociaVault ---
  SOCIAVAULT_API_KEY: process.env.SOCIAVAULT_API_KEY,

  // --- AI ---
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  AI_MODEL: 'llama-3.3-70b-versatile',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: 'gemini-2.0-flash',

  // --- Telegram ---
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,

  // --- Lead scoring ---
  LEAD_SCORE_THRESHOLD: 60,

  // --- Cron ---
  CRON_KEYWORD_SCAN: '*/30 * * * *',
  CRON_GROUP_SCAN: '0 8,20 * * *',

  // --- Server ---
  PORT: process.env.PORT || 3000,

  // --- Platforms ---
  ENABLED_PLATFORMS: ['facebook', 'tiktok', 'instagram'],

  // ================================================================
  // FACEBOOK GROUPS — Nơi BUYER thật sự đang hỏi
  // ================================================================
  // Logic: Scrape post trong group → classifier lọc buyer
  // KHÔNG scrape page của provider/đối thủ
  FB_TARGET_GROUPS: [
    // ✅ Đang có data — giữ lại
    { name: 'Cộng đồng Etsy VN', url: 'https://www.facebook.com/groups/congdongetsyvietnam' },
    { name: 'TikTok Shop US Underground', url: 'https://www.facebook.com/groups/tiktokshopusunderground' },
    { name: 'Tìm Supplier Fulfill POD/Drop VN-US-UK', url: 'https://www.facebook.com/groups/timsupplierfulfillpoddropvnusuk' },

    // ✅ Thêm mới — cộng đồng seller chất lượng cao
    { name: 'Dropship & Fulfill VN', url: 'https://www.facebook.com/groups/646444174604027' },
    { name: 'Seller E-commerce VN', url: 'https://www.facebook.com/groups/494286704652111' },
    { name: 'E-commerce Sellers VN', url: 'https://www.facebook.com/groups/437505323460908' },
    { name: 'Cộng đồng Amazon VN', url: 'https://www.facebook.com/groups/congdongamazonvn' },
    { name: 'Vận chuyển Quốc tế', url: 'https://www.facebook.com/groups/914341367037223' },
    { name: 'Shipping & Logistics VN', url: 'https://www.facebook.com/groups/229053812104553' },

    // ❌ Đã bỏ: THG Fulfill US (400 error), MMO Darkness (0 posts)
  ],

  // ================================================================
  // FB COMPETITOR PAGES — Scrape COMMENTS (buyer hỏi dưới post)
  // ================================================================
  // Logic: Dưới post của đối thủ, buyer hay comment hỏi giá/dịch vụ
  // → Đó là lead tiềm năng cho THG
  FB_COMPETITOR_PAGES: [
    { name: 'Boxme Global', url: 'https://www.facebook.com/boxme.asia' },
    { name: 'SuperShip', url: 'https://www.facebook.com/supership.vn' },
    { name: 'Weshop VN', url: 'https://www.facebook.com/weshopvn' },
    // Thêm: đối thủ POD trực tiếp
    { name: 'Fulfillment Việt Nam', url: 'https://www.facebook.com/fulfillmentvietnam' },
  ],

  // ================================================================
  // TIKTOK — Dùng KEYWORD SEARCH, không scrape account provider
  // ================================================================
  //
  // SAI (cũ): Scrape @merchize → toàn post quảng cáo của đối thủ
  // ĐÚNG (mới): Search keyword → tìm video của seller đang hỏi/chia sẻ
  //
  // Cách hoạt động: SociaVault search keyword trên TikTok
  // → Tìm video có caption/hashtag chứa keyword
  // → Caption của seller = content để classify
  //
  TT_SEARCH_KEYWORDS: [
    // Seller đang hỏi/tìm dịch vụ
    'tìm xưởng POD Việt Nam',
    'tìm fulfill TikTok US',
    'cần kho Mỹ fulfill',
    'ship hàng Mỹ review',
    'dropship Taobao sang Mỹ',
    'bán hàng TikTok US từ Việt Nam',
    'kho US giá rẻ',
    'tìm 3PL Mỹ',
    // English buyer intent
    'looking for POD supplier Vietnam',
    'need fulfillment center US',
    'dropship from Vietnam to US',
  ],

  // Fallback: nếu SociaVault chỉ hỗ trợ scrape account
  TT_TARGET_ACCOUNTS: [
    // ❌ ĐÃ XÓA: @bestexpressvn, @boxmeglobal, @merchize → đối thủ
    // ❌ ĐÃ XÓA: @tartecosmetics, @halara_us, @microingredients → brand Mỹ
    // ❌ ĐÃ XÓA: @findniche → tool, không phải buyer
  ],

  // ================================================================
  // INSTAGRAM — Dùng HASHTAG, không scrape account provider
  // ================================================================
  //
  // SAI (cũ): Scrape @printify, @shopify, @amzprep → toàn provider
  // ĐÚNG (mới): Search hashtag → tìm post của seller đang chia sẻ
  //
  IG_SEARCH_HASHTAGS: [
    // Hashtag của seller VN bán quốc tế
    'podvietnam',
    'dropshipvietnam',
    'sellervietnam',
    'fulfillvietnam',
    'shiphangmy',
    // Hashtag tiếng Anh có buyer VN
    'vietnamseller',
    'vietnamdropship',
    'podvietnamese',
    'tiktokshopvietnam',
    // Hashtag buyer tìm dịch vụ
    'fulfillmentpartner',
    'dropshipsupplier',
    'podpartner',
  ],

  // Fallback: nếu SociaVault chỉ hỗ trợ scrape account
  IG_TARGET_ACCOUNTS: [
    // ❌ ĐÃ XÓA: tất cả provider accounts
  ],

  // ================================================================
  // SEARCH KEYWORDS — Dùng cho keyword search (nếu SV hỗ trợ)
  // ================================================================
  SEARCH_KEYWORDS: {
    facebook: [
      'ship hàng Mỹ bị delay',
      'ai dùng fulfill nào ổn không',
      'kho Mỹ giá bao nhiêu',
      'TikTok shop US tracking không active',
      'POD basecost rẻ',
      'recommend đơn vị ship',
      'cần tìm 3PL',
      'tìm xưởng POD',
    ],
    instagram: [
      'podvietnam',
      'dropshipvietnam',
      'sellervietnam',
      'fulfillvietnam',
      'shiphangmy',
    ],
    tiktok: [
      'tìm xưởng POD Việt Nam',
      'ship hàng Mỹ review',
      'fulfill TikTok US',
    ],
  },

  // ================================================================
  // THG CONTEXT cho AI Classifier
  // ================================================================
  THG_CONTEXT: `
THG là công ty logistics, express, fulfillment và warehouse phục vụ seller e-commerce VẬN CHUYỂN TOÀN CẦU (không chỉ Mỹ).

Dịch vụ THG cung cấp:
1. THG Express: Vận chuyển hàng từ VN/CN đi TOÀN THẾ GIỚI (Mỹ, Úc, UK, UAE, Đài Loan, Saudi, Chile, Colombia, Mexico…) — tuyến bay riêng, giá rẻ, tracking real-time
2. THG Fulfill (POD): Seller gửi file thiết kế → THG in ấn tại xưởng VN/CN/US → đóng gói → ship tới khách hàng
3. THG Fulfill (Dropship): Seller gửi link sản phẩm → THG mua hộ → ship quốc tế
4. THG Warehouse/3PL: Kho kép tại Mỹ (Pennsylvania + Texas) — fulfill nội địa từ $1.2/đơn, giao 2-5 ngày toàn US, miễn phí lưu kho 90 ngày
5. E-packet lines: Chile, Colombia, Mexico, Saudi, UAE, Úc, Đài Loan...

MẪU BÀI VIẾT CỦA KHÁCH HÀNG TIỀM NĂNG (BUYER INTENT):
- "tìm đối tác POD/dropship giá tốt hơn Ali, có kho US càng tốt"
- "cần tìm đơn vị vận chuyển Trung Quốc - Saudi"
- "Tìm DVVC EPK VN-Đài Loan"
- "em tha thiết tìm bên dịch vụ 3PL"
- "tìm đơn vị vận chuyển sang UAE và Ai Cập"
- "cần tìm dịch vụ kho bên US"
- "cần Sup ff sản phẩm Car Air Freshener, ship đi US/UK"
- "Cần line E-packet: Chile, Colombia, Mexico"
- "khách hủy đơn vì giao lâu quá, cần kho US"
- "phí fulfill đắt, tìm alternative rẻ hơn"

Khi gặp bài viết tương tự → BUYER (score cao). Nếu là bài quảng cáo dịch vụ → PROVIDER (bỏ qua).
  `.trim(),
};
