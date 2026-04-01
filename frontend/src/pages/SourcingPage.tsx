import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Camera, Search, Box, Factory, Hash, Award, Sparkles,
    ExternalLink, Copy, Scale, ShieldAlert, CheckCircle2,
    Layers, Package, Clock, FileText, ChevronDown, ChevronUp,
    History, ArrowRightLeft, Beaker, Globe, Star
} from 'lucide-react';
import { authFetch, apiGet } from '../api/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SupplierLogistics {
    weight: string;
    cbm: string;
    material: string;
    min_order: string;
    price_range: string;
    lead_time: string;
    certifications: string;
}

interface SupplierInfo {
    years_in_business: string;
    rating: string;
}

interface Supplier {
    rank: number;
    offer_id: string;
    factory_name_cn: string;
    factory_name_vn: string;
    direct_url: string;
    search_url: string;
    platform: '1688' | 'alibaba' | 'taobao' | 'aliexpress';
    trust_score: number;
    match_reason: string;
    logistics: SupplierLogistics;
    supplier_info: SupplierInfo;
}

interface SourcingResult {
    id: number | null;
    product_name: string;
    product_name_cn: string;
    product_name_en: string;
    search_type: 'image' | 'text';
    search_query: string;
    suppliers: Supplier[];
    negotiation_script: { cn: string; vn: string };
    qc_checklist: string[];
    total_suppliers: number;
    search_urls: { alibaba: string; '1688': string };
}

interface HistoryItem {
    id: number;
    search_query: string;
    search_type: string;
    product_name: string;
    product_name_cn: string;
    product_name_en: string;
    suppliers: Supplier[];
    best_supplier: Supplier;
    created_at: string;
}

type Step = 'idle' | 'analyzing' | 'searching' | 'done' | 'error';
type SearchMode = 'image' | 'text';
type Tab = 'search' | 'history';

const PLATFORM_COLORS: Record<string, string> = {
    '1688': '#f87171', alibaba: '#f59e0b', taobao: '#fb923c', aliexpress: '#34d399'
};
const PLATFORM_LABELS: Record<string, string> = {
    '1688': '1688.com', alibaba: 'Alibaba.com', taobao: 'Taobao', aliexpress: 'AliExpress'
};

// ─── Supplier Card ────────────────────────────────────────────────────────────

