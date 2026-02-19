// ════════════════════════════════════════════════════════════════════
// SAGE Egypt — Earth Engine Computation Module
// Ported from SAGE_FREE.js (all scientific logic)
// ════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 1) SENTINEL-2 PREPARATION
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 1) SENTINEL-2 PREPARATION
// ═══════════════════════════════════════════════════════════════

function maskAndPrepareS2(img) {
    // Debug: Check if img is valid
    // console.log('Processing S2 Image:', img.id()); 
    var scl = img.select('SCL');
    var clearMask = scl.neq(3)  // Cloud Shadow
        .and(scl.neq(8))       // Cloud Medium
        .and(scl.neq(9))       // Cloud High
        .and(scl.neq(10))      // Cirrus
        .and(scl.neq(11));     // Snow/Ice
    return img.updateMask(clearMask)
        .select(['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'],
            ['BLUE', 'GREEN', 'RED', 'RE1', 'RE2', 'RE3', 'NIR', 'NIR2', 'SWIR1', 'SWIR2'])
        .divide(10000)
        .copyProperties(img, ['system:time_start']);
}

function getS2Collection(start, end, geometry) {
    console.log('📡 GEE: Requesting Sentinel-2 Collection...', { start, end });
    var col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(geometry)
        .filterDate(start, end)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30));

    // Asynchronous check for collection size (non-blocking log)
    col.size().evaluate(function (s, e) {
        if (e) console.error('❌ GEE Error (S2):', e);
        else console.log('✅ GEE Success (S2): Found ' + s + ' images.');
    });

    return col.map(maskAndPrepareS2);
}

// ═══════════════════════════════════════════════════════════════
// 2) INDICES DICTIONARY (20+ Indices)
// ═══════════════════════════════════════════════════════════════

var indicesDict = {
    'NDVI': function (img) {
        return img.normalizedDifference(['NIR', 'RED']).rename('NDVI');
    },
    'EVI': function (img) {
        return img.expression(
            '2.5 * ((NIR - RED) / (NIR + 6*RED - 7.5*BLUE + 1))',
            { NIR: img.select('NIR'), RED: img.select('RED'), BLUE: img.select('BLUE') }
        ).rename('EVI');
    },
    'SAVI': function (img) {
        return img.expression(
            '1.5 * (NIR - RED) / (NIR + RED + 0.5)',
            { NIR: img.select('NIR'), RED: img.select('RED') }
        ).rename('SAVI');
    },
    'NDMI': function (img) {
        return img.normalizedDifference(['NIR', 'SWIR1']).rename('NDMI');
    },
    'GCI': function (img) {
        return img.select('NIR').divide(img.select('GREEN')).subtract(1).rename('GCI');
    },
    'NDWI': function (img) {
        return img.normalizedDifference(['GREEN', 'NIR']).rename('NDWI');
    },
    'MNDWI': function (img) {
        return img.normalizedDifference(['GREEN', 'SWIR1']).rename('MNDWI');
    },
    'NDBI': function (img) {
        return img.normalizedDifference(['SWIR1', 'NIR']).rename('NDBI');
    },
    'BSI': function (img) {
        return img.expression(
            '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
            { SWIR1: img.select('SWIR1'), RED: img.select('RED'), NIR: img.select('NIR'), BLUE: img.select('BLUE') }
        ).rename('BSI');
    },
    'NBR': function (img) {
        return img.normalizedDifference(['NIR', 'SWIR2']).rename('NBR');
    },
    'NDSI': function (img) {
        return img.normalizedDifference(['SWIR1', 'SWIR2']).rename('NDSI');
    },
    'ClayRatio': function (img) {
        return img.select('SWIR1').divide(img.select('SWIR2')).rename('ClayRatio');
    },
    'IronOxide': function (img) {
        return img.select('RED').divide(img.select('BLUE')).rename('IronOxide');
    },
    'GypsumIndex': function (img) {
        return img.expression(
            '(SWIR1 - SWIR2) / (SWIR1 + SWIR2)',
            { SWIR1: img.select('SWIR1'), SWIR2: img.select('SWIR2') }
        ).rename('GypsumIndex');
    },
    'CarbonateIndex': function (img) {
        return img.expression('SWIR2 / SWIR1',
            { SWIR1: img.select('SWIR1'), SWIR2: img.select('SWIR2') }
        ).rename('CarbonateIndex');
    },
    'ESI': function (img) {
        return img.expression('sqrt((RED + NIR) / 2)',
            { RED: img.select('RED'), NIR: img.select('NIR') }
        ).rename('ESI');
    },
    'SI3': function (img) {
        return img.expression('sqrt(BLUE * RED)',
            { BLUE: img.select('BLUE'), RED: img.select('RED') }
        ).rename('SI3');
    },
    'SOM': function (img) {
        return img.expression(
            '(1 - ((SWIR2 - SWIR2min) / (SWIR2max - SWIR2min))) * (NIR / RED)',
            { SWIR2: img.select('SWIR2'), NIR: img.select('NIR'), RED: img.select('RED'), SWIR2min: 0.05, SWIR2max: 0.35 }
        ).rename('SOM');
    },
    'Turbidity': function (img) {
        return img.select('RED').divide(img.select('BLUE')).rename('Turbidity');
    },
    'Chlorophyll-a': function (img) {
        return img.expression(
            '(NIR - RED) / (NIR + RED) * 10',
            { NIR: img.select('NIR'), RED: img.select('RED') }
        ).rename('Chla');
    }
};

