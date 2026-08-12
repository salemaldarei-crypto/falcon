/* ══════════════════════════════════════════════
   Falcon Manager — app.js v4
   + Firebase Firestore sync
   + i18n (ar / en / ur / bn)
   + Mobile bottom nav
   + Responsive helpers
   ══════════════════════════════════════════════

   HIERARCHY:
     admin         → all farms, full control
     farm_manager  → their farm ONLY (falcons, logs, employees)
     employee      → their farm ONLY (view + daily log)
   ══════════════════════════════════════════════ */
'use strict';

/* ══════════════════════════════════════════════
   FIREBASE CONFIG
   ⚠️  Replace these placeholder values with YOUR
       project config from:
       console.firebase.google.com → Project Settings → General → SDK setup
   ══════════════════════════════════════════════ */
const FIREBASE_CONFIG = {
    apiKey            : "AIzaSyDK2Suff8TVQgVVkTsLIwkSotATVDgpkZI",
    authDomain        : "falcon-e6666.firebaseapp.com",
    projectId         : "falcon-e6666",
    storageBucket     : "falcon-e6666.firebasestorage.app",
    messagingSenderId : "1082133296667",
    appId             : "1:1082133296667:web:a0910d34c69eed74bf2abe",
    measurementId     : "G-Y6JN158SEH"
};

/* Whether Firebase was initialised successfully */
let FIREBASE_READY = false;
let fireDb         = null;   // Firestore instance
let UNSUBSCRIBERS  = [];     // Firestore real-time listeners

/* ══════════════════════════════════════════════
   LOCAL STORAGE KEYS (fallback + session)
   ══════════════════════════════════════════════ */
const SK = {
    farms  : 'ns_farms',
    falcons: 'ns_falcons',
    logs   : 'ns_logs',
    users  : 'ns_users',
    session: 'ns_session'
};

/* ══════════════════════════════════════════════
   IN-MEMORY DB
   ══════════════════════════════════════════════ */
let DB = {
    farms  : load(SK.farms,   []),
    falcons: load(SK.falcons, []),
    logs   : load(SK.logs,    []),
    users  : load(SK.users,   null)
};

let SESSION = {
    user         : null,
    adminFarmTab : null,
    editFalconId : null,
    editPhotoUrl : undefined,
    pendingPhoto : null
};

/* ══════════════════════════════════════════════
   PERMISSIONS
   ══════════════════════════════════════════════ */
function can(action) {
    const r = SESSION.user?.role;
    if (!r) return false;
    const P = {
        admin       : ['all'],
        farm_manager: [
            'view_farm','add_falcon','edit_falcon','delete_falcon',
            'daily_log','edit_log','delete_log',
            'add_employee','edit_employee','delete_employee','change_employee_pwd',
            'export','view_stats'
        ],
        employee    : ['view_farm','daily_log','view_stats']
    };
    return P[r]?.includes('all') || P[r]?.includes(action) || false;
}

/* ══════════════════════════════════════════════
   SCOPING
   ══════════════════════════════════════════════ */
function myFarmId()      { const u=SESSION.user; if(!u) return null; if(u.role==='admin') return SESSION.adminFarmTab; return u.farmId||null; }
function scopedFalcons() { const fid=myFarmId(); if(fid===null&&SESSION.user?.role==='admin') return DB.falcons; return DB.falcons.filter(f=>f.farmId===fid); }
function scopedLogs()    { const ids=new Set(scopedFalcons().map(f=>f.id)); return DB.logs.filter(l=>ids.has(l.falconId)); }
function scopedUsers()   { const u=SESSION.user; if(!u) return []; if(u.role==='admin') return DB.users; if(u.role==='farm_manager') return DB.users.filter(x=>x.farmId===u.farmId); return [u]; }

/* ══════════════════════════════════════════════
   BOOTSTRAP — default admin user
   ══════════════════════════════════════════════ */
function bootstrap() {
    if (!DB.users) {
        DB.users = [{
            id: 'u_admin', username: 'admin',
            displayName: 'المدير الرئيسي',
            password: simpleHash('admin123'),
            role: 'admin', farmId: null, createdAt: now()
        }];
        persist(SK.users, DB.users);
    }
}

/* ══════════════════════════════════════════════
   SIMPLE HASH (demo only — not for production auth)
   ══════════════════════════════════════════════ */
function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    return 'h' + Math.abs(h).toString(16);
}
const hash = simpleHash;

/* ══════════════════════════════════════════════
   FIREBASE INIT + SYNC
   ══════════════════════════════════════════════ */
function initFirebase() {
    if (FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
        console.warn('[Falcon] Firebase not configured — using localStorage only.');
        showFirebaseNotice();
        return;
    }
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        fireDb = firebase.firestore();
        FIREBASE_READY = true;
        console.log('[Falcon] Firebase connected ✓');
    } catch (e) {
        console.error('[Falcon] Firebase init failed:', e);
        showFirebaseNotice();
    }
}

function showFirebaseNotice() {
    const notice = document.createElement('div');
    notice.className = 'firebase-notice';
    notice.innerHTML = `
        ⚠️ <div>
            <strong>Firebase غير مُهيَّأ</strong> — البيانات تُحفظ محلياً فقط.
            لتفعيل الحفظ السحابي، أضف بيانات مشروعك في
            <code>FIREBASE_CONFIG</code> داخل <em>app.js</em>.
            (<a href="https://console.firebase.google.com" target="_blank">console.firebase.google.com</a>)
        </div>`;
    document.getElementById('appRoot')?.prepend(notice);
}

/* ── Firestore helpers ── */
function fsCol(name)     { return fireDb?.collection(name); }
function fsDoc(col, id)  { return fireDb?.collection(col).doc(id); }

/** Save one document to Firestore, also persist locally */
async function fsSave(col, id, data) {
    persist(SK[col], DB[col]);           // always local first
    if (!FIREBASE_READY) return;
    try { await fsDoc(col, id).set(data, { merge: true }); }
    catch (e) { console.warn('[Falcon] Firestore write failed:', e); }
}

/** Delete one document from Firestore */
async function fsDel(col, id) {
    if (!FIREBASE_READY) return;
    try { await fsDoc(col, id).delete(); }
    catch (e) { console.warn('[Falcon] Firestore delete failed:', e); }
}

/**
 * Subscribe to a Firestore collection.
 * On first snapshot, replaces the local array entirely.
 */
function fsListen(col, onUpdate) {
    if (!FIREBASE_READY) return;
    const unsub = fsCol(col).onSnapshot(snap => {
        const items = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        DB[col] = items;
        persist(SK[col], items);
        onUpdate(items);
    }, err => {
        console.warn(`[Falcon] Firestore listen (${col}) failed:`, err);
    });
    UNSUBSCRIBERS.push(unsub);
}

function startFirestoreListeners() {
    if (!FIREBASE_READY || !SESSION.user) return;
    stopFirestoreListeners();
    toast(t('toast.syncing'), 'info');

    fsListen('farms',   () => { applyRoleUI(); renderAll(); });
    fsListen('falcons', () => renderAll());
    fsListen('logs',    () => renderAll());
    fsListen('users',   () => { applyRoleUI(); renderUsersTable(); });
}

function stopFirestoreListeners() {
    UNSUBSCRIBERS.forEach(u => u());
    UNSUBSCRIBERS = [];
}

function renderAll() {
    refreshAll();
}

