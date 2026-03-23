export default function SystemPage() {
    const TOOLS = [
        {
            icon: '🤖', name: 'CrawBot (Self-Hosted Scraper)', sub: 'Playwright + Chromium Pipeline', color: '#60a5fa', border: 'rgba(59,130,246,0.2)',
            features: ['Quét tự động 50+ group Facebook theo chu kỳ Cron', 'Hoạt động độc lập không tốn Token bên thứ ba', 'Xử lý kháng block tĩnh với đa trình duyệt ảo'],
            note: 'Zero-cost Data Acquisition'
        },
        {
            icon: '🧠', name: 'AI Classifier (SIS v2 Intelligence)', sub: 'Regex Intercepter + OpenAI (GPT-4o)', color: '#a78bfa', border: 'rgba(139,92,246,0.2)',
            features: ['Sàng lọc rác / quảng cáo (0 cost) bằng Multi-Regex', 'GPT-4o đo lường 6 chỉ số: Nhu Cầu, Nỗi Đau, Tỷ Lệ Chốt...', 'Tự điều hướng tín hiệu thành 4 luồng thao tác trên Dashboard'],
            note: 'Độ chuẩn xác nhận diện Intent > 85%'
        },
        {
            icon: '💬', name: 'The Closing Room & Telegram', sub: 'Hub Phản Hồi Tốc Độ Cao', color: '#34d399', border: 'rgba(16,185,129,0.2)',
            features: ['Phễu Lead được bắn về Telegram ngay lập tức (High Intent)', 'AI Copilot phác thảo mẫu tin nhắn tư vấn / offer cá nhân hóa', 'Đo lường KPI của Trang, Min, Moon... theo Conversion Rate'],
            note: 'Lead không bị thất thoát'
        },
    ]

    const PIPELINE = [
        { icon: '🔍', label: 'SĂN LEAD', detail: 'Quét nội bộ', color: '#60a5fa' },
        { icon: '🧹', label: 'BỘ LỌC TỪ KHÓA', detail: 'Chặn QC Sales', color: '#fbbf24' },
        { icon: '🧠', label: 'AI ĐÁNH GIÁ', detail: 'OpenAI GPT-4o', color: '#4ade80' },
        { icon: '🔀', label: 'ĐIỀU HƯỚNG', detail: '4 SIS v2 Lanes', color: '#a78bfa' },
        { icon: '📬', label: 'CHỐT ĐƠN', labelColor: '#f87171', detail: 'The Closing Room', color: '#f87171' },
    ]

    const SECURITY = [
        { icon: '💾', title: 'Lưu cookie, không lưu mật khẩu', desc: 'Sau khi đăng nhập, mật khẩu bị xóa ngay. Hệ thống chỉ giữ session cookie.' },
        { icon: '🔤', title: 'Không đọc nội dung cá nhân', desc: 'Bot chỉ đọc chat giữa bạn và khách hàng. Không đụng tin nhắn bạn bè.' },
        { icon: '🛁', title: 'Không chia sẻ ra ngoài', desc: 'Dữ liệu lưu trên server nội bộ THG, không gửi cho bên thứ ba.' },
        { icon: '🔄', title: 'Thu hồi quyền bất kỳ lúc', desc: 'Yêu cầu Admin xóa session là bot dừng ngay.' },
    ]

    return (
        <div>
            {/* Header */}
            <div className="card" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(59,130,246,0.12), rgba(16,185,129,0.08))', borderColor: 'rgba(139,92,246,0.25)', marginBottom: 'var(--space-xl)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)', marginBottom: 'var(--space-md)' }}>
                    <span style={{ fontSize: '2.5rem' }}>🏗️</span>
                    <div>
                        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, background: 'linear-gradient(135deg,#a78bfa,#60a5fa,#34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                            THG Intelligence System
                        </h2>
                        <p style={{ opacity: 0.75, fontSize: 'var(--text-sm)', marginTop: 4 }}>Tổng quan toàn bộ công cụ AI — tự động hóa từ tìm khách → học văn phong → chốt đơn</p>
                    </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {['🤖 CrawBot — Máy Săn Lead', '🧠 AI Classifier (GPT-4o)', '💬 Sales Copilot Agent', '📊 Multi-Sales Tracker', '🔍 Facebook Scraper'].map(tag => (
                        <span key={tag} style={{ padding: '4px 12px', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 20, fontSize: '0.75rem', color: '#a78bfa' }}>{tag}</span>
                    ))}
                </div>
            </div>

            {/* Tool Cards */}
            <div className="agent-grid" style={{ marginBottom: 'var(--space-xl)' }}>
                {TOOLS.map(t => (
                    <div key={t.name} className="agent-card" style={{ borderColor: t.border }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                            <span style={{ fontSize: '1.5rem' }}>{t.icon}</span>
                            <div>
                                <div style={{ fontWeight: 700, color: t.color }}>{t.name}</div>
                                <div style={{ fontSize: '0.7rem', opacity: 0.55 }}>{t.sub}</div>
                            </div>
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.82rem', lineHeight: 1.9, opacity: 0.85 }}>
                            {t.features.map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                        <div style={{ marginTop: 10, fontSize: '0.75rem', padding: '8px 12px', background: `${t.color}12`, borderRadius: 8 }}>{t.note}</div>
                    </div>
                ))}
            </div>

            {/* Pipeline */}
            <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
                <div className="card-title">📊 Pipeline Tự Động Hoàn Chỉnh</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    {PIPELINE.map((p, i) => (
                        <div key={p.label} style={{ display: 'contents' }}>
                            <div style={{ flex: 1, minWidth: 100, background: `${p.color}14`, border: `1px solid ${p.color}33`, borderRadius: 10, padding: 14, textAlign: 'center' }}>
                                <div style={{ fontSize: '1.3rem' }}>{p.icon}</div>
                                <div style={{ fontWeight: 700, color: p.color, fontSize: '0.8rem', marginTop: 6 }}>{p.label}</div>
                                <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: 4 }}>{p.detail}</div>
                            </div>
                            {i < PIPELINE.length - 1 && <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>→</div>}
                        </div>
                    ))}
                </div>
            </div>

            {/* Security */}
            <div className="card" style={{ borderColor: 'rgba(16,185,129,0.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                    <span style={{ fontSize: '1.5rem' }}>🔒</span>
                    <div>
                        <div style={{ fontWeight: 700, color: '#34d399' }}>Bảo Mật Tài Khoản — Cam Kết Của Hệ Thống</div>
                        <div style={{ fontSize: 'var(--text-xs)', opacity: 0.6 }}>Tài khoản Facebook của bạn được bảo vệ theo tiêu chuẩn doanh nghiệp</div>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    {SECURITY.map(s => (
                        <div key={s.title} style={{ padding: 14, background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 10 }}>
                            <div style={{ fontSize: '1.1rem', marginBottom: 7 }}>{s.icon}</div>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>{s.title}</div>
                            <div style={{ fontSize: '0.78rem', opacity: 0.7, lineHeight: 1.5 }}>{s.desc}</div>
                        </div>
                    ))}
                </div>
                <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {['✓ Không log cá nhân', '✓ Server nội bộ THG', '✓ Xóa session theo yêu cầu', '✓ Mật khẩu không lưu'].map(b => (
                        <span key={b} style={{ padding: '3px 10px', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 20, fontSize: '0.72rem', color: '#34d399' }}>{b}</span>
                    ))}
                </div>
            </div>
        </div>
    )
}
