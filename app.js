import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, remove, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getStorage, ref as sRef, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ==========================================
// ⚙️ FESZTIVÁL KONFIGURÁCIÓ
// ==========================================
const FESTIVAL_CONFIG = {
    year: 2026,
    month: 5, // A JS-ben a hónapok 0-tól indulnak (5 = Június)
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
// 🔔 ÉRTESÍTÉSEK & "UPDATE" BLOG LOGIKÁJA
// ==========================================
onValue(ref(db, "alertsList"), (snap) => {
    document.querySelectorAll('.event-card').forEach(card => card.classList.remove('has-alert'));
    const topBar = document.getElementById("topAlertBar");
    const tabsWrap = document.getElementById("tabsWrap");

    if (!snap.exists()) {
        if(topBar) topBar.style.display = "none";
        if(tabsWrap) tabsWrap.style.top = "0px";
        globalAlerts = [];
        const updateBadge = document.getElementById('updateBadge');
        if(updateBadge) updateBadge.style.display = 'none';
        return;
    }
    const data = snap.val();
    globalAlerts = Object.keys(data).map(key => ({ id: key, ...data[key] })).sort((a,b) => b.timeRaw - a.timeRaw);
    
    // Csak a valódi (nem blog) értesítéseket számoljuk felülre
    const realAlerts = globalAlerts.filter(a => !a.isBlog);

    if(topBar) {
        if (realAlerts.length > 0) {
            topBar.textContent = `🔔 Értesítések (${realAlerts.length})`;
            topBar.style.display = "block";
            setTimeout(() => { if(tabsWrap) tabsWrap.style.top = topBar.offsetHeight + "px"; }, 50);
        } else {
            topBar.style.display = "none";
            if(tabsWrap) tabsWrap.style.top = "0px";
        }
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

    // Update gomb számlálójának kezelése (az összes értesítést és blogbejegyzést számolja)
    const totalUpdates = globalAlerts.length;
    let seenUpdates = parseInt(localStorage.getItem('lastSeenUpdateCount') || '0');
    let unreadUpdates = totalUpdates - seenUpdates;

    if (currentTypeFilter === 'type-update') {
        localStorage.setItem('lastSeenUpdateCount', totalUpdates.toString());
        unreadUpdates = 0;
    }

    const updateBadge = document.getElementById('updateBadge');
    if (updateBadge) {
        if (unreadUpdates > 0) {
            updateBadge.innerText = unreadUpdates;
            updateBadge.style.display = 'block';
        } else {
            updateBadge.style.display = 'none';
        }
    }

    if (realAlerts.length > 0) {
        const newestAlert = realAlerts[0];
        const lastSeenTime = sessionStorage.getItem("lastSeenAlertTime");
        if (!lastSeenTime || parseInt(lastSeenTime) < newestAlert.timeRaw) {
            showPopup(newestAlert);
            sessionStorage.setItem("lastSeenAlertTime", newestAlert.timeRaw.toString());
        }
    }
});

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

// ÚJ: AZ LIVE "UPDATE" BLOGFOLYAM RENDERELESE
function renderUpdatesBlog() {
    const container = document.getElementById('updatesBlogContainer');
    if(!container) return;
    container.innerHTML = "";
    
    if (globalAlerts.length === 0) {
        container.innerHTML = "<p style='text-align:center; padding:30px; font-size:14px; color:var(--muted); font-weight: 600;'>Jelenleg nincs hír vagy új program.</p>";
        return;
    }
    
    globalAlerts.forEach(post => {
        const isAlert = !post.title; 
        let cardHtml = "";
        
        if (isAlert) {
            cardHtml = `
            <div class="event-card" style="border-left-color: var(--red); margin-bottom:15px;">
              <div class="card-header" style="background: rgba(192,57,43,0.06); padding: 14px 16px;">
                <div class="event-title" style="color: var(--red); font-size:16px; font-family:'Playfair Display', serif;">🚨 Rendkívüli Értesítés</div>
                <div class="event-company" style="font-size:11px; margin-top:2px;">${post.timestamp}</div>
              </div>
              <div class="card-details-inner" style="padding:16px;">
                <div class="details-text" style="font-size:14px; font-weight:600; line-height:1.5;">${escapeHTML(post.message)}</div>
                ${post.photoUrl ? `<img src="${post.photoUrl}" style="max-width:100%; border-radius:4px; margin-top:12px; display:block; border: 1px solid var(--border);">` : ''}
              </div>
            </div>`;
        } else {
            cardHtml = `
            <div class="event-card" style="border-left-color: var(--gold); margin-bottom:15px;">
              <div class="card-header" style="background: rgba(196,145,58,0.06); padding: 14px 16px;">
                <div class="event-title" style="color: var(--teal-dark); font-size:16px; font-family:'Playfair Display', serif;">✨ ${escapeHTML(post.title)}</div>
                <div class="event-company" style="font-size:11px; margin-top:2px;">${post.timestamp}</div>
              </div>
              <div class="card-details-inner" style="padding:16px;">
                <div class="details-text" style="font-size:14px; line-height:1.5; font-weight: 500;">${escapeHTML(post.message)}</div>
                ${post.photoUrl ? `<img src="${post.photoUrl}" style="max-width:100%; border-radius:4px; margin-top:12px; display:block; border: 1px solid var(--border);">` : ''}
              </div>
            </div>`;
        }
        container.innerHTML += cardHtml;
    });
}

// ==========================================
// 📖 VIRTUALIS EMLÉKKÖNYV
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
        let content = "";
        if (msg.photoUrl) {
            let extraClass = msg.isWide ? 'wide' : '';
            content = `
            <div class="polaroid ${extraClass}" style="--rand: ${randRot};">
                <div class="cellux"></div>
                <img src="${msg.photoUrl}" alt="Kép" loading="lazy">
                <div class="polaroid-text">${escapeHTML(msg.text)}</div>
                <div class="polaroid-author">${escapeHTML(msg.name)}<br><span style="font-size:8px;color:#888;">${msg.dateStr}</span></div>
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

// JAVÍTVA: METAADATOK HOZZÁADVA A VENDÉGKÖNYV KÉPFELTÖLTÉSHEZ
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
                // Hozzáadva: { contentType: 'image/jpeg' }
                await uploadString(photoRef, resizedImageDataUrl, 'data_url', { contentType: 'image/jpeg' });
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
        
        currentTypeFilter = null;
        document.querySelectorAll('.filter-btn').forEach(el => el.classList.remove('active'));
        
        trackEvent('restaurants_viewed');
    } else {
        if(btn) btn.classList.remove('active');
        const secGastro = document.getElementById('secretGastroCard');
        if(secGastro) secGastro.style.display = 'none';
        doSearch();
    }
    
    // Gördítünk a keresősávhoz
    const wrap = document.getElementById('searchWrap');
    if(wrap) wrap.scrollIntoView({ behavior: 'smooth' });
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

    if (currentTypeFilter === type) { currentTypeFilter = null; } 
    else { currentTypeFilter = type; }

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (currentTypeFilter) { 
        const targetBtn = document.querySelector(`.filter-btn[data-filter="${currentTypeFilter}"]`);
        if(targetBtn) targetBtn.classList.add('active'); 
    }

    // ÚJ: Ha az Update szűrőt választották, nullázzuk a számlálót
    if (currentTypeFilter === 'type-update') {
        const totalUpdates = globalAlerts.length;
        localStorage.setItem('lastSeenUpdateCount', totalUpdates.toString());
        const badge = document.getElementById('updateBadge');
        if(badge) badge.style.display = 'none';
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
        
        const sg = document.getElementById('secretGastroCard');
        if(sg) sg.style.display = 'none';
    }
    
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
    const blogContainer = document.getElementById('updatesBlogContainer');

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

    // IDŐJÁRÁS EASTER EGG
    if(['eso', 'vihar', 'idojaras'].includes(query)) {
        showToast("A bábok nem áznak el, de esernyőt azért hozz magaddal! ☔");
        searchInput.value = "";
        doSearch();
        return;
    }

    if(['sor','bor','froccs','kave','bufe'].includes(query)) {
        if(tabsWrap) tabsWrap.style.display = 'none';
        if(scrollHint) scrollHint.style.display = 'none';
        document.querySelectorAll('.day-panel').forEach(p => p.style.display = 'none');
        if(blogContainer) blogContainer.style.display = 'none';
        
        const nRm = document.getElementById('noResultsMsg');
        if(nRm) nRm.style.display = 'none';
        
        const sg = document.getElementById('secretGastroCard');
        if(sg) sg.style.display = 'none';
        
        const sBc = document.getElementById('secretBufeCard');
        if(sBc) sBc.style.display = 'block';
        
        trackEvent('easter_egg_found', { type: 'titkos_bufe' });
        return;
    } else {
        const sBc = document.getElementById('secretBufeCard');
        if(sBc) sBc.style.display = 'none';
    }

    // GASZTRO EASTER EGG
    if(['ehes','leves','teszta','szendvics','etterem','kaja', 'pizza', 'hamburger'].includes(query)) {
        if(tabsWrap) tabsWrap.style.display = 'none';
        if(scrollHint) scrollHint.style.display = 'none';
        document.querySelectorAll('.day-panel').forEach(p => p.style.display = 'none');
        if(blogContainer) blogContainer.style.display = 'none';
        
        const nRm = document.getElementById('noResultsMsg');
        if(nRm) nRm.style.display = 'none';
        
        const sBc = document.getElementById('secretBufeCard');
        if(sBc) sBc.style.display = 'none';
        
        const sg = document.getElementById('secretGastroCard');
        if(sg) sg.style.display = 'block';
        
        trackEvent('easter_egg_found', { type: 'titkos_gastro' });
        return;
    } else {
        if (!isGastroMode) { 
            const sg = document.getElementById('secretGastroCard');
            if(sg) sg.style.display = 'none'; 
        }
    }

    // VISSZAÁLLÍTÓ LOGIKA: Ha a felhasználó nincs az Update fülön, tegyük láthatóvá a füleket és a scroll hintet!
    if (currentTypeFilter !== 'type-update') {
        if (blogContainer) blogContainer.style.display = 'none';
        if (query === "") {
            if (tabsWrap) tabsWrap.style.display = 'flex';
            if (window.innerWidth <= 650 && scrollHint) scrollHint.style.display = 'block';
        }
    } else {
        // Ha pedig az Update fülön vagyunk, kényszerítsük az elrejtést
        if(tabsWrap) tabsWrap.style.display = 'none';
        if(scrollHint) scrollHint.style.display = 'none';
        dayPanels.forEach(panel => panel.style.display = 'none');
        
        const nRm = document.getElementById('noResultsMsg');
        if(nRm) nRm.style.display = 'none';

        if(blogContainer) {
            blogContainer.style.display = 'block';
            renderUpdatesBlog();
        }
        return; 
    }

    if (query === "" && !isFavoritesMode && !currentTypeFilter) {
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
                isMatchType = card.classList.contains(currentTypeFilter);
            }

            if(isMatchSearch && isMatchFav && isMatchType) {
                card.style.display = 'block';
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

// ==========================================
// 🛠️ EGYSÉGES KACSINTÓS PDF LETÖLTÉS MINDEN GOMBRA
// ==========================================
function initPdfTriggers() {
    const pdfOverlay = document.getElementById('pdfOverlay');
    document.querySelectorAll('.pdf-dl-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault(); 
            const targetUrl = this.href;
            trackEvent('pdf_downloaded', { url: targetUrl });
            if (pdfOverlay) {
                pdfOverlay.classList.add('show');
                setTimeout(() => {
                    pdfOverlay.classList.remove('show');
                    window.location.href = targetUrl; 
                }, 1800);
            } else {
                window.location.href = targetUrl;
            }
        });
    });
}

// 🛠 DOM BETÖLTÉSE UTÁNI FŐ FÜGGVÉNY (Eseménykezelők)
function initApp() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW hiba', err));

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
    
    // Gyorslinkek
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

    // Kérdésküldés
    const btnHelp = document.getElementById('btnHelp');
    if(btnHelp) btnHelp.addEventListener('click', () => { document.getElementById('helpModal').classList.add('visible'); });

    const helpCloseBtn = document.getElementById('helpCloseBtn');
    if(helpCloseBtn) helpCloseBtn.addEventListener('click', () => { document.getElementById('helpModal').classList.remove('visible'); });

    const helpSubmitBtn = document.getElementById('helpSubmitBtn');
    if(helpSubmitBtn) helpSubmitBtn.addEventListener('click', submitHelpRequest);

    const helpPhotoInput = document.getElementById('helpPhotoInput');
    if(helpPhotoInput) helpPhotoInput.addEventListener('change', handleHelpPhotoSelect);

    // Megosztás Gomb (Web Share API) – TELJES, JAVÍTVA
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

    // Szűrők
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => toggleTypeFilter(btn.getAttribute('data-filter')));
    });

    // Fülek (Tabs)
    document.querySelectorAll('.tab-btn').forEach((btn, index) => {
        btn.addEventListener('click', () => showDay(index, btn));
    });

    // Kártya lenyitás 
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

    // Delegált eseménykezelők 
    const mainContent = document.getElementById('mainContent');
    if(mainContent) {
        mainContent.addEventListener('click', (e) => {
            
            const routeBtn = e.target.closest('.route-btn');
            if (routeBtn) {
                const venueTitleEl = routeBtn.closest('.gastro-venue-item, .map-venue-flex')?.querySelector('.venue-item-title');
                const venueName = venueTitleEl ? venueTitleEl.innerText.trim() : "Ismeretlen";
                trackEvent('navigation_requested', { venue_name: venueName });
            }

            // Facebook gombok megnyitása
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

    initPdfTriggers();

    document.querySelectorAll('.gastro-logo, .sponsor-logo').forEach(logo => {
        logo.addEventListener('touchstart', function() {
            this.classList.add('active-touch');
            setTimeout(() => this.classList.remove('active-touch'), 1500);
        });
    });

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
    setInterval(checkLiveEvents, 60000);
    
    window.addEventListener('scroll', () => {
        const jumpBtn = document.getElementById('jumpBtn');
        if(jumpBtn) {
            if (document.querySelector('.day-panel.active .is-live')) jumpBtn.classList.add('show');
            else jumpBtn.classList.remove('show');
        }
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                trackEvent('sponsors_viewed');
                observer.disconnect(); 
            }
        });
    });
    const sponsorBox = document.getElementById('sponsorsBox');
    if (sponsorBox) observer.observe(sponsorBox);

}

// BIZTOSÍTJUK A BETÖLTÉST
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
                // JAVÍTVA: Metaadatok ({ contentType: 'image/jpeg' }) elküldve
                await uploadString(photoRef, helpResizedImageDataUrl, 'data_url', { contentType: 'image/jpeg' });
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