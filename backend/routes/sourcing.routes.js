/**
 * Sourcing Routes — AI Visual Sourcing Pipeline v2
 * POST /api/sourcing       — image hoặc text search, trả multi-supplier, lưu DB
 * GET  /api/sourcing/history — lịch sử sourcing
 * GET  /api/sourcing/:id    — chi tiết 1 kết quả
 */
const router = require('express').Router();
const { runSourcing } = require('../services/sourcingService');
const database = require('../core/data_store/database');

router.post('/api/sourcing', async (req, res) => {
    try {
        const { imageBase64, mimeType, productName, searchType } = req.body;

        // Validate: cần image HOẶC productName
        if (!imageBase64 && !productName) {
            return res.status(400).json({
                success: false,
                error: 'Cần ít nhất 1 trong 2: ảnh sản phẩm (imageBase64 + mimeType) hoặc tên sản phẩm (productName)'
            });
        }
        if (imageBase64 && !mimeType) {
            return res.status(400).json({ success: false, error: 'imageBase64 cần đi kèm mimeType' });
        }

        const { product, result } = await runSourcing({ imageBase64, mimeType, productName, searchType });

        // Save to DB
        let savedId = null;
        try {
            // Create small thumbnail (first 200 chars of base64 for identification)
            const thumbnail = imageBase64 ? imageBase64.substring(0, 500) : '';

            savedId = database.insertSourcingResult({
                search_query: result.search_query || productName || product.product_name_vn,
                search_type: result.search_type,
                product_name: product.product_name_vn,
                product_name_cn: product.product_name_cn,
                product_name_en: product.product_name_en,
                image_thumbnail: thumbnail,
                suppliers: result.suppliers,
                best_supplier: result.suppliers[0] || {},
                specs: {
                    negotiation_script: result.negotiation_script,
                    qc_checklist: result.qc_checklist,
                    search_urls: result.search_urls,
                },
            });
            console.log(`[Sourcing] 💾 Saved to DB: id=${savedId}`);
        } catch (dbErr) {
            console.error('[Sourcing] DB save failed:', dbErr.message);
        }

        res.json({
            success: true,
            data: {
                ...result,
                id: savedId,
            },
        });
    } catch (err) {
        console.error('[Sourcing] Pipeline lỗi:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/api/sourcing/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const rows = database.getSourcingHistory(limit);

        // Parse JSON fields for frontend
        const history = rows.map(r => ({
            ...r,
            suppliers: JSON.parse(r.suppliers_json || '[]'),
            best_supplier: JSON.parse(r.best_supplier_json || '{}'),
            specs: JSON.parse(r.specs_json || '{}'),
        }));

        res.json({ success: true, data: history });
    } catch (err) {
        console.error('[Sourcing] History error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/api/sourcing/:id', async (req, res) => {
    try {
        const row = database.getSourcingResultById(parseInt(req.params.id));
        if (!row) return res.status(404).json({ success: false, error: 'Not found' });

        res.json({
            success: true,
            data: {
                ...row,
                suppliers: JSON.parse(row.suppliers_json || '[]'),
                best_supplier: JSON.parse(row.best_supplier_json || '{}'),
                specs: JSON.parse(row.specs_json || '{}'),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