/* ══════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
    bootstrap();

    // Hide loading screen
    setTimeout(() => {
        document.getElementById('loadingScreen').style.display = 'none';
        restoreSession();
    }, 700);

    setupLogin();
    setupNav();
    setupFalconForm();
    setupEditFalconModal();
    setupDailyForm();
    setupSearch();
    setupExport();
    setupFarmModal();
    setupUserModal();
    setupPwdModal();
    setupEditLogModal();
    setupMenuToggle();
    setupSidebarOverlay();
    setupMobileNav();
    setDates();

    // Expose globals i18n needs
    window.SESSION    = SESSION;
    window.refreshAll = refreshAll;
    window.applyRoleUI= applyRoleUI;
});

/* ══════════════════════════════════════════════
   SESSION
   ══════════════════════════════════════════════ */
function restoreSession() {
    const s = localStorage.getItem(SK.session);
    if (!s) return showLogin();
    const uid2 = JSON.parse(s).uid;
    const u = DB.users?.find(x => x.id === uid2);
    if (u) { SESSION.user = u; showApp(); }
    else showLogin();
}

function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('mobileNavBar').style.display = 'none';
    applyTranslations?.();
}

function showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appRoot').style.display = 'flex';
    document.getElementById('mobileNavBar').style.display = 'block';
    applyRoleUI();
    refreshAll();
    startFirestoreListeners();
}

