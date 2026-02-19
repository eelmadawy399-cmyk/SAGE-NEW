// SAGE Egypt - Main App Controller
// Handles UI rendering, mode switching, and EE computation orchestration

var currentMode = 'welcome';
window.mapClickEnabled = false;

// ====== Panel Management ======
function showPanel() {
    document.getElementById('sidePanel').classList.remove('hidden');
}

function hidePanel() {
    document.getElementById('sidePanel').classList.add('hidden');
    setActiveTab('tbMap');
}

function togglePanel() {
    var panel = document.getElementById('sidePanel');
    panel.classList.toggle('hidden');
}

function setPanelTitle(title) {
    document.getElementById('panelTitle').textContent = title;
}

function setPanelContent(html) {
    document.getElementById('panelBody').innerHTML = html;
}

function setActiveTab(id) {
    document.querySelectorAll('.toolbar-btn').forEach(function (btn) {
        btn.classList.remove('active');
    });
    var el = document.getElementById(id);
    if (el) el.classList.add('active');
}

// ====== Mode Switching ======
function switchMode(mode) {
    currentMode = mode;
    window.mapClickEnabled = false;
    showPanel();

    if (mode === 'farmer') {
        setActiveTab('tbFarmer');
        buildFarmerMode();
    } else if (mode === 'researcher') {
        setActiveTab('tbResearcher');
        buildResearcherMode();
    }
}

// ====== Welcome Screen ======
function showWelcome() {
    currentMode = 'welcome';
    setActiveTab('tbHome');
    showPanel();
    setPanelTitle('🌿 SAGE Egypt');
    setPanelContent(
        '<div class="welcome-screen">' +
        '  <div class="welcome-logo">🌿</div>' +
        '  <h1 class="welcome-title">SAGE Egypt</h1>' +
        '  <p class="welcome-subtitle">الخبير الذكي للمعلومات المكانية الزراعية<br>Smart Agricultural Geo-Expert</p>' +
        '  <button class="btn btn-farmer" onclick="switchMode(\'farmer\')">' +
        '    🌾 وضع المزارع<span class="btn-desc">تقرير مبسط وتوصيات لمزرعتك</span>' +
        '  </button>' +
        '  <button class="btn btn-researcher" onclick="switchMode(\'researcher\')">' +
        '    🌍 وضع الباحث<span class="btn-desc">تحليل متقدم وخرائط تفاعلية</span>' +
        '  </button>' +
        '  <div style="margin-top:24px; padding-top:16px; border-top:1px solid #e0e0e0;">' +
        '    <p style="font-size:12px; color:#999;">👨‍🔬 Developer: ELSAYED FAROUK</p>' +
        '    <p style="font-size:11px; color:#bbb;">Faculty of Agriculture, Sohag University</p>' +
        '  </div>' +
        '</div>'
    );
}

// ====== Farmer Mode ======
function buildFarmerMode() {
    setPanelTitle('🌾 وضع المزارع');

    var crops = [
        '--- اختر المحصول (Select Crop) ---',
        'قمح (Wheat)', 'أرز (Rice)', 'ذرة (Maize)', 'قطن (Cotton)',
        'بطاطس (Potatoes)', 'طماطم (Tomato)', 'فول (Fava Bean)',
        'برسيم (Alfalfa/Clover)', 'قصب السكر (Sugarcane)', 'نخيل (Date Palm)',
        'بنجر السكر (Sugar Beet)', 'فول سوداني (Peanuts)',
        'موالح (Citrus)', 'زيتون (Olive)', 'عنب (Grape)',
        'بصل (Onion)', 'ثوم (Garlic)', 'فلفل (Pepper)',
        'باذنجان (Eggplant)', 'خيار (Cucumber)', 'كوسة (Zucchini)',
        'مانجو (Mango)', 'رمان (Pomegranate)', 'تين (Fig)',
        'لم أزرع بعد (Not Planted)',
        'محصول آخر (Other)'
    ];

    var cropOptions = crops.map(function (c) {
        return '<option value="' + c + '">' + c + '</option>';
    }).join('');

    setPanelContent(
        // Step 1: Location
        '<div class="card">' +
        '  <div class="card-title">📍 1. حدد موقع مزرعتك</div>' +
        '  <div class="form-row">' +
        '    <div class="form-group">' +
        '      <label class="form-label">خط العرض (Lat)</label>' +
        '      <input type="number" id="fLat" class="form-control" placeholder="26.55" step="any">' +
        '    </div>' +
        '    <div class="form-group">' +
        '      <label class="form-label">خط الطول (Lng)</label>' +
        '      <input type="number" id="fLng" class="form-control" placeholder="31.69" step="any">' +
        '    </div>' +
        '  </div>' +
        '  <button class="btn btn-outline btn-sm" onclick="enableMapClick()">' +
        '    🗺️ أو حدد من الخريطة' +
        '  </button>' +
        '  <button class="btn btn-outline btn-sm mt-8" onclick="useGPS()">' +
        '    📡 استخدم GPS' +
        '  </button>' +
        '  <div class="form-group mt-8">' +
        '    <label class="form-label">نطاق التحليل (متر)</label>' +
        '    <input type="number" id="fBuffer" class="form-control" value="500" min="100" max="5000">' +
        '  </div>' +
        '</div>' +

        // Step 2: Crop
        '<div class="card">' +
        '  <div class="card-title">🌱 2. اختر المحصول</div>' +
        '  <div class="form-group">' +
        '    <select id="fCrop" class="form-control">' + cropOptions + '</select>' +
        '  </div>' +
        '</div>' +

        // Step 3: Time
        '<div class="card">' +
        '  <div class="card-title">📅 3. توقيت التحليل</div>' +
        '  <div class="toggle-row">' +
        '    <span class="toggle-label">⚡ تحليل فوري (آخر 30 يوم)</span>' +
        '    <input type="checkbox" id="fRealtime" checked>' +
        '  </div>' +
        '  <div id="fDateRange" class="hidden">' +
        '    <div class="form-row">' +
        '      <div class="form-group">' +
        '        <label class="form-label">من</label>' +
        '        <input type="date" id="fStartDate" class="form-control" value="2024-01-01">' +
        '      </div>' +
        '      <div class="form-group">' +
        '        <label class="form-label">إلى</label>' +
        '        <input type="date" id="fEndDate" class="form-control" value="2024-12-31">' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '</div>' +

        // Execute Button
        '<button class="btn btn-execute" onclick="executeFarmerAnalysis()">' +
        '  🚀 بدء التحليل' +
        '</button>' +

        // Status area
        '<div id="fStatus"></div>'
    );

    // Toggle date range
    document.getElementById('fRealtime').addEventListener('change', function () {
        document.getElementById('fDateRange').classList.toggle('hidden', this.checked);
    });
}

// ====== Map Click Handler ======
function enableMapClick() {
    window.mapClickEnabled = true;
    hidePanel();
    showMapToast('📍 انقر على الخريطة لتحديد موقع مزرعتك');
}

function onMapClick(lat, lng) {
    if (!window.mapClickEnabled) return;
    window.mapClickEnabled = false;

    var latInput = document.getElementById('fLat');
    var lngInput = document.getElementById('fLng');
    if (latInput) latInput.value = lat.toFixed(6);
    if (lngInput) lngInput.value = lng.toFixed(6);

    addMarker(lat, lng, '📍 مزرعتك');
    addBufferCircle(lat, lng, parseInt(document.getElementById('fBuffer').value) || 500);
    centerMap(lat, lng, 15);

    showPanel();
    showMapToast('✅ تم تحديد الموقع!');
}

function useGPS() {
    if (!navigator.geolocation) {
        alert('المتصفح لا يدعم GPS');
        return;
    }
    showLoading('جاري تحديد موقعك...');
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            hideLoading();
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            document.getElementById('fLat').value = lat.toFixed(6);
            document.getElementById('fLng').value = lng.toFixed(6);
            addMarker(lat, lng, '📍 موقعك الحالي');
            centerMap(lat, lng, 15);
            showMapToast('✅ تم تحديد موقعك بنجاح!');
        },
        function (err) {
            hideLoading();
            alert('فشل تحديد الموقع: ' + err.message);
        },
        { enableHighAccuracy: true }
    );
}

