import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../api/client'

interface MetaConversation {
    id: number;
    external_id: string;
    platform: string;
    status: string;
    last_message_at: string;
    unread_count: number;
    assigned_to: string;
    claimed_at: string | null;
    first_replied_at: string | null;
    claim_abandoned_count: number;
    created_at: string;
    last_message: string;
    sender_name: string;
    sender_pic: string;
}

interface MetaMessage {
    id: number;
    conversation_id: number;
    sender_id: string;
    sender_role: string;
    message_text: string;
    created_at: string;
}

const CLAIM_TIMEOUT_MINUTES = 60;

// Staff color map for badges
const STAFF_COLORS: Record<string, string> = {
    'Hạnh': '#3b82f6',       // blue — Warehouse
    'Lê Huyền': '#f59e0b',   // amber — Express
    'Moon': '#10b981',       // green — POD
    'Thư': '#8b5cf6',        // purple — Báo giá
}

function getClaimMinutesElapsed(claimedAt: string | null): number | null {
    if (!claimedAt) return null;
    return Math.floor((Date.now() - new Date(claimedAt).getTime()) / 60000);
}

function ClaimTimerBadge({ conv, myName }: { conv: MetaConversation; myName: string }) {
    if (!conv.assigned_to || conv.assigned_to !== myName) return null;
    if (conv.first_replied_at) {
        return (
            <span style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 600 }}>
                ✅ Đã tương tác
            </span>
        );
    }
    const elapsed = getClaimMinutesElapsed(conv.claimed_at);
    if (elapsed === null) return null;
    const remaining = CLAIM_TIMEOUT_MINUTES - elapsed;
    const urgent = remaining <= 15;
    return (
        <span style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            color: urgent ? '#ef4444' : '#f59e0b',
            animation: urgent ? 'pulse 1s infinite' : 'none',
        }}>
            ⏱ {remaining > 0 ? `Còn ${remaining}p` : '⚠️ Hết giờ!'}
        </span>
    );
}