function logout() {
    stopFirestoreListeners();
    SESSION.user = null;
    SESSION.adminFarmTab = null;
    localStorage.removeItem(SK.session);
    showLogin();
    ['loginUser','loginPass'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    document.getElementById('loginError').textContent = '';
}

/* ══════════════════════════════════════════════
   LOGIN FORM
   ══════════════════════════════════════════════ */
function setupLogin() {
    const form  = document.getElementById('loginForm');
    const errEl = document.getElementById('loginError');
    const toggle= document.getElementById('togglePass');
    const passEl= document.getElementById('loginPass');

    toggle.addEventListener('click', () => {
        passEl.type = passEl.type === 'password' ? 'text' : 'password';
        toggle.querySelector('svg').style.opacity = passEl.type === 'text' ? '0.5' : '1';
    });

    form.addEventListener('submit', e => {
        e.preventDefault();
        errEl.textContent = '';
        const username = gv('loginUser').toLowerCase();
        const password = document.getElementById('loginPass').value;
        const user = DB.users?.find(u => u.username.toLowerCase() === username && u.password === hash(password));
        if (!user) {
            errEl.textContent = t('toast.login_err');
            form.style.animation = 'none';
            void form.offsetWidth;
            form.style.animation = 'shake .4s ease';
            return;
        }
        SESSION.user = user;
        localStorage.setItem(SK.session, JSON.stringify({ uid: user.id }));
        showApp();
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        if (confirm(t('confirm.logout'))) logout();
    });
}

/* Shake animation */
const shk = document.createElement('style');
shk.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}`;
document.head.appendChild(shk);

/* ══════════════════════════════════════════════
   ROLE UI
   ══════════════════════════════════════════════ */
function applyRoleUI() {
    const u = SESSION.user;
    if (!u) return;

    // Roles map (i18n)
    const roleLabel = { admin: t('role.admin'), farm_manager: t('role.farm_manager'), employee: t('role.employee') };

    document.getElementById('sbUserName').textContent = u.displayName;
    document.getElementById('sbUserRole').textContent = roleLabel[u.role] || u.role;
    document.getElementById('sbAvatar').textContent   = u.displayName.charAt(0);

    // Farm label (non-admin)
    const farmLabel  = document.getElementById('sbFarmLabel');
    const farmNameEl = document.getElementById('sbFarmName');
    if (u.role !== 'admin' && u.farmId) {
        const farm = DB.farms.find(f => f.id === u.farmId);
        if (farm) { farmNameEl.textContent = farm.name; farmLabel.style.display = 'flex'; }
    } else {
        farmLabel.style.display = 'none';
    }

    // Sidebar management link + badge
    document.getElementById('navManagement').style.display = (can('view_farm') || u.role === 'admin') ? '' : 'none';
    document.getElementById('farmsBadge').textContent = DB.farms.length;

    // Mobile nav management link
    const mNavMgmt = document.getElementById('mNavManagement');
    if (mNavMgmt) mNavMgmt.style.display = (can('view_farm') || u.role === 'admin') ? '' : 'none';

    // Farm tabs (admin only)
    document.getElementById('farmTabsRow').style.display = u.role === 'admin' ? '' : 'none';

    // Falcon form
    document.getElementById('addFalconPanel').style.display = can('add_falcon') ? '' : 'none';

    // Export / delete all
    const expBtn = document.getElementById('exportBtn');
    const delBtn = document.getElementById('clearAllBtn');
    if (expBtn) expBtn.style.display = can('export') ? '' : 'none';
    if (delBtn) delBtn.style.display = u.role === 'admin' ? '' : 'none';

    // Farms section in management
    document.getElementById('farmsSection').style.display = u.role === 'admin' ? '' : 'none';
    document.getElementById('usersSectionTitle').textContent =
        u.role === 'farm_manager' ? t('mgmt.farm_employees') : t('mgmt.users');

    // Farm manager role option visibility
    const optFM = document.getElementById('optFarmManager');
    if (optFM) optFM.style.display = u.role === 'admin' ? '' : 'none';
}

/* ══════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════ */
function setupNav() {
    document.querySelectorAll('.sb-link').forEach(btn => {
        btn.addEventListener('click', () => goPage(btn.dataset.page));
    });
}

function goPage(page) {
    // Sidebar links
    document.querySelectorAll('.sb-link').forEach(b =>
        b.classList.toggle('active', b.dataset.page === page));

    // Mobile nav links
    document.querySelectorAll('.mnb-link').forEach(b =>
        b.classList.toggle('active', b.dataset.page === page));

    // Pages
    document.querySelectorAll('.page').forEach(p =>
        p.classList.toggle('active', p.id === 'page' + cap(page)));

    // Breadcrumb (i18n)
    const breadcrumbKey = { dashboard:'nav.dashboard', falcons:'nav.falcons', daily:'nav.daily', management:'nav.management' };
    document.getElementById('topbarBreadcrumb').textContent = t(breadcrumbKey[page] || 'nav.dashboard');

    // Close sidebar on mobile
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sbOverlay').classList.remove('visible');

    if (page === 'dashboard')  { renderFarmTabs(); renderDashboard(); }
    if (page === 'falcons')    renderTable();
    if (page === 'daily')      { refreshDailySelect(); renderLogs(); }
    if (page === 'management') { renderFarmsGrid(); renderUsersTable(); }
}

/* ══════════════════════════════════════════════
   MOBILE BOTTOM NAV
   ══════════════════════════════════════════════ */
function setupMobileNav() {
    document.querySelectorAll('.mnb-link').forEach(btn => {
        btn.addEventListener('click', () => goPage(btn.dataset.page));
    });
}

/* ══════════════════════════════════════════════
   MENU TOGGLE + SIDEBAR OVERLAY
   ══════════════════════════════════════════════ */
function setupMenuToggle() {
    document.getElementById('menuToggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sbOverlay').classList.toggle('visible');
    });
}

function setupSidebarOverlay() {
    document.getElementById('sbOverlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sbOverlay').classList.remove('visible');
    });
}

/* ══════════════════════════════════════════════
   DATES
   ══════════════════════════════════════════════ */
function setDates() {
    const d = new Date().toLocaleDateString('ar-SA', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const en = new Date().toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const tbDate = document.getElementById('tbDate');
    if (tbDate) tbDate.textContent = currentLang === 'en' ? en : d;
    const dd = document.getElementById('dailyDate');
    if (dd) dd.value = today();
}

const today = () => new Date().toISOString().split('T')[0];
const now   = () => new Date().toISOString();
const cap   = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ══════════════════════════════════════════════
   AGE
   ══════════════════════════════════════════════ */
function fmtAge(bd) {
    if (!bd) return '—';
    const b = new Date(bd), n = new Date();
    let y = n.getFullYear()-b.getFullYear(), m = n.getMonth()-b.getMonth();
    if (m<0){y--;m+=12;}
    // Return according to language
    if (currentLang === 'en') {
        if (y===0) return `${m}mo`;
        if (m===0) return `${y}yr`;
        return `${y}yr ${m}mo`;
    }
    if (y===0) return `${m} شهر`;
    if (m===0) return `${y} سنة`;
    return `${y} سنة ${m} شهر`;
}

/* ══════════════════════════════════════════════
   PHOTO UPLOAD
   ══════════════════════════════════════════════ */
function wirePhotoZone(fileId, previewId, idleId, removeId, onUrl) {
    const fi = document.getElementById(fileId);
    const pv = document.getElementById(previewId);
    const id = document.getElementById(idleId);
    const rm = document.getElementById(removeId);
    if (!fi) return;
    fi.addEventListener('change', () => {
        const f = fi.files[0]; if (!f) return;
        const fr = new FileReader();
        fr.onload = e => {
            pv.src=e.target.result; pv.style.display='block';
            id.style.display='none'; rm.style.display='flex';
            if (onUrl) onUrl(e.target.result);
        };
        fr.readAsDataURL(f);
    });
    rm.addEventListener('click', e => {
        e.stopPropagation(); fi.value='';
        pv.src=''; pv.style.display='none';
        id.style.display='flex'; rm.style.display='none';
        if (onUrl) onUrl(null);
    });
}

function setPhotoZone(previewId, idleId, removeId, url) {
    const pv=document.getElementById(previewId), id=document.getElementById(idleId), rm=document.getElementById(removeId);
    if (url) { pv.src=url; pv.style.display='block'; id.style.display='none'; rm.style.display='flex'; }
    else     { pv.src=''; pv.style.display='none'; id.style.display='flex'; rm.style.display='none'; }
}

/* ══════════════════════════════════════════════
   FALCON FORM
   ══════════════════════════════════════════════ */
function setupFalconForm() {
    wirePhotoZone('falconPhoto','pzPreview','pzIdle','pzRemove', u => { SESSION.pendingPhoto = u; });

    document.getElementById('falconBirthdate').addEventListener('change', e => {
        document.getElementById('ageDisplay').textContent = e.target.value
            ? `${t('fc.age_lbl')}: ${fmtAge(e.target.value)}`
            : t('falcon.age_auto');
    });

    document.getElementById('falconFormToggle').addEventListener('click', () => {
        const body = document.getElementById('falconForm');
        const collapsed = body.style.display === 'none';
        body.style.display = collapsed ? '' : 'none';
        document.getElementById('falconFormToggle').classList.toggle('collapsed', !collapsed);
    });

    document.getElementById('resetFalconBtn').addEventListener('click', () => {
        document.getElementById('falconForm').reset();
        document.getElementById('ageDisplay').textContent = t('falcon.age_auto');
        SESSION.pendingPhoto = null;
        setPhotoZone('pzPreview','pzIdle','pzRemove', null);
    });

    document.getElementById('falconForm').addEventListener('submit', async e => {
        e.preventDefault();
        if (!can('add_falcon')) { toast(t('toast.no_perm'), 'err'); return; }

        // Resolve farmId
        let farmId = SESSION.user.farmId;
        if (SESSION.user.role === 'admin') {
            farmId = SESSION.adminFarmTab;
            if (!farmId) {
                if (DB.farms.length === 0) { toast(t('toast.create_farm'), 'warn'); return; }
                toast(t('toast.sel_farm_tab'), 'warn'); return;
            }
        }
        if (!farmId) { toast(t('toast.no_farm'), 'warn'); return; }

        const falcon = {
            id        : uid(), farmId,
            name      : gv('falconName'),
            ringNumber: gv('falconRingNumber'),
            type      : gv('falconType'),
            weight    : gn('falconWeight'),
            birthdate : gv('falconBirthdate') || null,
            father    : gv('falconFather'),
            mother    : gv('falconMother'),
            gender    : gv('falconGender') || '',
            health    : gv('healthStatus'),
            notes     : gv('falconNotes'),
            photo     : SESSION.pendingPhoto || null,
            createdAt : now(), createdBy: SESSION.user.id
        };

        DB.falcons.unshift(falcon);
        saveFalcons();
        await fsSave('falcons', falcon.id, falcon);

        refreshAll();
        e.target.reset();
        document.getElementById('ageDisplay').textContent = t('falcon.age_auto');
        SESSION.pendingPhoto = null;
        setPhotoZone('pzPreview','pzIdle','pzRemove', null);
        toast(t('toast.falcon_added', falcon.name), 'ok');
    });
}

/* ══════════════════════════════════════════════
   TABLE
   ══════════════════════════════════════════════ */
function healthPillClass(h) {
    if (!h) return '';
    // Match regardless of language (stored values)
    const map = {
        'ممتازة':'pill-ok','excellent':'pill-ok','بہترین':'pill-ok','চমৎকার':'pill-ok',
        'جيدة':'pill-good','good':'pill-good','اچھی':'pill-good','ভালো':'pill-good',
        'متوسطة':'pill-mid','average':'pill-mid','اوسط':'pill-mid','মাঝারি':'pill-mid',
        'تحت العلاج':'pill-bad','under treatment':'pill-bad','علاج جاری':'pill-bad','চিকিৎসাধীন':'pill-bad',
    };
    return map[h.toLowerCase()] || map[h] || '';
}

function renderTable(data) {
    const rows  = data ?? scopedFalcons();
    const tbody = document.getElementById('falconsBody');
    const empty = document.getElementById('tableEmpty');

    document.getElementById('tbFalcons').textContent = scopedFalcons().length;
    tbody.innerHTML = '';

    if (rows.length === 0) { empty.style.display='block'; return; }
    empty.style.display = 'none';

    rows.forEach((f, i) => {
        const lw      = latestW(f.id) ?? f.weight;
        const parents = [f.father, f.mother].filter(Boolean).join(' / ') || '—';
        const farm    = DB.farms.find(x => x.id === f.farmId);
        const hCls    = healthPillClass(f.health);
        const thumb   = f.photo
            ? `<img class="tbl-thumb" src="${f.photo}" alt="">`
            : `<span class="tbl-thumb-ph">🦅</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color:var(--t3);font-weight:700">${i+1}</td>
            <td>${thumb}</td>
            <td>
                <div style="font-weight:800">${esc(f.name)}</div>
                ${farm && SESSION.user.role==='admin'
                    ? `<div style="font-size:.68rem;color:var(--t3);margin-top:.1rem">🌿 ${esc(farm.name)}</div>` : ''}
            </td>
            <td><span class="ring-code">${esc(f.ringNumber || '—')}</span></td>
            <td><span class="pill pill-type">${esc(f.type)}</span></td>
            <td style="font-size:.78rem">${fmtAge(f.birthdate)}</td>
            <td><strong style="color:var(--g200)">${lw.toLocaleString()}</strong> <span style="font-size:.72rem;color:var(--t2)">${t('unit.g')}</span></td>
            <td style="font-size:.76rem;color:var(--t2)">${esc(parents)}</td>
            <td><span class="pill ${hCls}">${esc(f.health)}</span></td>
            <td>
                <div class="row-acts">
                    <button class="act-btn daily" title="${t('fc.log_btn')}" onclick="quickDaily('${f.id}')">📅</button>
                    ${can('edit_falcon') ? `<button class="act-btn edit" title="${t('fc.edit_btn')}" onclick="openEditFalcon('${f.id}')">✏️</button>` : ''}
                    ${can('delete_falcon') ? `<button class="act-btn del" title="🗑️" onclick="deleteFalcon('${f.id}')">🗑️</button>` : ''}
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