// ====== Map Toast ======
function showMapToast(msg) {
    var existing = document.getElementById('mapToast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'mapToast';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:12px 20px;border-radius:25px;font-size:14px;z-index:200;box-shadow:0 4px 12px rgba(0,0,0,0.3);white-space:nowrap;font-family:Cairo,sans-serif;';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3000);
}

// ====== Farmer Analysis Execution ======
function executeFarmerAnalysis() {
    var lat = parseFloat(document.getElementById('fLat').value);
    var lng = parseFloat(document.getElementById('fLng').value);
    var buffer = parseInt(document.getElementById('fBuffer').value) || 500;
    var crop = document.getElementById('fCrop').value;

    // Validation
    if (crop === '--- اختر المحصول (Select Crop) ---') {
        showMapToast('⚠️ اختر المحصول أولاً');
        return;
    }
    if (isNaN(lat) || isNaN(lng)) {
        showMapToast('⚠️ حدد موقع المزرعة أولاً');
        return;
    }
    if (lat < 22 || lat > 32 || lng < 24 || lng > 37) {
        showMapToast('⚠️ الإحداثيات خارج حدود مصر!');
    }

    var startDate, endDate;
    if (document.getElementById('fRealtime').checked) {
        var now = new Date();
        var ago = new Date();
        ago.setDate(now.getDate() - 30);
        endDate = now.toISOString().split('T')[0];
        startDate = ago.toISOString().split('T')[0];
    } else {
        startDate = document.getElementById('fStartDate').value;
        endDate = document.getElementById('fEndDate').value;
    }

    // Show loading
    setPanelTitle('🔬 جاري التحليل...');
    setPanelContent(
        '<div style="text-align:center; padding:40px 20px;">' +
        '  <div class="spinner" style="margin:0 auto;"></div>' +
        '  <p id="loading-main-text" style="margin-top:16px; font-weight:600; color:#666;">جاري التحقق من الغطاء الأرضي...</p>' +
        '  <div id="fStatus" style="min-height:20px; margin-top:10px;"></div>' +
        '  <div style="width:100%; bg:#eee; height:4px; border-radius:2px; margin-top:20px; overflow:hidden;">' +
        '    <div id="loading-progress" style="width:10%; height:100%; background:#4CAF50; transition: width 0.3s;"></div>' +
        '  </div>' +
        '  <p style="font-size:11px; color:#999; margin-top:8px;">قد يستغرق هذا 15-30 ثانية</p>' +
        '</div>'
    );

    addMarker(lat, lng, '📍 ' + crop);
    addBufferCircle(lat, lng, buffer);
    centerMap(lat, lng, 15);

    // Create EE geometry
    var farmPoint = ee.Geometry.Point([lng, lat]);
    var farmArea = farmPoint.buffer(buffer);

    // Step 1: Validate location
    var validationStart = startDate;
    var validationEnd = endDate;
    // Use 1 year range for real-time validation
    if (document.getElementById('fRealtime').checked) {
        var yearAgo = new Date();
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        validationStart = yearAgo.toISOString().split('T')[0];
    }

    // Safety Timeout: Show "Skip" button if validation hangs for >5s
    var validationTimeout = setTimeout(function () {
        console.warn('Validation slow, offering skip...');
        updateLoadingStatus('⚠️ التحقق يستغرق وقتاً أطول من المعتاد...');

        // Add Skip Button
        var statusDiv = document.getElementById('fStatus');
        if (statusDiv) {
            statusDiv.innerHTML += '<div style="margin-top:10px;"><button class="btn btn-sm btn-warning" id="btnSkipVal" style="background:#ff9800; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">⏩ تخطي الفحص والبدء فوراً</button></div>';
            document.getElementById('btnSkipVal').onclick = function () {
                clearTimeout(validationTimeout);
                updateLoadingStatus('🚀 تم تخطي الفحص، جاري البدء...');
                runFullAnalysis(farmArea, farmPoint, startDate, endDate, crop, lat, lng, buffer, false, false);
            };
        }
    }, 5000);

    // Auto-proceed if it hangs for >15s
    var autoProceedTimeout = setTimeout(function () {
        if (document.getElementById('btnSkipVal')) {
            document.getElementById('btnSkipVal').click();
        }
    }, 15000);

    var validationStats = validateFarmLocation(farmArea, validationStart, validationEnd);
    validationStats.evaluate(function (vResult, vError) {
        clearTimeout(validationTimeout); // Clear timeout if successful
        clearTimeout(autoProceedTimeout);

        if (vError) {
            console.error('Validation error:', vError);
            // Proceed despite validation error
            runFullAnalysis(farmArea, farmPoint, startDate, endDate, crop, lat, lng, buffer, false, false);
            return;
        }

        // In some EE cases the callback returns null/undefined without explicit error.
        // Avoid breaking on property access and continue with full analysis.
        if (!vResult || typeof vResult !== 'object') {
            console.warn('Validation returned empty result, skipping validation gate.');
            runFullAnalysis(farmArea, farmPoint, startDate, endDate, crop, lat, lng, buffer, false, false);
            return;
        }

        function pickNumber(obj, keys, fallback) {
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (obj[key] !== undefined && obj[key] !== null && !isNaN(obj[key])) {
                    return Number(obj[key]);
                }
            }
            return fallback;
        }

        // Evaluate validation
        var cropsProb = pickNumber(vResult, ['crops_prob', 'crops'], 0);
        var bareProb = pickNumber(vResult, ['bare_prob', 'bare'], 0);
        var builtProb = pickNumber(vResult, ['built_prob', 'built'], 0);
        var ndviMax = pickNumber(vResult, ['ndvi_max', 'NDVI_max'], 0);
        var ndviMin = pickNumber(vResult, ['ndvi_min', 'NDVI_min'], 0);
        var ndviRange = pickNumber(vResult, ['ndvi_range'], Math.max(0, ndviMax - ndviMin));
        var bsiMean = pickNumber(vResult, ['bsi_mean', 'BSI_mean'], 0);
        var ndbiMean = pickNumber(vResult, ['ndbi_mean', 'NDBI_mean'], 0);
        var albedoMean = pickNumber(vResult, ['albedo_mean', 'Albedo_mean'], 0);
        var ndviStdDev = pickNumber(vResult, ['ndvi_stdDev', 'NDVI_stdDev'], 0);

        // Desert detection
        var desertReasons = [];
        if (ndviMax < 0.15) desertReasons.push('NDVI منخفض جداً (' + ndviMax.toFixed(3) + ')');
        if (bsiMean > 0.05) desertReasons.push('BSI مرتفع (' + bsiMean.toFixed(3) + ')');
        if (ndviRange < 0.1) desertReasons.push('لا يوجد تباين موسمي (' + ndviRange.toFixed(3) + ')');
        if (albedoMean > 0.15) desertReasons.push('انعكاسية عالية (' + albedoMean.toFixed(3) + ')');
        if (ndviStdDev < 0.05) desertReasons.push('تجانس مكاني عالي (صحراء موحدة)');

        var isDesert = (desertReasons.length >= 3) || (bareProb > 0.6 && ndviMax < 0.2);
        var isUrban = (builtProb > 0.35) || (ndbiMean > 0.1 && builtProb > cropsProb);
        if (isUrban) isDesert = false;

        if (isDesert) {
            showDesertWarning(desertReasons);
        } else if (isUrban) {
            showUrbanWarning(farmArea, farmPoint, startDate, endDate, crop, lat, lng, buffer);
        } else {
            updateLoadingStatus('✅ موقع زراعي صالح — جاري التحليل...');
            runFullAnalysis(farmArea, farmPoint, startDate, endDate, crop, lat, lng, buffer, false, false);
        }
    });
}

function updateLoadingStatus(msg, percent) {
    var status = document.getElementById('fStatus');
    if (status) status.innerHTML = '<p style="font-size:13px; color:#2E7D32; text-align:center; margin:0;">' + msg + '</p>';

    var mainText = document.getElementById('loading-main-text');
    if (mainText && percent > 20) mainText.textContent = 'جاري تحليل البيانات...';

    var progress = document.getElementById('loading-progress');
    if (progress && percent !== undefined) progress.style.width = percent + '%';
}

