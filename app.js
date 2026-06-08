import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, remove, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getStorage, ref as sRef, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ==========================================
// ⚙️ FESZTIVÁL KONFIGURÁCIÓ
// ==========================================
const FESTIVAL_CONFIG = {
    year: 2026,
    month: 5,
    startDay: 13,
    endDay: 18,
    postFestivalDate: new Date('2026-06-19T00:00:00+02:00').getTime(),
    timeZone: 'Europe/Budapest'
};

const firebaseConfig = {
    apiKey: "AIzaSyB7BkU92oIK3H_01uX9hr8GatQyE_NXMyA",
    authDomain: "ciroka-18b93.firebaseapp.com",
    databaseURL: "https://ciroka-18b93-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "ciroka-18b93",
    storageBucket: "ciroka-18b93.firebasestorage.app",
    messagingSenderId: "149700522771",
    appId: "1:149700522771:web:75596da42e3f116aa3a0e6"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const storage = getStorage(app);

// ==========================================
// 🛠️ GLOBÁLIS ÁLLAPOTOK & LEKÉPEZÉSEK
// ==========================================
let globalAlerts = [];
let globalAdHocEvents = [];
let globalUpdates = [];
let activeTabBeforeSearch = 0;
let currentTypeFilter = null;
let isFavoritesMode = false;
let isGastroMode = false;
let isPhotoWide = false;
let currentGbTotal = 0;
let resizedImageDataUrl = null;
let helpResizedImageDataUrl = null;

// CSOPORTOS ELŐADÁSOK LEKÉPEZÉSE ÉRTESÍTÉSEKHEZ
const SHOW_GROUPS = {
    'show-tragedia-hetfo-d': ['show-tragedia-hetfo-d', 'show-tragedia-hetfo-e'],
    'show-tragedia-hetfo-e': ['show-tragedia-hetfo-d', 'show-tragedia-hetfo-e'],
    'show-doboz-hetfo': ['show-doboz-hetfo', 'show-doboz-hetfo-e'],
    'show-doboz-hetfo-e': ['show-doboz-hetfo', 'show-doboz-hetfo-e'],
    'show-lenka-sze': ['show-lenka-sze', 'show-lenka-csut'],
    'show-lenka-csut': ['show-lenka-sze', 'show-lenka-csut'],
    'show-tryangle-sze': ['show-tryangle-sze', 'show-tryangle-csut'],
    'show-tryangle-csut': ['show-tryangle-sze', 'show-tryangle-csut']
};

// BIZTONSÁGOS STRING FORMÁZÁS
function escapeHTML(str) {
    if (!str) return "";
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
}

// ESEMÉNYKÖVETÉS (GA4)
function trackEvent(eventName, eventParams = {}) {
    if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, eventParams);
    }
}

