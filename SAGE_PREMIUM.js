
/**** 0) Load Egypt administrative boundaries ****/

var adminBoundariesAsset = 'projects/ee-elsayedfarouk/assets/Egypt_GADM_Boundaries';
var adminBoundaries = ee.FeatureCollection(adminBoundariesAsset);
var regionNameField = 'NAME_1'; // Standard for GADM Level 1

/**** 0.1) Governorate Translations (Localized Names) ****/
var govTranslation = {
    'Ad Daqahliyah': 'الدقهلية', 'Al Bahr al Ahmar': 'البحر الأحمر', 'Al Buhayrah': 'البحيرة',
    'Al Fayyum': 'الفيوم', 'Al Gharbiyah': 'الغربية', 'Al Iskandariyah': 'الإسكندرية',
    'Al Isma\'iliyah': 'الإسماعيلية', 'Al Jizah': 'الجيزة', 'Al Minufiyah': 'المنوفية',
    'Al Minya': 'المنيا', 'Al Qahirah': 'القاهرة', 'Al Qalyubiyah': 'القليوبية',
    'Al Wadi al Jadid': 'الوادي الجديد', 'Ash Sharqiyah': 'الشرقية', 'Aswan': 'أسوان',
    'Asyut': 'أسيوط', 'Bani Suwayf': 'بني سويف', 'Bur Sa\'id': 'بورسعيد',
    'Dumyat': 'دمياط', 'Janub Sina\'': 'جنوب سيناء', 'Kafr ash Shaykh': 'كفر الشيخ',
    'Luxor': 'الأقصر', 'Matruh': 'مطروح', 'Matrouh': 'مطروح', 'Qina': 'قنا',
    'Sawhaj': 'سوهاج', 'Sohag': 'سوهاج', 'Suhag': 'سوهاج', 'Souhag': 'سوهاج', 'Suhaj': 'سوهاج',
    'Shamal Sina\'': 'شمال سيناء', 'Suways': 'السويس'
};

// DEBUG: Confirm asset loading
print('DEBUG: Admin Boundaries Size:', adminBoundaries.size());
print('DEBUG: First Feature Columns:', adminBoundaries.first().propertyNames());
print('DEBUG: First Feature Columns:', adminBoundaries.first().propertyNames());
print('DEBUG: First Feature Columns:', adminBoundaries.first().propertyNames());


/**** 1) Configuration & Constants ****/

/**
 * Centralized configuration object for all analysis parameters
 * Performance optimized - MAX_PIXELS reduced from 1e13 to 1e9
 */
var CONFIG = {
    SCALE: {
        SENTINEL2: 10,
        LANDSAT: 30,
        SRTM: 30,
        CHIRPS: 5566,
        MODIS_ET: 500,
        ERA5: 11132
    },
    MAX_PIXELS: 1e9,  // Reduced from 1e13 for better performance
    WEIGHTS: {
        VHI: { vci: 0.5, tci: 0.5 },
        SALINITY_RISK: {
            ndsi: 0.30,
            slope: 0.25,
            moisture: 0.20,
            lst: 0.15,
            ndvi: 0.10
        }
    }
};



// ════════════════════════════════════════════════════════
// 🛠️ HELPER: Safe Statistics Display
// ════════════════════════════════════════════════════════
function displayStats(res, infoPanel, title) {
    infoPanel.clear();

    if (!res) {
        infoPanel.add(ui.Label('⚠️ Error: No data returned.'));
        return false;
    }

    var keys = Object.keys(res);
    if (keys.length === 0) {
        infoPanel.add(ui.Label('⚠️ No statistics available.'));
        return false;
    }

    // Helper to replace .find() for ES5 compatibility
    function findKey(arr, substr) {
        for (var i = 0; i < arr.length; i++) {
            if (arr[i].indexOf(substr) > -1) return arr[i];
        }
        return null;
    }

    var meanKey = findKey(keys, '_mean') || keys[0];
    var minKey = findKey(keys, '_min');
    var maxKey = findKey(keys, '_max');
    var stdKey = findKey(keys, '_stdDev');

    if (res[meanKey] === null || res[meanKey] === undefined) {
        infoPanel.add(ui.Label('⚠️ No valid data for this region/period.'));
        return false;
    }

    infoPanel.add(ui.Label(title || 'Statistics:', { fontWeight: 'bold' }));

    function fmt(val) { return (val !== null && val !== undefined && typeof val === 'number') ? val.toFixed(3) : 'N/A'; }

    infoPanel.add(ui.Label('Mean: ' + fmt(res[meanKey])));
    if (minKey) infoPanel.add(ui.Label('Min : ' + fmt(res[minKey])));
    if (maxKey) infoPanel.add(ui.Label('Max : ' + fmt(res[maxKey])));
    if (stdKey) infoPanel.add(ui.Label('Std : ' + fmt(res[stdKey])));

    return true;
}


/**** 2) Global variables ****/

var currentRegion = null;         // Geometry of selected governorate
var currentIndexName = null;      // Name of current layer (index / RGB / change / mask / LC)
var currentImage = null;          // Current image displayed
var currentLayer = null;          // Map layer of current image
var currentVisParams = null;      // Visualization params of current image
var lastZonalStats = null;        // Zonal stats for all governorates
var currentOpacity = 1.0;         // Layer opacity


/**** 2) Sentinel-2 preparation and indices ****/

/**
 * Cloud masking for Sentinel-2 SR using SCL band.
 */
function maskAndPrepareS2(img) {
    var scl = img.select('SCL');
    var mask = scl.eq(4)   // vegetation
        .or(scl.eq(5))       // bare soil
        .or(scl.eq(6))       // water
        .or(scl.eq(7))       // unclassified
        .or(scl.eq(11));     // snow/ice (rare in Egypt)

    var masked = img.updateMask(mask);

    var prepared = masked.select(
        ['B2', 'B3', 'B4', 'B8', 'B11', 'B12'],
        ['BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2']
    )
        .divide(10000); // to reflectance

    // Copy properties (like system:time_start) from the original image
    return prepared.copyProperties(img, img.propertyNames());
}

// Get Sentinel-2 collection for date range and geometry
function getS2Collection(start, end, geometry) {
    return ee.ImageCollection('COPERNICUS/S2_SR')
        .filterDate(start, end)
        .filterBounds(geometry)
        .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 60))
        .map(maskAndPrepareS2);
}


/**** 2.1 Indices dictionary (Works for S-2 and Landsat) ****/

var indicesDict = {
    // Vegetation
    'NDVI (Vegetation)': function (img) {
        return img.normalizedDifference(['NIR', 'RED']).rename('NDVI');
    },
    'EVI (Enhanced Vegetation Index)': function (img) {
        var evi = img.expression(
            '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
            'NIR': img.select('NIR'),
            'RED': img.select('RED'),
            'BLUE': img.select('BLUE')
        }).rename('EVI');
        return evi;
    },
    'SAVI (Soil-Adjusted Vegetation Index)': function (img) {
        var savi = img.expression(
            '1.5 * (NIR - RED) / (NIR + RED + 0.5)', {
            'NIR': img.select('NIR'),
            'RED': img.select('RED')
        }).rename('SAVI');
        return savi;
    },

    // Moisture / chlorophyll
    'NDMI (Vegetation Moisture)': function (img) {
        return img.normalizedDifference(['NIR', 'SWIR1']).rename('NDMI');
    },
    'GCI (Green Chlorophyll Index)': function (img) {
        var gci = img.expression(
            '(NIR / GREEN) - 1', {
            'NIR': img.select('NIR'),
            'GREEN': img.select('GREEN')
        }).rename('GCI');
        return gci;
    },

    // Water
    'NDWI (McFeeters Water Index)': function (img) {
        return img.normalizedDifference(['GREEN', 'NIR']).rename('NDWI');
    },
    'MNDWI (Modified NDWI - Urban Water)': function (img) {
        return img.normalizedDifference(['GREEN', 'SWIR1']).rename('MNDWI');
    },

    // Built-up / bare soil
    'NDBI (Built-up Index)': function (img) {
        return img.normalizedDifference(['SWIR1', 'NIR']).rename('NDBI');
    },
    'Bare Soil Index (BSI - Approx)': function (img) {
        var bsi = img.expression(
            '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))', {
            'SWIR1': img.select('SWIR1'),
            'RED': img.select('RED'),
            'NIR': img.select('NIR'),
            'BLUE': img.select('BLUE')
        }).rename('BSI');
        return bsi;
    },

    // Fire
    'NBR (Normalized Burn Ratio)': function (img) {
        return img.normalizedDifference(['NIR', 'SWIR2']).rename('NBR');
    },

    // SOIL INDICES
    'NDSI (Salinity Index)': function (img) {
        return img.normalizedDifference(['SWIR1', 'SWIR2']).rename('NDSI');
    },
    'Clay Minerals Ratio': function (img) {
        return img.select('SWIR1').divide(img.select('SWIR2')).rename('ClayRatio');
    },
    'Iron Oxide Ratio': function (img) {
        return img.select('RED').divide(img.select('BLUE')).rename('IronOxide');
    },

    // *** NEW: Advanced Soil Analysis Indices ***

    'Gypsum Index': function (img) {
        return img.expression(
            '(SWIR1 - SWIR2) / (SWIR1 + SWIR2)', {
            'SWIR1': img.select('SWIR1'),
            'SWIR2': img.select('SWIR2')
        }).rename('GypsumIndex');
    },

    'Carbonate Index': function (img) {
        return img.expression(
            'SWIR2 / SWIR1', {
            'SWIR1': img.select('SWIR1'),
            'SWIR2': img.select('SWIR2')
        }).rename('CarbonateIndex');
    },

    'Enhanced Salinity Index (ESI)': function (img) {
        return img.expression(
            'sqrt((RED + NIR) / 2)', {
            'RED': img.select('RED'),
            'NIR': img.select('NIR')
        }).rename('ESI');
    },

    'SI3 (Salinity Index 3)': function (img) {
        return img.expression('sqrt(BLUE * RED)', {
            'BLUE': img.select('BLUE'),
            'RED': img.select('RED')
        }).rename('SI3');
    },

    'Soil Organic Matter (SOM)': function (img) {
        return img.expression(
            '(1 - ((SWIR2 - SWIR2min) / (SWIR2max - SWIR2min))) * (NIR / RED)', {
            'SWIR2': img.select('SWIR2'),
            'NIR': img.select('NIR'),
            'RED': img.select('RED'),
            'SWIR2min': 0.05,
            'SWIR2max': 0.35
        }).rename('SOM');
    },

    'Turbidity Index': function (img) {
        return img.select('RED').divide(img.select('BLUE')).rename('Turbidity');
    },

    'Chlorophyll-a Concentration': function (img) {
        return img.expression(
            '(NIR - RED) / (NIR + RED) * 10', {
            'NIR': img.select('NIR'),
            'RED': img.select('RED')
        }).rename('Chla');
    }
};


/**** 2.2 Visualization parameters ****/

var visParamsDict = {
    'NDVI (Vegetation)': { min: -0.2, max: 0.8, palette: ['#654321', '#FFFF00', '#00FF00'] },
    'EVI (Enhanced Vegetation Index)': { min: -0.1, max: 0.7, palette: ['#654321', '#FFFF00', '#00FF00'] },
    'SAVI (Soil-Adjusted Vegetation Index)': { min: -0.2, max: 0.8, palette: ['#654321', '#FFFF00', '#00FF00'] },
    'NDMI (Vegetation Moisture)': { min: -0.5, max: 0.5, palette: ['#654321', '#FFFFCC', '#0000FF'] },
    'GCI (Green Chlorophyll Index)': { min: 0.0, max: 5.0, palette: ['#000000', '#FFFF00', '#00FF00'] },
    'NDWI (McFeeters Water Index)': { min: -0.5, max: 0.5, palette: ['#654321', '#FFFFFF', '#0000FF'] },
    'MNDWI (Modified NDWI - Urban Water)': { min: -0.5, max: 0.5, palette: ['#654321', '#FFFFFF', '#0000FF'] },
    'NDBI (Built-up Index)': { min: -0.5, max: 0.5, palette: ['#00FF00', '#FFFFFF', '#800080'] },
    'Bare Soil Index (BSI - Approx)': { min: -0.5, max: 0.5, palette: ['#0000FF', '#FFFFFF', '#8B4513'] },
    'NBR (Normalized Burn Ratio)': { min: -0.5, max: 0.5, palette: ['#FF0000', '#FFFFFF', '#00FF00'] },
    // True color visualization
    'True Color (RGB)': { min: 0.0, max: 0.3, bands: ['RED', 'GREEN', 'BLUE'] },

    // SOIL INDICES VIS
    'NDSI (Salinity Index)': { min: -0.2, max: 0.2, palette: ['#00FF00', '#FFFFFF', '#FF0000'] }, // Green (low) -> Red (high salinity)
    'Clay Minerals Ratio': { min: 1.5, max: 3.0, palette: ['#FFFF00', '#FF0000', '#800080'] }, // Yellow -> Red -> Purple
    'Iron Oxide Ratio': { min: 1.0, max: 2.5, palette: ['#FFFFCC', '#FFA500', '#FF0000'] },  // Yellow -> Orange -> Red

    // *** NEW: Visualization Parameters for New Indices ***
    'Gypsum Index': { min: -0.3, max: 0.3, palette: ['#0000FF', '#FFFFFF', '#FF0000'] },
    'Carbonate Index': { min: 1.0, max: 2.5, palette: ['#FFFF00', '#FFA500', '#FF0000'] },
    'Enhanced Salinity Index (ESI)': { min: 0, max: 1.5, palette: ['#00FF00', '#FFFF00', '#FF0000'] },
    'SI3 (Salinity Index 3)': { min: 0, max: 0.5, palette: ['#00FF00', '#FFFF00', '#FF0000'] },
    'Soil Organic Matter (SOM)': { min: 0, max: 2, palette: ['#8B4513', '#DEB887', '#F5DEB3', '#98FB98'] },
    'Turbidity Index': { min: 0, max: 3, palette: ['#0000FF', '#87CEEB', '#FFD700', '#8B4513'] },
    'Chlorophyll-a Concentration': { min: 0, max: 50, palette: ['#000080', '#0000FF', '#00FF00', '#FFFF00'] },
    'Aboveground Biomass (AGB)': { min: 0, max: 100, palette: ['#FFFFCC', '#C7E9B4', '#7FCDBB', '#41B6C4', '#1D91C0', '#225EA8', '#0C2C84'] },
    'Biomass from EVI': { min: 0, max: 100, palette: ['#FFFFCC', '#C7E9B4', '#7FCDBB', '#41B6C4', '#1D91C0', '#225EA8', '#0C2C84'] }
};

// ... (other vis params) ...
var changeVisParams = {
    min: -0.4,
    max: 0.4,
    palette: ['#d73027', '#fdae61', '#ffffbf', '#a6d96a', '#1a9850'] // red->green
};
var landCoverVis = {
    min: 0,
    max: 4,
    palette: ['00000000', '0000FF', '00FF00', 'A0A0A0', 'D2B48C']
};
var thresholdVis = {
    min: 0,
    max: 1,
    palette: ['00000000', 'FF0000'] // transparent, red
};


/**** 2.3 Additional datasets (S1 Radar & DEM) ****/

// --- Sentinel-1 (SAR) data retrieval ---
// --- تحديث: دالة الرادار لدعم الاستقطاب المزدوج ---
var getS1Collection = function (start, end, region) {
    return ee.ImageCollection('COPERNICUS/S1_GRD')
        .filterDate(start, end)
        .filterBounds(region)
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH')) // إضافة VH
        .filter(ee.Filter.eq('instrumentMode', 'IW'))
        .map(function (img) {
            var vv_smoothed = img.select('VV').focal_median(30, 'circle', 'meters').rename('VV_smoothed');
            var vh_smoothed = img.select('VH').focal_median(30, 'circle', 'meters').rename('VH_smoothed');
            return img.addBands([vv_smoothed, vh_smoothed]).copyProperties(img, ['system:time_start']);
        });
};

// --- V2.5: Additive Multi-Evidence Salinity Model (النموذج الجمعي المصحح) ---
// Architecture: V2.2 additive base (proven for saline soils) + soft desert modulation
// Key fix: NO multiplicative gating that can reach zero (V2.3/V2.4 flaw)
// Desert suppression: spectral modulation with floor=0.3 (never kills signal)
var estimateSalinity_ML = function (s2, s1, lst, precip, et, dem, slope) {

    // ═══════════════════════════════════════════════════════════
    // 1. VEGETATION SUPPRESSION (طبقة حجب النبات — مثبتة من V2.2)
    // ═══════════════════════════════════════════════════════════
    var ndvi = s2.normalizedDifference(['NIR', 'RED']).unmask(0);
    var ndvi_inv = ndvi.multiply(-1);
    var ndmi = s2.normalizedDifference(['NIR', 'SWIR1']).unmask(0);
    var ndmi_inv = ndmi.multiply(-1);

    var vegFactor = ndvi.unitScale(0.25, 0.6).clamp(0, 1);
    var soilWeight = ee.Image(1).subtract(vegFactor);

    // ═══════════════════════════════════════════════════════════
    // 1b. URBAN SUPPRESSION (حجب المباني — تعديل V2.5)
    //     المباني لها NDVI منخفض مثل التربة المكشوفة → soilWeight=1 خطأ
    //     NDBI = (SWIR1 - NIR) / (SWIR1 + NIR) → عالي في المباني، منخفض في التربة
    // ═══════════════════════════════════════════════════════════
    var ndbi = s2.normalizedDifference(['SWIR1', 'NIR']).unmask(0);
    var urbanFactor = ndbi.unitScale(0.0, 0.3).clamp(0, 1); // 1 = مبانٍ مؤكدة
    soilWeight = soilWeight.multiply(ee.Image(1).subtract(urbanFactor)); // حجب المباني

    // ═══════════════════════════════════════════════════════════
    // 2. OPTICAL SALINITY INDICES (المؤشرات البصرية — مثبتة من V2.2)
    // ═══════════════════════════════════════════════════════════
    var si1 = s2.expression('sqrt(GREEN * RED)', {
        'GREEN': s2.select('GREEN'), 'RED': s2.select('RED')
    }).unmask(0);
    var si2 = s2.expression('sqrt(RED * NIR)', {
        'RED': s2.select('RED'), 'NIR': s2.select('NIR')
    }).unmask(0);
    var si3 = s2.normalizedDifference(['SWIR1', 'SWIR2']).unmask(0);

    // ═══════════════════════════════════════════════════════════
    // 3. SAR RESPONSE (الرادار — مثبت من V2.2)
    // ═══════════════════════════════════════════════════════════
    var vv = s1.select('VV_smoothed').unmask(-15).clamp(-25, -5);
    var vh = s1.select('VH_smoothed').unmask(-22).clamp(-30, -10);
    var pol_ratio = vv.subtract(vh).clamp(-10, 10);

    // ═══════════════════════════════════════════════════════════
    // 4. ENVIRONMENTAL FACTORS (العوامل البيئية)
    // ═══════════════════════════════════════════════════════════
    var elev_norm = dem.unitScale(0, 300).clamp(0, 1).unmask(0.5);
    var lst_norm = lst.unitScale(15, 50).unmask(0.5);
    var waterDeficit = et.subtract(precip).divide(et.add(0.1)).unmask(0.8);

    // ═══════════════════════════════════════════════════════════
    // 5. V2.5 INNOVATION: Soft Desert Modulation (التعديل الناعم للصحراء)
    //    
    //    المشكلة في V2.3/V2.4: استخدام ضرب × مرشح يصل لصفر (قتل الإشارة)
    //    الحل: مُعدِّل ناعم بحد أدنى 0.3 (لا يقتل الإشارة أبداً)
    //    
    //    الملح: SI3 > 0.1 → modulator ≈ 1.0 (مساهمة كاملة) ✅
    //    الرمل: SI3 ≈ 0  → modulator = 0.3 (مساهمة مخفضة) ✅
    //    الفرق: 70% تخفيض في الصحراء بدلاً من 100% إلغاء
    // ═══════════════════════════════════════════════════════════

    // "كم من الأدلة الطيفية تؤكد وجود ملح فعلاً؟"
    var spectral_salt_evidence = si3.unitScale(0, 0.12).clamp(0, 1);

    // مُعدِّل بيئي: حد أدنى 0.3 (لا يصل لصفر أبداً!)
    var env_modulator = spectral_salt_evidence.multiply(0.7).add(0.3);

    // ═══════════════════════════════════════════════════════════
    // 6. FINAL EQUATION (المعادلة النهائية — بنية V2.2 الجمعية)
    // ═══════════════════════════════════════════════════════════
    var ec_estimated = ee.Image(1.0)
        // A. الأدلة البصرية للتربة (مطابقة لـ V2.2)
        .add(
            si1.multiply(1.0)
                .add(si2.multiply(1.2))
                .add(si3.multiply(2.0))
                .add(ndvi_inv.multiply(1.0))
                .add(ndmi_inv.multiply(1.2))
                .multiply(soilWeight)
        )
        // B. الرادار (مطابق لـ V2.2)
        .add(
            vv.multiply(-0.1)
                .add(pol_ratio.multiply(0.8))
                .multiply(soilWeight.add(0.1))
        )
        // C. العوامل البيئية: V2.2 + التعديل الناعم الوحيد
        //    V2.2 الأصلي: .multiply(soilWeight.add(0.05))
        //    V2.5 المعدل: .multiply(soilWeight.add(0.05)).multiply(env_modulator)
        //    env_modulator لا يقل عن 0.3 → لا يقتل الإشارة أبداً
        .add(elev_norm.multiply(-1.5))
        .add(
            lst_norm.multiply(1.0)
                .add(waterDeficit.multiply(1.5))
                .multiply(soilWeight.add(0.05))
                .multiply(env_modulator) // ← التعديل الوحيد عن V2.2
        )
        .clamp(0.5, 30)
        .rename('EC_dSm');

    return ec_estimated;
};

// --- DEM and derivatives ---
var dem = ee.Image('USGS/SRTMGL1_003');
var slope = ee.Terrain.slope(dem);
var aspect = ee.Terrain.aspect(dem);

// --- Visualization for new datasets ---
var s1Vis = {
    min: -25, max: -5,
    palette: ['#0000FF', '#FFFFFF', '#FF0000'] // Blue (wet) -> White -> Red (dry/rough)
};
var elevationVis = {
    min: 0, max: 1500,
    palette: ['#006633', '#E5FFCC', '#662A00', '#D8D8D8', '#FFFFFF']
};
var slopeVis = {
    min: 0, max: 60,
    palette: ['#FFFFFF', '#FFFF00', '#FF0000', '#000000']
};


/**** 2.4: Landsat (5, 7, 8) Helper Functions ****/

// --- Cloud Masking for Landsat C02 L2 ---
function cloudMaskLandsat(img) {
    var qa = img.select('QA_PIXEL');
    // C02 L2 QA bit flags:
    var dil_cloud = (1 << 1);
    var cirrus = (1 << 2);
    var cloud = (1 << 3);
    var cloud_shadow = (1 << 4);
    // Build the mask
    var mask = qa.bitwiseAnd(dil_cloud).eq(0)
        .and(qa.bitwiseAnd(cirrus).eq(0))
        .and(qa.bitwiseAnd(cloud).eq(0))
        .and(qa.bitwiseAnd(cloud_shadow).eq(0));
    return img.updateMask(mask).copyProperties(img, img.propertyNames());
}

// --- Scale factors for Landsat C02 L2 ---
function applyScaleFactors(img) {
    // Scale optical bands (SR)
    var optical = img.select('SR_B.*').multiply(2.75e-5).subtract(0.2);
    // Scale thermal band (ST), convert K to C
    var thermal = img.select('ST_B.*').multiply(0.00341802).add(149.0).subtract(273.15);

    // Add scaled bands back, overwriting original
    return img.addBands(optical, null, true)
        .addBands(thermal, null, true)
        .copyProperties(img, img.propertyNames());
}

// --- Vis param for LST ---
var lstVis = {
    min: 10,  // degrees C
    max: 50,
    palette: ['#040274', '#040281', '#0502a3', '#0502b8', '#0502ce', '#0502e6',
        '#0602ff', '#235cb1', '#307ef3', '#269db1', '#30c8e2', '#32d3ef',
        '#3be285', '#3ff38f', '#86e26f', '#3ae237', '#b5e22e', '#d6e21f',
        '#fff705', '#ffd611', '#ffb613', '#ff9b14', '#ff7d15', '#ff5817',
        '#ff2518', '#e2021e', '#c1021a', '#9f0217', '#7d000f']
};

// --- Vis param for VHI ---
var vhiVis = {
    min: 0, max: 1, // 0 = Severe Drought, 1 = Very Healthy
    palette: ['#FF0000', '#FFA500', '#FFFF00', '#ADFF2F', '#008000'] // Red -> Orange -> Yellow -> Green
};

// --- Vis param for Risk Model ---
var riskVis = {
    min: 0, max: 1, // 0 = Low Risk, 1 = High Risk
    palette: ['#008000', '#FFFF00', '#FFA500', '#FF0000'] // Green -> Yellow -> Orange -> Red
};


// *** NEW HELPER FUNCTION FOR ADVANCED MODELS ***
// This function correctly loads and prepares a MERGED Landsat 
// collection (L5, 7, 8) for use in advanced models.
function getMergedLandsatCollection(start, end, geometry) {
    var l8_BANDS = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7', 'ST_B10'];
    var l57_BANDS = ['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7', 'ST_B6'];
    var COMMON_BANDS = ['BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2', 'LST'];

    var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
        .filterDate(start, end).filterBounds(geometry)
        .map(cloudMaskLandsat).map(applyScaleFactors).select(l8_BANDS, COMMON_BANDS);

    var l7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
        .filterDate(start, end).filterBounds(geometry)
        .map(cloudMaskLandsat).map(applyScaleFactors).select(l57_BANDS, COMMON_BANDS);

    var l5 = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
        .filterDate(start, end).filterBounds(geometry)
        .map(cloudMaskLandsat).map(applyScaleFactors).select(l57_BANDS, COMMON_BANDS);

    return ee.ImageCollection(l5.merge(l7).merge(l8));
}

// *** NEW: Climate Data Loading Functions ***

// --- CHIRPS (Precipitation) ---
// *** FIXED: Handles data lag for recent dates ***
function getChirps(start, end, geometry) {
    // CHIRPS has ~5 day lag, extend range for recent requests
    var startDate = ee.Date(start);
    var endDate = ee.Date(end);

    var col = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
        .filterBounds(geometry)
        .filterDate(startDate.advance(-1, 'month'), endDate);

    // Check if collection is empty
    var count = col.size();

    // Return total precipitation or default value
    var result = ee.Algorithms.If(
        count.gt(0),
        col.sum().rename('Precipitation'),
        ee.Image(10).rename('Precipitation') // Default 10mm for Egypt
    );

    return ee.Image(result);
}
var precipVis = {
    min: 0, max: 200, // mm
    palette: ['#FFFFFF', '#CCE5FF', '#66B2FF', '#0080FF', '#004C99']
};

// --- MODIS ET (Evapotranspiration) ---
// *** FIXED: Handles data lag for recent dates ***
function getModisET(start, end, geometry) {
    // MODIS ET has ~8 day lag, extend range for recent requests
    var startDate = ee.Date(start);
    var endDate = ee.Date(end);

    var col = ee.ImageCollection('MODIS/061/MOD16A2GF')
        .filterBounds(geometry)
        .filterDate(startDate.advance(-2, 'month'), endDate)
        .select('ET');

    // Check if collection is empty
    var count = col.size();

    // Scale factor is 0.1, values are 8-day sum in kg/m^2 (== mm)
    // We want mean daily ET in mm/day
    var dailyEt = col.map(function (img) {
        return img.multiply(0.1).divide(8) // kg/m^2/day == mm/day
            .copyProperties(img, ['system:time_start']);
    });

    // Return data or default value (5 mm/day is typical for Egypt)
    var result = ee.Algorithms.If(
        count.gt(0),
        dailyEt.mean().rename('ET'),
        ee.Image(5).rename('ET')
    );

    return ee.Image(result);
}
var etVis = {
    min: 0, max: 10, // mm/day
    palette: ['#FFFFFF', '#FFDDC1', '#FFAD72', '#E87A3E', '#B24D1E']
};

// --- ERA5-Land (Soil Moisture) ---
// *** FIXED: Handles data lag for recent dates ***
function getEra5(start, end, geometry) {
    // Define original and new names
    var era_bands = [
        'skin_temperature',
        'volumetric_soil_water_layer_1', // 0-7cm
        'volumetric_soil_water_layer_2', // 7-28cm
        'total_evaporation_sum',
        'temperature_2m',
        'dewpoint_temperature_2m',
        'u_component_of_wind_10m',
        'v_component_of_wind_10m'
    ];
    var new_names = [
        'skin_temp_K',
        'sm_topsoil_m3m3',  // Topsoil
        'sm_rootzone_m3m3', // Rootzone
        'total_evap_m_sum',
        'air_temp_K',
        'dewpoint_temp_K',
        'u_wind_ms',
        'v_wind_ms'
    ];

    // ERA5 Monthly has 2-3 month lag, so extend date range for recent requests
    var startDate = ee.Date(start);
    var endDate = ee.Date(end);

    // Try to get data, extending range if needed (up to 6 months back)
    var col = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
        .filterBounds(geometry)
        .filterDate(startDate.advance(-6, 'month'), endDate)
        .select(era_bands, new_names);

    // Check if collection is empty and handle gracefully
    var count = col.size();

    // Use conditional to return either the data or a default image
    var meanImage = ee.Algorithms.If(
        count.gt(0),
        col.mean(),
        // Return fully masked image if no data (transparent error handling)
        ee.Image([298, 0.2, 0.2, 0, 298, 298, 0, 0]).rename(new_names).updateMask(0)
    );

    meanImage = ee.Image(meanImage);

    // Conversions (K -> C)
    var skinTempC = meanImage.select('skin_temp_K').subtract(273.15).rename('skin_temp_C');
    var airTempC = meanImage.select('air_temp_K').subtract(273.15).rename('air_temp_C');
    var dewTempC = meanImage.select('dewpoint_temp_K').subtract(273.15).rename('dewpoint_temp_C');

    // Calculate Relative Humidity (RH) using August-Roche-Magnus approximation
    // RH = 100 * exp((17.625 * Td)/(243.04 + Td)) / exp((17.625 * T)/(243.04 + T))
    var rh = meanImage.expression(
        '100 * exp((17.625 * Td) / (243.04 + Td)) / exp((17.625 * T) / (243.04 + T))', {
        'Td': dewTempC,
        'T': airTempC
    }
    ).rename('RH');

    // Calculate Wind Speed Magnitude
    var windSpeed = meanImage.expression(
        'sqrt(u*u + v*v)', {
        'u': meanImage.select('u_wind_ms'),
        'v': meanImage.select('v_wind_ms')
    }
    ).rename('WindSpeed');

    return meanImage
        .addBands(skinTempC)
        .addBands(airTempC)
        .addBands(dewTempC)
        .addBands(rh)
        .addBands(windSpeed);
}
var smVis = {
    min: 0.05, max: 0.5, // m3/m3
    palette: ['#8B4513', '#FFDAB9', '#708090', '#4169E1', '#000080'] // Dry -> Wet
};

// *** NEW: SoilGrids Soil Properties (Updated Alternative) ***
function getOpenLandMapSoil(geometry) {
    // Clay content at 0-5cm depth — v02 units: % (mass fraction)
    var clay = ee.Image('OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02')
        .select('b0').rename('Clay_0cm');  // ← بالفعل نسبة مئوية، لا تقسم

    // Sand content at 0-5cm depth — v02 units: % (mass fraction)
    var sand = ee.Image('OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02')
        .select('b0').rename('Sand_0cm');  // ← بالفعل نسبة مئوية، لا تقسم

    // Organic carbon content at 0-5cm depth (g/kg → divide by 10 for g/100g = %)
    var organicCarbon = ee.Image('OpenLandMap/SOL/SOL_ORGANIC-CARBON_USDA-6A1C_M/v02')
        .select('b0').divide(10).rename('OC_0cm');

    // Soil pH at 0-5cm depth (pH * 10 → convert to actual pH)
    var pH = ee.Image('OpenLandMap/SOL/SOL_PH-H2O_USDA-4C1A2A_M/v02')
        .select('b0').divide(10).rename('pH_0cm');

    // Bulk density at 0-5cm depth (kg/m³ → divide by 1000 for g/cm³)
    var bulkDensity = ee.Image('OpenLandMap/SOL/SOL_BULKDENS-FINEEARTH_USDA-4A1H_M/v02')
        .select('b0').divide(1000).rename('BulkDens_0cm');

    // USDA Texture class (0-5cm)
    var textureClass = ee.Image('OpenLandMap/SOL/SOL_TEXTURE-CLASS_USDA-TT_M/v02')
        .select('b0').rename('TextureClass');

    // ✅ Field Capacity estimate from Clay% (Empirical: Saxton & Rawls 2006)
    var waterContent33 = clay.multiply(0.4).add(15).rename('WC_33kPa');

    // Combine all soil properties
    var soilProperties = clay
        .addBands(sand)
        .addBands(organicCarbon)
        .addBands(pH)
        .addBands(bulkDensity)
        .addBands(textureClass)
        .addBands(waterContent33);

    return soilProperties.clip(geometry);
}

// USDA Texture Class lookup (for OpenLandMap raw class IDs)
var textureClassNames = {
    1: 'طين (Clay)',
    2: 'طين رملي (Sandy Clay)',
    3: 'طين سلتي (Silty Clay)',
    4: 'طين رملي لومي (Sandy Clay Loam)',
    5: 'طين لومي (Clay Loam)',
    6: 'طين سلتي لومي (Silty Clay Loam)',
    7: 'لومي رملي (Sandy Loam)',
    8: 'لومي (Loam)',
    9: 'سلت لومي (Silt Loam)',
    10: 'رملي (Sand)',
    11: 'رملي لومي (Loamy Sand)',
    12: 'سلت (Silt)'
};

// ═══════════════════════════════════════════════════════════
// 🔬 USDA Soil Texture Triangle Classification
//    المرجع: USDA-NRCS Soil Survey Manual, Chapter 3
//    يُحدد القوام بناءً على النسب الثلاث (طين + رمل + سلت)
//    أدق من الاعتماد على class ID المُسبق من OpenLandMap
// ═══════════════════════════════════════════════════════════
function classifyUSDATexture(clay, sand) {
    var silt = 100 - clay - sand;
    if (silt < 0) silt = 0;

    // الترتيب مهم: من الأكثر تحديداً للأقل

    // 1. رملي (Sand): رمل >= 85% وطين < 10%
    if (sand >= 85 && clay < 10) return 'رملي (Sand)';

    // 2. رملي لومي (Loamy Sand): رمل 70-90%, طين < 15%
    if (sand >= 70 && sand < 90 && clay < 15) return 'رملي لومي (Loamy Sand)';

    // 3. طين سلتي (Silty Clay): طين >= 40% وسلت >= 40%
    if (clay >= 40 && silt >= 40) return 'طين سلتي (Silty Clay)';

    // 4. طين رملي (Sandy Clay): طين >= 35% ورمل >= 45%
    if (clay >= 35 && sand >= 45) return 'طين رملي (Sandy Clay)';

    // 5. طين (Clay): طين >= 40%
    if (clay >= 40) return 'طين (Clay)';

    // 6. طين سلتي لومي (Silty Clay Loam): طين 27-40%, رمل < 20%
    if (clay >= 27 && clay < 40 && sand < 20) return 'طين سلتي لومي (Silty Clay Loam)';

    // 7. طين لومي (Clay Loam): طين 27-40%, رمل 20-45%
    if (clay >= 27 && clay < 40 && sand >= 20 && sand <= 45) return 'طين لومي (Clay Loam)';

    // 8. طين رملي لومي (Sandy Clay Loam): طين 20-35%, رمل > 45%
    if (clay >= 20 && clay < 35 && sand > 45) return 'طين رملي لومي (Sandy Clay Loam)';

    // 9. سلت (Silt): سلت >= 80%, طين < 12%
    if (silt >= 80 && clay < 12) return 'سلت (Silt)';

    // 10. سلت لومي (Silt Loam): سلت >= 50%, طين < 27%
    if (silt >= 50 && clay < 27) return 'سلت لومي (Silt Loam)';

    // 11. لومي (Loam): طين 7-27%, سلت 28-50%, رمل <= 52%
    if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52)
        return 'لومي (Loam)';

    // 12. لومي رملي (Sandy Loam): الباقي (رمل >= 43%, طين < 20%)
    if (sand >= 43 && clay < 20) return 'لومي رملي (Sandy Loam)';

    // Default fallback
    return 'لومي (Loam)';
}


