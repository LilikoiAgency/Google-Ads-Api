/**
 * ptcProcessor.js
 *
 * Pure data-processing functions for Trade Desk Path-to-Conversion CSV files.
 * No DOM, no Plotly calls — all functions take data and return data.
 * Ported from the standalone data-visualizer tool.
 */

// ── Date parsing ───────────────────────────────────────────────────────────────

function parseDate(dateStr, intlDate = false) {
  if (!dateStr) return NaN;
  if (intlDate) {
    // DD/MM/YYYY HH:mm:ss
    const [datePart, timePart] = dateStr.split(" ");
    const [d, m, y] = datePart.split("/").map(Number);
    const [h, min, s] = timePart ? timePart.split(":").map(Number) : [0, 0, 0];
    return new Date(y, m - 1, d, h, min, s).getTime();
  }
  return Date.parse(dateStr);
}

// ── CSV cleanup ────────────────────────────────────────────────────────────────

export function deleteUnusedKeys(dataArray) {
  const keysToDelete = [
    "Event User Hour Of Week", "Event User Hour Of Day", "Event User Day Of Week",
    "Event Type", "Event Temperature Bucket Name", "Event Rendering Context",
    "Event OS Family", "Event OS", "Event Region", "Event Metro Name",
    "Event Creative Name", "Event Country", "Event City", "Event Carrier Name",
    "Event Browser", "Event Ad Format", "Conversion Region",
    "Conversion Monetary Value Currency", "Conversion Metro Name",
    "Conversion Country", "Conversion City",
  ];
  dataArray.forEach((obj) => keysToDelete.forEach((k) => delete obj[k]));
  return dataArray;
}

export function validateFileType(data) {
  return !!(data[0] && "Event Type" in data[0]);
}

// ── URL / subdomain parsing ────────────────────────────────────────────────────

export function getSubDirectoryBreakout(data) {
  data.forEach((e) => {
    const referrerURL = e["Conversion Referrer URL"];
    let subOne = "", subTwo = "";
    if (referrerURL) {
      const q = referrerURL.search(/\?/);
      const end = q === -1 ? referrerURL.length : q;
      const trimmed1 = referrerURL.substring(8, end);
      const slash1 = trimmed1.search("/");
      if (slash1 > 0) {
        const trimmed2 = referrerURL.substring(slash1 + 9, end);
        const slash2 = trimmed2.search("/");
        if (slash2 === -1) {
          subOne = trimmed2.substring(0, trimmed2.length);
        } else {
          const trimmed3 = trimmed2.substring(slash2 + 1);
          const slash3 = trimmed3.search("/");
          subTwo = trimmed3.substring(0, slash3 === -1 ? trimmed3.length : slash3);
          subOne = trimmed2.substring(0, slash2);
        }
      }
      e["Subdomain One"] = subOne;
      e["Subdomain Two"] = subTwo;
      e["Subdomain One + Two"] = subTwo.length > 0 ? `${subOne}/${subTwo}` : subOne;
    }
  });
}

// ── UTM extraction ─────────────────────────────────────────────────────────────

function findAllUTMTypes(data) {
  const types = [];
  data.forEach((row) => {
    for (let i = 0; i < 10; i++) {
      let url = row["Conversion Referrer URL"];
      if (!url) break;
      const start = url.search("utm");
      if (start === -1) break;
      url = url.substr(start);
      const eq = url.search("=");
      const param = url.substr(0, eq);
      if (param && !types.includes(param)) types.push(param);
      if (!param) break;
    }
  });
  return types;
}

function getUTMBreakout(data, parameter) {
  data.forEach((row) => {
    const url = row["Conversion Referrer URL"];
    let value = "";
    if (url) {
      const start = url.search(parameter);
      if (start > 0) {
        const sub = url.substr(start);
        let end = sub.search("&");
        if (end === -1) end = sub.search(/\?/);
        if (end === -1) end = sub.length;
        value = sub.substr(0, end);
      }
    }
    row[parameter] = value;
  });
}

export function addAllUTMData(data) {
  const types = findAllUTMTypes(data);
  types.forEach((t) => getUTMBreakout(data, t));
  return data;
}