var visParamsDict = {
    'NDVI': { min: 0, max: 0.8, palette: ['#FFFFFF', '#CE7E45', '#DF923D', '#F1B555', '#FCD163', '#99B718', '#74A901', '#66A000', '#529400', '#3E8601', '#207401', '#056201', '#004C00', '#023B01', '#012E01', '#011D01', '#011301'] },
    'EVI': { min: 0, max: 0.8, palette: ['white', 'yellow', 'green', 'darkgreen'] },
    'SAVI': { min: 0, max: 0.8, palette: ['white', 'yellow', 'green', 'darkgreen'] },
    'NDMI': { min: -0.2, max: 0.6, palette: ['#E0F7FA', '#B2EBF2', '#80DEEA', '#4DD0E1', '#26C6DA', '#00ACC1', '#0097A7', '#00838F', '#006064'] },
    'GCI': { min: 0, max: 5, palette: ['white', 'green'] },
    'NDWI': { min: -1, max: 0.5, palette: ['red', 'white', 'blue'] },
    'MNDWI': { min: -1, max: 0.5, palette: ['red', 'white', 'blue'] },
    'NDBI': { min: -0.5, max: 0.5, palette: ['green', 'white', 'red'] },
    'BSI': { min: -0.15, max: 0.35, palette: ['green', 'white', 'brown'] },
    'NBR': { min: -1, max: 1, palette: ['#334D33', '#111111', '#FF0000', '#00FF00', '#FFFF00'] },
    'NDSI': { min: -1, max: 1, palette: ['red', 'white', 'cyan'] },
    'ClayRatio': { min: 0.5, max: 2.5, palette: ['blue', 'white', 'red'] },
    'IronOxide': { min: 0.5, max: 2.5, palette: ['blue', 'white', 'red'] },
    'GypsumIndex': { min: -0.2, max: 0.2, palette: ['blue', 'white', 'red'] },
    'CarbonateIndex': { min: 0.5, max: 1.5, palette: ['blue', 'white', 'red'] },
    'ESI': { min: 0.1, max: 0.6, palette: ['red', 'yellow', 'green'] },
    'SI3': { min: 0, max: 0.4, palette: ['white', 'blue', 'purple'] },
    'SOM': { min: 0, max: 1, palette: ['#D7C29E', '#BB9E70', '#8B6A3D', '#5D4037', '#3E2723'] },
    'Turbidity': { min: 0.5, max: 2.0, palette: ['blue', 'green', 'yellow', 'brown'] },
    'Chlorophyll-a': { min: 0, max: 5, palette: ['white', 'green', 'darkgreen'] }
};

// ═══════════════════════════════════════════════════════════════
// Helper: Get Collection by Sensor Name
// ═══════════════════════════════════════════════════════════════
function getAnyCollection(sensor, start, end, region) {
    if (sensor === 'Sentinel-2') return getS2Collection(start, end, region);
    if (sensor === 'Landsat 8') return getMergedLandsatCollection(start, end, region).filter(ee.Filter.eq('SATELLITE', 'LANDSAT_8'));
    if (sensor === 'Landsat 7') return getMergedLandsatCollection(start, end, region).filter(ee.Filter.eq('SATELLITE', 'LANDSAT_7'));
    if (sensor === 'Landsat 5') return getMergedLandsatCollection(start, end, region).filter(ee.Filter.eq('SATELLITE', 'LANDSAT_5'));
    return getS2Collection(start, end, region);
}

// ═══════════════════════════════════════════════════════════════
// 3) SENTINEL-1 (SAR) DATA
// ═══════════════════════════════════════════════════════════════

function getS1Collection(start, end, region) {
    return ee.ImageCollection('COPERNICUS/S1_GRD')
        .filterDate(start, end)
        .filterBounds(region)
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
        .filter(ee.Filter.eq('instrumentMode', 'IW'))
        .map(function (img) {
            var vv_smoothed = img.select('VV').focal_median(30, 'circle', 'meters').rename('VV_smoothed');
            var vh_smoothed = img.select('VH').focal_median(30, 'circle', 'meters').rename('VH_smoothed');
            return img.addBands([vv_smoothed, vh_smoothed]).copyProperties(img, ['system:time_start']);
        });
}

// ═══════════════════════════════════════════════════════════════
// 4) SALINITY MODEL (V2.5 — Additive Multi-Evidence)
// ═══════════════════════════════════════════════════════════════

function estimateSalinity_ML(s2, s1, lst, precip, et, dem, slope) {
    // 1. Vegetation suppression
    var ndvi = s2.normalizedDifference(['NIR', 'RED']).unmask(0);
    var ndvi_inv = ndvi.multiply(-1);
    var ndmi = s2.normalizedDifference(['NIR', 'SWIR1']).unmask(0);
    var ndmi_inv = ndmi.multiply(-1);
    var vegFactor = ndvi.unitScale(0.25, 0.6).clamp(0, 1);
    var soilWeight = ee.Image(1).subtract(vegFactor);

    // 1b. Urban suppression
    var ndbi = s2.normalizedDifference(['SWIR1', 'NIR']).unmask(0);
    var urbanFactor = ndbi.unitScale(0.0, 0.3).clamp(0, 1);
    soilWeight = soilWeight.multiply(ee.Image(1).subtract(urbanFactor));

    // 2. Optical salinity indices
    var si1 = s2.expression('sqrt(GREEN * RED)', { GREEN: s2.select('GREEN'), RED: s2.select('RED') }).unmask(0);
    var si2 = s2.expression('sqrt(RED * NIR)', { RED: s2.select('RED'), NIR: s2.select('NIR') }).unmask(0);
    var si3 = s2.normalizedDifference(['SWIR1', 'SWIR2']).unmask(0);

    // 3. SAR response
    var vv = s1.select('VV_smoothed').unmask(-15).clamp(-25, -5);
    var vh = s1.select('VH_smoothed').unmask(-22).clamp(-30, -10);
    var pol_ratio = vv.subtract(vh).clamp(-10, 10);

    // 4. Environmental factors
    var elev_norm = dem.unitScale(0, 300).clamp(0, 1).unmask(0.5);
    var lst_norm = lst.unitScale(15, 50).unmask(0.5);
    var waterDeficit = et.subtract(precip).divide(et.add(0.1)).unmask(0.8);

    // 5. Soft desert modulation
    var spectral_salt_evidence = si3.unitScale(0, 0.12).clamp(0, 1);
    var env_modulator = spectral_salt_evidence.multiply(0.7).add(0.3);

    // 6. Final equation
    var ec_estimated = ee.Image(1.0)
        .add(
            si1.multiply(1.0).add(si2.multiply(1.2)).add(si3.multiply(2.0))
                .add(ndvi_inv.multiply(1.0)).add(ndmi_inv.multiply(1.2))
                .multiply(soilWeight)
        )
        .add(
            vv.multiply(-0.1).add(pol_ratio.multiply(0.8))
                .multiply(soilWeight.add(0.1))
        )
        .add(elev_norm.multiply(-1.5))
        .add(
            lst_norm.multiply(1.0).add(waterDeficit.multiply(1.5))
                .multiply(soilWeight.add(0.05))
                .multiply(env_modulator)
        )
        .clamp(0.5, 30)
        .rename('EC_dSm');

    return ec_estimated;
}