function showDesertWarning(reasons) {
    setPanelTitle('🏜️ تنبيه: منطقة صحراوية');
    var reasonsHTML = reasons.map(function (r) { return '<li style="margin:4px 0;font-size:13px;">' + r + '</li>'; }).join('');
    setPanelContent(
        '<div class="card" style="border-left:4px solid #FF8F00;">' +
        '  <div class="card-title" style="color:#E65100;">🏜️ منطقة صحراوية جرداء</div>' +
        '  <p style="font-size:13px; color:#555;">هذا الموقع يقع في منطقة صحراوية غير صالحة للزراعة مباشرة.</p>' +
        '  <ul style="list-style:none;padding:0;margin:12px 0;color:#666;">' + reasonsHTML + '</ul>' +
        '  <div style="padding:10px;background:#FFF3E0;border-radius:8px;margin-top:12px;">' +
        '    <p style="font-weight:600;color:#E65100;margin-bottom:8px;">💡 الخيارات المتاحة:</p>' +
        '    <p style="font-size:13px;color:#555;">🔒 خطة الاستصلاح (Premium)</p>' +
        '  </div>' +
        '</div>' +
        '<button class="btn btn-back" onclick="buildFarmerMode()">🔙 رجوع للإدخال</button>'
    );
}

function showUrbanWarning(farmArea, farmPoint, startDate, endDate, crop, lat, lng, buffer) {
    setPanelTitle('🏙️ تنبيه: منطقة حضرية');
    setPanelContent(
        '<div class="card" style="border-left:4px solid #D32F2F;">' +
        '  <div class="card-title" style="color:#D32F2F;">🏙️ منطقة عمرانية/مباني</div>' +
        '  <p style="font-size:13px; color:#555;">تم رصد منطقة عمرانية في هذا الموقع.</p>' +
        '</div>' +
        '<button class="btn btn-execute" onclick="forceUrbanAnalysis()" style="background:#FF9800;">⚠️ متابعة التقرير الحالي</button>' +
        '<button class="btn btn-back" onclick="buildFarmerMode()">🔙 رجوع</button>'
    );
    // Store params for force-continue
    window._pendingAnalysis = { farmArea: farmArea, farmPoint: farmPoint, startDate: startDate, endDate: endDate, crop: crop, lat: lat, lng: lng, buffer: buffer };
}

function forceUrbanAnalysis() {
    var p = window._pendingAnalysis;
    if (!p) return;
    setPanelContent(
        '<div style="text-align:center; padding:40px 20px;">' +
        '  <div class="spinner" style="margin:0 auto;"></div>' +
        '  <p style="margin-top:16px; font-weight:600; color:#666;">جاري التحليل...</p>' +
        '</div>'
    );
    runFullAnalysis(p.farmArea, p.farmPoint, p.startDate, p.endDate, p.crop, p.lat, p.lng, p.buffer, false, true);
}

// ════════════════════════════════════════════════════════════════
// FULL ANALYSIS ENGINE (Ported from SAGE_FREE.js runReportLogic)
// ════════════════════════════════════════════════════════════════
function runFullAnalysis(farmArea, farmPoint, startDate, endDate, cropType, lat, lng, bufferSize, isBarren, isUrban) {
    var isNotPlanted = (cropType.indexOf('Not Planted') > -1 || cropType.indexOf('لم أزرع') > -1);
    updateLoadingStatus('📥 جاري استدعاء صور الأقمار الصناعية (Sentinel-2)...', 30);

    // Get all data collections
    var s2Col = getS2Collection(startDate, endDate, farmArea);

    s2Col.size().evaluate(function (size) {
        if (size === 0) {
            setPanelTitle('⚠️ خطأ');
            setPanelContent(
                '<div class="card" style="border-left:4px solid #D32F2F;">' +
                '  <p style="color:#D32F2F;font-weight:600;">لا تتوفر صور أقمار صناعية لهذه الفترة!</p>' +
                '  <p style="font-size:13px;color:#666;">جرب توسيع نطاق التاريخ.</p>' +
                '</div>' +
                '<button class="btn btn-back" onclick="buildFarmerMode()">🔙 رجوع</button>'
            );
            return;
        }

        var s2 = s2Col.median().clip(farmArea);
        window.currentS2Image = s2; // Expose for download handler
        window.currentFarmArea = farmArea;

        // Calculate all indices
        var ndvi = indicesDict['NDVI'](s2);
        var evi = indicesDict['EVI'](s2);
        var savi = indicesDict['SAVI'](s2);
        var gci = indicesDict['GCI'](s2);
        var ndmi = indicesDict['NDMI'](s2);
        var ndwi = indicesDict['NDWI'](s2);
        var ndsi = indicesDict['NDSI'](s2);
        var bsi = indicesDict['BSI'](s2);
        var clayRatio = indicesDict['ClayRatio'](s2);
        var ironOxide = indicesDict['IronOxide'](s2);
        var gypsumIndex = indicesDict['GypsumIndex'](s2);
        var carbonateIndex = indicesDict['CarbonateIndex'](s2);
        var esi = indicesDict['ESI'](s2);
        var si3 = indicesDict['SI3'](s2);

        // Climate data
        var era5 = getEra5(startDate, endDate, farmArea);
        var soilMoisture = era5.select('sm_topsoil_m3m3');
        var rootzoneMoisture = era5.select('sm_rootzone_m3m3');

        // LST from Landsat
        var lsCol = getMergedLandsatCollection(startDate, endDate, farmArea);
        var lstMean = lsCol.select('LST').median();

        // VHI
        var vci = ndvi.unitScale(0, 0.8).multiply(100).clamp(0, 100);
        var tci = ee.Image(100).subtract(lstMean.unitScale(15, 50).multiply(100)).clamp(0, 100);
        var vhi = vci.multiply(0.5).add(tci.multiply(0.5));

        // Climate
        var precip = getChirps(startDate, endDate, farmArea);
        var et = getModisET(startDate, endDate, farmArea);

        // SAR + Salinity
        var s1Col = getS1Collection(startDate, endDate, farmArea);
        var s1 = ee.Algorithms.If(s1Col.size().gt(0),
            s1Col.median().clip(farmArea),
            ee.Image([0, 0]).rename(['VV_smoothed', 'VH_smoothed']));
        s1 = ee.Image(s1);
        var advancedEC = estimateSalinity_ML(s2, s1, lstMean, precip, et, dem, slope);

        updateLoadingStatus('🛰️ تم تحميل الصور. جاري معالجة القياسات (20+ Indices)...', 50);

        // Soil data
        var olmImage = getOpenLandMapSoil(farmArea);
        var olmStatsMean = olmImage.select(['Clay_0cm', 'Sand_0cm', 'OC_0cm', 'pH_0cm', 'BulkDens_0cm', 'WC_33kPa'])
            .reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 250, maxPixels: 1e9 });
        var textureMode = olmImage.select('TextureClass')
            .reduceRegion({ reducer: ee.Reducer.mode(), geometry: farmArea, scale: 250, maxPixels: 1e9 });
        var olmSoilProperties = olmStatsMean.combine(textureMode);

        updateLoadingStatus('🏔️ جاري دمج بيانات التربة والمناخ (OpenLandMap & ERA5)...', 70);

        // Compile statistics
        var stats = ee.Dictionary({
            ndvi: ndvi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            evi: evi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            savi: savi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            gci: gci.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            ndmi: ndmi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            ndwi: ndwi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            ndsi: ndsi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            bsi: bsi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            clayRatio: clayRatio.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            ironOxide: ironOxide.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            gypsumIndex: gypsumIndex.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            carbonateIndex: carbonateIndex.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            esi: esi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            si3: si3.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            ec_dsm: advancedEC.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
            sm: soilMoisture.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 11132, maxPixels: 1e9 }),
            smRoot: rootzoneMoisture.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 11132, maxPixels: 1e9 }),
            lst: lstMean.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 30, maxPixels: 1e9 }),
            vhi: vhi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 30, maxPixels: 1e9 }),
            precip: precip.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 5566, maxPixels: 1e9 }),
            et: et.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 500, maxPixels: 1e9 }),
            rh: era5.select('RH').reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 11132, maxPixels: 1e9 }),
            airTemp: era5.select('air_temp_C').reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 11132, maxPixels: 1e9 }),
            windSpeed: era5.select('WindSpeed').reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 11132, maxPixels: 1e9 }),
            olmSoil: olmSoilProperties,
            currentMonth: ee.Number(ee.Date(endDate).get('month'))
        });

        // NDVI Time Series for Chart (Optimized)
        var ndviTimeSeries = s2Col.map(function (img) {
            var mean = indicesDict['NDVI'](img).reduceRegion({
                reducer: ee.Reducer.mean(),
                geometry: farmPoint, // Use point for chart speed
                scale: 10,
                maxPixels: 1e8
            });
            return ee.Feature(null, { NDVI: mean.get('NDVI'), date: img.date().format('YYYY-MM-dd') });
        });

        updateLoadingStatus('📊 جاري توليد التقرير النهائي والرسوم البيانية...', 90);

        // Safety Timeout for full analysis evaluation
        var analysisTimeout = setTimeout(function () {
            updateLoadingStatus('⚠️ التحليل يستغرق وقتاً طويلاً، جاري محاولة العرض...', 95);
        }, 30000);

        // Evaluate all at once
        stats.evaluate(function (result, error) {
            clearTimeout(analysisTimeout);
            if (error) {
                setPanelTitle('⚠️ خطأ');
                setPanelContent('<div class="card"><p style="color:red;">' + error + '</p></div><button class="btn btn-back" onclick="buildFarmerMode()">🔙 رجوع</button>');
                return;
            }
            if (!result) {
                setPanelTitle('⚠️ لا تتوفر بيانات');
                setPanelContent('<div class="card"><p>لا تتوفر بيانات في هذا الموقع</p></div><button class="btn btn-back" onclick="buildFarmerMode()">🔙 رجوع</button>');
                return;
            }

            // Get time series then render
            ndviTimeSeries.aggregate_array('NDVI').evaluate(function (ndviArr) {
                ndviTimeSeries.aggregate_array('date').evaluate(function (dateArr) {
                    renderFullReport(result, cropType, lat, lng, bufferSize, startDate, endDate,
                        ndviArr || [], dateArr || [], isBarren, isUrban, isNotPlanted);
                });
            });
        });

        // Add NDVI layer to map
        addEELayer(ndvi, { min: -0.1, max: 0.8, palette: ['red', 'yellow', 'green', 'darkgreen'] }, 'NDVI');
    });
}

