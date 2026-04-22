const https = require('https');
const http = require('http');
const querystring = require('querystring');

const PORT = process.env.PORT || 3000;
const DAYFORCE_COMPANY = process.env.DAYFORCE_COMPANY || 'trident';
const DAYFORCE_USER = process.env.DAYFORCE_USER;
const DAYFORCE_PASS = process.env.DAYFORCE_PASS;
const DAYFORCE_TOKEN_URL = 'https://dfidtst.np.dayforcehcm.com/connect/token';
const DAYFORCE_ROOT = `https://test.dayforcehcm.com/api/${DAYFORCE_COMPANY}/V1`;

let cachedToken = null;
let tokenExpiry = 0;
let serviceUri = null;
let serviceUriExpiry = 0;

// Site mapping: org unit XRefCode -> work assignment location XRefCode prefix
const SITE_MAP = {
  'AUSTRALIA_FAIR_SECURITY':                    'SEC_AUSTRALIA_FAIR_SECURITY',
  'ASPLEY_HYPERMARKET_SECURITY':                'SEC_ASPLEY_HYPERMARKET_SECURITY',
  'BROOKSIDE_SHOPPING_CENTRE_SECURITY':         'SEC_BROOKSIDE_SHOPPING_CENTRE_SECURITY',
  'CALAMVALE_CENTRAL_SECURITY':                 'SEC_CALAMVALE_CENTRAL_SECURITY',
  'CANNON_HILL_KMART_PLAZA_SECURITY':           'SEC_CANNON_HILL_KMART_PLAZA_SECURITY',
  'CAPALABA_CENTRAL_SECURITY':                  'SEC_CAPALABA_CENTRAL_SECURITY',
  'CAPALABA_PARK_SHOPPING_CENTRE_SECURITY':     'SEC_CAPALABA_PARK_SHOPPING_CENTRE_SECURITY',
  'CLEVELAND_CENTRAL_SECURITY':                 'SEC_CLEVELAND_CENTRAL_SECURITY',
  'LOGAN_CENTRAL_PLAZA_SECURITY':               'SEC_LOGAN_CENTRAL_PLAZA_SECURITY',
  'MARGATE_VILLAGE_SHOPPING_CENTRE_SECURITY':   'SEC_MARGATE_VILLAGE_SHOPPING_CENTRE_SECURITY',
  'MORAYFIELD_SHOPPING_CENTRE_SECURITY':        'SEC_MORAYFIELD_SHOPPING_CENTRE_SECURITY',
  'NEWMARKET_VILLAGE_SECURITY':                 'SEC_NEWMARKET_VILLAGE_SECURITY',
  'ORION_SPRINGFIELD_CENTRAL_SECURITY':         'SEC_ORION_SPRINGFIELD_CENTRAL_SECURITY',
  'PENINSULA_FAIR_SHOPPING_CENTRE_SECURITY':    'SEC_PENINSULA_FAIR_SHOPPING_CENTRE_SECURITY',
  'RIVERLINK_SHOPPING_CENTRE_SECURITY':         'SEC_RIVERLINK_SHOPPING_CENTRE_SECURITY',
  'SMITH_COLLECTIVE_SECURITY':                  'SEC_SMITH_COLLECTIVE_SECURITY',
  'SUNNYBANK_HILLS_SHOPPINGTOWN_SECURITY':      'SEC_SUNNYBANK_HILLS_SHOPPINGTOWN_SECURITY',
  'SUNNYBANK_PLAZA_SECURITY':                   'SEC_SUNNYBANK_PLAZA_SECURITY',
  'SUNNY_PARK_SHOPPING_CENTRE_SECURITY':        'SEC_SUNNY_PARK_SHOPPING_CENTRE_SECURITY',
  'TOOWONG_VILLAGE_SECURITY':                   'SEC_TOOWONG_VILLAGE_SECURITY',
  'VICTORIA_POINT_SHOPPING_CENTRE_SECURITY':    'SEC_VICTORIA_POINT_SHOPPING_CENTRE_SECURITY',
  'WYNNUM_PLAZA_SECURITY':                      'SEC_WYNNUM_PLAZA_SECURITY',
  'SOUTH_BANK_PARKLANDS_SECURITY':              'SEC_SOUTH_BANK_PARKLANDS_SECURITY',
  'ROMA_STREET_PARKLANDS_SECURITY':             'SEC_ROMA_STREET_PARKLANDS_SECURITY',
};