// ═══════════════════════════════════════════════════════════════
// 4b) VEGETATION HEALTH INDEX (VHI)
// ═══════════════════════════════════════════════════════════════
function calculateVHI(start, end, region) {
    var fullHistory = getMergedLandsatCollection('1984-01-01', ee.Date(Date.now()).format('YYYY-MM-dd'), region);
    var historyNdvi = fullHistory.map(function (img) { return indicesDict['NDVI'](img); });
    var historyLst = fullHistory.select('LST');

    var ndviMin = historyNdvi.min();
    var ndviMax = historyNdvi.max();
    var lstMin = historyLst.min();
    var lstMax = historyLst.max();

    var currentCol = getMergedLandsatCollection(start, end, region);
    var result = currentCol.median();
    var currentNdvi = indicesDict['NDVI'](result);
    var currentLst = result.select('LST');

    var vci = currentNdvi.subtract(ndviMin).divide(ndviMax.subtract(ndviMin)).rename('VCI');
    var tci = lstMax.subtract(currentLst).divide(lstMax.subtract(lstMin)).rename('TCI');

    return vci.multiply(0.5).add(tci.multiply(0.5)).rename('VHI').clip(region);
}

// ═══════════════════════════════════════════════════════════════
// 4c) DROUGHT ASSESSMENT (Multi-Sensor)
// ═══════════════════════════════════════════════════════════════
function calculateDroughtIndex(start, end, region) {
    var s2 = getS2Collection(start, end, region).median();
    var ls_col = getMergedLandsatCollection(start, end, region);
    var lst = ls_col.select('LST').median();
    var era5 = getEra5(start, end, region);
    var sm_rootzone = era5.select('sm_rootzone_m3m3');

    var ndvi = indicesDict['NDVI'](s2).unitScale(-0.2, 0.8);
    var ndmi = indicesDict['NDMI'](s2).unitScale(-0.5, 0.5);
    var lst_norm = lst.unitScale(20, 50).multiply(-1).add(1);
    var sm_norm = sm_rootzone.unitScale(0.1, 0.35);

    var cdi = ndvi.multiply(0.3).add(ndmi.multiply(0.3)).add(lst_norm.multiply(0.2)).add(sm_norm.multiply(0.2)).rename('CDI');
    return cdi.clip(region);
}

// ═══════════════════════════════════════════════════════════════
// 4d) DESERTIFICATION RISK
// ═══════════════════════════════════════════════════════════════
function calculateDesertRisk(start, end, region) {
    var s2 = getS2Collection(start, end, region).median();
    var ls_col = getMergedLandsatCollection(start, end, region);
    var lst = ls_col.select('LST').median();
    var era5 = getEra5(start, end, region);
    var sm_rootzone = era5.select('sm_rootzone_m3m3');

    var ndvi_risk = indicesDict['NDVI'](s2).unitScale(0.1, 0.6).multiply(-1).add(1);
    var bsi_risk = indicesDict['BSI'](s2).unitScale(-0.3, 0.5);
    var lst_risk = lst.unitScale(25, 50);
    var sm_risk = sm_rootzone.unitScale(0.1, 0.35).multiply(-1).add(1);

    var desert_risk = ndvi_risk.multiply(0.3).add(bsi_risk.multiply(0.3)).add(lst_risk.multiply(0.2)).add(sm_risk.multiply(0.2)).rename('DesertRisk');
    return desert_risk.clip(region);
}

// ═══════════════════════════════════════════════════════════════
// 5) LANDSAT HELPERS (Cloud mask, Scale, Merged Collection)
// ═══════════════════════════════════════════════════════════════

function cloudMaskLandsat(img) {
    var qa = img.select('QA_PIXEL');
    var mask = qa.bitwiseAnd(1 << 1).eq(0)
        .and(qa.bitwiseAnd(1 << 2).eq(0))
        .and(qa.bitwiseAnd(1 << 3).eq(0))
        .and(qa.bitwiseAnd(1 << 4).eq(0));
    return img.updateMask(mask).copyProperties(img, img.propertyNames());
}

function applyScaleFactors(img) {
    var optical = img.select('SR_B.*').multiply(2.75e-5).subtract(0.2);
    var thermal = img.select('ST_B.*').multiply(0.00341802).add(149.0).subtract(273.15);
    return img.addBands(optical, null, true).addBands(thermal, null, true)
        .copyProperties(img, img.propertyNames());
}

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

// ═══════════════════════════════════════════════════════════════
// 6) CLIMATE DATA LOADERS
// ═══════════════════════════════════════════════════════════════

function getChirps(start, end, geometry) {
    var startDate = ee.Date(start);
    var endDate = ee.Date(end);
    var col = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
        .filterBounds(geometry)
        .filterDate(startDate.advance(-1, 'month'), endDate);
    var count = col.size();
    var result = ee.Algorithms.If(count.gt(0),
        col.sum().rename('Precipitation'),
        ee.Image(10).rename('Precipitation'));
    return ee.Image(result);
}

function getModisET(start, end, geometry) {
    var startDate = ee.Date(start);
    var endDate = ee.Date(end);
    var col = ee.ImageCollection('MODIS/061/MOD16A2GF')
        .filterBounds(geometry)
        .filterDate(startDate.advance(-2, 'month'), endDate)
        .select('ET');
    var count = col.size();
    var dailyEt = col.map(function (img) {
        return img.multiply(0.1).divide(8).copyProperties(img, ['system:time_start']);
    });
    var result = ee.Algorithms.If(count.gt(0),
        dailyEt.mean().rename('ET'),
        ee.Image(5).rename('ET'));
    return ee.Image(result);
}