// ════════════════════════════════════════════════════════════════
// RENDER FULL FARMER REPORT (All Sections)
// ════════════════════════════════════════════════════════════════
function renderFullReport(result, cropType, lat, lng, bufferSize, startDate, endDate, ndviArr, dateArr, isBarren, isUrban, isNotPlanted) {
    // Extract all values using safeGet
    var ndviVal = safeGet(result, 'ndvi', 'NDVI', 0);
    var eviVal = safeGet(result, 'evi', 'EVI', 0);
    var saviVal = safeGet(result, 'savi', 'SAVI', 0);
    var ndmiVal = safeGet(result, 'ndmi', 'NDMI', 0);
    var ndsiVal = safeGet(result, 'ndsi', 'NDSI', 0);
    var esiVal = safeGet(result, 'esi', 'ESI', 0.5);
    var si3Val = safeGet(result, 'si3', 'SI3', 0.1);
    var vhiVal = safeGet(result, 'vhi', 'VCI', 50);
    var rhVal = safeGet(result, 'rh', 'RH', 40);
    var airTempVal = safeGet(result, 'airTemp', 'air_temp_C', 25);
    var windSpeedVal = safeGet(result, 'windSpeed', 'WindSpeed', 3);
    var bsiVal = safeGet(result, 'bsi', 'BSI', 0);
    var smVal = safeGet(result, 'sm', 'sm_topsoil_m3m3', null);
    var lstVal = safeGet(result, 'lst', 'LST', 30);
    var etVal = safeGet(result, 'et', 'ET', 5);
    var precipVal = safeGet(result, 'precip', 'Precipitation', 0);

    // EC Real
    var ecRealVal = safeGet(result, 'ec_dsm', 'EC_dSm', -1);
    if (ecRealVal <= 1.05 && ndsiVal > 0.25 && ndviVal < 0.20 && bsiVal > 0.05) {
        ecRealVal = 10.0 + (ndsiVal * 20);
    }
    if (ecRealVal < 0) ecRealVal = 1.0;
    var csiVal = Math.min(1, ecRealVal / 10);

    // Soil data
    var olmClay = safeGet(result, 'olmSoil', 'Clay_0cm', null);
    var olmSand = safeGet(result, 'olmSoil', 'Sand_0cm', null);
    var olmOC = safeGet(result, 'olmSoil', 'OC_0cm', null);
    var olmPH = safeGet(result, 'olmSoil', 'pH_0cm', null);
    var olmBulkDens = safeGet(result, 'olmSoil', 'BulkDens_0cm', null);
    var olmTextureRaw = safeGet(result, 'olmSoil', 'TextureClass', null);
    var hasRealSoilData = (olmClay !== null && olmSand !== null);

    // USDA Texture classification
    var olmSilt = hasRealSoilData ? (100 - olmClay - olmSand) : null;
    if (olmSilt !== null && olmSilt < 0) olmSilt = 0;
    var olmTexture, soilSource;
    if (hasRealSoilData) {
        olmTexture = classifyUSDATexture(olmClay, olmSand);
        soilSource = '🔬 USDA (Clay=' + olmClay.toFixed(0) + '%, Sand=' + olmSand.toFixed(0) + '%)';
    } else if (olmTextureRaw) {
        olmTexture = textureClassNames[Math.round(olmTextureRaw)] || 'غير معروف';
        soilSource = '📡 OpenLandMap';
    } else {
        olmTexture = 'غير معروف';
        soilSource = '⚠️ لا تتوفر بيانات';
    }

    var isLiveBarren = (ndviVal < 0.20) || (bsiVal > 0.25);
    var isInvalidForCrop = isBarren || isUrban || isLiveBarren;
    var currentMonth = (result.currentMonth !== undefined) ? result.currentMonth : (new Date().getMonth() + 1);

    // Compute all recommendations
    var salinity = classifySalinity(ecRealVal);
    var traffic = getTrafficLight(ecRealVal, ndviVal, bsiVal);

    // Moisture composite
    var ndmiNorm = Math.min(1, Math.max(0, (ndmiVal + 0.2) / 0.6));
    var smUsed = smVal !== null ? smVal : 0.2;
    var smNorm = Math.min(1, Math.max(0, (smUsed - 0.05) / 0.35));
    var compositeMoisture = (ndmiNorm * 0.4) + (smNorm * 0.6);
    var droughtRiskVal = 1 - compositeMoisture;

    var healthScore = calculateHealthScore(ndviVal, vhiVal, csiVal, droughtRiskVal, isInvalidForCrop);
    var healthStatus = isInvalidForCrop ? 'أرض غير مستغلة' : (healthScore > 75 ? 'ممتازة' : (healthScore > 55 ? 'جيدة' : (healthScore > 35 ? 'متوسطة' : 'ضعيفة')));
    var healthColor = isInvalidForCrop ? '#D2691E' : (healthScore > 75 ? '#2E7D32' : (healthScore > 55 ? '#43A047' : (healthScore > 35 ? '#F57C00' : '#D32F2F')));

    var dateStr = new Date().toISOString().split('T')[0];

    // ═══════════════ BUILD HTML REPORT ═══════════════
    var html = '<button class="btn btn-back mb-16" onclick="buildFarmerMode()">🔙 رجوع للإدخال</button>';

    // Header
    html += '<div class="report-header" style="text-align:center;padding:16px;background:linear-gradient(135deg,#1B5E20,#388E3C);color:white;border-radius:12px;margin-bottom:12px;">' +
        '<h2 style="margin:0;font-size:20px;">🌾 تقرير المزرعة الذكي</h2></div>';

    // Info box
    html += '<div class="card" style="background:#E8F5E9;">' +
        '<div style="font-size:13px;">📍 ' + lat.toFixed(4) + '°N, ' + lng.toFixed(4) + '°E</div>' +
        '<div style="font-size:13px;">🌱 المحصول: ' + cropType + '</div>' +
        '<div style="font-size:12px;color:#1565C0;margin-top:6px;">📅 ' + dateStr + ' | 🛰️ ' + startDate + ' → ' + endDate + '</div>' +
        '</div>';

    // Traffic Light
    html += '<div style="text-align:center;padding:12px;background:' + traffic.bg + ';border-radius:10px;margin:8px 0;">' +
        '<span style="font-weight:700;font-size:15px;color:' + traffic.color + ';">' + traffic.label + '</span></div>';

    // Irrigation note
    var irrig = calculateIrrigation(olmTexture, lstVal, windSpeedVal, currentMonth, ecRealVal, olmSand, olmClay);
    html += '<div style="font-size:12px;font-weight:600;color:#0277BD;background:#E0F7FA;padding:10px;border-radius:8px;margin:6px 0;">' + irrig.note + '</div>';

    // ═══ 1. Overall Status ═══
    html += cardTitle('🎯', isInvalidForCrop ? 'حالة الأرض' : 'الحالة العامة للمحصول');
    html += statRow('مؤشر الصحة:', isInvalidForCrop ? '---' : healthScore.toFixed(0) + '%', healthColor, healthStatus);
    html += statRow('🏔️ نوع التربة:', olmTexture, '#1976D2', soilSource);

    // ═══ 2. Fertilizer Recommendations ═══
    if (!isInvalidForCrop) {
        html += cardTitle('🧪', 'توصيات التسميد (مخصص للمحصول)');
        var fert = getFertilizerRec(cropType, olmOC, olmPH, olmTexture);
        html += statRow('النيتروجين (N):', fert.N + ' وحدة/فدان', '#1B5E20', 'أضف ' + fert.urea + ' كجم يوريا (' + fert.note + ')');
        html += statRow('الفوسفور (P):', fert.P + ' وحدة/فدان', '#F57F17', 'أضف ' + fert.superPhosphate + ' كجم سوبر فوسفات');
        html += statRow('البوتاسيوم (K):', fert.K + ' وحدة/فدان', '#7B1FA2', 'أضف ' + fert.potassiumSulfate + ' كجم سلفات بوتاسيوم');

        // Expert phenology note
        var expertNote = getExpertNote(cropType, currentMonth);
        if (expertNote) {
            html += '<div style="font-size:13px;color:#1B5E20;font-style:italic;background:#F1F8E9;padding:8px;border:1px solid #C5E1A5;border-radius:6px;margin:6px 0;">' + expertNote + '</div>';
        }
        if (lstVal > 35) {
            html += '<div style="font-size:13px;color:#E65100;background:#FFF3E0;padding:8px;border-radius:6px;margin:6px 0;">⚠️ إجهاد حراري: لا تروِ في وقت الظهيرة!</div>';
        }
    }

    // ═══ 3. Pest & Disease Risk ═══
    html += cardTitle('🐛', 'رصد الأخطار الحيوية (مناخ دقيق)');
    html += statRow('🌪️ حالة الجو:', 'رطوبة: ' + rhVal.toFixed(0) + '% | حرارة: ' + airTempVal.toFixed(1) + '°م', '#333');
    var pest = assessPestRisk(cropType, rhVal, airTempVal);
    html += statRow('🦠 توقعات الأمراض:', pest.risk, pest.color);
    if (pest.color !== 'green') {
        html += '<div style="font-size:13px;color:#D32F2F;margin:4px 8px;font-weight:600;">💡 ' + pest.msg + '</div>';
    }

    // ═══ 4. Salinity & Crop Tolerance ═══
    var tolerance = checkCropSalinityTolerance(cropType, csiVal);
    if (!tolerance.compatible) {
        html += '<div style="font-weight:700;font-size:16px;color:white;background:#D32F2F;padding:12px;margin:10px 0;border-radius:8px;text-align:center;">⛔ تحذير: غير متوافق!</div>';
        html += '<div style="font-size:13px;color:#D32F2F;padding:4px 8px;">محصول "' + cropType + '" لا يتحمل هذا المستوى من الأملاح.</div>';
        html += '<div style="font-size:13px;color:green;font-weight:600;padding:4px 8px;">💡 اختر الشعير أو البنجر أو النخيل.</div>';
    } else if (tolerance.classIndex > 0) {
        html += '<div style="font-size:13px;color:#F57C00;padding:4px 8px;">⚠️ تنبيه ملوحة: التربة بها ملوحة ولكن المحصول يتحملها.</div>';
    }

    // ═══ 5. Operations Manager ═══
    html += cardTitle('🚜', 'مدير العمليات الزراعية');

    // Spraying
    var spray = assessSprayConditions(windSpeedVal, airTempVal);
    html += statRow('🚿 دليل الرش:', spray.canSpray ? 'مسموح ✅' : 'ممنوع ⛔', spray.color, spray.msg);

    // Yield
    if (!isInvalidForCrop && !isNotPlanted) {
        var yieldEst = estimateYield_Simple(ndviVal, cropType);
        html += statRow('⚖️ الإنتاجية المتوقعة:', yieldEst.text, '#2E7D32', yieldEst.status);
    }

    // ═══ 6. Irrigation Scheduler ═══
    if (!isInvalidForCrop) {
        html += cardTitle('🚿', 'جدول الري الذكي');
        html += statRow('نوع التربة:', irrig.soilTypeAr, '#333');
        html += statRow('🕒 الفاصل المقترح:', 'كل ' + irrig.interval + ' أيام', '#0097A7', 'في الظروف الحالية');
        html += statRow('💧 كمية المياه:', irrig.waterAmount, '#333');
        if (droughtRiskVal > 0.6) {
            html += '<div style="font-size:13px;color:red;padding:4px 8px;">⚠️ الأرض جافة جداً! قلّل الفترة بمقدار يوم.</div>';
        }
    }

    // ═══ 7. Leaching Requirement ═══
    if (!isInvalidForCrop && ecRealVal > 2.0 && !isNotPlanted) {
        html += cardTitle('🚿', 'إدارة الملوحة وغسيل التربة');
        html += '<div style="font-size:12px;font-weight:600;color:#D32F2F;padding:4px 8px;">ملوحة التربة: ' + ecRealVal.toFixed(1) + ' dS/m</div>';
        var leach = calculateLeachingReq(ecRealVal, cropType);
        html += statRow('💧 ' + leach.nile.label + ':', 'زيادة ' + leach.nile.minutes + ' دقيقة/ساعة', 'blue', 'لتجنب التملح');
        html += statRow('💧 ' + leach.well.label + ':', 'زيادة ' + leach.well.minutes + ' دقيقة/ساعة', '#F9A825', 'لتجنب التملح');
        if (leach.saline.impossible) {
            html += statRow('💧 ' + leach.saline.label + ':', 'غير مناسب ❌', 'red', 'خطر تملح شديد');
        } else {
            html += statRow('💧 ' + leach.saline.label + ':', 'زيادة ' + leach.saline.minutes + ' دقيقة/ساعة', 'red', 'حذر شديد');
        }
        html += '<div style="font-size:13px;color:#333;padding:6px 8px;">📝 لكل ساعة ري عادية، أضف هذه الدقائق لغسيل الأملاح.</div>';
    }

    // ═══ 8. Warnings ═══
    html += cardTitle('⚠️', 'التحذيرات الفيزيائية');
    var droughtLabel = droughtRiskVal > 0.6 ? '🔴 مرتفع' : (droughtRiskVal > 0.3 ? '🟠 متوسط' : '✅ منخفض');
    var droughtColor = droughtRiskVal > 0.6 ? 'red' : (droughtRiskVal > 0.3 ? 'orange' : 'green');
    html += statRow('💧 خطر الجفاف:', droughtLabel, droughtColor);
    var irrAction = droughtRiskVal > 0.6 ? '⚠️ ري عاجل مكثف' : (droughtRiskVal > 0.3 ? '🟡 ري تكميلي' : '✅ ري مستقر');
    html += statRow('🚿 إجراء الري:', irrAction, droughtColor);
    html += statRow('🧂 ملوحة التربة (EC):', ecRealVal.toFixed(1) + ' dS/m', ecRealVal > 8 ? 'red' : (ecRealVal > 4 ? 'orange' : 'green'));
    html += statRow('🌡️ حرارة التربة:', lstVal.toFixed(1) + '°C', lstVal > 38 ? 'orange' : 'green');

    // ═══ 9. NDVI Chart ═══
    html += '<div class="card"><div class="card-title">📈 تطور الغطاء النباتي</div>' +
        '<div class="chart-container"><canvas id="ndviChart"></canvas></div></div>';

    // ═══ 10. Detailed Soil Report (PREMIUM) ═══
    html += '<div class="card" style="border: 1px solid #ddd; background: #fff;">' +
        '  <div style="background: #f0f0f0; padding: 10px; cursor: pointer; font-weight: 700; display: flex; justify-content: space-between;" onclick="togglePremiumSection(\'soil-report-detail\')">' +
        '    <span>🏔️ 8. تقرير التربة التفصيلي</span>' +
        '    <span id="soil-report-detail-icon">▸</span>' +
        '  </div>' +
        '  <div id="soil-report-detail" style="display: none; padding: 10px; border-top: 1px solid #eee; font-size: 13px;">';

    // Soil Data Content
    html += '<div style="font-weight: 700; border-bottom: 2px solid #4CAF50; margin-bottom: 10px; padding-bottom: 4px;">🏔️ نوع التربة المكتشف</div>';
    var unifiedTexture = classifyUSDATexture(olmClay || 0, olmSand || 0);
    html += '<div style="margin: 5px 0;"><strong>النوع:</strong> ' + unifiedTexture + '</div>';

    if (olmClay !== null) {
        html += '<div style="background: #f9f9f9; padding: 8px; border-radius: 6px; margin: 10px 0;">' +
            '  <div style="font-weight: 700; margin-bottom: 6px;">📊 المكونات الفيزيائية:</div>' +
            '  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">' +
            '    <span>🧱 طين: ' + olmClay.toFixed(1) + '%</span>' +
            '    <span>🏖️ رمل: ' + olmSand.toFixed(1) + '%</span>' +
            '    <span>🌾 سلت: ' + (100 - olmClay - olmSand).toFixed(1) + '%</span>' +
            '    <span>⚗️ pH: ' + (olmPH ? olmPH.toFixed(1) : 'ن/أ') + '</span>' +
            '  </div>' +
            '</div>';
    }

    // Expert Recommendations
    html += '<div style="font-weight: 700; color: #2E7D32; margin-top: 15px;">📋 خطة إصلاح التربة (Expert Fixes):</div>';
    var soilRecs = [];
    if (csiVal > 0.3) {
        var gypsumTons = (csiVal * 4).toFixed(1);
        soilRecs.push('• إضافة ' + gypsumTons + ' طن/فدان جبس زراعي');
        soilRecs.push('• غسيل التربة بمياه عذبة');
    }
    if (olmPH > 8.2) {
        soilRecs.push('• إضافة 200 كجم كبريت زراعي خشن');
        soilRecs.push('• استخدم أسمدة حامضية (سلفات النشادر)');
    }
    if (soilRecs.length === 0) soilRecs.push('✅ التربة في حالة جيدة مستقرة.');

    soilRecs.forEach(function (rec) {
        html += '<div style="margin: 4px 0; font-weight: 600;">' + rec + '</div>';
    });

    html += '  </div>' +
        '</div>';

    // ═══ 11. Suggested Crops (PREMIUM) ═══
    html += '<div class="card" style="border: 1px solid #ddd; background: #fff;">' +
        '  <div style="background: #e8f5e9; padding: 10px; cursor: pointer; font-weight: 700; display: flex; justify-content: space-between;" onclick="togglePremiumSection(\'crop-suggestions\')">' +
        '    <span>🌽 9. المحاصيل المقترحة</span>' +
        '    <span id="crop-suggestions-icon">▸</span>' +
        '  </div>' +
        '  <div id="crop-suggestions" style="display: none; padding: 10px; border-top: 1px solid #eee; font-size: 13px;">';

    var recs = [];
    if (ecRealVal > 8) recs.push('🌾 شعير (Barley)');
    if (ecRealVal > 7) recs.push('🍬 بنجر السكر (Sugar Beet)');
    if (ecRealVal > 6) recs.push('🌴 نخيل البلح (Date Palm)');
    if (ecRealVal <= 6 && ecRealVal > 2) recs.push('🍞 قمح (Wheat)');
    if (ecRealVal < 4) recs.push('🍅 طماطم (Tomato)');
    if (ecRealVal < 2) recs.push('🌽 ذرة (Maize)');

    if (olmSand > 70) recs.push('🥜 فول سوداني (Peanuts)');
    if (olmSand > 60) recs.push(' potatoes (بطاطس)');
    if (olmSand > 50) recs.push('🍉 بطيخ (Watermelon)');
    if (olmClay > 35) recs.push('👕 قطن (Cotton)');
    if (olmClay > 40) recs.push('🍚 أرز (Rice)');

    recs = [...new Set(recs)]; // Distinct
    recs.forEach(function (r) {
        html += '<div style="background:#F1F8E9; padding:6px; border-radius:6px; margin:3px 0; border-right:3px solid #4CAF50;">' + r + '</div>';
    });

    if (olmPH > 8.0) {
        html += '<div style="color:#D32F2F; margin-top:10px; font-weight:bold;">⚠️ ملاحظة: قلوية عالية - ينصح بإضافة الجبس الزراعي</div>';
    }

    html += '  </div>' +
        '</div>';

    // ═══ 12. Desert Reclamation Plan (PREMIUM) ═══
    html += '<div class="card" style="border: 1px solid #ddd; background: #fff;">' +
        '  <div style="background: #FFF3E0; padding: 10px; cursor: pointer; font-weight: 700; display: flex; justify-content: space-between;" onclick="togglePremiumSection(\'reclamation-plan\')">' +
        '    <span>🚜 10. خطة استصلاح الأراضي</span>' +
        '    <span id="reclamation-plan-icon">▸</span>' +
        '  </div>' +
        '  <div id="reclamation-plan" style="display: none; padding: 10px; border-top: 1px solid #eee; font-size: 13px;">' +
        '    <div style="color:#E65100; font-weight:bold; margin-bottom:5px;">📍 المرحلة 1: التجهيز الأولي (3-6 أشهر)</div>' +
        '    <div>• تحليل تربة مخبري شامل</div>' +
        '    <div>• تسوية الأرض وإزالة الصخور</div>' +
        '    <div>• حفر بئر أو توصيل مصدر مياه</div>' +
        '    <div style="color:#E65100; font-weight:bold; margin:10px 0 5px 0;">📍 المرحلة 2: تحسين التربة (6-12 شهر)</div>' +
        '    <div>• إضافة 20-30 م³/فدان سماد بلدي متحلل</div>' +
        '    <div>• إضافة الجبس الزراعي أو الكبريت</div>' +
        '    <div>• حرث عميق (40-60 سم) وتقليب</div>' +
        '    <div style="color:#D32F2F; font-weight:bold; margin-top:10px;">💰 التكلفة: 15,000 - 25,000 ج/فدان</div>' +
        '  </div>' +
        '</div>';

    // ═══ 12. Notes ═══
    html += '<div style="padding:10px;background:#f5f5f5;border-radius:8px;margin:10px 0;font-size:12px;color:#777;">' +
        '📝 هذا التقرير مبني على تحليل صور الأقمار الصناعية. دقة التقديرات: 70-90%.</div>';

    // ═══ Map Export ═══
    html += '<button id="btn-download-map" class="btn" style="width:100%;background:#607D8B;color:white;margin:8px 0;padding:10px;" onclick="downloadFarmMap()">📥 تحميل صورة المزرعة (Download Map)</button>';

    setPanelTitle('📊 التقرير الزراعي (نسخة كاملة)');
    setPanelContent(html);

    // Draw chart
    if (dateArr && dateArr.length > 0) {
        setTimeout(function () {
            var ctx = document.getElementById('ndviChart');
            if (ctx) {
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: dateArr,
                        datasets: [{
                            label: 'NDVI',
                            data: ndviArr,
                            borderColor: '#4CAF50',
                            backgroundColor: 'rgba(76,175,80,0.1)',
                            fill: true, tension: 0.3, pointRadius: 3
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            y: { min: 0, max: 1, title: { display: true, text: 'NDVI' } },
                            x: { ticks: { maxTicksToAutoSkip: true, maxRotation: 45 } }
                        }
                    }
                });
            }
        }, 200);
    }
}

