import { useState } from 'react';
import {
    Camera, ArrowRightLeft, Box, Factory, Hash, Award, Sparkles,
    ExternalLink, Copy, Scale, ShieldAlert, CheckCircle2, Search, Layers
} from 'lucide-react';
import { authFetch } from '../api/client';

interface SourcingResult {
    product_name: string;
    verified_match: {
        offer_id: string;
        factory_name_cn: string;
        factory_name_vn: string;
        direct_url: string;
        search_url: string;
        platform: '1688' | 'taobao';
        trust_score: number;
        match_reason: string;
    };
    logistics: {
        weight: string;
        min_order: string;
        price_range?: string;
    };
    negotiation_script: {
        cn: string;
        vn: string;
    };
    qc_checklist: string[];
}

type Step = 'idle' | 'analyzing' | 'searching' | 'done' | 'error';

export default function SourcingPage() {
    const [sourcingImage, setSourcingImage] = useState<string | null>(null);
    const [sourcingResult, setSourcingResult] = useState<SourcingResult | null>(null);
    const [step, setStep] = useState<Step>('idle');
    const [stepLabel, setStepLabel] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    const isSourcing = step === 'analyzing' || step === 'searching';

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
        if (!sourcingImage) { setErrorMessage('Chưa chọn ảnh.'); return; }

        setStep('analyzing');
        setStepLabel('Bước 1/3: AI nhận diện sản phẩm...');
        setSourcingResult(null);
        setErrorMessage(null);

        try {
            const mimeType = sourcingImage.substring(sourcingImage.indexOf(':') + 1, sourcingImage.indexOf(';'));
            const base64Data = sourcingImage.split(',')[1];

            setStep('searching');
            setStepLabel('Bước 2/3: Đang scrape 1688.com...');

            const res = await authFetch('/api/sourcing', {
                method: 'POST',
                body: JSON.stringify({ imageBase64: base64Data, mimeType }),
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
        setSourcingResult(null);
        setStep('idle');
        setErrorMessage(null);
    };

    return (
        <div style={{ padding: '0 0.5rem', maxWidth: 960 }}>
            <div className="page-header" style={{ marginBottom: '1.5rem' }}>
                <h2 className="page-title">📸 AI Visual Sourcing</h2>
                <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    AI nhận diện → Backend scrape 1688 thật → Supplier data chính xác.
                </p>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '1.5rem', padding: '2rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>

                    {/* Cột trái: Upload */}
                    <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {/* Image Drop Zone */}
                        <div style={{
                            border: '2px dashed var(--border)', borderRadius: '1.5rem', padding: '1rem',
                            aspectRatio: '1/1', display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', position: 'relative',
                            overflow: 'hidden', background: 'var(--bg-elevated)',
                            transition: 'border-color 0.2s', cursor: 'pointer',
                            ...(sourcingImage ? {} : { ':hover': { borderColor: 'var(--accent)' } })
                        }}>
                            {sourcingImage ? (
                                <img src={sourcingImage} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '1rem' }} alt="Product" />
                            ) : (
                                <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                                    <Camera size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem' }} />
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Tải ảnh sản phẩm</p>
                                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.6, marginTop: '0.25rem' }}>JPG, PNG, WEBP</p>
                                </div>
                            )}
                            <input type="file" onChange={handleImageUpload} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} accept="image/*" />
                        </div>

                        {/* Progress indicator */}
                        {isSourcing && (
                            <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '1rem', padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div className="spinner" style={{ width: 16, height: 16, flexShrink: 0 }}></div>
                                <div>
                                    <p style={{ fontSize: '0.7rem', fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{stepLabel}</p>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                                        <div style={{ height: 3, flex: 1, borderRadius: 99, background: '#818cf8', transition: 'background 0.4s' }}></div>
                                        <div style={{ height: 3, flex: 1, borderRadius: 99, background: step === 'searching' ? '#818cf8' : 'var(--border)', transition: 'background 0.4s' }}></div>
                                        <div style={{ height: 3, flex: 1, borderRadius: 99, background: 'var(--border)', transition: 'background 0.4s' }}></div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Action buttons */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <button
                                onClick={processSourcing}
                                disabled={!sourcingImage || isSourcing}
                                className="btn btn-primary"
                                style={{ width: '100%', padding: '1rem', fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', borderRadius: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                            >
                                {isSourcing
                                    ? <><div className="spinner" style={{ width: 16, height: 16 }}></div> Đang xử lý...</>
                                    : <><ArrowRightLeft size={16} /> Định danh xưởng gốc</>
                                }
                            </button>
                            {sourcingImage && (
                                <button onClick={reset} style={{ width: '100%', color: 'var(--text-muted)', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>
                                    Hủy & làm mới
                                </button>
                            )}
                        </div>

                        {/* Error box */}
                        {errorMessage && (
                            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', padding: '1rem', borderRadius: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem', color: '#ef4444' }}>
                                <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                                <p style={{ fontSize: '0.8rem', fontWeight: 500, margin: 0, lineHeight: 1.5 }}>{errorMessage}</p>
                                <button onClick={() => setErrorMessage(null)} style={{ marginLeft: 'auto', fontSize: '0.7rem', textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', flexShrink: 0 }}>Ẩn</button>
                            </div>
                        )}

                        {/* How it works */}
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <p style={{ fontSize: '0.6rem', fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Cách hoạt động</p>
                            {[
                                { icon: Camera, text: 'Gemini Vision nhận diện sản phẩm' },
                                { icon: Search, text: 'Playwright scrape 1688 lấy offer thật' },
                                { icon: Factory, text: 'AI chọn xưởng tốt nhất + thông tin' },
                            ].map(({ icon: Icon, text }, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <Icon size={10} style={{ color: '#818cf8' }} />
                                    </div>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0 }}>{text}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Cột phải: Results */}
                    <div style={{ flex: '2 1 400px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        {!sourcingResult ? (
                            <div style={{ height: '100%', minHeight: 420, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: '1.5rem', background: 'rgba(0,0,0,0.15)', padding: '2.5rem' }}>
                                <Box size={48} style={{ marginBottom: '1.25rem', opacity: 0.15 }} />
                                <p style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.4, textAlign: 'center' }}>
                                    Tải ảnh sản phẩm để tìm xưởng gốc
                                </p>
                                <p style={{ fontSize: '0.7rem', opacity: 0.3, marginTop: '0.5rem', textAlign: 'center' }}>
                                    AI sẽ tự động tìm Offer ID và tên nhà xưởng trên 1688.com
                                </p>
                            </div>
                        ) : (
                            <>
                                {/* ─── Card xưởng chính ─── */}
                                <div style={{ background: 'linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg-primary) 100%)', border: '1px solid rgba(99,102,241,0.3)', padding: '1.75rem', borderRadius: '2rem', position: 'relative', overflow: 'hidden' }}>
                                    {/* Header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                                                <span style={{ background: '#10b981', color: 'white', fontSize: '0.6rem', fontWeight: 900, padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Verified Match</span>
                                                {sourcingResult.verified_match?.platform && (
                                                    <span style={{ background: sourcingResult.verified_match.platform === 'taobao' ? 'rgba(251,146,60,0.15)' : 'rgba(239,68,68,0.12)', color: sourcingResult.verified_match.platform === 'taobao' ? '#fb923c' : '#f87171', fontSize: '0.6rem', fontWeight: 900, padding: '2px 8px', borderRadius: '4px', border: `1px solid ${sourcingResult.verified_match.platform === 'taobao' ? 'rgba(251,146,60,0.3)' : 'rgba(239,68,68,0.25)'}`, textTransform: 'uppercase' }}>
                                                        {sourcingResult.verified_match.platform === 'taobao' ? 'Taobao' : '1688.com'}
                                                    </span>
                                                )}
                                                {sourcingResult.verified_match?.offer_id ? (
                                                    <span style={{ color: '#818cf8', fontFamily: 'monospace', fontSize: '0.65rem', fontWeight: 700, background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <Hash size={10} /> {sourcingResult.verified_match.offer_id}
                                                    </span>
                                                ) : (
                                                    <span style={{ color: '#f59e0b', fontSize: '0.6rem', fontWeight: 700, background: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(245,158,11,0.2)' }}>
                                                        ID chưa xác minh
                                                    </span>
                                                )}
                                            </div>
                                            <h3 style={{ fontSize: '1.5rem', fontWeight: 900, color: 'white', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.25rem 0', lineHeight: 1.2, flexWrap: 'wrap' }}>
                                                <Factory style={{ color: '#818cf8', flexShrink: 0 }} size={24} />
                                                <span style={{ wordBreak: 'break-all' }}>{sourcingResult.verified_match?.factory_name_cn || 'Chưa xác định'}</span>
                                            </h3>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, fontStyle: 'italic', margin: '0.25rem 0 0', lineHeight: 1.4 }}>
                                                {sourcingResult.verified_match?.factory_name_vn}
                                            </p>
                                            {sourcingResult.product_name && (
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0' }}>
                                                    Sản phẩm: <strong>{sourcingResult.product_name}</strong>
                                                </p>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: (sourcingResult.verified_match?.trust_score || 0) >= 70 ? '#34d399' : '#f59e0b', background: (sourcingResult.verified_match?.trust_score || 0) >= 70 ? 'rgba(52,211,153,0.08)' : 'rgba(245,158,11,0.08)', padding: '0.5rem 1rem', borderRadius: '1rem', border: `1px solid ${(sourcingResult.verified_match?.trust_score || 0) >= 70 ? 'rgba(52,211,153,0.2)' : 'rgba(245,158,11,0.2)'}`, fontSize: '0.75rem', fontWeight: 900, whiteSpace: 'nowrap' }}>
                                            <Award size={16} /> {sourcingResult.verified_match?.trust_score || 0}%
                                        </div>
                                    </div>

                                    {/* Match reason */}
                                    {sourcingResult.verified_match?.match_reason && (
                                        <div style={{ background: 'rgba(0,0,0,0.25)', padding: '1rem', borderRadius: '1rem', border: '1px solid var(--border)', marginBottom: '1.25rem' }}>
                                            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.6, display: 'flex', alignItems: 'flex-start', gap: '0.5rem', margin: 0 }}>
                                                <Sparkles size={14} style={{ color: '#818cf8', marginTop: 2, flexShrink: 0 }} />
                                                {sourcingResult.verified_match.match_reason}
                                            </p>
                                        </div>
                                    )}

                                    {/* CTA buttons */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                        {sourcingResult.verified_match?.offer_id ? (
                                            <a
                                                href={sourcingResult.verified_match.direct_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="btn btn-primary"
                                                style={{ padding: '1rem', borderRadius: '1.25rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none' }}
                                            >
                                                Mở {sourcingResult.verified_match.platform === 'taobao' ? 'Taobao' : '1688'} <ExternalLink size={16} />
                                            </a>
                                        ) : sourcingResult.verified_match?.search_url ? (
                                            <a
                                                href={sourcingResult.verified_match.search_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="btn btn-secondary"
                                                style={{ padding: '1rem', borderRadius: '1.25rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none' }}
                                            >
                                                <Search size={14} /> Tìm trên 1688 <ExternalLink size={14} />
                                            </a>
                                        ) : (
                                            <div style={{ padding: '1rem', borderRadius: '1.25rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                                <Layers size={14} /> Không tìm được link trực tiếp
                                            </div>
                                        )}
                                        <button
                                            onClick={() => copyToClipboard(sourcingResult.verified_match?.factory_name_cn || '', 'factory')}
                                            className="btn btn-secondary"
                                            style={{ padding: '1rem', borderRadius: '1.25rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                                        >
                                            {copied === 'factory' ? <><CheckCircle2 size={16} style={{ color: '#10b981' }} /> Đã sao chép</> : <><Copy size={16} /> Sao chép tên xưởng</>}
                                        </button>
                                    </div>
                                </div>

                                {/* ─── Logistics + Negotiation ─── */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                                    {/* Logistics */}
                                    <div style={{ background: 'var(--bg-elevated)', padding: '1.5rem', borderRadius: '1.5rem', border: '1px solid var(--border)' }}>
                                        <h4 style={{ margin: '0 0 1rem', fontSize: '0.65rem', fontWeight: 900, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.2em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <Scale size={13} /> Logistics Spec
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                            {[
                                                { label: 'Cân nặng', value: sourcingResult.logistics?.weight, color: 'white' },
                                                { label: 'Giá tham khảo', value: sourcingResult.logistics?.price_range, color: '#fbbf24' },
                                                { label: 'MOQ tối thiểu', value: sourcingResult.logistics?.min_order, color: '#f59e0b' },
                                            ].map(({ label, value, color }) => value ? (
                                                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid var(--border)', paddingBottom: '0.625rem' }}>
                                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                                                    <span style={{ fontSize: '1rem', fontWeight: 900, color }}>{value}</span>
                                                </div>
                                            ) : null)}
                                        </div>
                                    </div>

                                    {/* Negotiation */}
                                    <div style={{ background: 'var(--bg-elevated)', padding: '1.5rem', borderRadius: '1.5rem', border: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                            <h4 style={{ margin: 0, fontSize: '0.65rem', fontWeight: 900, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Kịch bản chat chốt đơn</h4>
                                            <button
                                                onClick={() => copyToClipboard(sourcingResult.negotiation_script?.cn || '', 'script')}
                                                style={{ fontSize: '0.6rem', fontWeight: 900, color: copied === 'script' ? '#10b981' : '#818cf8', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                            >
                                                {copied === 'script' ? <><CheckCircle2 size={11} /> Copied</> : 'Copy CN'}
                                            </button>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.875rem', borderRadius: '0.875rem', border: '1px solid var(--border)', borderLeft: '3px solid #10b981' }}>
                                                <p style={{ fontSize: '0.875rem', fontFamily: 'monospace', color: '#d1fae5', fontStyle: 'italic', lineHeight: 1.6, margin: 0, userSelect: 'all' }}>
                                                    {sourcingResult.negotiation_script?.cn}
                                                </p>
                                            </div>
                                            <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '0 0.25rem', margin: 0, lineHeight: 1.5 }}>
                                                {sourcingResult.negotiation_script?.vn}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* ─── QC Checklist ─── */}
                                {sourcingResult.qc_checklist?.length > 0 && (
                                    <div style={{ background: 'var(--bg-elevated)', padding: '1.5rem', borderRadius: '1.5rem', border: '1px solid var(--border)' }}>
                                        <h4 style={{ margin: '0 0 1rem', fontSize: '0.65rem', fontWeight: 900, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.2em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <CheckCircle2 size={13} /> QC Checklist — Kiểm hàng trước khi nhận
                                        </h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
                                            {sourcingResult.qc_checklist.map((item, i) => (
                                                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                                    <CheckCircle2 size={14} style={{ color: '#10b981', flexShrink: 0, marginTop: 2 }} />
                                                    <span>{item}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