// TOAST ÜZENET
function showToast(msg) {
    const toast = document.getElementById('toastMsg');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// DEBOUNCE FÜGGVÉNY
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// ==========================================
// 🔔 ÉRTESÍTÉSEK ÉS AD HOC LOGIKA
// ==========================================
onValue(ref(db, "alertsList"), (snap) => {
    document.querySelectorAll('.event-card').forEach(card => card.classList.remove('has-alert'));
    const topBar = document.getElementById("topAlertBar");
    const tabsWrap = document.getElementById("tabsWrap");

    if (!snap.exists()) {
        if(topBar) topBar.style.display = "none";
        if(tabsWrap) tabsWrap.style.top = "0px";
        globalAlerts = [];
        rebuildUpdatesFeed();
        return;
    }
    const data = snap.val();
    globalAlerts = Object.keys(data).map(key => ({ id: key, ...data[key] })).sort((a,b) => b.timeRaw - a.timeRaw);
    
    if(topBar) {
        topBar.textContent = `🔔 Értesítések (${globalAlerts.length})`;
        topBar.style.display = "block";
        setTimeout(() => { if(tabsWrap) tabsWrap.style.top = topBar.offsetHeight + "px"; }, 50);
    }

    globalAlerts.forEach(alert => {
        if (alert.targetId && alert.targetId !== "all") {
            const targets = SHOW_GROUPS[alert.targetId] || [alert.targetId];
            targets.forEach(tId => {
                const targetCard = document.getElementById(tId);
                if (targetCard) targetCard.classList.add("has-alert");
            });
        }
    });
    const newestAlert = globalAlerts[0];
    const lastSeenTime = sessionStorage.getItem("lastSeenAlertTime");
    
    if (!lastSeenTime || parseInt(lastSeenTime) < newestAlert.timeRaw) {
        showPopup(newestAlert);
        sessionStorage.setItem("lastSeenAlertTime", newestAlert.timeRaw.toString());
    }
    rebuildUpdatesFeed();
});

onValue(ref(db, "adHocEvents"), (snap) => {
    if (!snap.exists()) {
        globalAdHocEvents = [];
    } else {
        const data = snap.val();
        globalAdHocEvents = Object.keys(data).map(key => ({ id: key, ...data[key] }));
    }
    rebuildUpdatesFeed();
});

function rebuildUpdatesFeed() {
    const formattedAlerts = globalAlerts.map(a => ({
        ...a,
        isAlert: true,
        sortTime: a.timeRaw
    }));
    const formattedAdHoc = globalAdHocEvents.map(e => ({
        ...e,
        isAdHoc: true,
        sortTime: e.timeRaw
    }));
    
    globalUpdates = [...formattedAlerts, ...formattedAdHoc].sort((a,b) => b.sortTime - a.sortTime);
    
    const currentUpdatesTotal = globalUpdates.length;
    const seenUpdates = parseInt(localStorage.getItem('lastSeenUpdateCount') || '0');
    const unreadUpdates = currentUpdatesTotal - seenUpdates;
    
    const badge = document.getElementById('updateBadge');
    if (badge) {
        if (unreadUpdates > 0 && currentTypeFilter !== 'update') {
            badge.innerText = unreadUpdates;
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }
    
    if (currentTypeFilter === 'update') {
        doSearch();
    }
}

function getShowTitleHTML(targetId) {
    if(!targetId || targetId === "all") return "";
    const el = document.getElementById(targetId);
    if(el) {
        const titleEl = el.querySelector('.event-title');
        if(titleEl) {
            let titleText = titleEl.innerText.replace('MOST ZAJLIK', '').trim();
            return `<div style="font-size:12px; color:var(--teal); font-weight:700; margin-bottom:6px; text-transform:uppercase;">Előadás: ${titleText}</div>`;
        }
    }
    return "";
}

function showPopup(alert) {
    const modalTitle = document.getElementById("modalTitle");
    const modalBody = document.getElementById("modalBody");
    const alertsModal = document.getElementById("alertsModal");
    if(!modalTitle || !modalBody || !alertsModal) return;

    modalTitle.textContent = "Új Értesítés!";
    const showInfo = getShowTitleHTML(alert.targetId);
    let imgHtml = alert.photoUrl ? `<img src="${alert.photoUrl}" style="width:100%; border-radius:4px; margin-bottom:10px;">` : '';

    modalBody.innerHTML = `
      <div class="alert-card">
        ${showInfo}
        ${imgHtml}
        <div class="alert-time">${alert.timestamp}</div>
        <div class="alert-msg">${escapeHTML(alert.message)}</div>
      </div>
    `;
    alertsModal.classList.add("visible");
}

function openAlertsModal(targetId = null) {
    const modalTitle = document.getElementById("modalTitle");
    const modalBody = document.getElementById("modalBody");
    const alertsModal = document.getElementById("alertsModal");
    if(!modalTitle || !modalBody || !alertsModal) return;

    let filteredAlerts = globalAlerts;
    if (targetId) {
        const group = SHOW_GROUPS[targetId] || [targetId];
        filteredAlerts = globalAlerts.filter(a => group.includes(a.targetId));
        modalTitle.textContent = "Értesítés a programhoz";
    } else {
        modalTitle.textContent = "Összes Értesítés";
    }
    let html = "";
    if(filteredAlerts.length === 0) {
        html = "<p style='font-size:13px;'>Nincs aktív értesítés.</p>";
    } else {
        filteredAlerts.forEach(alert => {
            const showInfo = getShowTitleHTML(alert.targetId);
            let imgHtml = alert.photoUrl ? `<img src="${alert.photoUrl}" style="width:100%; border-radius:4px; margin-bottom:10px;">` : '';
            html += `<div class="alert-card">${showInfo}${imgHtml}<div class="alert-time">${alert.timestamp}</div><div class="alert-msg">${escapeHTML(alert.message)}</div></div>`;
        });
    }
    modalBody.innerHTML = html;
    alertsModal.classList.add("visible");
}

function closeAlertsModal() {
    const alertsModal = document.getElementById("alertsModal");
    if(alertsModal) alertsModal.classList.remove("visible");
}

// ==========================================
// 📖 VIRTUÁLIS EMLÉKKÖNYV
// ==========================================
const gbRef = ref(db, "guestbook");
  
function renderGuestbook(dataObj, containerId) {
    const list = document.getElementById(containerId);
    if(!list) return;
    list.innerHTML = "";
    if(!dataObj) {
        list.innerHTML = "<p style='font-size:12px; color:var(--muted); text-align:center; width:100%;'>Még nincs üzenet. Legyél te az első!</p>";
        return;
    }
    const gbArr = Object.keys(dataObj).map(k => ({id: k, ...dataObj[k]})).sort((a,b) => b.timeRaw - a.timeRaw);
    
    gbArr.forEach(msg => {
        const randRot = Math.random();
        
        // Lájk darabszám és állapot kiszámolása eszköz-azonosító alapján
        const likesCount = msg.likes ? Object.keys(msg.likes).length : 0;
        const isLiked = msg.likes && msg.likes[getDeviceUUID()] === true;
        const heartChar = isLiked ? '❤️' : '🤍';
        
        const likeBtnHtml = `
          <button class="gb-like-btn" data-msg-id="${msg.id}" style="background:none; border:none; cursor:pointer; font-size:14px; margin-top:10px; display:inline-flex; align-items:center; gap:4px; outline:none;">
            <span class="heart-icon">${heartChar}</span>
            <span class="like-count" style="font-size:11px; font-weight:700; color:var(--muted);">${likesCount}</span>
          </button>
        `;

        let content = "";
        if (msg.photoUrl) {
            let extraClass = msg.isWide ? 'wide' : '';
            content = `
            <div class="polaroid ${extraClass}" style="--rand: ${randRot};">
                <div class="cellux"></div>
                <img src="${msg.photoUrl}" alt="Kép" loading="lazy">
                <div class="polaroid-text">${escapeHTML(msg.text)}</div>
                <div class="polaroid-author">${escapeHTML(msg.name)}<br><span style="font-size:8px;color:#888;">${msg.dateStr}</span></div>
                <div style="text-align:center;">${likeBtnHtml}</div>
            </div>
            `;
        } else {
            content = `
            <div class="gb-message" style="width:100%;">
                <div class="gb-header">
                <span class="gb-name">${escapeHTML(msg.name)}</span>
                <span class="gb-date">${msg.dateStr}</span>
                </div>
                <div class="gb-text">${escapeHTML(msg.text)}</div>
                <div style="text-align:right;">${likeBtnHtml}</div>
            </div>
            `;
        }
        list.innerHTML += content;
    });
}

onValue(gbRef, (snap) => {
    const data = snap.exists() ? snap.val() : null;
    renderGuestbook(data, "gbGridModal");
    renderGuestbook(data, "gbGridPostFest"); 
    
    if (data) {
        const gbArr = Object.keys(data);
        currentGbTotal = gbArr.length;
        let seen = parseInt(localStorage.getItem('lastSeenGbCount') || '0');
        let unread = currentGbTotal - seen;
        
        const badge = document.getElementById('gbBadge');
        if (badge) {
            if (unread > 0) {
                badge.innerText = unread;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
    }
});

function openGuestbook() {
    const guestbookModal = document.getElementById('guestbookModal');
    if(guestbookModal) guestbookModal.classList.add('visible');
    
    localStorage.setItem('lastSeenGbCount', currentGbTotal.toString());
    const badge = document.getElementById('gbBadge');
    if(badge) badge.style.display = 'none';
}

function handlePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        showToast("Kérlek, csak képet válassz ki!");
        return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function(e) {
        const img = new Image();
        img.src = e.target.result;
        
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800; const MAX_HEIGHT = 800;
            let width = img.width; let height = img.height;
            isPhotoWide = width > height;
            if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
            else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resizedImageDataUrl = canvas.toDataURL('image/jpeg', 0.7);
            
            const btn = document.getElementById('gbPhotoBtn');
            const preview = document.getElementById('gbPhotoPreview');
            if(btn && preview) {
                preview.style.display = 'block';
                btn.style.borderColor = 'var(--green)';
                btn.style.color = 'var(--green)';
                btn.innerText = '✓ FOTÓ CSATOLVA';
            }
        }
        img.onerror = function() { showToast("Nem sikerült feldolgozni a képet. Próbálj meg egy másikat!"); }
    }
}

function getDeviceUUID() {
    let uuid = localStorage.getItem('deviceUUID');
    if(!uuid) {
        uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('deviceUUID', uuid);
    }
    return uuid;
}

async function submitGuestbook() {
    const nowTime = Date.now();
    const lastPost = localStorage.getItem('last_gb_post_time');
    
    if(lastPost && (nowTime - parseInt(lastPost)) < 10000) {
        showToast("Kérjük várj picit az újabb posztolásig!");
        return;
    }

    const nameEl = document.getElementById('gbName');
    const textEl = document.getElementById('gbText');
    if(!nameEl || !textEl) return;

    const name = nameEl.value.trim();
    const text = textEl.value.trim();
    if(!name || !text) { showToast("Kérjük, add meg a neved és az üzenetet is!"); return; }

    const submitBtn = document.getElementById('gbSubmitBtn');
    if(submitBtn) {
        submitBtn.innerText = "Feltöltés folyamatban...";
        submitBtn.disabled = true;
    }

    const dateStr = new Date().toLocaleDateString('hu-HU', {month:'short', day:'numeric'}) + " " + new Date().getHours().toString().padStart(2,'0') + ":" + new Date().getMinutes().toString().padStart(2,'0');

    let photoUrl = "";
    let photoUploadSuccess = true;

    try {
        if (resizedImageDataUrl) {
            try {
                const photoRef = sRef(storage, 'guestbook/' + Date.now() + '.jpg');
                await uploadString(photoRef, resizedImageDataUrl, 'data_url');
                photoUrl = await getDownloadURL(photoRef);
            } catch (imgError) {
                console.error("Képfeltöltési hiba:", imgError);
                photoUploadSuccess = false; 
            }
        }

        const newRef = push(gbRef);
        await set(newRef, { 
            name: name, text: text, timeRaw: Date.now(), dateStr: dateStr, 
            photoUrl: photoUrl, isWide: isPhotoWide || false,
            deviceId: getDeviceUUID() 
        });

        localStorage.setItem('last_gb_post_time', Date.now());

        nameEl.value = "";
        textEl.value = "";
        const photoInput = document.getElementById('gbPhotoInput');
        if(photoInput) photoInput.value = "";
        
        const preview = document.getElementById('gbPhotoPreview');
        if(preview) preview.style.display = 'none';
        
        const btn = document.getElementById('gbPhotoBtn');
        if(btn) {
            btn.style.borderColor = 'var(--teal)';
            btn.style.color = 'var(--teal)';
            btn.innerText = '📸 FOTÓ KIVÁLASZTÁSA (Opcionális)';
        }
        resizedImageDataUrl = null;
        
        trackEvent('guestbook_upload'); 
        
        if(photoUploadSuccess) { showToast("Üzenet sikeresen elküldve!"); } 
        else { showToast("Az üzenet elment, de a kép feltöltése sikertelen volt."); }
    } catch(err) {
        console.error("Adatbázis hiba:", err);
        showToast("Nem sikerült elküldeni! Hiba: " + err.code);
    } finally {
        if(submitBtn) {
            submitBtn.innerText = "Fellövöm a falra!";
            submitBtn.disabled = false;
        }
    }
}

// ==========================================
// 📍 ITT VAGYOK CHECK-IN
// ==========================================
const checkinRef = ref(db, 'checkins');
const venueNames = { 
  'ciroka': 'Ciróka Bábszínház', 
  'agora': 'Hírös Agóra', 
  'kelemen': 'Kelemen L. Kamaraszínház', 
  'ruszt': 'Ruszt J. Stúdió', 
  'ifjusagi': 'Ifjúsági Otthon', 
  'tmh': 'Tudomány és Művészetek Háza (Technika Háza)', 
  'bufe': '☕ Kávézóban / Étteremben' 
};

function updateCheckinUI(venueId) {
    const myStatus = document.getElementById('myCheckinStatus');
    const checkinBtn = document.getElementById('btnCheckin'); 
    
    if (venueId && venueNames[venueId]) {
        if(checkinBtn) {
            checkinBtn.classList.add('active');
            checkinBtn.innerHTML = "📍 Itt vagyok!";
        }
        if(myStatus) {
            myStatus.style.display = 'block';
            myStatus.innerHTML = `Most itt vagy:<br><span class="checkin-status-link checkin-action-modify">${venueNames[venueId]}</span><br>
            <div class="checkin-status-box"><span class="checkin-status-link checkin-action-modify">Módosítod?</span> &nbsp;|&nbsp; <span class="checkin-status-revoke checkin-action-revoke">Visszavonod?</span></div>
            <div style="margin-top:12px;"><span class="jump-to-map" style="background:rgba(255,255,255,0.15); color:#fff; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; padding:6px 12px; border-radius:12px; cursor:pointer;">👀 Kik vannak még itt?</span></div>`;
        }
    } else {
        if(checkinBtn) {
            checkinBtn.classList.remove('active');
            checkinBtn.innerHTML = "📍 Itt vagyok!";
        }
        if(myStatus) {
            myStatus.style.display = 'none';
            myStatus.innerHTML = "";
        }
    }
}

function restoreCheckinUI() {
    const savedVenue = localStorage.getItem('myCheckinVenue');
    const savedId = localStorage.getItem('myCheckinId');
    const savedTime = localStorage.getItem('myCheckinTime');
    const savedName = localStorage.getItem('myCheckinName');

    if (savedVenue && savedId) {
        const now = Date.now();
        if (!savedTime || (now - parseInt(savedTime) < 2 * 60 * 60 * 1000)) { 
            const nameInput = document.getElementById('checkinNameInput');
            if(savedName && nameInput) nameInput.value = savedName;
            
            const venueInput = document.getElementById('ciVenue');
            if(venueInput) venueInput.value = savedVenue;
            
            updateCheckinUI(savedVenue);
        } else {
            localStorage.removeItem('myCheckinName');
            localStorage.removeItem('myCheckinVenue');
            localStorage.removeItem('myCheckinId');
            localStorage.removeItem('myCheckinTime');
            updateCheckinUI(null);
        }
    }
}

function openCheckin() { 
    const modal = document.getElementById('checkinModal');
    if(modal) modal.classList.add('visible'); 
}

function submitCheckin() {
    const nameEl = document.getElementById('checkinNameInput');
    const venueEl = document.getElementById('ciVenue');
    if(!nameEl || !venueEl) return;

    const nameInput = nameEl.value.trim();
    if(nameInput.length < 2) { showToast('Légyszi adj meg egy nevet!'); return; }
    
    const venueId = venueEl.value;

    const oldVenue = localStorage.getItem('myCheckinVenue');
    const oldId = localStorage.getItem('myCheckinId');
    if (oldVenue && oldId) { remove(ref(db, `checkins/${oldVenue}/${oldId}`)); }
    
    const submitBtn = document.getElementById('ciSubmitBtn');
    if(submitBtn) submitBtn.innerText = "Töltés...";
    
    const newRef = push(ref(db, 'checkins/' + venueId));
    
    set(newRef, { name: nameInput, timeRaw: Date.now() })
        .then(() => {
            localStorage.setItem('myCheckinName', nameInput);
            localStorage.setItem('myCheckinVenue', venueId);
            localStorage.setItem('myCheckinId', newRef.key);
            localStorage.setItem('myCheckinTime', Date.now().toString()); 

            const modal = document.getElementById('checkinModal');
            if(modal) modal.classList.remove('visible');
            
            if(submitBtn) submitBtn.innerText = "Fellövöm a térképre!";
            
            trackEvent('check_in_used', { venue: venueId }); 
            showToast("Sikeres becsekkolás!");
            updateCheckinUI(venueId);
        })
        .catch((err) => {
            if(submitBtn) submitBtn.innerText = "Fellövöm a térképre!";
            showToast("Hiba a mentésnél: " + err.message);
        });
}

function revokeCheckin(e) {
    if(e) e.stopPropagation();
    const venueId = localStorage.getItem('myCheckinVenue');
    const checkinId = localStorage.getItem('myCheckinId');
    
    if(venueId && checkinId) {
        remove(ref(db, `checkins/${venueId}/${checkinId}`)).then(() => {
            localStorage.removeItem('myCheckinName');
            localStorage.removeItem('myCheckinVenue');
            localStorage.removeItem('myCheckinId');
            localStorage.removeItem('myCheckinTime');
            
            const nameEl = document.getElementById('checkinNameInput');
            if(nameEl) nameEl.value = ""; 
            
            showToast("Becsekkolás visszavonva!");
            updateCheckinUI(null);
        }).catch((err) => showToast("Nem sikerült törölni: " + err.message));
    }
}

onValue(checkinRef, (snap) => {
    Object.keys(venueNames).forEach(id => {
        const container = document.getElementById('checkins-' + id);
        if(container) container.innerHTML = '';
    });

    const ciBadge = document.getElementById('ciBadge');

    if(!snap.exists()) {
        if(ciBadge) ciBadge.style.display = 'none';
        return;
    }
    
    const data = snap.val();
    const now = Date.now();
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    
    let totalActiveCheckins = 0;

    for (let venueId in data) {
        const venueContainer = document.getElementById('checkins-' + venueId);
        let hasCheckin = false;
        const checkins = data[venueId];
        
        Object.keys(checkins).forEach(key => {
            const checkinData = checkins[key];
            if (now - checkinData.timeRaw < TWO_HOURS) {
                totalActiveCheckins++;
                
                if(venueContainer) {
                    if(!hasCheckin) {
                        if (venueId === 'bufe') {
                            venueContainer.innerHTML = '<div style="font-size:10px; color:var(--muted); margin-bottom:5px; font-weight:600; width: 100%;">Frissítő beszerzés kávézóban/étteremben:</div>';
                        } else {
                            venueContainer.innerHTML = '<div style="font-size:10px; color:var(--muted); margin-bottom:5px; font-weight:600; width: 100%;">Akik itt vannak:</div>';
                        }
                        hasCheckin = true;
                    }
                    const span = document.createElement('span');
                    span.className = 'checkin-bubble';
                    span.innerText = escapeHTML(checkinData.name);
                    venueContainer.appendChild(span);
                }
            }
        });
    }

    if(ciBadge) {
        if (totalActiveCheckins > 0) {
            ciBadge.innerText = totalActiveCheckins;
            ciBadge.style.display = 'block';
        } else {
            ciBadge.style.display = 'none';
        }
    }
});

// ==========================================
// 🚀 INICIALIZÁLÁS ÉS BÖNGÉSZŐ LOGIKA
// ==========================================

function initPostFestivalMode() {
    if (Date.now() > FESTIVAL_CONFIG.postFestivalDate) {
        const ey = document.getElementById('heroEyebrow');
        if(ey) ey.innerText = "Magyarországi Bábszínházak 17. Találkozója";
        
        const ht = document.getElementById('heroTitle');
        if(ht) ht.innerHTML = "Köszönjük, hogy<br><em>velünk voltatok!</em>";
        
        ['searchWrap', 'legendBar', 'tabsWrap', 'scrollHint', 'mainContent', 'topAlertBar', 'heroButtons', 'infoBoxBottom'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.display = 'none';
        });
        
        const pf = document.getElementById('postFestivalView');
        if(pf) pf.style.display = 'block';
    } else {
        const budapestTime = new Date(new Date().toLocaleString("en-US", {timeZone: FESTIVAL_CONFIG.timeZone}));
        if (budapestTime.getFullYear() === FESTIVAL_CONFIG.year && budapestTime.getMonth() === FESTIVAL_CONFIG.month && budapestTime.getDate() >= FESTIVAL_CONFIG.startDay && budapestTime.getDate() <= FESTIVAL_CONFIG.endDay) {
            const dIndex = budapestTime.getDate() - FESTIVAL_CONFIG.startDay;
            const btns = document.querySelectorAll('.tab-btn');
            if(btns[dIndex]) showDay(dIndex, btns[dIndex]);
        } else {
            const btns = document.querySelectorAll('.tab-btn');
            if(btns[0]) showDay(0, btns[0]);
        }
    }
}

function checkLiveEvents() {
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: FESTIVAL_CONFIG.timeZone}));
    if (now.getFullYear() !== FESTIVAL_CONFIG.year || now.getMonth() !== FESTIVAL_CONFIG.month) return;

    document.querySelectorAll('.event-card').forEach(card => {
        const startStr = card.getAttribute('data-start');
        const endStr = card.getAttribute('data-end');
        if (startStr && endStr) {
            const startTime = new Date(startStr);
            const endTime = new Date(endStr);
            if (now >= startTime && now <= endTime) {
                card.classList.add('is-live');
            } else {
                card.classList.remove('is-live');
            }
        }
    });

    const jumpBtn = document.getElementById('jumpBtn');
    if (jumpBtn) {
        if (document.querySelector('.day-panel.active .is-live')) jumpBtn.classList.add('show');
        else jumpBtn.classList.remove('show');
    }
}

