const SPAM_AD_RE = /(bên em|bên mình|inb em|check ib|nhận gửi|nhận vận chuyển|hệ thống tracking|kho us|liên hệ e|zalo:|lh em|inbox ngay|liên hệ ngay|doanh thu|lợi nhuận|roi|tối ưu chi phí|giảm cost|vít ad|scale[^A-Za-z]|max camp|case study|win camp|idea design|chia sẻ tut|hướng dẫn bán|học bán|dạy bán)/i;
const RETAIL_RE = /(gửi 1 cái|gửi 1 đôi|ship 1kg|gửi đồ ăn|gửi mỹ phẩm|mua hộ|order taobao|gom order|nhận order)/i;
const OUT_OF_BOUNDS_WH_RE = /(úc|australia|châu âu|eu|can\b|canada|nhật|japan|hàn|korea|đức|germany|pháp|france|sing|đài loan|taiwan|mexico|chile|colombia|saudi|uae|tây ban nha|nhập hàng về|ship về vn|order về vn)/i;

const POD_CORE_RE = /(pod|print on demand|dropship|fulfillment|fulfill|fulfiller)/i;
const SUPPORT_NEED_RE = /(tìm đơn vị|cần tìm|tìm kho|cần ship|báo giá|shipping|vận chuyển|gửi hàng|áo tee|mug|phone case|ornament|canvas)/i;

function test(text) {
    if (SPAM_AD_RE.test(text)) return 'DROP: AD';
    if (RETAIL_RE.test(text)) return 'DROP: RETAIL';
    if (OUT_OF_BOUNDS_WH_RE.test(text)) return 'DROP: WH';
    if (POD_CORE_RE.test(text) && SUPPORT_NEED_RE.test(text)) return 'ACCEPT';
    return 'DROP: NO_INTENT';
}

console.log('1.', test('Cần tìm xưởng fulfill áo thun gửi đi Mỹ'));
console.log('2.', test('Tuyệt chiêu vít ad max camp doanh thu 100k'));
console.log('3.', test('Bên mình nhận gửi hàng Canada'));
console.log('4.', test('Tìm kho us hỗ trợ dropship'));