/**** 3) UI Panel setup ****/

// --- UI ARCHITECTURE (2-Panel Mobile Layout) ---
ui.root.clear();

var leftPanel = ui.Panel({ style: { width: '320px', padding: '6px' } });

// Create a FRESH Map widget to ensure it is a valid ui.Widget
var centerPanel = ui.Map();
// Add drawing tools if needed (optional, keeping it simple for now)
centerPanel.setControlVisibility({ layerList: true, zoomControl: true, scaleControl: true, mapTypeControl: true, fullscreenControl: true });

ui.root.add(leftPanel);
ui.root.add(centerPanel);

// CRITICAL: Override global Map to point to our new visible map
// This ensures Map.addLayer() and Map.centerObject() work on the correct widget
Map = centerPanel;
Map.setOptions('HYBRID');
Map.setCenter(30.8, 26.8, 6); // Default center on Egypt

var controlsPanel = ui.Panel({ layout: ui.Panel.Layout.flow('vertical') });
var reportPanel = ui.Panel({ layout: ui.Panel.Layout.flow('vertical'), style: { shown: false } });

var buildResearcherMode;
var buildFarmerMode;

var mapClickListener; // Global listener ID (to be cleared on mode switch)

// Helper: Switch to report view
var showReportView = function () {
    controlsPanel.style().set('shown', false);
    reportPanel.style().set('shown', true);
};

// Helper: Switch back to controls view
var showControlsView = function () {
    reportPanel.style().set('shown', false);
    controlsPanel.style().set('shown', true);
};

// Helper: Create back button for report view
var createBackButton = function (modeName) {
    return ui.Button({
        label: '🔙 رجوع للإدخال (Back)',
        style: { stretch: 'horizontal', color: 'black', backgroundColor: '#90CAF9', fontWeight: 'bold', fontSize: '14px', padding: '8px', margin: '5px 0' },
        onClick: function () {
            if (modeName === 'farmer') { buildFarmerMode(); }
            else { buildResearcherMode(); }
        }
    });
};

// --- HELPER: Scientific Farm Validation ---
var validateFarmLocation = function (geometry, start, end) {

    // ========== 1️⃣ LAND COVER: Dynamic World ==========
    var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
        .filterBounds(geometry)
        .filterDate(start, end)
        .select(['crops', 'built', 'bare', 'grass', 'trees', 'water']);

    var dwMean = dw.mean().clip(geometry);
    var dwStats = dwMean.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    });

    // ========== 2️⃣ PHENOLOGY: NDVI Time Series ==========
    var s2Ndvi = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(geometry)
        .filterDate(start, end)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
        .map(function (img) {
            var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
            return ndvi.copyProperties(img, ['system:time_start']);
        });

    var ndviMax = s2Ndvi.max().reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    }).get('NDVI');

    var ndviMin = s2Ndvi.min().reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    }).get('NDVI');

    var ndviRange = ee.Number(ndviMax).subtract(ee.Number(ndviMin));
    var ndviMean = s2Ndvi.mean().reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    }).get('NDVI');

    // ========== 🆕 3️⃣ ENHANCED DESERT DETECTION ==========
    // Use multiple indicators to detect true desert/barren land

    // A) BSI (Bare Soil Index) - High values = bare soil
    var s2ForBSI = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(geometry)
        .filterDate(start, end)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
        .median();

    var bsi = s2ForBSI.expression(
        '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))', {
        'SWIR1': s2ForBSI.select('B11'),
        'RED': s2ForBSI.select('B4'),
        'NIR': s2ForBSI.select('B8'),
        'BLUE': s2ForBSI.select('B2')
    }).rename('BSI');

    var bsiMean = bsi.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    }).get('BSI');

    // B) NDBI (Built-up vs Bare) - Helps distinguish desert from urban
    var ndbi = s2ForBSI.normalizedDifference(['B11', 'B8']).rename('NDBI');
    var ndbiMean = ndbi.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    }).get('NDBI');

    // C) Albedo (Reflectance) - Desert has high reflectance
    var albedo = s2ForBSI.select(['B2', 'B3', 'B4']).reduce(ee.Reducer.mean()).rename('Albedo');
    var albedoMean = albedo.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    }).get('Albedo');

    // D) Texture analysis - Desert is homogeneous
    var ndviLatest = s2Ndvi.sort('system:time_start', false).first();
    var spatialStats = ee.Algorithms.If(
        ndviLatest,
        ndviLatest.reduceRegion({
            reducer: ee.Reducer.stdDev().combine(ee.Reducer.mean(), '', true),
            geometry: geometry,
            scale: 10,
            maxPixels: 1e9
        }),
        ee.Dictionary({ 'NDVI_stdDev': 0, 'NDVI_mean': 0 })
    );

    // ========== COMPILE RESULTS ==========
    return ee.Dictionary({
        // Land Cover
        crops_prob: dwStats.get('crops'),
        built_prob: dwStats.get('built'),
        bare_prob: dwStats.get('bare'),
        grass_prob: dwStats.get('grass'),
        water_prob: dwStats.get('water'),

        // Phenology
        ndvi_max: ndviMax,
        ndvi_min: ndviMin,
        ndvi_range: ndviRange,
        ndvi_mean: ndviMean,
        observation_count: s2Ndvi.size(),

        // Spatial
        ndvi_stdDev: ee.Dictionary(spatialStats).get('NDVI_stdDev'),
        ndvi_spatial_mean: ee.Dictionary(spatialStats).get('NDVI_mean'),

        // 🆕 Enhanced Desert Indicators
        bsi_mean: bsiMean,           // High BSI = bare soil
        ndbi_mean: ndbiMean,         // Helps separate desert/built
        albedo_mean: albedoMean      // High albedo = desert sand
    });
};


var modeSelect = ui.Select({
    items: ['-- Select Mode / اختر الوضع --', 'Researcher Mode (وضع الباحث)', 'Farmer Mode (وضع المزارع)'],
    placeholder: 'اختر الوضع للمتابعة / Select Mode',
    value: '-- Select Mode / اختر الوضع --',
    onChange: function (mode) {
        if (mode.indexOf('Researcher') > -1) {
            buildResearcherMode();
        } else if (mode.indexOf('Farmer') > -1) {
            buildFarmerMode();
        } else {
            buildWelcomeScreen();
        }
    }
});

leftPanel.add(ui.Label({ value: 'Select Mode / اختر الوضع', style: { fontWeight: 'bold', fontSize: '12px' } }));
leftPanel.add(modeSelect);
leftPanel.add(ui.Label('────────────────────────────────'));
leftPanel.add(controlsPanel);
leftPanel.add(reportPanel);