// ════════════════════════════════════════════════════════════════
// HTML HELPER FUNCTIONS (Report UI Components)
// ════════════════════════════════════════════════════════════════

function cardTitle(emoji, title) {
    return '<div style="font-weight:700;font-size:15px;color:#333;background:#f0f0f0;padding:10px;text-align:center;margin:14px 0 6px 0;border:1px solid #ddd;border-radius:8px;">' +
        emoji + ' ' + title + '</div>';
}

function statRow(name, value, color, note) {
    var html = '<div style="display:flex;align-items:center;padding:6px 8px;margin:3px 0;background:#f9f9f9;border-radius:6px;gap:8px;">' +
        '<span style="font-size:13px;font-weight:600;flex:1;">' + name + '</span>' +
        '<span style="font-size:14px;font-weight:700;color:' + (color || '#333') + ';">' + value + '</span>';
    if (note) html += '<span style="font-size:11px;color:#888;font-style:italic;max-width:140px;">' + note + '</span>';
    html += '</div>';
    return html;
}

// ====== Researcher Mode Implementation ======
function buildResearcherMode() {
    setPanelTitle('🌍 وضع الباحث (Researcher Mode)');

    var html = '<div class="card">' +
        '  <div class="card-title">1) النطاق الجغرافي</div>' +
        '  <p style="font-size:12px;color:#666;">اختر المحافظة أو ارسم منطقة الدراسة:</p>' +
        '  <select id="gov-select" class="form-select" style="width:100%;margin-bottom:10px;" onchange="handleGovChange()">' +
        '    <option value="">-- اختر المحافظة --</option>' +
        '  </select>' +
        '</div>';

    html += '<div class="card">' +
        '  <div class="card-title">2) الفترة الزمنية والمستشعر</div>' +
        '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">' +
        '    <div style="font-size:12px;">من:<input type="date" id="research-start" value="2024-01-01" style="width:100%;"></div>' +
        '    <div style="font-size:12px;">إلى:<input type="date" id="research-end" value="2024-12-31" style="width:100%;"></div>' +
        '  </div>' +
        '  <select id="sensor-select" class="form-select" style="width:100%;">' +
        '    <option value="Sentinel-2">Sentinel-2 (10m)</option>' +
        '    <option value="Landsat 8">Landsat 8 (30m)</option>' +
        '    <option value="Landsat 7">Landsat 7 (30m)</option>' +
        '    <option value="Landsat 5">Landsat 5 (30m)</option>' +
        '  </select>' +
        '</div>';

    html += '<div class="card">' +
        '  <div class="card-title">3) تحليل المؤشرات (Indices)</div>' +
        '  <select id="index-select" class="form-select" style="width:100%;margin-bottom:10px;">';

    // Add indices from ee-computations.js
    var indices = [
        'NDVI', 'EVI', 'SAVI', 'NDMI', 'GCI', 'NDWI', 'MNDWI', 'NDBI', 'BSI',
        'NBR', 'NDSI', 'ClayRatio', 'IronOxide', 'GypsumIndex', 'CarbonateIndex',
        'ESI', 'SI3', 'SOM', 'Turbidity', 'Chlorophyll-a'
    ];
    indices.forEach(function (idx) {
        html += '<option value="' + idx + '">' + idx + '</option>';
    });

    html += '  </select>' +
        '  <button class="btn" style="width:100%;background:#4CAF50;color:white;" onclick="runResearcherAnalysis(\'update-layer\')">🔄 تحديث الطبقة (Update Layer)</button>' +
        '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">' +
        '    <button class="btn" style="background:#2196F3;color:white;" onclick="runResearcherAnalysis(\'time-series\')">📈 Time Series</button>' +
        '    <button class="btn" style="background:#FF9800;color:white;" onclick="runResearcherAnalysis(\'true-color\')">📸 True Color</button>' +
        '  </div>' +
        '</div>';

    html += '<div class="card">' +
        '  <div class="card-title">4) النماذج المتقدمة</div>' +
        '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        '    <button class="btn btn-outline" onclick="runResearcherAnalysis(\'salinity-risk\')">🧂 Salinity Risk</button>' +
        '    <button class="btn btn-outline" onclick="runResearcherAnalysis(\'vhi\')">🌾 VHI Model</button>' +
        '    <button class="btn btn-outline" onclick="runResearcherAnalysis(\'drought\')">🌵 Drought Index</button>' +
        '    <button class="btn btn-outline" onclick="runResearcherAnalysis(\'desert\')">🏜️ Desert Risk</button>' +
        '    <button class="btn btn-outline" onclick="runResearcherAnalysis(\'lst\')">🌡️ Land Temp</button>' +
        '    <button class="btn btn-outline" onclick="runResearcherAnalysis(\'precip\')">🌧️ Precipitation</button>' +
        '  </div>' +
        '</div>';

    html += '<div id="research-stats" class="card" style="display:none;background:#f5f5f5;border:1px dashed #ccc;">' +
        '  <div class="card-title" style="background:#e0e0e0;color:#333;">📊 إحصائيات المنطقة (Stats)</div>' +
        '  <div id="stats-content" style="font-size:12px;padding:5px;"></div>' +
        '</div>';

    html += '<button class="btn btn-back" style="width:100%;margin-top:20px;" onclick="showWelcome()">🔙 رجوع للقائمة الرئيسية</button>';

    setPanelContent(html);

    // Load governorates list
    loadGovernoratesList();
}