export default function InboxPage() {
    const [convos, setConvos] = useState<MetaConversation[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedConv, setSelectedConv] = useState<MetaConversation | null>(null)
    const [messages, setMessages] = useState<MetaMessage[]>([])
    const [replyText, setReplyText] = useState('')
    const [sending, setSending] = useState(false)
    const [staffName, setStaffName] = useState(() => localStorage.getItem('inbox_staff_name') || '')
    const [filterStaff, setFilterStaff] = useState<string>('all')

    // Phase Mới: Warehouse=Hạnh, Express=Lê Huyền, POD=Moon, Báo giá=Thư
    const STAFF_LIST = ['Hạnh', 'Lê Huyền', 'Moon', 'Thư', 'Trang', 'Ngọc Huyền', 'Min', "Đức Anh's Agent"]

    const loadConvos = () => {
        setLoading(true)
        apiGet<MetaConversation[]>(`/api/sis/meta/conversations?limit=100`)
            .then((res) => setConvos(res || []))
            .catch((err) => console.error(err))
            .finally(() => setLoading(false))
    }

    const claimConv = async (convId: number) => {
        if (!staffName) { alert('Vui lòng chọn tên của bạn trước.'); return; }
        try {
            const res = await apiPost<{ ok: boolean; reason?: string }>(`/api/sis/meta/claim/${convId}`, { staff_name: staffName });
            if (!res.ok) { alert(res.reason || 'Không thể nhận'); return; }
            loadConvos();
        } catch(e) { console.error(e); }
    }

    const filteredConvos = filterStaff === 'all'
        ? convos
        : convos.filter(c => c.assigned_to === filterStaff)

    const loadMessages = (id: number) => {
        apiGet<MetaMessage[]>(`/api/sis/meta/conversations/${id}/messages`)
            .then((res) => {
                setMessages(res || []);
                // Find latest AI draft to set as reply text
                const drafts = (res || []).filter(m => m.sender_role === 'ai_draft');
                if (drafts.length > 0) {
                    setReplyText(drafts[drafts.length - 1].message_text);
                } else {
                    setReplyText('');
                }
            })
            .catch((err) => console.error(err));
    }

    useEffect(() => {
        loadConvos();
        const id = setInterval(loadConvos, 30000);
        return () => clearInterval(id);
    }, [])

    useEffect(() => {
        if (selectedConv) {
            loadMessages(selectedConv.id);
        }
    }, [selectedConv])

    const handleSend = async () => {
        if (!selectedConv || !replyText.trim()) return;
        if (!staffName) { alert('Vui lòng chọn tên của bạn trước khi gửi tin.'); return; }
        setSending(true);
        try {
            await apiPost(`/api/sis/meta/send/${selectedConv.external_id}`, {
                messageText: replyText,
                staff_name: staffName
            });
            setReplyText('');
            loadMessages(selectedConv.id);
            loadConvos();
        } catch (e) {
            alert("Failed to send message: " + String(e));
        }
        setSending(false);
    }

    if (loading && convos.length === 0) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>

    return (
        <div style={{ display: 'flex', height: '100%', gap: '1rem' }}>
            {/* LEFT SIDE - LIST */}
            <div style={{ flex: '1', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                <div className="page-header" style={{ marginBottom: 0, paddingRight: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 className="page-title">💬 Meta Inbox <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', fontWeight: 400 }}>({filteredConvos.length})</span></h2>
                    <select
                        value={staffName}
                        onChange={(e) => { setStaffName(e.target.value); localStorage.setItem('inbox_staff_name', e.target.value); }}
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: staffName ? (STAFF_COLORS[staffName] || 'var(--text)') : 'var(--text-muted)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.8rem', fontWeight: 600 }}
                    >
                        <option value="">— Bạn là ai? —</option>
                        {STAFF_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>

                {/* Filter by assigned staff */}
                <div style={{ display: 'flex', gap: '0.5rem', paddingRight: '1rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    {['all', 'Hạnh', 'Lê Huyền', 'Moon', 'Thư'].map(s => (
                        <button
                            key={s}
                            onClick={() => setFilterStaff(s)}
                            style={{
                                padding: '3px 10px',
                                borderRadius: 20,
                                border: '1px solid var(--border)',
                                background: filterStaff === s ? (STAFF_COLORS[s] || 'var(--primary-color)') : 'var(--bg-elevated)',
                                color: filterStaff === s ? 'white' : 'var(--text-muted)',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                                fontWeight: filterStaff === s ? 600 : 400,
                            }}
                        >
                            {s === 'all' ? 'Tất cả' : s}
                        </button>
                    ))}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '1rem', marginTop: '0.75rem' }}>
                    {filteredConvos.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">📬</div>
                            <div className="empty-state-text">No messages</div>
                        </div>
                    ) : filteredConvos.map((conv) => (
                        <div
                            key={conv.id}
                            onClick={() => setSelectedConv(conv)}
                            style={{
                                padding: '1rem',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                marginBottom: '0.5rem',
                                cursor: 'pointer',
                                background: selectedConv?.id === conv.id ? 'var(--bg-elevated)' : 'var(--bg)',
                                borderLeft: conv.unread_count > 0 ? '4px solid var(--primary-color)' : '1px solid var(--border)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                <strong>{conv.sender_name || 'Guest'}</strong>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    {new Date(conv.last_message_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                                {conv.assigned_to ? (
                                    <span style={{
                                        fontSize: '0.7rem',
                                        background: STAFF_COLORS[conv.assigned_to] || 'var(--bg-elevated)',
                                        color: STAFF_COLORS[conv.assigned_to] ? 'white' : 'var(--text-muted)',
                                        padding: '1px 7px',
                                        borderRadius: 10,
                                        fontWeight: 600
                                    }}>
                                        {conv.assigned_to}
                                    </span>
                                ) : (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); claimConv(conv.id); }}
                                        style={{
                                            fontSize: '0.7rem', fontWeight: 700,
                                            background: 'var(--primary-color)', color: 'white',
                                            border: 'none', borderRadius: 10, padding: '2px 10px', cursor: 'pointer'
                                        }}
                                    >
                                        + Nhận
                                    </button>
                                )}
                                <ClaimTimerBadge conv={conv} myName={staffName} />
                            </div>

                            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {conv.last_message || '...'}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* RIGHT SIDE - CHAT THREAD */}
            <div style={{ flex: '2', display: 'flex', flexDirection: 'column', paddingLeft: '1rem' }}>
                {!selectedConv ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                        Select a conversation to view chat
                    </div>
                ) : (
                    <>
                        <div style={{ padding: '1rem 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <h3 style={{ margin: '0 0 4px 0' }}>{selectedConv.sender_name || 'Guest'}</h3>
                                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{selectedConv.platform} • ID: {selectedConv.external_id}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Phụ trách:</span>
                                <select
                                    value={selectedConv.assigned_to || ''}
                                    onChange={async (e) => {
                                        const newStaff = e.target.value;
                                        try {
                                            await apiPost(`/api/sis/meta/assign/${selectedConv.id}`, { staff_name: newStaff });
                                            setSelectedConv({ ...selectedConv, assigned_to: newStaff });
                                            setConvos(prev => prev.map(c => c.id === selectedConv.id ? { ...c, assigned_to: newStaff } : c));
                                        } catch(err) { console.error(err); }
                                    }}
                                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.8rem' }}
                                >
                                    <option value="">-- Chưa gán --</option>
                                    {STAFF_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* MESSAGES */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {messages.filter(m => m.sender_role !== 'ai_draft').map(msg => {
                                const isCustomer = msg.sender_role === 'customer';
                                return (
                                    <div key={msg.id} style={{ alignSelf: isCustomer ? 'flex-start' : 'flex-end', maxWidth: '80%' }}>
                                        <div style={{
                                            background: isCustomer ? 'var(--bg-elevated)' : 'var(--primary-color)',
                                            color: isCustomer ? 'var(--text)' : 'white',
                                            padding: '0.75rem 1rem',
                                            borderRadius: '12px',
                                            borderBottomLeftRadius: isCustomer ? '0px' : '12px',
                                            borderBottomRightRadius: !isCustomer ? '0px' : '12px',
                                        }}>
                                            {msg.message_text}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', textAlign: isCustomer ? 'left' : 'right' }}>
                                            {new Date(msg.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        {/* INPUT */}
                        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                            <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flexShrink: 0 }}>Bạn là:</span>
                                <select
                                    value={staffName}
                                    onChange={(e) => {
                                        setStaffName(e.target.value);
                                        localStorage.setItem('inbox_staff_name', e.target.value);
                                    }}
                                    style={{
                                        background: 'var(--bg-elevated)',
                                        border: '1px solid var(--border)',
                                        color: staffName ? 'var(--text)' : 'var(--text-muted)',
                                        borderRadius: '6px',
                                        padding: '4px 8px',
                                        fontSize: '0.85rem',
                                        flex: 1
                                    }}
                                >
                                    <option value="">-- Chọn tên --</option>
                                    {STAFF_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary-color)' }}>🤖 AI Copilot Draft:</span>
                            </div>
                            <textarea
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                style={{
                                    width: '100%',
                                    background: 'var(--bg-elevated)',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text)',
                                    borderRadius: '8px',
                                    padding: '0.75rem',
                                    minHeight: '80px',
                                    marginBottom: '0.5rem'
                                }}
                                placeholder="Edit AI draft or type your reply..."
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSend}
                                    disabled={sending || !replyText.trim()}
                                >
                                    {sending ? 'Sending...' : 'Send Message'} ✉️
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
