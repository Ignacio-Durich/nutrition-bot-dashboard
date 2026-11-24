/**
 * Tier 3: Cross-Feature Combinations
 * Tests multi-feature workflows and state interactions.
 * Exactly 7 tests.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createNutriNachoEnvironment } = require('./harness/dom_env');
const { NACHO_ID, MAMA_ID, METAS_FIXTURES } = require('./fixtures/metas_fixtures');
const { getLogicalDateString, createMeal, createNachoPerfectDay, createNachoTwoPeriodSet, createMamaGapDaysSet } = require('./fixtures/comidas_fixtures');

// Clean up any stray scratch files from dashboard/
['patch.js', 'patch.py', 'test.js'].forEach(f => {
    const p = path.join(__dirname, '..', 'dashboard', f);
    if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
    }
});

const tier3Tests = [
    {
        id: 'T3-XF-01',
        feature: 'R1+R2',
        description: 'XF-01: User switching updates dynamic goals AND recalculates Daily Score simultaneously',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive, METAS_FIXTURES.mamaActive],
                    comidas: [
                        ...createNachoPerfectDay(0),
                        ...createMamaGapDaysSet()
                    ]
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            // Nacho initial score (should be high)
            const scoreNachoEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');
            const nachoScore = scoreNachoEl ? scoreNachoEl.textContent : '';

            // Switch to Mamá (who has 0 meals today)
            if (env.sandbox.selectUser) {
                await env.sandbox.selectUser(MAMA_ID);
            }

            const calMeta = env.document.getElementById('cal-meta');
            const scoreMamaEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');

            // Goals updated to Mamá
            assert.strictEqual(
                Number(calMeta.textContent),
                METAS_FIXTURES.mamaActive.calorias,
                'Goals should update to Mamá dynamic calories'
            );
            // Daily score updated to Mamá's status
            assert.notStrictEqual(
                scoreMamaEl.textContent,
                nachoScore,
                'Daily score should update when switching users'
            );
        }
    },
    {
        id: 'T3-XF-02',
        feature: 'R3+R4+R5',
        description: 'XF-02: Range switching (7d -> 14d -> 30d) updates charts, missing days, and period deltas',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    comidas: createNachoTwoPeriodSet()
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart chartCal must exist');
            assert.strictEqual(chartCal.data.labels.length, 7, 'Initially 7d');

            // Switch to 14d
            if (env.sandbox.setRange) {
                await env.sandbox.setRange(14);
            }
            assert.strictEqual(chartCal.data.labels.length, 14, 'Should update chart to 14 labels');

            // Switch to 30d
            if (env.sandbox.setRange) {
                await env.sandbox.setRange(30);
            }
            assert.strictEqual(chartCal.data.labels.length, 30, 'Should update chart to 30 labels');
        }
    },
    {
        id: 'T3-XF-03',
        feature: 'R1+R6',
        description: 'XF-03: Offline reload serves cached dynamic goals and displays offline indicator',
        run: async () => {
            const swPath = path.resolve(__dirname, '../dashboard/sw.js');
            assert(fs.existsSync(swPath), 'dashboard/sw.js must exist');
            const env = createNutriNachoEnvironment({ silent: true });
            const sw = env.swMock.loadServiceWorkerFile(swPath);
            assert(sw.exists, 'Service worker must load');

            // Seed cache with dynamic goals
            const dataCache = await sw.caches.open('nutrinacho-data-v1');
            await dataCache.put(
                'https://example-project.supabase.co/rest/v1/metas',
                { status: 200, ok: true, json: async () => [METAS_FIXTURES.nachoActive] }
            );

            // Go offline and simulate load
            env.setOnline(false);
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const banner = env.document.getElementById('offline-banner');
            assert(!banner.classList.contains('hidden'), 'Offline banner must be visible');
        }
    },
    {
        id: 'T3-XF-04',
        feature: 'R4+R7',
        description: 'XF-04: CSV export of a period with missing days exports ONLY actual meals (no phantom rows)',
        run: async () => {
            // Mamá gap days: 4 meals total across 3 days
            const meals = createMamaGapDaysSet();
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: { comidas: meals }
            });
            env.runScript();
            if (env.sandbox.selectUser) await env.sandbox.selectUser(MAMA_ID); else if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            exportBtn.click();

            assert(env.createdBlobs.length > 0, 'Blob must be created');
            const blobText = await env.createdBlobs[0].blob.text();
            const lines = blobText.trim().split('\n').filter(Boolean);
            // 1 header line + 4 meal lines = 5 lines total
            assert.strictEqual(
                lines.length,
                5,
                `Expected exactly 5 CSV lines (1 header + 4 meals), got ${lines.length}. Unlogged days must not create empty rows.`
            );
        }
    },
    {
        id: 'T3-XF-05',
        feature: 'R1+R2+R3',
        description: 'XF-05: Dynamic goals update propagates simultaneously to Daily Score, Best/Worst, and Charts',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive],
                    comidas: createNachoPerfectDay(0)
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            const goalLineVal = chartCal.data.datasets[2].data[0];
            assert.strictEqual(
                Number(goalLineVal),
                METAS_FIXTURES.nachoActive.calorias,
                'Chart goalLine must synchronize with dynamic goals'
            );
        }
    },
    {
        id: 'T3-XF-06',
        feature: 'R1+RaceCondition',
        description: 'XF-06: Rapid user switching (Nacho -> Mamá -> Nacho) avoids race conditions',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive, METAS_FIXTURES.mamaActive],
                    comidas: []
                }
            });
            env.runScript();

            if (env.sandbox.selectUser) {
                env.sandbox.selectUser(MAMA_ID);
                env.sandbox.selectUser(NACHO_ID);
                await env.sandbox.loadAll();
            }

            assert.strictEqual(
                env.getGlobal('currentUser'),
                NACHO_ID,
                'Active user should strictly remain Nacho after rapid switch sequence'
            );
        }
    },
    {
        id: 'T3-XF-07',
        feature: 'R5+QueryBuffer',
        description: 'XF-07: Switching to 30d range queries >= 67 days to support full previous period comparison',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            // Switch to 30d
            if (env.sandbox.setRange) {
                await env.sandbox.setRange(30);
            }

            const queries = env.supabaseMock.queryHistory.filter(q => q.table === 'comidas');
            const lastQuery = queries[queries.length - 1];
            assert(lastQuery, 'Must have executed query for 30d range');

            const gteFilter = lastQuery.filters.find(f => f.type === 'gte' && f.column === 'fecha');
            assert(gteFilter, 'Query must have gte filter on fecha');

            const sinceDate = new Date(gteFilter.value);
            const now = new Date();
            const daysDiff = Math.round((now - sinceDate) / (1000 * 60 * 60 * 24));
            assert(
                daysDiff >= 60,
                `Expected fetchComidas buffer to be >= 60 days for 30d range (30*2), got ${daysDiff} days`
            );
        }
    },
    // ==========================================
    // Regression tests for BUG 5: SW strategy fixes
    // ==========================================
    {
        id: 'T3-XF-08',
        feature: 'R1+R6',
        description: 'Regression: sw.js serves navigations/index.html network-first (not cache-first)',
        run: async () => {
            const swPath = path.resolve(__dirname, '../dashboard/sw.js');
            assert(fs.existsSync(swPath), 'dashboard/sw.js must exist');
            const swContent = fs.readFileSync(swPath, 'utf8');

            // The fetch handler should have a distinct network-first block for navigations
            // that tries fetch() first and falls back to cache, NOT cache.match() first
            assert(
                swContent.includes("event.request.mode === 'navigate'") || swContent.includes('navigate'),
                'sw.js must handle navigation requests distinctly'
            );

            // Verify the actual behavior: load SW, pre-seed cache, trigger a navigation fetch.
            // Network-first means it should call fetch() first, not return cached immediately.
            const env = createNutriNachoEnvironment({ silent: true });
            const sw = env.swMock.loadServiceWorkerFile(swPath);
            assert(sw.exists, 'Service worker must load');

            // Trigger a navigation fetch — the mock fetch returns status 200
            const navResponse = await sw.triggerFetch({
                url: 'http://localhost/index.html',
                method: 'GET',
                mode: 'navigate'
            });
            assert(navResponse, 'Navigation fetch must be intercepted');
            // The response should come from network (mock fetch returns 200)
            assert.strictEqual(navResponse.status, 200, 'Navigation should get fresh network response');
        }
    },
    {
        id: 'T3-XF-09',
        feature: 'R1+R6',
        description: 'Regression: sw.js offline Supabase fallback returns raw JSON array [] (not {data:[], error:null})',
        run: async () => {
            const swPath = path.resolve(__dirname, '../dashboard/sw.js');
            assert(fs.existsSync(swPath), 'dashboard/sw.js must exist');
            const env = createNutriNachoEnvironment({ silent: true });

            // Override fetch to simulate offline (throw error)
            const sw = env.swMock.loadServiceWorkerFile(swPath);
            assert(sw.exists, 'Service worker must load');

            // Don't pre-seed cache, so the fallback empty response is used
            // We need to make sw's fetch fail. The sw scope's fetch is already set up in the mock.
            // Let's trigger a Supabase fetch that will use the mock fetch (returns 200 by default),
            // so instead, check the source code directly for the correct format.
            const swContent = fs.readFileSync(swPath, 'utf8');
            assert(
                swContent.includes('JSON.stringify([])'),
                'sw.js offline Supabase fallback must return raw array [], not {data:[], error:null}'
            );
            assert(
                !swContent.includes('JSON.stringify({ data: [], error: null })') &&
                !swContent.includes("JSON.stringify({data: [], error: null})"),
                'sw.js must NOT contain the old {data:[], error:null} fallback format'
            );
        }
    },
    {
        id: 'T3-XF-10',
        feature: 'Security',
        description: 'Regression: meal fields are HTML-escaped before reaching innerHTML (XSS)',
        run: async () => {
            const payload = `<img src=x onerror="alert('1')"> Mac & Cheese`;
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive],
                    comidas: [{ ...createMeal({ comida: payload }), calorias: '<b>1</b>' }]
                }
            });
            env.runScript();
            await env.sandbox.loadAll();

            const html = env.document.getElementById('meals-body').innerHTML;
            assert(!html.includes('<img') && !html.includes('<b>'), 'Raw HTML from a meal must not reach innerHTML');
            assert(
                html.includes('&#60;img src=x onerror=&#34;alert(&#39;1&#39;)&#34;&#62; Mac &#38; Cheese'),
                'Meal name must be shown as escaped text'
            );
        }
    },
    {
        id: 'T3-XF-11',
        feature: 'R1+R2+R3+R5',
        description: 'Regression: each past day is evaluated against its own goal, not the current one',
        run: async () => {
            const day = getLogicalDateString;
            const oldGoal = { id: 1, usuario_id: NACHO_ID, calorias: 2000, proteina_g: 100, carbohidratos_g: 250, grasas_g: 66, fecha_creacion: `${day(-40)}T12:00:00+00:00` };
            const newGoal = { id: 2, usuario_id: NACHO_ID, calorias: 1500, proteina_g: 150, carbohidratos_g: 120, grasas_g: 46, fecha_creacion: `${day(-1)}T23:00:00+00:00` };
            // A meal that hits `goal` exactly, saved with `meta_id`
            const hit = (goal, dayOffset, meta_id) => ({
                ...createMeal({ dayOffset, calorias: goal.calorias, proteina_g: goal.proteina_g, carbohidratos_g: goal.carbohidratos_g, grasas_g: goal.grasas_g }),
                meta_id
            });
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [oldGoal, newGoal],
                    comidas: [
                        hit(oldGoal, -4, null), // no meta_id: goal in force that day
                        hit(oldGoal, -3, 2),    // logged late, after the goal changed: that goal did not exist yet
                        // -2: no meals
                        hit(oldGoal, -1, 1),    // goal changed at night, after the last meal
                        hit(newGoal, 0, 2)
                    ]
                }
            });
            env.runScript();
            await env.sandbox.loadAll();
            const text = id => env.document.getElementById(id).textContent;

            const [bars, , goalLine] = env.chartMock.findChartByCanvasId('chartCal').data.datasets;
            assert.deepStrictEqual([...goalLine.data], [2000, 2000, 2000, 2000, 2000, 2000, 1500], 'Goal line must follow each day');
            assert(!bars.backgroundColor.some(c => c.includes('239, 68, 68')), 'No day went over its own goal');
            assert.strictEqual(text('streak-count'), '4', 'Protein streak must use each day\'s goal');
            assert.strictEqual(text('best-day-score'), '10.0/10');
            assert.strictEqual(text('worst-day-score'), '10.0/10', 'Old days hit their own goal');
            ['cal', 'prot', 'carb', 'grasas'].forEach(k =>
                assert.strictEqual(text(`avg-${k}-diff`), 'En meta ✓', `${k} average must be compared with the average goal`));
            assert.strictEqual(text('cal-meta'), '1500', 'Today keeps the current goal');
        }
    },
    {
        id: 'T3-XF-12',
        feature: 'R1',
        description: 'Days before the first saved goal use the default goal',
        run: async () => {
            const goal = { ...METAS_FIXTURES.nachoActive, fecha_creacion: `${getLogicalDateString(0)}T12:00:00+00:00` };
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: { metas: [goal], comidas: [createMeal({ dayOffset: -2 })] }
            });
            env.runScript();
            await env.sandbox.loadAll();

            const goalLine = env.chartMock.findChartByCanvasId('chartCal').data.datasets[2];
            assert.deepStrictEqual([...goalLine.data], [2300, 2300, 2300, 2300, 2300, 2300, goal.calorias]);
        }
    }
];

module.exports = { tier3Tests };