function scrollToCurrent() {
    const liveCard = document.querySelector('.day-panel.active .is-live');
    if(liveCard) {
        let timeHeader = liveCard.previousElementSibling;
        while(timeHeader && !timeHeader.classList.contains('slot-time')) timeHeader = timeHeader.previousElementSibling;
        if(timeHeader) timeHeader.scrollIntoView({ behavior: 'smooth' });
    }
}

function toggleCard(el) { 
    if(el && el.closest) {
        const card = el.closest('.event-card');
        if(card) card.classList.toggle('open'); 
    }
}

function toggleGastroCard() {
    isGastroMode = !isGastroMode;
    const btn = document.getElementById('btnHolEgyek');
    const tabsWrap = document.getElementById('tabsWrap');
    const scrollHint = document.getElementById('scrollHint');
    const searchInput = document.getElementById('searchInput');

    if (isGastroMode) {
        if(btn) btn.classList.add('active');
        if(searchInput) searchInput.value = "";
        if(tabsWrap) tabsWrap.style.display = 'none';
        if(scrollHint) scrollHint.style.display = 'none';
        
        document.querySelectorAll('.day-panel').forEach(p => p.style.display = 'none');
        
        const noRes = document.getElementById('noResultsMsg');
        if(noRes) noRes.style.display = 'none';
        
        const secBufe = document.getElementById('secretBufeCard');
        if(secBufe) secBufe.style.display = 'none';
        
        const secGastro = document.getElementById('secretGastroCard');
        if(secGastro) secGastro.style.display = 'block';
        
        const updPanel = document.getElementById('updateFeedPanel');
        if(updPanel) updPanel.style.display = 'none';
        
        currentTypeFilter = null;
        document.querySelectorAll('.filter-btn').forEach(el => el.classList.remove('active'));
        
        trackEvent('restaurants_viewed');
    } else {
        if(btn) btn.classList.remove('active');
        const secGastro = document.getElementById('secretGastroCard');
        if(secGastro) secGastro.style.display = 'none';
        doSearch();
    }
    
    const wrap = document.getElementById('searchWrap');
    if(wrap) wrap.scrollIntoView({ behavior: 'smooth' });
}

