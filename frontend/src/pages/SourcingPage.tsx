import { useState } from 'react';
import { Camera, ArrowRightLeft, Box, Factory, Hash, Award, Sparkles, ExternalLink, Copy, Scale, ShieldAlert } from 'lucide-react';

export default function SourcingPage() {
    const [sourcingImage, setSourcingImage] = useState<string | null>(null);
    const [sourcingResult, setSourcingResult] = useState<any>(null);
    const [isSourcing, setIsSourcing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const fetchWithRetry = async (url: string, options: any, maxRetries = 3) => {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url, options);
                if (response.ok) return response;
                if (response.status === 401 || response.status === 429 || response.status >= 500) {
                    const delay = Math.pow(2, i) * 1000;
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                return response;
            } catch (err) {
                lastError = err;
                const delay = Math.pow(2, i) * 1000;
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw lastError || new Error("Kết nối API thất bại.");
    };

    const copyToClipboard = (text: string) => {
        if (!text || typeof text !== 'string') return;
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    };

    const handleImageUpload = (e: any) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setSourcingImage(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const processSourcing = async () => {
        if (!sourcingImage) return;
        setIsSourcing(true);
        setSourcingResult(null);
        setErrorMessage(null);

        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

            const prompt = `
        Đóng vai Chuyên gia Sourcing tại Trung Quốc. 
        MỤC TIÊU: Tìm chính xác mã số Offer ID (10-12 chữ số) và Tên Nhà Xưởng của sản phẩm trong ảnh.
        
        NHIỆM VỤ CHI TIẾT:
        1. Sử dụng Google Search Grounding để quét các trang "detail.1688.com" liên quan đến sản phẩm này.
        2. TRÍCH XUẤT chính xác mã Offer ID từ URL (ví dụ offer/824317120300.html thì ID là 824317120300).
        3. Tìm chính xác Tên Xưởng bằng Tiếng Trung (ví dụ: 义乌市某某电子商务有限公司). 
        
        TRẢ VỀ JSON:
        {
          "product_name": "Tên sản phẩm",
          "verified_match": { 
            "offer_id": "Mã số ID", 
            "factory_name_cn": "Tên xưởng TIẾNG TRUNG", 
            "factory_name_vn": "Dịch tên xưởng",
            "direct_url": "URL Dạng detail.1688.com/offer/[ID].html", 
            "trust_score": 95,
            "match_reason": "Lý do"
          },
          "logistics": { "weight": "0.xx kg", "min_order": "x pcs" },
          "negotiation_script": { "cn": "text", "vn": "text" },
          "qc_checklist": ["point"]
        }
      `;

            const payload = {
                contents: [{
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: "image/png", data: sourcingImage.split(',')[1] } }
                    ]
                }],
                tools: [{ "google_search": {} }],
                generationConfig: { responseMimeType: "application/json" }
            };

            const response = await fetchWithRetry(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`API Error ${response.status}`);

            const data = await response.json();
            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                let text = data.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
                const result = JSON.parse(text);

                // Chuẩn hóa link để tránh redirect 404
                if (result.verified_match && result.verified_match.offer_id) {
                    const matchID = String(result.verified_match.offer_id).match(/\d+/);
                    const cleanID = matchID ? matchID[0] : result.verified_match.offer_id;
                    result.verified_match.offer_id = cleanID;
                    result.verified_match.direct_url = `https://detail.1688.com/offer/${cleanID}.html`;
                }

                setSourcingResult(result);
            }
        } catch (error: any) {
            console.error("Mapping Error:", error);
            setErrorMessage(`Lỗi xác thực: ${error.message}`);
        } finally {
            setIsSourcing(false);
        }
    };

    return (
        <div style={{ padding: '0 0.5rem', maxWidth: 920 }}>
            <div className="page-header" style={{ marginBottom: '1.5rem' }}>
                <h2 className="page-title">📸 AI Visual Sourcing</h2>
                <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    Định danh xưởng sản xuất 1688 tự động bằng công nghệ Image Grounding Flash 2.5. Trích xuất chính xác tên công ty Trung Quốc và URL đặt hàng trực tiếp.
                </p>
            </div>

            <div className="space-y-6 animate-in fade-in duration-500">
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '1.5rem', padding: '2rem', position: 'relative', overflow: 'hidden' }}>

                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        {/* Upload UI */}
                        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{
                                border: '2px dashed var(--border)', borderRadius: '1.5rem', padding: '1rem', aspectRatio: '1/1',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative',
                                overflow: 'hidden', background: 'var(--bg-elevated)', transition: 'all 0.2s', cursor: 'pointer'
                            }}>
                                {sourcingImage ? (
                                    <img src={sourcingImage} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '1rem' }} alt="Sourcing" />
                                ) : (
                                    <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                                        <Camera size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem' }} />
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Tải ảnh sản phẩm</p>
                                    </div>
                                )}
                                <input type="file" onChange={handleImageUpload} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} accept="image/*" />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <button
                                    onClick={processSourcing}
                                    disabled={!sourcingImage || isSourcing}
                                    className="btn btn-primary"
                                    style={{ width: '100%', padding: '1rem', fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', borderRadius: '1rem' }}
                                >
                                    {isSourcing ? <div className="spinner" style={{ width: 18, height: 18, marginRight: 8 }}></div> : <ArrowRightLeft size={18} style={{ marginRight: 8 }} />}
                                    {isSourcing ? 'AI đang truy xuất ID...' : 'Định danh xưởng gốc'}
                                </button>
                                {sourcingImage && (
                                    <button onClick={() => { setSourcingImage(null); setSourcingResult(null); }} style={{ width: '100%', color: 'var(--text-muted)', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>Hủy mẫu ảnh</button>
                                )}
                            </div>

                            {errorMessage && (
                                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1rem', borderRadius: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#ef4444' }}>
                                    <ShieldAlert size={18} style={{ flexShrink: 0 }} />
                                    <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{String(errorMessage)}</p>
                                    <button onClick={() => setErrorMessage(null)} style={{ marginLeft: 'auto', fontSize: '0.75rem', textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>Ẩn</button>
                                </div>
                            )}
                        </div>

                        {/* RESULTS */}
                        <div style={{ flex: '2 1 400px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {!sourcingResult ? (
                                <div style={{ height: '100%', minHeight: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '2.5rem' }}>
                                    <Box size={56} style={{ marginBottom: '1.5rem', opacity: 0.2 }} />
                                    <div style={{ textAlign: 'center' }}>
                                        <p style={{ fontSize: '0.875rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.5 }}>Hệ thống sẵn sàng trích xuất ID sản phẩm</p>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    {/* Master Source Display */}
                                    <div style={{ background: 'linear-gradient(to bottom right, var(--bg-elevated), var(--bg-primary))', border: '1px solid rgba(99, 102, 241, 0.3)', padding: '2rem', borderRadius: '2.5rem', position: 'relative', overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                                            <div style={{ flex: 1, minWidth: 'min-content' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                                                    <span style={{ background: '#10b981', color: 'white', fontSize: '0.6rem', fontWeight: 800, padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase' }}>Verified Detail Match</span>
                                                    <span style={{ color: '#818cf8', fontFamily: 'monospace', fontSize: '0.65rem', fontWeight: 700, background: 'rgba(99, 102, 241, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <Hash size={10} /> ID: {String(sourcingResult?.verified_match?.offer_id || 'N/A')}
                                                    </span>
                                                </div>
                                                <h3 style={{ fontSize: '1.875rem', fontWeight: 900, color: 'white', display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.5rem 0', lineHeight: 1.2 }}>
                                                    <Factory style={{ color: '#818cf8', flexShrink: 0 }} size={28} /> {String(sourcingResult?.verified_match?.factory_name_cn || 'Verified Factory')}
                                                </h3>
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', fontStyle: 'italic', lineHeight: 1.4 }}>{String(sourcingResult?.verified_match?.factory_name_vn || '')}</p>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#34d399', background: 'rgba(52, 211, 153, 0.1)', padding: '0.5rem 1rem', borderRadius: '1rem', border: '1px solid rgba(52, 211, 153, 0.2)', fontSize: '0.75rem', fontWeight: 900 }}>
                                                    <Award size={18} /> {Number(sourcingResult?.verified_match?.trust_score || 0)}% ACCURATE
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.25rem', borderRadius: '1rem', border: '1px solid var(--border)', marginBottom: '2rem' }}>
                                            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.6, display: 'flex', alignItems: 'flex-start', gap: '0.75rem', margin: 0 }}>
                                                <Sparkles size={16} style={{ color: '#818cf8', marginTop: '2px', flexShrink: 0 }} />
                                                {String(sourcingResult?.verified_match?.match_reason || 'Link chính xác dựa trên ID sản phẩm thực tế.')}
                                            </p>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                                            <a
                                                href={String(sourcingResult?.verified_match?.direct_url || '#')}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="btn btn-primary"
                                                style={{ padding: '1.25rem', borderRadius: '1.5rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', border: '2px solid white', textDecoration: 'none' }}
                                            >
                                                MỞ TRANG ĐẶT HÀNG <ExternalLink size={20} />
                                            </a>
                                            <button
                                                onClick={() => copyToClipboard(String(sourcingResult?.verified_match?.factory_name_cn || ''))}
                                                className="btn btn-secondary"
                                                style={{ padding: '1.25rem', borderRadius: '1.5rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}
                                            >
                                                SAO CHÉP TÊN XƯỞNG <Copy size={20} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Logistics & Negotiation */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                                        <div style={{ background: 'var(--bg-elevated)', padding: '1.5rem', borderRadius: '1.5rem', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                            <h4 style={{ fontSize: '0.65rem', fontWeight: 900, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 1rem 0' }}><Scale size={14} /> Logistics Spec (Sourcing)</h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Cân nặng tịnh</span>
                                                    <span style={{ fontSize: '1.25rem', fontWeight: 900, color: 'white' }}>{String(sourcingResult?.logistics?.weight || '---')}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Sẵn hàng (Stock)</span>
                                                    <span style={{ fontSize: '0.875rem', fontWeight: 900, color: '#10b981' }}>YES</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>MOQ / Giao hàng</span>
                                                    <span style={{ fontSize: '0.875rem', fontWeight: 900, color: '#f59e0b' }}>{String(sourcingResult?.logistics?.min_order || '---')}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ background: 'var(--bg-elevated)', padding: '1.5rem', borderRadius: '1.5rem', border: '1px solid var(--border)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                                <h4 style={{ margin: 0, fontSize: '0.65rem', fontWeight: 900, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Kịch bản chat chốt đơn</h4>
                                                <button onClick={() => copyToClipboard(String(sourcingResult?.negotiation_script?.cn || ''))} style={{ fontSize: '0.6rem', fontWeight: 900, color: '#818cf8', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer' }}>Copy CN</button>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '1rem', border: '1px solid var(--border)', borderLeft: '4px solid #10b981' }}>
                                                    <p style={{ fontSize: '0.875rem', fontFamily: 'monospace', color: '#d1fae5', fontStyle: 'italic', lineHeight: 1.6, margin: 0, userSelect: 'all' }}>
                                                        {String(sourcingResult?.negotiation_script?.cn || '')}
                                                    </p>
                                                </div>
                                                <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '0 0.5rem', margin: 0 }}>Dịch: {String(sourcingResult?.negotiation_script?.vn || '')}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