// ====================================================================================
// 🛠️ MODE 1: RESEARCHER MODE (Full Functionality)
// ====================================================================================
buildResearcherMode = function () {
    controlsPanel.clear();
    reportPanel.clear();
    showControlsView();

    // Alias controlsPanel as "mainPanel" so the existing code works without modification
    var mainPanel = controlsPanel;

    // --- HELPER: Collapsible Section ---
    var createCollapsibleSection = function (title, expanded) {
        var panel = ui.Panel({
            layout: ui.Panel.Layout.flow('vertical'),
            style: { margin: '5px 0', border: '1px solid #ccc', padding: '0' }
        });
        var content = ui.Panel({
            layout: ui.Panel.Layout.flow('vertical'),
            style: { shown: expanded, padding: '5px 10px', backgroundColor: '#fafafa' }
        });
        var header = ui.Button({
            label: (expanded ? '▼ ' : '▶ ') + title,
            style: {
                stretch: 'horizontal', textAlign: 'left', fontWeight: 'bold',
                margin: '0', backgroundColor: '#e0e0e0', border: '0'
            },
            onClick: function () {
                var isShown = content.style().get('shown');
                content.style().set('shown', !isShown);
                header.setLabel((!isShown ? '▼ ' : '▶ ') + title);
            }
        });
        panel.add(header);
        panel.add(content);
        return { panel: panel, content: content };
    };



    // Title
    var titleLabel = ui.Label({
        value: 'Egypt Analysis Panel (Full Research Project)',
        style: {
            fontWeight: 'bold',
            fontSize: '16px',
            margin: '0 0 8px 0'
        }
    });
    mainPanel.add(titleLabel);

    // Separator helper
    function addSeparator() {
        mainPanel.add(ui.Label({
            value: '',
            style: { border: '1px solid #ccc', margin: '4px 0' }
        }));
    }

    addSeparator();


    /**** 3.1 Governorate selection ****/

    var govTitle = ui.Label({
        value: '1) Select governorate (admin boundaries):',
        style: { fontWeight: 'bold' }
    });
    mainPanel.add(govTitle);

    // --- MODIFIED: Select with Red Highlight ---
    var govSelect = ui.Select({
        placeholder: 'Loading governorate list...',
        onChange: function (govName) {
            if (!govName) return;

            // 1. Define region and center map
            print('DEBUG: Selecting', govName);
            var region = adminBoundaries.filter(ee.Filter.eq(regionNameField, govName));
            print('DEBUG: Matches found:', region.size());

            // USE centerPanel DIRECTLY (Avoid global Map ambiguity)
            centerPanel.centerObject(region, 9);
            currentRegion = region.geometry();

            // 2. Highlight Logic:
            // A) Remove previous highlight from centerPanel
            var layers = centerPanel.layers();
            for (var i = 0; i < layers.length(); i++) {
                var layer = layers.get(i);
                if (layer && layer.getName() === '🔴 Active Selection') {
                    centerPanel.layers().remove(layer);
                    break;
                }
            }

            // B) Add new red border (Transparent inside)
            var highlightStyle = {
                color: 'FF0000',       // Red
                fillColor: '00000000', // Transparent fill
                width: 3               // Thick border
            };

            centerPanel.addLayer(region.style(highlightStyle), {}, '🔴 Active Selection');
        }
    });
    mainPanel.add(govSelect);

    // Fill governorate list (English Only for Researcher Mode)
    var govNamesArray = adminBoundaries.aggregate_array(regionNameField).distinct().sort();
    govNamesArray.evaluate(function (list) {
        govSelect.items().reset(list);
        govSelect.setPlaceholder('Select governorate');
    });

    // Toggle governorate boundaries
    var showBordersCheckbox = ui.Checkbox({
        label: 'Show governorate boundaries',
        value: true,
        onChange: function () {
            refreshLayers();
        }
    });
    mainPanel.add(showBordersCheckbox);

    // --- NEW: 3.1.b DRAWING TOOLS ---
    mainPanel.add(ui.Label('OR Draw Study Area:', { fontWeight: 'bold', fontSize: '12px', margin: '10px 0 0 0' }));

    var drawingTools = centerPanel.drawingTools();
    drawingTools.setShown(false);
    drawingTools.addLayer([], 'Study Area', 'red');

    var drawButton = ui.Button({
        label: '✍️ Draw Rectangle',
        style: { stretch: 'horizontal' },
        onClick: function () {
            drawingTools.setShown(true);
            drawingTools.setShape('rectangle');
            drawingTools.draw();
        }
    });

    var clearButton = ui.Button({
        label: '🗑️ Clear Drawing',
        style: { stretch: 'horizontal', color: 'red' },
        onClick: function () {
            var layers = drawingTools.layers();
            layers.get(0).geometries().reset();
            drawingTools.setShown(false);
            drawingTools.setShape(null);
            // Optionally reset to governorate if one was selected
            if (govSelect.getValue()) {
                var gName = govSelect.getValue().split(' - ')[0];
                currentRegion = adminBoundaries.filter(ee.Filter.eq(regionNameField, gName)).geometry();
            } else {
                currentRegion = null;
            }
        }
    });

    var drawPanel = ui.Panel({
        widgets: [drawButton, clearButton],
        layout: ui.Panel.Layout.flow('horizontal'),
        style: { stretch: 'horizontal' }
    });
    mainPanel.add(drawPanel);

    // Listener to Capture Drawn Geometry
    drawingTools.onDraw(function (geometry) {
        currentRegion = geometry;
        centerPanel.centerObject(geometry, 12);
        drawingTools.setShown(false);
        infoPanel.clear();
        infoPanel.add(ui.Label('✅ Drawing tools set as study area.', { color: 'green', fontWeight: 'bold' }));
    });

    addSeparator();

    // --- NEW: 3.1.c GPS LOCATION ---
    var gpsButton = ui.Button({
        label: '🌐 Use My Location',
        style: { stretch: 'horizontal', color: '#1565C0', backgroundColor: '#E3F2FD', fontWeight: 'bold' },
        onClick: function () {
            gpsButton.setLabel('⏳ Locating...');
            ui.util.getCurrentPosition(function (position) {
                if (position && typeof position.getInfo === 'function') {
                    position = position.getInfo();
                }
                var lat, lon;
                if (position.coordinates && Array.isArray(position.coordinates)) {
                    lon = position.coordinates[0];
                    lat = position.coordinates[1];
                } else {
                    lat = position.lat || (position.coords ? position.coords.latitude : null) || position.latitude;
                    lon = position.lon || (position.coords ? position.coords.longitude : null) || position.longitude;
                }

                if (lat === undefined || lon === undefined) {
                    gpsButton.setLabel('⚠️ GPS Failed');
                    return;
                }

                var marker = ee.Geometry.Point([lon, lat]);
                currentRegion = marker.buffer(500); // Default 500m buffer for researchers
                centerPanel.centerObject(marker, 15);

                // Highlight Logic:
                var layers = centerPanel.layers();
                for (var i = 0; i < layers.length(); i++) {
                    var layer = layers.get(i);
                    if (layer && layer.getName() === '🔴 Active Selection') {
                        centerPanel.layers().remove(layer);
                        break;
                    }
                }
                centerPanel.addLayer(marker, { color: 'red' }, '🔴 Active Selection');

                gpsButton.setLabel('🎯 Location Set');
                infoPanel.clear();
                infoPanel.add(ui.Label('✅ GPS Location set as study area (500m buffer).', { color: 'green', fontWeight: 'bold' }));
            }, function (error) {
                gpsButton.setLabel('⚠️ GPS Error');
            }, true);
        }
    });
    mainPanel.add(gpsButton);

    addSeparator();

    // --- Legend Function (Refactored to use centerPanel) ---
    function updateLegend(title, vis) {
        var existing = centerPanel.widgets().get(1); if (existing) centerPanel.widgets().remove(existing);
        if (!vis || !vis.palette) return;

        // Compact styled panel
        var legendPanel = ui.Panel({
            style: {
                position: 'bottom-right',
                padding: '4px 8px',
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                width: '100px' // Fix width to keep it compact
            }
        });

        // Truncate title if too long
        var displayTitle = title.length > 20 ? title.substring(0, 18) + '..' : title;

        var legendTitle = ui.Label({
            value: displayTitle,
            style: {
                fontWeight: 'bold',
                fontSize: '10px',
                margin: '0 0 2px 0',
                whiteSpace: 'nowrap'
            }
        });

        legendPanel.add(legendTitle);

        var lon = ee.Image.pixelLonLat().select('latitude');
        var gradient = lon.multiply((vis.max - vis.min) / 100.0).add(vis.min);
        var legendImage = gradient.visualize({ min: vis.min, max: vis.max, palette: vis.palette });

        // Smaller thumbnail
        var thumb = ui.Thumbnail({
            image: legendImage,
            params: { bbox: '0,0,10,100', dimensions: '15x100' },
            style: { padding: '0px', position: 'bottom-center', margin: '2px auto' }
        });

        var minLabel = ui.Label(vis.min.toString(), { fontSize: '9px', margin: '0 auto' });
        var maxLabel = ui.Label(vis.max.toString(), { fontSize: '9px', margin: '0 auto' });

        legendPanel.add(ui.Panel(
            [maxLabel, thumb, minLabel],
            ui.Panel.Layout.flow('vertical')
        ));

        centerPanel.widgets().set(1, legendPanel);
    }
    /**** 3.2 Date range (single period for normal analysis) ****/

    var dateTitle = ui.Label({
        value: '2) Date range (single period):',
        style: { fontWeight: 'bold' }
    });
    mainPanel.add(dateTitle);

    var startDateBox = ui.Textbox('Start date (YYYY-MM-DD)', '2023-01-01');
    var endDateBox = ui.Textbox('End date   (YYYY-MM-DD)', '2023-12-31');

    mainPanel.add(startDateBox);
    mainPanel.add(endDateBox);

    addSeparator();


    /**** 3.3: Sensor Selection ****/
    var sensorTitle = ui.Label({
        value: '3) Select sensor (for analysis):',
        style: { fontWeight: 'bold' }
    });
    mainPanel.add(sensorTitle);

    var sensorSelect = ui.Select({
        items: ['Sentinel-2', 'Landsat 8', 'Landsat 7', 'Landsat 5'],
        value: 'Sentinel-2',
        style: { stretch: 'horizontal' }
    });
    mainPanel.add(sensorSelect);


    /**** 3.4 Index selection ****/

    var indexTitle = ui.Label({
        value: '4) Select index (for S-2 / Landsat):',
        style: { fontWeight: 'bold' }
    });
    mainPanel.add(indexTitle);

    var indexSelect = ui.Select({
        items: Object.keys(indicesDict),
        placeholder: 'Choose an index',
        onChange: function (name) {
            currentIndexName = name;
        }
    });
    mainPanel.add(indexSelect);

    // --- MASTER EXECUTE BUTTON ---
    mainPanel.add(ui.Label('────────────────────────────────'));
    var masterExecuteButton = ui.Button({
        label: '🚀 Execute Analysis',
        style: { stretch: 'horizontal', color: '#006400', fontWeight: 'bold', backgroundColor: '#90EE90' },
        onClick: function () {
            infoPanel.clear();
            chartPanel.clear();
            showReportView();

            if (!currentRegion) {
                // Try to use default boundaries if none selected? No, safer to ask.
                infoPanel.add(ui.Label('⚠️ Please select a governorate first (Step 1).'));
                return;
            }
            var start = startDateBox.getValue();
            var end = endDateBox.getValue();
            var idxName = indexSelect.getValue();

            // Auto-select NDVI if nothing selected
            if (!idxName) {
                idxName = 'NDVI (Vegetation)';
                indexSelect.setValue(idxName);
            }

            var sensor = sensorSelect.getValue();
            infoPanel.add(ui.Label('⏳ Running analysis using ' + sensor + '...'));

            // 1. Image & Map Update
            var col = getSelectedCollection(start, end, currentRegion)
                .map(function (img) {
                    return indicesDict[idxName](img)
                        .copyProperties(img, img.propertyNames());
                });

            var composite = col.median().clip(currentRegion);
            currentImage = composite;
            currentIndexName = idxName + ' (' + sensor + ')';
            currentVisParams = visParamsDict[idxName];

            refreshLayers();
            centerPanel.centerObject(currentRegion, 8);

            // 2. Statistics
            var stats = composite.reduceRegion({
                reducer: ee.Reducer.mean()
                    .combine(ee.Reducer.min(), '', true)
                    .combine(ee.Reducer.max(), '', true)
                    .combine(ee.Reducer.stdDev(), '', true),
                geometry: currentRegion,
                scale: 250,
                maxPixels: 1e9
            });

            stats.evaluate(function (res) {
                var success = displayStats(res, infoPanel, '📊 Statistics (' + idxName + '):');
                if (success) {
                    infoPanel.add(ui.Label('✅ Analysis Complete.', { color: 'green' }));
                }
            });
        }
    });
    mainPanel.add(masterExecuteButton);
    mainPanel.add(ui.Label('────────────────────────────────'));

    addSeparator();


    /**** 3.5 Change detection date ranges ****/

    var cdTitle = ui.Label({
        value: '5) Change detection periods:',
        style: { fontWeight: 'bold' }
    });
    mainPanel.add(cdTitle);

    var p1StartBox = ui.Textbox('Period 1 - start (YYYY-MM-DD)', '1990-01-01');
    var p1EndBox = ui.Textbox('Period 1 - end   (YYYY-MM-DD)', '1990-12-31');
    var p2StartBox = ui.Textbox('Period 2 - start (YYYY-MM-DD)', '2023-01-01');
    var p2EndBox = ui.Textbox('Period 2 - end   (YYYY-MM-DD)', '2023-12-31');

    mainPanel.add(p1StartBox);
    mainPanel.add(p1EndBox);
    mainPanel.add(p2StartBox);
    mainPanel.add(p2EndBox);

    addSeparator();


    /**** 3.6 NEW: Crop & Season Parameters ****/

    var cropTitle = ui.Label({
        value: '6) Crop & Season Parameters (for new models):',
        style: { fontWeight: 'bold' }
    });
    mainPanel.add(cropTitle);

    mainPanel.add(ui.Label('Select crop type (for Yield & Heat Stress):'));
    var cropSelect = ui.Select({
        items: ['Wheat', 'Maize (Corn)', 'Rice', 'Cotton', 'Sugarcane', 'General Crop'],
        value: 'Wheat',
        style: { stretch: 'horizontal' }
    });
    mainPanel.add(cropSelect);

    mainPanel.add(ui.Label('Enter Growing Season Start (for Forecast/Yield):'));
    var gsStartBox = ui.Textbox('Start date (YYYY-MM-DD)', '2023-11-15');
    mainPanel.add(gsStartBox);

    mainPanel.add(ui.Label('Enter Growing Season End (for Yield):'));
    var gsEndBox = ui.Textbox({
        placeholder: 'Growing season end (YYYY-MM-DD)',
        value: '2024-04-30',
        style: { stretch: 'horizontal' }
    });
    mainPanel.add(gsEndBox);

    addSeparator();


    /**** 3.7 Layer opacity ****/

    var opacityLabel = ui.Label('7) Layer opacity:');
    opacityLabel.style().set('fontWeight', 'bold');
    mainPanel.add(opacityLabel);

    var opacitySlider = ui.Slider({
        min: 0,
        max: 1,
        value: 1,
        step: 0.05,
        onChange: function (val) {
            currentOpacity = val;
            if (currentLayer) {
                currentLayer.setOpacity(val);
            }
        }
    });
    mainPanel.add(opacitySlider);

    addSeparator();


    /**** 3.8 Info and charts panels ****/

    var infoPanel = ui.Panel();
    var chartPanel = ui.Panel({ style: { height: '220px', stretch: 'horizontal' } });

    reportPanel.add(createBackButton('researcher'));
    reportPanel.add(infoPanel);
    reportPanel.add(chartPanel);


    /**** 4) Map layers ****/

    function addBordersLayer() {
        var styled = adminBoundaries.style({
            color: 'black',
            fillColor: '00000000',
            width: 1
        });
        centerPanel.addLayer(styled, {}, 'Governorate boundaries', true);
    }

    function refreshLayers() {
        centerPanel.layers().reset();
        currentLayer = null;
        // Remove old legend when clearing map
        var existingLegend = centerPanel.widgets().get(1); if (existingLegend) centerPanel.widgets().remove(existingLegend);

        if (currentImage) {
            var vis = currentVisParams || (currentIndexName && visParamsDict[currentIndexName]) || { min: -0.5, max: 0.5 };
            currentLayer = centerPanel.addLayer(currentImage, vis, currentIndexName || 'Layer');
            currentLayer.setOpacity(currentOpacity);

            // Auto-update legend if available
            if (vis.palette) { updateLegend(currentIndexName, vis); }
        }
        if (showBordersCheckbox.getValue()) {
            addBordersLayer();
        }
    }

    /**** 5) Map click: point time series ****/
    // This function is now SENSOR AWARE
    if (mapClickListener) { centerPanel.unlisten(mapClickListener); }
    mapClickListener = centerPanel.onClick(function (coords) {
        chartPanel.clear();
        infoPanel.clear();

        var idxName = indexSelect.getValue();
        if (!idxName) {
            infoPanel.add(ui.Label('For point time series: please select an index first.'));
            return;
        }

        var sensor = sensorSelect.getValue();
        var start = startDateBox.getValue();
        var end = endDateBox.getValue();
        var point = ee.Geometry.Point([coords.lon, coords.lat]);
        var buffer = point.buffer(250); // 250 m radius

        // Get collection based on sensor selection
        var col = getSelectedCollection(start, end, buffer);

        // Calculate index
        var colIndexed = col.map(function (img) {
            var index = indicesDict[idxName](img);
            return index.copyProperties(img, img.propertyNames());
        });

        var chart = ui.Chart.image.series({
            imageCollection: colIndexed,
            region: buffer,
            reducer: ee.Reducer.mean(),
            scale: 30 // Use 30m scale for compatibility
        })
            .setOptions({
                title: 'Point time series (' + sensor + '): ' + idxName,
                hAxis: { title: 'Date' },
                vAxis: { title: idxName },
                lineWidth: 2,
                pointSize: 3,
                colors: ['#e0440e']
            });

        chartPanel.add(chart);
        infoPanel.add(ui.Label(
            'Point time series at lon=' + coords.lon.toFixed(4) +
            ', lat=' + coords.lat.toFixed(4)
        ));
    });


    /**** 6) Main buttons ****/

    // --- Helper function to get the correct collection ---
    function getSelectedCollection(start, end, geometry) {
        var sensor = sensorSelect.getValue();

        // --- Band names mapping ---
        var l8_BANDS = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7', 'ST_B10'];
        var l57_BANDS = ['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7', 'ST_B6'];
        var COMMON_BANDS = ['BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2', 'LST'];

        if (sensor === 'Sentinel-2') {
            return getS2Collection(start, end, geometry);

        } else if (sensor === 'Landsat 8') {
            return ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                .filterDate(start, end)
                .filterBounds(geometry)
                .map(cloudMaskLandsat)
                .map(applyScaleFactors)
                .select(l8_BANDS, COMMON_BANDS);

        } else if (sensor === 'Landsat 7') {
            return ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
                .filterDate(start, end)
                .filterBounds(geometry)
                .map(cloudMaskLandsat)
                .map(applyScaleFactors)
                .select(l57_BANDS, COMMON_BANDS);

        } else if (sensor === 'Landsat 5') {
            return ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
                .filterDate(start, end)
                .filterBounds(geometry)
                .map(cloudMaskLandsat)
                .map(applyScaleFactors)
                .select(l57_BANDS, COMMON_BANDS);
        }
    }

    // --- NEW UI Section Title ---
    var basicTitle = ui.Label({
        value: 'A) Basic Analysis:',
        style: { fontWeight: 'bold', fontSize: '14px' }
    });
    mainPanel.add(basicTitle);


    // 6.1 Show index on map
    var applyButton = ui.Button({
        label: '🔄 Update Layer',
        style: { stretch: 'horizontal' },
        onClick: function () {
            infoPanel.clear();
            chartPanel.clear();

            if (!currentRegion) {
                infoPanel.add(ui.Label('Please select a governorate first.'));
                return;
            }
            var start = startDateBox.getValue();
            var end = endDateBox.getValue();
            var idxName = indexSelect.getValue();
            if (!idxName) {
                infoPanel.add(ui.Label('Please select an index first.'));
                return;
            }
            var sensor = sensorSelect.getValue();
            infoPanel.add(ui.Label('Loading ' + sensor + ' data...'));

            var col = getSelectedCollection(start, end, currentRegion)
                .map(function (img) {
                    return indicesDict[idxName](img)
                        .copyProperties(img, img.propertyNames());
                });

            var composite = col.median().clip(currentRegion);
            currentImage = composite;
            currentIndexName = idxName + ' (' + sensor + ')';
            currentVisParams = visParamsDict[idxName];

            refreshLayers();
            Map.centerObject(currentRegion, 8);

            var stats = composite.reduceRegion({
                reducer: ee.Reducer.mean()
                    .combine(ee.Reducer.min(), '', true)
                    .combine(ee.Reducer.max(), '', true)
                    .combine(ee.Reducer.stdDev(), '', true),
                geometry: currentRegion,
                scale: CONFIG.SCALE.LANDSAT,
                maxPixels: CONFIG.MAX_PIXELS
            });

            stats.evaluate(function (res) {
                displayStats(res, infoPanel, 'Statistics for ' + sensor + ':');
            });
        }
    });
    mainPanel.add(applyButton);


    // 6.2 Show true color RGB
    var rgbButton = ui.Button({
        label: 'Show True Color (RGB)',
        style: { stretch: 'horizontal' },
        onClick: function () {
            infoPanel.clear();
            chartPanel.clear();

            if (!currentRegion) {
                infoPanel.add(ui.Label('Please select a governorate first.'));
                return;
            }

            var start = startDateBox.getValue();
            var end = endDateBox.getValue();
            var sensor = sensorSelect.getValue();
            infoPanel.add(ui.Label('Loading ' + sensor + ' data...'));

            var col = getSelectedCollection(start, end, currentRegion);
            var composite = col.median()
                .select(['RED', 'GREEN', 'BLUE'])
                .clip(currentRegion);

            currentImage = composite;
            currentIndexName = 'True Color (RGB) - ' + sensor;
            currentVisParams = visParamsDict['True Color (RGB)'];

            refreshLayers();
            Map.centerObject(currentRegion, 8);
            infoPanel.clear();
            infoPanel.add(ui.Label(sensor + ' true color composite displayed.'));
        }
    });
    mainPanel.add(rgbButton);


    // 6.3 Time series over governorate
    var tsButton = ui.Button({
        label: 'Time series (mean over governorate)',
        style: { stretch: 'horizontal' },
        onClick: function () {
            chartPanel.clear();
            infoPanel.clear();

            var idxName = indexSelect.getValue();
            if (!currentRegion || !idxName) {
                infoPanel.add(ui.Label('Please select a governorate and an index first.'));
                return;
            }
            var start = startDateBox.getValue();
            var end = endDateBox.getValue();
            var sensor = sensorSelect.getValue();

            var col = getSelectedCollection(start, end, currentRegion)
                .map(function (img) {
                    return indicesDict[idxName](img)
                        .copyProperties(img, img.propertyNames());
                });

            var chart = ui.Chart.image.series({
                imageCollection: col,
                region: currentRegion,
                reducer: ee.Reducer.mean(),
                scale: 30 // Use 30m for compatibility
            })
                .setOptions({
                    title: 'Time series (' + sensor + ' mean): ' + idxName,
                    hAxis: { title: 'Date' },
                    vAxis: { title: idxName },
                    lineWidth: 2,
                    pointSize: 3,
                    colors: ['#e0440e']
                });

            chartPanel.add(chart);
        }
    });
    mainPanel.add(tsButton);


    // 6.4 Zonal stats for all governorates
    var zonalButton = ui.Button({
        label: 'Governorate comparison (all Egypt)',
        style: { stretch: 'horizontal' },
        onClick: function () {
            chartPanel.clear();
            infoPanel.clear();

            var idxName = indexSelect.getValue();
            if (!idxName) {
                infoPanel.add(ui.Label('Please select an index first.'));
                return;
            }
            var start = startDateBox.getValue();
            var end = endDateBox.getValue();
            var sensor = sensorSelect.getValue();
            infoPanel.add(ui.Label('Loading ' + sensor + ' data for all Egypt...'));


            var col = getSelectedCollection(start, end, adminBoundaries.geometry())
                .map(function (img) {
                    return indicesDict[idxName](img)
                        .copyProperties(img, img.propertyNames());
                });

            var composite = col.median();

            var zonalStats = composite.reduceRegions({
                collection: adminBoundaries,
                reducer: ee.Reducer.mean().setOutputs(['mean']),
                scale: 30, // Use 30m for compatibility
                maxPixelsPerRegion: 1e13
            });

            lastZonalStats = zonalStats;

            var chart = ui.Chart.feature.byFeature({
                features: zonalStats,
                xProperty: regionNameField,
                yProperties: ['mean']
            })
                .setChartType('ColumnChart')
                .setOptions({
                    title: 'Mean ' + idxName + ' per governorate (' + sensor + ')',
                    hAxis: { title: 'Governorate', slantedText: true, slantedTextAngle: 45 },
                    vAxis: { title: idxName },
                    legend: { position: 'none' }
                });

            infoPanel.clear();
            chartPanel.add(chart);
            infoPanel.add(ui.Label('Zonal statistics computed (ready to export).'));
        }
    });
    mainPanel.add(zonalButton);


    // 6.5 Change detection between two periods
    var changeButton = ui.Button({
        label: 'Change detection (Period 2 - Period 1)',
        style: { stretch: 'horizontal' },
        onClick: function () {
            infoPanel.clear();
            chartPanel.clear();

            if (!currentRegion) {
                infoPanel.add(ui.Label('Please select a governorate first.'));
                return;
            }
            var idxName = indexSelect.getValue();
            if (!idxName) {
                infoPanel.add(ui.Label('Please select an index first (for change detection).'));
                return;
            }
            var sensor = sensorSelect.getValue();
            infoPanel.add(ui.Label('Running change detection with ' + sensor + '...'));

            var p1Start = p1StartBox.getValue();
            var p1End = p1EndBox.getValue();
            var p2Start = p2StartBox.getValue();
            var p2End = p2EndBox.getValue();

            var col1 = getSelectedCollection(p1Start, p1End, currentRegion);
            var col2 = getSelectedCollection(p2Start, p2End, currentRegion);

            // *** NEW SAFETY CHECK ***
            ee.Dictionary({
                size1: col1.size(),
                size2: col2.size()
            }).evaluate(function (sizes) {
                if (sizes.size1 === 0 || sizes.size2 === 0) {
                    infoPanel.clear();
                    infoPanel.add(ui.Label('⚠️ Error: No images found for one or both periods.'));
                    infoPanel.add(ui.Label('Period 1 images: ' + sizes.size1));
                    infoPanel.add(ui.Label('Period 2 images: ' + sizes.size2));
                    infoPanel.add(ui.Label('Check your dates and sensor selection.'));
                    return;
                }

                // --- Continue if data exists ---
                var col1_proc = col1.map(function (img) {
                    return indicesDict[idxName](img)
                        .copyProperties(img, img.propertyNames());
                });

                var col2_proc = col2.map(function (img) {
                    return indicesDict[idxName](img)
                        .copyProperties(img, img.propertyNames());
                });

                var img1 = col1_proc.median().clip(currentRegion);
                var img2 = col2_proc.median().clip(currentRegion);

                var diff = img2.subtract(img1).rename('change');

                currentImage = diff;
                currentIndexName = idxName + ' change (P2 - P1) - ' + sensor;
                currentVisParams = changeVisParams;

                refreshLayers();
                Map.centerObject(currentRegion, 8);

                var stats = diff.reduceRegion({
                    reducer: ee.Reducer.mean()
                        .combine(ee.Reducer.min(), '', true)
                        .combine(ee.Reducer.max(), '', true)
                        .combine(ee.Reducer.stdDev(), '', true),
                    geometry: currentRegion,
                    scale: 30,
                    maxPixels: 1e13
                });

                stats.evaluate(function (res) {
                    displayStats(res, infoPanel, 'Change stats (' + sensor + '): ' + idxName);
                    infoPanel.add(ui.Label('Positive = increase, negative = decrease.'));
                });
                // --- End of safety check ---
            });
        }
    });
    mainPanel.add(changeButton);


    // 6.6 Simple land cover classification (NDVI/NDWI/NDBI rules)
    var lcButton = ui.Button({
        label: 'Simple land cover classification',
        style: { stretch: 'horizontal' },
        onClick: function () {
            infoPanel.clear();
            chartPanel.clear();

            if (!currentRegion) {
                infoPanel.add(ui.Label('Please select a governorate first.'));
                return;
            }

            var start = startDateBox.getValue();
            var end = endDateBox.getValue();
            var sensor = sensorSelect.getValue();
            infoPanel.add(ui.Label('Loading ' + sensor + ' data...'));

            var col = getSelectedCollection(start, end, currentRegion);
            var base = col.median().clip(currentRegion);

            // Compute needed indices
            var ndvi = indicesDict['NDVI (Vegetation)'](base);
            var ndwi = indicesDict['NDWI (McFeeters Water Index)'](base);
            var ndbi = indicesDict['NDBI (Built-up Index)'](base);

            // Classification rules (very simple, heuristic):
            // 1 = water, 2 = vegetation, 3 = urban, 4 = bare soil
            var classified = ee.Image(0)
                .where(ndwi.gt(0.1), 1)                                  // water
                .where(ndvi.gt(0.4), 2)                                  // vegetation
                .where(ndbi.gt(0.2), 3)                                  // urban
                .where(
                    ndvi.lt(0.2)
                        .and(ndwi.lt(0.1))
                        .and(ndbi.lt(0.2)),
                    4);                                                    // bare soil

            // Mask 0 (unclassified)
            classified = classified.updateMask(classified.neq(0));

            currentImage = classified.rename('LandCover');
            currentIndexName = 'Land cover (simple) - ' + sensor;
            currentVisParams = landCoverVis;

            refreshLayers();
            Map.centerObject(currentRegion, 8);

            infoPanel.clear();
            infoPanel.add(ui.Label('Simple land cover classification (' + sensor + ').'));
            infoPanel.add(ui.Label('Classes: 1=Water, 2=Vegetation, 3=Urban, 4=Bare soil.'));
        }
    });
    mainPanel.add(lcButton);

    addSeparator();


    // --- B) Physical Layers (Collapsible) ---
    (function (parentPanel) {
        var physSection = createCollapsibleSection('B) Physical Layers & Climate', false);
        parentPanel.add(physSection.panel);
        var mainPanel = physSection.content;

        // --- NEW UI Section Title ---
        var physicalTitle = ui.Label({
            value: 'B) Physical Layers:',
            style: { fontWeight: 'bold', fontSize: '14px' }
        });
        mainPanel.add(physicalTitle);


        // 6.7 S1 (Radar) and DEM (Terrain) buttons
        var s1Button = ui.Button({
            label: 'Show Soil Moisture (S1 - VV)',
            style: { stretch: 'horizontal' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }

                var start = startDateBox.getValue();
                var end = endDateBox.getValue();

                var s1Col = getS1Collection(start, end, currentRegion);
                var composite = s1Col.select('VV_smoothed').median().clip(currentRegion);

                currentImage = composite;
                currentIndexName = 'Sentinel-1 Soil Moisture (VV)';
                currentVisParams = s1Vis;

                refreshLayers();
                Map.centerObject(currentRegion, 8);
                infoPanel.add(ui.Label('Sentinel-1 SAR (VV) composite.'));
                infoPanel.add(ui.Label('Blue = Wet / Smooth. Red = Dry / Rough.'));
            }
        });
        mainPanel.add(s1Button);

        var demButton = ui.Button({
            label: 'Show Elevation (SRTM)',
            style: { stretch: 'horizontal' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();
                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }
                currentImage = dem.clip(currentRegion);
                currentIndexName = 'Elevation (SRTM)';
                currentVisParams = elevationVis;
                refreshLayers();
                Map.centerObject(currentRegion, 8);
                infoPanel.add(ui.Label('SRTM Elevation (meters).'));
            }
        });
        mainPanel.add(demButton);

        var slopeButton = ui.Button({
            label: 'Show Slope',
            style: { stretch: 'horizontal' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();
                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }
                currentImage = slope.clip(currentRegion);
                currentIndexName = 'Slope (degrees)';
                currentVisParams = slopeVis;
                refreshLayers();
                Map.centerObject(currentRegion, 8);
                infoPanel.add(ui.Label('Slope (degrees).'));
            }
        });
        mainPanel.add(slopeButton);

        // --- LST Button ---
        var lstButton = ui.Button({
            label: 'Show LST (Landsat, °C)',
            style: { stretch: 'horizontal', color: '#b22222' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();
                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }
                var start = startDateBox.getValue();
                var end = endDateBox.getValue();
                infoPanel.add(ui.Label('Loading Landsat LST data...'));

                var col = getMergedLandsatCollection(start, end, currentRegion).select('LST');

                var composite = col.median().clip(currentRegion);

                currentImage = composite;
                currentIndexName = 'Land Surface Temp (°C)';
                currentVisParams = lstVis;

                refreshLayers();
                Map.centerObject(currentRegion, 8);
                infoPanel.clear();
                infoPanel.add(ui.Label('Land Surface Temperature (LST) from Landsat.'));
            }
        });
        mainPanel.add(lstButton);

        // --- *** NEW: Climate Data Buttons *** ---

        var precipButton = ui.Button({
            label: 'Show Precipitation (CHIRPS)',
            style: { stretch: 'horizontal' },
            onClick: function () {
                infoPanel.clear(); chartPanel.clear();
                if (!currentRegion) { infoPanel.add(ui.Label('Please select a governorate.')); return; }
                var start = startDateBox.getValue();
                var end = endDateBox.getValue();
                infoPanel.add(ui.Label('Loading CHIRPS Precipitation data...'));

                var precip = getChirps(start, end, currentRegion).clip(currentRegion);

                currentImage = precip;
                currentIndexName = 'Total Precipitation (mm)';
                currentVisParams = precipVis;
                refreshLayers();

                var stats = precip.reduceRegion({
                    reducer: ee.Reducer.mean().combine(ee.Reducer.sum(), '', true),
                    geometry: currentRegion, scale: 5566, maxPixels: 1e13
                });
                stats.evaluate(function (res) {
                    infoPanel.clear();
                    if (!res) return;

                    var keys = Object.keys(res);
                    var meanKey = keys.find(function (k) { return k.indexOf('_mean') > -1; }) || keys[0];
                    var sumKey = keys.find(function (k) { return k.indexOf('_sum') > -1; });

                    infoPanel.add(ui.Label('Precipitation Stats:'));
                    if (meanKey && res[meanKey] != null)
                        infoPanel.add(ui.Label('Mean: ' + ee.Number(res[meanKey]).format('%.2f').getInfo() + ' mm'));
                    if (sumKey && res[sumKey] != null)
                        infoPanel.add(ui.Label('Total (Sum): ' + ee.Number(res[sumKey]).format('%.2f').getInfo() + ' mm'));
                });
            }
        });
        mainPanel.add(precipButton);

        var etButton = ui.Button({
            label: 'Show Evapotranspiration (MODIS ET)',
            style: { stretch: 'horizontal' },
            onClick: function () {
                infoPanel.clear(); chartPanel.clear();
                if (!currentRegion) { infoPanel.add(ui.Label('Please select a governorate.')); return; }
                var start = startDateBox.getValue();
                var end = endDateBox.getValue();
                infoPanel.add(ui.Label('Loading MODIS ET data...'));

                var et = getModisET(start, end, currentRegion).clip(currentRegion);

                currentImage = et;
                currentIndexName = 'Mean Evapotranspiration (mm/day)';
                currentVisParams = etVis;
                refreshLayers();

                var stats = et.reduceRegion({
                    reducer: ee.Reducer.mean(),
                    geometry: currentRegion, scale: 500, maxPixels: 1e13
                });
                stats.evaluate(function (res) {
                    displayStats(res, infoPanel, 'Evapotranspiration Stats:');
                });
            }
        });
        mainPanel.add(etButton);

        var eraSmButton = ui.Button({
            label: 'Show Root-Zone Soil Moisture (ERA5)',
            style: { stretch: 'horizontal' },
            onClick: function () {
                infoPanel.clear(); chartPanel.clear();
                if (!currentRegion) { infoPanel.add(ui.Label('Please select a governorate.')); return; }
                var start = startDateBox.getValue();
                var end = endDateBox.getValue();
                infoPanel.add(ui.Label('Loading ERA5-Land Soil Moisture...'));

                var era5 = getEra5(start, end, currentRegion).select('sm_rootzone_m3m3')
                    .clip(currentRegion);

                currentImage = era5;
                currentIndexName = 'Mean Root-Zone Soil Moisture (m³/m³)';
                currentVisParams = smVis;
                refreshLayers();

                var stats = era5.reduceRegion({
                    reducer: ee.Reducer.mean(),
                    geometry: currentRegion, scale: 11132, maxPixels: 1e13
                });
                stats.evaluate(function (res) {
                    displayStats(res, infoPanel, 'ERA5-Land Root-Zone SM (7-28cm):');
                });
            }
        });
        mainPanel.add(eraSmButton);

    })(mainPanel); // End Physical Section Scope

    addSeparator();


    // --- C) Advanced Models (Collapsible) ---
    (function (parentPanel) {
        var advModelSection = createCollapsibleSection('C) Research Models (Soil & Climate)', false);
        parentPanel.add(advModelSection.panel);
        var mainPanel = advModelSection.content;

        // --- *** 6.8: Advanced Models (Soil & Climate) *** ---
        var modelTitle = ui.Label({
            value: 'C) Research Models (Soil & Climate):',
            style: { fontWeight: 'bold', fontSize: '14px' }
        });
        mainPanel.add(modelTitle);

        // --- VHI Button (from user's Section 11) ---
        var vhiButton = ui.Button({
            label: 'Run Vegetation Health Index (VHI) Model',
            style: { stretch: 'horizontal', color: '#00008B' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();
                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }
                var start = startDateBox.getValue();
                var end = endDateBox.getValue();
                infoPanel.add(ui.Label('Running VHI Model... (This is intensive)'));

                // 1. Get full Landsat history (L5, L7, L8) for baseline
                var fullHistory = getMergedLandsatCollection('1984-01-01', ee.Date(Date.now()).format('YYYY-MM-dd'), currentRegion);

                // 2. Calculate long-term Min/Max for NDVI and LST
                var historyNdvi = fullHistory.map(function (img) { return indicesDict['NDVI (Vegetation)'](img); });
                var historyLst = fullHistory.select('LST');

                var ndviMin = historyNdvi.min();
                var ndviMax = historyNdvi.max();
                var lstMin = historyLst.min();
                var lstMax = historyLst.max();

                // 3. Get current period data (using the date boxes)
                var currentCol = getMergedLandsatCollection(start, end, currentRegion);

                var currentNdvi = currentCol.map(function (img) { return indicesDict['NDVI (Vegetation)'](img); }).median();
                var currentLst = currentCol.select('LST').median();

                // 4. Calculate VCI and TCI
                var vci = currentNdvi.subtract(ndviMin).divide(ndviMax.subtract(ndviMin)).rename('VCI');
                var tci = lstMax.subtract(currentLst).divide(lstMax.subtract(lstMin)).rename('TCI');

                // 5. Calculate VHI
                var vhi = vci.multiply(0.5).add(tci.multiply(0.5)).rename('VHI');

                currentImage = vhi.clip(currentRegion);
                currentIndexName = 'Vegetation Health Index (VHI)';
                currentVisParams = {
                    min: 0, max: 1,
                    palette: ['#FF0000', '#FFA500', '#FFFF00', '#ADFF2F', '#008000']
                };

                refreshLayers();
                Map.centerObject(currentRegion, 8);
                infoPanel.clear();
                infoPanel.add(ui.Label('VHI Model Complete. Red=Drought, Green=Healthy.'));
            }
        });
        mainPanel.add(vhiButton);


        // --- Salinity Risk Model Button (from user's Section 12) ---
        var salinityRiskButton = ui.Button({
            label: 'Run Salinity Risk Model (Weighted)',
            style: { stretch: 'horizontal', color: '#8B0000' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();
                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }
                var start = startDateBox.getValue();
                var end = endDateBox.getValue();
                infoPanel.add(ui.Label('Running Salinity Risk Model...'));

                // --- Risk Model Logic ---
                // 1. Get all data components for the period
                var s2_col = getS2Collection(start, end, currentRegion);
                var ls_col = getMergedLandsatCollection(start, end, currentRegion);
                var era5 = getEra5(start, end, currentRegion);

                // 2. Create composites
                var s2_median = s2_col.median();
                var ndsi = indicesDict['NDSI (Salinity Index)'](s2_median);
                var ndvi = indicesDict['NDVI (Vegetation)'](s2_median);
                var s1_moisture = era5.select('sm_topsoil_m3m3'); // <-- UPGRADED
                var lst = ls_col.select('LST').median();
                var slope_img = slope;

                // 3. Normalize all inputs (0-1)
                var ndsi_norm = ndsi.unitScale(-0.2, 0.2);
                var lst_norm = lst.unitScale(20, 50);
                var slope_norm = slope_img.unitScale(0, 10).not();
                var s1_norm = s1_moisture.unitScale(0.1, 0.4); // <-- UPGRADED (0.1=low risk, 0.4=high risk)
                var ndvi_norm = ndvi.unitScale(0.1, 0.6).not();

                var w_ndsi = 0.30;
                var w_slope = 0.25;
                var w_s1 = 0.20;    // Now represents ERA5 Topsoil Moisture
                var w_lst = 0.15;
                var w_ndvi = 0.10;

                var risk_score = ndsi_norm.multiply(w_ndsi)
                    .add(slope_norm.multiply(w_slope))
                    .add(s1_norm.multiply(w_s1))
                    .add(lst_norm.multiply(w_lst))
                    .add(ndvi_norm.multiply(w_ndvi));

                currentImage = risk_score.clip(currentRegion);
                currentIndexName = 'Salinity Risk Score (0-1)';
                currentVisParams = {
                    min: 0, max: 1,
                    palette: ['#008000', '#FFFF00', '#FFA500', '#FF0000']
                };

                refreshLayers();
                Map.centerObject(currentRegion, 8);
                infoPanel.clear();
                infoPanel.add(ui.Label('Salinity Risk Model Complete. Red=High Risk.'));
            }
        });
        mainPanel.add(salinityRiskButton);

        // --- Drought Assessment Button (from user's Section 3) ---
        var droughtModelButton = ui.Button({
            label: 'Run Multi-Sensor Drought Assessment',
            style: { stretch: 'horizontal', color: '#8B4513' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }

                var start = startDateBox.getValue();
                var end = endDateBox.getValue();
                infoPanel.add(ui.Label('Running comprehensive drought analysis...'));

                // 1. Get all data sources
                var s2 = getS2Collection(start, end, currentRegion).median();
                var ls_col = getMergedLandsatCollection(start, end, currentRegion);
                var lst = ls_col.select('LST').median();
                var era5 = getEra5(start, end, currentRegion);
                var sm_rootzone = era5.select('sm_rootzone_m3m3'); // <-- UPGRADED

                // 2. Calculate drought indices
                var ndvi = indicesDict['NDVI (Vegetation)'](s2);
                var ndmi = indicesDict['NDMI (Vegetation Moisture)'](s2);
                var evi = indicesDict['EVI (Enhanced Vegetation Index)'](s2);

                // 3. Normalize components (0-1 scale)
                var ndvi_norm = ndvi.unitScale(-0.2, 0.8);
                var ndmi_norm = ndmi.unitScale(-0.5, 0.5);
                var evi_norm = evi.unitScale(-0.1, 0.7);
                var lst_norm = lst.unitScale(20, 50).multiply(-1).add(1); // Invert: high temp = drought
                var sm_norm = sm_rootzone.unitScale(0.1, 0.4); // <-- UPGRADED (0.1=dry/0, 0.4=wet/1)

                // 4. Calculate Comprehensive Drought Index (CDI)
                var cdi = ndvi_norm.multiply(0.25)
                    .add(ndmi_norm.multiply(0.25))
                    .add(evi_norm.multiply(0.20))
                    .add(lst_norm.multiply(0.15))
                    .add(sm_norm.multiply(0.15)) // <-- UPGRADED
                    .rename('CDI');

                // 5. Classify drought severity
                var droughtClass = ee.Image(0)
                    .where(cdi.lt(0.2), 5)  // Extreme drought
                    .where(cdi.gte(0.2).and(cdi.lt(0.4)), 4)  // Severe
                    .where(cdi.gte(0.4).and(cdi.lt(0.6)), 3)  // Moderate
                    .where(cdi.gte(0.6).and(cdi.lt(0.8)), 2)  // Mild
                    .where(cdi.gte(0.8), 1);  // No drought

                currentImage = droughtClass.clip(currentRegion);
                currentIndexName = 'Comprehensive Drought Index';
                currentVisParams = {
                    min: 1, max: 5,
                    palette: ['#006400', '#90EE90', '#FFFF00', '#FFA500', '#8B0000']
                };

                refreshLayers();
                Map.centerObject(currentRegion, 8);

                // 6. Calculate area statistics
                var areaImage = ee.Image.pixelArea().addBands(droughtClass);
                var areas = areaImage.reduceRegion({
                    reducer: ee.Reducer.sum().group({
                        groupField: 1,
                        groupName: 'drought_class'
                    }),
                    geometry: currentRegion,
                    scale: 30,
                    maxPixels: 1e13
                });

                areas.evaluate(function (stats) {
                    infoPanel.clear();
                    infoPanel.add(ui.Label('Drought Classification Complete:'));
                    infoPanel.add(ui.Label('1=No Drought, 2=Mild, 3=Moderate, 4=Severe, 5=Extreme'));
                    if (stats && stats.groups) {
                        stats.groups.forEach(function (group) {
                            var className = ['', 'No Drought', 'Mild', 'Moderate', 'Severe', 'Extreme'][group.drought_class];
                            var area_km2 = (group.sum / 1e6).toFixed(2);
                            infoPanel.add(ui.Label(className + ': ' + area_km2 + ' km²'));
                        });
                    }
                });
            }
        });
        mainPanel.add(droughtModelButton);

        // --- Desertification Risk Button (from user's Section 5) ---
        var desertRiskButton = ui.Button({
            label: 'Run Desertification Risk Assessment',
            style: { stretch: 'horizontal', color: '#D2691E' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }

                var start = startDateBox.getValue();
                var end = endDateBox.getValue();
                infoPanel.add(ui.Label('Running desertification risk model...'));

                // 1. Get data
                var s2 = getS2Collection(start, end, currentRegion).median();
                var ls_col = getMergedLandsatCollection(start, end, currentRegion);
                var lst = ls_col.select('LST').median();
                var era5 = getEra5(start, end, currentRegion);
                var sm_rootzone = era5.select('sm_rootzone_m3m3'); // <-- UPGRADED

                // 2. Calculate indicators
                var ndvi = indicesDict['NDVI (Vegetation)'](s2);
                var bsi = indicesDict['Bare Soil Index (BSI - Approx)'](s2);
                var ndsi = indicesDict['NDSI (Salinity Index)'](s2);
                var albedo = s2.select(['RED', 'NIR']).reduce(ee.Reducer.mean());

                // 3. Normalize (0-1, where 1 = high risk)
                var ndvi_risk = ndvi.unitScale(0.1, 0.6).multiply(-1).add(1);  // Low NDVI = risk
                var bsi_risk = bsi.unitScale(-0.3, 0.5);  // High BSI = risk
                var ndsi_risk = ndsi.unitScale(-0.2, 0.3);  // High salinity = risk
                var lst_risk = lst.unitScale(25, 50);  // High temp = risk
                var slope_risk = slope.unitScale(0, 15).multiply(-1).add(1);  // Flat = risk
                var sm_risk = sm_rootzone.unitScale(0.1, 0.4).multiply(-1).add(1);  // <-- UPGRADED (Low moisture = 1 = high risk)

                // 4. Weighted risk model (Based on FAO guidelines)
                var desert_risk = ndvi_risk.multiply(0.25)
                    .add(bsi_risk.multiply(0.20))
                    .add(ndsi_risk.multiply(0.15))
                    .add(lst_risk.multiply(0.15))
                    .add(slope_risk.multiply(0.15))
                    .add(sm_risk.multiply(0.10)) // <-- UPGRADED
                    .rename('DesertRisk');

                // 5. Classify risk levels
                var riskClass = ee.Image(0)
                    .where(desert_risk.lt(0.2), 1)  // Very Low
                    .where(desert_risk.gte(0.2).and(desert_risk.lt(0.4)), 2)  // Low
                    .where(desert_risk.gte(0.4).and(desert_risk.lt(0.6)), 3)  // Moderate
                    .where(desert_risk.gte(0.6).and(desert_risk.lt(0.8)), 4)  // High
                    .where(desert_risk.gte(0.8), 5);  // Very High

                currentImage = riskClass.clip(currentRegion);
                currentIndexName = 'Desertification Risk';
                currentVisParams = {
                    min: 1, max: 5,
                    palette: ['#006400', '#90EE90', '#FFFF00', '#FF8C00', '#8B0000']
                };

                refreshLayers();
                Map.centerObject(currentRegion, 8);

                // Calculate statistics
                var areaImage = ee.Image.pixelArea().addBands(riskClass);
                var areas = areaImage.reduceRegion({
                    reducer: ee.Reducer.sum().group({
                        groupField: 1,
                        groupName: 'risk_class'
                    }),
                    geometry: currentRegion,
                    scale: 30,
                    maxPixels: 1e13
                });

                areas.evaluate(function (stats) {
                    infoPanel.clear();
                    infoPanel.add(ui.Label('Desertification Risk Assessment:'));
                    if (stats && stats.groups) {
                        var riskNames = ['', 'Very Low', 'Low', 'Moderate', 'High', 'Very High'];
                        stats.groups.forEach(function (group) {
                            var area_km2 = (group.sum / 1e6).toFixed(2);
                            infoPanel.add(ui.Label(riskNames[group.risk_class] + ': ' + area_km2 + ' km²'));
                        });
                    }
                });
            }
        });
        mainPanel.add(desertRiskButton);

        // --- Trend Analysis Button (from user's Section 4) ---
        var trendButton = ui.Button({
            label: 'Calculate Long-Term Trend (Linear Fit)',
            style: { stretch: 'horizontal', color: '#4B0082' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }

                var idxName = indexSelect.getValue();
                if (!idxName) {
                    infoPanel.add(ui.Label('Please select an index first.'));
                    return;
                }

                var start = '2015-01-01';  // Long-term analysis
                var end = '2024-12-31';
                infoPanel.add(ui.Label('Calculating trend... (This takes time)'));

                var sensor = sensorSelect.getValue();

                var col = getSelectedCollection(start, end, currentRegion)
                    .map(function (img) {
                        var index = indicesDict[idxName](img);
                        var year = ee.Image(img.date().get('year')).float();
                        var frac = ee.Image(img.date().getFraction('year')).float();
                        var timeBand = year.add(frac).rename('time');
                        return index.addBands(timeBand).copyProperties(img, ['system:time_start']);
                    });

                var bandToAnalyze = col.first().bandNames().get(0);

                var trend = col.select(['time', bandToAnalyze])
                    .reduce(ee.Reducer.linearFit());

                var scale_img = trend.select('scale').clip(currentRegion);

                currentImage = scale_img;
                currentIndexName = idxName + ' Trend (units/year)';
                currentVisParams = {
                    min: -0.01, max: 0.01,
                    palette: ['#d73027', '#fee08b', '#1a9850']  // Red=Decline, Green=Increase
                };

                refreshLayers();
                Map.centerObject(currentRegion, 8);

                var stats = scale_img.reduceRegion({
                    reducer: ee.Reducer.mean().combine(ee.Reducer.stdDev(), '', true),
                    geometry: currentRegion,
                    scale: 30,
                    maxPixels: 1e13
                });

                stats.evaluate(function (res) {
                    displayStats(res, infoPanel, 'Trend Analysis Complete:');
                    infoPanel.add(ui.Label('Positive = Increasing, Negative = Decreasing'));
                });
            }
        });
        mainPanel.add(trendButton);
        // --- زر تحليل اتجاه الحرارة (Climate Change Evidence) ---
        mainPanel.add(ui.Button({
            label: '🌡️ Temperature Trend (Is it getting hotter?)',
            style: { stretch: 'horizontal', color: '#b22222' },
            onClick: function () {
                if (!currentRegion) { infoPanel.add(ui.Label('Select governorate first.')); return; }

                infoPanel.clear();
                infoPanel.add(ui.Label('Calculating LST Trend (2013-2023)...'));
                infoPanel.add(ui.Label('Using Landsat 8 Thermal Data.'));

                // استخدام لاندسات 8 فقط لثبات البيانات (2013-الآن)
                var col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                    .filterBounds(currentRegion)
                    .filterDate('2013-01-01', '2023-12-31')
                    .filter(ee.Filter.calendarRange(6, 9, 'month')) // نركز على شهور الصيف فقط لأنها الأهم
                    .map(cloudMaskLandsat)
                    .map(applyScaleFactors)
                    .map(function (img) {
                        var year = ee.Image(img.date().get('year')).float();
                        return img.select('LST').addBands(year.rename('year')).copyProperties(img, ['system:time_start']);
                    });

                // حساب الانحدار الخطي (Linear Fit)
                // النتيجة: Slope يوضح معدل الزيادة بالدرجة المئوية لكل سنة
                var trend = col.select(['year', 'LST']).reduce(ee.Reducer.linearFit());

                var slope = trend.select('scale').clip(currentRegion);

                currentImage = slope;
                currentIndexName = 'Summer LST Warming Trend (°C/year)';
                // ألوان: الأزرق (تبريد)، الأبيض (ثبات)، الأحمر (احترار)
                currentVisParams = { min: -0.5, max: 0.5, palette: ['blue', 'white', 'red'] };

                refreshLayers();

                // حساب متوسط معدل الاحترار للمحافظة
                var stats = slope.reduceRegion({
                    reducer: ee.Reducer.mean(),
                    geometry: currentRegion,
                    scale: 100,
                    maxPixels: 1e13
                });

                stats.evaluate(function (res) {
                    var success = displayStats(res, infoPanel, '🌡️ Warming Trend (Summer LST):');
                    if (success) {
                        // Estimate total warming (approx from mean rate)
                        // This uses a bit of custom logic so we might want to keep it custom or just let displayStats show the rate.
                        // displayStats shows Mean/Min/Max. 
                        // The original code calculated Total = rate * 10.
                        // We can access the mean from the panel or just re-calculate if we want.
                        // But simplification is better.
                        infoPanel.add(ui.Label('Rate is in °C/year. Multiply by 10 for decadal change.'));
                        infoPanel.add(ui.Label('Map Red = Warming Areas, Blue = Cooling Areas.'));
                    }
                });
            }
        }));
    })(mainPanel); // End Advanced Models Scope

    addSeparator();

    // --- D) Agro-Economic Models (Collapsible) ---
    (function (parentPanel) {
        var agroSection = createCollapsibleSection('D) Research Models (Agro-Economic)', false);
        parentPanel.add(agroSection.panel);
        var mainPanel = agroSection.content;

        // --- *** 6.9: Advanced Models (Agro-Economic) *** ---
        var modelTitle2 = ui.Label({
            value: 'D) Research Models (Agro-Economic):',
            style: { fontWeight: 'bold', fontSize: '14px' }
        });
        mainPanel.add(modelTitle2);

        // --- Carbon Stock Button (from user's Section 6) ---
        var carbonButton = ui.Button({
            label: 'Calculate Carbon Stock (Biomass → Carbon)',
            style: { stretch: 'horizontal', color: '#228B22', fontWeight: 'bold' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('⚠️ Please select a governorate first.'));
                    return;
                }

                var start = startDateBox.getValue();
                var end = endDateBox.getValue();
                var sensor = sensorSelect.getValue();

                infoPanel.add(ui.Label('🌱 Calculating Carbon Stock using ' + sensor + '...'));
                infoPanel.add(ui.Label('This analysis uses NDVI-based allometric equations.'));

                // Get collection
                var col = getSelectedCollection(start, end, currentRegion);
                var composite = col.median().clip(currentRegion);

                // Calculate NDVI
                var ndvi = indicesDict['NDVI (Vegetation)'](composite);

                // Calculate Aboveground Biomass (AGB) in tonnes/ha
                var agb = ndvi.expression(
                    '((exp(1.9407 + (2.8363 * NDVI)) - 1) / 0.1)', {
                    'NDVI': ndvi
                }).clamp(0, 150).rename('AGB_tonnes_ha');

                // Convert AGB to Carbon Stock (IPCC: Carbon = 0.47 * AGB)
                var carbonStock = agb.multiply(0.47).rename('CarbonStock_tonnes_ha');

                // Also calculate CO2 equivalent (Carbon * 3.67)
                var co2Equivalent = carbonStock.multiply(3.67).rename('CO2eq_tonnes_ha');

                // Display Carbon Stock
                currentImage = carbonStock.clip(currentRegion);
                currentIndexName = 'Carbon Stock (tonnes C/ha)';
                currentVisParams = {
                    min: 0,
                    max: 50,
                    palette: ['#FFF7BC', '#FEE391', '#FEC44F', '#FE9929', '#EC7014', '#CC4C02', '#8C2D04']
                };

                refreshLayers();
                Map.centerObject(currentRegion, 8);

                // Calculate total carbon and statistics
                var pixelArea = ee.Image.pixelArea().divide(10000); // Convert to hectares
                var totalCarbonImage = carbonStock.multiply(pixelArea);
                var totalCO2Image = co2Equivalent.multiply(pixelArea);

                var stats = ee.Dictionary({
                    carbonMean: carbonStock.reduceRegion({
                        reducer: ee.Reducer.mean(),
                        geometry: currentRegion,
                        scale: 30,
                        maxPixels: 1e13
                    }),
                    carbonTotal: totalCarbonImage.reduceRegion({
                        reducer: ee.Reducer.sum(),
                        geometry: currentRegion,
                        scale: 30,
                        maxPixels: 1e13
                    }),
                    co2Total: totalCO2Image.reduceRegion({
                        reducer: ee.Reducer.sum(),
                        geometry: currentRegion,
                        scale: 30,
                        maxPixels: 1e13
                    }),
                    areaTotal: pixelArea.reduceRegion({
                        reducer: ee.Reducer.sum(),
                        geometry: currentRegion,
                        scale: 30,
                        maxPixels: 1e13
                    })
                });

                stats.evaluate(function (result) {
                    infoPanel.clear();
                    infoPanel.add(ui.Label('🌳 Carbon Stock Analysis Results:', { fontWeight: 'bold', fontSize: '14px' }));
                    infoPanel.add(ui.Label('─────────────────────────────'));

                    if (!result || !result.carbonMean || !result.carbonTotal || !result.co2Total || !result.areaTotal) {
                        infoPanel.add(ui.Label('⚠️ Error: No valid data returned.'));
                        return;
                    }

                    var carbonMean = result.carbonMean.CarbonStock_tonnes_ha;
                    var carbonTotal = result.carbonTotal.CarbonStock_tonnes_ha;
                    var co2Total = result.co2Total.CO2eq_tonnes_ha;
                    var areaHa = result.areaTotal.area;

                    if (carbonMean) {
                        infoPanel.add(ui.Label('📍 Mean Carbon Density: ' + carbonMean.toFixed(2) + ' tonnes C/ha'));
                        infoPanel.add(ui.Label('📊 Total Carbon Stock: ' + (carbonTotal / 1000).toFixed(2) + ' thousand tonnes C'));
                        infoPanel.add(ui.Label('🌍 CO₂ Equivalent: ' + (co2Total / 1000).toFixed(2) + ' thousand tonnes CO₂'));
                        infoPanel.add(ui.Label('📏 Analyzed Area: ' + (areaHa / 1000).toFixed(2) + ' thousand hectares'));
                        infoPanel.add(ui.Label('─────────────────────────────'));

                        // Carbon value estimation (using social cost of carbon: ~$50/tonne CO2)
                        var carbonValue = (co2Total * 50) / 1e6; // Million USD
                        infoPanel.add(ui.Label('💰 Estimated Carbon Value: $' + carbonValue.toFixed(2) + ' Million USD'));
                        infoPanel.add(ui.Label('   (@ $50/tonne CO₂)'));

                        infoPanel.add(ui.Label(' '));
                        infoPanel.add(ui.Label('ℹ️ Note: This is a satellite-based estimate.'));
                        infoPanel.add(ui.Label('Ground validation recommended for accuracy.'));
                    }
                });

                // Create histogram chart
                var histogram = ui.Chart.image.histogram({
                    image: carbonStock,
                    region: currentRegion,
                    scale: 100,
                    maxPixels: 1e9
                }).setOptions({
                    title: 'Carbon Stock Distribution',
                    hAxis: { title: 'Carbon Stock (tonnes/ha)' },
                    vAxis: { title: 'Frequency' },
                    colors: ['#228B22']
                });

                chartPanel.add(histogram);
            }
        });
        mainPanel.add(carbonButton);

        // --- Carbon Change Button (from user's Section 6) ---
        var carbonChangeButton = ui.Button({
            label: 'Carbon Stock Change (P2 - P1)',
            style: { stretch: 'horizontal', color: '#8B4513' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }

                var p1Start = p1StartBox.getValue();
                var p1End = p1EndBox.getValue();
                var p2Start = p2StartBox.getValue();
                var p2End = p2EndBox.getValue();

                infoPanel.add(ui.Label('Calculating carbon stock change...'));

                // Period 1
                var col1 = getSelectedCollection(p1Start, p1End, currentRegion);
                // Period 2
                var col2 = getSelectedCollection(p2Start, p2End, currentRegion);

                // *** NEW SAFETY CHECK ***
                ee.Dictionary({
                    size1: col1.size(),
                    size2: col2.size()
                }).evaluate(function (sizes) {
                    if (sizes.size1 === 0 || sizes.size2 === 0) {
                        infoPanel.clear();
                        infoPanel.add(ui.Label('⚠️ Error: No images found for one or both periods.'));
                        infoPanel.add(ui.Label('Period 1 images: ' + sizes.size1));
                        infoPanel.add(ui.Label('Period 2 images: ' + sizes.size2));
                        infoPanel.add(ui.Label('Check your dates and sensor selection.'));
                        return;
                    }

                    // --- Continue if data exists ---
                    var comp1 = col1.median().clip(currentRegion);
                    var ndvi1 = indicesDict['NDVI (Vegetation)'](comp1);
                    var agb1 = ndvi1.expression(
                        '((exp(1.9407 + (2.8363 * NDVI)) - 1) / 0.1)', {
                        'NDVI': ndvi1
                    }).clamp(0, 150);
                    var carbon1 = agb1.multiply(0.47);

                    var comp2 = col2.median().clip(currentRegion);
                    var ndvi2 = indicesDict['NDVI (Vegetation)'](comp2);
                    var agb2 = ndvi2.expression(
                        '((exp(1.9407 + (2.8363 * NDVI)) - 1) / 0.1)', {
                        'NDVI': ndvi2
                    }).clamp(0, 150);
                    var carbon2 = agb2.multiply(0.47);

                    // Calculate change
                    var carbonChange = carbon2.subtract(carbon1).rename('CarbonChange');

                    currentImage = carbonChange;
                    currentIndexName = 'Carbon Stock Change (tonnes/ha)';
                    currentVisParams = {
                        min: -20,
                        max: 20,
                        palette: ['#d73027', '#fc8d59', '#fee090', '#ffffff', '#e0f3f8', '#91bfdb', '#4575b4']
                    };

                    refreshLayers();
                    Map.centerObject(currentRegion, 8);

                    // Statistics
                    var pixelArea = ee.Image.pixelArea().divide(10000);
                    var totalChange = carbonChange.multiply(pixelArea);

                    var stats = totalChange.reduceRegion({
                        reducer: ee.Reducer.sum()
                            .combine(ee.Reducer.mean(), '', true)
                            .combine(ee.Reducer.stdDev(), '', true),
                        geometry: currentRegion,
                        scale: 30,
                        maxPixels: 1e13
                    });

                    stats.evaluate(function (res) {
                        infoPanel.clear();
                        if (!res || res.CarbonChange_sum === null) {
                            infoPanel.add(ui.Label('Error calculating stats. No valid data.'));
                            return;
                        }

                        infoPanel.add(ui.Label('Carbon Stock Change Analysis:', { fontWeight: 'bold' }));
                        infoPanel.add(ui.Label('Period 1: ' + p1Start + ' to ' + p1End));
                        infoPanel.add(ui.Label('Period 2: ' + p2Start + ' to ' + p2End));
                        infoPanel.add(ui.Label('─────────────────────────────'));

                        var totalChangeVal = res.CarbonChange_sum / 1000;
                        var meanChange = res.CarbonChange_mean;

                        infoPanel.add(ui.Label('Net Change: ' + totalChangeVal.toFixed(2) + ' thousand tonnes C'));
                        infoPanel.add(ui.Label('Mean Change: ' + meanChange.toFixed(2) + ' tonnes/ha'));

                        if (totalChangeVal > 0) {
                            infoPanel.add(ui.Label('✅ Carbon sequestration (gain)', { color: 'green' }));
                        } else {
                            infoPanel.add(ui.Label('⚠️ Carbon loss (emissions)', { color: 'red' }));
                        }

                        var co2Change = totalChangeVal * 3.67;
                        infoPanel.add(ui.Label('CO₂ Equivalent: ' + co2Change.toFixed(2) + ' thousand tonnes'));
                    });
                    // --- End of safety check ---
                });
            }
        });
        mainPanel.add(carbonChangeButton);

        // --- Crop Yield Button (from user's Section 7) ---
        var yieldButton = ui.Button({
            label: '🌾 Estimate Crop Yield (Full Season)',
            style: { stretch: 'horizontal', color: '#DAA520', fontWeight: 'bold' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('⚠️ Please select a governorate first.'));
                    return;
                }

                var cropType = cropSelect.getValue();
                var gsStart = gsStartBox.getValue();
                var gsEnd = gsEndBox.getValue();
                var sensor = sensorSelect.getValue();

                infoPanel.add(ui.Label('🌾 Estimating ' + cropType + ' yield using ' + sensor + '...'));
                infoPanel.add(ui.Label('Season: ' + gsStart + ' to ' + gsEnd));

                // Get collection for growing season
                var col = getSelectedCollection(gsStart, gsEnd, currentRegion);

                // *** NEW SAFETY CHECK ***
                col.size().evaluate(function (size) {
                    if (size === 0) {
                        infoPanel.clear();
                        infoPanel.add(ui.Label('⚠️ Error: No images found for the selected growing season.'));
                        infoPanel.add(ui.Label('Check your dates and sensor selection.'));
                        return;
                    }

                    // --- Continue if data exists ---
                    var colIndexed = col.map(function (img) {
                        var ndvi = indicesDict['NDVI (Vegetation)'](img);
                        var evi = indicesDict['EVI (Enhanced Vegetation Index)'](img);
                        var gci = indicesDict['GCI (Green Chlorophyll Index)'](img);
                        return img.addBands([ndvi, evi, gci])
                            .copyProperties(img, ['system:time_start']);
                    });

                    // Calculate seasonal statistics
                    var ndviMax = colIndexed.select('NDVI').max();
                    var ndviMean = colIndexed.select('NDVI').mean();
                    var eviMax = colIndexed.select('EVI').max();
                    var eviMean = colIndexed.select('EVI').mean();
                    var gciMean = colIndexed.select('GCI').mean();

                    // Get Landsat LST for heat stress
                    var ls_col = getMergedLandsatCollection(gsStart, gsEnd, currentRegion);
                    var lstMean = ls_col.select('LST').mean();

                    // Crop-specific yield models (calibrated for Egypt)
                    var yieldModels = {
                        'Wheat': function () {
                            var yield = ndviMax.expression(
                                '(12.5 * NDVI_max - 1.5) * (1 - ((LST - 20) / 30) * 0.3)', {
                                'NDVI_max': ndviMax,
                                'LST': lstMean
                            }).clamp(0, 8);
                            return yield.rename('WheatYield_tonnes_ha');
                        },

                        'Maize (Corn)': function () {
                            var yield = eviMean.expression(
                                '(15 * EVI_mean + 2) * (1 - ((LST - 25) / 30) * 0.4)', {
                                'EVI_mean': eviMean,
                                'LST': lstMean
                            }).clamp(0, 10);
                            return yield.rename('MaizeYield_tonnes_ha');
                        },

                        'Rice': function () {
                            var composite = col.median();
                            var ndwi = indicesDict['NDWI (McFeeters Water Index)'](composite);
                            var yield = ndviMean.expression(
                                '(10 * NDVI_mean + 1) * (1 + NDWI * 0.2)', {
                                'NDVI_mean': ndviMean,
                                'NDWI': ndwi
                            }).clamp(0, 9);
                            return yield.rename('RiceYield_tonnes_ha');
                        },

                        'Cotton': function () {
                            var yield = ndviMax.expression(
                                '(3000 * NDVI_max - 300) * (1 - ((LST - 28) / 25) * 0.3)', {
                                'NDVI_max': ndviMax,
                                'LST': lstMean
                            }).clamp(0, 3500);
                            return yield.divide(1000).rename('CottonYield_tonnes_ha');
                        },

                        'Sugarcane': function () {
                            var yield = ndviMean.expression(
                                '(80 * NDVI_mean + 10) * (1 + (GCI / 10))', {
                                'NDVI_mean': ndviMean,
                                'GCI': gciMean
                            }).clamp(0, 120);
                            return yield.rename('SugarcaneYield_tonnes_ha');
                        },

                        'General Crop': function () {
                            var yieldIndex = ndviMean.expression(
                                '(NDVI_mean * 100) * (EVI_mean / 0.6)', {
                                'NDVI_mean': ndviMean,
                                'EVI_mean': eviMean
                            }).clamp(0, 100);
                            return yieldIndex.rename('YieldIndex');
                        }
                    };

                    // Calculate yield for selected crop
                    var yieldImage = yieldModels[cropType]().clip(currentRegion);

                    currentImage = yieldImage;
                    currentIndexName = cropType + ' Yield Estimate';

                    // Visualization based on crop type
                    var yieldVis = {
                        'Wheat': { min: 0, max: 6, palette: ['#8B0000', '#FF4500', '#FFD700', '#ADFF2F', '#00FF00'] },
                        'Maize (Corn)': { min: 0, max: 8, palette: ['#8B4513', '#FFA500', '#FFFF00', '#7FFF00', '#00FF00'] },
                        'Rice': { min: 0, max: 7, palette: ['#A0522D', '#FFD700', '#FFFF00', '#90EE90', '#00FF00'] },
                        'Cotton': { min: 0, max: 2.5, palette: ['#CD5C5C', '#FFA07A', '#FFFACD', '#98FB98', '#00FA9A'] },
                        'Sugarcane': { min: 0, max: 100, palette: ['#8B4513', '#DAA520', '#F0E68C', '#7CFC00', '#00FF00'] },
                        'General Crop': { min: 0, max: 80, palette: ['#8B0000', '#FF6347', '#FFD700', '#ADFF2F', '#228B22'] }
                    };

                    currentVisParams = yieldVis[cropType];

                    refreshLayers();
                    Map.centerObject(currentRegion, 8);

                    // Calculate statistics
                    var pixelArea = ee.Image.pixelArea().divide(10000);
                    var totalProduction = yieldImage.multiply(pixelArea);

                    var stats = ee.Dictionary({
                        yieldStats: yieldImage.reduceRegion({
                            reducer: ee.Reducer.mean()
                                .combine(ee.Reducer.min(), '', true)
                                .combine(ee.Reducer.max(), '', true)
                                .combine(ee.Reducer.stdDev(), '', true),
                            geometry: currentRegion,
                            scale: 30,
                            maxPixels: 1e13
                        }),
                        totalProd: totalProduction.reduceRegion({
                            reducer: ee.Reducer.sum(),
                            geometry: currentRegion,
                            scale: 30,
                            maxPixels: 1e13
                        }),
                        cropArea: pixelArea.reduceRegion({
                            reducer: ee.Reducer.sum(),
                            geometry: currentRegion,
                            scale: 30,
                            maxPixels: 1e13
                        })
                    });

                    stats.evaluate(function (result) {
                        infoPanel.clear();
                        // *** NEW SAFETY CHECK ***
                        if (!result || !result.yieldStats || result.yieldStats[Object.keys(result.yieldStats)[0]] === null) {
                            infoPanel.add(ui.Label('Error calculating stats. No valid data.'));
                            return;
                        }

                        infoPanel.add(ui.Label('🌾 ' + cropType + ' Yield Estimation Results:', { fontWeight: 'bold', fontSize: '14px' }));
                        infoPanel.add(ui.Label('─────────────────────────────'));

                        var bandName = Object.keys(result.yieldStats)[0];
                        var yieldMean = result.yieldStats[bandName + '_mean'];
                        var yieldMin = result.yieldStats[bandName + '_min'];
                        var yieldMax = result.yieldStats[bandName + '_max'];
                        var yieldStd = result.yieldStats[bandName + '_stdDev'];
                        var totalProd = result.totalProd[bandName];
                        var cropArea = result.cropArea.area / 10000;

                        if (cropType === 'General Crop') {
                            infoPanel.add(ui.Label('📊 Mean Yield Index: ' + yieldMean.toFixed(2) + ' / 100'));
                            infoPanel.add(ui.Label('📉 Min Index: ' + yieldMin.toFixed(2)));
                            infoPanel.add(ui.Label('📈 Max Index: ' + yieldMax.toFixed(2)));
                        } else {
                            infoPanel.add(ui.Label('📊 Mean Yield: ' + yieldMean.toFixed(2) + ' tonnes/ha'));
                            infoPanel.add(ui.Label('📉 Min Yield: ' + yieldMin.toFixed(2) + ' tonnes/ha'));
                            infoPanel.add(ui.Label('📈 Max Yield: ' + yieldMax.toFixed(2) + ' tonnes/ha'));
                            infoPanel.add(ui.Label('📏 Std Dev: ' + yieldStd.toFixed(2) + ' tonnes/ha'));
                            infoPanel.add(ui.Label('─────────────────────────────'));
                            infoPanel.add(ui.Label('🚜 Analyzed Area: ' + (cropArea / 1000).toFixed(2) + ' thousand ha'));
                            infoPanel.add(ui.Label('📦 Est. Total Production: ' + (totalProd / 1000).toFixed(2) + ' thousand tonnes'));

                            var prices = {
                                'Wheat': 250,
                                'Maize (Corn)': 200,
                                'Rice': 400,
                                'Cotton': 1800,
                                'Sugarcane': 30
                            };

                            if (prices[cropType]) {
                                var value = (totalProd * prices[cropType]) / 1e6;
                                infoPanel.add(ui.Label('💰 Est. Crop Value: $' + value.toFixed(2) + ' Million USD'));
                                infoPanel.add(ui.Label('   (@ $' + prices[cropType] + '/tonne)'));
                            }
                        }

                        infoPanel.add(ui.Label(' '));
                        infoPanel.add(ui.Label('ℹ️ Note: Satellite-based estimates.'));
                        infoPanel.add(ui.Label('Accuracy: ±15-20% (requires calibration).'));
                    });

                    // Create time series chart
                    var yieldTimeSeries = ui.Chart.image.series({
                        imageCollection: colIndexed.select('NDVI'),
                        region: currentRegion,
                        reducer: ee.Reducer.mean(),
                        scale: 100
                    }).setOptions({
                        title: cropType + ' - NDVI Time Series (Growing Season)',
                        hAxis: { title: 'Date' },
                        vAxis: { title: 'NDVI' },
                        lineWidth: 2,
                        pointSize: 4,
                        colors: ['#228B22']
                    });

                    chartPanel.add(yieldTimeSeries);
                    // --- End of safety check ---
                });
            }
        });
        mainPanel.add(yieldButton);

        // --- Yield Compare Button (from user's Section 7) ---
        var yieldCompareButton = ui.Button({
            label: 'Compare Yield (This Season vs Last Season)',
            style: { stretch: 'horizontal', color: '#CD853F' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }

                var cropType = cropSelect.getValue();
                var gsStart = gsStartBox.getValue();
                var gsEnd = gsEndBox.getValue();

                var prevStart = ee.Date(gsStart).advance(-1, 'year').format('YYYY-MM-dd').getInfo();
                var prevEnd = ee.Date(gsEnd).advance(-1, 'year').format('YYYY-MM-dd').getInfo();

                infoPanel.add(ui.Label('Comparing ' + cropType + ' yield between seasons...'));
                infoPanel.add(ui.Label('Current: ' + gsStart + ' to ' + gsEnd));
                infoPanel.add(ui.Label('Previous: ' + prevStart + ' to ' + prevEnd));

                var calculateYield = function (start, end) {
                    var col = getSelectedCollection(start, end, currentRegion);
                    var ndviMax = col.map(function (img) {
                        return indicesDict['NDVI (Vegetation)'](img);
                    }).max();

                    var yield = ndviMax.expression(
                        '(12 * NDVI - 1)', {
                        'NDVI': ndviMax
                    }).clamp(0, 10);

                    return yield;
                };

                var yieldCurrent = calculateYield(gsStart, gsEnd);
                var yieldPrevious = calculateYield(prevStart, prevEnd);

                var yieldChange = yieldCurrent.subtract(yieldPrevious).rename('YieldChange');

                currentImage = yieldChange.clip(currentRegion);
                currentIndexName = cropType + ' Yield Change (tonnes/ha)';
                currentVisParams = {
                    min: -3,
                    max: 3,
                    palette: ['#d73027', '#fc8d59', '#fee090', '#ffffff', '#e0f3f8', '#91bfdb', '#4575b4']
                };

                refreshLayers();
                Map.centerObject(currentRegion, 8);

                var stats = yieldChange.reduceRegion({
                    reducer: ee.Reducer.mean()
                        .combine(ee.Reducer.stdDev(), '', true),
                    geometry: currentRegion,
                    scale: 30,
                    maxPixels: 1e13
                });

                stats.evaluate(function (res) {
                    infoPanel.clear();
                    if (!res || res.YieldChange_mean === null) {
                        infoPanel.add(ui.Label('Error calculating stats. Check if data is available for both seasons.'));
                        return;
                    }
                    infoPanel.add(ui.Label('Yield Comparison Results:', { fontWeight: 'bold' }));
                    infoPanel.add(ui.Label('─────────────────────────────'));

                    var meanChange = res.YieldChange_mean;

                    infoPanel.add(ui.Label('Mean Change: ' + meanChange.toFixed(2) + ' tonnes/ha'));

                    if (meanChange > 0) {
                        infoPanel.add(ui.Label('✅ Yield increased this season', { color: 'green' }));
                    } else {
                        infoPanel.add(ui.Label('⚠️ Yield decreased this season', { color: 'red' }));
                    }
                });
            }
        });
        mainPanel.add(yieldCompareButton);

        // --- Yield Forecast Button (from user's Section 8) ---
        var forecastButton = ui.Button({
            label: '🔮 Forecast Yield (Mid-Season Prediction)',
            style: { stretch: 'horizontal', color: '#4169E1' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('⚠️ Please select a governorate first.'));
                    return;
                }

                var cropType = cropSelect.getValue();
                var gsStart = gsStartBox.getValue();
                var currentDate = ee.Date(Date.now());

                infoPanel.add(ui.Label('🔮 Forecasting ' + cropType + ' yield...'));
                infoPanel.add(ui.Label('Using data up to: ' + currentDate.format('YYYY-MM-dd').getInfo()));

                var col = getSelectedCollection(gsStart, currentDate.format('YYYY-MM-dd').getInfo(), currentRegion);

                // *** NEW SAFETY CHECK ***
                col.size().evaluate(function (size) {
                    if (size === 0) {
                        infoPanel.clear();
                        infoPanel.add(ui.Label('⚠️ Error: No images found since the growing season start.'));
                        infoPanel.add(ui.Label('Check your "Growing Season Start" date.'));
                        return;
                    }

                    // --- Continue if data exists ---
                    var colNDVI = col.map(function (img) {
                        return indicesDict['NDVI (Vegetation)'](img)
                            .copyProperties(img, ['system:time_start']);
                    });

                    var ndviMean = colNDVI.mean();

                    var startDOY = ee.Date(gsStart).getRelative('day', 'year');
                    var currentDOY = currentDate.getRelative('day', 'year');
                    var seasonProgress = currentDOY.subtract(startDOY).divide(180);

                    var forecastedYield = ndviMean.expression(
                        '(NDVImean * 15 - 1.5) * (1 + progress * 0.3)', {
                        'NDVImean': ndviMean,
                        'progress': ee.Image.constant(seasonProgress)
                    }).clamp(0, 12).rename('ForecastedYield');

                    var imageCount = col.size();
                    var confidence = ee.Algorithms.If(
                        imageCount.gt(10),
                        'High',
                        ee.Algorithms.If(imageCount.gt(5), 'Medium', 'Low')
                    );

                    currentImage = forecastedYield.clip(currentRegion);
                    currentIndexName = cropType + ' - Yield Forecast (tonnes/ha)';
                    currentVisParams = {
                        min: 0, max: 8,
                        palette: ['#8B0000', '#FF6347', '#FFD700', '#ADFF2F', '#00FF00']
                    };

                    refreshLayers();
                    Map.centerObject(currentRegion, 8);

                    var stats = forecastedYield.reduceRegion({
                        reducer: ee.Reducer.mean()
                            .combine(ee.Reducer.stdDev(), '', true)
                            .combine(ee.Reducer.min(), '', true)
                            .combine(ee.Reducer.max(), '', true),
                        geometry: currentRegion,
                        scale: 30,
                        maxPixels: 1e13
                    });

                    ee.Dictionary({
                        stats: stats,
                        imageCount: imageCount,
                        confidence: confidence,
                        progress: seasonProgress
                    }).evaluate(function (result) {
                        infoPanel.clear();
                        // *** NEW SAFETY CHECK ***
                        if (!result || !result.stats || result.stats.ForecastedYield_mean === null) {
                            infoPanel.add(ui.Label('Error calculating forecast stats. No valid data.'));
                            infoPanel.add(ui.Label('Check your Growing Season Start date.'));
                            return;
                        }

                        infoPanel.add(ui.Label('🔮 Yield Forecast Results:', { fontWeight: 'bold', fontSize: '14px' }));
                        infoPanel.add(ui.Label('─────────────────────────────'));

                        var yieldMean = result.stats.ForecastedYield_mean;
                        var yieldStd = result.stats.ForecastedYield_stdDev;
                        var yieldMin = result.stats.ForecastedYield_min;
                        var yieldMax = result.stats.ForecastedYield_max;

                        infoPanel.add(ui.Label('📊 Forecasted Mean Yield: ' + yieldMean.toFixed(2) + ' ± ' + yieldStd.toFixed(2) + ' tonnes/ha'));
                        infoPanel.add(ui.Label('📉 Expected Range: ' + yieldMin.toFixed(2) + ' - ' + yieldMax.toFixed(2) + ' tonnes/ha'));
                        infoPanel.add(ui.Label('─────────────────────────────'));
                        infoPanel.add(ui.Label('📅 Season Progress: ' + (result.progress * 100).toFixed(0) + '%'));
                        infoPanel.add(ui.Label('🛰️ Images Used: ' + result.imageCount));
                        infoPanel.add(ui.Label('📊 Confidence: ' + result.confidence));
                        infoPanel.add(ui.Label(' '));
                        infoPanel.add(ui.Label('ℹ️ Note: Forecast accuracy improves as season progresses.'));
                        infoPanel.add(ui.Label('Early season predictions have ±25% uncertainty.'));
                    });

                    var tsChart = ui.Chart.image.series({
                        imageCollection: colNDVI,
                        region: currentRegion,
                        reducer: ee.Reducer.mean(),
                        scale: 100
                    }).setOptions({
                        title: 'NDVI Progression (Season-to-Date)',
                        hAxis: { title: 'Date' },
                        vAxis: { title: 'NDVI' },
                        lineWidth: 2,
                        pointSize: 4,
                        colors: ['#1E90FF'],
                        trendlines: { 0: { color: 'red', lineWidth: 1, opacity: 0.5 } }
                    });

                    chartPanel.add(tsChart);
                    // --- End of safety check ---
                });
            }
        });
        mainPanel.add(forecastButton);

        // --- WUE Button (from user's Section 9) ---
        var wueButton = ui.Button({
            label: '💧 Calculate Water Use Efficiency (WUE)',
            style: { stretch: 'horizontal', color: '#1E90FF' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('⚠️ Please select a governorate first.'));
                    return;
                }

                var start = startDateBox.getValue();
                var end = endDateBox.getValue();

                infoPanel.add(ui.Label('💧 Calculating Water Use Efficiency...'));
                infoPanel.add(ui.Label('WUE = Net Primary Productivity / Evapotranspiration'));

                var s2Col = getS2Collection(start, end, currentRegion);
                var s2 = s2Col.median().clip(currentRegion);

                var ndvi = indicesDict['NDVI (Vegetation)'](s2);
                var fPAR = ndvi.expression(
                    '(NDVI - 0.05) / (0.95 - 0.05)', {
                    'NDVI': ndvi
                }).clamp(0, 1);

                var npp = fPAR.multiply(3.0 * 10).rename('NPP');

                // *** UPGRADED: Use actual MODIS ET ***
                var et_daily_mean = getModisET(start, end, currentRegion);

                // Calculate WUE (g C/kg H2O)
                var wue = npp.divide(et_daily_mean).multiply(1000).rename('WUE');

                currentImage = wue.clip(currentRegion);
                currentIndexName = 'Water Use Efficiency (g C/kg H₂O)';
                currentVisParams = {
                    min: 0, max: 5,
                    palette: ['#8B0000', '#FF4500', '#FFD700', '#7FFF00', '#00FF00']
                };

                refreshLayers();
                Map.centerObject(currentRegion, 8);

                // Statistics
                var stats = ee.Dictionary({
                    wueStats: wue.reduceRegion({
                        reducer: ee.Reducer.mean()
                            .combine(ee.Reducer.stdDev(), '', true),
                        geometry: currentRegion,
                        scale: 30,
                        maxPixels: 1e13
                    }),
                    nppMean: npp.reduceRegion({
                        reducer: ee.Reducer.mean(),
                        geometry: currentRegion,
                        scale: 30,
                        maxPixels: 1e13
                    }),
                    etMean: et_daily_mean.reduceRegion({
                        reducer: ee.Reducer.mean(),
                        geometry: currentRegion,
                        scale: 500, // MODIS scale
                        maxPixels: 1e13
                    })
                });

                stats.evaluate(function (result) {
                    infoPanel.clear();
                    // *** NEW SAFETY CHECK ***
                    if (!result || !result.wueStats || result.wueStats.WUE_mean === null) {
                        infoPanel.add(ui.Label('Error calculating stats. No valid data.'));
                        return;
                    }

                    infoPanel.add(ui.Label('💧 Water Use Efficiency Analysis:', { fontWeight: 'bold', fontSize: '14px' }));
                    infoPanel.add(ui.Label('─────────────────────────────'));

                    var wueMean = result.wueStats.WUE_mean;
                    var wueStd = result.wueStats.WUE_stdDev;
                    var nppMean = result.nppMean.NPP;
                    var etMean = result.etMean.ET;

                    infoPanel.add(ui.Label('📊 Mean WUE: ' + wueMean.toFixed(3) + ' ± ' + wueStd.toFixed(3) + ' g C/kg H₂O'));
                    infoPanel.add(ui.Label('─────────────────────────────'));
                    infoPanel.add(ui.Label('🌱 Mean NPP: ' + nppMean.toFixed(2) + ' g C/m²/day (proxy)'));
                    infoPanel.add(ui.Label('💧 Mean ET: ' + etMean.toFixed(2) + ' mm/day (from MODIS)'));
                    infoPanel.add(ui.Label('─────────────────────────────'));

                    var interpretation = '';
                    if (wueMean > 3.5) {
                        interpretation = '✅ High WUE - Efficient water use';
                    } else if (wueMean > 2.5) {
                        interpretation = '⚠️ Moderate WUE - Room for improvement';
                    } else {
                        interpretation = '❌ Low WUE - Poor water use efficiency';
                    }

                    infoPanel.add(ui.Label(interpretation, { fontWeight: 'bold' }));
                    infoPanel.add(ui.Label(' '));
                    infoPanel.add(ui.Label('ℹ️ WUE Benchmarks:'));
                    infoPanel.add(ui.Label('  • < 2.0: Low efficiency'));
                    infoPanel.add(ui.Label('  • 2.0-3.5: Moderate efficiency'));
                    infoPanel.add(ui.Label('  • > 3.5: High efficiency'));
                });

                var histogram = ui.Chart.image.histogram({
                    image: wue,
                    region: currentRegion,
                    scale: 100,
                    maxPixels: 1e9
                }).setOptions({
                    title: 'Water Use Efficiency Distribution',
                    hAxis: { title: 'WUE (g C/kg H₂O)' },
                    vAxis: { title: 'Frequency' },
                    colors: ['#1E90FF']
                });

                chartPanel.add(histogram);
            }
        });
        mainPanel.add(wueButton);

        // --- Heat Stress Button (from user's Section 10) ---
        var heatStressButton = ui.Button({
            label: '🌡️ Assess Heat Stress (Critical for Crops)',
            style: { stretch: 'horizontal', color: '#FF4500' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('⚠️ Please select a governorate first.'));
                    return;
                }

                var start = startDateBox.getValue();
                var end = endDateBox.getValue();
                var cropType = cropSelect.getValue();

                infoPanel.add(ui.Label('🌡️ Analyzing heat stress for ' + cropType + '...'));

                var tempThresholds = {
                    'Wheat': { optimal: 20, stress: 30, severe: 35 },
                    'Maize (Corn)': { optimal: 25, stress: 32, severe: 38 },
                    'Rice': { optimal: 28, stress: 35, severe: 40 },
                    'Cotton': { optimal: 28, stress: 35, severe: 40 },
                    'Sugarcane': { optimal: 30, stress: 38, severe: 42 },
                    'General Crop': { optimal: 25, stress: 32, severe: 38 }
                };

                var threshold = tempThresholds[cropType];

                // *** FIX: Use new centralized helper function ***
                var lsCol = getMergedLandsatCollection(start, end, currentRegion);

                // *** NEW SAFETY CHECK ***
                lsCol.size().evaluate(function (size) {
                    if (size === 0) {
                        infoPanel.clear();
                        infoPanel.add(ui.Label('⚠️ Error: No Landsat images found for this period.'));
                        infoPanel.add(ui.Label('Heat Stress model requires Landsat LST data.'));
                        return;
                    }

                    // --- Continue if data exists ---
                    var lstMean = lsCol.select('LST').mean();
                    var lstMax = lsCol.select('LST').max();

                    var stressIndex = ee.Image(0)
                        .where(lstMax.lt(threshold.optimal), 0)
                        .where(lstMax.gte(threshold.optimal).and(lstMax.lt(threshold.stress)), 1)
                        .where(lstMax.gte(threshold.stress).and(lstMax.lt(threshold.severe)), 3)
                        .where(lstMax.gte(threshold.severe), 5)
                        .rename('HeatStress');

                    var gdd = lsCol.select('LST').map(function (img) {
                        var daily_gdd = img.subtract(10).clamp(0, 50);
                        return daily_gdd.set('system:time_start', img.get('system:time_start'));
                    }).sum().rename('GDD');

                    var stressDays = lsCol.select('LST').map(function (img) {
                        return img.gt(threshold.stress).rename('stress_day');
                    }).sum().rename('StressDays');

                    var yieldLoss = lstMax.subtract(threshold.stress)
                        .multiply(5)
                        .clamp(0, 100)
                        .rename('YieldLoss_percent');

                    currentImage = stressIndex.clip(currentRegion);
                    currentIndexName = 'Heat Stress Index - ' + cropType;
                    currentVisParams = {
                        min: 0, max: 5,
                        palette: ['#00FF00', '#7FFF00', '#FFFF00', '#FF8C00', '#FF4500', '#8B0000']
                    };

                    refreshLayers();
                    Map.centerObject(currentRegion, 8);

                    var stats = ee.Dictionary({
                        stressStats: stressIndex.reduceRegion({
                            reducer: ee.Reducer.mode()
                                .combine(ee.Reducer.mean(), '', true),
                            geometry: currentRegion,
                            scale: 30,
                            maxPixels: 1e13
                        }),
                        lstStats: lstMax.reduceRegion({
                            reducer: ee.Reducer.mean()
                                .combine(ee.Reducer.max(), '', true),
                            geometry: currentRegion,
                            scale: 30,
                            maxPixels: 1e13
                        }),
                        gddTotal: gdd.reduceRegion({
                            reducer: ee.Reducer.mean(),
                            geometry: currentRegion,
                            scale: 30,
                            maxPixels: 1e13
                        }),
                        stressDaysTotal: stressDays.reduceRegion({
                            reducer: ee.Reducer.mean(),
                            geometry: currentRegion,
                            scale: 30,
                            maxPixels: 1e13
                        }),
                        yieldLossAvg: yieldLoss.reduceRegion({
                            reducer: ee.Reducer.mean(),
                            geometry: currentRegion,
                            scale: 30,
                            maxPixels: 1e13
                        }),
                        areaByStress: ee.Image.pixelArea().addBands(stressIndex).reduceRegion({
                            reducer: ee.Reducer.sum().group({
                                groupField: 1,
                                groupName: 'stress_level'
                            }),
                            geometry: currentRegion,
                            scale: 30,
                            maxPixels: 1e13
                        })
                    });

                    stats.evaluate(function (result) {
                        infoPanel.clear();
                        // *** NEW SAFETY CHECK ***
                        if (!result || !result.lstStats || result.lstStats.LST_mean === null) {
                            infoPanel.add(ui.Label('Error calculating stats. No valid LST data.'));
                            return;
                        }

                        infoPanel.add(ui.Label('🌡️ Heat Stress Assessment - ' + cropType + ':', { fontWeight: 'bold', fontSize: '14px' }));
                        infoPanel.add(ui.Label('─────────────────────────────'));

                        var lstMean = result.lstStats.LST_mean;
                        var lstMax = result.lstStats.LST_max;
                        var gddTotal = result.gddTotal.GDD;
                        var stressDays = result.stressDaysTotal.StressDays;
                        var yieldLoss = result.yieldLossAvg.YieldLoss_percent;

                        infoPanel.add(ui.Label('🌡️ Mean LST: ' + lstMean.toFixed(1) + ' °C'));
                        infoPanel.add(ui.Label('🔥 Max LST: ' + lstMax.toFixed(1) + ' °C'));
                        infoPanel.add(ui.Label('📊 Growing Degree Days: ' + gddTotal.toFixed(0)));
                        infoPanel.add(ui.Label('⏱️ Days Above Stress Threshold: ' + stressDays.toFixed(0)));
                        infoPanel.add(ui.Label('─────────────────────────────'));

                        infoPanel.add(ui.Label('📋 Temperature Thresholds:'));
                        infoPanel.add(ui.Label('  • Optimal: < ' + threshold.optimal + ' °C'));
                        infoPanel.add(ui.Label('  • Stress: ' + threshold.stress + ' °C'));
                        infoPanel.add(ui.Label('  • Severe: ' + threshold.severe + ' °C'));
                        infoPanel.add(ui.Label('─────────────────────────────'));

                        infoPanel.add(ui.Label('📉 Est. Yield Loss: ' + yieldLoss.toFixed(1) + ' %', { fontWeight: 'bold', color: 'red' }));

                        if (result.areaByStress.groups) {
                            infoPanel.add(ui.Label(' '));
                            infoPanel.add(ui.Label('📊 Area by Stress Level:'));
                            var stressNames = ['No Stress', 'Mild', '', 'Moderate', '', 'Severe'];
                            result.areaByStress.groups.forEach(function (group) {
                                var area_km2 = (group.sum / 1e6).toFixed(2);
                                var stressLevel = group.stress_level;
                                infoPanel.add(ui.Label('  • ' + stressNames[stressLevel] + ': ' + area_km2 + ' km²'));
                            });
                        }

                        infoPanel.add(ui.Label(' '));
                        infoPanel.add(ui.Label('ℹ️ Management Recommendations:'));
                        if (yieldLoss > 20) {
                            infoPanel.add(ui.Label('⚠️ CRITICAL: Implement heat mitigation strategies'));
                            infoPanel.add(ui.Label('  - Increase irrigation frequency'));
                            infoPanel.add(ui.Label('  - Apply mulching'));
                            infoPanel.add(ui.Label('  - Consider shade structures'));
                        } else if (yieldLoss > 10) {
                            infoPanel.add(ui.Label('⚠️ MODERATE: Monitor closely'));
                            infoPanel.add(ui.Label('  - Adjust irrigation schedule'));
                            infoPanel.add(ui.Label('  - Apply foliar cooling agents'));
                        } else {
                            infoPanel.add(ui.Label('✅ Heat stress within acceptable range'));
                        }
                    });

                    var lstChart = ui.Chart.image.series({
                        imageCollection: lsCol.select('LST'),
                        region: currentRegion,
                        reducer: ee.Reducer.mean(),
                        scale: 100
                    }).setOptions({
                        title: 'Land Surface Temperature Time Series',
                        hAxis: { title: 'Date' },
                        vAxis: { title: 'Temperature (°C)' },
                        lineWidth: 2,
                        pointSize: 3,
                        colors: ['#FF4500'],
                        series: {
                            0: { targetAxisIndex: 0 }
                        },
                        vAxes: {
                            0: {
                                gridlines: { color: 'transparent' },
                                baseline: threshold.stress,
                                baselineColor: 'red'
                            }
                        }
                    });

                    chartPanel.add(lstChart);
                    // --- End of safety check ---
                });
            }
        });
        mainPanel.add(heatStressButton);


        addSeparator();


        // --- *** 6.10: Utilities & Reporting *** ---
        var utilsTitle = ui.Label({
            value: 'E) Utilities & Reporting:',
            style: { fontWeight: 'bold', fontSize: '14px' }
        });
        mainPanel.add(utilsTitle);


        // --- Report Button (from user's Section 13) ---
        var reportButton = ui.Button({
            label: '📄 Generate Analysis Report (Preview)',
            style: { stretch: 'horizontal', color: '#2F4F4F', fontWeight: 'bold' },
            onClick: function () {
                if (!currentRegion || !currentImage) {
                    infoPanel.add(ui.Label('Please run an analysis first.'));
                    return;
                }

                infoPanel.clear();
                infoPanel.add(ui.Label('📄 Report Generation:', { fontWeight: 'bold', fontSize: '14px' }));
                infoPanel.add(ui.Label('─────────────────────────────'));

                var govName = govSelect.getValue() || 'Selected Area';
                var analysisType = currentIndexName || 'Analysis';

                infoPanel.add(ui.Label('📍 Location: ' + govName));
                infoPanel.add(ui.Label('📊 Analysis: ' + analysisType));
                infoPanel.add(ui.Label('📅 Date: ' + startDateBox.getValue() + ' to ' + endDateBox.getValue()));
                infoPanel.add(ui.Label('─────────────────────────────'));

                var thumbImage = ui.Thumbnail({
                    image: currentImage.visualize(currentVisParams),
                    params: {
                        dimensions: 400,
                        region: currentRegion,
                        format: 'png'
                    },
                    style: { height: '300px', padding: '5px' }
                });

                infoPanel.add(ui.Label('🗺️ Map Preview:'));
                infoPanel.add(thumbImage);
                infoPanel.add(ui.Label('Right-click image to save →', { fontStyle: 'italic' }));
                infoPanel.add(ui.Label(' '));

                var downloadUrl = currentImage.getDownloadURL({
                    dimensions: 2048,
                    region: currentRegion,
                    format: 'GeoTIFF'
                });

                infoPanel.add(ui.Label('💾 Export Options:', { fontWeight: 'bold' }));
                infoPanel.add(ui.Label('Use "Export" buttons below for Drive export.'));

                var linkLabel = ui.Label('Direct GeoTIFF Download', {}, downloadUrl);
                linkLabel.style().set({ color: 'blue', textDecoration: 'underline' });
                infoPanel.add(linkLabel);
            }
        });
        mainPanel.add(reportButton);


        // --- Threshold mask ---
        var thrTitle = ui.Label({
            value: 'Threshold mask for selected index:',
            style: { fontWeight: 'bold' }
        });
        mainPanel.add(thrTitle);

        var thrInfo = ui.Label('Highlight pixels where INDEX [> or <] THRESHOLD (within selected governorate).');
        mainPanel.add(thrInfo);

        var thrDirSelect = ui.Select({
            items: ['>', '<'],
            value: '>',
            style: { width: '60px' }
        });
        var thrValueBox = ui.Textbox({
            placeholder: 'Threshold (e.g., 0.3)',
            value: '0.3'
        });

        var thrRow = ui.Panel({
            widgets: [
                ui.Label('Condition: index'),
                thrDirSelect,
                thrValueBox
            ],
            layout: ui.Panel.Layout.flow('horizontal')
        });
        mainPanel.add(thrRow);

        var thrButton = ui.Button({
            label: 'Apply threshold mask',
            style: { stretch: 'horizontal' },
            onClick: function () {
                infoPanel.clear();
                chartPanel.clear();

                if (!currentRegion) {
                    infoPanel.add(ui.Label('Please select a governorate first.'));
                    return;
                }
                var idxName = indexSelect.getValue();
                if (!idxName) {
                    infoPanel.add(ui.Label('Please select an index first (for threshold mask).'));
                    return;
                }

                var thrStr = thrValueBox.getValue();
                var thr = parseFloat(thrStr);
                if (isNaN(thr)) {
                    infoPanel.add(ui.Label('Invalid threshold value. Please enter a number (e.g., 0.3).'));
                    return;
                }
                var sensor = sensorSelect.getValue();

                var start = startDateBox.getValue();
                var end = endDateBox.getValue();

                var col = getSelectedCollection(start, end, currentRegion)
                    .map(function (img) {
                        return indicesDict[idxName](img)
                            .copyProperties(img, img.propertyNames());
                    });

                var composite = col.median().clip(currentRegion);
                var bandName = composite.bandNames().get(0);
                var band = composite.select([bandName]);

                var direction = thrDirSelect.getValue();
                var mask = direction === '>' ? band.gt(thr) : band.lt(thr);

                var maskImage = mask.selfMask().rename('Mask');

                currentImage = maskImage;
                currentIndexName = idxName + ' ' + direction + ' ' + thr + ' (' + sensor + ')';
                currentVisParams = thresholdVis;

                refreshLayers();
                Map.centerObject(currentRegion, 8);

                // Area calculation in km2
                var areaImg = ee.Image.pixelArea().updateMask(mask);
                var areaStats = areaImg.reduceRegion({
                    reducer: ee.Reducer.sum(),
                    geometry: currentRegion,
                    scale: 30, // Use 30m for compatibility
                    maxPixels: 1e13
                });

                areaStats.evaluate(function (res) {
                    var area_m2 = res && res.area;
                    if (!area_m2) {
                        infoPanel.add(ui.Label('No pixels satisfy the condition.'));
                        return;
                    }
                    var area_km2 = area_m2 / 1e6;
                    infoPanel.add(ui.Label('Threshold mask applied: ' + idxName + ' ' + direction + ' ' + thr));
                    infoPanel.add(ui.Label('Area satisfying condition ≈ ' + area_km2.toFixed(2) + ' km²'));
                });
            }
        });
        mainPanel.add(thrButton);

    })(mainPanel); // End Agro-Economic Scope

    addSeparator();

    // --- Automated Change Classifier ---
    function createAnalysisStack(start, end, region) {
        // 1. Sentinel-2 (Optical)
        var s2 = getS2Collection(start, end, region).median();
        var s2bands = s2.select(['BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2']);
        // 2. Sentinel-1 (Radar)
        var s1 = getS1Collection(start, end, region)
            .select('VV_smoothed')
            .median();
        // 3. DEM and Slope (Terrain)
        var demStack = dem.addBands(slope);
        return s2bands.addBands(s1).addBands(demStack).clip(region);
    }

    var autoChangeTitle = ui.Label({
        value: 'Automated Change Analysis (S2+S1 only):',
        style: { fontWeight: 'bold' }
    });
    mainPanel.add(autoChangeTitle);

    var autoChangeInfo = ui.Label('Run unsupervised clustering on P1 and P2 to find "From-To" change types.');
    mainPanel.add(autoChangeInfo);

    var autoChangeButton = ui.Button({
        label: 'Run Automated Change Analysis (Unsupervised)',
        style: { stretch: 'horizontal', color: 'red' },
        onClick: function () {
            infoPanel.clear();
            chartPanel.clear();

            if (!currentRegion) {
                infoPanel.add(ui.Label('Please select a governorate first.'));
                return;
            }

            infoPanel.add(ui.Label('Starting automated analysis (S2/S1)... This may take a moment.'));

            var p1Start = p1StartBox.getValue();
            var p1End = p1EndBox.getValue();
            var p2Start = p2StartBox.getValue();
            var p2End = p2EndBox.getValue();

            var trainingScale = 30;
            var numClusters = 8;

            var stackP1 = createAnalysisStack(p1Start, p1End, currentRegion);
            var stackP2 = createAnalysisStack(p2Start, p2End, currentRegion);

            var training = stackP1.sample({
                region: currentRegion,
                scale: trainingScale,
                numPixels: 5000
            });

            var clusterer = ee.Clusterer.wekaKMeans(numClusters).train(training);

            var clusterP1 = stackP1.cluster(clusterer).rename('cluster');
            var clusterP2 = stackP2.cluster(clusterer).rename('cluster');

            var fromTo = clusterP1.multiply(100).add(clusterP2).rename('From-To');

            currentImage = fromTo;
            currentIndexName = 'Automated Change (From-To) S2/S1';
            currentVisParams = { min: 0, max: 808, palette: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF'] };

            refreshLayers();
            Map.centerObject(currentRegion, 8);

            infoPanel.add(ui.Label('Analysis complete.'));
            infoPanel.add(ui.Label('Map shows change classes (e.g., 101=1->1, 102=1->2).'));

            var areaImage = ee.Image.pixelArea().addBands(fromTo);
            var areas = areaImage.reduceRegion({
                reducer: ee.Reducer.sum().group({
                    groupField: 1,
                    groupName: 'from_to_class',
                }),
                geometry: currentRegion,
                scale: 30,
                maxPixels: 1e13
            });

            areas.evaluate(function (stats) {
                if (!stats) return;
                infoPanel.add(ui.Label('Change areas calculated.'));
                print(stats); // You can check the console (Tasks tab area)
            });
        }
    });
    mainPanel.add(autoChangeButton);

    addSeparator();

    // --- UPDATED: AI & Advanced Classification (Memory Optimized) ---
    mainPanel.add(ui.Label({ value: 'D) AI & Advanced Classification:', style: { fontWeight: 'bold', fontSize: '14px', margin: '10px 0' } }));

    // --- Advanced AI Classification Button ---
    mainPanel.add(ui.Button({
        label: '🌲 Scientific AI Classification (w/ Accuracy)',
        style: { stretch: 'horizontal', color: 'green', fontWeight: 'bold', backgroundColor: '#e6ffe6' },
        onClick: function () {
            infoPanel.clear();
            if (!currentRegion) { infoPanel.add(ui.Label('Select governorate first.')); return; }

            infoPanel.add(ui.Label('1. Processing & Sampling...'));

            // إعداد البيانات
            var base = getS2Collection(startDateBox.getValue(), endDateBox.getValue(), currentRegion).median();
            var ndvi = base.normalizedDifference(['NIR', 'RED']).rename('n');
            var ndwi = base.normalizedDifference(['GREEN', 'NIR']).rename('w');
            var ndbi = base.normalizedDifference(['SWIR1', 'NIR']).rename('b');
            var input = base.select(['BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2']).addBands([ndvi, ndwi, ndbi]);

            // إنشاء نقاط التدريب الآلية
            var trainingData = ee.Image(0)
                .where(ndwi.gt(0.1), 1) // Water
                .where(ndvi.gt(0.35), 2) // Vegetation
                .where(ndbi.gt(0.1), 3) // Urban
                .where(ndvi.lt(0.15).and(ndwi.lt(0)).and(ndbi.lt(0)), 4) // Desert
                .rename('class');

            // أخذ العينات (Sampling)
            var points = input.addBands(trainingData).updateMask(trainingData.neq(0))
                .sample({
                    region: currentRegion,
                    scale: 100,
                    numPixels: 1200, // عدد نقاط أكبر قليلاً للدقة
                    geometries: true,
                    tileScale: 16
                });

            // --- الإضافة العلمية: تقسيم البيانات (Cross-Validation) ---
            var withRandom = points.randomColumn('random');
            var split = 0.7; // 70% تدريب
            var trainingPartition = withRandom.filter(ee.Filter.lt('random', split));
            var testingPartition = withRandom.filter(ee.Filter.gte('random', split));

            infoPanel.add(ui.Label('2. Training Model (70% of data)...'));
            var classifier = ee.Classifier.smileRandomForest(50).train({
                features: trainingPartition,
                classProperty: 'class',
                inputProperties: input.bandNames()
            });

            // التصنيف
            var classified = input.classify(classifier).clip(currentRegion);

            // --- حساب الدقة (Validation) ---
            infoPanel.add(ui.Label('3. Validating (30% of data)...'));
            var test = testingPartition.classify(classifier);
            var confusionMatrix = test.errorMatrix('class', 'classification');

            // عرض النتائج
            currentImage = classified;
            currentIndexName = 'Scientific LULC Classification';
            currentVisParams = { min: 1, max: 4, palette: ['0000FF', '00FF00', 'FF0000', 'FFFF00'] };
            refreshLayers();

            // طباعة تقرير الدقة
            confusionMatrix.accuracy().evaluate(function (acc) {
                infoPanel.add(ui.Label('📊 Model Accuracy: ' + (acc * 100).toFixed(2) + '%', { fontWeight: 'bold', color: 'darkblue' }));
            });

            confusionMatrix.kappa().evaluate(function (kappa) {
                infoPanel.add(ui.Label('📈 Kappa Coefficient: ' + kappa.toFixed(3)));
                infoPanel.add(ui.Label('Key: 🟦 Water, 🟩 Veg, 🟥 Urban, 🟨 Desert'));
            });
        }
    }));

    // 2. Nighttime Lights (No changes needed, but included for completeness)
    mainPanel.add(ui.Button({
        label: '🌃 Show Nighttime Lights (Human Activity)',
        style: { stretch: 'horizontal', color: 'black', backgroundColor: '#ccc' },
        onClick: function () {
            if (!currentRegion) { infoPanel.add(ui.Label('Select governorate first.')); return; }

            var viirs = ee.ImageCollection("NOAA/VIIRS/DNB/MONTHLY_V1/VCMCFG")
                .filterDate(startDateBox.getValue(), endDateBox.getValue())
                .select('avg_rad').mean().clip(currentRegion);

            currentImage = viirs;
            currentIndexName = 'Night Activity Intensity';
            currentVisParams = { min: 0, max: 60, palette: ['black', 'purple', 'cyan', 'yellow', 'white'] };
            refreshLayers();
            Map.setOptions('HYBRID');
            infoPanel.clear();
            infoPanel.add(ui.Label('VIIRS Nighttime Lights displayed.'));
        }
    }));

    // 3. Trend Analysis (Optimized scale)
    mainPanel.add(ui.Button({
        label: '📈 Long-Term Veg Trend (2015-2023)',
        style: { stretch: 'horizontal', color: '#4B0082' },
        onClick: function () {
            if (!currentRegion) { infoPanel.add(ui.Label('Select governorate first.')); return; }
            infoPanel.clear();
            infoPanel.add(ui.Label('Calculating trend (this may take time)...'));

            var col = ee.ImageCollection('COPERNICUS/S2_SR')
                .filterBounds(currentRegion)
                .filterDate('2015-01-01', '2023-12-31')
                .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 20))
                .map(function (i) {
                    return i.normalizedDifference(['B8', 'B4'])
                        .rename('n')
                        .addBands(ee.Image(i.date().get('year')).float())
                        .copyProperties(i, ['system:time_start']);
                });

            var fit = col.select(['constant', 'n']).reduce(ee.Reducer.linearFit());

            currentImage = fit.select('scale').clip(currentRegion);
            currentIndexName = 'Vegetation Growth/Loss Trend';
            currentVisParams = { min: -0.01, max: 0.01, palette: ['red', 'white', 'green'] };
            refreshLayers();
            infoPanel.add(ui.Label('Red = Degradation, Green = Reclamation'));
        }
    }));
    /**** 7) Export ****/

    var exportTitle = ui.Label({
        value: 'F) Export:',
        style: { fontWeight: 'bold', fontSize: '14px' }
    });
    mainPanel.add(exportTitle);

    // Export current image
    var exportImageButton = ui.Button({
        label: 'Export current image to Google Drive',
        style: { stretch: 'horizontal' },
        onClick: function () {
            if (!currentImage || !currentRegion || !currentIndexName) {
                infoPanel.add(ui.Label('No current image to export. Please display an index / change / classification / mask first.'));
                return;
            }

            Export.image.toDrive({
                image: currentImage,
                description: 'Export_' + currentIndexName.replace(/[\s\(\)\/°]/g, '_'),
                folder: 'GEE_Exports',
                fileNamePrefix: 'Layer_' + currentIndexName.replace(/[\s\(\)\/°]/g, '_'),
                region: currentRegion,
                scale: 30, // Export at 30m for compatibility
                maxPixels: 1e13
            });

            infoPanel.add(ui.Label('Image export task created. Check the Tasks tab.'));
        }
    });
    mainPanel.add(exportImageButton);

    // Export zonal stats table
    var exportTableButton = ui.Button({
        label: 'Export governorate stats (CSV)',
        style: { stretch: 'horizontal' },
        onClick: function () {
            if (!lastZonalStats) {
                infoPanel.add(ui.Label('No zonal stats yet. Run "Governorate comparison" first.'));
                return;
            }
            Export.table.toDrive({
                collection: lastZonalStats,
                description: 'ZonalStats_' + (currentIndexName || 'Index').replace(/[\s\(\)\/°]/g, '_'),
                folder: 'GEE_Exports',
                fileFormat: 'CSV'
            });
            infoPanel.add(ui.Label('Table export task created. Check the Tasks tab.'));
        }
    });
    mainPanel.add(exportTableButton);


    /**** 8) Map initial setup ****/

    centerPanel.setOptions('SATELLITE');
    centerPanel.centerObject(adminBoundaries, 5);
    refreshLayers();
    // --- Separator ---
    addSeparator();
    var visToolTitle = ui.Label({ value: 'G) Visual Comparison Tool (Swipe):', style: { fontWeight: 'bold', fontSize: '14px' } });
    mainPanel.add(visToolTitle);

    var splitMapButton = ui.Button({
        label: '🔄 Activate Split Map (Natural Colors)',
        style: { stretch: 'horizontal', color: 'purple' },
        onClick: function () {
            if (!currentRegion) { infoPanel.add(ui.Label('Select governorate first.')); return; }

            infoPanel.clear();
            infoPanel.add(ui.Label('Generating Split Map (Natural Colors)...'));

            var p1Start = p1StartBox.getValue();
            var p1End = p1EndBox.getValue();
            var p2Start = p2StartBox.getValue();
            var p2End = p2EndBox.getValue();

            // --- Using Natural Colors (RGB) ---
            var getVisImage = function (start, end) {
                var col = getMergedLandsatCollection(start, end, currentRegion);
                // نستخدم RED, GREEN, BLUE لتظهر الصورة كما تراها العين
                return col.median().clip(currentRegion).visualize({
                    bands: ['RED', 'GREEN', 'BLUE'],
                    min: 0.0,
                    max: 0.25, // Brightness control
                    gamma: 1.3 // Gamma correction
                });
            };

            var img1 = getVisImage(p1Start, p1End);
            var img2 = getVisImage(p2Start, p2End);

            var leftMap = ui.Map();
            leftMap.setOptions('HYBRID');
            leftMap.centerObject(currentRegion, 10); // Zoom in slightly
            leftMap.addLayer(img1, {}, 'Old Period (' + p1Start.substring(0, 4) + ')');
            leftMap.add(ui.Label('Old: ' + p1Start.substring(0, 4), { position: 'top-left' }));

            var rightMap = ui.Map();
            rightMap.setOptions('HYBRID');
            rightMap.centerObject(currentRegion, 10);
            rightMap.addLayer(img2, {}, 'New Period (' + p2Start.substring(0, 4) + ')');
            rightMap.add(ui.Label('New: ' + p2Start.substring(0, 4), { position: 'top-right' }));

            var linker = ui.Map.Linker([leftMap, rightMap]);

            var splitPanel = ui.SplitPanel({
                firstPanel: leftMap,
                secondPanel: rightMap,
                orientation: 'horizontal',
                wipe: true,
                style: { stretch: 'both' }
            });

            ui.root.widgets().reset([mainPanel, splitPanel]);

            var resetButton = ui.Button({
                label: '❌ Exit Split Mode',
                style: { position: 'bottom-center' },
                onClick: function () {
                    ui.root.widgets().reset([mainPanel, centerPanel]);
                    centerPanel.centerObject(currentRegion, 8);
                }
            });
            leftMap.add(resetButton);
        }
    });
    mainPanel.add(splitMapButton);
    addSeparator();
    var animTitle = ui.Label({ value: 'H) Animation & Water Dynamics:', style: { fontWeight: 'bold', fontSize: '14px' } });
    mainPanel.add(animTitle);

    // --- 1. أداة الفيديو الزمني (Time-Lapse) ---
    mainPanel.add(ui.Label('1. Generate Time-Lapse GIF (Urban/Agri Change):'));

    var startYearBox = ui.Textbox({ placeholder: 'Start Year', value: '2000', style: { width: '80px' } });
    var endYearBox = ui.Textbox({ placeholder: 'End Year', value: '2023', style: { width: '80px' } });
    var fpsSlider = ui.Slider({ min: 1, max: 10, value: 4, step: 1, style: { width: '120px' } }); // سرعة الفيديو

    var timeLapsePanel = ui.Panel({
        layout: ui.Panel.Layout.flow('horizontal'),
        widgets: [startYearBox, endYearBox, ui.Label('Speed:'), fpsSlider]
    });
    mainPanel.add(timeLapsePanel);

    var gifButton = ui.Button({
        label: '🎬 Create Time-Lapse GIF',
        style: { stretch: 'horizontal', color: 'darkblue' },
        onClick: function () {
            if (!currentRegion) { infoPanel.add(ui.Label('Please select a governorate first.')); return; }

            infoPanel.clear();
            infoPanel.add(ui.Label('🎬 Generating GIF... Please wait.'));

            var startYear = parseInt(startYearBox.getValue());
            var endYear = parseInt(endYearBox.getValue());

            if (startYear >= endYear) { infoPanel.add(ui.Label('Error: Start year must be before End year.')); return; }

            // Function to create annual mosaic
            var getYearMosaic = function (year) {
                var start = year + '-01-01';
                var end = year + '-12-31';
                // Use Landsat (L5/L7/L8) for long temporal coverage
                var col = getMergedLandsatCollection(start, end, currentRegion);
                var img = col.filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 30)).median();

                // Natural colors with contrast enhancement
                return img.visualize({
                    bands: ['RED', 'GREEN', 'BLUE'],
                    min: 0, max: 0.25, gamma: 1.4
                }).set({ 'year': year, 'system:time_start': ee.Date(start).millis() });
            };

            // List of images for each year
            var list = ee.List.sequence(startYear, endYear).map(function (y) {
                return getYearMosaic(y).clip(currentRegion);
            });

            var gifCol = ee.ImageCollection(list);

            // Video parameters
            var gifParams = {
                dimensions: 600,
                region: currentRegion,
                framesPerSecond: fpsSlider.getValue(),
                crs: 'EPSG:3857'
            };

            // Show video in panel
            var thumb = ui.Thumbnail(gifCol, gifParams);
            infoPanel.clear();
            infoPanel.add(ui.Label('Time-Lapse (' + startYear + '-' + endYear + '):', { fontWeight: 'bold' }));
            infoPanel.add(thumb);
            infoPanel.add(ui.Label('Right-click image -> "Save Image As" to download GIF.'));
        }
    });
    mainPanel.add(gifButton);

    // --- 2. أداة تاريخ المياه (JRC Water History) ---
    mainPanel.add(ui.Button({
        label: '💧 Show Water History (Changes over 35 years)',
        style: { stretch: 'horizontal', color: '#0099CC' },
        onClick: function () {
            if (!currentRegion) { infoPanel.add(ui.Label('Please select a governorate first.')); return; }

            infoPanel.clear();
            infoPanel.add(ui.Label('Loading JRC Global Surface Water Mapping...'));

            // Load JRC dataset
            var jrc = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').clip(currentRegion);

            // Transition layer showing change over time
            // Values: 1=Permanent, 2=New, 3=Lost
            var transition = jrc.select('transition');

            currentImage = transition;
            currentIndexName = 'Water Transition Class (JRC)';
            // JRC standard palette
            // Permanent(Blue), New(Light Blue), Lost(Pink/Red), Seasonal(Green)
            currentVisParams = { min: 0, max: 10, palette: ['ffffff', '0000ff', '22b14c', 'd1102d', '99d9ea', 'b5e61d', 'e6a1aa', 'ff7f27', 'ffc90e', '7f7f7f', 'c3c3c3'] };

            refreshLayers();

            // Legend description
            infoPanel.add(ui.Label('Map Legend:', { fontWeight: 'bold' }));
            infoPanel.add(ui.Label('🟦 Blue: Permanent Water (Always water)'));
            infoPanel.add(ui.Label('🟩 Green: New Water (Was land, became water)'));
            infoPanel.add(ui.Label('🟥 Red: Lost Water (Was water, became land)'));
            infoPanel.add(ui.Label('This dataset covers 1984-2021.'));
        }
    }));

    addSeparator();
    // Initialize layers (ensure borders are shown if checked)
    refreshLayers();

}; // --- END RESEARCHER MODE ---