function generateQuote() {
    trackEvent('quote_viewed');
    const quotes = [
        "A színház ott kezdődik, ahol a mindennapok véget érnek.",
        "A mese a gyerekek egyetlen komoly dolga.",
        "A báb hallgat, de mindent elmond. Te meg próbálj nem belebeszélni!",
        "A paraván mögött mindenki egyenlő. Kivéve aki tudja, hol a hosszabbító.",
        "Ha elszakad a zsinór, az még nem tragédia. Ha elszáll a hangosítás is, az már költészet.",
        "Egy Találkozó nem attól jó, hogy mit látsz, hanem hogy kivel beszéled ki utána.",
        "A legjobb jelenetek néha a színpadon kívül történnek. Például a harmadik fröccs után.",
        "A báb súlya nem kilóban mérhető. Hanem a vastapsokban.",
        "Ha minden működik, az gyanús. Valami biztos kimaradt.",
        "A bábok nem fáradnak el. De te igen, szóval igyál még egy kávét.",
        "Egy jó Találkozón nem csak előadásokat gyűjtesz, hanem történeteket is.",
        "A báb akkor él, amikor elfelejted, hogy te mozgatod.",
        "Minden előadás egy kicsit más. Akkor is, ha ugyanaz.",
        "A kötetlen beszélgetés a Találkozó szíve. A színpad csak a dobbanás.",
        "A fröccs dramaturgiája egyszerű: első felvonás – beszélgetés, második – őszinteség.",
        "A kávézóban dőlnek el a szakmai viták. És néha a székek is.",
        "A legjobb kritikák nem íródnak le. Csak elhangzanak két korty között.",
        "A legőszintébb beszélgetések nem a szakmai programon, hanem utána kezdődnek.",
        "A kávézó nem szünet. Az a második felvonás.",
        "Aki az esti beszélgetéseket kihagyja, a történet felét sem érti.",
        "Egy Találkozó addig tart, amíg van mit inni és kivel megbeszélni.",
        "A rendezői koncepció addig tiszta, amíg meg nem érkezik a díszlet.",
        "Nem az a kérdés, hogy működik-e. Hanem hogy elhisszük-e, hogy működik.",
        "Ha valamit háromszor kell megmagyarázni, az már biztosan szándékos.",
        "A próbán még keresed a megoldást. A Találkozón már magyarázod.",
        "A dramaturg akkor nyugodt, ha mindenki más ideges.",
        "A minimalizmus ott kezdődik, ahol elfogyott a költségvetés.",
        "A báb akkor működik jól, ha nem esik szét. Minden más már esztétika.",
        "A színész mindent megold. Ha nem, akkor azt is megoldja.",
        "A technika mindig akkor romlik el, amikor végre működne.",
        "Ez egy tudatos csend. Csak kicsit hosszabb lett.",
        "Ha improvizáció, akkor szabad. Ha nem működik, akkor kísérlet.",
        "A próbafolyamat vége: amikor már nincs több idő új ötletekre.",
        "Ha mindenki érti, akkor valamit biztosan túlegyszerűsítettünk.",
        "A produkció kész van. Csak még dolgozunk rajta.",
        "A bemutató után mindenki fáradt. Kivéve azt, akinek még bontania kell.",
        "Az előadás hossza relatív. A pakolásé nem.",
        "A legjobb beszélgetés ott kezdődik, ahol elfogyott a hivatalos program.",
        "Minden Találkozón van egy ember, aki tudja, hol van a hosszabbító. Ő a valódi főszereplő.",
        "A technikai rider egy kívánságlista. A valóság pedig performansz.",
        "A negyedik kávé már nem élénkít. Az egy segélykiáltás.",
        "A díszlet addig könnyű, amíg fel nem kell vinni a harmadikra lift nélkül.",
        "A Találkozó-barátságok intenzitása vetekszik a turnébusz légkondijának kiszámíthatatlanságával.",
        "Mindenki kísérletezik. Van, aki nyilvánosan.",
        "A legnagyobb hazugság a színházban: 'öt perc és kész vagyunk.'",
        "A Találkozó végére minden telefontöltő közkinccsé válik.",
        "A bábos szakma fele művészet, fele logisztika.",
        "Az előadás akkor igazán kortárs, ha a technikus sem tudja pontosan, mi történik.",
        "Az éjszakai szakmázás reggelre rendszerint filozófiává nemesedik.",
        "A színház varázslat. A Találkozó túlélőtúra.",
        "A legnagyobb szakmai bizalom: amikor valaki rád bízza a saját bábját.",
        "Az alternatív megoldás általában azt jelenti, hogy eltört valami."
    ];
    const q = quotes[Math.floor(Math.random() * quotes.length)];
    const qText = document.getElementById('quoteText');
    if(qText) qText.innerText = q;
    
    const modal = document.getElementById('quoteModal');
    if(modal) modal.classList.add('visible');
}

