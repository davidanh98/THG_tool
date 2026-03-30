import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, onSnapshot, 
  query, orderBy, doc, updateDoc, deleteDoc, setLogLevel
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Search, Users, Ship, Package, Globe, BarChart3, 
  Database, Plus, Trash2, CheckCircle, Clock, AlertCircle,
  ExternalLink, MessageSquare, Send, FileText, Share2, Sparkles,
  LayoutDashboard, Settings, Code, ChevronRight, Zap, Filter, 
  Layers, Terminal, Cpu, Trophy, Target, Medal, TrendingUp, UserCheck, Timer, History,
  Camera, ShoppingBag, Scale, ShieldCheck, Languages, Link2, Box, ArrowRightLeft,
  Factory, Award, CheckCircle2, ShieldAlert, ZapOff, Copy, Hash
} from 'lucide-react';

// Bật log debug cho Firestore
setLogLevel('debug');

const firebaseConfig = JSON.parse(__firebase_config);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'smartsourcing-hub';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const CLAIM_TIMEOUT_MINUTES = 60; 

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [user, setUser] = useState(null);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);
  
  // State cho Sourcing
  const [sourcingImage, setSourcingImage] = useState(null);
  const [sourcingResult, setSourcingResult] = useState(null);
  const [isSourcing, setIsSourcing] = useState(false);

  // State cho Log tương tác
  const [interactionLog, setInteractionLog] = useState('');
  const [activeLeadId, setActiveLeadId] = useState(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Xác thực thất bại:", err);
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const leadsRef = collection(db, 'artifacts', appId, 'public', 'data', 'leads');
        const q = query(leadsRef);
        
        const unsubscribeLeads = onSnapshot(q, (snapshot) => {
          const leadsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          
          const now = Date.now();
          leadsData.forEach(async (lead) => {
            if (lead.assignedTo && lead.status === 'pending' && !lead.lastInteractionAt) {
              const claimedAt = new Date(lead.claimedAt).getTime();
              const diffMinutes = (now - claimedAt) / (1000 * 60);
              
              if (diffMinutes > CLAIM_TIMEOUT_MINUTES) {
                const leadRef = doc(db, 'artifacts', appId, 'public', 'data', 'leads', lead.id);
                try {
                  await updateDoc(leadRef, {
                    assignedTo: null,
                    assignedToName: null,
                    claimedAt: null,
                    status: 'unprocessed',
                    releaseCount: (lead.releaseCount || 0) + 1
                  });
                } catch (e) {
                  console.error("Lỗi nhả khách:", e);
                }
              }
            }
          });

          setLeads(leadsData.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
          setLoading(false);
        }, (err) => {
          console.error("Lỗi Firestore Snapshot:", err);
          setLoading(false);
        });

        return () => unsubscribeLeads();
      }
    });

    initAuth();
    return () => unsubscribeAuth();
  }, []);

  const fetchWithRetry = async (url, options, maxRetries = 3) => {
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

  const copyToClipboard = (text) => {
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

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSourcingImage(reader.result);
      reader.readAsDataURL(file);
    }
  };

  // --- Nâng cấp AI Sourcing: DEEP ID EXTRACTION & SAFETY ---
  const processSourcing = async () => {
    if (!sourcingImage) return;
    setIsSourcing(true);
    setSourcingResult(null);
    setErrorMessage(null);
    
    try {
      const apiKey = ""; 
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
    } catch (error) {
      console.error("Mapping Error:", error);
      setErrorMessage(`Lỗi xác thực: ${error.message}`);
    } finally {
      setIsSourcing(false);
    }
  };

  const leaderboardData = useMemo(() => {
    const stats = {};
    leads.forEach(lead => {
      if (lead?.assignedTo) {
        const uid = String(lead.assignedTo);
        if (!stats[uid]) stats[uid] = { uid, name: String(lead.assignedToName || 'Sales Agent'), points: 0, interactions: 0, qualified: 0, penalties: 0 };
        stats[uid].points += 2;
        if (lead.lastInteractionAt) {
          stats[uid].interactions += 1;
          stats[uid].points += 10;
        }
        if (lead.status === 'qualified') {
          stats[uid].qualified += 1;
          stats[uid].points += 50;
        }
        if (lead.releaseCount > 0) {
          stats[uid].penalties += Number(lead.releaseCount);
          stats[uid].points -= (Number(lead.releaseCount) * 15);
        }
      }
    });
    return Object.values(stats).sort((a, b) => b.points - a.points);
  }, [leads]);

  const claimLead = async (leadId) => {
    const leadRef = doc(db, 'artifacts', appId, 'public', 'data', 'leads', leadId);
    await updateDoc(leadRef, { 
      assignedTo: user?.uid, 
      assignedToName: `Sales ${user?.uid?.slice(0, 5)}`,
      claimedAt: new Date().toISOString(),
      status: 'pending'
    });
  };

  const logInteraction = async (leadId) => {
    if (!interactionLog.trim()) return;
    const leadRef = doc(db, 'artifacts', appId, 'public', 'data', 'leads', leadId);
    await updateDoc(leadRef, { 
      lastInteractionAt: new Date().toISOString(),
      interactionNote: String(interactionLog),
      status: 'active'
    });
    setInteractionLog('');
    setActiveLeadId(null);
  };

  const updateLeadStatus = async (id, status) => {
    const leadRef = doc(db, 'artifacts', appId, 'public', 'data', 'leads', id);
    await updateDoc(leadRef, { status });
  };

  const SidebarItem = ({ icon: Icon, label, id, active }) => (
    <button 
      onClick={() => { setActiveTab(id); setErrorMessage(null); }}
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${
        active ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'
      }`}
    >
      <Icon size={18} />
      <span className="font-medium text-sm">{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-[#050505] text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-slate-800/50 bg-[#080808] p-6 flex flex-col shrink-0">
        <div className="flex items-center space-x-3 mb-10 px-2">
          <div className="bg-indigo-600 p-2 rounded-lg"><Cpu className="text-white" size={20} /></div>
          <span className="text-xl font-black tracking-tighter uppercase italic">OmniHub <span className="text-indigo-500">AI</span></span>
        </div>

        <nav className="space-y-1.5 flex-1 text-slate-300">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" id="dashboard" active={activeTab === 'dashboard'} />
          <SidebarItem icon={Trophy} label="Leaderboard" id="leaderboard" active={activeTab === 'leaderboard'} />
          <SidebarItem icon={ShoppingBag} label="AI Visual Sourcing" id="sourcing" active={activeTab === 'sourcing'} />
          <SidebarItem icon={Users} label="Lead Intelligence" id="leads" active={activeTab === 'leads'} />
          <SidebarItem icon={Terminal} label="API Docs" id="api" active={activeTab === 'api'} />
        </nav>
      </aside>

      {/* Main Container */}
      <main className="flex-1 overflow-y-auto bg-black pb-20">
        <header className="h-16 border-b border-slate-800/50 flex items-center justify-between px-8 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center gap-2 text-slate-300">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
            <h2 className="text-sm font-bold uppercase tracking-widest italic">Exact Factory Match Engine</h2>
          </div>
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-full border border-slate-800">
                <Target size={14} className="text-amber-500" />
                <span className="text-xs font-black uppercase">KPI Score: {Number(leaderboardData.find(s => s.uid === user?.uid)?.points || 0)}</span>
             </div>
          </div>
        </header>

        <div className="p-8 max-w-6xl mx-auto">
          {errorMessage && (
            <div className="mb-6 bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-red-400 animate-in fade-in">
              <ShieldAlert size={18} className="shrink-0" />
              <p className="text-sm font-medium">{String(errorMessage)}</p>
              <button onClick={() => setErrorMessage(null)} className="ml-auto text-xs underline">Ẩn</button>
            </div>
          )}

          {activeTab === 'sourcing' && (
            <div className="space-y-6 animate-in fade-in duration-500">
              <div className="bg-[#0A0A0A] border border-slate-800/50 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 blur-[120px] rounded-full"></div>
                
                <div className="flex flex-col md:flex-row gap-10">
                  {/* Upload UI */}
                  <div className="md:w-1/3 space-y-4">
                    <div className="border-2 border-dashed border-slate-800 rounded-3xl p-4 aspect-square flex flex-col items-center justify-center relative overflow-hidden bg-black hover:border-indigo-500 transition-all group shadow-inner">
                      {sourcingImage ? (
                        <img src={sourcingImage} className="absolute inset-0 w-full h-full object-cover rounded-2xl" alt="Sourcing" />
                      ) : (
                        <div className="text-center p-6">
                          <Camera size={48} className="text-slate-700 mx-auto mb-4 group-hover:text-indigo-500 transition-colors" />
                          <p className="text-xs text-slate-500 font-black uppercase tracking-widest">Tải ảnh sản phẩm</p>
                        </div>
                      )}
                      <input type="file" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" />
                    </div>
                    <button 
                      onClick={processSourcing}
                      disabled={!sourcingImage || isSourcing}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 shadow-xl transition-all active:scale-95"
                    >
                      {isSourcing ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div> : <ArrowRightLeft size={18} />}
                      {isSourcing ? 'AI đang truy xuất ID...' : 'Định danh xưởng gốc'}
                    </button>
                    {sourcingImage && (
                      <button onClick={() => {setSourcingImage(null); setSourcingResult(null);}} className="w-full text-slate-600 text-[10px] font-black uppercase tracking-widest hover:text-red-500 transition-colors py-2">Hủy mẫu ảnh</button>
                    )}
                  </div>

                  {/* RESULTS */}
                  <div className="flex-1 space-y-6">
                    {!sourcingResult ? (
                      <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-slate-700 border border-slate-800/30 rounded-3xl p-10 bg-black/40 border-dashed">
                        <Box size={56} className="mb-6 opacity-10 animate-pulse" />
                        <div className="text-center">
                          <p className="text-sm font-black uppercase tracking-widest opacity-30 italic">Hệ thống sẵn sàng trích xuất ID sản phẩm</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6 animate-in slide-in-from-right-8 duration-700">
                        {/* Master Source Display */}
                        <div className="bg-gradient-to-br from-slate-900 to-black border border-indigo-500/30 p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                           <div className="flex justify-between items-start mb-6">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                   <span className="bg-emerald-600 text-white text-[9px] font-black px-2 py-0.5 rounded-sm uppercase">Verified Detail Match</span>
                                   <span className="text-indigo-400 font-mono text-[10px] font-bold bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 flex items-center gap-1">
                                      <Hash size={10} /> ID: {String(sourcingResult?.verified_match?.offer_id || 'N/A')}
                                   </span>
                                </div>
                                <h3 className="text-3xl font-black text-white tracking-tighter flex items-center gap-3">
                                  <Factory className="text-indigo-400 shrink-0" size={32} /> {String(sourcingResult?.verified_match?.factory_name_cn || 'Verified Factory')}
                                </h3>
                                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1 italic leading-tight">{String(sourcingResult?.verified_match?.factory_name_vn || '')}</p>
                              </div>
                              <div className="flex flex-col items-end">
                                 <div className="flex items-center gap-1 text-emerald-400 bg-emerald-400/10 px-4 py-2 rounded-2xl border border-emerald-400/20 text-xs font-black shadow-lg">
                                    <Award size={18} /> {Number(sourcingResult?.verified_match?.trust_score || 0)}% ACCURATE
                                 </div>
                              </div>
                           </div>
                           
                           <div className="bg-black/50 p-5 rounded-2xl border border-slate-800/50 mb-8">
                              <p className="text-xs text-slate-300 italic leading-relaxed flex items-start gap-3">
                                <Sparkles size={16} className="text-indigo-400 mt-1 shrink-0" />
                                {String(sourcingResult?.verified_match?.match_reason || 'Link chính xác dựa trên ID sản phẩm thực tế.')}
                              </p>
                           </div>
                           
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <a 
                                href={String(sourcingResult?.verified_match?.direct_url || '#')} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="bg-white text-black hover:bg-indigo-600 hover:text-white py-5 rounded-3xl font-black uppercase tracking-[0.2em] text-sm flex items-center justify-center gap-4 transition-all shadow-[0_10px_30px_rgba(255,255,255,0.1)] group border-2 border-white"
                              >
                                MỞ TRANG ĐẶT HÀNG <ExternalLink size={20} className="group-hover:translate-x-1" />
                              </a>
                              <button 
                                onClick={() => copyToClipboard(String(sourcingResult?.verified_match?.factory_name_cn || ''))}
                                className="bg-slate-900 text-slate-300 hover:text-white py-5 rounded-3xl font-black uppercase tracking-[0.2em] text-sm flex items-center justify-center gap-4 transition-all border border-slate-800 group"
                              >
                                SAO CHÉP TÊN XƯỞNG <Copy size={20} className="group-active:scale-90" />
                              </button>
                           </div>
                        </div>

                        {/* Logistics & Negotiation */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-[#0A0A0A] p-6 rounded-3xl border border-slate-800 shadow-inner flex flex-col justify-between">
                            <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2"><Scale size={14} /> Logistics Spec (Sourcing)</h4>
                            <div className="space-y-4">
                              <div className="flex justify-between items-end border-b border-slate-900 pb-2">
                                <span className="text-[10px] font-bold text-slate-500 uppercase">Cân nặng tịnh</span>
                                <span className="text-xl font-black text-white">{String(sourcingResult?.logistics?.weight || '---')}</span>
                              </div>
                              <div className="flex justify-between items-end border-b border-slate-900 pb-2">
                                <span className="text-[10px] font-bold text-slate-500 uppercase">Sẵn hàng (Stock)</span>
                                <span className="text-sm font-black text-emerald-500">YES</span>
                              </div>
                              <div className="flex justify-between items-end">
                                <span className="text-[10px] font-bold text-slate-500 uppercase">MOQ / Giao hàng</span>
                                <span className="text-sm font-black text-amber-500">{String(sourcingResult?.logistics?.min_order || '---')}</span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-[#0A0A0A] p-6 rounded-3xl border border-slate-800 shadow-inner">
                            <div className="flex justify-between items-center mb-4">
                              <h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em]">Kịch bản chat chốt đơn</h4>
                              <button onClick={() => copyToClipboard(String(sourcingResult?.negotiation_script?.cn || ''))} className="text-[9px] font-black text-indigo-400 hover:text-white transition-colors uppercase">Copy CN</button>
                            </div>
                            <div className="space-y-3">
                              <div className="bg-black/60 p-4 rounded-2xl border border-slate-900 border-l-4 border-l-emerald-500">
                                <p className="text-sm font-mono text-emerald-100 italic leading-relaxed tracking-tight select-all">
                                  {String(sourcingResult?.negotiation_script?.cn || '')}
                                </p>
                              </div>
                              <p className="text-[10px] text-slate-500 italic px-2">Dịch: {String(sourcingResult?.negotiation_script?.vn || '')}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'leads' && (
             <div className="bg-[#0A0A0A] border border-slate-800/50 rounded-2xl overflow-hidden shadow-2xl">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-950/50 text-slate-500 text-[10px] uppercase font-black tracking-widest border-b border-slate-800/50">
                      <th className="px-6 py-5">Intelligence Profile</th>
                      <th className="px-6 py-5">Assignment</th>
                      <th className="px-6 py-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/30">
                    {leads.map(lead => (
                      <tr key={lead?.id || Math.random()} className="hover:bg-indigo-600/[0.02] transition-colors group">
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center font-black text-indigo-500 shadow-lg uppercase">
                              {String(lead?.name?.charAt(0) || '?')}
                            </div>
                            <div>
                              <p className="font-black text-white text-sm group-hover:text-indigo-400 transition-colors">{String(lead?.name || "No Store")}</p>
                              <p className="text-[9px] text-slate-500 uppercase font-bold">{String(lead?.platform || "WEB")}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          {!lead?.assignedTo ? (
                            <span className="text-[10px] text-amber-500 font-black uppercase tracking-tighter bg-amber-500/5 px-2 py-1 rounded border border-amber-500/10">Available Lead</span>
                          ) : (
                            <p className="text-xs font-bold text-slate-300 flex items-center gap-1"><UserCheck size={12} className="text-indigo-500" /> {String(lead?.assignedToName || 'Agent')}</p>
                          )}
                        </td>
                        <td className="px-6 py-5 text-right">
                          {!lead?.assignedTo ? (
                            <button onClick={() => claimLead(lead.id)} className="bg-indigo-600 text-white text-[10px] font-black uppercase px-4 py-2 rounded-lg hover:bg-indigo-700 shadow-lg active:scale-95">Nhận</button>
                          ) : lead.assignedTo === user?.uid && (
                            <button onClick={() => updateLeadStatus(lead.id, 'qualified')} className="bg-emerald-600 text-white text-[9px] font-black uppercase px-4 py-2 rounded-lg hover:bg-indigo-700 transition-all">Chốt</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          )}

          {activeTab === 'leaderboard' && (
            <div className="space-y-4 animate-in fade-in duration-500">
               <h3 className="text-xl font-black uppercase tracking-widest italic mb-6">Sales Performance Hub</h3>
               {leaderboardData.map((sales, idx) => (
                <div key={sales?.uid || idx} className="bg-[#0A0A0A] border border-slate-800/50 p-6 rounded-3xl flex items-center justify-between group">
                  <div className="flex items-center gap-6">
                    <span className="text-3xl font-black text-slate-800 italic w-10">#{idx+1}</span>
                    <p className="font-black text-white group-hover:text-indigo-400 transition-colors text-lg">{String(sales?.name)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-black text-indigo-400">{Number(sales?.points)}</p>
                    <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">KPI Points</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;

Đây là Sourcing(AI buy) => site agent => rule chỉ số => Sup(1) nó còn 1 vài bug chưa route được chính xác xưởng detail kiểm tra và khắc phục giúp tôi 