// ── Filter helpers ─────────────────────────────────────────────────────────────

export function createUserFilterOptions(data) {
  const breakdowns = {
    "Conversion Tracking Tag Name": {},
    "Event Cross Device Attribution Model": {},
    "Event Campaign Name": {},
  };
  Object.keys(breakdowns).forEach((field) => {
    data.forEach((row) => {
      if (row[field]) breakdowns[field][row[field]] = row[field];
    });
  });
  return breakdowns;
}

function replaceWithHTMLEntities(str) {
  if (!str) return str;
  const map = { "'": "&apos;", "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return String(str).replace(/[&<>"']/g, (c) => map[c] || c);
}

export function filterData(data, filters) {
  if (!filters || Object.keys(filters).length === 0) return data;
  return data.filter((row) => {
    return Object.entries(filters).every(([field, values]) => {
      if (!values || values.length === 0) return true;
      return values.some((v) => v === replaceWithHTMLEntities(row[field]));
    });
  });
}

// ── Core aggregations ──────────────────────────────────────────────────────────

export function createConversionsObject(data, intlDate = false) {
  const obj = {};
  data.forEach((row) => {
    const eventTime = parseDate(row["Event Time UTC"], intlDate);
    const convTime  = parseDate(row["Conversion Time UTC"], intlDate);
    const id = row["Conversion ID"];
    if (!obj[id]) {
      obj[id] = {
        "Impressions on Path": 1,
        "Event Device Type":         { Breakdowns: {}, "Number of X Touched PTC": 0 },
        "Event Site":                { Breakdowns: {}, "Number of X Touched PTC": 0 },
        "Event Campaign Name":       { Breakdowns: {}, "Number of X Touched PTC": 0 },
        "Conversion Tracking Tag Name": { Breakdowns: {}, "Number of X Touched PTC": 0 },
      };
    } else {
      obj[id]["Impressions on Path"]++;
    }

    // Last impression
    if (!obj[id]["Last Impression Data"] ||
        eventTime > parseDate(obj[id]["Last Impression Data"]["Event Time UTC"], intlDate)) {
      obj[id]["Last Impression Data"] = { ...row, "Last Imp to Conversion MS": convTime - eventTime };
    }
    // First impression
    if (!obj[id]["First Impression Data"] ||
        eventTime < parseDate(obj[id]["First Impression Data"]["Event Time UTC"], intlDate)) {
      obj[id]["First Impression Data"] = { ...row, "First Imp to Conversion MS": convTime - eventTime };
    }

    // Unique dimension counts
    ["Event Device Type", "Event Site", "Event Campaign Name", "Conversion Tracking Tag Name"].forEach((dim) => {
      if (!obj[id][dim]["Breakdowns"][row[dim]]) {
        obj[id][dim]["Breakdowns"][row[dim]] = row[dim];
        obj[id][dim]["Number of X Touched PTC"]++;
      }
    });
  });
  return obj;
}

export function createResultsObject(data, breakdown, conversionsObj) {
  const res = {};
  data.forEach((row) => {
    if (!res[row[breakdown]]) {
      res[row[breakdown]] = {
        ConversionIDs: {}, Conversions: 0,
        "Time From Last Imp To Conv": 0, "Time From First Imp To Conv": 0,
        "ConversionIDs-LastImp": {}, "Conversions-LastImp": 0,
        "ConversionIDs-FirstImp": {}, "Conversions-FirstImp": 0,
        "ConversionIDs-MidImp": {}, "Conversions-MidImp": 0,
        Impressions: 0,
      };
    }
  });

  data.forEach((row) => {
    const convId = row["Conversion ID"];
    for (const key in res) {
      if (conversionsObj[convId]?.[breakdown]?.["Breakdowns"]?.[key]) {
        res[key].Impressions++;
        if (!res[key].ConversionIDs[convId]) {
          res[key].ConversionIDs[convId] = 1;
          res[key]["Time From Last Imp To Conv"]  += conversionsObj[convId]["Last Impression Data"]["Last Imp to Conversion MS"];
          res[key]["Time From First Imp To Conv"] += conversionsObj[convId]["First Impression Data"]["First Imp to Conversion MS"];
          res[key].Conversions++;
        }
        if (!res[key]["ConversionIDs-LastImp"][convId]) {
          res[key]["ConversionIDs-LastImp"][convId] = 1;
          if (conversionsObj[convId]["Last Impression Data"][breakdown] === key) res[key]["Conversions-LastImp"]++;
        }
        if (!res[key]["ConversionIDs-FirstImp"][convId]) {
          res[key]["ConversionIDs-FirstImp"][convId] = 1;
          if (conversionsObj[convId]["First Impression Data"][breakdown] === key) res[key]["Conversions-FirstImp"]++;
        }
        if (!res[key]["ConversionIDs-MidImp"][convId]) {
          res[key]["ConversionIDs-MidImp"][convId] = 1;
          if (conversionsObj[convId]["First Impression Data"][breakdown] !== key &&
              conversionsObj[convId]["Last Impression Data"][breakdown] !== key) {
            res[key]["Conversions-MidImp"]++;
          }
        }
      }
    }
  });

  for (const k in res) {
    const r = res[k];
    r["Average Days From Last Imp To Conversion"]  = (r["Time From Last Imp To Conv"]  / r.Conversions) / 86400000;
    r["Average Days From First Imp To Conversion"] = (r["Time From First Imp To Conv"] / r.Conversions) / 86400000;
    r["Impressions per Conversion"] = r.Impressions / r.Conversions;
    r["Percent of Conversions Last Touch"]  = r["Conversions-LastImp"]  / r.Conversions;
    r["Percent of Conversions First Touch"] = r["Conversions-FirstImp"] / r.Conversions;
  }
  return res;
}

function numberOfConversionsWithMultipleGrainsOnPath(conversionsObj, breakdown) {
  return Object.values(conversionsObj).filter(
    (c) => c[breakdown]["Number of X Touched PTC"] > 1
  ).length;
}

export function impressionsByBreakdown(data, breakdown, conversionsObj) {
  const total = Object.values(conversionsObj).length;
  const totalTouched = Object.values(conversionsObj).reduce(
    (s, c) => s + c[breakdown]["Number of X Touched PTC"], 0
  );
  const multiGrain = numberOfConversionsWithMultipleGrainsOnPath(conversionsObj, breakdown);
  const breakdownData = createResultsObject(data, breakdown, conversionsObj);

  function leastStat(stat) {
    let lowest = Infinity, grain = "";
    for (const k in breakdownData) {
      if (k !== "Other" && k !== "" && breakdownData[k][stat] < lowest) {
        lowest = breakdownData[k][stat];
        grain = k;
      }
    }
    return { [grain]: lowest };
  }

  return {
    "Breakdown Data": breakdownData,
    "numConversionsWithMoreThanOneGrain": multiGrain,
    "percentConversionsWithMoreThanOneGrain": multiGrain / total,
    "averageNumberofXTouched": totalTouched / total,
    "Total Conversions": total,
    "Least Impressions per Conversion": leastStat("Impressions per Conversion"),
    "Least Percent of Conversions Last Touch": leastStat("Percent of Conversions Last Touch"),
    "Least Average Days From Last Imp To Conversion": leastStat("Average Days From Last Imp To Conversion"),
  };
}

export function summaryStats(data, conversionsObj) {
  const convArr = Object.values(conversionsObj);
  const users   = new Set(data.map((r) => r["Conversion TDID"])).size;
  const n = convArr.length;
  const totalLastMS  = convArr.reduce((s, c) => s + c["Last Impression Data"]["Last Imp to Conversion MS"], 0);
  const totalFirstMS = convArr.reduce((s, c) => s + c["First Impression Data"]["First Imp to Conversion MS"], 0);
  return {
    "Number of Impressions (on Conversion Paths)": data.length,
    "Number of Conversions":          n,
    "Number of Users":                users,
    "Impressions per Converting User": parseFloat((data.length / users).toFixed(2)),
    "Impressions per Conversion":     parseFloat((data.length / n).toFixed(2)),
    "Conversions per Person":         parseFloat((n / users).toFixed(2)),
    "Avg. Days From First Impression to Conversion": parseFloat(((totalFirstMS / n) / 86400000).toFixed(2)),
    "Avg. Days From Last Impression to Conversion":  parseFloat(((totalLastMS  / n) / 86400000).toFixed(2)),
  };
}

// ── Top-N site results (for site section charts) ───────────────────────────────

export function topNSiteResults(data, conversionsObj, n = 10) {
  const siteCounts = {};
  Object.values(conversionsObj).forEach((c) => {
    Object.values(c["Event Site"]["Breakdowns"]).forEach((site) => {
      siteCounts[site] = (siteCounts[site] || 0) + 1;
    });
  });
  const topSites = Object.entries(siteCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([site]) => site);

  const res = {};
  topSites.forEach((site) => {
    res[site] = {
      ConversionIDs: {}, Conversions: 0,
      "Time From Last Imp To Conv": 0, "Time From First Imp To Conv": 0,
      "ConversionIDs-LastImp": {}, "Conversions-LastImp": 0,
      "ConversionIDs-FirstImp": {}, "Conversions-FirstImp": 0,
      "ConversionIDs-MidImp": {}, "Conversions-MidImp": 0,
      Impressions: 0,
    };
  });

  const breakdown = "Event Site";
  data.forEach((row) => {
    const convId = row["Conversion ID"];
    for (const key in res) {
      if (conversionsObj[convId]?.[breakdown]?.["Breakdowns"]?.[key]) {
        res[key].Impressions++;
        if (!res[key].ConversionIDs[convId]) {
          res[key].ConversionIDs[convId] = 1;
          res[key]["Time From Last Imp To Conv"]  += conversionsObj[convId]["Last Impression Data"]["Last Imp to Conversion MS"];
          res[key]["Time From First Imp To Conv"] += conversionsObj[convId]["First Impression Data"]["First Imp to Conversion MS"];
          res[key].Conversions++;
        }
        if (!res[key]["ConversionIDs-LastImp"][convId]) {
          res[key]["ConversionIDs-LastImp"][convId] = 1;
          if (conversionsObj[convId]["Last Impression Data"][breakdown] === key) res[key]["Conversions-LastImp"]++;
        }
        if (!res[key]["ConversionIDs-FirstImp"][convId]) {
          res[key]["ConversionIDs-FirstImp"][convId] = 1;
          if (conversionsObj[convId]["First Impression Data"][breakdown] === key) res[key]["Conversions-FirstImp"]++;
        }
        if (!res[key]["ConversionIDs-MidImp"][convId]) {
          res[key]["ConversionIDs-MidImp"][convId] = 1;
          if (conversionsObj[convId]["First Impression Data"][breakdown] !== key &&
              conversionsObj[convId]["Last Impression Data"][breakdown] !== key) {
            res[key]["Conversions-MidImp"]++;
          }
        }
      }
    }
  });

  for (const k in res) {
    const r = res[k];
    r["Average Days From Last Imp To Conversion"]  = (r["Time From Last Imp To Conv"]  / r.Conversions) / 86400000;
    r["Average Days From First Imp To Conversion"] = (r["Time From First Imp To Conv"] / r.Conversions) / 86400000;
    r["Impressions per Conversion"] = r.Impressions / r.Conversions;
    r["Percent of Conversions Last Touch"]  = r["Conversions-LastImp"]  / r.Conversions;
    r["Percent of Conversions First Touch"] = r["Conversions-FirstImp"] / r.Conversions;
  }
  return res;
}

// ── Frequency distribution ─────────────────────────────────────────────────────

export function getConversionsByFrequency(data, conversionsObj) {
  const freq = { Overall: {} };
  for (const id in conversionsObj) {
    const f   = conversionsObj[id]["Impressions on Path"];
    const tag = Object.keys(conversionsObj[id]["Conversion Tracking Tag Name"]["Breakdowns"])[0];
    freq.Overall[f] = (freq.Overall[f] || 0) + 1;
    if (!freq[tag]) freq[tag] = {};
    freq[tag][f] = (freq[tag][f] || 0) + 1;
  }
  return freq;
}

// ── TDID / user journey ────────────────────────────────────────────────────────

export function createTDIDObject(data, intlDate = false) {
  const TDIDObject = {};
  const specialTDIDs = {};
  const TDIDsWMultTags = {};

  data.forEach((row) => {
    const convTime  = parseDate(row["Conversion Time UTC"], intlDate);
    const eventTime = parseDate(row["Event Time UTC"], intlDate);
    const tdid = row["Conversion TDID"];
    const convId = row["Conversion ID"];

    if (!TDIDObject[tdid]) {
      TDIDObject[tdid] = {};
      TDIDObject[tdid][convTime] = {
        [convId]: 1,
        "Event Type": "Conversion",
        "Conversion Sub Category": row["Conversion Tracking Tag Name"],
        Device: "", Site: row["Conversion Referrer URL"],
        "Cross Device Vendor": row["Event Cross Device Attribution Model"],
        Campaign: "", "Ad Group": "", Audience: "",
        Time: row["Conversion Time UTC"],
        ...(row["utm_source"] ? { utm_source: row["utm_source"] } : {}),
      };
      TDIDObject[tdid][eventTime] = {
        "Event Type": row["Event Type"],
        "Conversion Sub Category": row["Event Type"],
        Device: row["Event Device Type"], Site: row["Event Site"],
        "Cross Device Vendor": row["Event Cross Device Attribution Model"],
        Campaign: row["Event Campaign Name"],
        "Ad Group": row["Event Ad Group Name"],
        Audience: row["Event Audience Name"],
        Time: row["Event Time UTC"],
      };
      TDIDObject[tdid].uniqueDevices = { [row["Event Device Type"]]: 1 };
      TDIDObject[tdid].numUniqueDevices = 1;
      TDIDObject[tdid].uniqueTrackingTags = { [row["Conversion Tracking Tag Name"]]: 1 };
      TDIDObject[tdid].numTrackingTags = 1;
    } else {
      if (!TDIDObject[tdid][convTime]) {
        TDIDObject[tdid][convTime] = {
          [convId]: 1,
          "Event Type": "Conversion",
          "Conversion Sub Category": row["Conversion Tracking Tag Name"],
          Device: "", Site: row["Conversion Referrer URL"],
          "Cross Device Vendor": row["Event Cross Device Attribution Model"],
          Campaign: "", "Ad Group": "", Audience: "",
          Time: row["Conversion Time UTC"],
          ...(row["utm_source"] ? { utm_source: row["utm_source"] } : {}),
        };
      } else if (!TDIDObject[tdid][convTime][convId]) {
        TDIDObject[tdid][convTime][convId] = 1;
      } else {
        TDIDObject[tdid][convTime][convId]++;
      }
      if (!TDIDObject[tdid][eventTime]) {
        TDIDObject[tdid][eventTime] = {
          "Event Type": row["Event Type"], "Conversion Sub Category": row["Event Type"],
          Device: row["Event Device Type"], Site: row["Event Site"],
          "Cross Device Vendor": row["Event Cross Device Attribution Model"],
          Campaign: row["Event Campaign Name"], "Ad Group": row["Event Ad Group Name"],
          Audience: row["Event Audience Name"], Time: row["Event Time UTC"],
        };
      }
      if (!TDIDObject[tdid].uniqueDevices?.[row["Event Device Type"]]) {
        TDIDObject[tdid].uniqueDevices[row["Event Device Type"]] = 1;
        TDIDObject[tdid].numUniqueDevices++;
        specialTDIDs[tdid] = 1;
      }
      if (!TDIDObject[tdid].uniqueTrackingTags?.[row["Conversion Tracking Tag Name"]]) {
        TDIDObject[tdid].uniqueTrackingTags[row["Conversion Tracking Tag Name"]] = 1;
        TDIDObject[tdid].numTrackingTags++;
        TDIDsWMultTags[tdid] = 1;
      }
    }
  });

  // Sort timestamps per user
  for (const tdid in TDIDObject) {
    const timestamps = Object.keys(TDIDObject[tdid])
      .filter((k) => !isNaN(Number(k)) && Number(k) > 0)
      .sort((a, b) => Number(a) - Number(b));
    TDIDObject[tdid].TimestampOrder = timestamps;
    TDIDObject[tdid]["TimestampOrder Dates"] = timestamps.map((ts) => new Date(Number(ts)));
  }

  return { TDIDObject, specialTDIDs, TDIDsWMultTags };
}

// ── CTV comparison ─────────────────────────────────────────────────────────────

export function createCtvVsNoCtvStats(data, conversionsObj) {
  const deviceResultsObj = createResultsObject(data, "Event Device Type", conversionsObj);
  const ctvConvIds = deviceResultsObj["ConnectedTV"]?.ConversionIDs || {};

  let impressions = 0, conversions = 0, lastMs = 0, firstMs = 0;
  data.forEach((row) => {
    if (row["Event Device Type"] !== "ConnectedTV" && !ctvConvIds[row["Conversion ID"]]) {
      impressions++;
      if (!conversions) {} // counted below per convId
    }
  });

  const noCtvConvIds = {};
  data.forEach((row) => {
    if (row["Event Device Type"] !== "ConnectedTV" && !ctvConvIds[row["Conversion ID"]]) {
      const id = row["Conversion ID"];
      if (!noCtvConvIds[id]) {
        noCtvConvIds[id] = 1;
        conversions++;
        lastMs  += conversionsObj[id]["Last Impression Data"]["Last Imp to Conversion MS"];
        firstMs += conversionsObj[id]["First Impression Data"]["First Imp to Conversion MS"];
      }
    }
  });

  return {
    "Impressions per Conversion": conversions > 0 ? impressions / conversions : 0,
    "Avg. Days From Last Impression to Conversion": conversions > 0 ? (lastMs / conversions) / 86400000 : 0,
    "Number of Conversions": conversions,
    ctvData: deviceResultsObj["ConnectedTV"] || null,
  };
}

// ── UTM parameter analysis ─────────────────────────────────────────────────────

function createTDIDConvPathObj(data, utmParam) {
  const pathPerTDID = {};
  data.forEach((row) => {
    const convTime = Date.parse(row["Conversion Time UTC"]);
    const tdid = row["Conversion TDID"];
    const convId = row["Conversion ID"];

    if (!pathPerTDID[tdid]) {
      pathPerTDID[tdid] = { conversions: {}, timestamps: [convTime] };
      pathPerTDID[tdid][utmParam + "_FirstInstances"] = { [row[utmParam]]: convTime };
    }
    if (!pathPerTDID[tdid].conversions[convId]) {
      pathPerTDID[tdid].conversions[convId] = {
        "Conversion Time UTC": convTime,
        [utmParam]: row[utmParam],
        "Conversion Tracking Tag Name": row["Conversion Tracking Tag Name"],
        "Conversion Monetary Value": row["Conversion Monetary Value"],
        UTMsEarlierOnPath: {},
      };
      pathPerTDID[tdid].timestamps.push(convTime);
      const fi = pathPerTDID[tdid][utmParam + "_FirstInstances"];
      if (!fi[row[utmParam]] || convTime < fi[row[utmParam]]) {
        fi[row[utmParam]] = convTime;
      }
    }
  });
  return pathPerTDID;
}

export function countConvByPRIORUTMParam(data, utmParam) {
  const pathPerTDID = createTDIDConvPathObj(data, utmParam);
  const result = {};

  Object.values(pathPerTDID).forEach((user) => {
    const utmInstances = user[utmParam + "_FirstInstances"];
    Object.entries(user.conversions).forEach(([, conv]) => {
      const tag = conv["Conversion Tracking Tag Name"];
      Object.entries(utmInstances).forEach(([utmVal, firstTs]) => {
        if (firstTs <= conv["Conversion Time UTC"]) {
          if (!result[tag]) result[tag] = {};
          if (!result[tag][utmVal]) result[tag][utmVal] = { conversions: 0, revenue: 0 };
          result[tag][utmVal].conversions++;
          result[tag][utmVal].revenue += conv["Conversion Monetary Value"] || 0;
        }
      });
    });
  });
  return result;
}

// ── LP to Conversion Rate ──────────────────────────────────────────────────────

export function getLPToConversionRateData(TDIDObject, lpPixels, convPixels) {
  if (!lpPixels.length || !convPixels.length) return null;

  const result = { Overall: { "LP Users": 0, "LP And Conversion Users": 0 } };
  const users = Object.keys(TDIDObject).filter((k) => TDIDObject[k].TimestampOrder);

  users.forEach((tdid) => {
    const user = TDIDObject[tdid];
    let lpCount = 0, convCount = 0;
    const devicesOnPath = {};

    user.TimestampOrder.forEach((ts) => {
      const ev = user[ts];
      if (!ev) return;
      const device = ev.Device;
      if (device) {
        devicesOnPath[device] = true;
        if (!result[device]) result[device] = { "LP Users": 0, "LP And Conversion Users": 0 };
      }
      if (lpPixels.includes(ev["Conversion Sub Category"])) lpCount++;
      if (convPixels.includes(ev["Conversion Sub Category"]) && lpCount > 0) convCount++;
    });

    if (lpCount > 0) {
      result.Overall["LP Users"]++;
      Object.keys(devicesOnPath).forEach((d) => result[d]["LP Users"]++);
    }
    if (convCount > 0) {
      result.Overall["LP And Conversion Users"]++;
      Object.keys(devicesOnPath).forEach((d) => result[d]["LP And Conversion Users"]++);
    }
  });

  for (const key in result) {
    result[key]["LP to Conversion Rate"] =
      result[key]["LP Users"] > 0
        ? result[key]["LP And Conversion Users"] / result[key]["LP Users"]
        : 0;
  }
  return result;
}

// ── Full processing pipeline ───────────────────────────────────────────────────

/**
 * processAll — runs the full pipeline on raw CSV data and returns
 * all chart-ready results in one object.
 *
 * @param {object[]} rawData  — parsed CSV rows from PapaParse
 * @param {boolean}  intlDate — true = DD/MM/YYYY format
 * @returns {object}           processedData
 */
export function processAll(rawData, intlDate = false) {
  getSubDirectoryBreakout(rawData);
  deleteUnusedKeys(rawData);
  addAllUTMData(rawData);

  const conversionsObj  = createConversionsObject(rawData, intlDate);
  const summary         = summaryStats(rawData, conversionsObj);
  const deviceResults   = impressionsByBreakdown(rawData, "Event Device Type", conversionsObj);
  const siteResults     = topNSiteResults(rawData, conversionsObj, 10);
  const campaignResults = impressionsByBreakdown(rawData, "Event Campaign Name", conversionsObj);
  const frequencyObj    = getConversionsByFrequency(rawData, conversionsObj);
  const tdidData        = createTDIDObject(rawData, intlDate);
  const utmData         = countConvByPRIORUTMParam(rawData, "utm_source");
  const filterOptions   = createUserFilterOptions(rawData);
  const ctvStats        = createCtvVsNoCtvStats(rawData, conversionsObj);

  // Extract date range from event + conversion timestamps
  let minTs = Infinity, maxTs = -Infinity;
  rawData.forEach((row) => {
    const et = Date.parse(row["Event Time UTC"]);
    const ct = Date.parse(row["Conversion Time UTC"]);
    if (!isNaN(et)) { if (et < minTs) minTs = et; if (et > maxTs) maxTs = et; }
    if (!isNaN(ct)) { if (ct < minTs) minTs = ct; if (ct > maxTs) maxTs = ct; }
  });
  const dateRange = {
    start: isFinite(minTs) ? new Date(minTs).toISOString().slice(0, 10) : null,
    end:   isFinite(maxTs) ? new Date(maxTs).toISOString().slice(0, 10) : null,
  };

  return {
    conversionsObj,
    summary,
    deviceResults,
    siteResults,
    campaignResults,
    frequencyObj,
    tdidData,
    utmData,
    filterOptions,
    ctvStats,
    dateRange,
    totalRows: rawData.length,
  };
}