// ------ Researcher Helper: Load Governorates ------
function loadGovernoratesList() {
    var adminBoundariesAsset = 'projects/ee-elsayedfarouk/assets/Egypt_GADM_Boundaries';
    var adminBoundaries = ee.FeatureCollection(adminBoundariesAsset);

    adminBoundaries.aggregate_array('NAME_1').distinct().sort().evaluate(function (list, err) {
        var select = document.getElementById('gov-select');
        if (err || !select) return;

        list.forEach(function (name) {
            var opt = document.createElement('option');
            opt.value = name;
            opt.innerText = name;
            select.appendChild(opt);
        });
    });
}

// ------ Researcher Helper: Handle Gov Change ------
function handleGovChange() {
    var govName = document.getElementById('gov-select').value;
    if (!govName) return;

    var adminBoundariesAsset = 'projects/ee-elsayedfarouk/assets/Egypt_GADM_Boundaries';
    var adminBoundaries = ee.FeatureCollection(adminBoundariesAsset);
    var region = adminBoundaries.filter(ee.Filter.eq('NAME_1', govName));

    region.geometry().evaluate(function (geom) {
        if (!geom) return;
        window.currentRegion = ee.Geometry(geom);

        // Zoom and Highlight on Leaflet
        if (window.map) {
            // Since we don't have a direct GEE highlight layer in Leaflet easily without adding to GEE,
            // we just zoom for now. Full parity would involve creating a tiled layer of the highlight.
            // But for the web app, zooming is the primary action.
        }
    });
}