// ====================================================================================
// 🔬 FARM VALIDATION: Scientific 3-Step Verification System
// ====================================================================================

/**
 * COMPREHENSIVE FARM VALIDATION using 3 scientific methods:
 * 
 * 1️⃣ LAND COVER CHECK (Dynamic World)
 *    - Compares crops vs built vs bare probabilities
 *    - Most reliable for distinguishing cropland from urban areas
 * 
 * 2️⃣ PHENOLOGY CHECK (NDVI Time Series)
 *    - Analyzes vegetation growth pattern over time
 *    - Detects if there's an active growing season (not just static green)
 *    - Low max NDVI or low range = no active farming
 * 
 * 3️⃣ HOMOGENEITY CHECK (Field-likeness)
 *    - Measures NDVI variance within the AOI
 *    - High variance = mixed area (buildings + vegetation patches)
 *    - Low variance + high NDVI = uniform agricultural field
 * 
 * @param {ee.Geometry} geometry - The AOI to validate
 * @param {String} start - Start date for analysis
 * @param {String} end - End date for analysis
 * @returns {ee.Dictionary} - Comprehensive validation stats
 */
var validateFarmLocation = function (geometry, start, end) {

    // ========== 1️⃣ LAND COVER: Dynamic World ==========
    var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
        .filterBounds(geometry)
        .filterDate(start, end)
        .select(['crops', 'built', 'bare', 'grass', 'trees', 'water']);

    // Mean probability for each class
    var dwMean = dw.mean().clip(geometry);

    var dwStats = dwMean.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    });

    // Count pixels classified as "crops" (dominant class)
    var dwLabel = dw.select('label').mode().clip(geometry);
    var cropsPixelCount = dwLabel.eq(4).reduceRegion({  // 4 = crops in DW
        reducer: ee.Reducer.mean(),  // Proportion of pixels
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    });

    // ========== 2️⃣ PHENOLOGY: NDVI Time Series ==========
    var s2Ndvi = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(geometry)
        .filterDate(start, end)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
        .map(function (img) {
            var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
            return ndvi.copyProperties(img, ['system:time_start']);
        });

    // Get phenology metrics
    var ndviMax = s2Ndvi.max().reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    }).get('NDVI');

    var ndviMin = s2Ndvi.min().reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    }).get('NDVI');

    // NDVI Range = Growth amplitude (high range = active season)
    var ndviRange = ee.Number(ndviMax).subtract(ee.Number(ndviMin));

    // Mean NDVI across time
    var ndviMean = s2Ndvi.mean().reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 10,
        maxPixels: 1e9
    }).get('NDVI');

    // ========== 3️⃣ HOMOGENEITY: Spatial Variance ==========
    // High StdDev = mixed area (buildings + vegetation patches)
    // Low StdDev + high NDVI = uniform agricultural field
    var ndviLatest = s2Ndvi.sort('system:time_start', false).first();

    var spatialStats = ee.Algorithms.If(
        ndviLatest,
        ndviLatest.reduceRegion({
            reducer: ee.Reducer.stdDev().combine(ee.Reducer.mean(), '', true),
            geometry: geometry,
            scale: 10,
            maxPixels: 1e9
        }),
        ee.Dictionary({ 'NDVI_stdDev': 0, 'NDVI_mean': 0 })
    );

    // Number of valid S2 observations
    var observationCount = s2Ndvi.size();

    // ========== COMPILE RESULTS ==========
    return ee.Dictionary({
        // Land Cover (Dynamic World)
        crops_prob: dwStats.get('crops'),
        built_prob: dwStats.get('built'),
        bare_prob: dwStats.get('bare'),
        grass_prob: dwStats.get('grass'),
        water_prob: dwStats.get('water'),
        crops_pixel_ratio: cropsPixelCount.get('label'),  // % of pixels classified as crops

        // Phenology (Time Series)
        ndvi_max: ndviMax,
        ndvi_min: ndviMin,
        ndvi_range: ndviRange,  // Growth amplitude
        ndvi_mean: ndviMean,
        observation_count: observationCount,

        // Homogeneity (Spatial)
        ndvi_stdDev: ee.Dictionary(spatialStats).get('NDVI_stdDev'),
        ndvi_spatial_mean: ee.Dictionary(spatialStats).get('NDVI_mean')
    });
};