function SupplierCard({ supplier, index, onCopy }: {
    supplier: Supplier;
    index: number;
    onCopy: (text: string, key: string) => void;
}) {
    const [expanded, setExpanded] = useState(index === 0);
    const isTopPick = index === 0;
    const score = supplier.trust_score || 0;
    const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#6b7280';
    const pColor = PLATFORM_COLORS[supplier.platform] || '#818cf8';

    return (
        <div style={{
            background: isTopPick ? 'linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg-primary) 100%)' : 'var(--bg-elevated)',
            border: isTopPick ? '1px solid rgba(99,102,241,0.3)' : '1px solid var(--border)',
            padding: 0, borderRadius: '1.25rem', position: 'relative', overflow: 'hidden',
            transition: 'transform 0.2s, box-shadow 0.2s',
        }}>
            {/* Header */}
            <div
                onClick={() => setExpanded(!expanded)}
                style={{ padding: '1.25rem', cursor: 'pointer' }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                            {isTopPick && (
                                <span style={{ background: '#10b981', color: 'white', fontSize: '0.55rem', fontWeight: 900, padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    ⭐ Best Match
                                </span>
                            )}
                            <span style={{ background: 'rgba(255,255,255,0.07)', color: pColor, fontSize: '0.55rem', fontWeight: 900, padding: '2px 8px', borderRadius: '4px', border: `1px solid ${pColor}40`, textTransform: 'uppercase' }}>
                                {PLATFORM_LABELS[supplier.platform] || supplier.platform}
                            </span>
                            {supplier.offer_id && (
                                <span style={{ color: '#818cf8', fontFamily: 'monospace', fontSize: '0.6rem', fontWeight: 700, background: 'rgba(99,102,241,0.1)', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                    <Hash size={9} /> {supplier.offer_id}
                                </span>
                            )}
                        </div>
                        <h4 style={{ fontSize: '1rem', fontWeight: 800, color: 'white', margin: '0 0 0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem', lineHeight: 1.3 }}>
                            <Factory style={{ color: '#818cf8', flexShrink: 0 }} size={18} />
                            <span style={{ wordBreak: 'break-all' }}>{supplier.factory_name_cn || 'N/A'}</span>
                        </h4>
                        {supplier.factory_name_vn && (
                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                                {supplier.factory_name_vn}
                            </p>
                        )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: scoreColor, background: `${scoreColor}15`, padding: '0.35rem 0.75rem', borderRadius: '0.75rem', border: `1px solid ${scoreColor}30`, fontSize: '0.75rem', fontWeight: 900, whiteSpace: 'nowrap' }}>
                            <Award size={14} /> {score}%
                        </div>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            {expanded ? 'Thu gọn' : 'Chi tiết'}
                        </span>
                    </div>
                </div>

                {/* Quick spec preview — always visible */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                    {supplier.logistics?.weight && (
                        <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: 8, background: 'rgba(99,102,241,0.1)', color: '#818cf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <Scale size={10} /> {supplier.logistics.weight}
                        </span>
                    )}
                    {supplier.logistics?.price_range && (
                        <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: 8, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', fontWeight: 700 }}>
                            💰 {supplier.logistics.price_range}
                        </span>
                    )}
                    {supplier.logistics?.min_order && (
                        <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 700 }}>
                            📦 MOQ: {supplier.logistics.min_order}
                        </span>
                    )}
                    {supplier.logistics?.material && (
                        <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', color: '#10b981', fontWeight: 700 }}>
                            🧵 {supplier.logistics.material}
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '1.25rem' }}>
                    {/* Match reason */}
                    {supplier.match_reason && (
                        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '0.75rem', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                            <Sparkles size={13} style={{ color: '#818cf8', marginTop: 2, flexShrink: 0 }} />
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic', margin: 0, lineHeight: 1.5 }}>
                                {supplier.match_reason}
                            </p>
                        </div>
                    )}

                    {/* Full specs grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                        {[
                            { icon: Scale, label: 'Cân nặng', value: supplier.logistics?.weight, color: '#818cf8' },
                            { icon: Package, label: 'CBM / Kích thước', value: supplier.logistics?.cbm, color: '#60a5fa' },
                            { icon: Beaker, label: 'Chất liệu', value: supplier.logistics?.material, color: '#10b981' },
                            { icon: Box, label: 'MOQ', value: supplier.logistics?.min_order, color: '#f59e0b' },
                            { icon: Layers, label: 'Giá', value: supplier.logistics?.price_range, color: '#fbbf24' },
                            { icon: Clock, label: 'Lead time', value: supplier.logistics?.lead_time, color: '#f87171' },
                            { icon: FileText, label: 'Chứng nhận', value: supplier.logistics?.certifications, color: '#a78bfa' },
                            { icon: Star, label: 'Kinh nghiệm', value: supplier.supplier_info?.years_in_business, color: '#fb923c' },
                        ].filter(s => s.value).map(({ icon: Icon, label, value, color }) => (
                            <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.5rem', background: 'rgba(0,0,0,0.15)', borderRadius: '0.625rem' }}>
                                <Icon size={14} style={{ color, flexShrink: 0, marginTop: 2 }} />
                                <div>
                                    <p style={{ fontSize: '0.55rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '0 0 2px', letterSpacing: '0.05em' }}>{label}</p>
                                    <p style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white', margin: 0 }}>{value}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* CTA buttons */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {supplier.direct_url ? (
                            <a
                                href={supplier.direct_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-primary"
                                style={{ flex: '1 1 140px', padding: '0.75rem', borderRadius: '0.875rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', textDecoration: 'none' }}
                            >
                                <Globe size={14} /> Mở {PLATFORM_LABELS[supplier.platform] || supplier.platform} <ExternalLink size={12} />
                            </a>
                        ) : supplier.search_url ? (
                            <a
                                href={supplier.search_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-secondary"
                                style={{ flex: '1 1 140px', padding: '0.75rem', borderRadius: '0.875rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', textDecoration: 'none' }}
                            >
                                <Search size={13} /> Tìm trên 1688 <ExternalLink size={12} />
                            </a>
                        ) : null}
                        <button
                            onClick={(e) => { e.stopPropagation(); onCopy(supplier.factory_name_cn || '', `factory-${index}`); }}
                            className="btn btn-secondary"
                            style={{ flex: '1 1 120px', padding: '0.75rem', borderRadius: '0.875rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                        >
                            <Copy size={13} /> Copy tên xưởng
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SourcingPage() {
    const [searchParams] = useSearchParams();

    const [searchMode, setSearchMode] = useState<SearchMode>('text');
    const [sourcingImage, setSourcingImage] = useState<string | null>(null);
    const [productName, setProductName] = useState(searchParams.get('q') || '');
    const [sourcingResult, setSourcingResult] = useState<SourcingResult | null>(null);
    const [step, setStep] = useState<Step>('idle');
    const [stepLabel, setStepLabel] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>('search');
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    const isSourcing = step === 'analyzing' || step === 'searching';

    // Auto-trigger search if ?q= provided
    useEffect(() => {
        const q = searchParams.get('q');
        if (q) {
            setProductName(q);
            setSearchMode('text');
        }
    }, [searchParams]);

    const loadHistory = async () => {
        setHistoryLoading(true);
        try {
            const res = await apiGet<{ success: boolean; data: HistoryItem[] }>('/api/sourcing/history');
            if (res.success) setHistory(res.data || []);
        } catch (e) { console.error('History load failed', e); }
        setHistoryLoading(false);
    };

    useEffect(() => { if (tab === 'history') loadHistory(); }, [tab]);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => setSourcingImage(reader.result as string);
        reader.readAsDataURL(file);
    };

    const copyToClipboard = (text: string, key: string) => {
        if (!text) return;
        navigator.clipboard.writeText(text).catch(() => {
            const el = document.createElement('textarea');
            el.value = text;
            el.style.position = 'fixed';
            el.style.left = '-9999px';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        });
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    const processSourcing = async () => {
        if (searchMode === 'image' && !sourcingImage) { setErrorMessage('Chưa chọn ảnh.'); return; }
        if (searchMode === 'text' && !productName.trim()) { setErrorMessage('Chưa nhập tên sản phẩm.'); return; }

        setStep('analyzing');
        setStepLabel('Bước 1/3: AI nhận diện sản phẩm...');
        setSourcingResult(null);
        setErrorMessage(null);

        try {
            const body: Record<string, string> = {};
            if (searchMode === 'image' && sourcingImage) {
                body.mimeType = sourcingImage.substring(sourcingImage.indexOf(':') + 1, sourcingImage.indexOf(';'));
                body.imageBase64 = sourcingImage.split(',')[1];
                body.searchType = 'image';
            } else {
                body.productName = productName.trim();
                body.searchType = 'text';
            }

            setStep('searching');
            setStepLabel('Bước 2/3: Scrape Alibaba + 1688...');

            const res = await authFetch('/api/sourcing', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const json = await res.json();

            if (!json.success) throw new Error(json.error || `Server error ${res.status}`);

            setSourcingResult(json.data);
            setStep('done');
        } catch (error: any) {
            console.error('Sourcing Error:', error);
            setErrorMessage(error.message || 'Lỗi không xác định. Vui lòng thử lại.');
            setStep('error');
        }
    };

    const reset = () => {
        setSourcingImage(null);
        setProductName('');
        setSourcingResult(null);
        setStep('idle');
        setErrorMessage(null);
    };

    return (
        <div style={{ padding: '0 0.5rem', maxWidth: 1060 }}>
            <div className="page-header" style={{ marginBottom: '1rem' }}>
                <h2 className="page-title">📸 AI Visual Sourcing v2</h2>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    AI nhận diện → Scrape Alibaba + 1688 → So sánh nhiều supplier → Specs chi tiết
                </p>
            </div>

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                {([
                    { key: 'search' as Tab, icon: Search, label: 'Tìm Supplier' },
                    { key: 'history' as Tab, icon: History, label: `Lịch sử (${history.length})` },
                ]).map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        style={{
                            flex: 1, padding: '0.75rem', borderRadius: 10, cursor: 'pointer',
                            border: `2px solid ${tab === t.key ? 'var(--primary-color)' : 'var(--border)'}`,
                            background: tab === t.key ? 'rgba(99,102,241,0.08)' : 'var(--bg-elevated)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                            fontWeight: 700, fontSize: '0.85rem',
                            color: tab === t.key ? 'var(--primary-color)' : 'var(--text-muted)',
                            transition: 'all 0.2s',
                        }}
                    >
                        <t.icon size={16} /> {t.label}
                    </button>
                ))}
            </div>

            {/* ═══ History Tab ═══ */}
            {tab === 'history' && (
                <div className="card" style={{ padding: '1.25rem' }}>
                    {historyLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><div className="spinner" /></div>
                    ) : history.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">📸</div>
                            <div className="empty-state-text">Chưa có lịch sử sourcing. Thực hiện tìm kiếm đầu tiên.</div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {history.map(h => (
                                <div
                                    key={h.id}
                                    onClick={() => {
                                        setTab('search');
                                        setSourcingResult({
                                            id: h.id,
                                            product_name: h.product_name,
                                            product_name_cn: h.product_name_cn || '',
                                            product_name_en: h.product_name_en || '',
                                            search_type: h.search_type as 'image' | 'text',
                                            search_query: h.search_query,
                                            suppliers: h.suppliers || [],
                                            negotiation_script: { cn: '', vn: '' },
                                            qc_checklist: [],
                                            total_suppliers: h.suppliers?.length || 0,
                                            search_urls: { alibaba: '', '1688': '' },
                                        });
                                        setStep('done');
                                    }}
                                    style={{
                                        padding: '0.875rem 1rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                                        borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem',
                                        transition: 'border-color 0.2s',
                                    }}
                                >
                                    <span style={{ fontSize: '1.5rem' }}>{h.search_type === 'image' ? '📸' : '🔍'}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ fontWeight: 700, fontSize: '0.9rem', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {h.product_name || h.search_query}
                                        </p>
                                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
                                            {h.suppliers?.length || 0} suppliers • {new Date(h.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                    <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ═══ Search Tab ═══ */}
            {tab === 'search' && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '1.5rem', padding: '1.5rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>

                        {/* ─── Left Column: Input ─── */}
                        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

                            {/* Search mode toggle */}
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                {([
                                    { key: 'text' as SearchMode, icon: Search, label: 'Tên sản phẩm' },
                                    { key: 'image' as SearchMode, icon: Camera, label: 'Upload ảnh' },
                                ]).map(m => (
                                    <button
                                        key={m.key}
                                        onClick={() => setSearchMode(m.key)}
                                        style={{
                                            flex: 1, padding: '0.5rem', borderRadius: 8, cursor: 'pointer',
                                            border: `1.5px solid ${searchMode === m.key ? 'var(--primary-color)' : 'var(--border)'}`,
                                            background: searchMode === m.key ? 'rgba(99,102,241,0.08)' : 'transparent',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                                            fontWeight: 700, fontSize: '0.72rem',
                                            color: searchMode === m.key ? 'var(--primary-color)' : 'var(--text-muted)',
                                        }}
                                    >
                                        <m.icon size={13} /> {m.label}
                                    </button>
                                ))}
                            </div>

                            {/* Text search input */}
                            {searchMode === 'text' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <input
                                        type="text"
                                        value={productName}
                                        onChange={e => setProductName(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && !isSourcing && processSourcing()}
                                        placeholder="Ví dụ: áo thun nam, túi xách nữ, balo laptop..."
                                        style={{
                                            width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                                            color: 'var(--text)', borderRadius: 10, padding: '0.875rem 1rem', fontSize: '0.9rem',
                                            boxSizing: 'border-box',
                                        }}
                                    />
                                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                        {['Áo thun nam', 'Túi xách nữ', 'Giày thể thao', 'Balo laptop', 'Ốp lưng điện thoại', 'Đồng hồ nam'].map(q => (
                                            <button key={q} onClick={() => setProductName(q)} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: '0.65rem', cursor: 'pointer' }}>
                                                {q}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Image upload zone */}
                            {searchMode === 'image' && (
                                <div style={{
                                    border: '2px dashed var(--border)', borderRadius: '1.25rem', padding: '1rem',
                                    aspectRatio: '4/3', display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center', position: 'relative',
                                    overflow: 'hidden', background: 'var(--bg-elevated)', cursor: 'pointer',
                                }}>
                                    {sourcingImage ? (
                                        <img src={sourcingImage} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '1rem' }} alt="Product" />
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: '1rem' }}>
                                            <Camera size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 0.75rem' }} />
                                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Tải ảnh sản phẩm</p>
                                            <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', opacity: 0.6, marginTop: '0.2rem' }}>JPG, PNG, WEBP</p>
                                        </div>
                                    )}
                                    <input type="file" onChange={handleImageUpload} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} accept="image/*" />
                                </div>
                            )}

                            {/* Progress */}
                            {isSourcing && (
                                <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '0.875rem', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                    <div className="spinner" style={{ width: 14, height: 14, flexShrink: 0 }}></div>
                                    <div>
                                        <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{stepLabel}</p>
                                        <div style={{ display: 'flex', gap: '3px', marginTop: '5px' }}>
                                            <div style={{ height: 3, flex: 1, borderRadius: 99, background: '#818cf8' }}></div>
                                            <div style={{ height: 3, flex: 1, borderRadius: 99, background: step === 'searching' ? '#818cf8' : 'var(--border)' }}></div>
                                            <div style={{ height: 3, flex: 1, borderRadius: 99, background: 'var(--border)' }}></div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Action buttons */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                <button
                                    onClick={processSourcing}
                                    disabled={isSourcing || (searchMode === 'image' ? !sourcingImage : !productName.trim())}
                                    className="btn btn-primary"
                                    style={{ width: '100%', padding: '0.875rem', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', borderRadius: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                                >
                                    {isSourcing
                                        ? <><div className="spinner" style={{ width: 14, height: 14 }}></div> Đang xử lý...</>
                                        : <><ArrowRightLeft size={15} /> Tìm Supplier</>
                                    }
                                </button>
                                {(sourcingImage || productName) && (
                                    <button onClick={reset} style={{ width: '100%', color: 'var(--text-muted)', fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0.4rem', background: 'none', border: 'none', cursor: 'pointer' }}>
                                        Hủy & làm mới
                                    </button>
                                )}
                            </div>

                            {/* Error */}
                            {errorMessage && (
                                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.75rem', borderRadius: '0.875rem', display: 'flex', alignItems: 'flex-start', gap: '0.65rem', color: '#ef4444' }}>
                                    <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                                    <p style={{ fontSize: '0.75rem', fontWeight: 500, margin: 0, lineHeight: 1.5 }}>{errorMessage}</p>
                                    <button onClick={() => setErrorMessage(null)} style={{ marginLeft: 'auto', fontSize: '0.65rem', textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', flexShrink: 0 }}>Ẩn</button>
                                </div>
                            )}

                            {/* How it works */}
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                <p style={{ fontSize: '0.55rem', fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Cách hoạt động v2</p>
                                {[
                                    { icon: searchMode === 'image' ? Camera : Search, text: searchMode === 'image' ? 'Gemini Vision nhận diện sản phẩm' : 'Gemini AI phân tích tên sản phẩm' },
                                    { icon: Globe, text: 'Scrape song song Alibaba.com + 1688.com' },
                                    { icon: Factory, text: 'So sánh 3-5 supplier + specs chi tiết' },
                                ].map(({ icon: Icon, text }, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <Icon size={9} style={{ color: '#818cf8' }} />
                                        </div>
                                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0 }}>{text}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ─── Right Column: Results ─── */}
                        <div style={{ flex: '2 1 400px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {!sourcingResult ? (
                                <div style={{ height: '100%', minHeight: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: '1.25rem', background: 'rgba(0,0,0,0.12)', padding: '2rem' }}>
                                    <Box size={44} style={{ marginBottom: '1rem', opacity: 0.15 }} />
                                    <p style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.4, textAlign: 'center' }}>
                                        {searchMode === 'image' ? 'Tải ảnh để tìm supplier gốc' : 'Nhập tên sản phẩm để tìm supplier'}
                                    </p>
                                    <p style={{ fontSize: '0.65rem', opacity: 0.3, marginTop: '0.4rem', textAlign: 'center' }}>
                                        AI sẽ tìm 3-5 suppliers trên Alibaba + 1688 với specs chi tiết
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {/* Product name header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        <div>
                                            <h3 style={{ margin: '0 0 2px', fontSize: '1.1rem', fontWeight: 800 }}>
                                                {sourcingResult.product_name}
                                            </h3>
                                            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                {sourcingResult.product_name_cn} • {sourcingResult.product_name_en}
                                            </p>
                                        </div>
                                        <span style={{ fontSize: '0.7rem', padding: '4px 10px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', color: '#10b981', fontWeight: 800 }}>
                                            {sourcingResult.total_suppliers} suppliers found
                                        </span>
                                    </div>

                                    {/* Supplier cards */}
                                    {sourcingResult.suppliers?.map((supplier, i) => (
                                        <SupplierCard
                                            key={i}
                                            supplier={supplier}
                                            index={i}
                                            onCopy={copyToClipboard}
                                        />
                                    ))}

                                    {/* Quick search links */}
                                    {sourcingResult.search_urls && (
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            {sourcingResult.search_urls.alibaba && (
                                                <a href={sourcingResult.search_urls.alibaba} target="_blank" rel="noopener noreferrer"
                                                    style={{ flex: '1 1 150px', padding: '0.6rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', textDecoration: 'none', fontSize: '0.7rem', fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                                                    🔍 Tìm thêm trên Alibaba <ExternalLink size={11} />
                                                </a>
                                            )}
                                            {sourcingResult.search_urls['1688'] && (
                                                <a href={sourcingResult.search_urls['1688']} target="_blank" rel="noopener noreferrer"
                                                    style={{ flex: '1 1 150px', padding: '0.6rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', textDecoration: 'none', fontSize: '0.7rem', fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                                                    🔍 Tìm thêm trên 1688 <ExternalLink size={11} />
                                                </a>
                                            )}
                                        </div>
                                    )}

                                    {/* Negotiation + QC */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.875rem' }}>
                                        {/* Negotiation Script */}
                                        {(sourcingResult.negotiation_script?.cn || sourcingResult.negotiation_script?.vn) && (
                                            <div style={{ background: 'var(--bg-elevated)', padding: '1.25rem', borderRadius: '1.25rem', border: '1px solid var(--border)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                                    <h4 style={{ margin: 0, fontSize: '0.6rem', fontWeight: 900, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Kịch bản chat chốt đơn</h4>
                                                    <button
                                                        onClick={() => copyToClipboard(sourcingResult.negotiation_script?.cn || '', 'script')}
                                                        style={{ fontSize: '0.55rem', fontWeight: 900, color: copied === 'script' ? '#10b981' : '#818cf8', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                                                    >
                                                        {copied === 'script' ? <><CheckCircle2 size={10} /> Copied</> : 'Copy CN'}
                                                    </button>
                                                </div>
                                                <div style={{ background: 'rgba(0,0,0,0.25)', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid var(--border)', borderLeft: '3px solid #10b981', marginBottom: '0.5rem' }}>
                                                    <p style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: '#d1fae5', fontStyle: 'italic', lineHeight: 1.5, margin: 0, userSelect: 'all' }}>
                                                        {sourcingResult.negotiation_script.cn}
                                                    </p>
                                                </div>
                                                <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0, lineHeight: 1.4 }}>
                                                    {sourcingResult.negotiation_script.vn}
                                                </p>
                                            </div>
                                        )}

                                        {/* QC Checklist */}
                                        {sourcingResult.qc_checklist?.length > 0 && (
                                            <div style={{ background: 'var(--bg-elevated)', padding: '1.25rem', borderRadius: '1.25rem', border: '1px solid var(--border)' }}>
                                                <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.6rem', fontWeight: 900, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.15em', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                    <CheckCircle2 size={12} /> QC Checklist
                                                </h4>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                    {sourcingResult.qc_checklist.map((item, i) => (
                                                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                                            <CheckCircle2 size={12} style={{ color: '#10b981', flexShrink: 0, marginTop: 2 }} />
                                                            <span>{item}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