// ------ Researcher Helper: Run Analysis ------
function runResearcherAnalysis(type) {
    if (!window.currentRegion) {
        alert('يرجى اختيار محافظة أولاً!');
        return;
    }

    var start = document.getElementById('research-start').value;
    var end = document.getElementById('research-end').value;
    var sensor = document.getElementById('sensor-select').value;
    var index = document.getElementById('index-select').value;

    showLoading('جاري تحليل البيانات...');

    // 1. Get Base Collection
    var col = getAnyCollection(sensor, start, end, window.currentRegion);

    col.size().evaluate(function (size, err) {
        if (err || size === 0) {
            hideLoading();
            alert('لا توجد صور متوفرة لهذه الفترة / المستشعر!');
            return;
        }

        var result = col.median().clip(window.currentRegion);

        if (type === 'update-layer') {
            var indexImg = indicesDict[index](result);
            var vis = visParamsDict[index] || { min: 0, max: 1 };
            addEELayer(indexImg, vis, 'Researcher_' + index);

            // Calculate stats for the selected index
            var stats = indexImg.reduceRegion({
                reducer: ee.Reducer.mean().combine(ee.Reducer.min(), '', true).combine(ee.Reducer.max(), '', true),
                geometry: window.currentRegion,
                scale: 100,
                maxPixels: 1e8
            });

            stats.evaluate(function (res, err) {
                var statsBox = document.getElementById('research-stats');
                var statsContent = document.getElementById('stats-content');
                if (err || !res) return;

                statsBox.style.display = 'block';
                var key = Object.keys(res)[0]; // Get the first key, e.g., 'mean' or 'bandName_mean'
                var meanKey = key.includes('_') ? key.replace('_min', '').replace('_max', '') : 'mean';

                statsContent.innerHTML =
                    '<div><strong>المؤشر:</strong> ' + index + '</div>' +
                    '<div><strong>المتوسط:</strong> ' + (res[meanKey] || res[key]).toFixed(3) + '</div>' +
                    '<div><strong>الأدنى:</strong> ' + (res[meanKey + '_min'] || 0).toFixed(3) + '</div>' +
                    '<div><strong>الأقصى:</strong> ' + (res[meanKey + '_max'] || 0).toFixed(3) + '</div>';
            });

            alert('تم عرض طبقة: ' + index);
            hideLoading();
        }
        else if (type === 'true-color') {
            var vis = { min: 0, max: 3000, bands: ['RED', 'GREEN', 'BLUE'] };
            if (sensor.indexOf('Landsat') > -1) vis = { min: 0, max: 0.3, bands: ['RED', 'GREEN', 'BLUE'] };
            addEELayer(result, vis, 'TrueColor_' + sensor);
            hideLoading();
        }
        else if (type === 'salinity-risk') {
            // Advanced Salinity Model ML
            var s1 = getS1Collection(start, end, window.currentRegion).median();
            var soil = getOpenLandMapSoil(window.currentRegion);
            var climate = getEra5(start, end, window.currentRegion).median();

            var salinity = estimateSalinity_ML(result, s1, climate.select('temp'), climate.select('precip'), soil.select('clay'), soil.select('sand'));
            addEELayer(salinity, { min: 0, max: 15, palette: ['blue', 'cyan', 'green', 'yellow', 'orange', 'red'] }, 'Salinity_Risk');
            hideLoading();
        }
        else if (type === 'vhi') {
            var vhi = calculateVHI(start, end, window.currentRegion);
            addEELayer(vhi, { min: 0, max: 1, palette: ['red', 'yellow', 'green'] }, 'VHI_Model');
            hideLoading();
        }
        else if (type === 'drought') {
            var drought = calculateDroughtIndex(start, end, window.currentRegion);
            addEELayer(drought, { min: 0, max: 1, palette: ['red', 'orange', 'yellow', 'green'] }, 'Drought_Index');
            hideLoading();
        }
        else if (type === 'desert') {
            var desert = calculateDesertRisk(start, end, window.currentRegion);
            addEELayer(desert, { min: 0, max: 1, palette: ['green', 'yellow', 'orange', 'red'] }, 'Desert_Risk');
            hideLoading();
        }
        else if (type === 'lst') {
            var colLs = getMergedLandsatCollection(start, end, window.currentRegion);
            var lst = colLs.select('LST').median().clip(window.currentRegion);
            addEELayer(lst, { min: 15, max: 50, palette: ['blue', 'white', 'red'] }, 'LST_Temp');
            hideLoading();
        }
        else if (type === 'precip') {
            var precip = getChirps(start, end, window.currentRegion).clip(window.currentRegion);
            addEELayer(precip, { min: 0, max: 500, palette: ['white', 'blue', 'darkblue'] }, 'Precipitation');
            hideLoading();
        }
        else if (type === 'time-series') {
            // Time Series for Researcher Mode
            var indexImgCol = col.map(function (img) {
                return indicesDict[index](img).copyProperties(img, ['system:time_start']);
            });

            var stats = indexImgCol.map(function (img) {
                var mean = img.reduceRegion({
                    reducer: ee.Reducer.mean(),
                    geometry: window.currentRegion,
                    scale: 500,
                    maxPixels: 1e8
                }).get(index);
                return img.set('mean_val', mean);
            }).filter(ee.Filter.notNull(['mean_val']));

            stats.aggregate_array('mean_val').evaluate(function (data) {
                stats.aggregate_array('system:time_start').evaluate(function (dates) {
                    var statsBox = document.getElementById('research-stats');
                    var statsContent = document.getElementById('stats-content');
                    statsBox.style.display = 'block';
                    statsContent.innerHTML = '<h4>📈 Time Series: ' + index + '</h4>' +
                        '<div style="height:150px;"><canvas id="researchChart"></canvas></div>';

                    var dateLabels = dates.map(d => new Date(d).toLocaleDateString());
                    setTimeout(function () {
                        new Chart(document.getElementById('researchChart'), {
                            type: 'line',
                            data: {
                                labels: dateLabels,
                                datasets: [{ label: index, data: data, borderColor: '#4CAF50', fill: false }]
                            },
                            options: { responsive: true, maintainAspectRatio: false }
                        });
                    }, 100);
                    hideLoading();
                });
            });
        }
        else if (type === 'zonal-stats') {
            // Governorate comparison (All Egypt)
            var indexImg = indicesDict[index](result);
            var boundaries = ee.FeatureCollection('projects/ee-elsayedfarouk/assets/Egypt_GADM_Boundaries');

            var zonalResults = indexImg.reduceRegions({
                collection: boundaries,
                reducer: ee.Reducer.mean().setOutputs(['mean']),
                scale: 1000
            });

            zonalResults.sort('mean', false).limit(10).evaluate(function (res, err) {
                if (err || !res) { hideLoading(); alert('Error calculating zonal stats'); return; }
                var statsBox = document.getElementById('research-stats');
                var statsContent = document.getElementById('stats-content');
                statsBox.style.display = 'block';
                var html = '<strong>📊 أعلى 10 محافظات (' + index + '):</strong><br/>';
                res.features.forEach(function (f) {
                    html += '<div>' + f.properties.NAME_1 + ': ' + (f.properties.mean || 0).toFixed(3) + '</div>';
                });
                statsContent.innerHTML = html;
                hideLoading();
            });
        }
        else {
            alert('هذه الميزة سيتم تفعيلها قريباً.');
            hideLoading();
        }
    });
}