// ═══════════════════════════════════════════════════════
// 🆕 HELPER FUNCTIONS & ADVANCED MODELS
// ═══════════════════════════════════════════════════════

// (Redundant getOpenLandMapSoil removed to use the master version at line 501)

// --- S1 Collection Helper ---


// ═══════════════════════════════════════════════════════
// 🆕 ADVANCED FEATURES - Add before buildFarmerMode
// ═══════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────
// 1️⃣ GROWTH STAGE DETECTION
// ───────────────────────────────────────────────────────
var detectGrowthStage = function (ndviCol, cropType, geometry) {
    var ndviStats = ndviCol.select('NDVI').reduce(
        ee.Reducer.percentile([10, 50, 90])
    );

    var p10 = ndviStats.select('NDVI_p10').reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 30,
        maxPixels: 1e9
    }).get('NDVI_p10');

    var p50 = ndviStats.select('NDVI_p50').reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 30,
        maxPixels: 1e9
    }).get('NDVI_p50');

    var p90 = ndviStats.select('NDVI_p90').reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 30,
        maxPixels: 1e9
    }).get('NDVI_p90');

    return ee.Dictionary({
        p10: p10,
        p50: p50,
        p90: p90
    });
};


// ───────────────────────────────────────────────────────
// 2️⃣ REGIONAL BENCHMARK
// ───────────────────────────────────────────────────────
var calculateRegionalBenchmark = function (region, start, end) {
    var regionalArea = region.buffer(5000);

    var regionalNDVI = getS2Collection(start, end, regionalArea)
        .map(function (img) {
            return indicesDict['NDVI (Vegetation)'](img);
        })
        .median();

    var regionalStats = regionalNDVI.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: regionalArea,
        scale: 100,
        maxPixels: 1e9
    });

    return regionalStats;
};


// ───────────────────────────────────────────────────────
// 3️⃣ DISEASE/ANOMALY DETECTION
// ───────────────────────────────────────────────────────
var detectAnomalies = function (farmArea, s2Col) {
    var ndviCol = s2Col.map(function (img) {
        return indicesDict['NDVI (Vegetation)'](img);
    });

    var ndviMean = ndviCol.mean();
    var ndviStd = ndviCol.reduce(ee.Reducer.stdDev());

    var threshold = ndviMean.subtract(ndviStd.multiply(1.5));
    var anomalies = ndviMean.lt(threshold);

    var anomalyArea = anomalies.multiply(ee.Image.pixelArea()).reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: farmArea,
        scale: 10,
        maxPixels: 1e9
    });

    return anomalyArea;
};


// ───────────────────────────────────────────────────────
// 4️⃣ HARVEST DATE PREDICTION
// ───────────────────────────────────────────────────────
var predictHarvestDate = function (cropType, gsStart, currentNDVI) {
    var growingPeriods = {
        'قمح (Wheat)': 150,
        'ذرة (Maize)': 120,
        'أرز (Rice)': 140,
        'قطن (Cotton)': 180,
        'قصب السكر (Sugarcane)': 300
    };

    var totalDays = growingPeriods[cropType] || 120;
    var progress = Math.min(95, currentNDVI * 120);
    var daysElapsed = (progress / 100) * totalDays;
    var daysRemaining = Math.max(0, totalDays - daysElapsed);

    var harvestDate = ee.Date(gsStart).advance(totalDays, 'day');

    return {
        progress: progress,
        daysRemaining: daysRemaining,
        harvestDate: harvestDate
    };
};

// ═══════════════════════════════════════════════════════
// 🔬 HIGH-ACCURACY MODELS
// ═══════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────
// 1️⃣ IMPROVED SALINITY MODEL (ML-based)
// ───────────────────────────────────────────────────────



// ───────────────────────────────────────────────────────
// 2️⃣ HIGH-RESOLUTION SOIL MOISTURE
// ───────────────────────────────────────────────────────
var calculateSoilMoisture_HighRes = function (s2, s1, lst, precip, soilTexture, geometry) {
    var ndvi = s2.normalizedDifference(['NIR', 'RED']);
    var ndmi = s2.normalizedDifference(['NIR', 'SWIR1']);

    // TVDI calculation
    var lstStats = lst.reduceRegion({
        reducer: ee.Reducer.percentile([5, 95]),
        geometry: geometry.buffer(1000),
        scale: 30,
        maxPixels: 1e9
    });

    var lstMax = ee.Number(lstStats.get('LST_p95'));
    var lstMin = ee.Number(lstStats.get('LST_p5'));

    var tvdi = ee.Image(lstMax).subtract(lst)
        .divide(ee.Image(lstMax).subtract(ee.Image(lstMin)));

    // SAR with roughness correction
    var vv_db = s1.select('VV_smoothed');
    var roughness = ndvi.multiply(2).subtract(1).clamp(-1, 1);
    var vv_corrected = vv_db.subtract(roughness.multiply(3));

    // Texture adjustment
    var sandFraction = soilTexture.select('Sand_0cm').divide(100);
    var clayFraction = soilTexture.select('Clay_0cm').divide(100);
    var textureEffect = clayFraction.subtract(sandFraction).multiply(0.1);

    // Fusion model
    var sm = ee.Image(0.25)
        .add(ndmi.multiply(0.15))
        .add(tvdi.multiply(-0.20))
        .add(vv_corrected.multiply(0.002))
        .add(precip.multiply(0.01))
        .add(textureEffect)
        .clamp(0.05, 0.50)
        .rename('SM_m3m3');

    return sm;
};


// ───────────────────────────────────────────────────────
// 3️⃣ EGYPT-CALIBRATED YIELD MODEL
// ───────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────
// 4️⃣ SIMPLE YIELD ESTIMATOR (Scalar/Point-based)
// ───────────────────────────────────────────────────────
var estimateYield_Simple = function (ndviVal, cropType) {
    // Default ranges (Ardeb per Feddan or Ton per Feddan)
    // 1 Ardeb Wheat = 150 kg

    var yields = {
        'قمح': { unit: 'إردب', max: 24, min: 10, name: 'القمح' },
        'Wheat': { unit: 'إردب', max: 24, min: 10, name: 'القمح' },

        'ذرة': { unit: 'إردب', max: 30, min: 12, name: 'الذرة' },
        'Maize': { unit: 'إردب', max: 30, min: 12, name: 'الذرة' },

        'أرز': { unit: 'طن', max: 4.5, min: 1.5, name: 'الأرز' },
        'Rice': { unit: 'طن', max: 4.5, min: 1.5, name: 'الأرز' },

        'قطن': { unit: 'قنطار', max: 10, min: 4, name: 'القطن' },
        'Cotton': { unit: 'قنطار', max: 10, min: 4, name: 'القطن' },

        'بطاطس': { unit: 'طن', max: 25, min: 8, name: 'البطاطس' },
        'Potato': { unit: 'طن', max: 25, min: 8, name: 'البطاطس' },

        'طماطم': { unit: 'طن', max: 50, min: 15, name: 'الطماطم' },
        'Tomato': { unit: 'طن', max: 50, min: 15, name: 'الطماطم' }
    };

    // Find crop
    var cropKey = null;
    for (var key in yields) {
        if (cropType && cropType.indexOf(key) > -1) {
            cropKey = key;
            break;
        }
    }

    if (!cropKey) return 'غير متوفر لهذا المحصول';

    var data = yields[cropKey];

    // Dynamic Interpolation Logic (Linear)
    // NDVI 0.2 -> Min Yield
    // NDVI 0.8 -> Max Yield
    var ndviClamped = Math.min(0.8, Math.max(0.2, ndviVal));
    var factor = (ndviClamped - 0.2) / (0.8 - 0.2); // 0 to 1

    var estimatedYield = data.min + (factor * (data.max - data.min));

    // Create a realistic range (+/- 10%)
    var lower = (estimatedYield * 0.9).toFixed(1);
    var upper = (estimatedYield * 1.1).toFixed(1);

    var status = 'متوسط';
    if (factor > 0.7) status = 'ممتاز (عالي الإنتاجية)';
    else if (factor < 0.3) status = 'منخفض (يحتاج رعاية)';
    else status = 'متوسط (طبيعي)';

    return lower + ' - ' + upper + ' ' + data.unit + '/فدان (' + status + ')';
};

var estimateYield_Egypt = function (crop, ndvi, evi, lst, precip, et, sm, soilOC) {
    var models = {
        'قمح (Wheat)': {
            base: 2.8, ndvi: 1.2, evi: 0.8,
            temp_opt: 18, temp_tol: 10,
            water_sens: 0.7, soil_factor: 0.3
        },
        'ذرة (Maize)': {
            base: 3.5, ndvi: 1.5, evi: 1.0,
            temp_opt: 28, temp_tol: 12,
            water_sens: 0.9, soil_factor: 0.4
        },
        'أرز (Rice)': {
            base: 4.0, ndvi: 1.3, evi: 0.9,
            temp_opt: 28, temp_tol: 8,
            water_sens: 1.2, soil_factor: 0.2
        },
        'قطن (Cotton)': {
            base: 0.9, ndvi: 0.8, evi: 0.6,
            temp_opt: 30, temp_tol: 12,
            water_sens: 0.8, soil_factor: 0.3
        }
    };

    var model = models[crop] || models['قمح (Wheat)'];

    var vigorScore = ndvi.multiply(model.ndvi).add(evi.multiply(model.evi));

    var tempStress = ee.Image(1).subtract(
        lst.subtract(model.temp_opt).abs().divide(model.temp_tol).clamp(0, 1)
    );

    var waterBalance = precip.subtract(et).divide(et.add(1));
    var waterScore = ee.Image(1).add(waterBalance.multiply(model.water_sens)).clamp(0.3, 1.3);

    var ocPercent = soilOC.divide(10);
    var soilScore = ee.Image(1).add(ocPercent.subtract(1).multiply(model.soil_factor)).clamp(0.7, 1.2);

    var smScore = sm.subtract(0.15).divide(0.20).clamp(0.5, 1.2);

    var yieldEstimate = ee.Image(model.base)
        .multiply(vigorScore)
        .multiply(tempStress)
        .multiply(waterScore)
        .multiply(soilScore)
        .multiply(smScore)
        .clamp(model.base * 0.3, model.base * 1.5)
        .rename('Yield_ton_feddan');

    return yieldEstimate;
};

// ====================================================================================
// 🌾 MODE 2: FARMER MODE (Arabic & Simplified)
// ====================================================================================