function toggleFavoritesView() {
    isFavoritesMode = !isFavoritesMode;
    const btn = document.getElementById('favFilterBtn');
    if(btn) {
        if (isFavoritesMode) { btn.classList.add('active'); btn.innerHTML = '★ Csak a kedvenceim'; } 
        else { btn.classList.remove('active'); btn.innerHTML = '★ Kedvenceim'; }
    }
    doSearch();
    const wrap = document.getElementById('searchWrap');
    if(wrap) wrap.scrollIntoView({ behavior: 'smooth' });
}

function toggleTypeFilter(type) {
    if (isGastroMode) {
        isGastroMode = false;
        const b = document.getElementById('btnHolEgyek');
        if(b) b.classList.remove('active');
        const sg = document.getElementById('secretGastroCard');
        if(sg) sg.style.display = 'none';
    }

    if (currentTypeFilter === type) { 
        currentTypeFilter = null; 
    } else { 
        currentTypeFilter = type; 
    }

    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (currentTypeFilter && btn.getAttribute('data-filter') === currentTypeFilter) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    if (currentTypeFilter === 'update') {
        localStorage.setItem('lastSeenUpdateCount', globalUpdates.length.toString());
        const updateBadge = document.getElementById('updateBadge');
        if (updateBadge) updateBadge.style.display = 'none';
    }

    doSearch();
    const wrap = document.getElementById('searchWrap');
    if(wrap) wrap.scrollIntoView({ behavior: 'smooth' });
}

function filterVenue(badgeElement, event) {
    if(event) event.stopPropagation();
    const input = document.getElementById('searchInput');
    if(!input || !badgeElement) return;
    
    const venueName = badgeElement.innerText.trim();
    if(input.value === venueName) { input.value = ""; } 
    else { input.value = venueName; }
    doSearch();
}