// ====== Premium Toggle Handler ======
function togglePremiumSection(id) {
    var content = document.getElementById(id);
    var icon = document.getElementById(id + '-icon');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.innerText = '▾';
    } else {
        content.style.display = 'none';
        icon.innerText = '▸';
    }
}

// ====== Map Download Handler ======
function downloadFarmMap() {
    if (!window.currentS2Image || !window.currentFarmArea) {
        alert('لا توجد صورة متاحة للتحميل!');
        return;
    }

    var btn = document.getElementById('btn-download-map');
    var originalText = btn ? btn.innerText : '📥 تحميل صورة المزرعة';
    if (btn) btn.innerText = '⏳ جاري إنشاء الرابط...';

    // RGB Visualization
    var visParams = { min: 0, max: 3000, bands: ['B4', 'B3', 'B2'] };

    window.currentS2Image.visualize(visParams).getThumbURL({
        'dimensions': 1000,
        'region': window.currentFarmArea,
        'format': 'png'
    }, function (url) {
        if (btn) btn.innerText = originalText;
        if (url) {
            window.open(url, '_blank');
        } else {
            alert('حدث خطأ أثناء إنشاء الصورة.');
        }
    });
}

// ====== Initialization ======
// Initialize Map and Auth
function initApp() {
    console.log('🚀 Initializing App...');
    // Check if ee is defined
    if (typeof ee === 'undefined') {
        console.error('❌ Critical Error: Google Earth Engine client library not loaded!');
        alert('حدث خطأ جسيم: لم يتم تحميل مكتبة Earth Engine.');
        return;
    }

    // Authenticate using the token from config.js or auth.js
    // Assuming handling in separate auth.js, but let's verify here
    // In our setup, auth.js should have run already.

    console.log('🔄 Attempting GEE Initialization...');

    // Check if auth token is present (from auth.js)
    var token = ee.data.getAuthToken();
    if (!token) {
        console.warn('⚠️ No Auth Token found immediately. Checking cookie/storage...');
    }

    ee.initialize(null, null, function () {
        console.log('✅ GEE Initialized Successfully!');
        // Update any UI that needs to know GEE is ready
        var status = document.getElementById('loading-overlay');
        if (status) status.style.display = 'none';

        // Validation Check: Try to print something small
        ee.Image(1).evaluate(function (res, err) {
            if (err) console.error('❌ GEE Test Failed:', err);
            else console.log('✅ GEE Test Passed (1=1):', res);
        });

        // Enable map interaction
        window.mapClickEnabled = true;
    }, function (e) {
        console.error('❌ GEE Initialization Failed:', e);
        alert('فشل الاتصال بجوجل إيرث: ' + e);
    });
}

// Call init on load
window.addEventListener('load', initApp);
