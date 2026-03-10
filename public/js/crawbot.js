/**
 * crawbot.js — CrawBot Guide Tab logic
 * Handles: FB login session, agent refresh, learn-messenger triggers
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────
function cwSetStatus(msg, color = '#94a3b8') {
    const el = document.getElementById('cwLoginStatus');
    if (el) { el.textContent = msg; el.style.color = color; }
}

function cwShowToast(msg, type = 'info') {
    if (typeof showToast === 'function') showToast(msg, type);
    else alert(msg);
}

// ─── LOGIN: Sales đăng nhập FB để lưu session ────────────────────────────────
async function cwStartLogin() {
    const salesName = document.getElementById('cwLoginName')?.value?.trim();
    const email = document.getElementById('cwLoginEmail')?.value?.trim();
    const pass = document.getElementById('cwLoginPass')?.value;

    if (!salesName || !email || !pass) {
        cwSetStatus('⚠️ Vui lòng điền đầy đủ tên, email và mật khẩu', '#f59e0b');
        return;
    }

    const btn = document.getElementById('cwLoginBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang xử lý...'; }
    cwSetStatus('🤖 CrawBot đang mở trình duyệt ẩn để đăng nhập...', '#60a5fa');

    try {
        const res = await fetch('/api/agents/fb-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ salesName, email, password: pass }),
        });
        const data = await res.json();

        if (data.success) {
            cwSetStatus('✅ Đăng nhập thành công! Session đã được lưu.', '#4ade80');
            cwShowToast(`✅ ${salesName}: Session FB đã lưu! Giờ có thể bấm "Học từ Messenger"`, 'success');
            document.getElementById('cwLoginPass').value = ''; // clear password
            cwRefreshAgents(); // refresh agent list
        } else {
            cwSetStatus(`❌ ${data.error || 'Đăng nhập thất bại'}`, '#f87171');
            cwShowToast(`❌ Login lỗi: ${data.error}`, 'error');
        }
    } catch (err) {
        cwSetStatus('❌ Lỗi kết nối server', '#f87171');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '🔑 Login &amp; Lưu Session'; }
    }
}

// ─── AGENT REFRESH ────────────────────────────────────────────────────────────
const MODE_LABELS = {
    learning: { text: '📚 Đang học', color: '#fbbf24' },
    active: { text: '✅ Đang hoạt động', color: '#4ade80' },
    paused: { text: '⏸️ Tạm dừng', color: '#94a3b8' },
};

async function cwRefreshAgents() {
    const container = document.getElementById('cwAgentList');
    if (!container) return;

    try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const agents = data.agents;

        // Update mode badges in workflow section
        document.querySelectorAll('.cw-mode-badge').forEach(badge => {
            const name = badge.dataset.name;
            const agent = agents.find(a => a.name === name);
            const label = agent ? (MODE_LABELS[agent.mode] || MODE_LABELS.learning) : MODE_LABELS.learning;
            badge.textContent = label.text;
            badge.style.color = label.color;
        });

        // Render agent cards
        container.innerHTML = agents.map(agent => {
            const modeInfo = MODE_LABELS[agent.mode] || MODE_LABELS.learning;
            const hasSamples = agent.sample_count > 0;
            const lastLearn = agent.last_extracted
                ? new Date(agent.last_extracted).toLocaleDateString('vi-VN')
                : 'Chưa học lần nào';

            return `
            <div style="background:var(--card-bg);border:1px solid var(--border-color);border-radius:12px;padding:18px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <div style="font-weight:600;font-size:1rem;">${agent.name}</div>
                <span style="font-size:0.75rem;padding:3px 10px;background:rgba(0,0,0,0.2);border-radius:20px;color:${modeInfo.color};">${modeInfo.text}</span>
              </div>

              <div style="font-size:0.78rem;opacity:0.6;margin-bottom:12px;">
                📚 ${agent.sample_count} câu mẫu đã học &nbsp;•&nbsp; 🕐 ${lastLearn}
              </div>

              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button onclick="cwLearnMessenger('${agent.name}')"
                  style="flex:1;min-width:100px;padding:7px 10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);color:#a78bfa;border-radius:8px;font-size:0.78rem;cursor:pointer;"
                  title="CrawBot vào Messenger của ${agent.name} để học thêm">
                  📖 Học từ Messenger
                </button>
                <button onclick="cwToggleMode('${agent.name}', '${agent.mode}')"
                  style="flex:1;min-width:90px;padding:7px 10px;background:rgba(${agent.mode === 'active' ? '239,68,68' : '34,197,94'},0.1);border:1px solid rgba(${agent.mode === 'active' ? '239,68,68' : '34,197,94'},0.3);color:${agent.mode === 'active' ? '#f87171' : '#4ade80'};border-radius:8px;font-size:0.78rem;cursor:pointer;">
                  ${agent.mode === 'active' ? '⏸️ Tạm dừng' : '▶️ Bật Active'}
                </button>
              </div>

              ${!hasSamples ? `<div style="margin-top:10px;font-size:0.75rem;padding:8px;background:rgba(251,191,36,0.08);border-radius:6px;color:#fbbf24;">⚠️ Chưa có dữ liệu học. Login FB và bấm "Học từ Messenger" trước.</div>` : ''}
            </div>`;
        }).join('');

    } catch (err) {
        console.error('[CrawBot UI] cwRefreshAgents:', err.message);
        if (container) container.innerHTML = `<div style="padding:20px;opacity:0.5;">❌ Không tải được danh sách agents</div>`;
    }
}

// ─── LEARN MESSENGER (individual) ────────────────────────────────────────────
async function cwLearnMessenger(salesName) {
    cwShowToast(`🤖 CrawBot đang học từ Messenger của ${salesName}... (chạy nền)`, 'info');
    try {
        const res = await fetch(`/api/agents/${encodeURIComponent(salesName)}/learn-messenger`, { method: 'POST' });
        const data = await res.json();
        cwShowToast(data.message || `✅ ${salesName}: Đã trigger learning`, data.success ? 'success' : 'error');
        // Refresh sau 5 giây
        setTimeout(cwRefreshAgents, 5000);
    } catch (err) {
        cwShowToast(`❌ Lỗi: ${err.message}`, 'error');
    }
}

// ─── LEARN ALL ───────────────────────────────────────────────────────────────
async function cwLearnAll() {
    if (!confirm('🌙 Trigger học từ Messenger của TẤT CẢ Sales? (Có thể mất 10-30 phút)')) return;
    try {
        const res = await fetch('/api/agents/learn-all-messengers', { method: 'POST' });
        const data = await res.json();
        cwShowToast(data.message || '✅ Đã trigger nightly learning cho tất cả agents', 'success');
    } catch (err) {
        cwShowToast(`❌ Lỗi: ${err.message}`, 'error');
    }
}

// ─── TOGGLE MODE ─────────────────────────────────────────────────────────────
async function cwToggleMode(salesName, currentMode) {
    const nextMode = currentMode === 'active' ? 'paused' : 'active';
    const confirm_ = currentMode !== 'active' || confirm(`Tắt Agent của ${salesName}? Agent sẽ không tự reply nữa.`);
    if (!confirm_) return;

    try {
        const res = await fetch(`/api/agents/${encodeURIComponent(salesName)}/mode`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: nextMode }),
        });
        const data = await res.json();
        if (data.success) {
            cwShowToast(data.message, 'success');
            cwRefreshAgents();
        } else {
            cwShowToast(`❌ ${data.error}`, 'error');
        }
    } catch (err) {
        cwShowToast(`❌ ${err.message}`, 'error');
    }
}

// ─── Auto-load when tab opens ────────────────────────────────────────────────
// Hooked from app.js switchTab('crawbot')
function onCrawbotTabOpen() {
    cwRefreshAgents();
}