function quickDaily(fid) {
    goPage('daily');
    setTimeout(() => {
        const s = document.getElementById('dailyFalconId');
        if (s) { s.value = fid; updateWeightHint(); showFalconPreview(fid); }
    }, 60);
}

/* ══════════════════════════════════════════════
   EDIT FALCON MODAL
   ══════════════════════════════════════════════ */
function setupEditFalconModal() {
    document.getElementById('editFalconModal').addEventListener('click', e => {
        if (e.target.id === 'editFalconModal') closeModal('editFalconModal');
    });
    document.getElementById('editBirthdate').addEventListener('change', e => {
        document.getElementById('editAgeHint').textContent = e.target.value ? fmtAge(e.target.value) : '';
    });
    wirePhotoZone('editFalconPhoto','editPzPreview','editPzIdle','editPzRemove', u => { SESSION.editPhotoUrl = u; });

    document.getElementById('editFalconForm').addEventListener('submit', async e => {
        e.preventDefault();
        if (!can('edit_falcon')) { toast(t('toast.no_perm'), 'err'); return; }
        const idx = DB.falcons.findIndex(f => f.id === SESSION.editFalconId);
        if (idx === -1) return;
        const photo = SESSION.editPhotoUrl !== undefined ? SESSION.editPhotoUrl : DB.falcons[idx].photo;
        const updated = {
            ...DB.falcons[idx],
            name: gv('editName'), ringNumber: gv('editRingNumber'),
            type: gv('editType'), weight: gn('editWeight'),
            birthdate: gv('editBirthdate')||null, father: gv('editFather'),
            mother: gv('editMother'), gender: gv('editGender')||'',
            health: gv('editHealth'), notes: gv('editNotes'), photo,
            updatedAt: now()
        };
        DB.falcons[idx] = updated;
        saveFalcons();
        await fsSave('falcons', updated.id, updated);
        refreshAll(); closeModal('editFalconModal');
        toast(t('toast.falcon_updated'), 'ok');
    });
}

function openEditFalcon(id) {
    if (!can('edit_falcon')) { toast(t('toast.no_perm'), 'err'); return; }
    const f = DB.falcons.find(x => x.id === id); if (!f) return;
    SESSION.editFalconId = id; SESSION.editPhotoUrl = undefined;
    sv('editFalconId',id); sv('editName',f.name); sv('editRingNumber',f.ringNumber||'');
    sv('editType',f.type); sv('editWeight',f.weight);
    sv('editBirthdate',f.birthdate||''); sv('editFather',f.father||'');
    sv('editMother',f.mother||''); sv('editGender',f.gender||'');
    sv('editHealth',f.health); sv('editNotes',f.notes||'');
    document.getElementById('editAgeHint').textContent = f.birthdate ? fmtAge(f.birthdate) : '';
    document.getElementById('editFalconPhoto').value = '';
    setPhotoZone('editPzPreview','editPzIdle','editPzRemove', f.photo||null);
    openModal('editFalconModal');
}

/* ══════════════════════════════════════════════
   DELETE FALCON
   ══════════════════════════════════════════════ */
async function deleteFalcon(id) {
    if (!can('delete_falcon')) { toast(t('toast.no_perm'), 'err'); return; }
    const f = DB.falcons.find(x => x.id === id); if (!f) return;
    if (!confirm(t('confirm.del_falcon', f.name))) return;
    DB.falcons = DB.falcons.filter(x => x.id !== id);
    DB.logs    = DB.logs.filter(l => l.falconId !== id);
    saveFalcons(); saveLogs();
    await fsDel('falcons', id);
    refreshAll();
    toast(t('toast.falcon_deleted', f.name), 'err');
}

/* ══════════════════════════════════════════════
   SEARCH
   ══════════════════════════════════════════════ */
function setupSearch() {
    document.getElementById('searchInput').addEventListener('input', debounce(() => {
        const q = document.getElementById('searchInput').value.toLowerCase().trim();
        if (!q) { renderTable(); return; }
        renderTable(scopedFalcons().filter(f =>
            f.name.toLowerCase().includes(q) ||
            (f.ringNumber && f.ringNumber.toLowerCase().includes(q)) ||
            f.type.toLowerCase().includes(q) ||
            (f.father && f.father.toLowerCase().includes(q)) ||
            (f.mother && f.mother.toLowerCase().includes(q))
        ));
    }, 250));
}

/* ══════════════════════════════════════════════
   DAILY FORM
   ══════════════════════════════════════════════ */
function setupDailyForm() {
    document.getElementById('dailyFalconId').addEventListener('change', () => {
        updateWeightHint(); showFalconPreview(gv('dailyFalconId'));
    });
    document.getElementById('dailyWeight').addEventListener('input', updateWeightHint);

    document.getElementById('dailyForm').addEventListener('submit', async e => {
        e.preventDefault();
        if (!can('daily_log')) { toast(t('toast.no_perm'), 'err'); return; }
        const fid = gv('dailyFalconId');
        if (!fid) { toast(t('toast.sel_falcon'), 'warn'); return; }

        const entry = {
            id       : uid(), falconId: fid,
            date     : gv('dailyDate') || today(),
            weight   : gn('dailyWeight') || null,
            foodType : gv('dailyFoodType') || null,
            foodAmt  : gn('dailyFoodAmount') || null,
            trainType: gv('dailyTrainType') || null,
            distance : parseFloat(document.getElementById('dailyDistance').value) || null,
            duration : gn('dailyDuration') || null,
            notes    : gv('dailyNotes'),
            createdAt: now(), createdBy: SESSION.user.id
        };
        DB.logs.unshift(entry);
        saveLogs();
        await fsSave('logs', entry.id, entry);

        const f = DB.falcons.find(x => x.id === fid);
        toast(t('toast.log_saved', f?.name || ''), 'ok');

        const selId = gv('dailyFalconId'), selDate = gv('dailyDate');
        e.target.reset();
        sv('dailyFalconId', selId); sv('dailyDate', selDate);
        document.getElementById('weightDiff').textContent = '';
        showFalconPreview(selId);
        renderDashboard(); renderLogs(); updateTopBadges();
    });
}

function resetDailyForm() {
    document.getElementById('dailyForm').reset();
    document.getElementById('weightDiff').textContent = '';
    document.getElementById('falconPreviewCard').style.display = 'none';
    refreshDailySelect();
}

function showFalconPreview(fid) {
    const card = document.getElementById('falconPreviewCard');
    if (!fid) { card.style.display = 'none'; return; }
    const f = DB.falcons.find(x => x.id === fid);
    if (!f) { card.style.display = 'none'; return; }

    const photoEl = document.getElementById('fpcPhoto');
    const phEl    = document.getElementById('fpcPh');
    if (f.photo) { photoEl.src=f.photo; photoEl.style.display='block'; phEl.style.display='none'; }
    else         { photoEl.style.display='none'; phEl.style.display='flex'; }
    document.getElementById('fpcName').textContent    = f.name;
    document.getElementById('fpcDetails').textContent = `${f.type} · ${fmtAge(f.birthdate)} · ${f.health}`;
    const ring = document.getElementById('fpcRing');
    ring.textContent   = f.ringNumber ? `💍 ${f.ringNumber}` : '';
    ring.style.display = f.ringNumber ? 'block' : 'none';
    card.style.display = 'flex';
}