function getEra5(start, end, geometry) {
    var era_bands = ['skin_temperature', 'volumetric_soil_water_layer_1',
        'volumetric_soil_water_layer_2', 'total_evaporation_sum',
        'temperature_2m', 'dewpoint_temperature_2m',
        'u_component_of_wind_10m', 'v_component_of_wind_10m'];
    var new_names = ['skin_temp_K', 'sm_topsoil_m3m3', 'sm_rootzone_m3m3',
        'total_evap_m_sum', 'air_temp_K', 'dewpoint_temp_K', 'u_wind_ms', 'v_wind_ms'];

    var startDate = ee.Date(start);
    var endDate = ee.Date(end);
    var col = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
        .filterBounds(geometry)
        .filterDate(startDate.advance(-6, 'month'), endDate)
        .select(era_bands, new_names);

    var count = col.size();
    var meanImage = ee.Algorithms.If(count.gt(0), col.mean(),
        ee.Image([298, 0.2, 0.2, 0, 298, 298, 0, 0]).rename(new_names).updateMask(0));
    meanImage = ee.Image(meanImage);

    var skinTempC = meanImage.select('skin_temp_K').subtract(273.15).rename('skin_temp_C');
    var airTempC = meanImage.select('air_temp_K').subtract(273.15).rename('air_temp_C');
    var dewTempC = meanImage.select('dewpoint_temp_K').subtract(273.15).rename('dewpoint_temp_C');

    var rh = meanImage.expression(
        '100 * exp((17.625 * Td) / (243.04 + Td)) / exp((17.625 * T) / (243.04 + T))',
        { Td: dewTempC, T: airTempC }
    ).rename('RH');

    var windSpeed = meanImage.expression('sqrt(u*u + v*v)',
        { u: meanImage.select('u_wind_ms'), v: meanImage.select('v_wind_ms') }
    ).rename('WindSpeed');

    return meanImage.addBands(skinTempC).addBands(airTempC)
        .addBands(dewTempC).addBands(rh).addBands(windSpeed);
}

// ═══════════════════════════════════════════════════════════════
// 7) SOIL DATA (OpenLandMap)
// ═══════════════════════════════════════════════════════════════

function getOpenLandMapSoil(geometry) {
    var clay = ee.Image('OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02').select('b0').rename('Clay_0cm');
    var sand = ee.Image('OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02').select('b0').rename('Sand_0cm');
    var organicCarbon = ee.Image('OpenLandMap/SOL/SOL_ORGANIC-CARBON_USDA-6A1C_M/v02').select('b0').divide(10).rename('OC_0cm');
    var pH = ee.Image('OpenLandMap/SOL/SOL_PH-H2O_USDA-4C1A2A_M/v02').select('b0').divide(10).rename('pH_0cm');
    var bulkDensity = ee.Image('OpenLandMap/SOL/SOL_BULKDENS-FINEEARTH_USDA-4A1H_M/v02').select('b0').divide(1000).rename('BulkDens_0cm');
    var textureClass = ee.Image('OpenLandMap/SOL/SOL_TEXTURE-CLASS_USDA-TT_M/v02').select('b0').rename('TextureClass');
    var waterContent33 = clay.multiply(0.4).add(15).rename('WC_33kPa');

    return clay.addBands(sand).addBands(organicCarbon).addBands(pH)
        .addBands(bulkDensity).addBands(textureClass).addBands(waterContent33).clip(geometry);
}

// ═══════════════════════════════════════════════════════════════
// 8) USDA TEXTURE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

var textureClassNames = {
    1: 'طين (Clay)', 2: 'طين رملي (Sandy Clay)', 3: 'طين سلتي (Silty Clay)',
    4: 'طين رملي لومي (Sandy Clay Loam)', 5: 'طين لومي (Clay Loam)',
    6: 'طين سلتي لومي (Silty Clay Loam)', 7: 'لومي رملي (Sandy Loam)',
    8: 'لومي (Loam)', 9: 'سلت لومي (Silt Loam)', 10: 'رملي (Sand)',
    11: 'رملي لومي (Loamy Sand)', 12: 'سلت (Silt)'
};

function classifyUSDATexture(clay, sand) {
    var silt = 100 - clay - sand;
    if (silt < 0) silt = 0;

    // 🛑 FIX: Prevent "Silt Bias" when data is missing (0 + 0 = 100% Silt)
    if (clay + sand <= 0.1) return 'غير متوفر';

    // 1. رملي (Sand): رمل >= 85% وطين < 10%
    if (sand >= 85 && (silt + 1.5 * clay) < 15) return 'رملية (Sand)';

    // 2. رملي لومي (Loamy Sand): رمل 70-90%, طين < 15%
    if (sand >= 70 && sand < 90 && (silt + 1.5 * clay) >= 15 && (silt + 2 * clay) < 30) return 'رملية لومي (Loamy Sand)';

    // 3. طين سلتي (Silty Clay): طين >= 40% وسلت >= 40%
    if (clay >= 40 && silt >= 40) return 'طينية سلتية (Silty Clay)';

    // 4. طين رملي (Sandy Clay): طين >= 35% ورمل >= 45%
    if (clay >= 35 && sand >= 45) return 'طينية رملية (Sandy Clay)';

    // 5. طين (Clay): طين >= 40%
    if (clay >= 40 && sand <= 45 && silt < 40) return 'طينية (Clay)';

    // 6. طين سلتي لومي (Silty Clay Loam): طين 27-40%, رمل < 20%
    if (clay >= 27 && clay < 40 && sand < 20) return 'طينية سلتية لومية (Silty Clay Loam)';

    // 7. طين لومي (Clay Loam): طين 27-40%, رمل 20-45%
    if (clay >= 27 && clay < 40 && sand >= 20 && sand <= 45) return 'طينية لومية (Clay Loam)';

    // 8. طين رملي لومي (Sandy Clay Loam): طين 20-35%, رمل > 45%
    if (clay >= 20 && clay < 35 && sand > 45) return 'طينية طميية رملية (Sandy Clay Loam)';

    // 9. سلت (Silt): سلت >= 80%, طين < 12%
    if (silt >= 80 && clay < 12) return 'سلتية (Silt)';

    // 10. سلت لومي (Silt Loam): سلت >= 50%, طين < 27%
    if (silt >= 50 && clay < 27) return 'طميية سلتية (Silt Loam)';

    // 11. لومي (Loam): طين 7-27%, سلت 28-50%, رمل <= 52%
    if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return 'طميية (Loam)';

    // 12. لومي رملي (Sandy Loam): الباقي (رمل >= 43%, طين < 20%)
    if (sand >= 43 && clay < 20) return 'طميية رملية (Sandy Loam)';

    return 'طميية (Loam)';
}