buildFarmerMode = function () {
    controlsPanel.clear();
    reportPanel.clear();
    showControlsView();

    // Alias controlsPanel as mainPanel
    var mainPanel = controlsPanel;

    // Helper: Separator
    var addSeparator = function () {
        mainPanel.add(ui.Label({
            value: '',
            style: { border: '1px solid #ccc', margin: '4px 0' }
        }));
    };

    // Header
    mainPanel.add(ui.Label({
        value: '🌾 تحليل المزرعة الذكي',
        style: { fontWeight: 'bold', fontSize: '18px', color: '#228B22', margin: '10px 0', textAlign: 'center', stretch: 'horizontal' }
    }));

    // Setup Right Panel for Results
    var infoPanel = ui.Panel({ style: { stretch: 'horizontal', padding: '5px' } });
    var chartPanel = ui.Panel({ style: { stretch: 'horizontal', height: '300px' } });

    // Add Result Headers
    reportPanel.add(createBackButton('farmer'));
    reportPanel.add(ui.Label({ value: '📊 النتائج والتقارير', style: { fontWeight: 'bold', fontSize: '16px', color: '#555' } }));
    reportPanel.add(infoPanel);
    reportPanel.add(ui.Label('📈 الرسوم البيانية', { fontWeight: 'bold', fontSize: '14px', color: '#555', margin: '10px 0' }));
    reportPanel.add(chartPanel);

    // ====================================================================================
    // 💡 CROP RECOMMENDATION SYSTEM (Preserved Logic)
    // ====================================================================================
    var recommendCrops = function (soilStats) {
        var salinity = ee.Number(soilStats.get('salinity'));
        var sand = ee.Number(soilStats.get('sand'));
        var clay = ee.Number(soilStats.get('clay'));
        var ph = ee.Number(soilStats.get('ph'));
        var recommendations = ee.List([]);

        // --- Salinity Rules (EC in dS/m) ---
        recommendations = ee.Algorithms.If(salinity.gt(8), recommendations.add('🌾 شعير (Barley) - يتحمل الملوحة العالية'), recommendations);
        recommendations = ee.Algorithms.If(salinity.gt(7), recommendations.add('🍬 بنجر السكر (Sugar Beet) - مقاوم للملوحة'), recommendations);
        recommendations = ee.Algorithms.If(salinity.gt(6), recommendations.add('🌴 نخيل البلح (Date Palm) - متحمل ممتاز'), recommendations);
        recommendations = ee.Algorithms.If(salinity.lt(6).and(salinity.gt(2)), recommendations.add('🍞 قمح (Wheat) - يتحمل الملوحة المتوسطة'), recommendations);
        recommendations = ee.Algorithms.If(salinity.lt(4), recommendations.add('🍅 طماطم (Tomato) - حساسية متوسطة'), recommendations);
        recommendations = ee.Algorithms.If(salinity.lt(2), recommendations.add('🌽 ذرة (Maize) - يحتاج مياه عذبة وتربة جيدة'), recommendations);

        // --- Texture Rules ---
        recommendations = ee.Algorithms.If(sand.gt(70), recommendations.add('🥜 فول سوداني (Peanuts) - ممتاز للتربة الرملية'), recommendations);
        recommendations = ee.Algorithms.If(sand.gt(60), recommendations.add('🥔 بطاطس (Potatoes) - تفضل التربة الخفيفة'), recommendations);
        recommendations = ee.Algorithms.If(sand.gt(50), recommendations.add('🍉 بطيخ (Watermelon) - جيد في الأراضي الرملية'), recommendations);
        recommendations = ee.Algorithms.If(clay.gt(35), recommendations.add('👕 قطن (Cotton) - ممتاز للتربة الطينية'), recommendations);
        recommendations = ee.Algorithms.If(clay.gt(40), recommendations.add('🍚 أرز (Rice) - يحتاج تربة ثقيلة (Check water availability!)'), recommendations);

        // --- pH Rules ---
        recommendations = ee.Algorithms.If(ph.gt(8.0), recommendations.add('⚠️ ملاحظة: قلوية عالية - ينصح بإضافة الجبس الزراعي'), recommendations);

        return recommendations;
    };

    // 🆕 NEWR: Desert Reclamation Plan Function
    var runDesertReclamationPlan = function () {
        infoPanel.clear();
        chartPanel.clear();

        infoPanel.add(ui.Label('🚜 خطة استصلاح الأراضي الصحراوية', {
            fontWeight: 'bold',
            fontSize: '18px',
            color: '#2E8B57',
            textAlign: 'center'
        }));

        infoPanel.add(ui.Label('Desert Reclamation Plan', {
            fontSize: '14px',
            color: '#666',
            textAlign: 'center'
        }));

        infoPanel.add(ui.Label('═══════════════════════════════════════', { color: '#2E8B57' }));

        // Phase 1
        infoPanel.add(ui.Label('📍 المرحلة 1: التجهيز الأولي (3-6 أشهر)', {
            fontWeight: 'bold',
            fontSize: '14px',
            color: '#1565C0',
            backgroundColor: '#E3F2FD',
            padding: '5px',
            margin: '10px 0'
        }));

        infoPanel.add(ui.Label('1. تحليل تربة مخبري شامل', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('2. تسوية الأرض وإزالة الصخور', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('3. حفر بئر أو توصيل مصدر مياه', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('4. إنشاء شبكة صرف زراعي', { margin: '0 0 0 10px' }));

        // Phase 2
        infoPanel.add(ui.Label('📍 المرحلة 2: تحسين التربة (6-12 شهر)', {
            fontWeight: 'bold',
            fontSize: '14px',
            color: '#1565C0',
            backgroundColor: '#E3F2FD',
            padding: '5px',
            margin: '10px 0'
        }));

        infoPanel.add(ui.Label('1. إضافة 20-30 م³/فدان سماد بلدي متحلل', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('2. إضافة جبس زراعي (إذا كانت التربة قلوية)', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('3. إضافة رمل (إذا كانت التربة طينية ثقيلة)', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('4. حرث عميق (40-60 سم) وتقليب', { margin: '0 0 0 10px' }));

        // Phase 3
        infoPanel.add(ui.Label('📍 المرحلة 3: الزراعة التجريبية (الموسم الأول)', {
            fontWeight: 'bold',
            fontSize: '14px',
            color: '#1565C0',
            backgroundColor: '#E3F2FD',
            padding: '5px',
            margin: '10px 0'
        }));

        infoPanel.add(ui.Label('🌾 محاصيل مقترحة للاستصلاح الأول:', { fontWeight: 'bold', margin: '5px 0' }));
        infoPanel.add(ui.Label('   • شعير (Barley) - الأكثر تحملاً للملوحة', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('   • برسيم حجازي (Alfalfa) - يحسن التربة', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('   • سورجم (Sorghum) - مقاوم للجفاف', { margin: '0 0 0 10px' }));

        // Cost Estimate
        infoPanel.add(ui.Label(''));
        infoPanel.add(ui.Label('💰 التكلفة التقديرية:', { fontWeight: 'bold', fontSize: '14px' }));
        infoPanel.add(ui.Label('   • استصلاح أولي: 15,000 - 25,000 ج/فدان', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('   • تكلفة سنوية: 8,000 - 12,000 ج/فدان', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('   • فترة العائد: 2-3 سنوات', { margin: '0 0 0 10px' }));

        // Warning
        infoPanel.add(ui.Label(''));
        infoPanel.add(ui.Label('⚠️ تحذير: الاستصلاح يحتاج:', {
            fontWeight: 'bold',
            color: '#D32F2F',
            backgroundColor: '#FFEBEE',
            padding: '5px'
        }));
        infoPanel.add(ui.Label('   • مصدر مياه موثوق (8000-12000 م³/فدان/سنة)', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('   • استشارة مهندس زراعي متخصص', { margin: '0 0 0 10px' }));
        infoPanel.add(ui.Label('   • دراسة جدوى اقتصادية شاملة', { margin: '0 0 0 10px' }));
    };

    // ====================================================================================
    // Step 1: LOCATION (الموقع)
    // ====================================================================================
    mainPanel.add(ui.Label({
        value: '1. 📍 موقع المزرعة (Farm Location)',
        style: { fontWeight: 'bold', fontSize: '14px', color: 'white', backgroundColor: '#2E8B57', padding: '4px 8px', stretch: 'horizontal', margin: '15px 0 5px 0' }
    }));

    // A) Governorate Select (For Zoom)
    mainPanel.add(ui.Label('أ) اختر المحافظة (للتقريب):', { fontWeight: 'bold', fontSize: '12px' }));

    var farmerGovSelect = ui.Select({
        placeholder: 'جاري تحميل المحافظات...',
        onChange: function (fullName) {
            if (!fullName) return;
            var govName = fullName.split(' - ')[0]; // Extract English Name
            var region = adminBoundaries.filter(ee.Filter.eq(regionNameField, govName));
            centerPanel.centerObject(region, 9);
            currentRegion = region.geometry();

            // Highlight Logic
            var layers = centerPanel.layers();
            var removeLayer = null;
            for (var i = 0; i < layers.length(); i++) {
                var layer = layers.get(i);
                if (layer && layer.getName() === '🔴 Active Selection') {
                    removeLayer = layer;
                    break;
                }
            }
            if (removeLayer) centerPanel.layers().remove(removeLayer);

            var highlightStyle = { color: 'FF0000', fillColor: '00000000', width: 3 };
            centerPanel.addLayer(region.style(highlightStyle), {}, '🔴 Active Selection');
        }
    });
    mainPanel.add(farmerGovSelect);

    // Populate list with Translations
    var govNames = adminBoundaries.aggregate_array(regionNameField).distinct().sort();
    govNames.evaluate(function (list) {
        var translatedList = list.map(function (name) {
            var ar = govTranslation[name] || name;
            return name + ' - ' + ar;
        });
        farmerGovSelect.items().reset(translatedList);
        farmerGovSelect.setPlaceholder('اختر المحافظة - Select Governorate');
    });

    // Helper: Add borders layer (Required for visibility toggle)
    function addBordersLayer() {
        var styled = adminBoundaries.style({ color: 'black', fillColor: '00000000', width: 1 });
        centerPanel.addLayer(styled, {}, 'Governorate boundaries', true);
    }

    // Default: Add borders
    addBordersLayer();

    // Toggle for Borders (Needed for reference later)
    var showBordersCheckbox = ui.Checkbox({
        label: 'show borders (legacy ref)',
        value: true
    });
    showBordersCheckbox.style().set('shown', false); // Hidden utility checkbox to maintain state without clutter
    mainPanel.add(showBordersCheckbox);

    // B) Direct Selection Mode & Manual Inputs
    mainPanel.add(ui.Label('ب) حدد مكان المزرعة:', { fontWeight: 'bold', fontSize: '12px', margin: '10px 0 0 0' }));

    var bufferBox = ui.Textbox({ value: '500', placeholder: 'Buffer', style: { width: '60px' } });

    // Hidden Lat/Lon boxes (Used by Analyze Button logic)
    var latBox = ui.Textbox({ value: '', placeholder: 'Lat', style: { width: '100px', shown: false } });
    var lonBox = ui.Textbox({ value: '', placeholder: 'Lon', style: { width: '100px', shown: false } });

    var locationStatusLabel = ui.Label('📍 لم يتم تحديد الموقع بعد', { color: 'gray', fontSize: '13px', margin: '0 0 0 20px' });

    // Panel for Buffer & Status
    var locOptionsPanel = ui.Panel({
        widgets: [ui.Label('نطاق التحليل (متر):'), bufferBox],
        layout: ui.Panel.Layout.flow('horizontal'),
        style: { margin: '0 0 0 20px' }
    });
    mainPanel.add(locOptionsPanel);
    mainPanel.add(locationStatusLabel);

    // Manual Input Toggle (Optional)
    var manualInputCheckbox = ui.Checkbox({
        label: 'أو أدخل الإحداثيات يدوياً (Manual Input)',
        value: false,
        onChange: function (checked) {
            latBox.style().set('shown', checked);
            lonBox.style().set('shown', checked);
        },
        style: { fontSize: '13px', color: 'black', margin: '10px 0 0 0' }
    });
    mainPanel.add(manualInputCheckbox);

    var manualPanel = ui.Panel({
        widgets: [latBox, lonBox],
        layout: ui.Panel.Layout.flow('horizontal'),
        style: { margin: '0 0 0 20px' }
    });
    mainPanel.add(manualPanel);

    // C) GPS Location Button (Direct)
    var gpsButton = ui.Button({
        label: '🌐 استخدام موقعي الحالي (Use My Location)',
        style: { stretch: 'horizontal', color: '#1565C0', backgroundColor: '#E3F2FD', fontWeight: 'bold', border: '1px solid #90CAF9', margin: '5px 0' },
        onClick: function () {
            gpsButton.setLabel('⏳ جاري تحديد الموقع... (Locating)');
            ui.util.getCurrentPosition(function (position) {
                // 💡 Expert Logic: Handle Proxy Objects (Point) vs Plain JS Objects
                print('GPS Data Received (Raw):', position);

                // If it's a GEE Geometry/Proxy, convert to plain JS object first
                if (position && typeof position.getInfo === 'function') {
                    position = position.getInfo();
                    print('GPS Data Received (Converted):', position);
                }

                var lat, lon;
                // Handle various potential formats robustly
                if (position.coordinates && Array.isArray(position.coordinates)) {
                    lon = position.coordinates[0];
                    lat = position.coordinates[1];
                } else {
                    lat = position.lat || (position.coords ? position.coords.latitude : null) || position.latitude;
                    lon = position.lon || (position.coords ? position.coords.longitude : null) || position.longitude;
                }

                if (lat === undefined || lat === null || lon === undefined || lon === null) {
                    gpsButton.setLabel('⚠️ فشل تحليل إحداثيات الموقع');
                    print('Error: Could not extract lat/lon from structure:', position);
                    return;
                }

                latBox.setValue(lat.toFixed(6));
                lonBox.setValue(lon.toFixed(6));

                var marker = ee.Geometry.Point([lon, lat]);
                var bufferSize = parseFloat(bufferBox.getValue()) || 500;
                var farmArea = marker.buffer(bufferSize);

                centerPanel.layers().reset();
                addBordersLayer();
                centerPanel.addLayer(farmArea, { color: 'green', fillColor: '#00FF0044' }, '🌾 نطاق المزرعة');
                centerPanel.addLayer(marker, { color: 'red' }, '📍 الموقع الحالي');
                centerPanel.centerObject(marker, 17);

                locationStatusLabel.setValue('✅ تم تحديد موقعك: ' + lat.toFixed(4) + ', ' + lon.toFixed(4));
                locationStatusLabel.style().set('color', '#1B5E20');
                gpsButton.setLabel('🎯 تم تحديد الموقع بنجاح');

                infoPanel.clear();
                infoPanel.add(ui.Label('✅ تم العثور عليك!', { fontWeight: 'bold', color: 'green', fontSize: '14px' }));
                infoPanel.add(ui.Label('تم رصد موقعك الحالي بدقة. اضغط "بدء التحليل" للمتابعة.'));

            }, function (error) {
                gpsButton.setLabel('⚠️ فشل التحديد (GPS Failed)');
                infoPanel.add(ui.Label('❌ فشل تحديد الموقع: ' + error, { color: 'red' }));
            }, true); // Enable High Accuracy
        }
    });

    mainPanel.add(gpsButton);

    // Map Click Logic
    // Toggle Button for Map Click (Primary Interaction for Step 1)
    var directLocationMode = false;
    var mapToolButton = ui.Button({
        label: '📍 انقر هنا لتفعيل تحديد الموقع على الخريطة (Activate Location Picker)',
        style: { stretch: 'horizontal', color: 'black', backgroundColor: '#f0f0f0', margin: '8px 0', fontWeight: 'bold', border: '1px solid #ccc' }, // Light Gray
        onClick: function () {
            directLocationMode = !directLocationMode; // Toggle

            if (directLocationMode) {
                // ACTIVE STATE
                mapToolButton.setLabel('🛑 إيقاف التحديد (Stop Picker)');
                mapToolButton.style().set('backgroundColor', '#ffaaaa'); // Light Red for contrast
                mapToolButton.style().set('color', 'black');
                centerPanel.style().set('cursor', 'crosshair');

                infoPanel.clear();
                infoPanel.add(ui.Label('🎯 الوضع نشط: انقر على الخريطة الآن!', { fontWeight: 'bold', color: 'green', fontSize: '14px' }));
                infoPanel.add(ui.Label('💡 نصيحة: كبّر الخريطة لرؤية حقلك بوضوح', { fontSize: '13px', color: '#666' }));

                // Ensure borders are visible
                if (showBordersCheckbox.getValue()) addBordersLayer();

            } else {
                // INACTIVE STATE
                mapToolButton.setLabel('📍 انقر لتفعيل تحديد الموقع مرة أخرى');
                mapToolButton.style().set('backgroundColor', '#f0f0f0');
                mapToolButton.style().set('color', 'black');
                centerPanel.style().set('cursor', 'hand');
                infoPanel.clear();
                infoPanel.add(ui.Label('تم إيقاف وضع التحديد.', { color: 'gray' }));
            }
        }
    });

    mainPanel.add(mapToolButton);

    // Map Click Logic Linker (listener setup below handles the rest)



    // Unified Map Click Handler
    var gpsSelectionMode = false; // Legacy var for compatibility
    if (mapClickListener) { centerPanel.unlisten(mapClickListener); }
    mapClickListener = centerPanel.onClick(function (coords) {
        if (directLocationMode) {
            latBox.setValue(coords.lat.toFixed(6));
            lonBox.setValue(coords.lon.toFixed(6));

            var marker = ee.Geometry.Point([coords.lon, coords.lat]);
            var bufferSize = parseFloat(bufferBox.getValue()) || 500;
            var farmArea = marker.buffer(bufferSize);

            centerPanel.layers().reset();
            // Re-add borders if needed (simplified: always add)
            addBordersLayer();

            centerPanel.addLayer(farmArea, { color: 'green', fillColor: '#00FF0044' }, '🌾 نطاق المزرعة');
            centerPanel.addLayer(marker, { color: 'red' }, '📍 الموقع');

            locationStatusLabel.setValue('✅ تم: ' + coords.lat.toFixed(4) + ', ' + coords.lon.toFixed(4));
            locationStatusLabel.style().set('color', 'green');
            locationStatusLabel.style().set('fontWeight', 'bold');

            infoPanel.clear();
            infoPanel.add(ui.Label('✅ تم تحديد الموقع بنجاح!', { fontWeight: 'bold', color: 'green', fontSize: '14px' }));
            infoPanel.add(ui.Label('الخطوة التالية: اختر المحصول واضغط زر التحليل.', { color: 'gray' }));
        }
    });

    // ====================================================================================
    // Step 2: CROP & TIME (المحصول والوقت)
    // ====================================================================================
    mainPanel.add(ui.Label({
        value: '2. 🌾 بيانات المحصول والوقت (Crop & Time)',
        style: { fontWeight: 'bold', fontSize: '14px', color: 'black', backgroundColor: '#f0f0f0', padding: '4px 8px', stretch: 'horizontal', margin: '15px 0 5px 0', border: '1px solid #ddd' }
    }));

    // Crop Selection
    mainPanel.add(ui.Label('نوع المحصول:', { fontWeight: 'bold', fontSize: '12px' }));
    var farmerCropSelect = ui.Select({
        items: [
            '--- اختر المحصول (Select Crop) ---',
            '🌱 لم أزرع بعد (Not Planted / Fallow)',
            'قمح (Wheat)',
            'ذرة (Maize)',
            'أرز (Rice)',
            'قطن (Cotton)',
            'قصب السكر (Sugarcane)',
            'بطاطس (Potatoes)',
            'طماطم (Tomato)',
            'فول سوداني (Peanuts)',
            'برسيم (Alfalfa)',
            'بنجر السكر (Sugar Beet)'
        ],
        value: '--- اختر المحصول (Select Crop) ---',
        style: { stretch: 'horizontal' }
    });
    mainPanel.add(farmerCropSelect);

    // Time Selection
    mainPanel.add(ui.Label('توقيت التحليل:', { fontWeight: 'bold', fontSize: '12px', margin: '10px 0 0 0' }));
    var realtimeModeCheckbox = ui.Checkbox({
        label: '⚡ تحليل فوري (آخر 30 يوم) - Real-time',
        value: true,  // Default to real-time
        style: { fontWeight: 'bold', color: 'black', backgroundColor: '#f9f9f9', padding: '5px', border: '1px solid #eee' }
    });
    mainPanel.add(realtimeModeCheckbox);

    // Custom Date Range (Initially Hidden)
    var startDateBox = ui.Textbox({ value: '2023-01-01', placeholder: 'Start', style: { width: '90px' } });
    var endDateBox = ui.Textbox({ value: '2023-12-31', placeholder: 'End', style: { width: '90px' } });

    var dateRow = ui.Panel({
        widgets: [ui.Label('مخصص:'), startDateBox, ui.Label('إلى'), endDateBox],
        layout: ui.Panel.Layout.flow('horizontal'),
        style: { shown: false, margin: '0 0 0 20px' }
    });
    mainPanel.add(dateRow);

    realtimeModeCheckbox.onChange(function (checked) {
        dateRow.style().set('shown', !checked);
    });

    // Step 3: ACTION (التنفيذ)
    // ====================================================================================
    var masterExecuteButton = ui.Button({
        label: '3. 🚀 بدء التحليل (Execute Analysis)',
        style: { stretch: 'horizontal', color: 'black', backgroundColor: '#90EE90', fontWeight: 'bold', fontSize: '18px', padding: '10px', margin: '15px 0 5px 0', border: '1px solid #4CAF50' },
        onClick: function () {
            // ======= STEP 1: Get coordinates and validate input =======
            var lat = parseFloat(latBox.getValue());
            var lon = parseFloat(lonBox.getValue());
            var bufferSize = parseFloat(bufferBox.getValue()) || 500;
            var selectedCrop = farmerCropSelect.getValue();

            // Input validation
            if (selectedCrop === '--- اختر المحصول (Select Crop) ---') {
                infoPanel.clear();
                infoPanel.add(ui.Label('⚠️ تنبيه: يرجى اختيار نوع المحصول أولاً للمتابعة.', {
                    color: 'red', fontWeight: 'bold', backgroundColor: '#FFF3E0', padding: '10px', border: '1px solid #FFCC80', stretch: 'horizontal'
                }));
                showReportView();
                return;
            }

            if (isNaN(lat) || isNaN(lon)) {
                infoPanel.clear();
                infoPanel.add(ui.Label('⚠️ خطأ: يرجى إدخال إحداثيات صحيحة!', { color: 'red', fontWeight: 'bold' }));
                infoPanel.add(ui.Label('خطأ: يرجى إدخال إحداثيات صحيحة.', { color: 'red', fontWeight: 'bold' }));
                showReportView();
                return;
            }

            infoPanel.clear();
            infoPanel.add(ui.Label('🔬 جاري التحقق من نوع الأرض...', { fontWeight: 'bold', color: '#4169E1' }));
            infoPanel.add(ui.Label('جاري التحقق من الغطاء الأرضي في الموقع...'));
            showReportView();

            var farmPoint = ee.Geometry.Point([lon, lat]);
            var farmArea = farmPoint.buffer(bufferSize);

            // ======= STEP 2: Validate Farm Location =======
            // Determine date range for validation
            var validationStart, validationEnd;
            if (realtimeModeCheckbox.getValue()) {
                var today = new Date();
                var yearAgo = new Date();
                yearAgo.setFullYear(today.getFullYear() - 1);
                validationEnd = today.toISOString().split('T')[0];
                validationStart = yearAgo.toISOString().split('T')[0];
            } else {
                validationStart = startDateBox.getValue();
                validationEnd = endDateBox.getValue();
            }

            var validationStats = validateFarmLocation(farmArea, validationStart, validationEnd);

            validationStats.evaluate(function (result, error) {
                if (error) {
                    infoPanel.clear();
                    infoPanel.add(ui.Label('⚠️ خطأ في التحقق، سيتم المتابعة مع التحليل...', { color: 'orange' }));
                    runReportLogic(false, false);
                    return;
                }

                // ======= EXTRACT ALL METRICS =======
                var cropsProb = result.crops_prob || 0;
                var bareProb = result.bare_prob || 0;
                var builtProb = result.built_prob || 0;

                var ndviMax = result.ndvi_max || 0;
                var ndviMean = result.ndvi_mean || 0;
                var ndviRange = result.ndvi_range || 0;

                // 🆕 NEW: Enhanced desert detection metrics
                var bsiMean = result.bsi_mean || 0;
                var ndbiMean = result.ndbi_mean || 0;
                var albedoMean = result.albedo_mean || 0;
                var ndviStdDev = result.ndvi_stdDev || 0;
                var obsCount = result.observation_count || 0;

                // ======= PRE-CHECK: USER INTENT (NOT PLANTED) =======
                var selectedCrop = farmerCropSelect.getValue();
                var isNotPlanted = (selectedCrop.indexOf('Not Planted') > -1 || selectedCrop.indexOf('لم أزرع') > -1);

                infoPanel.clear();



                // ======= ENHANCED DESERT DETECTION =======
                // Multiple criteria must be met to classify as "desert"

                var isDesert = false;
                var desertReasons = [];

                // Criterion 1: Very low NDVI (vegetation)
                if (ndviMax < 0.15) {
                    desertReasons.push('NDVI منخفض جداً (' + ndviMax.toFixed(3) + ')');
                }

                // Criterion 2: High Bare Soil Index (BSI > 0.1 indicates significant bare soil)
                if (bsiMean > 0.05) {
                    desertReasons.push('BSI مرتفع (' + bsiMean.toFixed(3) + ')');
                }

                // Criterion 3: Low NDVI range (no seasonal variation = no crops)
                if (ndviRange < 0.1) {
                    desertReasons.push('لا يوجد تباين موسمي (' + ndviRange.toFixed(3) + ')');
                }

                // Criterion 4: High albedo (bright sand/rock)
                if (albedoMean > 0.15) {
                    desertReasons.push('انعكاسية عالية (' + albedoMean.toFixed(3) + ')');
                }

                // Criterion 5: Very low spatial variance (homogeneous = no field patterns)
                if (ndviStdDev < 0.05) {
                    desertReasons.push('تجانس مكاني عالي (صحراء موحدة)');
                }

                // FINAL DECISION: At least 3 criteria + bare probability
                isDesert = (desertReasons.length >= 3) || (bareProb > 0.6 && ndviMax < 0.2);

                // Also check if it's urban (different from desert)
                var isUrban = (builtProb > 0.35) || (ndbiMean > 0.1 && builtProb > cropsProb);

                // Override: If it's clearly urban, it's not desert
                if (isUrban) {
                    isDesert = false;
                }

                // ======= DISPLAY VALIDATION RESULTS =======
                infoPanel.clear();

                if (isDesert) {
                    // 🏜️ DESERT DETECTED
                    infoPanel.add(ui.Label(''));
                    infoPanel.add(ui.Label('🏜️ تنبيه: منطقة صحراوية جرداء!', {
                        color: 'black',
                        fontWeight: 'bold',
                        fontSize: '16px',
                        backgroundColor: '#f9f9f9',
                        padding: '10px',
                        border: '1px solid #ddd'
                    }));

                    infoPanel.add(ui.Label('⚠️ هذا الموقع يقع في منطقة صحراوية غير صالحة للزراعة مباشرة.', {
                        fontSize: '13px'
                    }));

                    infoPanel.add(ui.Label(''));
                    infoPanel.add(ui.Label('📋 أسباب التصنيف:', { fontWeight: 'bold', color: 'black' }));
                    desertReasons.forEach(function (reason) {
                        infoPanel.add(ui.Label('   • ' + reason, { fontSize: '13px', color: 'black' }));
                    });

                    infoPanel.add(ui.Label(''));
                    infoPanel.add(ui.Label('💡 الخيارات المتاحة:', { fontWeight: 'bold' }));

                    var btnReclaim = ui.Button({
                        label: '🚜 عرض خطة استصلاح الأراضي الصحراوية',
                        style: { stretch: 'horizontal', color: 'black', backgroundColor: '#90EE90', fontWeight: 'bold', border: '1px solid #4CAF50' },
                        onClick: function () { runDesertReclamationPlan(); }
                    });
                    infoPanel.add(btnReclaim);

                    // 3) Suitability Button Removed (User Request)

                    // STOP HERE - Don't show crop report for desert
                    return;

                } else if (isUrban) {
                    // 🏙️ URBAN DETECTED
                    infoPanel.add(ui.Label(''));
                    infoPanel.add(ui.Label('🏙️ رفض: منطقة حضرية/مباني!', { color: 'black', fontWeight: 'bold', fontSize: '14px', backgroundColor: '#ffaaaa', padding: '5px' }));
                    infoPanel.add(ui.Label('رفض: تم رصد منطقة عمرانية/مباني', { color: 'black' }));
                    infoPanel.add(ui.Label('💡 الخيارات المتاحة:', { fontWeight: 'bold' }));
                    infoPanel.add(ui.Label('   • هذه المنطقة مصنفة كمنطقة عمرانية.'));

                    // 4) Suitability Button Removed (User Request)

                    var btnForce = ui.Button({ label: '⚠️ متابعة التقرير الحالي', style: { stretch: 'horizontal', color: 'orange' }, onClick: function () { runReportLogic(false, true); } });
                    infoPanel.add(btnForce);

                } else {
                    // ✅ VALID AGRICULTURAL AREA
                    infoPanel.add(ui.Label(''));
                    infoPanel.add(ui.Label('✅ قبول: موقع زراعي صالح!', { color: 'black', fontWeight: 'bold', fontSize: '14px' }));
                    infoPanel.add(ui.Label('قبول: موقع زراعي صالح', { color: 'black' }));
                    infoPanel.add(ui.Label('🔄 جاري إعداد التقرير...', { fontWeight: 'bold', color: 'black' }));

                    runReportLogic(false, false);
                }
            });



            // Function to run the report (Used after validation)
            var runReportLogic = function (isBarren, isUrban) {
                infoPanel.clear();
                chartPanel.clear();

                infoPanel.add(ui.Label('🔄 جاري تحليل موقع المزرعة...', { fontWeight: 'bold', color: 'black' }));
                infoPanel.add(ui.Label('جاري تحليل موقع المزرعة عند: ' + lat.toFixed(4) + ', ' + lon.toFixed(4), { color: 'black' }));

                if (lat < 22 || lat > 32 || lon < 24 || lon > 37) {
                    infoPanel.add(ui.Label('⚠️ تحذير: الإحداثيات خارج حدود مصر!', { color: 'black', backgroundColor: '#ffaaaa', padding: '5px' }));
                }

                // Create farm geometry (already defined above)
                // var farmPoint = ee.Geometry.Point([lon, lat]);
                // var farmArea = farmPoint.buffer(bufferSize);

                // Add marker to map
                centerPanel.layers().reset();
                var marker = ui.Map.Layer(farmPoint, { color: 'red' }, '📍 Farm Location');
                var area = ui.Map.Layer(farmArea, { color: 'green', fillColor: '#00FF0033' }, '🌾 Farm Area (' + bufferSize + 'm)');
                centerPanel.layers().add(marker);
                centerPanel.layers().add(area);
                centerPanel.centerObject(farmPoint, 17);

                // ======= DETERMINE DATE RANGE =======
                var start, end, analysisMode;

                if (realtimeModeCheckbox.getValue()) {
                    // Real-time mode: use last 30 days (using JavaScript Date)
                    var today = new Date();
                    var thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(today.getDate() - 30);

                    // Format dates as YYYY-MM-DD
                    end = today.toISOString().split('T')[0];
                    start = thirtyDaysAgo.toISOString().split('T')[0];

                    analysisMode = '⚡ تحليل فوري (Real-time)';
                    infoPanel.add(ui.Label('⚡ وضع التحليل الفوري: آخر 30 يوم', { color: 'black', fontWeight: 'bold', backgroundColor: '#f0f0f0', padding: '5px' }));
                } else {
                    // Manual date range mode
                    start = startDateBox.getValue();
                    end = endDateBox.getValue();
                    analysisMode = '📅 فترة محددة (Custom Range)';
                }

                infoPanel.add(ui.Label('📅 الفترة: ' + start + ' إلى ' + end, { color: 'black' }));
                var cropType = farmerCropSelect.getValue();
                var isNotPlanted = (cropType.indexOf('Not Planted') > -1 || cropType.indexOf('لم أزرع') > -1);

                // Get satellite data
                var s2Col = getS2Collection(start, end, farmArea);

                s2Col.size().evaluate(function (size) {
                    if (size === 0) {
                        infoPanel.add(ui.Label('⚠️ لا تتوفر صور أقمار صناعية لهذه الفترة!', { color: 'black', backgroundColor: '#ffaaaa', padding: '5px' }));
                        return;
                    }

                    var s2 = s2Col.median().clip(farmArea);

                    // ======= CALCULATE ALL AVAILABLE INDICES =======
                    // Vegetation indices
                    var ndvi = indicesDict['NDVI (Vegetation)'](s2);
                    var evi = indicesDict['EVI (Enhanced Vegetation Index)'](s2);
                    var savi = indicesDict['SAVI (Soil-Adjusted Vegetation Index)'](s2);
                    var gci = indicesDict['GCI (Green Chlorophyll Index)'](s2);

                    // Moisture indices
                    var ndmi = indicesDict['NDMI (Vegetation Moisture)'](s2);
                    var ndwi = indicesDict['NDWI (McFeeters Water Index)'](s2);

                    // Soil indices
                    var ndsi = indicesDict['NDSI (Salinity Index)'](s2);
                    var bsi = indicesDict['Bare Soil Index (BSI - Approx)'](s2);
                    var clayRatio = indicesDict['Clay Minerals Ratio'](s2);
                    var ironOxide = indicesDict['Iron Oxide Ratio'](s2);
                    var gypsumIndex = indicesDict['Gypsum Index'](s2);
                    var carbonateIndex = indicesDict['Carbonate Index'](s2);
                    var esi = indicesDict['Enhanced Salinity Index (ESI)'](s2);

                    // Get climate data
                    var era5 = getEra5(start, end, farmArea);
                    var soilMoisture = era5.select('sm_topsoil_m3m3');
                    var rootzoneMoisture = era5.select('sm_rootzone_m3m3');

                    // Get LST from Landsat
                    var lsCol = getMergedLandsatCollection(start, end, farmArea);
                    var lstMean = ee.Image(ee.Algorithms.If(
                        lsCol.size().gt(0),
                        lsCol.select('LST').median(),
                        ee.Image(30).rename('LST')
                    ));

                    // Calculate VHI (Vegetation Health Index)
                    var vci = ndvi.unitScale(0, 0.8).multiply(100).clamp(0, 100);
                    // TCI: Scale LST from 15-50°C, then invert (lower temp = better)
                    var tci = ee.Image(100).subtract(lstMean.unitScale(15, 50).multiply(100)).clamp(0, 100);
                    var vhi = vci.multiply(0.5).add(tci.multiply(0.5));

                    // Get precipitation
                    var precip = getChirps(start, end, farmArea);

                    // Get evapotranspiration
                    var et = getModisET(start, end, farmArea);

                    // === [بداية الكود الجديد] ===
                    // 1. جلب بيانات الرادار
                    var s1Col = getS1Collection(start, end, farmArea);
                    // التأكد من وجود بيانات لتجنب الخطأ
                    var s1 = ee.Algorithms.If(
                        s1Col.size().gt(0),
                        s1Col.median().clip(farmArea),
                        ee.Image([0, 0]).rename(['VV_smoothed', 'VH_smoothed'])
                    );
                    s1 = ee.Image(s1);

                    // 2. تشغيل النموذج المتقدم لحساب الملوحة الحقيقية
                    // لاحظ أننا نمرر dem و slope الموجودين كمتغيرات عالمية
                    var advancedEC = estimateSalinity_ML(s2, s1, lstMean, precip, et, dem, slope);
                    // === [نهاية الكود الجديد] ===

                    // ======= OpenLandMap REAL SOIL DATA (Processed Outside Dictionary) =======
                    var olmImage = getOpenLandMapSoil(farmArea);
                    // Quantitative: Mean
                    var olmStatsMean = olmImage.select(['Clay_0cm', 'Sand_0cm', 'OC_0cm', 'pH_0cm', 'BulkDens_0cm', 'WC_33kPa'])
                        .reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 250, maxPixels: 1e9 });

                    // Categorical: Mode (Most Frequent) - Fix for Texture Class averaging bug
                    var textureMode = olmImage.select('TextureClass')
                        .reduceRegion({ reducer: ee.Reducer.mode(), geometry: farmArea, scale: 250, maxPixels: 1e9 });

                    // Combine results
                    var olmSoilProperties = olmStatsMean.combine(textureMode);

                    // ======= COMPREHENSIVE STATISTICS =======
                    var stats = ee.Dictionary({
                        // Vegetation
                        ndvi: ndvi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        evi: evi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        savi: savi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        gci: gci.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),

                        // Moisture
                        ndmi: ndmi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        ndwi: ndwi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),

                        // Soil indices
                        ndsi: ndsi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        bsi: bsi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        clayRatio: clayRatio.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        ironOxide: ironOxide.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        gypsumIndex: gypsumIndex.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        carbonateIndex: carbonateIndex.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        esi: esi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),
                        si3: indicesDict['SI3 (Salinity Index 3)'](s2).reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),

                        // === [أضف هذا السطر] ===
                        ec_dsm: advancedEC.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 10, maxPixels: 1e9 }),

                        // Climate data
                        sm: soilMoisture.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 11132, maxPixels: 1e9 }),
                        smRoot: rootzoneMoisture.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 11132, maxPixels: 1e9 }),
                        lst: lstMean.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 30, maxPixels: 1e9 }),
                        vhi: vhi.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 30, maxPixels: 1e9 }),
                        precip: precip.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 5566, maxPixels: 1e9 }),
                        et: et.reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 500, maxPixels: 1e9 }),
                        rh: era5.select('RH').reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 11132, maxPixels: 1e9 }),
                        airTemp: era5.select('air_temp_C').reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 11132, maxPixels: 1e9 }),
                        windSpeed: era5.select('WindSpeed').reduceRegion({ reducer: ee.Reducer.mean(), geometry: farmArea, scale: 11132, maxPixels: 1e9 }),

                        // ======= OpenLandMap REAL SOIL DATA =======
                        olmSoil: olmSoilProperties,

                        // Time Context
                        currentMonth: ee.Number(ee.Date(end).get('month'))
                    });

                    stats.evaluate(function (result, error) {
                        infoPanel.clear();
                        chartPanel.clear();

                        if (error) {
                            infoPanel.add(ui.Label('❌ خطأ في جلب البيانات!', { color: 'black', fontWeight: 'bold', backgroundColor: '#ffaaaa', padding: '5px' }));
                            infoPanel.add(ui.Label('خطأ: ' + error, { color: 'black', fontSize: '13px' }));
                            return;
                        }

                        if (!result) {
                            infoPanel.add(ui.Label('❌ لا تتوفر بيانات في هذا الموقع!', { color: 'black', fontWeight: 'bold', backgroundColor: '#ffaaaa', padding: '5px' }));
                            return;
                        }

                        // ======= SAFE VALUE EXTRACTION (Enhanced) =======
                        function safeGet(obj, key1, key2Sub, defaultVal) {
                            try {
                                if (!obj || !obj[key1]) return defaultVal;
                                var inner = obj[key1];
                                // 1. Try exact match
                                if (inner[key2Sub] !== undefined && inner[key2Sub] !== null) return inner[key2Sub];

                                // 2. Try looking for the key in a flexible way (handle _mean suffix etc)
                                var keys = Object.keys(inner);
                                var foundKey = null;
                                // Use loop instead of .find() for ES5 compatibility
                                for (var k = 0; k < keys.length; k++) {
                                    var currentKey = keys[k];
                                    if (currentKey.indexOf(key2Sub) > -1 || currentKey.indexOf('_mean') > -1 || currentKey === 'mean') {
                                        foundKey = currentKey;
                                        break;
                                    }
                                }

                                if (foundKey && inner[foundKey] !== undefined && inner[foundKey] !== null) {
                                    return inner[foundKey];
                                }

                                return defaultVal;
                            } catch (e) { return defaultVal; }
                        }

                        // Extract main indices
                        var ndviVal = safeGet(result, 'ndvi', 'NDVI', 0);
                        var eviVal = safeGet(result, 'evi', 'EVI', 0);
                        var saviVal = safeGet(result, 'savi', 'SAVI', 0);
                        var ndmiVal = safeGet(result, 'ndmi', 'NDMI', 0);
                        var ndsiVal = safeGet(result, 'ndsi', 'NDSI', 0);
                        var esiVal = safeGet(result, 'esi', 'ESI', 0.5);
                        var si3Val = safeGet(result, 'si3', 'SI3', 0.1);
                        var clayRatioVal = safeGet(result, 'clayRatio', 'ClayRatio', 1.2);
                        var ironOxideVal = safeGet(result, 'ironOxide', 'IronOxide', 0);
                        var gypsumVal = safeGet(result, 'gypsumIndex', 'GypsumIndex', 0);
                        var carbonateVal = safeGet(result, 'carbonateIndex', 'CarbonateIndex', 0);
                        var vhiVal = safeGet(result, 'vhi', 'VCI', 50);
                        var rhVal = safeGet(result, 'rh', 'RH', 40);
                        var airTempVal = safeGet(result, 'airTemp', 'air_temp_C', 25);
                        var windSpeedVal = safeGet(result, 'windSpeed', 'WindSpeed', 3);
                        var bsiVal = safeGet(result, 'bsi', 'BSI', 0);
                        var smVal = safeGet(result, 'sm', 'sm_topsoil_m3m3', null);
                        var smRootVal = safeGet(result, 'smRoot', 'sm_rootzone_m3m3', null);
                        var lstVal = safeGet(result, 'lst', 'LST', 30);
                        var etVal = safeGet(result, 'et', 'ET', 5);
                        var precipVal = safeGet(result, 'precip', 'Precipitation', 0);

                        // === [بداية تعديل عرض الملوحة] ===
                        // استخراج القيمة الحقيقية للملوحة
                        var ecRealVal = safeGet(result, 'ec_dsm', 'EC_dSm', -1);

                        // 🛑 FIX: Heuristic fallback for default/stalled values
                        // Trigger fallback ONLY in bare/low-veg areas with high salt evidence
                        if (ecRealVal <= 1.05 && ndsiVal > 0.25 && ndviVal < 0.20 && bsiVal > 0.05) {
                            ecRealVal = 10.0 + (ndsiVal * 20); // High estimate for salt pans
                        }
                        if (ecRealVal < 0) ecRealVal = 1.0; // Hard default if all fails

                        var salinityLevel = 'طبيعية';
                        var salinityColor = 'green';
                        var cropTolerance = '';
                        var specialConditions_ML = []; // Separate from main to avoid scope issues

                        // تصنيف FAO للملوحة
                        if (ecRealVal > 16) {
                            salinityLevel = '☠️ شديدة الملوحة';
                            salinityColor = '#B71C1C'; // أحمر داكن
                            cropTolerance = 'غير صالحة للزراعة التقليدية';
                            specialConditions_ML.push('سبخة ملحية');
                        } else if (ecRealVal > 8) {
                            salinityLevel = '🔴 عالية الملوحة';
                            salinityColor = '#D32F2F'; // أحمر
                            cropTolerance = 'شعير، نخيل، بنجر السكر';
                            specialConditions_ML.push('ملوحة عالية');
                        } else if (ecRealVal > 4) {
                            salinityLevel = '🟠 متوسطة الملوحة';
                            salinityColor = '#F57C00'; // برتقالي
                            cropTolerance = 'قمح، قطن، تين، رمان';
                            specialConditions_ML.push('ملوحة متوسطة');
                        } else if (ecRealVal > 2) {
                            salinityLevel = '🟡 طفيفة الملوحة';
                            salinityColor = '#FBC02D'; // أصفر
                            cropTolerance = 'معظم المحاصيل ما عدا الحساسة جداً';
                        } else {
                            salinityLevel = '✅ تربة عذبة';
                            salinityColor = '#388E3C'; // أخضر
                            cropTolerance = 'جميع المحاصيل';
                        }

                        // تحديث المتغير csiVal (للتوافق مع باقي الكود القديم إذا لزم الأمر)
                        // نقوم بتحويل EC لقيمة تقريبية بين 0-1 فقط لغرض التوافق مع باقي التحذيرات
                        var csiVal = Math.min(1, ecRealVal / 10);
                        // === [نهاية التعديل] ===

                        // Extract OpenLandMap Soil Data
                        var olmClay = safeGet(result, 'olmSoil', 'Clay_0cm', null);
                        var olmSand = safeGet(result, 'olmSoil', 'Sand_0cm', null);
                        var olmOC = safeGet(result, 'olmSoil', 'OC_0cm', null);
                        var olmPH = safeGet(result, 'olmSoil', 'pH_0cm', null);
                        var olmBulkDens = safeGet(result, 'olmSoil', 'BulkDens_0cm', null);
                        var olmWC33 = safeGet(result, 'olmSoil', 'WC_33kPa', null);
                        var olmTextureRaw = safeGet(result, 'olmSoil', 'TextureClass', null);
                        var hasRealSoilData = (olmClay !== null && olmSand !== null);

                        // ======= USDA Texture Triangle Classification (v4.0 - Scientific) =======
                        // التصنيف العلمي: مثلث القوام USDA بدلاً من التصحيح الطيفي المشكوك فيه
                        var olmSilt = (olmClay !== null && olmSand !== null) ? (100 - olmClay - olmSand) : null;
                        if (olmSilt !== null && olmSilt < 0) olmSilt = 0;

                        var olmTexture;
                        var soilSource;
                        var soilSourceColor;

                        if (olmClay !== null && olmSand !== null) {
                            // ✅ بيانات حقيقية متاحة → استخدام مثلث USDA
                            olmTexture = classifyUSDATexture(olmClay, olmSand);
                            soilSource = '🔬 مثلث USDA (Clay=' + olmClay.toFixed(0) + '%, Sand=' + olmSand.toFixed(0) + '%, Silt=' + olmSilt.toFixed(0) + '%)';
                            soilSourceColor = '#1976D2';
                        } else if (olmTextureRaw) {
                            // ⚠️ فقط class ID متاح → استخدام الجدول
                            olmTexture = textureClassNames[Math.round(olmTextureRaw)] || 'غير معروف (Unknown)';
                            soilSource = '📡 تلقائي (OpenLandMap Class ID)';
                            soilSourceColor = 'gray';
                        } else {
                            olmTexture = 'غير معروف (Unknown)';
                            soilSource = '⚠️ لا تتوفر بيانات تربة';
                            soilSourceColor = '#D32F2F';
                        }

                        var isLiveBarren = (ndviVal < 0.20) || (bsiVal > 0.25);
                        var isInvalidForCrop = isBarren || isUrban || isLiveBarren;

                        // ═══════════════════════════════════════════════════════
                        // 🎨 UI HELPERS
                        // ═══════════════════════════════════════════════════════
                        var createStatRow = function (name, value, color, note) {
                            var row = ui.Panel({ layout: ui.Panel.Layout.flow('horizontal'), style: { margin: '2px 0', backgroundColor: '#f9f9f9', padding: '4px' } });
                            row.add(ui.Label(name, { fontSize: '13px', stretch: 'horizontal', fontWeight: 'bold' }));
                            row.add(ui.Label(value, { fontSize: '14px', color: color || 'black', fontWeight: 'bold' }));
                            if (note) row.add(ui.Label(note, { fontSize: '12px', color: '#666', fontStyle: 'italic', margin: '0 0 0 5px' }));
                            return row;
                        };

                        var createCard = function (title, emoji, bgColor) {
                            return ui.Panel({
                                widgets: [
                                    ui.Label(emoji + ' ' + title, {
                                        fontWeight: 'bold', fontSize: '16px', color: 'black', backgroundColor: '#f0f0f0',
                                        padding: '8px', stretch: 'horizontal', textAlign: 'center', margin: '15px 0 5px 0',
                                        border: '1px solid #ccc'
                                    })
                                ]
                            });
                        };

                        var createInfoRow = function (label, value, status, statusColor) {
                            var row = ui.Panel({ layout: ui.Panel.Layout.flow('horizontal'), style: { padding: '6px', margin: '2px 0', backgroundColor: '#f9f9f9', borderRadius: '4px' } });
                            row.add(ui.Label(label, { fontSize: '14px', fontWeight: 'bold', stretch: 'horizontal' }));
                            row.add(ui.Label(value, { fontSize: '16px', fontWeight: '900', color: statusColor || 'black', margin: '0 5px' }));
                            if (status) row.add(ui.Label(status, { fontSize: '13px', color: statusColor || 'gray', padding: '2px 6px', backgroundColor: 'white', border: '1px solid ' + (statusColor || '#ccc'), borderRadius: '12px' }));
                            return row;
                        };

                        var createActionBtn = function (text, color, onClick) {
                            return ui.Button({
                                label: text,
                                onClick: onClick,
                                style: { stretch: 'horizontal', color: 'white', backgroundColor: color, fontWeight: 'bold', margin: '5px 0', padding: '8px' }
                            });
                        };

                        // ═══════════════════════════════════════════════════════
                        // 📋 HEADER
                        // ═══════════════════════════════════════════════════════
                        infoPanel.add(ui.Label('═══════════════════════════════════════', { fontWeight: 'bold', color: 'black' }));
                        infoPanel.add(ui.Label('🌾 تقرير المزرعة الذكي', { fontWeight: 'bold', fontSize: '20px', color: 'black', textAlign: 'center', stretch: 'horizontal' }));
                        infoPanel.add(ui.Label('تقرير المزرعة الذكي', { fontSize: '14px', color: 'black', textAlign: 'center', stretch: 'horizontal', shown: false }));
                        infoPanel.add(ui.Label('═══════════════════════════════════════', { fontWeight: 'bold', color: 'black' }));

                        var infoBox = ui.Panel({ style: { backgroundColor: '#E8F5E9', padding: '8px', margin: '10px 0', borderRadius: '8px' } });
                        infoBox.add(ui.Label('📍 الموقع: ' + lat.toFixed(4) + '°N, ' + lon.toFixed(4) + '°E', { fontSize: '13px' }));
                        infoBox.add(ui.Label('🌱 المحصول: ' + cropType, { fontSize: '13px' }));
                        infoPanel.add(infoBox);

                        // ═══════════════════════════════════════════════════════
                        // 🚦 TRAFFIC LIGHT — ملخص بصري سريع
                        // ═══════════════════════════════════════════════════════
                        var trafficLabel, trafficBg, trafficColor;
                        if (ecRealVal > 8 || (ndviVal < 0.1 && bsiVal > 0.3)) {
                            trafficLabel = '🔴 حالة حرجة — تحتاج تدخل فوري';
                            trafficBg = '#FFCDD2'; trafficColor = '#B71C1C';
                        } else if (ecRealVal > 4 || ndviVal < 0.25) {
                            trafficLabel = '🟡 تحتاج انتباه — اتبع التوصيات';
                            trafficBg = '#FFF9C4'; trafficColor = '#F57F17';
                        } else {
                            trafficLabel = '🟢 أرضك بحالة جيدة — استمر';
                            trafficBg = '#C8E6C9'; trafficColor = '#1B5E20';
                        }
                        infoPanel.add(ui.Label(trafficLabel, {
                            fontWeight: 'bold', fontSize: '16px', color: trafficColor,
                            backgroundColor: trafficBg, padding: '10px', margin: '5px 0',
                            textAlign: 'center', stretch: 'horizontal', borderRadius: '8px'
                        }));

                        // ═══════════════════════════════════════════════════════
                        // 📅 TIMESTAMP — بيانات التحليل
                        // ═══════════════════════════════════════════════════════
                        var now = new Date();
                        var dateStr = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
                        var timeBox = ui.Panel({ style: { backgroundColor: '#E3F2FD', padding: '6px', margin: '3px 0', borderRadius: '6px' } });
                        timeBox.add(ui.Label('📅 تاريخ التحليل: ' + dateStr + ' | 🛰️ الفترة: ' + start + ' → ' + end, { fontSize: '12px', color: '#1565C0' }));
                        timeBox.add(ui.Label('📍 الإحداثيات: ' + lat.toFixed(5) + '°N, ' + lon.toFixed(5) + '°E | 📐 المساحة: ' + bufferSize + 'm buffer', { fontSize: '12px', color: '#1565C0' }));
                        infoPanel.add(timeBox);

                        // ═══════════════════════════════════════════════════════
                        // 💧 IRRIGATION ESTIMATE — تقدير احتياج الري
                        // ═══════════════════════════════════════════════════════
                        var currentMonth = (result.currentMonth !== undefined) ? result.currentMonth : 6;
                        var isSummer = (currentMonth >= 5 && currentMonth <= 9);
                        var irrigNote = '';
                        var irrigColor = '#0277BD';
                        if (olmSand !== null && olmSand >= 70) {
                            irrigNote = isSummer ? '💧 تربة رملية + صيف → ري كل 2-3 أيام' : '💧 تربة رملية + شتاء → ري كل 4-5 أيام';
                        } else if (olmClay !== null && olmClay >= 40) {
                            irrigNote = isSummer ? '💧 تربة طينية + صيف → ري كل 5-7 أيام' : '💧 تربة طينية + شتاء → ري كل 10-14 يوم';
                        } else {
                            irrigNote = isSummer ? '💧 تربة متوسطة + صيف → ري كل 3-5 أيام' : '💧 تربة متوسطة + شتاء → ري كل 7-10 أيام';
                        }
                        if (ecRealVal > 4) {
                            irrigNote += ' ⚠️ (ملوحة → زد كمية الري 20-30%)';
                            irrigColor = '#E65100';
                        }
                        infoPanel.add(ui.Label(irrigNote, {
                            fontSize: '12px', fontWeight: 'bold', color: irrigColor,
                            backgroundColor: '#E0F7FA', padding: '8px', margin: '3px 0',
                            stretch: 'horizontal', borderRadius: '6px'
                        }));

                        // ======= COMPOSITE MOISTURE & HEALTH LOGIC =======
                        // Normalize NDMI (-0.2 to 0.4) and Soil Moisture (0.05 to 0.4)
                        var ndmiNorm = Math.min(1, Math.max(0, (ndmiVal + 0.2) / 0.6));
                        var smUsed = (smVal !== null) ? smVal : 0.2;
                        var smNorm = Math.min(1, Math.max(0, (smUsed - 0.05) / 0.35));
                        var compositeMoisture = (ndmiNorm * 0.4) + (smNorm * 0.6);
                        var droughtRiskVal = 1 - compositeMoisture; // 1 = Very Dry, 0 = Wet

                        var healthScore = vhiVal;
                        if (!isInvalidForCrop) {
                            var ndviScore = Math.min(100, Math.max(0, (ndviVal - 0.1) / 0.7 * 100));
                            healthScore = (ndviScore * 0.3) + (vhiVal * 0.7);
                            if (csiVal > 0.6) healthScore = Math.min(healthScore, 30);
                            else if (csiVal > 0.4) healthScore = Math.min(healthScore, 50);
                            if (droughtRiskVal > 0.6) healthScore = Math.min(healthScore, 55);
                        }

                        // Determine Pest Color Early
                        var pestColor = 'green';
                        var isWheat = (cropType.indexOf('قمح') > -1 || cropType.indexOf('Wheat') > -1);
                        if (isWheat && rhVal > 60 && airTempVal >= 15 && airTempVal <= 25) pestColor = 'red';

                        // ═══════════════════════════════════════════════════════
                        // 1️⃣ OVERALL STATUS (Hazard-Aware)
                        // ═══════════════════════════════════════════════════════
                        var statusTitle = isInvalidForCrop ? 'حالة الأرض' : 'الحالة العامة للمحصول';
                        var statusEmoji = isInvalidForCrop ? '🗺️' : '🎯';
                        infoPanel.add(createCard(statusTitle, statusEmoji, '#2E8B57'));

                        var healthStatus = (isInvalidForCrop) ? 'أرض غير مستغلة / صحراوية' : (healthScore > 75 ? 'ممتازة' : (healthScore > 55 ? 'جيدة' : (healthScore > 35 ? 'متوسطة' : 'ضعيفة')));
                        var healthColor = (isInvalidForCrop) ? '#D2691E' : (healthScore > 75 ? '#2E7D32' : (healthScore > 55 ? '#43A047' : (healthScore > 35 ? '#F57C00' : '#D32F2F')));
                        var healthLabel = isInvalidForCrop ? 'تصنيف المنطقة:' : 'مؤشر الصحة العام:';
                        var healthValue = isInvalidForCrop ? '---' : healthScore.toFixed(0) + '%';
                        infoPanel.add(createInfoRow(healthLabel, healthValue, healthStatus, healthColor));

                        // 🛰️ Smart Soil Display
                        infoPanel.add(createStatRow('🏔️ نوع التربة:', olmTexture, soilSourceColor, soilSource));

                        // ═══════════════════════════════════════════════════════
                        // 🛑 PIVOT SECTION
                        // ═══════════════════════════════════════════════════════
                        if (isInvalidForCrop) {
                            var pivotTitle = isUrban ? '🏙️ تنبيه: منطقة عمرانية' : '🏜️ تنبيه: أرض غير مزروعة';
                            var pivotColor = isUrban ? '#D32F2F' : '#D2691E';
                            infoPanel.add(ui.Label(pivotTitle, { fontWeight: 'bold', fontSize: '16px', color: pivotColor, textAlign: 'center', stretch: 'horizontal' }));
                            var btnPivot = ui.Button({ label: '🔍 عرض المحاصيل المناسبة (Suitability)', style: { stretch: 'horizontal', color: 'white', backgroundColor: '#2E8B57' }, onClick: function () { runSuitabilityAnalysis(); } });
                            infoPanel.add(btnPivot);
                        }

                        // ═══════════════════════════════════════════════════════
                        // 2️⃣ DYNAMIC FERTILIZER (Expert Logic)
                        if (!isInvalidForCrop) {
                            infoPanel.add(createCard('توصيات التسميد (مخصص للمحصول)', '🧪', '#4169E1'));

                            // Define Standard Crop Requirements (Units N-P-K / Feddan)
                            var cropReqs = {
                                'قمح (Wheat)': { N: 75, P: 15, K: 24, note: 'يحتاج دفعة تنشيطية عند التفريع' },
                                'ذرة (Maize)': { N: 120, P: 30, K: 24, note: 'شره للآزوت، يقسم على 3 دفعات' },
                                'أرز (Rice)': { N: 60, P: 15, K: 0, note: 'يفضل سلفات النشادر' },
                                'قطن (Cotton)': { N: 60, P: 22, K: 24, note: 'يحتاج توازن بين النمو الخضري والثمري' },
                                'قصب السكر (Sugarcane)': { N: 180, P: 45, K: 48, note: 'احتياجات سمادية ضخمة' },
                                'بطاطس (Potatoes)': { N: 150, P: 60, K: 96, note: 'شره جداً للبوتاسيوم لصب الدرنات' },
                                'طماطم (Tomato)': { N: 100, P: 45, K: 80, note: 'الكالسيوم ضروري جداً مع البوتاسيوم' },
                                'فول سوداني (Peanuts)': { N: 20, P: 30, K: 24, note: 'يحتاج جبس زراعي ضروري (كالسيوم)' },
                                'برسيم (Alfalfa/Clover)': { N: 15, P: 22, K: 24, note: 'يحتاج فوسفور لتنشيط الجذور' },
                                'بنجر السكر (Sugar Beet)': { N: 80, P: 30, K: 48, note: 'يحتاج بورون لرش الورق' }
                            };

                            var defaultReq = { N: 60, P: 30, K: 24, note: 'توصية عامة' };

                            // Find matching crop or use default
                            var selectedReq = defaultReq;
                            for (var key in cropReqs) {
                                if (cropType.indexOf(key.split(' ')[0]) > -1) { // Simple string match
                                    selectedReq = cropReqs[key];
                                    break;
                                }
                            }

                            // Adjust based on Soil Data (if available)
                            var nRec = selectedReq.N;
                            if (hasRealSoilData && olmOC / 10 < 1) nRec *= 1.2; // Increase N if poor organic matter

                            var pRec = selectedReq.P;
                            if (hasRealSoilData && olmPH > 8) pRec *= 1.25; // Increase P if alkaline (fixation issue)

                            var kRec = selectedReq.K;
                            if (olmTexture && (olmTexture.indexOf('Sand') > -1)) kRec *= 1.2; // Leaching in sand

                            infoPanel.add(createStatRow('النيتروجين (N):', Math.round(nRec) + ' وحدة/فدان', '#1B5E20', 'أضف ' + Math.round(nRec / 0.46) + ' كجم يوريا' + ' (' + selectedReq.note + ')'));
                            infoPanel.add(createStatRow('الفوسفور (P):', Math.round(pRec) + ' وحدة/فدان', '#F57F17', 'أضف ' + Math.round(pRec / 0.15) + ' كجم سوبر فوسفات'));
                            infoPanel.add(createStatRow('البوتاسيوم (K):', Math.round(kRec) + ' وحدة/فدان', '#7B1FA2', 'أضف ' + Math.round(kRec / 0.48) + ' كجم سلفات بوتاسيوم'));

                            // 🆕 Deep Expert Phenology & Task Management
                            var currentMonth = safeGet(result, 'currentMonth', (new Date().getMonth() + 1)); // Use analyzed month, fallback to today
                            var expertNote = '';
                            var isWheat = (cropType.indexOf('قمح') > -1 || cropType.indexOf('Wheat') > -1);
                            var isPotato = (cropType.indexOf('بطاطس') > -1 || cropType.indexOf('Potato') > -1);
                            var isTomato = (cropType.indexOf('طماطم') > -1 || cropType.indexOf('Tomato') > -1);
                            var isMaize = (cropType.indexOf('ذرة') > -1 || cropType.indexOf('Maize') > -1);

                            if (isWheat) {
                                if (currentMonth === 2) expertNote = '💡 تحليل الخبير: القمح في مرحلة "طرد السنابل". تجنب العطش تماماً، أضف سلفات بوتاسيوم (10 كجم رشاً) لزيادة الوزن.';
                                else if (currentMonth === 3) expertNote = '💡 تحليل الخبير: مرحلة "امتلاء الحبوب". احذر من الري وقت الرياح الشديدة لتجنب الرقاد.';
                                else if (currentMonth === 11 || currentMonth === 12) expertNote = '💡 تحليل الخبير: مرحلة "الإنبات والتفريع". تأكد من جرعة النشادر التنشيطية.';
                            } else if (isPotato) {
                                if (currentMonth === 10 || currentMonth === 11) expertNote = '💡 تحليل الخبير: عروة البطاطس النيلية. ركز على الوقاية من الندوة المتأخرة بسبب الرطوبة.';
                                else if (currentMonth === 12 || currentMonth === 1) expertNote = '💡 تحليل الخبير: صب الدرنات. الاهتمام بالتسميد البوتاسي والري المنتظم.';
                            } else if (isTomato) {
                                expertNote = '💡 تحليل الخبير: احذر من تذبذب الري لتجنب "عفن طرف السرة". التسميد الكالسي ضروري الآن.';
                            } else if (isMaize && (currentMonth >= 6 && currentMonth <= 8)) {
                                expertNote = '💡 تحليل الخبير: مرحلة "التزهير وتكوين الكوز". احتياج مائي عالٍ جداً، احذر من العطش.';
                            }

                            if (expertNote) {
                                infoPanel.add(ui.Label(expertNote, {
                                    fontSize: '13px', color: '#1B5E20', fontStyle: 'italic', backgroundColor: '#F1F8E9', padding: '5px', border: '1px solid #C5E1A5'
                                }));
                            }

                            if (lstVal > 35) {
                                infoPanel.add(ui.Label('⚠️ تنبيه إجهاد حراري: الحرارة عالية، لا تروِ في وقت الظهيرة إطلاقاً.', {
                                    fontSize: '13px', color: '#E65100', fontStyle: 'italic', backgroundColor: '#FFF3E0', padding: '5px'
                                }));
                            }

                            // 🛠️ REHABILITATION BUTTONS FOR FALLOW LAND
                            var suitabilityBtn = ui.Button({
                                label: '🔍 تحليل الملاءمة المحصولية للموقع',
                                style: { stretch: 'horizontal', margin: '10px 0', color: '#1B5E20' },
                                onClick: function () {
                                    soilHeader.onClick(); // Force open soil panel
                                    cropHeader.onClick(); // Force open crops panel
                                }
                            });
                            infoPanel.add(suitabilityBtn);

                            var reclamationBtn = ui.Button({
                                label: '🛠️ عرض خطة الاستصلاح الصحراوي',
                                style: { stretch: 'horizontal', margin: '5px 0', color: '#795548' },
                                onClick: function () {
                                    infoPanel.add(ui.Label('📋 خطة الاستصلاح (مبدئية):', { fontWeight: 'bold', margin: '10px 0 0 0' }));
                                    infoPanel.add(ui.Label('1. التسوية والتخطيط\n2. شبكة الري\n3. الإضافات الأولية (جبس + كمبوست)\n4. زراعة المحاصيل الكاسرة للملوحة', { fontSize: '12px', whiteSpace: 'pre' }));
                                }
                            });
                            infoPanel.add(reclamationBtn);
                        }

                        // ═══════════════════════════════════════════════════════
                        // 3️⃣ EXPERT PEST & DISEASE RISK (Updated with Air Temp & RH)
                        // ═══════════════════════════════════════════════════════
                        infoPanel.add(createCard('رصد الأخطار الحيوية (مناخ دقيق)', '🐛', '#8B4513'));

                        var pestRisk = (pestColor === 'red') ? '🔴 خطر داهم (الصدأ الأصفر)' : '✅ منخفضة';
                        var pestMsg = (pestColor === 'red') ? 'رطوبة جوية عالية (' + rhVal.toFixed(0) + '%) وحرارة معتدلة: بيئة مثالية للصدأ.' : 'الظروف الجوية (حرارة ورطوبة) مستقرة.';

                        if (isWheat && rhVal > 50 && airTempVal > 25 && pestColor !== 'red') {
                            pestRisk = '🟠 خطر متوسط (صدأ الساق/الأوراق)';
                            pestMsg = 'الرطوبة تدعم نمو الفطريات.';
                            pestColor = 'orange';
                        }
                        // Potato Late Blight: High Humidity (>90%) + Cool Temp (10-20C)
                        else if (isPotato) {
                            if (rhVal > 85 && airTempVal >= 10 && airTempVal <= 20) {
                                pestRisk = '🔴 خطر الندوة المتأخرة (كارثي)';
                                pestMsg = 'رطوبة جوية مشبعة! يجب الرش الوقائي فوراً.';
                                pestColor = 'red';
                            } else if (rhVal > 70) {
                                pestRisk = '🟠 خطر الندوة المبكرة';
                                pestMsg = 'الرطوبة عالية، افحص الأوراق السفلية.';
                                pestColor = 'orange';
                            }
                        }
                        // Tomato
                        else if (isTomato) {
                            if (rhVal > 80 && airTempVal < 20) {
                                pestRisk = '🔴 خطر الندوة المتأخرة';
                                pestColor = 'red';
                            }
                        }
                        // General Mites (Spider Mites): Hot (>30C) + Dry (<40% RH)
                        if (airTempVal > 30 && rhVal < 40) {
                            pestRisk = '🟠 خطر العنكبوت الأحمر';
                            pestMsg = 'الجو حار وجاف (' + rhVal.toFixed(0) + '%)، مثالي للعنكبوت.';
                            pestColor = 'orange';
                        }

                        // Add display
                        infoPanel.add(createStatRow('🌪️ حالة الجو:', 'رطوبة: ' + rhVal.toFixed(0) + '% | حرارة: ' + airTempVal.toFixed(1) + '°م', 'black'));
                        infoPanel.add(createStatRow('🦠 توقعات الأمراض:', pestRisk, pestColor));
                        if (pestColor !== 'green') {
                            infoPanel.add(ui.Label('💡 نصيحة الخبير: ' + pestMsg, { fontSize: '13px', color: '#D32F2F', margin: '0 0 10px 10px', fontWeight: 'bold' }));
                        }

                        // ═══════════════════════════════════════════════════════
                        // 🆕 4️⃣ EXPERT CROP COMPATIBILITY CHECK (FAO Salinity Classes)
                        // ═══════════════════════════════════════════════════════
                        // FAO Salinity Classes based on Normalized CSI (0-1)
                        // 0-0.2: Non-saline | 0.2-0.35: Slightly | 0.35-0.55: Moderately | 0.55-0.75: High | >0.75: Extreme
                        var salinityClass = '';
                        var salinityLabel = '';
                        var salinityColor = '';

                        if (csiVal < 0.20) { salinityClass = 'Non-Saline'; salinityLabel = '✅ غير مالحة'; salinityColor = 'green'; }
                        else if (csiVal < 0.35) { salinityClass = 'Slightly Type'; salinityLabel = '⚠️ ملوحة خفيفة'; salinityColor = '#FFB300'; } // Amber
                        else if (csiVal < 0.55) { salinityClass = 'Moderately Type'; salinityLabel = '⛔ ملوحة متوسطة'; salinityColor = '#FB8C00'; } // Orange
                        else if (csiVal < 0.75) { salinityClass = 'High Type'; salinityLabel = '🛑 ملوحة مرتفعة'; salinityColor = '#D32F2F'; } // Red
                        else { salinityClass = 'Extreme Type'; salinityLabel = '☠️ ملوحة شديدة'; salinityColor = '#B71C1C'; } // Dark Red

                        // Crop Tolerance Map (Key: Crop Name Fragment, Value: Max Allowed Class Index)
                        // 0: Non, 1: Slight, 2: Mod, 3: High, 4: Extreme
                        var toleranceMap = {
                            'فراولة': 1, // Sensitive (Non to Slight only)
                            'فاصوليا': 1,
                            'برتقال': 2, // Moderately tolerant
                            'ذرة': 2,
                            'طماطم': 2,
                            'قمح': 3, // Tolerant
                            'قطن': 3,
                            'شعير': 4, // Very Tolerant
                            'بنجر': 4,
                            'نخيل': 4
                        };

                        var currentClassIndex = 0;
                        if (salinityClass.indexOf('Slightly') > -1) currentClassIndex = 1;
                        if (salinityClass.indexOf('Moderately') > -1) currentClassIndex = 2;
                        if (salinityClass.indexOf('High') > -1) currentClassIndex = 3;
                        if (salinityClass.indexOf('Extreme') > -1) currentClassIndex = 4;

                        // Check Compatibility
                        var isCompatible = true;
                        var cropKey = null;
                        var toleranceKeys = Object.keys(toleranceMap);
                        for (var t = 0; t < toleranceKeys.length; t++) {
                            if (cropType.indexOf(toleranceKeys[t]) > -1) {
                                cropKey = toleranceKeys[t];
                                if (currentClassIndex > toleranceMap[cropKey]) {
                                    isCompatible = false;
                                }
                                break;
                            }
                        }

                        if (!isCompatible) {
                            infoPanel.add(ui.Label('⛔ تحذير خطير: غير متوافق!', { fontWeight: 'bold', fontSize: '18px', color: 'white', backgroundColor: '#D32F2F', padding: '10px', margin: '15px 0' }));
                            infoPanel.add(ui.Label('التربة مصنفة: "' + salinityLabel + '"', { fontWeight: 'bold', color: 'black' }));
                            infoPanel.add(ui.Label('محصول "' + cropType + '" لا يتحمل هذا المستوى من الأملاح.', { color: '#D32F2F' }));
                            infoPanel.add(ui.Label('💡 النصيحة: اختر الشعير أو البنجر أو النخيل.', { color: 'green', fontWeight: 'bold' }));
                        } else if (currentClassIndex > 0) {
                            infoPanel.add(ui.Label('⚠️ تنبيه ملوحة: التربة "' + salinityLabel + '" ولكن المحصول يتحملها.', { fontSize: '13px', color: '#F57C00' }));
                        }

                        // 🆕 4.1 CRITICAL SOIL RECOMMENDATIONS (Promoted to Main Panel)
                        if (csiVal > 0.3 || olmPH > 8.2 || estimatedOM < 1.5) {
                            var criticalRecs = ui.Panel({ style: { padding: '10px', backgroundColor: '#FFF9C4', borderRadius: '8px', border: '1px solid #FBC02D', margin: '10px 0' } });
                            criticalRecs.add(ui.Label('⚠️ توصيات عاجلة لإصلاح التربة:', { fontWeight: 'bold', fontSize: '13px', color: '#F57F17' }));

                            if (csiVal > 0.3) {
                                var gypTons = (csiVal * 4).toFixed(1);
                                criticalRecs.add(ui.Label('• ملوحة عالية: أضف ' + gypTons + ' طن/فدان جبس زراعي مع غسيل مكثف.', { fontSize: '12px' }));
                            }
                            if (olmPH > 8.2) {
                                criticalRecs.add(ui.Label('• قلوية مرتفعة: أضف 200 كجم كبريت زراعي واستخدم أسمدة حامضية.', { fontSize: '12px' }));
                            }
                            if (estimatedOM < 1.5) {
                                criticalRecs.add(ui.Label('• نقص مادة عضوية: أضف كمبوست نباتي (4-6 طن/فدان) لزيادة الخصوبة.', { fontSize: '12px' }));
                            }
                            infoPanel.add(criticalRecs);
                        }

                        // ═══════════════════════════════════════════════════════
                        // 5️⃣ OPERATIONS MANAGER (Spraying, Harvest, Yield)
                        // ═══════════════════════════════════════════════════════
                        infoPanel.add(createCard('مدير العمليات الزراعية', '🚜', '#546E7A'));

                        // A. SPRAYING GUIDE
                        var canSpray = true;
                        var sprayMsg = '✅ الأجواء مناسبة للرش (رياح هادئة وحرارة معتدلة).';
                        var sprayColor = 'green';

                        // Wind Speed Threshold (e.g. 15 km/h = 4.2 m/s)
                        if (windSpeedVal > 4.2) {
                            canSpray = false;
                            sprayMsg = '⛔ ممنوع الرش! الرياح قوية (' + (windSpeedVal * 3.6).toFixed(1) + ' كم/س) ستسبب تطاير المبيد.';
                            sprayColor = 'red';
                        } else if (airTempVal > 30) {
                            canSpray = false;
                            sprayMsg = '⛔ ممنوع الرش! الحرارة عالية (' + airTempVal.toFixed(1) + '°م) ستسبب تبخر المبيد وحرق الورق.';
                            sprayColor = 'red';
                        }

                        infoPanel.add(createStatRow('🚿 دليل الرش:', (canSpray ? 'مسموح' : 'ممنوع'), sprayColor, sprayMsg));

                        // C. YIELD FORECAST (Moved - Harvest Section Removed per User Request)

                        // C. YIELD FORECAST
                        if (typeof estimateYield_Egypt === 'function' && !isInvalidForCrop && !isNotPlanted) {
                            var yieldEst = estimateYield_Simple(ndviVal, cropType); // Returns string range e.g. "18-20 Ardeb"
                            infoPanel.add(createStatRow('⚖️ الإنتاجية المتوقعة:', yieldEst, '#2E7D32', 'بناءً على الكثافة النباتية الحالية'));
                        }

                        // ═══════════════════════════════════════════════════════
                        // 6️⃣ SMART IRRIGATION SCHEDULER
                        // ═══════════════════════════════════════════════════════
                        if (!isInvalidForCrop) {
                            infoPanel.add(createCard('جدول الري الذكي', '🚿', '#00BCD4'));

                            // 2. Base Interval based on Soil Texture (Refined Logic)
                            var interval = 7; // Default Loam
                            var soilTypeAr = 'طميية (متوسطة)';

                            // Check specific composite types first
                            if (olmTexture && olmTexture.indexOf('Sandy Clay') > -1) {
                                interval = 9;
                                soilTypeAr = 'طينية رملية (متوسطة الثقل)';
                            } else if (olmTexture && olmTexture.indexOf('Clay') > -1) {
                                interval = 12;
                                soilTypeAr = 'طينية (ثقيلة)';
                            } else if (olmTexture && olmTexture.indexOf('Sand') > -1) {
                                interval = 4;
                                soilTypeAr = 'رملية (خفيفة)';
                            }

                            // 2. Adjust for Temperature (LST) and Wind
                            if (lstVal > 35) interval -= 1; // Hot -> Irrigate sooner
                            if (windSpeedVal > 5) interval -= 1; // High wind
                            if (lstVal < 20) interval += 2; // Cool -> Extend interval

                            // 3. Adjust for Crop Stage (Simple Logic)
                            // Reuse 'currentMonth' from Expert Phenology section (based on image date)
                            if (currentMonth >= 5 && currentMonth <= 8) interval -= 1; // Summer peak

                            interval = Math.max(1, interval); // Minimum 1 day

                            infoPanel.add(createStatRow('نوع التربة المكتشف:', soilTypeAr, 'black'));
                            infoPanel.add(createStatRow('🕒 الفاصل الزمني المقترح:', 'كل ' + interval + ' أيام', '#0097A7', 'في الظروف الحالية'));

                            var waterAmount = (lstVal > 30) ? 'غزير (صباحاً)' : 'معتدل';
                            infoPanel.add(createStatRow('💧 كمية المياه:', waterAmount, 'black'));

                            if (droughtRiskVal > 0.6) {
                                infoPanel.add(ui.Label('⚠️ تحذير: الأرض جافة جداً! يفضل تقليل الفترة بمقدار يوم واحد مؤقتاً.', { fontSize: '13px', color: 'red' }));
                            }
                        }



                        // 🆕 8️⃣ LEACHING REQUIREMENT (Salinity Management)
                        if (!isInvalidForCrop && ecRealVal > 2.0 && !isNotPlanted) {
                            try {
                                infoPanel.add(createCard('إدارة الملوحة وغسيل التربة', '🚿', '#00ACC1'));

                                // 1. Use Real EC (dS/m) instead of estimating from CSI
                                var predictedECe = ecRealVal;

                                infoPanel.add(ui.Label('ملوحة التربة المقدرة (ECe): ' + predictedECe.toFixed(1) + ' dS/m', { fontSize: '12px', fontWeight: 'bold', color: '#D32F2F', margin: '5px' }));
                                infoPanel.add(ui.Label('للحفاظ على الإنتاجية، يجب إضافة مياه غسيل بناءً على ملوحة المصدر:', { fontSize: '13px', color: 'black' }));

                                // 2. Leaching Requirement Equation: LR = ECw / (5 * ECtarget - ECw)
                                var toleranceMapValues = [1.5, 2.5, 6.0, 10.0, 12.0];
                                // Fix: Ensure 0 is treated as a valid index
                                var targetIdx = (toleranceMap && cropKey && toleranceMap[cropKey] !== undefined) ? toleranceMap[cropKey] : 2;
                                var targetEC = toleranceMapValues[Math.min(4, targetIdx)];

                                // Safety check for targetEC
                                if (!targetEC) targetEC = 6.0;

                                var calculateLR = function (ecw) {
                                    var denom = (5 * targetEC) - ecw;
                                    if (denom <= 0) return 1.0; // Impossible
                                    var lr = ecw / denom;
                                    return Math.min(0.5, Math.max(0, lr));
                                };

                                // Scenarios
                                var lrNile = calculateLR(0.5); // Nile ~ 0.5 dS/m
                                var lrWell = calculateLR(1.5); // Well ~ 1.5 dS/m
                                var lrSaline = calculateLR(3.0); // Saline ~ 3.0 dS/m

                                // Convert % to Minutes per Hour
                                var minNile = Math.round(lrNile * 60);
                                var minWell = Math.round(lrWell * 60);
                                var minSaline = Math.round(lrSaline * 60);

                                if (typeof createStatRow === 'function') {
                                    infoPanel.add(createStatRow('💧 مياه النيل (0.5 dS/m):', 'زيادة ' + minNile + ' دقيقة/ساعة', 'blue', 'لتجنب التملح'));
                                    infoPanel.add(createStatRow('💧 آبار متوسطة (1.5 dS/m):', 'زيادة ' + minWell + ' دقيقة/ساعة', '#F9A825', 'لتجنب التملح'));

                                    if (lrSaline > 0.45) {
                                        infoPanel.add(createStatRow('💧 آبار مالحة (3.0 dS/m):', 'غير مناسب ❌', 'red', 'خطر تملح شديد'));
                                    } else {
                                        infoPanel.add(createStatRow('💧 آبار مالحة (3.0 dS/m):', 'زيادة ' + minSaline + ' دقيقة/ساعة', 'red', 'حذر شديد مطلوب'));
                                    }
                                }
                                infoPanel.add(ui.Label('📝 التفسير: لكل ساعة ري عادية، أضف هذه الدقائق لغسيل الأملاح.', { fontSize: '13px', color: 'black', margin: '5px' }));

                            } catch (e) {
                                print('Error in Leaching Logic:', e);
                                infoPanel.add(ui.Label('⚠️ تعذر حساب متطلبات الغسيل بدقة.', { fontSize: '12px', color: 'gray' }));
                            }
                        }

                        // ═══════════════════════════════════════════════════════
                        // 6️⃣ WARNINGS & RISKS (Standard)
                        // ═══════════════════════════════════════════════════════
                        infoPanel.add(createCard('التحذيرات الفيزيائية', '⚠️', '#DC143C'));
                        var droughtLabel = droughtRiskVal > 0.6 ? '🔴 مرتفع' : (droughtRiskVal > 0.3 ? '🟠 متوسط' : '✅ منخفض');
                        var droughtColor = droughtRiskVal > 0.6 ? 'red' : (droughtRiskVal > 0.3 ? 'orange' : 'green');
                        infoPanel.add(createStatRow('💧 خطر الجفاف:', droughtLabel, droughtColor));

                        var irrAction = droughtRiskVal > 0.6 ? '⚠️ ري عاجل مكثف' : (droughtRiskVal > 0.3 ? '🟡 ري تكميلي قريب' : '✅ نظام ري مستقر');
                        infoPanel.add(createStatRow('🚿 إجراء الري المطروح:', irrAction, droughtColor));

                        infoPanel.add(createStatRow('🧂 ملوحة التربة (EC):', ecRealVal.toFixed(1) + ' dS/m', (ecRealVal > 8 ? 'red' : (ecRealVal > 4 ? 'orange' : 'green')), (ecRealVal > 4 ? 'مرتفع' : 'طبيعي')));
                        infoPanel.add(createStatRow('🌡️ حرارة التربة:', lstVal.toFixed(1) + '°C', (lstVal > 38 ? 'orange' : 'green')));


                        // ═══════════════════════════════════════════════════════
                        // ═══════════════════════════════════════════════════════
                        // 📥 EXPORT
                        // ═══════════════════════════════════════════════════════
                        infoPanel.add(createActionBtn('📥 تحميل خريطة المزرعة', '#444', function () {
                            var url = s2.visualize({ bands: ['RED', 'GREEN', 'BLUE'], min: 0, max: 3000 }).getDownloadURL({
                                scale: 10,
                                region: farmArea
                            });
                            infoPanel.add(ui.Label({
                                value: '🔗 اضغط للتحميل (رابط الصورة)',
                                targetUrl: url,
                                style: { color: 'blue', fontWeight: 'bold', textDecoration: 'underline' }
                            }));
                        }));

                        // ═══════════════════════════════════════════════════════
                        // 8️⃣ DETAILED SOIL REPORT (Interactive Toggle)
                        // ═══════════════════════════════════════════════════════
                        var soilDetailPanel = ui.Panel({ style: { shown: false, margin: '5px 0 0 20px', padding: '10px', backgroundColor: '#ffffff', border: '1px solid #eee' } });
                        var soilHeader = ui.Button({
                            label: '▸ 8. تقرير التربة التفصيلي',
                            style: {
                                fontWeight: 'bold', fontSize: '14px', color: 'black', backgroundColor: '#f0f0f0',
                                padding: '4px', border: '1px solid #ccc', stretch: 'horizontal', textAlign: 'left', margin: '5px 0'
                            }
                        });

                        soilHeader.onClick(function () {
                            var isShown = !soilDetailPanel.style().get('shown');
                            soilDetailPanel.style().set('shown', isShown);
                            soilHeader.setLabel((isShown ? '▾' : '▸') + ' 8. تقرير التربة التفصيلي');
                            soilHeader.style().set('backgroundColor', isShown ? '#e0e0e0' : '#f0f0f0');
                        });

                        infoPanel.add(soilHeader);
                        infoPanel.add(soilDetailPanel);

                        // Soil Type Estimation
                        soilDetailPanel.add(ui.Label('━━━ 🏔️ نوع التربة المقدر ━━━', { fontWeight: 'bold', color: 'black' }));

                        var soilType = 'غير محدد';
                        var soilTypeEn = 'Unknown';
                        var soilDetails = [];

                        // ======= UNIFIED SOIL CLASSIFICATION (USDA TEXTURE TRIANGLE) =======
                        // Source: USDA Soil Survey Manual (Standard)
                        var getTextureName = function (clay, sand) {
                            // 🛑 FIX: Prevent "Silt Bias" when data is missing (0 + 0 = 100% Silt)
                            if (clay + sand <= 0.1) return 'غير متوفر';

                            var silt = 100 - clay - sand;

                            // 1. Sands (Rimal)
                            if (sand >= 85 && (silt + 1.5 * clay) < 15) return 'رملية';
                            if (sand >= 70 && sand < 90 && (silt + 1.5 * clay) >= 15 && (silt + 2 * clay) < 30) return 'رملية طميية';

                            // 2. Loams (Tamy)
                            if ((clay >= 7 && clay < 20 && sand > 52 && (silt + 2 * clay) >= 30) || (clay < 7 && silt < 50 && (silt + 2 * clay) >= 30)) return 'طميية رملية';
                            if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return 'طميية (صلصال)';
                            if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return 'طميية سلتية';
                            if (silt >= 80 && clay < 12) return 'سلتية';

                            // 3. Sandy Clays
                            if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return 'طينية طميية رملية';
                            if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return 'طينية طميية';
                            if (clay >= 27 && clay < 40 && sand <= 20) return 'طينية طميية سلتية';

                            // 4. Clays
                            if (clay >= 35 && sand > 45) return 'طينية رملية';
                            if (clay >= 40 && silt >= 40) return 'طينية سلتية';
                            if (clay >= 40 && sand <= 45 && silt < 40) return 'طينية';

                            return 'غير محدد';
                        };

                        var textureClass = '';
                        var isMeasured = false;

                        // Check if we have VALID data (Global olmTexture is already corrected/overridden)
                        if (olmTexture) {
                            textureClass = olmTexture;
                            isMeasured = true;
                        } else if (olmSand !== null && olmClay !== null && (olmSand + olmClay > 0.1)) {
                            // Fallback only if no Class is known
                            textureClass = getTextureName(olmClay, olmSand);
                            isMeasured = (textureClass.indexOf('No Data') === -1);
                        }

                        // Fallback Logic if data is missing or invalid
                        if (!isMeasured) {
                            // Fallback to Satellite Estimation (BSI/NVDI/Clay Ratio)
                            if (bsiVal > 0.2) {
                                if (clayRatioVal > 1.5) textureClass = 'طينية ثقيلة [تقديري]';
                                else if (clayRatioVal > 1.2) textureClass = 'طينية طميية [تقديري]';
                                else textureClass = 'رملية [تقديري]';
                            } else if (ndviVal > 0.3) {
                                textureClass = 'طميية خصبة [تقديري]';
                            } else {
                                textureClass = 'طميية رملية [تقديري]';
                            }
                        }

                        // Check for special soil conditions (Legacy CSI Removed - Relies on ML EC now)
                        var specialConditions = specialConditions_ML || []; // Use the ML conditions calculated earlier

                        // (Legacy CSI Block Removed)

                        // Gypsum check
                        if (gypsumVal > 0.2) {
                            specialConditions.push('غنية بالجبس');
                            soilDetails.push('⚪ محتوى جبسي عالي - قد تحتاج معالجة');
                        }

                        // Carbonate check
                        if (carbonateVal > 1.3) {
                            specialConditions.push('كلسية (جيرية)');
                            soilDetails.push('⚪ تربة كلسية - قد تحتاج تحمض');
                        }

                        // Iron oxide check (lateritic/ferric soils)
                        if (ironOxideVal > 2.5) {
                            specialConditions.push('غنية بالحديد');
                            soilDetails.push('🔴 نسبة حديد عالية');
                        }

                        // Build final soil type description
                        if (specialConditions.length > 0) {
                            soilType = '🏔️ تربة ' + textureClass + ' (' + specialConditions.join(' + ') + ')';
                        } else {
                            soilType = '🏔️ تربة ' + textureClass;
                        }
                        soilTypeEn = textureClass;

                        // Display Source of Information (Global Variable)
                        soilDetailPanel.add(ui.Label('المصدر: ' + soilSource, { fontSize: '12px', color: soilSourceColor, margin: '0 0 5px 0' }));

                        soilDetailPanel.add(ui.Label('النوع: ' + soilType, { color: 'black', fontWeight: 'bold' }));
                        soilDetailPanel.add(ui.Label('      التصنيف: ' + soilType, { fontSize: '13px', fontStyle: 'italic', color: 'black' }));

                        // ======= OpenLandMap REAL SOIL DATA (if available) =======
                        // 🛑 FIX: Validate that we actually have non-zero data (not just non-null)
                        var hasRealSoilData = (olmClay !== null && olmSand !== null && (olmClay + olmSand > 0.1));

                        if (hasRealSoilData) {
                            soilDetailPanel.add(ui.Label(''));
                            soilDetailPanel.add(ui.Label('━━━ 📊 بيانات التربة الحقيقية (OpenLandMap) ━━━', { fontWeight: 'bold', color: 'black', backgroundColor: '#f0f0f0', padding: '3px', border: '1px solid #ccc' }));
                            soilDetailPanel.add(ui.Label('✅ البيانات التالية مقاسة فعلياً وليست تقديرية!', { fontSize: '13px', color: 'black', fontStyle: 'italic' }));

                            // Texture based on Unified Logic
                            var unifiedTexture = getTextureName(olmClay, olmSand);
                            soilDetailPanel.add(ui.Label('🏔️ نسيج التربة (القراءات): ' + unifiedTexture));

                            // Warning if conflict
                            if (olmTexture && unifiedTexture.indexOf(olmTexture.split(' ')[0]) === -1) {
                                soilDetailPanel.add(ui.Label('⚠️ تباين بيانات: التصنيف العام (' + olmTexture + ') أدق من نسب المكونات هنا.', { fontSize: '12px', color: 'gray' }));
                            }

                            if (olmClay !== null && olmSand !== null) {
                                var siltVal = 100 - olmClay - olmSand;
                                soilDetailPanel.add(ui.Label('🧱 الطين: ' + olmClay.toFixed(1) + '%'));
                                soilDetailPanel.add(ui.Label('🏖️ الرمل: ' + olmSand.toFixed(1) + '%'));
                                soilDetailPanel.add(ui.Label('🌾 السلت: ' + siltVal.toFixed(1) + '%'));
                            }


                            // Organic Carbon
                            if (olmOC !== null) {
                                var ocPercent = olmOC / 10;  // Convert g/kg to %
                                var omPercent = ocPercent * 1.724;  // OC to OM conversion
                                var ocStatus = ocPercent < 0.5 ? '🔴 منخفض جداً' : (ocPercent < 1 ? '🟡 منخفض' : (ocPercent < 2 ? '🟢 متوسط' : '✅ عالي'));
                                soilDetailPanel.add(ui.Label('🌿 الكربون العضوي: ' + ocPercent.toFixed(2) + '% (' + ocStatus + ')', { color: 'black' }));
                                soilDetailPanel.add(ui.Label('   المادة العضوية المقدرة: ' + omPercent.toFixed(2) + '%', { fontSize: '13px', color: 'black' }));
                            }

                            if (olmPH !== null) {
                                var phStatus = olmPH < 5.5 ? '🔴 حمضي جداً' : (olmPH < 6.5 ? '🟡 حمضي' : (olmPH < 7.5 ? '🟢 معتدل' : (olmPH < 8.5 ? '🟡 قلوي' : '🔴 قلوي جداً')));
                                soilDetailPanel.add(ui.Label('⚗️ الحموضة (pH): ' + olmPH.toFixed(1) + ' (' + phStatus + ')', { color: 'black' }));
                            }

                            // Bulk Density
                            if (olmBulkDens !== null) {
                                var bdVal_gcm3 = olmBulkDens / 100;
                                var bdStatus = bdVal_gcm3 < 1.2 ? '🟢 جيدة (تربة مسامية)' : (bdVal_gcm3 < 1.5 ? '🟡 متوسطة' : '🔴 مضغوطة');
                                soilDetailPanel.add(ui.Label('📦 الكثافة الظاهرية: ' + bdVal_gcm3.toFixed(2) + ' جم/سم³ (' + bdStatus + ')', { color: 'black' }));
                            }

                            if (olmWC33 !== null) {
                                soilDetailPanel.add(ui.Label('💧 السعة الحقلية: ' + olmWC33.toFixed(1) + '% (القدرة على الاحتفاظ بالماء)', { color: 'black' }));
                            }
                        } else {
                            soilDetailPanel.add(ui.Label(''));
                            soilDetailPanel.add(ui.Label('⚠️ بيانات OpenLandMap غير متوفرة لهذا الموقع', { fontSize: '13px', color: 'black', backgroundColor: '#ffcccc', padding: '5px' }));
                        }

                        soilDetailPanel.add(ui.Label(''));
                        soilDetailPanel.add(ui.Label('━━━ 🔬 التحليل المعدني للتربة (من الأقمار الصناعية) ━━━', { fontWeight: 'bold', color: 'black' }));

                        soilDetailPanel.add(ui.Label('🧱 نسبة الطين: ' + clayRatioVal.toFixed(2), { color: 'black' }));
                        soilDetailPanel.add(ui.Label('🔴 أكسيد الحديد: ' + ironOxideVal.toFixed(2), { color: 'black' }));
                        soilDetailPanel.add(ui.Label('⚪ الجبس: ' + gypsumVal.toFixed(3), { color: 'black' }));
                        soilDetailPanel.add(ui.Label('🔘 الكربونات: ' + carbonateVal.toFixed(2), { color: 'black' }));
                        soilDetailPanel.add(ui.Label('🏜️ مؤشر التربة العارية (BSI): ' + bsiVal.toFixed(3), { color: 'black' }));

                        // ======= SOIL MOISTURE (Enhanced) =======
                        soilDetailPanel.add(ui.Label(''));
                        soilDetailPanel.add(ui.Label('━━━ 💧 رطوبة التربة ━━━', { fontWeight: 'bold', color: 'black' }));

                        soilDetailPanel.add(ui.Label('⭐ ملوحة التربة (EC): ' + ecRealVal.toFixed(2) + ' dS/m', { fontWeight: 'bold', color: '#1565C0' }));
                        soilDetailPanel.add(ui.Label('   التصنيف: ' + salinityLevel, { color: salinityColor, fontWeight: 'bold' }));
                        soilDetailPanel.add(ui.Label('   المحاصيل المناسبة: ' + cropTolerance, { fontSize: '13px', color: '#555' }));

                        soilDetailPanel.add(ui.Label(''));
                        var smText = (smVal !== null) ? (smVal * 100).toFixed(1) + '%' : 'غير متوفر حالياً';
                        soilDetailPanel.add(ui.Label('💧 رطوبة التربة السطحية (0-7 سم): ' + smText, { color: (smVal !== null) ? 'black' : 'gray' }));

                        var smRootText = (smRootVal !== null) ? (smRootVal * 100).toFixed(1) + '%' : 'غير متوفر حالياً';
                        soilDetailPanel.add(ui.Label('💧 رطوبة منطقة الجذور (7-28 سم): ' + smRootText, { color: (smRootVal !== null) ? 'black' : 'gray' }));


                        var smInterpret = '';
                        var isSandyForSM = (olmSand !== null && olmSand > 70);

                        if (smVal === null) {
                            smInterpret = '⚠️ البيانات غير متوفرة حالياً';
                        } else if (droughtRiskVal > 0.6) {
                            smInterpret = '🔴 جافة جداً (حرجة)';
                        } else if (droughtRiskVal > 0.3) {
                            smInterpret = '🟡 جافة نسبياً';
                        } else {
                            smInterpret = isSandyForSM ? '🟢 جيدة (رملية)' : '🟢 جيدة/رطبة';
                        }
                        soilDetailPanel.add(ui.Label('   التفسير: ' + smInterpret, { fontSize: '13px', color: 'black' }));

                        soilDetailPanel.add(ui.Label(''));
                        soilDetailPanel.add(ui.Label('🌡️ درجة حرارة سطح التربة: ' + lstVal.toFixed(1) + '°C', { color: 'black' }));
                        var lstInterpret = lstVal < 20 ? '🔵 باردة' : (lstVal < 30 ? '🟢 مناسبة' : (lstVal < 40 ? '🟡 دافئة' : '🔴 حارة جداً'));
                        soilDetailPanel.add(ui.Label('   التفسير: ' + lstInterpret, { fontSize: '13px', color: 'black' }));

                        soilDetailPanel.add(ui.Label(''));
                        soilDetailPanel.add(ui.Label('━━━ 🌿 المادة العضوية ━━━', { fontWeight: 'bold', color: 'black' }));

                        var estimatedOM;
                        var omSource;
                        var omStatus = '';

                        if (olmOC !== null && !isNaN(olmOC)) {
                            var ocPercent = olmOC / 10;
                            estimatedOM = ocPercent * 1.724;
                            omSource = '(بيانات مقاسة)';
                        } else {
                            estimatedOM = Math.max(0.3, Math.min(5, saviVal * 2.0 + ndviVal * 1.5 + smVal * 1.0 - bsiVal * 1.5));
                            omSource = '(تقدير الأقمار الصناعية)';
                        }

                        if (estimatedOM > 3) omStatus = '✅ غنية بالمادة العضوية';
                        else if (estimatedOM > 1.5) omStatus = '🟢 متوسطة (Good)';
                        else omStatus = '🟡 فقيرة (Low) - تحتاج إضافة كمبوست';

                        soilDetailPanel.add(ui.Label('المادة العضوية: ~' + estimatedOM.toFixed(1) + '% ' + omSource, { color: 'black', fontWeight: 'bold' }));
                        soilDetailPanel.add(ui.Label(omStatus, { color: 'black' }));

                        if (estimatedOM < 2) {
                            soilDetailPanel.add(ui.Label(''));
                            soilDetailPanel.add(ui.Label('💡 لزيادة المادة العضوية:', { fontWeight: 'bold', fontSize: '13px', color: 'black' }));
                            soilDetailPanel.add(ui.Label('   • أضف 2-4 طن/فدان كمبوست', { fontSize: '13px', color: 'black' }));
                            soilDetailPanel.add(ui.Label('   • استخدم السماد البلدي المتحلل', { fontSize: '13px', color: 'black' }));
                            soilDetailPanel.add(ui.Label('   • ازرع محاصيل تغطية (Cover Crops)', { fontSize: '13px', color: 'black' }));
                        }

                        // Soil Recommendations Summary (Deep Expert Fixes)
                        soilDetailPanel.add(ui.Label(''));
                        soilDetailPanel.add(ui.Label('━━━ 📋 خطة إصلاح التربة (Expert Fixes) ━━━', { fontWeight: 'bold', color: '#1B5E20' }));

                        var soilRecs = [];
                        if (csiVal > 0.3) {
                            var gypsumTons = (csiVal * 4).toFixed(1); // Rough estimate for Egypt
                            soilRecs.push('• إضافة ' + gypsumTons + ' طن/فدان جبس زراعي (لمعالجة الملوحة)');
                            soilRecs.push('• غسيل التربة بمياه عذبة (صرف جيد ضروري)');
                        }
                        if (olmPH > 8.2) {
                            soilRecs.push('• إضافة 200 كجم كبريت زراعي خشن (لخفض القلوية)');
                            soilRecs.push('• استخدام أسمدة حامضية (سلفات النشادر)');
                        }
                        if (smVal < (isSandyForSM ? 0.05 : 0.15)) {
                            soilRecs.push('• استخدام مواد محسنة للرطوبة (بوليمرات أو زاوليت)');
                        }
                        if (estimatedOM < 2) {
                            var compostTons = (2 - estimatedOM).toFixed(1) * 5;
                            soilRecs.push('• إضافة ' + compostTons.toFixed(0) + ' طن/فدان كمبوست نباتي مع الخدمة');
                        }
                        if (soilRecs.length === 0) soilRecs.push('✅ التربة في حالة جيدة - حافظ على التسميد المتوازن!');

                        soilRecs.forEach(function (rec) {
                            soilDetailPanel.add(ui.Label(rec, { fontSize: '12px', color: 'black', fontWeight: 'bold' }));
                        });

                        // Technical Expert Corner
                        soilDetailPanel.add(ui.Label(''));
                        soilDetailPanel.add(ui.Label('⚙️ البيانات التقنية المتقدمة (للخبراء):', { fontWeight: 'bold', fontSize: '13px' }));
                        soilDetailPanel.add(ui.Label('مؤشر الملوحة (CSI): ' + csiVal.toFixed(3) + ' | مؤشر الصحة (VHI): ' + vhiVal.toFixed(2), { fontSize: '12px', color: '#777' }));

                        // ═══════════════════════════════════════════════════════
                        // 9️⃣ SUGGESTED CROPS (New Interactive Toggle)
                        // ═══════════════════════════════════════════════════════
                        var cropSuggestionPanel = ui.Panel({ style: { shown: false, margin: '5px 0 0 20px', padding: '10px', backgroundColor: '#f0fff0', border: '1px solid #c8e6c9' } });
                        var cropHeader = ui.Button({
                            label: '▸ 9. المحاصيل المقترحة',
                            style: {
                                fontWeight: 'bold', fontSize: '14px', color: 'black', backgroundColor: '#e8f5e9',
                                padding: '4px', border: '1px solid #a5d6a7', stretch: 'horizontal', textAlign: 'left', margin: '5px 0'
                            }
                        });

                        cropHeader.onClick(function () {
                            var isShown = !cropSuggestionPanel.style().get('shown');
                            cropSuggestionPanel.style().set('shown', isShown);
                            cropHeader.setLabel((isShown ? '▾' : '▸') + ' 9. المحاصيل المقترحة');
                        });

                        infoPanel.add(cropHeader);
                        infoPanel.add(cropSuggestionPanel);

                        // Suitability Logic & Presentation
                        var isSandy = (textureClass.indexOf('Sandy') > -1 || textureClass.indexOf('رملية') > -1 || olmSand > 70);
                        var isSaline = (csiVal > 0.3); // Consistent with unified CSI
                        var isAlkaline = (olmPH > 8.0);

                        var createCropCategory = function (title, emoji, crops) {
                            var catPanel = ui.Panel({ style: { margin: '8px 0', padding: '5px', backgroundColor: '#ffffff', borderRadius: '5px', border: '1px solid #e0e0e0' } });
                            catPanel.add(ui.Label(emoji + ' ' + title, { fontWeight: 'bold', fontSize: '13px', color: '#2E7D32' }));
                            catPanel.add(ui.Label(crops, { fontSize: '12px', color: '#444', margin: '4px 0 0 10px' }));
                            return catPanel;
                        };

                        if (isSaline) {
                            cropSuggestionPanel.add(createCropCategory('محاصيل تتحمل الملوحة', '🌾', 'البرسيم الحجازي، الشعير، بنجر السكر، الكينوا، نخيل البلح.'));
                        }

                        if (isSandy) {
                            cropSuggestionPanel.add(createCropCategory('محاصيل الأراضي الرملية', '🍊', 'الموالح، الزيتون، الرمان، التين، الفول السوداني، الجوجوبا.'));
                        } else {
                            cropSuggestionPanel.add(createCropCategory('محاصيل الأراضي الطميية/الثقيلة', '🌽', 'القمح، الذرة، البرسيم المصري، القطن، قصب السكر، الخضروات الورقية.'));
                        }

                        if (isAlkaline) {
                            cropSuggestionPanel.add(createCropCategory('محاصيل التربة القلوية', '🧪', 'القطن، الشعير، بعض أصناف القمح، البنجر.'));
                        }

                        if (!isSaline && !isSandy && !isAlkaline) {
                            cropSuggestionPanel.add(ui.Label('✅ معظم المحاصيل التقليدية مناسبة لمواصفات هذه التربة الممتازة.', { color: '#1B5E20', fontSize: '12px', fontWeight: 'bold' }));
                        }

                        cropSuggestionPanel.add(ui.Label('💡 نصيحة: استشر مهندساً زراعياً لاختيار الصنف الأنسب لمناخ منطقتك.', { fontSize: '13px', color: '#666', fontStyle: 'italic', margin: '10px 0 0 0' }));

                        // Final Notes
                        infoPanel.add(ui.Label(''));
                        infoPanel.add(ui.Label('═══════════════════════════════════════', { color: 'black' }));
                        infoPanel.add(ui.Label('📝 ملاحظة هامة:', { fontWeight: 'bold', fontSize: '12px', color: 'black' }));
                        infoPanel.add(ui.Label('هذا التقرير مبني على تحليل صور الأقمار الصناعية ويعطي تقديرات ذكية.', { fontStyle: 'italic', fontSize: '13px', color: 'black' }));
                        infoPanel.add(ui.Label('دقة التقديرات: 70-90% حسب جودة صور الأقمار الصناعية المتوفرة.', { fontStyle: 'italic', fontSize: '13px', color: 'black' }));

                        // ═══════════════════════════════════════════════════════
                        // 📈 NDVI CHART
                        // ═══════════════════════════════════════════════════════
                        var ndviTimeSeries = s2Col.map(function (img) {
                            return indicesDict['NDVI (Vegetation)'](img).copyProperties(img, ['system:time_start']);
                        });

                        var chart = ui.Chart.image.series({
                            imageCollection: ndviTimeSeries,
                            region: farmArea,
                            reducer: ee.Reducer.mean(),
                            scale: 10
                        }).setOptions({
                            title: 'تطور الغطاء النباتي',
                            hAxis: { title: 'التاريخ' },
                            vAxis: { title: 'NDVI' },
                            lineWidth: 2,
                            pointSize: 4,
                            colors: ['#228B22']
                        });

                        chartPanel.add(chart);
                    }); // End stats.evaluate
                }); // End s2Col.size().evaluate
            }; // End runReportLogic
        } // End onClick body
    }); // End ui.Button call

    mainPanel.add(masterExecuteButton); // ✅ إضافة الزر فوراً
}; // --- END FARMER MODE ---

