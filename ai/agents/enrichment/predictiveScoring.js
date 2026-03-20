const fs = require('fs');
const path = require('path');
const database = require('../../../backend/core/data_store/database');

const WEIGHTS_FILE = path.join(__dirname, 'weights.json');

/**
 * Predictive Scoring & Conversion Learning Loop
 * 
 * Mục đích: 
 * Khi Sales chuyển status một Account thành "pilot" hoặc "active_customer" (Won Deal),
 * hệ thống này sẽ phân tích các trục điểm của họ để tìm ra "Hình mẫu khách hàng dễ chốt nhất".
 * Từ đó, nó tự động căn chỉnh lại Trọng Số (Weights) thay vì dùng Hardcode (40-30-20-10).
 */
class PredictiveScoring {
    constructor() {
        // Trọng số mặc định (Base Baseline)
        this.defaultWeights = {
            pain: 0.4,
            revenue: 0.3,
            urgency: 0.2,
            switching: 0.1
        };
        this.currentWeights = this.loadWeights();
    }

    loadWeights() {
        try {
            if (fs.existsSync(WEIGHTS_FILE)) {
                return JSON.parse(fs.readFileSync(WEIGHTS_FILE, 'utf8'));
            }
        } catch (e) { }
        return { ...this.defaultWeights };
    }

    saveWeights(weights) {
        fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(weights, null, 2));
        this.currentWeights = weights;
    }

    /**
     * Dùng hàm này thay vì Hardcode trong sisScorer.js
     */
    calculatePriorityScore(scores) {
        const w = this.currentWeights;
        return Math.round(
            (scores.pain_score * w.pain) +
            (scores.revenue_score * w.revenue) +
            (scores.urgency_score * w.urgency) +
            (scores.switching_score * w.switching)
        );
    }

    /**
     * Chạy Vòng lặp Hồi quy (Học máy cơ bản)
     * Average các điểm số của tệp Won Deal để tìm "Trọng tâm"
     */
    runTuningLoop() {
        console.log('[PredictiveScoring] Bắt đầu Vòng lặp Học Máy (Weights Tuning)...');
        const db = database._db;
        if (!db) return;

        // Lấy tất cả khách hàng đã chốt thành công
        const wonDeals = db.prepare(`
            SELECT pain_score, revenue_score, urgency_score, switching_score 
            FROM accounts 
            WHERE status IN ('pilot', 'active_customer')
        `).all();

        if (wonDeals.length < 5) {
            console.log('[PredictiveScoring] Data chưa đủ để Machine Learning (<5 Won Deals). Giữ nguyên trọng số.');
            return;
        }

        // Tính trung bình các trường
        let averages = { pain: 0, revenue: 0, urgency: 0, switching: 0 };
        for (const deal of wonDeals) {
            averages.pain += (deal.pain_score || 0);
            averages.revenue += (deal.revenue_score || 0);
            averages.urgency += (deal.urgency_score || 0);
            averages.switching += (deal.switching_score || 0);
        }

        const count = wonDeals.length;
        averages.pain /= count;
        averages.revenue /= count;
        averages.urgency /= count;
        averages.switching /= count;

        // Tính tỷ lệ phần trăm phân bổ dựa vào trung bình (Softmax / Ratio bias)
        // Những features có điểm TRUNG BÌNH CAO trong Won Deals chứng tỏ nó là yếu tố QUYẾT ĐỊNH
        const totalAvg = averages.pain + averages.revenue + averages.urgency + averages.switching;

        let newWeights = {
            pain: parseFloat((averages.pain / totalAvg).toFixed(2)),
            revenue: parseFloat((averages.revenue / totalAvg).toFixed(2)),
            urgency: parseFloat((averages.urgency / totalAvg).toFixed(2)),
            switching: parseFloat((averages.switching / totalAvg).toFixed(2))
        };

        // Tránh bị 0 hoàn toàn
        for (let key in newWeights) {
            if (newWeights[key] === 0) newWeights[key] = 0.05; // Base minimum
        }

        // Chuẩn hóa lại cho tổng đúng 1.0 (100%)
        let sum = Object.values(newWeights).reduce((a, b) => a + b, 0);
        for (let key in newWeights) {
            newWeights[key] = parseFloat((newWeights[key] / sum).toFixed(2));
        }

        console.log('[PredictiveScoring] Trọng số MỚI sau khi Train Model:', newWeights);
        this.saveWeights(newWeights);

        // Nâng cấp: Cập nhật LẠI toàn bộ Priority Score của các Account CHƯA chốt
        console.log('[PredictiveScoring] Đang re-calculate lại ưu tiên (Priority Score) cho toàn bộ giỏ Leads...');
        const pendingAccounts = db.prepare(`
            SELECT id, pain_score, revenue_score, urgency_score, switching_score 
            FROM accounts 
            WHERE status IN ('new', 'qualified', 'contacted', 'replied')
        `).all();

        const updateStmt = db.prepare('UPDATE accounts SET priority_score = ? WHERE id = ?');

        db.transaction(() => {
            for (const acc of pendingAccounts) {
                const newScore = this.calculatePriorityScore(acc);
                updateStmt.run(newScore, acc.id);
            }
        })();

        console.log(`[PredictiveScoring] Đã tái định tuyến ${pendingAccounts.length} Leads theo ma trận điểm mới!`);
    }
}

module.exports = new PredictiveScoring();