// ═══════════════════════════════════════════════════════════════
// 9) FARM VALIDATION (Scientific 3-Method)
// ═══════════════════════════════════════════════════════════════

function validateFarmLocation(geometry, start, end) {
    console.log('🔍 GEE: Validating Farm Location...');
    // 1. Dynamic World
    var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
        .filterBounds(geometry).filterDate(start, end)
        .select(['crops', 'built', 'bare', 'grass', 'trees', 'water']);

    // Check if we have data
    var dwSize = dw.size();
    var hasDw = dwSize.gt(0);

    // Default/Fallback dictionary
    var fallback = ee.Dictionary({
        crops: 0, built: 0, bare: 1, grass: 0, water: 0,
        NDVI_max: 0, NDVI_min: 0, NDVI_mean: 0,
        BSI_mean: 1, NDBI_mean: 0, Albedo_mean: 1,
        NDVI_stdDev: 0
    });

    // Main Computation
    var computed = (function () {
        // Safe DW Mean
        var dwMean = ee.Image(ee.Algorithms.If(
            hasDw,
            dw.mean(),
            ee.Image.constant([0, 0, 1, 0, 0, 0]).rename(['crops', 'built', 'bare', 'grass', 'trees', 'water'])
        ));

        // 2. Sentinel-2
        var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(geometry).filterDate(start, end)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30));

        var s2Size = s2.size();
        var hasS2 = s2Size.gt(0);

        // Sub-computation for S2 (only if hasS2)
        var s2Stats = ee.Image(ee.Algorithms.If(hasS2, (function () {
            var s2Ndvi = s2.map(function (img) {
                return img.normalizedDifference(['B8', 'B4']).rename('NDVI');
            });

            // Temporal Stats
            var ndviMax = s2Ndvi.max().rename('NDVI_max');
            var ndviMin = s2Ndvi.min().rename('NDVI_min');
            var ndviMean = s2Ndvi.mean().rename('NDVI_mean');

            // Desert Indicators (from Median composite)
            var s2Med = s2.median();
            var bsi = s2Med.expression(
                '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
                { SWIR1: s2Med.select('B11'), RED: s2Med.select('B4'), NIR: s2Med.select('B8'), BLUE: s2Med.select('B2') }
            ).rename('BSI_mean');
            var ndbi = s2Med.normalizedDifference(['B11', 'B8']).rename('NDBI_mean');
            var albedo = s2Med.select(['B2', 'B3', 'B4']).reduce(ee.Reducer.mean()).rename('Albedo_mean');

            // Spatial StdDev (Texture)
            var ndviStd = s2Med.normalizedDifference(['B8', 'B4'])
                .reduceRegion({
                    reducer: ee.Reducer.stdDev(),
                    geometry: geometry,
                    scale: 20,
                    maxPixels: 1e8,
                    bestEffort: true
                }).get('nd', 0);

            return dwMean
                .addBands(ndviMax)
                .addBands(ndviMin)
                .addBands(ndviMean)
                .addBands(bsi)
                .addBands(ndbi)
                .addBands(albedo)
                .set('NDVI_std_val', ndviStd);
        })(), dwMean.addBands(ee.Image([0, 0, 0, 0, 0, 0]).rename(['NDVI_max', 'NDVI_min', 'NDVI_mean', 'BSI_mean', 'NDBI_mean', 'Albedo_mean'])).set('NDVI_std_val', 0)));

        var stats = s2Stats.reduceRegion({
            reducer: ee.Reducer.mean(),
            geometry: geometry,
            scale: 30,
            maxPixels: 1e8,
            bestEffort: true
        });

        return stats.set('NDVI_stdDev', s2Stats.get('NDVI_std_val'))
            .set('observation_count', s2Size);
    })();

    var normalized = ee.Dictionary(computed).set({
        crops_prob: ee.Dictionary(computed).get('crops', 0),
        bare_prob: ee.Dictionary(computed).get('bare', 0),
        built_prob: ee.Dictionary(computed).get('built', 0),
        ndvi_max: ee.Dictionary(computed).get('NDVI_max', 0),
        ndvi_min: ee.Dictionary(computed).get('NDVI_min', 0),
        ndvi_range: ee.Number(ee.Dictionary(computed).get('NDVI_max', 0))
            .subtract(ee.Number(ee.Dictionary(computed).get('NDVI_min', 0))),
        bsi_mean: ee.Dictionary(computed).get('BSI_mean', 0),
        ndbi_mean: ee.Dictionary(computed).get('NDBI_mean', 0),
        albedo_mean: ee.Dictionary(computed).get('Albedo_mean', 0),
        ndvi_stdDev: ee.Dictionary(computed).get('NDVI_stdDev', 0)
    });

    var normalizedFallback = ee.Dictionary(fallback).set({
        crops_prob: 0,
        bare_prob: 1,
        built_prob: 0,
        ndvi_max: 0,
        ndvi_min: 0,
        ndvi_range: 0,
        bsi_mean: 1,
        ndbi_mean: 0,
        albedo_mean: 1,
        ndvi_stdDev: 0
    });

    return ee.Dictionary(ee.Algorithms.If(hasDw.or(hasS2), normalized, normalizedFallback));
}

