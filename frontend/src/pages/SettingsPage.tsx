import { useState, useEffect } from 'react'
import { apiGet, apiPost } from '../api/client'

const STAFF_OPTIONS = ['Hạnh', 'Lê Huyền', 'Moon', 'Thư', 'Trang', 'Ngọc Huyền', 'Min', "Đức Anh's Agent", '']

export default function SettingsPage() {
    const [nightShift, setNightShift] = useState(false)
    const [aiKb, setAiKb] = useState('')
    const [loading, setLoading] = useState(true)
    const [serviceMap, setServiceMap] = useState({
        warehouse: 'Hạnh',
        express: 'Lê Huyền',
        pod: 'Moon',
        quote_needed: 'Thư'
    })

    useEffect(() => {
        apiGet<{ success: boolean; settings: { NIGHT_SHIFT_MODE: boolean, AI_KNOWLEDGE_BASE: string, SERVICE_STAFF_MAP: string } }>('/api/sis/settings')
            .then(res => {
                if (res?.settings) {
                    setNightShift(res.settings.NIGHT_SHIFT_MODE);
                    setAiKb(res.settings.AI_KNOWLEDGE_BASE || '');
                    if (res.settings.SERVICE_STAFF_MAP) {
                        try { setServiceMap(JSON.parse(res.settings.SERVICE_STAFF_MAP)); } catch(e) {}
                    }
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const saveServiceMap = async () => {
        await apiPost('/api/sis/settings', { SERVICE_STAFF_MAP: JSON.stringify(serviceMap) });
        alert('Đã lưu phân công dịch vụ!');
    }

    const toggleNightShift = async () => {
        const newVal = !nightShift;
        setNightShift(newVal);
        await apiPost('/api/sis/settings', { NIGHT_SHIFT_MODE: newVal });
    }

    const saveKb = async () => {
        await apiPost('/api/sis/settings', { AI_KNOWLEDGE_BASE: aiKb });
        alert('Đã lưu dữ liệu Knowledge Base thành công!');
    }

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>

    return (
        <div style={{ padding: '0 1rem', maxWidth: 800 }}>
            <div className="page-header" style={{ marginBottom: '2rem' }}>
                <h2 className="page-title">⚙️ System Settings</h2>
            </div>

            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', marginBottom: '1.5rem' }}>
                <div style={{ paddingRight: '2rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        🌙 Night Shift Auto-Reply
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Tự động trả lời tin nhắn Meta Messenger bằng AI Copilot khi ngoài giờ làm việc (00:00 - 09:00 UTC+7). <br />
                        Sales không cần duyệt tin trước khi gửi.
                    </p>
                </div>

                <label style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: 50,
                    height: 28,
                    flexShrink: 0,
                    cursor: 'pointer'
                }}>
                    <input
                        type="checkbox"
                        checked={nightShift}
                        onChange={toggleNightShift}
                        style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                        position: 'absolute',
                        cursor: 'pointer',
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: nightShift ? 'var(--primary-color)' : 'var(--border)',
                        transition: '.4s',
                        borderRadius: 34
                    }}>
                        <span style={{
                            position: 'absolute',
                            content: '""',
                            height: 20,
                            width: 20,
                            left: nightShift ? 26 : 4,
                            bottom: 4,
                            backgroundColor: 'white',
                            transition: '.4s',
                            borderRadius: '50%'
                        }} />
                    </span>
                </label>
            </div>

            <div className="card" style={{ padding: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    📚 AI Knowledge Base (Dữ liệu nền cho AI)
                </h3>
                <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Nhập các quy định, bảng giá, FAQ, hoặc các câu văn mẫu vào đây. AI Copilot sẽ tự động đọc và tham khảo tài liệu này mỗi khi nó phải tự thiết kế một bản nháp cho khách (đặc biệt là auto-reply ban đêm).
                </p>
                <textarea
                    value={aiKb}
                    onChange={(e) => setAiKb(e.target.value)}
                    style={{
                        width: '100%',
                        height: '220px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        padding: '1rem',
                        borderRadius: '8px',
                        marginBottom: '1rem',
                        fontSize: '0.9rem',
                        lineHeight: 1.6
                    }}
                    placeholder="- Bảng giá ship đi US: $6.2/kg...&#10;- Lệnh cấm: Không nhận hàng fake...&#10;- Xưng hô: Dạ em thưa anh chị..."
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="btn btn-primary" onClick={saveKb}>💾 Ghi nhớ vào hệ thống AI</button>
                </div>
            </div>

            <div className="card" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0' }}>👥 Phân công Dịch vụ → Nhân viên</h3>
                <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Leads sẽ tự động được phân công cho nhân viên phụ trách khi AI xác định được dịch vụ khách hàng cần.
                </p>
                {[
                    { key: 'warehouse', label: '🏭 Warehouse', desc: 'Kho US, lưu kho, FBA prep, 3PL' },
                    { key: 'express', label: '⚡ Express', desc: 'Ship nhanh US, đường bay express' },
                    { key: 'pod', label: '🖨️ POD', desc: 'Print-on-Demand, in áo/mug, dropship' },
                    { key: 'quote_needed', label: '💰 Báo giá', desc: 'Hỏi giá chung, tư vấn dịch vụ' },
                ].map(({ key, label, desc }) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                        <div style={{ minWidth: 160 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{label}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{desc}</div>
                        </div>
                        <span style={{ color: 'var(--text-muted)' }}>→</span>
                        <select
                            value={(serviceMap as any)[key] || ''}
                            onChange={e => setServiceMap(prev => ({ ...prev, [key]: e.target.value }))}
                            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px', padding: '6px 10px', fontSize: '0.875rem' }}
                        >
                            {STAFF_OPTIONS.map(s => <option key={s} value={s}>{s || '-- Không assign --'}</option>)}
                        </select>
                    </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button className="btn btn-primary" onClick={saveServiceMap}>💾 Lưu phân công</button>
                </div>
            </div>

        </div>
    )
}