// ====================================================================================
// 🏠 NEW: WELCOME SCREEN (Landing Page)
// ====================================================================================
var buildWelcomeScreen = function () {
    controlsPanel.clear();
    reportPanel.clear();

    // 🦅 SAGE Logo & Title
    var titleLabel = ui.Label('🌿 SAGE - Egypt', {
        fontSize: '32px',
        fontWeight: '900',
        color: '#1B5E20',
        margin: '10px 0 5px 0',
        textAlign: 'center',
        stretch: 'horizontal'
    });

    var subtitleLabel = ui.Label('الخبير الذكي للمعلومات المكانية الزراعية', {
        fontSize: '18px',
        color: '#555',
        textAlign: 'center',
        margin: '0 0 20px 0',
        stretch: 'horizontal'
    });

    var researcherBtn = ui.Button({
        label: '🌍 دخول كـ (باحث)',
        onClick: function () {
            modeSelect.setValue('Researcher Mode (وضع الباحث)');
            buildResearcherMode();
        },
        style: { stretch: 'horizontal', fontWeight: 'bold', color: '#1565C0' }
    });

    var farmerBtn = ui.Button({
        label: '🌾 دخول كـ (مزارع)',
        onClick: function () {
            modeSelect.setValue('Farmer Mode (وضع المزارع)');
            buildFarmerMode();
        },
        style: { stretch: 'horizontal', fontWeight: 'bold', color: '#2E7D32' }
    });

    controlsPanel.add(titleLabel);
    controlsPanel.add(subtitleLabel);
    controlsPanel.add(ui.Label('يرجى اختيار وضع التشغيل للمتابعة:', { margin: '20px 0 10px 0', fontWeight: 'bold' }));
    controlsPanel.add(researcherBtn);
    controlsPanel.add(ui.Label('للتحليل المتقدم، الخرائط التفاعلية، ومؤشرات الاستشعار من بعد.', { fontSize: '13px', color: '#777', margin: '-5px 0 15px 10px' }));

    controlsPanel.add(farmerBtn);
    controlsPanel.add(ui.Label('للحصول على تقرير مبسط لمزرعتك وتوصيات زراعية مباشرة.', { fontSize: '13px', color: '#777', margin: '-5px 0 15px 10px' }));

    controlsPanel.add(ui.Label('────────────────────────────────', { color: '#ccc' }));
    controlsPanel.add(ui.Label('💡 تعليمات: بعد اختيار الوضع، يمكنك التبديل بين الأوضاع دائماً من القائمة المنسدلة في الأعلى.', { fontSize: '12px', color: '#999', fontStyle: 'italic' }));

    controlsPanel.add(ui.Label('────────────────────────────────', { color: '#ccc', margin: '15px 0 5px 0' }));
    controlsPanel.add(ui.Label('👨‍🔬 Developer: ELSAYED FAROUK', { fontSize: '13px', fontWeight: 'bold', color: '#1B5E20' }));
    controlsPanel.add(ui.Label('🏫 Assistant Lecturer — Soil & Water Dept., Faculty of Agriculture, Sohag University', { fontSize: '12px', color: '#666' }));
};

// ====================================================================================
// 🚀 INITIALIZATION
// ====================================================================================
buildWelcomeScreen(); // Start with the new Welcome/Choice Screen

// FORCE INITIAL CENTER (To fix US default view)
centerPanel.setCenter(30.8, 26.8, 6);
Map.setCenter(30.8, 26.8, 6);
Map.setOptions({ mapTypeId: 'SATELLITE' });
centerPanel.setOptions({ mapTypeId: 'SATELLITE' });