// ═══════════════════════════════════════════════════════════════
// 10) YIELD ESTIMATOR (Simple — Scalar/Point)
// ═══════════════════════════════════════════════════════════════

function estimateYield_Simple(ndviVal, cropType) {
    var yields = {
        'قمح': { unit: 'إردب', max: 24, min: 10 },
        'Wheat': { unit: 'إردب', max: 24, min: 10 },
        'ذرة': { unit: 'إردب', max: 30, min: 12 },
        'Maize': { unit: 'إردب', max: 30, min: 12 },
        'أرز': { unit: 'طن', max: 4.5, min: 1.5 },
        'Rice': { unit: 'طن', max: 4.5, min: 1.5 },
        'قطن': { unit: 'قنطار', max: 10, min: 4 },
        'Cotton': { unit: 'قنطار', max: 10, min: 4 },
        'بطاطس': { unit: 'طن', max: 25, min: 8 },
        'Potato': { unit: 'طن', max: 25, min: 8 },
        'طماطم': { unit: 'طن', max: 50, min: 15 },
        'Tomato': { unit: 'طن', max: 50, min: 15 }
    };

    var cropKey = null;
    for (var key in yields) {
        if (cropType && cropType.indexOf(key) > -1) { cropKey = key; break; }
    }
    if (!cropKey) return { text: 'غير متوفر لهذا المحصول', status: 'unknown' };

    var data = yields[cropKey];
    var ndviClamped = Math.min(0.8, Math.max(0.2, ndviVal));
    var factor = (ndviClamped - 0.2) / (0.8 - 0.2);
    var estimatedYield = data.min + (factor * (data.max - data.min));
    var lower = (estimatedYield * 0.9).toFixed(1);
    var upper = (estimatedYield * 1.1).toFixed(1);

    var status = 'متوسط (طبيعي)';
    if (factor > 0.7) status = 'ممتاز (عالي الإنتاجية)';
    else if (factor < 0.3) status = 'منخفض (يحتاج رعاية)';

    return { text: lower + ' - ' + upper + ' ' + data.unit + '/فدان', status: status };
}

// ═══════════════════════════════════════════════════════════════
// 11) GROWTH STAGE DETECTION
// ═══════════════════════════════════════════════════════════════

function detectGrowthStage(ndviCol, cropType, geometry) {
    var ndviStats = ndviCol.select('NDVI').reduce(ee.Reducer.percentile([10, 50, 90]));
    var p10 = ndviStats.select('NDVI_p10').reduceRegion({ reducer: ee.Reducer.mean(), geometry: geometry, scale: 30, maxPixels: 1e9 }).get('NDVI_p10');
    var p50 = ndviStats.select('NDVI_p50').reduceRegion({ reducer: ee.Reducer.mean(), geometry: geometry, scale: 30, maxPixels: 1e9 }).get('NDVI_p50');
    var p90 = ndviStats.select('NDVI_p90').reduceRegion({ reducer: ee.Reducer.mean(), geometry: geometry, scale: 30, maxPixels: 1e9 }).get('NDVI_p90');
    return ee.Dictionary({ p10: p10, p50: p50, p90: p90 });
}

// ═══════════════════════════════════════════════════════════════
// 12) HARVEST DATE PREDICTION
// ═══════════════════════════════════════════════════════════════

function predictHarvestDate(cropType, currentNDVI) {
    var growingPeriods = {
        'قمح (Wheat)': 150, 'ذرة (Maize)': 120, 'أرز (Rice)': 140,
        'قطن (Cotton)': 180, 'قصب السكر (Sugarcane)': 300
    };
    var totalDays = growingPeriods[cropType] || 120;
    var progress = Math.min(95, currentNDVI * 120);
    var daysElapsed = (progress / 100) * totalDays;
    var daysRemaining = Math.max(0, totalDays - daysElapsed);
    return { progress: progress, daysRemaining: Math.round(daysRemaining), totalDays: totalDays };
}

// ═══════════════════════════════════════════════════════════════
// 13) INTERPRETATION & RECOMMENDATION ENGINE
// ═══════════════════════════════════════════════════════════════

// FAO Salinity Classification
function classifySalinity(ecVal) {
    if (ecVal > 16) return { level: '☠️ شديدة الملوحة', color: '#B71C1C', crops: 'غير صالحة للزراعة التقليدية', class: 'extreme' };
    if (ecVal > 8) return { level: '🔴 عالية الملوحة', color: '#D32F2F', crops: 'شعير، نخيل، بنجر السكر', class: 'high' };
    if (ecVal > 4) return { level: '🟠 متوسطة الملوحة', color: '#F57C00', crops: 'قمح، قطن، تين، رمان', class: 'moderate' };
    if (ecVal > 2) return { level: '🟡 طفيفة الملوحة', color: '#FBC02D', crops: 'معظم المحاصيل ما عدا الحساسة جداً', class: 'slight' };
    return { level: '✅ تربة عذبة', color: '#388E3C', crops: 'جميع المحاصيل', class: 'none' };
}