function showDay(index, btn) {
    document.querySelectorAll('.day-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    const targetDay = document.getElementById('day-' + index);
    if(targetDay) targetDay.classList.add('active');
    
    if(btn) btn.classList.add('active');
    activeTabBeforeSearch = index;
    
    const sInput = document.getElementById('searchInput');
    if(sInput) sInput.value = "";
    
    isFavoritesMode = false;
    currentTypeFilter = null;
    
    const fBtn = document.getElementById('favFilterBtn');
    if(fBtn) {
        fBtn.classList.remove('active');
        fBtn.innerHTML = '★ Kedvenceim';
    }
    
    document.querySelectorAll('.filter-btn').forEach(el => el.classList.remove('active'));
    
    if (isGastroMode) {
        isGastroMode = false;
        const bHol = document.getElementById('btnHolEgyek');
        if(bHol) bHol.classList.remove('active');
        
        const sGast = document.getElementById('secretGastroCard');
        if(sGast) sGast.style.display = 'none';
    }
    
    const updPanel = document.getElementById('updateFeedPanel');
    if(updPanel) updPanel.style.display = 'none';
    
    doSearch();
    setTimeout(scrollToCurrent, 300); 
}

function doSearch() {
    const searchInput = document.getElementById('searchInput');
    if(!searchInput) return;
    
    let queryRaw = searchInput.value.toLowerCase().trim();
    const query = queryRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    
    const dayPanels = document.querySelectorAll('.day-panel');
    const tabsWrap = document.getElementById('tabsWrap');
    const scrollHint = document.getElementById('scrollHint');
    const updateFeedPanel = document.getElementById('updateFeedPanel');

    if(query === "laszlo") {
        const vitez = document.getElementById('vitezLaszlo');
        if(vitez) vitez.classList.add('show');
        trackEvent('easter_egg_found', { type: 'vitez_laszlo' });
        setTimeout(() => { 
            if(vitez) vitez.classList.remove('show'); 
            searchInput.value = ""; 
            doSearch();
        }, 5000);
        return;
    }

    if(query === "kritika" || query === "kritikus") {
        document.body.style.transform = "rotate(180deg)";
        showToast("A kritikusok mindent másképp látnak!", true);
        trackEvent('easter_egg_found', { type: 'kritika' });
        setTimeout(() => { 
            document.body.style.transform = "none"; 
            searchInput.value = ""; 
            doSearch();
        }, 5000); 
        return;
    }

    if(['eso', 'vihar', 'idojaras'].includes(query)) {
        showToast("A program vízálló, de esernyőt azért hozz magaddal! ☔");
        searchInput.value = "";
        doSearch();
        return;
    }

    if(['sor','bor','froccs','kave','bufe'].includes(query)) {
        if(tabsWrap) tabsWrap.style.display = 'none';
        if(scrollHint) scrollHint.style.display = 'none';
        document.querySelectorAll('.day-panel').forEach(p => p.style.display = 'none');
        if(updateFeedPanel) updateFeedPanel.style.display = 'none';
        
        const nRm = document.getElementById('noResultsMsg');
        if(nRm) nRm.style.display = 'none';
        
        const sGc = document.getElementById('secretGastroCard');
        if(sGc) sGc.style.display = 'none';
        
        const sBc = document.getElementById('secretBufeCard');
        if(sBc) sBc.style.display = 'block';
        
        trackEvent('easter_egg_found', { type: 'titkos_bufe' });
        return;
    } else {
        const sBc = document.getElementById('secretBufeCard');
        if(sBc) sBc.style.display = 'none';
    }

    if(['ehes','leves','teszta','szendvics','etterem','kaja', 'pizza', 'hamburger'].includes(query)) {
        if(tabsWrap) tabsWrap.style.display = 'none';
        if(scrollHint) scrollHint.style.display = 'none';
        document.querySelectorAll('.day-panel').forEach(p => p.style.display = 'none');
        if(updateFeedPanel) updateFeedPanel.style.display = 'none';
        
        const nRm = document.getElementById('noResultsMsg');
        if(nRm) nRm.style.display = 'none';
        
        const sBc = document.getElementById('secretBufeCard');
        if(sBc) sBc.style.display = 'none';
        
        const sGc = document.getElementById('secretGastroCard');
        if(sGc) sGc.style.display = 'block';
        
        trackEvent('easter_egg_found', { type: 'titkos_gastro' });
        return;
    } else {
        if (!isGastroMode) { 
            const sGc = document.getElementById('secretGastroCard');
            if(sGc) sGc.style.display = 'none'; 
        }
    }

    if (isGastroMode) return;

    if (currentTypeFilter === 'update') {
        if(tabsWrap) tabsWrap.style.display = 'none';
        if(scrollHint) scrollHint.style.display = 'none';
        dayPanels.forEach(p => p.style.display = 'none');
        
        const noRes = document.getElementById('noResultsMsg');
        if(noRes) noRes.style.display = 'none';
        
        const secBufe = document.getElementById('secretBufeCard');
        if(secBufe) secBufe.style.display = 'none';
        
        const secGastro = document.getElementById('secretGastroCard');
        if(secGastro) secGastro.style.display = 'none';
        
        if (updateFeedPanel) {
            updateFeedPanel.style.display = 'block';
            
            if (globalUpdates.length === 0) {
                updateFeedPanel.innerHTML = "<p style='font-size:12px; color:var(--muted); text-align:center; padding:30px; width:100%;'>Még nincs bejegyzés ezen a csatornán.</p>";
            } else {
                let html = "";
                globalUpdates.forEach(item => {
                    if (item.isAlert) {
                        const showInfo = getShowTitleHTML(item.targetId);
                        let imgHtml = item.photoUrl ? `<img src="${item.photoUrl}" style="width:100%; border-radius:4px; margin-top:10px; margin-bottom:10px;">` : '';
                        html += `
                          <div class="event-card type-show" style="border-left-color: var(--red); background: rgba(192,57,43,0.05); margin-bottom:15px; width: 100%;">
                            <div class="card-header" style="cursor: default; padding-bottom:5px;">
                              <div class="event-title" style="color: var(--red); font-family: 'Montserrat', sans-serif; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700; margin-bottom:0;">🔔 Rendszerértesítés</div>
                              <div class="alert-time" style="font-size: 10px; color: var(--muted); margin-bottom: 6px; font-weight: 700;">${item.timestamp}</div>
                            </div>
                            <div class="card-details-inner" style="padding-top: 5px;">
                              ${showInfo}
                              ${imgHtml}
                              <div class="details-text" style="font-size: 14px; font-weight: 600;">${escapeHTML(item.message)}</div>
                            </div>
                          </div>
                        `;
                    } else if (item.isAdHoc) {
                        let imgHtml = item.photoUrl ? `<img src="${item.photoUrl}" style="width:100%; border-radius:4px; margin-top:10px; margin-bottom:10px;">` : '';
                        
                        // Új frissítési jelző címke
                        let updatedBadge = item.updated ? `<span class="badge" style="background: var(--red); color:#fff; font-size:9px; padding:3px 6px; border-radius:3px; margin-left:8px; font-weight:700; vertical-align:middle; display:inline-block;">🔄 FRISSÍTVE</span>` : '';
                        
                        html += `
                          <div class="event-card type-show open" style="border-left-color: var(--gold-light); background: rgba(196,145,58,0.06); margin-bottom:15px; width:100%;">
                            <div class="card-header" style="cursor: default; padding-bottom:5px;">
                              <div class="card-header-row">
                                <div>
                                  <div class="event-title" style="color: var(--gold); display: inline-block;">${escapeHTML(item.title)}${updatedBadge}</div>
                                  <div class="event-company">${escapeHTML(item.company)}</div>
                                </div>
                              </div>
                            </div>
                            <div class="card-details-inner" style="padding-top:5px;">
                              <div class="details-section" style="margin-bottom:10px;">
                                <div class="details-label">Rendkívüli program infók</div>
                                <div class="details-text" style="font-size:13px;">
                                  <strong>Időpont:</strong> ${escapeHTML(item.timeStr)}<br>
                                  <strong>Helyszín:</strong> ${escapeHTML(item.venue)}
                                </div>
                              </div>
                              <div class="details-section" style="margin-bottom:10px;">
                                <div class="details-label">Leírás</div>
                                <div class="details-text" style="font-size:13px;">${escapeHTML(item.description)}</div>
                              </div>
                              ${imgHtml}
                            </div>
                            <div class="event-footer" style="padding-top:0;">
                              <div class="event-meta"><span class="badge badge-venue" style="background: rgba(212, 168, 74, 0.15); color: var(--gold); border-color: rgba(212, 168, 74, 0.4);">${escapeHTML(item.venue)}</span></div>
                            </div>
                          </div>
                        `;
                    }
                });
                updateFeedPanel.innerHTML = html;
            }
        }
        return;
    } else {
        if (updateFeedPanel) updateFeedPanel.style.display = 'none';
    }

    if (query === "" && !isFavoritesMode && !currentTypeFilter) {
        if(tabsWrap) tabsWrap.style.display = 'flex';
        if (window.innerWidth <= 650 && scrollHint) scrollHint.style.display = 'block';
        
        const nRm = document.getElementById('noResultsMsg');
        if(nRm) nRm.style.display = 'none';
        
        dayPanels.forEach(panel => {
            panel.style.display = '';
            const dayTitle = panel.querySelector('.search-day-title');
            if(dayTitle) dayTitle.style.display = 'none';
            
            panel.querySelectorAll('.event-card').forEach(card => card.style.display = 'block');
            panel.querySelectorAll('.slot-time').forEach(time => time.style.display = 'block');
        });
        
        document.querySelectorAll('.day-panel').forEach(p => p.classList.remove('active'));
        const activePanel = document.getElementById('day-' + activeTabBeforeSearch);
        if(activePanel) activePanel.classList.add('active');
        return;
    }

    if(tabsWrap) tabsWrap.style.display = 'none';
    if(scrollHint) scrollHint.style.display = 'none';
    let hasAnyMatchTotal = false;
    
    dayPanels.forEach((panel, index) => {
        panel.classList.add('active');
        let hasMatchInDay = false;

        let dayTitle = panel.querySelector('.search-day-title');
        if(!dayTitle) {
            dayTitle = document.createElement('h3');
            dayTitle.className = 'search-day-title';
            const tb = document.querySelectorAll('.tab-btn')[index];
            if(tb) {
                const btnText = tb.getAttribute('data-day-name');
                dayTitle.innerText = btnText;
                panel.prepend(dayTitle);
            }
        }
        
        const cards = panel.querySelectorAll('.event-card');
        panel.querySelectorAll('.slot-time').forEach(time => time.style.display = 'none');

        cards.forEach(card => {
            const textOriginal = card.innerText.toLowerCase();
            const text = textOriginal.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
            
            const isMatchSearch = query === "" || text.includes(query);
            const isMatchFav = !isFavoritesMode || localStorage.getItem('fav_' + card.id) === 'true';
            
            let isMatchType = true;
            if(currentTypeFilter) {
                if(currentTypeFilter === 'public') { 
                    isMatchType = card.querySelector('.badge-public') !== null; 
                } else if(currentTypeFilter === 'type-social') {
                    isMatchType = (card.id === 'show-kiallitas');
                } else { 
                    isMatchType = card.classList.contains(currentTypeFilter); 
                }
            }

            if(isMatchSearch && isMatchFav && isMatchType) {
                card.style.display = 'block';
                
                if(currentTypeFilter === 'type-social' && card.id === 'show-kiallitas') {
                    card.classList.add('open');
                }

                let prev = card.previousElementSibling;
                while(prev && !prev.classList.contains('slot-time')) prev = prev.previousElementSibling;
                if(prev && prev.classList.contains('slot-time')) prev.style.display = 'block';
                
                hasMatchInDay = true;
                hasAnyMatchTotal = true;
            } else {
                card.style.display = 'none';
            }
        });

        if(hasMatchInDay) { 
            panel.style.display = 'block'; 
            if(dayTitle) dayTitle.style.display = 'block'; 
        } else { 
            panel.style.display = 'none'; 
            if(dayTitle) dayTitle.style.display = 'none'; 
        }
    });

    const nRm = document.getElementById('noResultsMsg');
    if(!hasAnyMatchTotal && query !== "") { 
        if(nRm) nRm.style.display = 'block'; 
    } else { 
        if(nRm) nRm.style.display = 'none'; 
    }
}

// APP TELEPÍTÉS LOGIKÁJA
let deferredPrompt;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if(!isStandalone) {
        const btn = document.getElementById('installAppBtn');
        if(btn) btn.style.display = 'inline-flex';
    }
});