// Site display names
const SITE_NAMES = {
  'AUSTRALIA_FAIR_SECURITY':                    'Australia Fair',
  'ASPLEY_HYPERMARKET_SECURITY':                'Aspley Hypermarket',
  'BROOKSIDE_SHOPPING_CENTRE_SECURITY':         'Brookside',
  'CALAMVALE_CENTRAL_SECURITY':                 'Calamvale Central',
  'CANNON_HILL_KMART_PLAZA_SECURITY':           'Cannon Hill',
  'CAPALABA_CENTRAL_SECURITY':                  'Capalaba Central',
  'CAPALABA_PARK_SHOPPING_CENTRE_SECURITY':     'Capalaba Park',
  'CLEVELAND_CENTRAL_SECURITY':                 'Cleveland Central',
  'LOGAN_CENTRAL_PLAZA_SECURITY':               'Logan Central',
  'MARGATE_VILLAGE_SHOPPING_CENTRE_SECURITY':   'Margate',
  'MORAYFIELD_SHOPPING_CENTRE_SECURITY':        'Morayfield',
  'NEWMARKET_VILLAGE_SECURITY':                 'Newmarket',
  'ORION_SPRINGFIELD_CENTRAL_SECURITY':         'Orion Springfield',
  'PENINSULA_FAIR_SHOPPING_CENTRE_SECURITY':    'Peninsula Fair',
  'RIVERLINK_SHOPPING_CENTRE_SECURITY':         'Riverlink',
  'SMITH_COLLECTIVE_SECURITY':                  'Smith Collective',
  'SUNNYBANK_HILLS_SHOPPINGTOWN_SECURITY':      'Sunnybank Hills',
  'SUNNYBANK_PLAZA_SECURITY':                   'Sunnybank Plaza',
  'SUNNY_PARK_SHOPPING_CENTRE_SECURITY':        'Sunny Park',
  'TOOWONG_VILLAGE_SECURITY':                   'Toowong Village',
  'VICTORIA_POINT_SHOPPING_CENTRE_SECURITY':    'Victoria Point',
  'WYNNUM_PLAZA_SECURITY':                      'Wynnum Plaza',
  'SOUTH_BANK_PARKLANDS_SECURITY':              'South Bank Parklands',
  'ROMA_STREET_PARKLANDS_SECURITY':             'Roma Street Parklands',
};