// Crop Fertilizer Recommendations
var cropFertReqs = {
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

function getFertilizerRec(cropType, olmOC, olmPH, olmTexture) {
    var defaultReq = { N: 60, P: 30, K: 24, note: 'توصية عامة' };
    var selectedReq = defaultReq;
    for (var key in cropFertReqs) {
        if (cropType.indexOf(key.split(' ')[0]) > -1) { selectedReq = cropFertReqs[key]; break; }
    }
    var nRec = selectedReq.N;
    var pRec = selectedReq.P;
    var kRec = selectedReq.K;
    if (olmOC !== null && olmOC / 10 < 1) nRec *= 1.2;
    if (olmPH !== null && olmPH > 8) pRec *= 1.25;
    if (olmTexture && olmTexture.indexOf('Sand') > -1) kRec *= 1.2;

    return {
        N: Math.round(nRec), P: Math.round(pRec), K: Math.round(kRec),
        note: selectedReq.note,
        urea: Math.round(nRec / 0.46),
        superPhosphate: Math.round(pRec / 0.15),
        potassiumSulfate: Math.round(kRec / 0.48)
    };
}

// Pest & Disease Risk Assessment
function assessPestRisk(cropType, rhVal, airTempVal) {
    var isWheat = cropType.indexOf('قمح') > -1 || cropType.indexOf('Wheat') > -1;
    var isPotato = cropType.indexOf('بطاطس') > -1 || cropType.indexOf('Potato') > -1;
    var isTomato = cropType.indexOf('طماطم') > -1 || cropType.indexOf('Tomato') > -1;

    // Spider mites: Hot + Dry
    if (airTempVal > 30 && rhVal < 40) {
        return {
            risk: '🟠 خطر العنكبوت الأحمر', color: 'orange',
            msg: 'الجو حار وجاف (' + rhVal.toFixed(0) + '%)، مثالي للعنكبوت.'
        };
    }
    // Wheat yellow rust
    if (isWheat && rhVal > 60 && airTempVal >= 15 && airTempVal <= 25) {
        return {
            risk: '🔴 خطر داهم (الصدأ الأصفر)', color: 'red',
            msg: 'رطوبة جوية عالية (' + rhVal.toFixed(0) + '%) وحرارة معتدلة: بيئة مثالية للصدأ.'
        };
    }
    if (isWheat && rhVal > 50 && airTempVal > 25) {
        return {
            risk: '🟠 خطر متوسط (صدأ الساق/الأوراق)', color: 'orange',
            msg: 'الرطوبة تدعم نمو الفطريات.'
        };
    }
    // Potato late blight
    if (isPotato && rhVal > 85 && airTempVal >= 10 && airTempVal <= 20) {
        return {
            risk: '🔴 خطر الندوة المتأخرة (كارثي)', color: 'red',
            msg: 'رطوبة جوية مشبعة! يجب الرش الوقائي فوراً.'
        };
    }
    if (isPotato && rhVal > 70) {
        return {
            risk: '🟠 خطر الندوة المبكرة', color: 'orange',
            msg: 'الرطوبة عالية، افحص الأوراق السفلية.'
        };
    }
    // Tomato
    if (isTomato && rhVal > 80 && airTempVal < 20) {
        return {
            risk: '🔴 خطر الندوة المتأخرة', color: 'red',
            msg: 'رطوبة مرتفعة وحرارة منخفضة!'
        };
    }

    return {
        risk: '✅ منخفضة', color: 'green',
        msg: 'الظروف الجوية (حرارة ورطوبة) مستقرة.'
    };
}

// Irrigation Scheduler
function calculateIrrigation(olmTexture, lstVal, windSpeedVal, currentMonth, ecRealVal, olmSand, olmClay) {
    var interval = 7;
    var soilTypeAr = 'طميية (متوسطة)';

    if (olmTexture && olmTexture.indexOf('Sandy Clay') > -1) { interval = 9; soilTypeAr = 'طينية رملية (متوسطة الثقل)'; }
    else if (olmTexture && olmTexture.indexOf('Clay') > -1) { interval = 12; soilTypeAr = 'طينية (ثقيلة)'; }
    else if (olmTexture && olmTexture.indexOf('Sand') > -1) { interval = 4; soilTypeAr = 'رملية (خفيفة)'; }

    if (lstVal > 35) interval -= 1;
    if (windSpeedVal > 5) interval -= 1;
    if (lstVal < 20) interval += 2;
    if (currentMonth >= 5 && currentMonth <= 8) interval -= 1;
    interval = Math.max(1, interval);

    var isSummer = (currentMonth >= 5 && currentMonth <= 9);
    var irrigNote;
    if (olmSand !== null && olmSand >= 70) {
        irrigNote = isSummer ? '💧 تربة رملية + صيف → ري كل 2-3 أيام' : '💧 تربة رملية + شتاء → ري كل 4-5 أيام';
    } else if (olmClay !== null && olmClay >= 40) {
        irrigNote = isSummer ? '💧 تربة طينية + صيف → ري كل 5-7 أيام' : '💧 تربة طينية + شتاء → ري كل 10-14 يوم';
    } else {
        irrigNote = isSummer ? '💧 تربة متوسطة + صيف → ري كل 3-5 أيام' : '💧 تربة متوسطة + شتاء → ري كل 7-10 أيام';
    }
    if (ecRealVal > 4) irrigNote += ' ⚠️ (ملوحة → زد كمية الري 20-30%)';

    return {
        interval: interval, soilTypeAr: soilTypeAr, note: irrigNote,
        waterAmount: lstVal > 30 ? 'غزير (صباحاً)' : 'معتدل'
    };
}

// Spraying Guide
function assessSprayConditions(windSpeedVal, airTempVal) {
    if (windSpeedVal > 4.2) {
        return { canSpray: false, msg: '⛔ ممنوع الرش! الرياح قوية (' + (windSpeedVal * 3.6).toFixed(1) + ' كم/س) ستسبب تطاير المبيد.', color: 'red' };
    }
    if (airTempVal > 30) {
        return { canSpray: false, msg: '⛔ ممنوع الرش! الحرارة عالية (' + airTempVal.toFixed(1) + '°م) ستسبب تبخر المبيد وحرق الورق.', color: 'red' };
    }
    return { canSpray: true, msg: '✅ الأجواء مناسبة للرش (رياح هادئة وحرارة معتدلة).', color: 'green' };
}

// Expert Phenology Notes
function getExpertNote(cropType, currentMonth) {
    var isWheat = cropType.indexOf('قمح') > -1 || cropType.indexOf('Wheat') > -1;
    var isPotato = cropType.indexOf('بطاطس') > -1 || cropType.indexOf('Potato') > -1;
    var isTomato = cropType.indexOf('طماطم') > -1 || cropType.indexOf('Tomato') > -1;
    var isMaize = cropType.indexOf('ذرة') > -1 || cropType.indexOf('Maize') > -1;

    if (isWheat) {
        if (currentMonth === 2) return '💡 القمح في مرحلة "طرد السنابل". تجنب العطش تماماً، أضف سلفات بوتاسيوم (10 كجم رشاً) لزيادة الوزن.';
        if (currentMonth === 3) return '💡 مرحلة "امتلاء الحبوب". احذر من الري وقت الرياح الشديدة لتجنب الرقاد.';
        if (currentMonth === 11 || currentMonth === 12) return '💡 مرحلة "الإنبات والتفريع". تأكد من جرعة النشادر التنشيطية.';
    }
    if (isPotato) {
        if (currentMonth === 10 || currentMonth === 11) return '💡 عروة البطاطس النيلية. ركز على الوقاية من الندوة المتأخرة بسبب الرطوبة.';
        if (currentMonth === 12 || currentMonth === 1) return '💡 صب الدرنات. الاهتمام بالتسميد البوتاسي والري المنتظم.';
    }
    if (isTomato) return '💡 احذر من تذبذب الري لتجنب "عفن طرف السرة". التسميد الكالسي ضروري الآن.';
    if (isMaize && currentMonth >= 6 && currentMonth <= 8) return '💡 مرحلة "التزهير وتكوين الكوز". احتياج مائي عالٍ جداً، احذر من العطش.';
    return null;
}

// Leaching Requirement
function calculateLeachingReq(ecRealVal, cropType) {
    var toleranceMap = {
        'فراولة': 1, 'فاصوليا': 1, 'برتقال': 2, 'ذرة': 2, 'طماطم': 2,
        'قمح': 3, 'قطن': 3, 'شعير': 4, 'بنجر': 4, 'نخيل': 4
    };
    var toleranceValues = [1.5, 2.5, 6.0, 10.0, 12.0];

    var targetIdx = 2;
    for (var k in toleranceMap) {
        if (cropType.indexOf(k) > -1) { targetIdx = toleranceMap[k]; break; }
    }
    var targetEC = toleranceValues[Math.min(4, targetIdx)];
    if (!targetEC) targetEC = 6.0;

    function calcLR(ecw) {
        var denom = (5 * targetEC) - ecw;
        if (denom <= 0) return 1.0;
        return Math.min(0.5, Math.max(0, ecw / denom));
    }

    return {
        nile: { lr: calcLR(0.5), minutes: Math.round(calcLR(0.5) * 60), label: 'مياه النيل (0.5 dS/m)' },
        well: { lr: calcLR(1.5), minutes: Math.round(calcLR(1.5) * 60), label: 'آبار متوسطة (1.5 dS/m)' },
        saline: { lr: calcLR(3.0), minutes: Math.round(calcLR(3.0) * 60), label: 'آبار مالحة (3.0 dS/m)', impossible: calcLR(3.0) > 0.45 }
    };
}

// Crop Tolerance Check
function checkCropSalinityTolerance(cropType, csiVal) {
    var toleranceMap = {
        'فراولة': 1, 'فاصوليا': 1, 'برتقال': 2, 'ذرة': 2, 'طماطم': 2,
        'قمح': 3, 'قطن': 3, 'شعير': 4, 'بنجر': 4, 'نخيل': 4
    };
    var currentClassIndex = 0;
    if (csiVal >= 0.75) currentClassIndex = 4;
    else if (csiVal >= 0.55) currentClassIndex = 3;
    else if (csiVal >= 0.35) currentClassIndex = 2;
    else if (csiVal >= 0.20) currentClassIndex = 1;

    var cropKey = null;
    for (var k in toleranceMap) {
        if (cropType.indexOf(k) > -1) { cropKey = k; break; }
    }
    if (cropKey && currentClassIndex > toleranceMap[cropKey]) {
        return { compatible: false, classIndex: currentClassIndex };
    }
    return { compatible: true, classIndex: currentClassIndex };
}

// Traffic Light Status
function getTrafficLight(ecRealVal, ndviVal, bsiVal) {
    if (ecRealVal > 8 || (ndviVal < 0.1 && bsiVal > 0.3)) {
        return { label: '🔴 حالة حرجة — تحتاج تدخل فوري', bg: '#FFCDD2', color: '#B71C1C' };
    }
    if (ecRealVal > 4 || ndviVal < 0.25) {
        return { label: '🟡 تحتاج انتباه — اتبع التوصيات', bg: '#FFF9C4', color: '#F57F17' };
    }
    return { label: '🟢 أرضك بحالة جيدة — استمر', bg: '#C8E6C9', color: '#1B5E20' };
}

// Health Score Calculation
function calculateHealthScore(ndviVal, vhiVal, csiVal, droughtRiskVal, isInvalidForCrop) {
    if (isInvalidForCrop) return 0;
    var ndviScore = Math.min(100, Math.max(0, (ndviVal - 0.1) / 0.7 * 100));
    var healthScore = (ndviScore * 0.3) + (vhiVal * 0.7);
    if (csiVal > 0.6) healthScore = Math.min(healthScore, 30);
    else if (csiVal > 0.4) healthScore = Math.min(healthScore, 50);
    if (droughtRiskVal > 0.6) healthScore = Math.min(healthScore, 55);
    return healthScore;
}

// Safe value extraction helper
function safeGet(obj, key1, key2Sub, defaultVal) {
    try {
        if (!obj || !obj[key1]) return defaultVal;
        var inner = obj[key1];
        if (inner[key2Sub] !== undefined && inner[key2Sub] !== null) return inner[key2Sub];
        var keys = Object.keys(inner);
        for (var k = 0; k < keys.length; k++) {
            var currentKey = keys[k];
            if (currentKey.indexOf(key2Sub) > -1 || currentKey.indexOf('_mean') > -1 || currentKey === 'mean') {
                if (inner[currentKey] !== undefined && inner[currentKey] !== null) return inner[currentKey];
            }
        }
        return defaultVal;
    } catch (e) { return defaultVal; }
}

// DEM globals
var dem = ee.Image('USGS/SRTMGL1_003');
var slope = ee.Terrain.slope(dem);
