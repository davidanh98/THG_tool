/**
 * Sourcing Routes — AI Visual Sourcing Pipeline
 * POST /api/sourcing — nhận ảnh, trả về supplier data thực từ 1688
 */
const router = require('express').Router();
const { runSourcing } = require('../services/sourcingService');

router.post('/api/sourcing', async (req, res) => {
    try {
        const { imageBase64, mimeType } = req.body;
        if (!imageBase64 || !mimeType) {
            return res.status(400).json({ success: false, error: 'imageBase64 và mimeType là bắt buộc' });
        }

        const result = await runSourcing(imageBase64, mimeType);
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[Sourcing] Pipeline lỗi:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