// 🛠 DOM BETÖLTÉSE UTÁNI FŐ FÜGGVÉNY
function initApp() {
    const pdfOverlay = document.getElementById('pdfOverlay');

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW hiba', err));
    }

    if (isIOS && !isStandalone) { 
        const btn = document.getElementById('installAppBtn');
        if(btn) btn.style.display = 'inline-flex'; 
    }

    const installBtn = document.getElementById('installAppBtn');
    if(installBtn) {
        installBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') { installBtn.style.display = 'none'; }
                deferredPrompt = null;
            } else if (isIOS) {
                showToast("Apple iOS: Lent a böngészőben bökj a [Megosztás ⬆] ikonra, majd a [Főképernyőhöz adás ➕] gombra!");
            }
        });
    }

    const searchInput = document.getElementById('searchInput');
    if(searchInput) searchInput.addEventListener('keyup', debounce(doSearch, 300));
    
    const jumpBtn = document.getElementById('jumpBtn');
    if(jumpBtn) jumpBtn.addEventListener('click', scrollToCurrent);
    
    const topAlertBar = document.getElementById('topAlertBar');
    if(topAlertBar) topAlertBar.addEventListener('click', () => openAlertsModal());
    
    const closeAlertsBtn = document.getElementById('closeAlertsBtn');
    if(closeAlertsBtn) closeAlertsBtn.addEventListener('click', closeAlertsModal);
    
    const gbSubmitBtn = document.getElementById('gbSubmitBtn');
    if(gbSubmitBtn) gbSubmitBtn.addEventListener('click', submitGuestbook);
    
    const gbPhotoInput = document.getElementById('gbPhotoInput');
    if(gbPhotoInput) gbPhotoInput.addEventListener('change', handlePhotoSelect);
    
    const closeGuestbookBtn = document.getElementById('closeGuestbookBtn');
    if(closeGuestbookBtn) closeGuestbookBtn.addEventListener('click', () => { document.getElementById('guestbookModal').classList.remove('visible'); });
    
    const ciSubmitBtn = document.getElementById('ciSubmitBtn');
    if(ciSubmitBtn) ciSubmitBtn.addEventListener('click', submitCheckin);
    
    const ciCloseBtn = document.getElementById('ciCloseBtn');
    if(ciCloseBtn) ciCloseBtn.addEventListener('click', () => { document.getElementById('checkinModal').classList.remove('visible'); });
    
    const quoteCloseBtn = document.getElementById('quoteCloseBtn');
    if(quoteCloseBtn) quoteCloseBtn.addEventListener('click', () => { document.getElementById('quoteModal').classList.remove('visible'); });
    
    const favFilterBtn = document.getElementById('favFilterBtn');
    if(favFilterBtn) favFilterBtn.addEventListener('click', toggleFavoritesView);
    
    const btnGuestbook = document.getElementById('btnGuestbook');
    if(btnGuestbook) btnGuestbook.addEventListener('click', openGuestbook);
    
    const btnQuote = document.getElementById('btnQuote');
    if(btnQuote) btnQuote.addEventListener('click', generateQuote);
    
    const btnHolEgyek = document.getElementById('btnHolEgyek');
    if(btnHolEgyek) btnHolEgyek.addEventListener('click', toggleGastroCard);
    
    const btnCheckin = document.getElementById('btnCheckin');
    if(btnCheckin) btnCheckin.addEventListener('click', openCheckin);

    const btnHelp = document.getElementById('btnHelp');
    if(btnHelp) btnHelp.addEventListener('click', () => { document.getElementById('helpModal').classList.add('visible'); });

    const helpCloseBtn = document.getElementById('helpCloseBtn');
    if(helpCloseBtn) helpCloseBtn.addEventListener('click', () => { document.getElementById('helpModal').classList.remove('visible'); });

    const helpSubmitBtn = document.getElementById('helpSubmitBtn');
    if(helpSubmitBtn) helpSubmitBtn.addEventListener('click', submitHelpRequest);

    const helpPhotoInput = document.getElementById('helpPhotoInput');
    if(helpPhotoInput) helpPhotoInput.addEventListener('change', handleHelpPhotoSelect);

    const btnOtherRestaurants = document.getElementById('btnOtherRestaurants');
    if (btnOtherRestaurants && pdfOverlay) {
        btnOtherRestaurants.addEventListener('click', function(e) {
            e.preventDefault();
            trackEvent('other_restaurants_viewed');
            const targetUrl = "https://docs.google.com/document/d/1uGhMC5mGxbIhS-BF3gTzn9MWPPRStqPHV198v9_Vi30/edit?usp=sharing";
            pdfOverlay.classList.add('show');
            setTimeout(() => {
                pdfOverlay.classList.remove('show');
                window.open(targetUrl, '_blank');
            }, 1800);
        });
    }

    const btnShare = document.getElementById('btnShare');
    if(btnShare) {
        btnShare.addEventListener('click', async () => {
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: '17. Bábszínházi Találkozó',
                        text: 'Kecskemét, 2026. június 13-18. Nézd meg a programot!',
                        url: window.location.href
                    });
                    trackEvent('app_shared'); 
                } catch (err) {
                    console.log('Megosztás megszakítva', err);
                }
            } else {
                navigator.clipboard.writeText(window.location.href);
                showToast('Link másolva a vágólapra!');
            }
        });
    }

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.onclick = null;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleTypeFilter(btn.getAttribute('data-filter'));
        });
    });

    document.querySelectorAll('.tab-btn').forEach((btn, index) => {
        btn.addEventListener('click', () => showDay(index, btn));
    });

    document.querySelectorAll('.card-header').forEach(header => {
        header.addEventListener('click', function(e) {
            if(!e.target.closest('.star-btn') && !e.target.closest('.mini-pulse-alert')) { 
                const card = this.closest('.event-card');
                if (card && !card.classList.contains('open')) { 
                    trackEvent('show_expanded', { show_id: card.id });
                }
                toggleCard(this); 
            }
        });
    });

    const mainContent = document.getElementById('mainContent');
    if(mainContent) {
        mainContent.addEventListener('click', (e) => {
            const routeBtn = e.target.closest('.route-btn');
            if (routeBtn) {
                const venueTitleEl = routeBtn.closest('.gastro-venue-item, .map-venue-flex')?.querySelector('.venue-item-title');
                const venueName = venueTitleEl ? venueTitleEl.innerText.trim() : "Ismeretlen";
                trackEvent('navigation_requested', { venue_name: venueName });
            }

            const fbBtn = e.target.closest('.fb-event-btn');
            if (fbBtn) {
                const url = fbBtn.getAttribute('href');
                if (!url || url === '#' || url === '') {
                    e.preventDefault();
                    e.stopPropagation();
                    showToast("Ehhez a programhoz jelenleg nincs Facebook esemény!");
                    return; 
                }

                const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
                if (isStandaloneMode || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(url, '_system'); 
                }
                return; 
            }

            if(e.target.matches('.badge-venue')) {
                filterVenue(e.target, e);
            } else if(e.target.matches('.badge-public')) {
                e.stopPropagation();
                toggleTypeFilter('public');
            } else if (e.target.matches('.mini-pulse-alert')) {
                e.stopPropagation();
                openAlertsModal(e.target.closest('.event-card').id);
            } else if (e.target.matches('.star-btn')) {
                e.stopPropagation();
                const card = e.target.closest('.event-card');
                if (localStorage.getItem('fav_' + card.id)) {
                    localStorage.removeItem('fav_' + card.id);
                    e.target.classList.remove('active');
                } else {
                    localStorage.setItem('fav_' + card.id, 'true');
                    e.target.classList.add('active');
                    trackEvent('added_to_favorites', { show_id: card.id });
                }
                if (isFavoritesMode) doSearch();
            }
        });
    }

    const myCheckinStatus = document.getElementById('myCheckinStatus');
    if(myCheckinStatus) {
        myCheckinStatus.addEventListener('click', (e) => {
            if(e.target.matches('.checkin-action-modify')) { openCheckin(); } 
            else if (e.target.matches('.checkin-action-revoke')) { revokeCheckin(e); }
            else if (e.target.closest('.jump-to-map')) { document.getElementById('infoBoxBottom').scrollIntoView({behavior: 'smooth'}); }
        });
    }

    const pdfBtn = document.querySelector('.pdf-dl-btn');
    if(pdfBtn && pdfOverlay) {
        pdfBtn.addEventListener('click', function(e) {
            e.preventDefault(); 
            trackEvent('pdf_downloaded');
            const targetUrl = this.href;
            pdfOverlay.classList.add('show');
            setTimeout(() => {
                pdfOverlay.classList.remove('show');
                window.location.href = targetUrl;
            }, 1800);
        });
    }

    document.querySelectorAll('.event-card').forEach(card => {
        if(card.id && localStorage.getItem('fav_' + card.id)) {
            const star = card.querySelector('.star-btn');
            if(star) star.classList.add('active');
        }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const checkinVenueId = urlParams.get('checkin');
    if(checkinVenueId && venueNames[checkinVenueId]) {
        setTimeout(() => {
            const cV = document.getElementById('ciVenue');
            if(cV) cV.value = checkinVenueId;
            
            const savedName = localStorage.getItem('myCheckinName');
            const ciName = document.getElementById('checkinNameInput');
            if(savedName && ciName) ciName.value = savedName;
            
            openCheckin();
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 1000);
    }

    function updateOnlineStatus() {
        if (!navigator.onLine) { document.body.classList.add('is-offline'); } 
        else { document.body.classList.remove('is-offline'); }
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    restoreCheckinUI();
    initPostFestivalMode();
    checkLiveEvents();
    
    window.addEventListener('scroll', () => {
        const jumpBtn = document.getElementById('jumpBtn');
        if(jumpBtn) {
            if (document.querySelector('.day-panel.active .is-live')) jumpBtn.classList.add('show');
            else jumpBtn.classList.remove('show');
        }
    });

    // ÚJ: Delegált kattintásfigyelő a vendégkönyv lájkolásához
    document.body.addEventListener('click', (e) => {
        const likeBtn = e.target.closest('.gb-like-btn');
        if (likeBtn) {
            e.preventDefault();
            e.stopPropagation();
            const msgId = likeBtn.getAttribute('data-msg-id');
            const uuid = getDeviceUUID();
            
            const isAlreadyLiked = likeBtn.querySelector('.heart-icon').innerText === '❤️';
            const likeRef = ref(db, `guestbook/${msgId}/likes/${uuid}`);
            if (isAlreadyLiked) {
                remove(likeRef);
            } else {
                set(likeRef, true);
            }
        }
    });

// ÚJ: Valós idejű élő jelenlét-követés és napi naplózás
    try {
        const uuid = getDeviceUUID();
        const todayStr = new Date().toISOString().split('T')[0];
        
        // 1. Napi egyedi látogató bejegyzése
        const dailyRef = ref(db, `analytics/dailyActiveUsers/${todayStr}/${uuid}`);
        set(dailyRef, Date.now());

        // 2. Valós idejű jelenlét (onDisconnect törléssel)
        const presenceRef = ref(db, `presence/${uuid}`);
        set(presenceRef, Date.now());
        onDisconnect(presenceRef).remove(); // Ha bezárja a lapot, a Firebase törli
    } catch (analyticsError) {
        console.error("Statisztikai hiba:", analyticsError);
    }

    // PWA Automatikus Újratöltés új verzió észlelésekor
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

async function submitHelpRequest() {
    const nameEl = document.getElementById('helpNameInput');
    const emailEl = document.getElementById('helpEmailInput');
    const textEl = document.getElementById('helpTextInput');
    if(!nameEl || !emailEl || !textEl) return;

    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    const text = textEl.value.trim();

    if(!name || !email || !text) {
        showToast("Kérjük, tölts ki minden mezőt!");
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(!emailRegex.test(email)) {
        showToast("Kérjük, érvényes e-mail címet adj meg!");
        return;
    }

    const submitBtn = document.getElementById('helpSubmitBtn');
    if(submitBtn) {
        submitBtn.innerText = "Küldés...";
        submitBtn.disabled = true;
    }

    const dateStr = new Date().toLocaleDateString('hu-HU', {month:'short', day:'numeric'}) + " " + new Date().getHours().toString().padStart(2,'0') + ":" + new Date().getMinutes().toString().padStart(2,'0');

    let photoUrl = "";

    try {
        if (helpResizedImageDataUrl) {
            try {
                const photoRef = sRef(storage, 'questions/' + Date.now() + '.jpg');
                await uploadString(photoRef, helpResizedImageDataUrl, 'data_url');
                photoUrl = await getDownloadURL(photoRef);
            } catch (imgError) {
                console.error("Képfeltöltési hiba:", imgError);
            }
        }

        const qRef = ref(db, 'questions');
        const newRef = push(qRef);
        await set(newRef, {
            name: name,
            email: email,
            text: text,
            timeRaw: Date.now(),
            dateStr: dateStr,
            photoUrl: photoUrl, 
            resolved: false
        });

        nameEl.value = "";
        emailEl.value = "";
        textEl.value = "";
        
        const helpPhotoInput = document.getElementById('helpPhotoInput');
        if(helpPhotoInput) helpPhotoInput.value = "";
        
        const preview = document.getElementById('helpPhotoPreview');
        if(preview) preview.style.display = 'none';
        
        const btn = document.getElementById('helpPhotoBtn');
        if(btn) {
            btn.style.borderColor = 'var(--teal)';
            btn.style.color = 'var(--teal)';
            btn.innerText = '📸 FOTÓ CSATOLÁSA (Opcionális)';
        }
        helpResizedImageDataUrl = null;

        document.getElementById('helpModal').classList.remove('visible');
        showToast("Kérdés elküldve! Figyeld a postaládádat!");
        trackEvent('help_request_sent');
    } catch(err) {
        showToast("Hiba történt: " + err.message);
    } finally {
        if(submitBtn) {
            submitBtn.innerText = "Kérdés elküldése";
            submitBtn.disabled = false;
        }
    }
}

function handleHelpPhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        showToast("Kérlek, csak képet válassz ki!");
        return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function(e) {
        const img = new Image();
        img.src = e.target.result;
        
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800; const MAX_HEIGHT = 800;
            let width = img.width; let height = img.height;
            
            if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
            else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            helpResizedImageDataUrl = canvas.toDataURL('image/jpeg', 0.7);
            
            const btn = document.getElementById('helpPhotoBtn');
            const preview = document.getElementById('helpPhotoPreview');
            if(btn && preview) {
                preview.style.display = 'block';
                btn.style.borderColor = 'var(--green)';
                btn.style.color = 'var(--green)';
                btn.innerText = '✓ FOTÓ CSATOLVA';
            }
        }
    }
}