function refreshDailySelect() {
    const sel  = document.getElementById('dailyFalconId');
    const flt  = document.getElementById('logFilterFalcon');
    const prev = sel.value;
    sel.innerHTML = `<option value="">${t('daily.select_ph')}</option>`;
    flt.innerHTML = `<option value="">${t('daily.filter_all')}</option>`;
    scopedFalcons().forEach(f => {
        const ring = f.ringNumber ? ` [${f.ringNumber}]` : '';
        sel.innerHTML += `<option value="${f.id}">${esc(f.name)}${ring}</option>`;
        flt.innerHTML += `<option value="${f.id}">${esc(f.name)}</option>`;
    });
    if (prev) sel.value = prev;
    document.getElementById('logFilterFalcon').addEventListener('change', renderLogs);
    updateWeightHint();
}

function updateWeightHint() {
    const fid = gv('dailyFalconId'), newW = gn('dailyWeight');
    const el  = document.getElementById('weightDiff');
    if (!fid || !newW) { el.textContent = ''; return; }
    const lw   = latestW(fid);
    const base = lw !== null ? lw : (DB.falcons.find(x=>x.id===fid)?.weight||null);
    if (!base) { el.textContent = ''; return; }
    const d = newW - base;
    el.textContent = `${d>0?'▲ +':d<0?'▼ ':'= '}${d} ${t('unit.g')}`;
    el.style.color = d>0?'var(--err)':d<0?'var(--ok)':'var(--t2)';
}

/* ══════════════════════════════════════════════
   LOGS LIST
   ══════════════════════════════════════════════ */
function renderLogs() {
    const filterFid = document.getElementById('logFilterFalcon')?.value || '';
    let logs = [...scopedLogs()];
    if (filterFid) logs = logs.filter(l => l.falconId === filterFid);
    const container = document.getElementById('dailyLogList');
    if (logs.length === 0) {
        container.innerHTML = `<div class="log-empty" data-i18n="daily.empty">${t('daily.empty')}</div>`;
        return;
    }

    container.innerHTML = logs.map(entry => {
        const f = DB.falcons.find(x => x.id === entry.falconId);
        const pills = [];
        if (entry.weight)    pills.push(`<span class="log-pill lp-w">⚖️ ${entry.weight.toLocaleString()} ${t('unit.g')}</span>`);
        if (entry.foodType)  pills.push(`<span class="log-pill lp-f">🍖 ${esc(entry.foodType)}${entry.foodAmt?` · ${entry.foodAmt} ${t('unit.g')}`:''}</span>`);
        if (entry.trainType) pills.push(`<span class="log-pill lp-t">🏃 ${esc(entry.trainType)}</span>`);
        if (entry.distance)  pills.push(`<span class="log-pill lp-d">📏 ${entry.distance} ${t('unit.km')}</span>`);
        if (entry.duration)  pills.push(`<span class="log-pill lp-tm">⏱️ ${entry.duration} ${t('unit.min')}</span>`);

        const thumb = f?.photo
            ? `<img class="log-thumb" src="${f.photo}" alt="">`
            : `<div class="log-thumb-ph">🦅</div>`;

        const canEdit = can('edit_log');
        const canDel  = can('delete_log') || can('daily_log');

        return `
        <div class="log-item">
            ${thumb}
            <div class="log-date-col">
                <span class="log-date">${fmtDate(entry.date)}</span>
                <div class="log-type">${esc(f?.type||'')}</div>
            </div>
            <div class="log-body">
                <div class="log-falcon-name">${esc(f?.name||'—')}</div>
                ${f?.ringNumber?`<div class="log-ring">💍 ${esc(f.ringNumber)}</div>`:''}
                <div class="log-pills">${pills.join('')||`<span style="color:var(--t3);font-size:.72rem">${t('fc.no_data')}</span>`}</div>
                ${entry.notes?`<div class="log-notes">💬 ${esc(entry.notes)}</div>`:''}
            </div>
            <div class="log-actions">
                ${canEdit ? `<button class="act-btn edit" title="${t('edit.log_title')}" onclick="openEditLog('${entry.id}')">✏️</button>` : ''}
                ${canDel  ? `<button class="act-btn del"  title="🗑️" onclick="deleteLog('${entry.id}')">🗑️</button>`  : ''}
            </div>
        </div>`;
    }).join('');
}

async function deleteLog(id) {
    DB.logs = DB.logs.filter(l => l.id !== id);
    saveLogs();
    await fsDel('logs', id);
    renderLogs(); renderDashboard(); updateTopBadges();
    toast(t('toast.log_deleted'), 'info');
}

/* ══════════════════════════════════════════════
   EDIT LOG MODAL
   ══════════════════════════════════════════════ */
function setupEditLogModal() {
    document.getElementById('editLogModal').addEventListener('click', e => {
        if (e.target.id === 'editLogModal') closeModal('editLogModal');
    });
    document.getElementById('editLogForm').addEventListener('submit', async e => {
        e.preventDefault();
        if (!can('edit_log')) { toast(t('toast.no_perm'), 'err'); return; }
        const id  = gv('editLogId');
        const idx = DB.logs.findIndex(l => l.id === id);
        if (idx === -1) return;
        const updated = {
            ...DB.logs[idx],
            date     : gv('elDate') || today(),
            weight   : gn('elWeight') || null,
            foodType : gv('elFoodType') || null,
            foodAmt  : gn('elFoodAmt') || null,
            trainType: gv('elTrainType') || null,
            distance : parseFloat(document.getElementById('elDistance').value)||null,
            duration : gn('elDuration')||null,
            notes    : gv('elNotes'),
            updatedAt: now()
        };
        DB.logs[idx] = updated;
        saveLogs();
        await fsSave('logs', updated.id, updated);
        renderLogs(); renderDashboard();
        closeModal('editLogModal');
        toast(t('toast.log_updated'), 'ok');
    });
}

function openEditLog(id) {
    if (!can('edit_log')) { toast(t('toast.no_perm'), 'err'); return; }
    const l = DB.logs.find(x => x.id === id); if (!l) return;
    sv('editLogId',id); sv('elDate',l.date);
    sv('elWeight',l.weight||''); sv('elFoodType',l.foodType||'');
    sv('elFoodAmt',l.foodAmt||''); sv('elTrainType',l.trainType||'');
    sv('elDistance',l.distance||''); sv('elDuration',l.duration||'');
    sv('elNotes',l.notes||'');
    openModal('editLogModal');
}

/* ══════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════ */
function renderFarmTabs() {
    if (SESSION.user?.role !== 'admin') return;
    const tabs = document.getElementById('farmTabs');
    tabs.innerHTML = '';

    const allBtn = makeTab(`${t('tabs.all')}`, DB.falcons.length, SESSION.adminFarmTab === null, () => {
        SESSION.adminFarmTab = null;
        renderFarmTabs(); renderDashboard(); renderTable(); refreshDailySelect(); renderLogs();
    });
    tabs.appendChild(allBtn);

    DB.farms.forEach(farm => {
        const fc = DB.falcons.filter(f=>f.farmId===farm.id).length;
        const btn = makeTab(`🌿 ${farm.name}`, fc, SESSION.adminFarmTab === farm.id, () => {
            SESSION.adminFarmTab = farm.id;
            renderFarmTabs(); renderDashboard(); renderTable(); refreshDailySelect(); renderLogs();
        });
        tabs.appendChild(btn);
    });
}