// Token
function getToken() {
  return new Promise((resolve, reject) => {
    if (cachedToken && Date.now() < tokenExpiry) return resolve(cachedToken);
    const body = querystring.stringify({
      grant_type: 'password',
      CompanyId: DAYFORCE_COMPANY,
      Username: DAYFORCE_USER,
      Password: DAYFORCE_PASS,
      Client_Id: 'Dayforce.HCMAnywhere.Client',
    });
    const url = new URL(DAYFORCE_TOKEN_URL);
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.access_token) return reject(new Error('No access_token: ' + data));
          cachedToken = json.access_token;
          tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
          resolve(cachedToken);
        } catch (e) { reject(new Error('Token parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// HTTP GET with redirect following
function httpGet(fullUrl, token, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 10) return reject(new Error('Too many redirects'));
    const url = new URL(fullUrl);
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : `https://${url.hostname}${res.headers.location}`;
        res.resume();
        return httpGet(next, token, hops + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Get ServiceUri
async function getServiceUri(token) {
  if (serviceUri && Date.now() < serviceUriExpiry) return serviceUri;
  const result = await httpGet(`${DAYFORCE_ROOT}/ClientMetadata`, token);
  console.log('ClientMetadata:', result.status, JSON.stringify(result.body).substring(0, 200));
  if (result.status === 200 && result.body.ServiceUri) {
    let uri = result.body.ServiceUri.replace(/\/+$/, '');
    if (!uri.includes('/' + DAYFORCE_COMPANY)) uri = uri + '/' + DAYFORCE_COMPANY;
    if (!uri.match(/\/[Vv]\d+$/)) uri = uri + '/V1';
    serviceUri = uri;
    serviceUriExpiry = Date.now() + 23 * 60 * 60 * 1000;
    console.log('ServiceUri resolved:', serviceUri);
    return serviceUri;
  }
  throw new Error(`ClientMetadata failed: ${result.status} ${JSON.stringify(result.body)}`);
}

async function dfGet(path, token) {
  const base = await getServiceUri(token);
  return httpGet(base + path, token);
}

async function dfGetAll(path, token) {
  const base = await getServiceUri(token);
  let allData = [];
  let nextUrl = base + path;
  while (nextUrl) {
    const result = await httpGet(nextUrl, token);
    if (result.status !== 200) return { error: result.body, status: result.status };
    const items = result.body.Data || [];
    allData = allData.concat(Array.isArray(items) ? items : [items]);
    const next = result.body.Paging && result.body.Paging.Next;
    nextUrl = (next && next !== '') ? next : null;
  }
  return { count: allData.length, data: allData };
}

// Job level rank - higher number = higher level
function jobRank(jobXRefCode) {
  if (!jobXRefCode) return 0;
  const j = jobXRefCode.toLowerCase();
  if (j.includes('supervisor')) return 10;
  const m = j.match(/level[_\s](\d+)/);
  return m ? parseInt(m[1]) : 1;
}

// Parse employee data into clean object
function parseEmployee(data) {
  if (!data) return null;
  const d = data.Data || data;

  // Get phone - skip empty contact items
  const contacts = (d.Contacts && d.Contacts.Items) || [];
  const phone = contacts.map(c => c.ContactNumber).filter(Boolean)[0] || null;

  // Get city
  const addresses = (d.Addresses && d.Addresses.Items) || [];
  const city = (addresses[0] && addresses[0].City) || null;

  // Parse work assignments - dedupe by location keeping highest job level
  const waItems = (d.WorkAssignments && d.WorkAssignments.Items) || [];
  const waMap = new Map();
  for (const wa of waItems) {
    const locXRef = wa.Location && wa.Location.XRefCode;
    if (!locXRef) continue;
    const jobXRef = wa.Position && wa.Position.Job && wa.Position.Job.XRefCode;
    const jobName = wa.Position && wa.Position.Job && wa.Position.Job.LongName;
    const isPrimary = wa.IsPrimary || false;
    const locName = wa.Location && wa.Location.LongName;
    if (!waMap.has(locXRef)) {
      waMap.set(locXRef, { locationXRefCode: locXRef, locationName: locName, jobXRefCode: jobXRef, jobName, isPrimary });
    } else {
      const existing = waMap.get(locXRef);
      // Keep highest job level; preserve isPrimary if either is primary
      if (jobRank(jobXRef) > jobRank(existing.jobXRefCode)) {
        waMap.set(locXRef, { locationXRefCode: locXRef, locationName: locName, jobXRefCode: jobXRef, jobName, isPrimary: existing.isPrimary || isPrimary });
      } else if (isPrimary) {
        existing.isPrimary = true;
      }
    }
  }

  const workAssignments = [...waMap.values()];
  const primaryWA = workAssignments.find(wa => wa.isPrimary) || workAssignments[0];

  return {
    xrefCode: d.EmployeeNumber || d.XRefCode,
    employeeNumber: d.EmployeeNumber,
    displayName: d.DisplayName,
    firstName: d.FirstName,
    lastName: d.LastName,
    phone,
    city,
    workAssignments,
    primaryLocation: primaryWA && primaryWA.locationXRefCode,
    primaryJob: primaryWA && primaryWA.jobXRefCode,
    primaryJobName: primaryWA && primaryWA.jobName,
  };
}

// Check if employee is scheduled on a given date
async function isScheduled(xrefCode, date, token) {
  try {
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59`;
    const result = await dfGet(`/Employees/${xrefCode}/Schedules?filterScheduleStartDate=${start}&filterScheduleEndDate=${end}`, token);
    if (result.status === 200) {
      const schedules = (result.body.Data || []);
      return schedules.length > 0;
    }
    return false;
  } catch (e) {
    console.error(`Schedule check failed for ${xrefCode}:`, e.message);
    return false;
  }
}

// Check if employee is on approved leave on a given date
async function isOnLeave(xrefCode, date, token) {
  try {
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59`;
    const result = await dfGet(`/Employees/${xrefCode}/TimeAwayFromWork?filterTAFWStartDate=${start}&filterTAFWEndDate=${end}&Status=APPROVED`, token);
    if (result.status === 200) {
      return (result.body.Data || []).length > 0;
    }
    return false;
  } catch (e) {
    console.error(`Leave check failed for ${xrefCode}:`, e.message);
    return false;
  }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  try {
    // Health
    if (url.pathname === '/health') {
      return json(200, { status: 'ok', time: new Date().toISOString(), serviceUri });
    }

    // Test auth
    if (url.pathname === '/test-auth') {
      const token = await getToken();
      const svc = await getServiceUri(token);
      return json(200, { success: true, serviceUri: svc });
    }

    // List all sites
    if (url.pathname === '/sites') {
      const sites = Object.entries(SITE_NAMES).map(([xrefCode, name]) => ({ xrefCode, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return json(200, { sites });
    }

    // Get all staff for a site (for "who called in sick" dropdown)
    // Usage: /sitestaff?site=AUSTRALIA_FAIR_SECURITY
    if (url.pathname === '/sitestaff') {
      const site = url.searchParams.get('site');
      if (!site || !SITE_MAP[site]) return json(400, { error: 'valid site parameter required' });

      const token = await getToken();
      const locationXRefCode = SITE_MAP[site];

      // Get all employee XRefCodes for this org unit
      const listResult = await dfGetAll(`/Employees?OrgUnitXRefCode=${encodeURIComponent(site)}`, token);
      if (listResult.error) return json(500, { error: 'Failed to get employee list', detail: listResult.error });

      // Fetch each employee's details in parallel (batches of 10)
      const xrefCodes = listResult.data.map(e => e.XRefCode).filter(Boolean);
      const employees = [];

      for (let i = 0; i < xrefCodes.length; i += 10) {
        const batch = xrefCodes.slice(i, i + 10);
        const results = await Promise.all(
          batch.map(xref => dfGet(`/Employees/${xref}?expand=WorkAssignments,Contacts,Addresses&contextDate=${new Date().toISOString().split("T")[0]}`, token))
        );
        for (const r of results) {
          if (r.status === 200 && r.body.Data) {
            const emp = parseEmployee(r.body);
            if (emp && emp.displayName) {
              // Only include if this site is in their work assignments
              const hasThisSite = emp.workAssignments.some(wa => wa.locationXRefCode === locationXRefCode);
              if (hasThisSite) employees.push(emp);
            }
          }
        }
      }

      employees.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
      return json(200, { site, siteName: SITE_NAMES[site], count: employees.length, employees });
    }

    // Get candidates for a shift
    // Usage: /candidates?site=AUSTRALIA_FAIR_SECURITY&date=2026-04-22&absentXRefCode=714&jobXRefCode=SECURITY_SUPERVISOR_LEVEL_3
    if (url.pathname === '/candidates') {
      const site = url.searchParams.get('site');
      const date = url.searchParams.get('date');
      const absentXRefCode = url.searchParams.get('absentXRefCode');
      const jobXRefCode = url.searchParams.get('jobXRefCode');

      if (!site || !SITE_MAP[site]) return json(400, { error: 'valid site parameter required' });
      if (!date) return json(400, { error: 'date parameter required (YYYY-MM-DD)' });

      const token = await getToken();
      const locationXRefCode = SITE_MAP[site];

      // 1. Get all employees for this org unit
      const listResult = await dfGetAll(`/Employees?OrgUnitXRefCode=${encodeURIComponent(site)}`, token);
      if (listResult.error) return json(500, { error: 'Failed to get employee list', detail: listResult.error });

      const xrefCodes = listResult.data.map(e => e.XRefCode).filter(Boolean);

      // 2. Fetch full details for each employee in parallel batches
      const allEmployees = [];
      for (let i = 0; i < xrefCodes.length; i += 10) {
        const batch = xrefCodes.slice(i, i + 10);
        const results = await Promise.all(
          batch.map(xref => dfGet(`/Employees/${xref}?expand=WorkAssignments,Contacts,Addresses&contextDate=${new Date().toISOString().split("T")[0]}`, token))
        );
        for (const r of results) {
          if (r.status === 200 && r.body.Data) {
            const emp = parseEmployee(r.body);
            if (emp && emp.displayName) allEmployees.push(emp);
          }
        }
      }

      // 3. Filter to only those who have this site in their work assignments
      const siteStaff = allEmployees.filter(emp =>
        emp.workAssignments.some(wa => wa.locationXRefCode === locationXRefCode)
      );

      // 4. Remove the absent employee
      const candidates = siteStaff.filter(emp => emp.employeeNumber !== absentXRefCode);

      // 5. Check schedules and leave in parallel
      const availabilityChecks = await Promise.all(
        candidates.map(async emp => {
          const [scheduled, onLeave] = await Promise.all([
            isScheduled(emp.employeeNumber, date, token),
            isOnLeave(emp.employeeNumber, date, token),
          ]);
          return { emp, scheduled, onLeave };
        })
      );

      // 6. Filter out already scheduled or on leave
      const available = availabilityChecks
        .filter(({ scheduled, onLeave }) => !scheduled && !onLeave)
        .map(({ emp }) => emp);

      // 7. Job filtering - get the job required for this site
      // Find what job the absent employee does at this site
      let requiredJob = jobXRefCode;
      if (!requiredJob && absentXRefCode) {
        const absentEmp = allEmployees.find(e => e.employeeNumber === absentXRefCode);
        if (absentEmp) {
          const wa = absentEmp.workAssignments.find(w => w.locationXRefCode === locationXRefCode);
          if (wa) requiredJob = wa.jobXRefCode;
        }
      }

      // 8. Filter and rank by job match
      // Supervisors can cover any role but are deprioritised for non-supervisor roles
      const isSupervisor = (jobXRef) => jobXRef && jobXRef.toLowerCase().includes('supervisor');

      const ranked = available.map(emp => {
        const wa = emp.workAssignments.find(w => w.locationXRefCode === locationXRefCode);
        const empJob = wa && wa.jobXRefCode;
        let jobMatch = 'none';
        if (!requiredJob || empJob === requiredJob) jobMatch = 'exact';
        else if (isSupervisor(empJob) && !isSupervisor(requiredJob)) jobMatch = 'supervisor_covering';
        return { ...emp, empJobAtSite: empJob, empJobNameAtSite: wa && wa.jobName, jobMatch };
      }).filter(emp => emp.jobMatch !== 'none');

      // Sort: exact match first, then supervisors covering, then by name
      ranked.sort((a, b) => {
        const order = { exact: 0, supervisor_covering: 1 };
        const diff = (order[a.jobMatch] || 2) - (order[b.jobMatch] || 2);
        if (diff !== 0) return diff;
        return (a.displayName || '').localeCompare(b.displayName || '');
      });

      return json(200, {
        site,
        siteName: SITE_NAMES[site],
        date,
        requiredJob,
        totalChecked: candidates.length,
        availableCount: ranked.length,
        candidates: ranked,
      });
    }

    // Get single employee details
    if (url.pathname === '/employee') {
      const xrefcode = url.searchParams.get('xrefcode');
      if (!xrefcode) return json(400, { error: 'xrefcode required' });
      const token = await getToken();
      const result = await dfGet(`/Employees/${encodeURIComponent(xrefcode)}?expand=WorkAssignments,Contacts,Addresses,EmploymentStatuses`, token);
      return json(result.status, result.body);
    }

    // Get staff scheduled at a site on a given date (for "who called in sick" dropdown)
    // Usage: /scheduled?site=AUSTRALIA_FAIR_SECURITY&date=2026-04-22
    if (url.pathname === '/scheduled') {
      const site = url.searchParams.get('site');
      const date = url.searchParams.get('date');
      if (!site || !SITE_MAP[site]) return json(400, { error: 'valid site parameter required' });
      if (!date) return json(400, { error: 'date required (YYYY-MM-DD)' });

      const token = await getToken();
      const locationXRefCode = SITE_MAP[site];
      const start = `${date}T00:00:00`;
      const end = `${date}T23:59:59`;

      // Get schedules for this org unit on this date
      const schedResult = await dfGet(
        `/EmployeeSchedules?filterScheduleStartDate=${start}&filterScheduleEndDate=${end}&orgUnitXRefCode=${encodeURIComponent(site)}`,
        token
      );

      if (schedResult.status !== 200) {
        return json(schedResult.status, { error: 'Failed to get schedules', detail: schedResult.body });
      }

      const schedules = schedResult.body.Data || [];
      const scheduledXRefs = [...new Set(schedules.map(s => s.EmployeeXRefCode).filter(Boolean))];

      if (scheduledXRefs.length === 0) {
        return json(200, { site, siteName: SITE_NAMES[site], date, count: 0, employees: [] });
      }

      // Fetch full details for each scheduled employee
      const employees = [];
      for (let i = 0; i < scheduledXRefs.length; i += 10) {
        const batch = scheduledXRefs.slice(i, i + 10);
        const results = await Promise.all(
          batch.map(xref => dfGet(`/Employees/${xref}?expand=WorkAssignments,Contacts,Addresses&contextDate=${new Date().toISOString().split("T")[0]}`, token))
        );
        for (const r of results) {
          if (r.status === 200 && r.body.Data) {
            const emp = parseEmployee(r.body);
            if (emp && emp.displayName) {
              const wa = emp.workAssignments.find(w => w.locationXRefCode === locationXRefCode);
              emp.empJobAtSite = wa && wa.jobXRefCode;
              emp.empJobNameAtSite = wa && wa.jobName;
              employees.push(emp);
            }
          }
        }
      }

      employees.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
      return json(200, { site, siteName: SITE_NAMES[site], date, count: employees.length, employees });
    }

    // Raw org units (debug)
    if (url.pathname === '/orgunits') {
      const token = await getToken();
      const result = await dfGetAll('/OrgUnits', token);
      return json(200, result);
    }

    return json(404, {
      error: 'Not found',
      endpoints: ['/health', '/test-auth', '/sites', '/scheduled?site=XREFCODE&date=YYYY-MM-DD', '/sitestaff?site=XREFCODE', '/candidates?site=XREFCODE&date=YYYY-MM-DD&absentXRefCode=EMP_NUM&jobXRefCode=JOB_XREF', '/employee?xrefcode=CODE']
    });

  } catch (e) {
    console.error('Server error:', e);
    return json(500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Shift server running on port ${PORT}`);
  if (!DAYFORCE_USER || !DAYFORCE_PASS) console.warn('WARNING: DAYFORCE_USER or DAYFORCE_PASS not set');
});