function makeTab(label, count, active, onClick) {
    const btn = document.createElement('button');
    btn.className = `farm-tab${active?' active':''}`;
    btn.innerHTML = `${label} <span class="ftc">${count}</span>`;
    btn.onclick = onClick;
    return btn;
}

function renderDashboard() {
    const vf = scopedFalcons();
    const vl = scopedLogs();
    const todayStr = today();
    const u = SESSION.user;

    const kpis = [
        u.role==='admin'
            ? { icon:'🌿', cls:'amber',  val:DB.farms.length,                         lbl:t('kpi.farms') }
            : { icon:'🏃', cls:'purple', val:vl.filter(l=>l.trainType).length,         lbl:t('kpi.trainings') },
        { icon:'🦅', cls:'amber',  val:vf.length,                                      lbl:t('kpi.falcons') },
        { icon:'📅', cls:'blue',   val:vl.filter(l=>l.date===todayStr).length,          lbl:t('kpi.today_logs') },
        { icon:'⚖️', cls:'green',  val:avgWeight(vf),                                   lbl:t('kpi.avg_weight') },
    ];

    document.getElementById('kpiRow').innerHTML = kpis.map(k => `
        <div class="kpi-card">
            <div class="kpi-icon ${k.cls}"><span>${k.icon}</span></div>
            <div><span class="kpi-val">${k.val}</span><span class="kpi-lbl">${k.lbl}</span></div>
        </div>`).join('');

    document.getElementById('tbFalcons').textContent = vf.length;
    document.getElementById('tbLogs').textContent    = vl.filter(l=>l.date===todayStr).length;

    // Falcon cards
    const grid     = document.getElementById('falconGrid');
    const emptyDash= document.getElementById('dashEmpty');
    if (vf.length === 0) {
        emptyDash.style.display=''; grid.innerHTML=''; grid.appendChild(emptyDash); return;
    }
    emptyDash.style.display = 'none';

    grid.innerHTML = vf.map(f => {
        const lw   = latestW(f.id) ?? f.weight;
        const pw   = prevW(f.id);
        const diff = pw !== null ? lw - pw : null;
        const diffHTML = diff !== null
            ? `<span class="weight-diff ${diff>0?'wd-up':'wd-down'}">${diff>0?'▲ +':'▼ '}${diff} ${t('unit.g')}</span>` : '';
        const lastLog = lastEntry(f.id);
        const farm    = DB.farms.find(x=>x.id===f.farmId);
        const parents = [f.father,f.mother].filter(Boolean).join(' / ');
        const hDot    = {
            'ممتازة':'#34d399','جيدة':'#60a5fa','متوسطة':'#fbbf24','تحت العلاج':'#f87171',
            'excellent':'#34d399','good':'#60a5fa','average':'#fbbf24','under treatment':'#f87171'
        }[f.health?.toLowerCase()] || '#60a5fa';

        return `
        <div class="falcon-card">
            <div class="fc-img-strip">
                ${f.photo
                    ? `<img src="${f.photo}" alt="${esc(f.name)}">`
                    : `<div class="fc-ph"><span>🦅</span><span>${t('fc.no_photo')}</span></div>`}
                <div class="fc-ribbon">
                    <span class="fc-type-tag">${esc(f.type)}</span>
                    <span class="fc-health-dot" style="background:${hDot};box-shadow:0 0 6px ${hDot}80" title="${esc(f.health)}"></span>
                </div>
            </div>
            <div class="fc-body">
                <div class="fc-name">${esc(f.name)} ${diffHTML}</div>
                ${f.ringNumber ? `<div class="fc-ring">💍 ${esc(f.ringNumber)}</div>` : ''}
                ${parents ? `<div class="fc-parents">👨‍👩‍👧 ${esc(parents)}</div>` : ''}
                ${farm && u.role==='admin' ? `<div style="font-size:.68rem;color:var(--t3);margin-bottom:.5rem">🌿 ${esc(farm.name)}</div>` : ''}
                <div class="fc-stats">
                    <div class="fc-stat"><span class="fc-stat-val">${lw.toLocaleString()} ${t('unit.g')}</span><span class="fc-stat-lbl">${t('fc.weight_lbl')}</span></div>
                    <div class="fc-stat"><span class="fc-stat-val">${fmtAge(f.birthdate)}</span><span class="fc-stat-lbl">${t('fc.age_lbl')}</span></div>
                </div>
                ${lastLog ? `
                <div class="fc-last">
                    <strong>${t('fc.last_log')} (${fmtDate(lastLog.date)}):</strong>
                    ${lastLog.trainType?` ${esc(lastLog.trainType)}`:''}
                    ${lastLog.weight?` · ${lastLog.weight} ${t('unit.g')}`:''}
                    ${lastLog.foodType?` · ${esc(lastLog.foodType)}`:''} 
                </div>` : ''}
            </div>
            <div class="fc-actions">
                <button class="btn btn-outline btn-sm" onclick="quickDaily('${f.id}')">${t('fc.log_btn')}</button>
                ${can('edit_falcon') ? `<button class="btn btn-ghost btn-sm" onclick="openEditFalcon('${f.id}')">${t('fc.edit_btn')}</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

/* ══════════════════════════════════════════════
   FARM MODAL
   ══════════════════════════════════════════════ */
let editingFarmId = null;

function setupFarmModal() {
    document.getElementById('openAddFarmBtn')?.addEventListener('click', () => {
        editingFarmId = null;
        document.getElementById('farmModalTitle').textContent = t('farm.new_title');
        document.getElementById('farmFormSubmit').textContent = t('farm.create_btn');
        document.getElementById('farmForm').reset();
        populateFarmManagerDropdown(null);
        openModal('farmModal');
    });
    document.getElementById('farmModal').addEventListener('click', e => {
        if (e.target.id === 'farmModal') closeModal('farmModal');
    });

    document.getElementById('farmForm').addEventListener('submit', async e => {
        e.preventDefault();
        const name     = gv('farmName');
        if (!name) { toast(t('toast.farm_name_req'), 'warn'); return; }
        const location = gv('farmLocation');
        const mgrid    = gv('farmManagerId') || null;

        if (editingFarmId) {
            const farm = DB.farms.find(f=>f.id===editingFarmId); if(!farm) return;
            if (farm.managerId && farm.managerId !== mgrid) {
                const old = DB.users.find(u=>u.id===farm.managerId);
                if (old && old.farmId === editingFarmId) old.farmId = null;
            }
            farm.name = name; farm.location = location; farm.managerId = mgrid;
            await fsSave('farms', farm.id, farm);
        } else {
            const farm = { id:uid(), name, location, managerId:mgrid, createdAt:now() };
            DB.farms.push(farm);
            if (mgrid) { const mgr=DB.users.find(u=>u.id===mgrid); if(mgr) mgr.farmId=farm.id; }
            await fsSave('farms', farm.id, farm);
        }

        if (mgrid) {
            const mgr = DB.users.find(u=>u.id===mgrid);
            if (mgr) { mgr.farmId = editingFarmId ?? DB.farms.at(-1)?.id; await fsSave('users', mgr.id, mgr); }
        }

        saveFarms(); saveUsers();
        closeModal('farmModal'); renderFarmsGrid(); renderFarmTabs();
        document.getElementById('farmsBadge').textContent = DB.farms.length;
        const verb = editingFarmId ? t('toast.farm_updated_v') : t('toast.farm_created_v');
        toast(`✓ ${verb} "${name}"`, 'ok');
        editingFarmId = null;
    });
}

function openEditFarm(id) {
    const farm = DB.farms.find(f=>f.id===id); if(!farm) return;
    editingFarmId = id;
    document.getElementById('farmModalTitle').textContent  = t('farm.edit_title');
    document.getElementById('farmFormSubmit').textContent  = t('farm.save_btn');
    sv('farmName', farm.name); sv('farmLocation', farm.location||'');
    sv('farmFormId', id);
    populateFarmManagerDropdown(farm.managerId);
    openModal('farmModal');
}

function populateFarmManagerDropdown(selectedId) {
    const sel = document.getElementById('farmManagerId'); if(!sel) return;
    sel.innerHTML = `<option value="">${t('farm.manager_ph')}</option>`;
    DB.users.filter(u=>u.role==='farm_manager').forEach(u => {
        sel.innerHTML += `<option value="${u.id}">${esc(u.displayName)}${u.farmId&&u.farmId!==editingFarmId?' (مُعيَّن)':''}</option>`;
    });
    if (selectedId) sel.value = selectedId;
}

async function deleteFarm(id) {
    const farm = DB.farms.find(f=>f.id===id); if(!farm) return;
    if (!confirm(t('confirm.del_farm', farm.name))) return;
    const fids = DB.falcons.filter(f=>f.farmId===id).map(f=>f.id);
    DB.falcons = DB.falcons.filter(f=>f.farmId!==id);
    DB.logs    = DB.logs.filter(l=>!fids.includes(l.falconId));
    DB.users.filter(u=>u.farmId===id).forEach(u=>{ u.farmId=null; });
    DB.farms   = DB.farms.filter(f=>f.id!==id);
    if (SESSION.adminFarmTab===id) SESSION.adminFarmTab=null;
    saveFarms(); saveFalcons(); saveLogs(); saveUsers();
    await fsDel('farms', id);
    renderFarmsGrid(); renderFarmTabs(); renderDashboard();
    document.getElementById('farmsBadge').textContent = DB.farms.length;
    toast(t('toast.farm_deleted', farm.name), 'err');
}

function renderFarmsGrid() {
    const grid = document.getElementById('farmsGrid'); if(!grid) return;
    if (DB.farms.length === 0) {
        grid.innerHTML = `<div class="empty-state"><div class="es-icon">🌿</div><p>${t('mgmt.no_farms')}</p></div>`;
        return;
    }
    grid.innerHTML = DB.farms.map(farm => {
        const mgr       = DB.users.find(u=>u.id===farm.managerId);
        const employees = DB.users.filter(u=>u.farmId===farm.id&&u.role==='employee');
        const falconsC  = DB.falcons.filter(f=>f.farmId===farm.id).length;
        return `
        <div class="farm-card">
            <div class="fmc-header">
                <div class="fmc-name">🌿 ${esc(farm.name)}</div>
                ${farm.location?`<div class="fmc-loc">📍 ${esc(farm.location)}</div>`:''}
            </div>
            <div class="fmc-body">
                <div class="fmc-row"><span class="fmc-label">${t('fmc.manager')}</span>
                    <span class="fmc-val">${mgr?esc(mgr.displayName):`<span style="color:var(--t3)">${t('fmc.unassigned')}</span>`}</span>
                </div>
                <div class="fmc-row"><span class="fmc-label">${t('fmc.employees')}</span>
                    <span class="fmc-count">${employees.length}</span>
                </div>
                <div class="fmc-row"><span class="fmc-label">${t('fmc.falcons')}</span>
                    <span class="fmc-count">🦅 ${falconsC}</span>
                </div>
            </div>
            <div class="fmc-footer">
                <button class="btn btn-outline btn-sm" onclick="openEditFarm('${farm.id}')">${t('fmc.edit')}</button>
                <button class="btn btn-danger btn-sm"  onclick="deleteFarm('${farm.id}')">${t('fmc.delete')}</button>
            </div>
        </div>`;
    }).join('');
}

/* ══════════════════════════════════════════════
   USER MODAL
   ══════════════════════════════════════════════ */
function setupUserModal() {
    document.getElementById('openAddUserBtn').addEventListener('click', () => {
        document.getElementById('userForm').reset();
        updateUserFarmOptions();
        openModal('addUserModal');
    });
    document.getElementById('addUserModal').addEventListener('click', e => {
        if (e.target.id === 'addUserModal') closeModal('addUserModal');
    });
    document.getElementById('newRole').addEventListener('change', updateUserFarmOptions);

    document.getElementById('userForm').addEventListener('submit', async e => {
        e.preventDefault();
        const u = SESSION.user;
        const username    = gv('newUsername').toLowerCase();
        const displayName = gv('newDisplayName');
        const password    = document.getElementById('newPassword').value;
        const role        = gv('newRole');
        let   farmId      = gv('newFarmId') || null;

        if (!username||!displayName||!password||!role) { toast(t('toast.fill_all'), 'warn'); return; }
        if (u.role === 'farm_manager') {
            if (role !== 'employee') { toast(t('toast.emp_only'), 'err'); return; }
            farmId = u.farmId;
        }
        if ((role==='employee'||role==='farm_manager') && !farmId) { toast(t('toast.sel_farm'), 'warn'); return; }
        if (DB.users.find(x => x.username===username)) { toast(t('toast.user_exists'), 'err'); return; }

        const newUser = { id:uid(), username, displayName, password:hash(password), role, farmId, createdAt:now(), createdBy:u.id };
        DB.users.push(newUser);

        if (role==='farm_manager' && farmId) {
            const farm = DB.farms.find(f=>f.id===farmId);
            if (farm && !farm.managerId) { farm.managerId = newUser.id; await fsSave('farms', farm.id, farm); saveFarms(); }
        }

        saveUsers();
        await fsSave('users', newUser.id, newUser);
        closeModal('addUserModal');
        renderUsersTable(); renderFarmsGrid(); populateFarmManagerDropdown(null);
        toast(t('toast.user_added', displayName), 'ok');
    });
}

function updateUserFarmOptions() {
    const role = gv('newRole');
    const grp  = document.getElementById('newFarmGroup');
    const sel  = document.getElementById('newFarmId');
    const u    = SESSION.user;
    if (u.role === 'farm_manager') { grp.style.display='none'; return; }
    grp.style.display = (role==='employee'||role==='farm_manager') ? '' : 'none';
    const prev = sel.value;
    sel.innerHTML = `<option value="">${t('user.farm_ph')}</option>`;
    DB.farms.forEach(f => { sel.innerHTML += `<option value="${f.id}">${esc(f.name)}</option>`; });
    if (prev) sel.value = prev;
}

function renderUsersTable() {
    const tbody = document.getElementById('usersBody'); if(!tbody) return;
    const visible = scopedUsers();
    const roleLabel = { admin: t('role.admin'), farm_manager: t('role.farm_manager'), employee: t('role.employee') };
    tbody.innerHTML = '';
    visible.forEach((u, i) => {
        const isMe    = u.id === SESSION.user.id;
        const farm    = DB.farms.find(f => f.id === u.farmId);
        const roleCls = { admin:'pill-admin', farm_manager:'pill-mgr', employee:'pill-emp' }[u.role]||'';
        const canDel  = !isMe && (
            (SESSION.user.role==='admin' && u.role!=='admin') ||
            (SESSION.user.role==='farm_manager' && u.role==='employee' && u.farmId===SESSION.user.farmId)
        );
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color:var(--t3);font-weight:700">${i+1}</td>
            <td style="font-family:monospace;font-size:.8rem">${esc(u.username)}</td>
            <td style="font-weight:700">${esc(u.displayName)} ${isMe?`<span style="font-size:.65rem;color:var(--warn)">(${currentLang==='en'?'you':'أنت'})</span>`:''}</td>
            <td><span class="pill ${roleCls}">${roleLabel[u.role]||u.role}</span></td>
            <td>${farm?`<span style="font-size:.78rem;color:var(--g200)">🌿 ${esc(farm.name)}</span>`:`<span style="color:var(--t3);font-size:.78rem">—</span>`}</td>
            <td style="font-size:.75rem;color:var(--t2)">${fmtDate(u.createdAt)}</td>
            <td>
                <div class="row-acts">
                    <button class="act-btn pwd" title="🔑" onclick="openPwd('${u.id}')">🔑</button>
                    ${canDel?`<button class="act-btn del" title="🗑️" onclick="deleteUser('${u.id}')">🗑️</button>`:''}
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

async function deleteUser(id) {
    const u = DB.users.find(x=>x.id===id); if(!u) return;
    if (u.id===SESSION.user.id) { toast(t('toast.no_self_del'), 'err'); return; }
    if (!confirm(t('confirm.del_user', u.displayName))) return;
    DB.farms.forEach(f=>{ if(f.managerId===id) f.managerId=null; });
    DB.users = DB.users.filter(x=>x.id!==id);
    saveUsers(); saveFarms();
    await fsDel('users', id);
    renderUsersTable(); renderFarmsGrid();
    toast(t('toast.user_deleted', u.displayName), 'err');
}

/* ══════════════════════════════════════════════
   PASSWORD MODAL
   ══════════════════════════════════════════════ */
function setupPwdModal() {
    document.getElementById('pwdModal').addEventListener('click', e=>{
        if(e.target.id==='pwdModal') closeModal('pwdModal');
    });
    document.getElementById('pwdForm').addEventListener('submit', async e=>{
        e.preventDefault();
        const id  = gv('pwdUserId');
        const u   = DB.users.find(x=>x.id===id); if(!u) return;
        const pwd = document.getElementById('pwdNew').value;
        if (!pwd || pwd.length < 4) { toast(t('toast.pwd_short'), 'warn'); return; }
        u.password = hash(pwd);
        saveUsers();
        await fsSave('users', u.id, u);
        closeModal('pwdModal');
        toast(t('toast.pwd_changed', u.displayName), 'ok');
        e.target.reset();
    });
}

function openPwd(id) {
    sv('pwdUserId', id);
    document.getElementById('pwdNew').value = '';
    openModal('pwdModal');
}

/* ══════════════════════════════════════════════
   EXPORT
   ══════════════════════════════════════════════ */
function setupExport() {
    document.getElementById('exportBtn')?.addEventListener('click', () => {
        const vf = scopedFalcons();
        if (!vf.length) { toast(t('toast.no_data'), 'info'); return; }
        const hdr = [t('tbl.name'),t('tbl.ring'),t('tbl.type'),t('tbl.weight'),t('tbl.age'),t('tbl.parents'),t('tbl.status')];
        const rows = vf.map(f => [
            f.name, f.ringNumber||'', f.type,
            latestW(f.id)??f.weight, fmtAge(f.birthdate),
            [f.father,f.mother].filter(Boolean).join(' / '),
            f.health, DB.farms.find(x=>x.id===f.farmId)?.name||''
        ]);
        let csv = '\uFEFF' + hdr.join(',') + '\n';
        rows.forEach(r=>{ csv += r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',') + '\n'; });
        const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
        Object.assign(document.createElement('a'),{href:url,download:'falcon_records.csv'}).click();
        URL.revokeObjectURL(url);
        toast(t('toast.exported'), 'ok');
    });

    document.getElementById('clearAllBtn')?.addEventListener('click', () => {
        if (!confirm(t('confirm.del_all'))) return;
        DB.falcons=[]; DB.logs=[];
        saveFalcons(); saveLogs(); refreshAll();
        toast(t('toast.all_deleted'), 'err');
    });
}

/* ══════════════════════════════════════════════
   REFRESH ALL
   ══════════════════════════════════════════════ */
function refreshAll() {
    if (!SESSION.user) return;
    if (SESSION.user.role==='admin') renderFarmTabs();
    renderDashboard();
    renderTable();
    refreshDailySelect();
    renderLogs();
    updateTopBadges();
    applyTranslations?.();
}

function updateTopBadges() {
    const vf = scopedFalcons();
    const vl = scopedLogs();
    document.getElementById('tbFalcons').textContent = vf.length;
    document.getElementById('tbLogs').textContent    = vl.filter(l=>l.date===today()).length;
}

/* ══════════════════════════════════════════════
   MODAL HELPERS
   ══════════════════════════════════════════════ */
function openModal(id)  { document.getElementById(id)?.classList.add('open');    document.body.style.overflow='hidden'; }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); document.body.style.overflow=''; }
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => {
        m.classList.remove('open'); document.body.style.overflow='';
    });
});

/* ══════════════════════════════════════════════
   STORAGE (local)
   ══════════════════════════════════════════════ */
function load(key, def)  { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } }
function persist(key, v) { localStorage.setItem(key, JSON.stringify(v)); }
function saveFalcons()   { persist(SK.falcons, DB.falcons); }
function saveLogs()      { persist(SK.logs, DB.logs); }
function saveFarms()     { persist(SK.farms, DB.farms); }
function saveUsers()     { persist(SK.users, DB.users); }

/* ══════════════════════════════════════════════
   QUERY HELPERS
   ══════════════════════════════════════════════ */
function latestW(fid)   { return DB.logs.find(l=>l.falconId===fid&&l.weight)?.weight ?? null; }
function prevW(fid)     { const a=DB.logs.filter(l=>l.falconId===fid&&l.weight); return a.length>=2?a[1].weight:null; }
function lastEntry(fid) { return DB.logs.find(l=>l.falconId===fid) || null; }
function avgWeight(vf) {
    if (!vf.length) return '—';
    const ws = vf.map(f=>latestW(f.id)??f.weight);
    return Math.round(ws.reduce((a,b)=>a+b,0)/ws.length).toLocaleString();
}

/* ══════════════════════════════════════════════
   UTILS
   ══════════════════════════════════════════════ */
function uid()    { return Date.now().toString(36) + Math.random().toString(36).substr(2,5); }
function gv(id)   { return document.getElementById(id)?.value.trim() || ''; }
function gn(id)   { return parseInt(document.getElementById(id)?.value) || 0; }
function sv(id,v) { const el=document.getElementById(id); if(el) el.value=v??''; }
function esc(s)   { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
function debounce(fn,ms){ let t; return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);}; }
function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d+'T00:00:00').toLocaleDateString(currentLang==='en'?'en-GB':'ar-SA',{year:'numeric',month:'short',day:'numeric'}); }
    catch { return d; }
}

/* ══════════════════════════════════════════════
   TOAST
   ══════════════════════════════════════════════ */
function toast(msg, type='info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toastStack').appendChild(el);
    setTimeout(() => {
        el.style.opacity='0';
        el.style.transform='translateY(10px) scale(.96)';
        el.style.transition='.3s ease';
        setTimeout(()=>el.remove(), 300);
    }, 3200);
}
