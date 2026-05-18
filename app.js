import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, remove, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getStorage, ref as sRef, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ==========================================
// ⚙️ FESZTIVÁL KONFIGURÁCIÓ
// Ezt az egy blokkot kell átírni jövőre!
// ==========================================
const FESTIVAL_CONFIG = {
    year: 2026,
    month: 5, // Figyelem! A JS-ben a hónapok 0-tól indulnak (5 = Június)
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

// GLOBÁLIS ÁLLAPOTOK
let globalAlerts = [];
let activeTabBeforeSearch = 0;
let currentTypeFilter = null;
let isFavoritesMode = false;
let isGastroMode = false;
let isPhotoWide = false;
let resizedImageDataUrl = null;

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

// DEBOUNCE FÜGGVÉNY (KERESŐHÖZ)
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// ==========================================
// 🔔 ÉRTESÍTÉSEK LOGIKÁJA
// ==========================================
onValue(ref(db, "alertsList"), (snap) => {
    document.querySelectorAll('.event-card').forEach(card => card.classList.remove('has-alert'));
    const topBar = document.getElementById("topAlertBar");
    const tabsWrap = document.getElementById("tabsWrap");

    if (!snap.exists()) {
        topBar.style.display = "none";
        tabsWrap.style.top = "0px";
        globalAlerts = [];
        return;
    }
    const data = snap.val();
    globalAlerts = Object.keys(data).map(key => ({ id: key, ...data[key] })).sort((a,b) => b.timeRaw - a.timeRaw);
    
    topBar.textContent = `🔔 Értesítések (${globalAlerts.length})`;
    topBar.style.display = "block";

    setTimeout(() => { tabsWrap.style.top = topBar.offsetHeight + "px"; }, 50);

    globalAlerts.forEach(alert => {
        if (alert.targetId && alert.targetId !== "all") {
            const targetCard = document.getElementById(alert.targetId);
            if (targetCard) targetCard.classList.add("has-alert");
        }
    });

    const newestAlert = globalAlerts[0];
    const lastSeenTime = sessionStorage.getItem("lastSeenAlertTime");
    
    if (!lastSeenTime || parseInt(lastSeenTime) < newestAlert.timeRaw) {
        showPopup(newestAlert);
        sessionStorage.setItem("lastSeenAlertTime", newestAlert.timeRaw.toString());
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
    document.getElementById("modalTitle").textContent = "Új Értesítés!";
    const showInfo = getShowTitleHTML(alert.targetId);
    let imgHtml = alert.photoUrl ? `<img src="${alert.photoUrl}" style="width:100%; border-radius:4px; margin-bottom:10px;">` : '';

    document.getElementById("modalBody").innerHTML = `
      <div class="alert-card">
        ${showInfo}
        ${imgHtml}
        <div class="alert-time">${alert.timestamp}</div>
        <div class="alert-msg">${escapeHTML(alert.message)}</div>
      </div>
    `;
    document.getElementById("alertsModal").classList.add("visible");
}

function openAlertsModal(targetId = null) {
    let filteredAlerts = globalAlerts;
    if (targetId) {
        filteredAlerts = globalAlerts.filter(a => a.targetId === targetId);
        document.getElementById("modalTitle").textContent = "Értesítés a programhoz";
    } else {
        document.getElementById("modalTitle").textContent = "Összes Értesítés";
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
    document.getElementById("modalBody").innerHTML = html;
    document.getElementById("alertsModal").classList.add("visible");
}

function closeAlertsModal() {
    document.getElementById("alertsModal").classList.remove("visible");
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
});

function openGuestbook() {
    document.getElementById('guestbookModal').classList.add('visible');
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
            document.getElementById('gbPhotoPreview').style.display = 'block';
            btn.style.borderColor = 'var(--green)';
            btn.style.color = 'var(--green)';
            btn.innerText = '✓ FOTÓ CSATOLVA';
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

    const name = document.getElementById('gbName').value.trim();
    const text = document.getElementById('gbText').value.trim();
    if(!name || !text) { showToast("Kérjük, add meg a neved és az üzenetet is!"); return; }

    const submitBtn = document.getElementById('gbSubmitBtn');
    submitBtn.innerText = "Feltöltés folyamatban...";
    submitBtn.disabled = true;

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

        document.getElementById('gbText').value = "";
        document.getElementById('gbPhotoInput').value = "";
        document.getElementById('gbPhotoPreview').style.display = 'none';
        const btn = document.getElementById('gbPhotoBtn');
        btn.style.borderColor = 'var(--teal)';
        btn.style.color = 'var(--teal)';
        btn.innerText = '📸 FOTÓ KIVÁLASZTÁSA (Opcionális)';
        resizedImageDataUrl = null;
        
        trackEvent('guestbook_upload'); 
        
        if(photoUploadSuccess) { showToast("Üzenet sikeresen elküldve!"); } 
        else { showToast("Az üzenet elment, de a kép feltöltése sikertelen volt."); }
    } catch(err) {
        console.error("Adatbázis hiba:", err);
        showToast("Nem sikerült elküldeni! Hiba: " + err.code);
    } finally {
        submitBtn.innerText = "Fellövöm a falra!";
        submitBtn.disabled = false;
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
        myStatus.style.display = 'block';
        myStatus.innerHTML = `Most itt vagy:<br><span class="checkin-status-link checkin-action-modify">${venueNames[venueId]}</span><br>
        <div class="checkin-status-box"><span class="checkin-status-link checkin-action-modify">Módosítod?</span> &nbsp;|&nbsp; <span class="checkin-status-revoke checkin-action-revoke">Visszavonod?</span></div>
        <div style="margin-top:12px;"><span class="jump-to-map" style="background:rgba(255,255,255,0.15); color:#fff; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; padding:6px 12px; border-radius:12px; cursor:pointer;">👀 Kik vannak még itt?</span></div>`;
    } else {
        if(checkinBtn) {
            checkinBtn.classList.remove('active');
            checkinBtn.innerHTML = "📍 Itt vagyok!";
        }
        myStatus.style.display = 'none';
        myStatus.innerHTML = "";
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
            if(savedName) document.getElementById('checkinNameInput').value = savedName;
            document.getElementById('ciVenue').value = savedVenue;
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
    document.getElementById('checkinModal').classList.add('visible'); 
}

function submitCheckin() {
    const nameInput = document.getElementById('checkinNameInput').value.trim();
    if(nameInput.length < 2) { showToast('Légyszi adj meg egy nevet!'); return; }
    
    const venueId = document.getElementById('ciVenue').value;

    const oldVenue = localStorage.getItem('myCheckinVenue');
    const oldId = localStorage.getItem('myCheckinId');
    if (oldVenue && oldId) { remove(ref(db, `checkins/${oldVenue}/${oldId}`)); }
    
    const submitBtn = document.getElementById('ciSubmitBtn');
    submitBtn.innerText = "Töltés...";
    
    const newRef = push(ref(db, 'checkins/' + venueId));
    
    set(newRef, { name: nameInput, timeRaw: Date.now() })
        .then(() => {
            localStorage.setItem('myCheckinName', nameInput);
            localStorage.setItem('myCheckinVenue', venueId);
            localStorage.setItem('myCheckinId', newRef.key);
            localStorage.setItem('myCheckinTime', Date.now().toString()); 

            document.getElementById('checkinModal').classList.remove('visible');
            submitBtn.innerText = "Fellövöm a térképre!";
            
            trackEvent('check_in_used', { venue: venueId }); 
            showToast("Sikeres becsekkolás!");
            updateCheckinUI(venueId);
        })
        .catch((err) => {
            submitBtn.innerText = "Fellövöm a térképre!";
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
            
            document.getElementById('checkinNameInput').value = ""; 
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

    if(!snap.exists()) return;
    
    const data = snap.val();
    const now = Date.now();
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    for (let venueId in data) {
        const venueContainer = document.getElementById('checkins-' + venueId);
        if(!venueContainer) continue;

        let hasCheckin = false;
        const checkins = data[venueId];
        
        Object.keys(checkins).forEach(key => {
            const checkinData = checkins[key];
            if (now - checkinData.timeRaw < TWO_HOURS) {
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
        });
    }
});

// ==========================================
// 🚀 INICIALIZÁLÁS ÉS BÖNGÉSZŐ LOGIKA
// ==========================================

function initPostFestivalMode() {
    if (Date.now() > FESTIVAL_CONFIG.postFestivalDate) {
        document.getElementById('heroEyebrow').innerText = "Magyarországi Bábszínházak 17. Találkozója";
        document.getElementById('heroTitle').innerHTML = "Köszönjük, hogy<br><em>velünk voltatok!</em>";
        
        document.getElementById('searchWrap').style.display = 'none';
        document.getElementById('legendBar').style.display = 'none';
        document.getElementById('tabsWrap').style.display = 'none';
        document.getElementById('scrollHint').style.display = 'none';
        document.getElementById('mainContent').style.display = 'none';
        document.getElementById('topAlertBar').style.display = 'none';
        document.getElementById('heroButtons').style.display = 'none';
        document.getElementById('infoBoxBottom').style.display = 'none';
        document.getElementById('postFestivalView').style.display = 'block';
    } else {
        const budapestTime = new Date(new Date().toLocaleString("en-US", {timeZone: FESTIVAL_CONFIG.timeZone}));
        if (budapestTime.getFullYear() === FESTIVAL_CONFIG.year && budapestTime.getMonth() === FESTIVAL_CONFIG.month && budapestTime.getDate() >= FESTIVAL_CONFIG.startDay && budapestTime.getDate() <= FESTIVAL_CONFIG.endDay) {
            const dIndex = budapestTime.getDate() - FESTIVAL_CONFIG.startDay;
            showDay(dIndex, document.querySelectorAll('.tab-btn')[dIndex]);
        } else {
            showDay(0, document.querySelectorAll('.tab-btn')[0]);
        }
    }
}

// Bombabiztos "MOST ZAJLIK" ellenőrző
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

    if (document.querySelector('.day-panel.active .is-live')) {
        document.getElementById('jumpBtn').classList.add('show');
    } else {
        document.getElementById('jumpBtn').classList.remove('show');
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
    el.closest('.event-card').classList.toggle('open'); 
}

function toggleGastroCard() {
    isGastroMode = !isGastroMode;
    const btn = document.getElementById('btnHolEgyek');
    const tabsWrap = document.getElementById('tabsWrap');
    const scrollHint = document.getElementById('scrollHint');

    if (isGastroMode) {
        btn.classList.add('active');
        document.getElementById('searchInput').value = "";
        tabsWrap.style.display = 'none';
        scrollHint.style.display = 'none';
        document.querySelectorAll('.day-panel').forEach(p => p.style.display = 'none');
        document.getElementById('noResultsMsg').style.display = 'none';
        document.getElementById('secretBufeCard').style.display = 'none';
        document.getElementById('secretGastroCard').style.display = 'block';
        
        currentTypeFilter = null;
        document.querySelectorAll('.filter-btn').forEach(el => el.classList.remove('active'));
        
        trackEvent('restaurants_viewed');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        btn.classList.remove('active');
        document.getElementById('secretGastroCard').style.display = 'none';
        doSearch();
    }
}

function generateQuote() {
    const quotes = [
        "A báb nem utánozza az életet, hanem újat teremt.",
        "Ami a bábbal történik, az varázslat.",
        "Minden báb lelke a mozgatója kezében van.",
        "A színház ott kezdődik, ahol a mindennapok véget érnek.",
        "A lécnek nincs saját akarata, de a bábos lelket lehel belé.",
        "A mese a gyermek egyetlen komoly dolga."
    ];
    const q = quotes[Math.floor(Math.random() * quotes.length)];
    document.getElementById('quoteText').innerText = q;
    document.getElementById('quoteModal').classList.add('visible');
}

function toggleFavoritesView() {
    isFavoritesMode = !isFavoritesMode;
    const btn = document.getElementById('favFilterBtn');
    if (isFavoritesMode) { btn.classList.add('active'); btn.innerHTML = '★ Csak a kedvenceim'; } 
    else { btn.classList.remove('active'); btn.innerHTML = '★ Kedvenceim'; }
    doSearch();
}

function toggleTypeFilter(type) {
    if (isGastroMode) {
        isGastroMode = false;
        document.getElementById('btnHolEgyek').classList.remove('active');
        document.getElementById('secretGastroCard').style.display = 'none';
    }

    if (currentTypeFilter === type) { currentTypeFilter = null; } 
    else { currentTypeFilter = type; }

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (currentTypeFilter) { document.getElementById('leg-' + currentTypeFilter).classList.add('active'); }

    doSearch();
}

function filterVenue(badgeElement, event) {
    if(event) event.stopPropagation();
    const input = document.getElementById('searchInput');
    const venueName = badgeElement.innerText.trim();
    if(input.value === venueName) { input.value = ""; } 
    else { input.value = venueName; }
    doSearch();
}

function showDay(index, btn) {
    document.querySelectorAll('.day-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('day-' + index).classList.add('active');
    if(btn) btn.classList.add('active');
    activeTabBeforeSearch = index;
    
    document.getElementById('searchInput').value = "";
    isFavoritesMode = false;
    currentTypeFilter = null;
    document.getElementById('favFilterBtn').classList.remove('active');
    document.getElementById('favFilterBtn').innerHTML = '★ Kedvenceim';
    document.querySelectorAll('.filter-btn').forEach(el => el.classList.remove('active'));
    
    if (isGastroMode) {
        isGastroMode = false;
        document.getElementById('btnHolEgyek').classList.remove('active');
        document.getElementById('secretGastroCard').style.display = 'none';
    }
    
    doSearch();
    setTimeout(scrollToCurrent, 300); 
}

function doSearch() {
    let queryRaw = document.getElementById('searchInput').value.toLowerCase().trim();
    const query = queryRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    
    const dayPanels = document.querySelectorAll('.day-panel');
    const tabsWrap = document.getElementById('tabsWrap');
    const scrollHint = document.getElementById('scrollHint');

    if(query === "laszlo") {
        const vitez = document.getElementById('vitezLaszlo');
        vitez.classList.add('show');
        trackEvent('easter_egg_found', { type: 'vitez_laszlo' });
        setTimeout(() => { 
            vitez.classList.remove('show'); 
            document.getElementById('searchInput').value = ""; 
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
            document.getElementById('searchInput').value = ""; 
            doSearch();
        }, 5000); 
        return;
    }

    if(['sor','bor','froccs','kave','bufe'].includes(query)) {
        tabsWrap.style.display = 'none';
        scrollHint.style.display = 'none';
        document.querySelectorAll('.day-panel').forEach(p => p.style.display = 'none');
        document.getElementById('noResultsMsg').style.display = 'none';
        document.getElementById('secretGastroCard').style.display = 'none';
        document.getElementById('secretBufeCard').style.display = 'block';
        trackEvent('easter_egg_found', { type: 'titkos_bufe' });
        return;
    } else {
        document.getElementById('secretBufeCard').style.display = 'none';
    }

    if (!isGastroMode) { document.getElementById('secretGastroCard').style.display = 'none'; } 
    else { return; }

    if (query === "" && !isFavoritesMode && !currentTypeFilter) {
        tabsWrap.style.display = 'flex';
        if (window.innerWidth <= 650) scrollHint.style.display = 'block';
        document.getElementById('noResultsMsg').style.display = 'none';
        dayPanels.forEach(panel => {
            panel.style.display = '';
            const dayTitle = panel.querySelector('.search-day-title');
            if(dayTitle) dayTitle.style.display = 'none';
            
            panel.querySelectorAll('.event-card').forEach(card => card.style.display = 'block');
            panel.querySelectorAll('.slot-time').forEach(time => time.style.display = 'block');
        });
        document.querySelectorAll('.day-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('day-' + activeTabBeforeSearch).classList.add('active');
        return;
    }

    tabsWrap.style.display = 'none';
    scrollHint.style.display = 'none';
    let hasAnyMatchTotal = false;
    
    dayPanels.forEach((panel, index) => {
        panel.classList.add('active');
        let hasMatchInDay = false;

        let dayTitle = panel.querySelector('.search-day-title');
        if(!dayTitle) {
            dayTitle = document.createElement('h3');
            dayTitle.className = 'search-day-title';
            const btnText = document.querySelectorAll('.tab-btn')[index].getAttribute('data-day-name');
            dayTitle.innerText = btnText;
            panel.prepend(dayTitle);
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
                if(currentTypeFilter === 'public') { isMatchType = card.querySelector('.badge-public') !== null; } 
                else { isMatchType = card.classList.contains(currentTypeFilter); }
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

        if(hasMatchInDay) { panel.style.display = 'block'; dayTitle.style.display = 'block'; } 
        else { panel.style.display = 'none'; dayTitle.style.display = 'none'; }
    });

    if(!hasAnyMatchTotal && query !== "") { document.getElementById('noResultsMsg').style.display = 'block'; } 
    else { document.getElementById('noResultsMsg').style.display = 'none'; }
}

// APP TELEPÍTÉS LOGIKÁJA
let deferredPrompt;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if(!isStandalone) {
        document.getElementById('installAppBtn').style.display = 'inline-flex';
    }
});

// ==========================================
// 🛠 DOM BETÖLTÉSE UTÁNI ESEMÉNYEK (BINDING)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    
    // Service Worker
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW hiba', err));

    // Telepítés gomb iPhone fallback
    if (isIOS && !isStandalone) { document.getElementById('installAppBtn').style.display = 'inline-flex'; }

    // Eseménykezelők rákötése a gombokra (Nincsenek többé onClick-ek a HTML-ben!)
    document.getElementById('installAppBtn').addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') { document.getElementById('installAppBtn').style.display = 'none'; }
            deferredPrompt = null;
        } else if (isIOS) {
            showToast("Apple iOS: Lent a böngészőben bökj a [Megosztás ⬆] ikonra, majd a [Főképernyőhöz adás ➕] gombra!");
        }
    });

    document.getElementById('searchInput').addEventListener('keyup', debounce(doSearch, 300));
    document.getElementById('jumpBtn').addEventListener('click', scrollToCurrent);
    document.getElementById('topAlertBar').addEventListener('click', () => openAlertsModal());
    document.getElementById('closeAlertsBtn').addEventListener('click', closeAlertsModal);
    document.getElementById('gbSubmitBtn').addEventListener('click', submitGuestbook);
    document.getElementById('gbPhotoInput').addEventListener('change', handlePhotoSelect);
    document.getElementById('closeGuestbookBtn').addEventListener('click', () => { document.getElementById('guestbookModal').classList.remove('visible'); });
    document.getElementById('ciSubmitBtn').addEventListener('click', submitCheckin);
    document.getElementById('ciCloseBtn').addEventListener('click', () => { document.getElementById('checkinModal').classList.remove('visible'); });
    document.getElementById('quoteCloseBtn').addEventListener('click', () => { document.getElementById('quoteModal').classList.remove('visible'); });
    
    // Gyorslinkek
    document.getElementById('favFilterBtn').addEventListener('click', toggleFavoritesView);
    document.getElementById('btnGuestbook').addEventListener('click', openGuestbook);
    document.getElementById('btnQuote').addEventListener('click', generateQuote);
    document.getElementById('btnHolEgyek').addEventListener('click', toggleGastroCard);
    document.getElementById('btnCheckin').addEventListener('click', openCheckin);

    // Szűrők
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => toggleTypeFilter(btn.getAttribute('data-filter')));
    });

    // Fülek (Tabs)
    document.querySelectorAll('.tab-btn').forEach((btn, index) => {
        btn.addEventListener('click', () => showDay(index, btn));
    });

   // Kártya lenyitás (Javított, könnyen kattintható verzió)
    document.querySelectorAll('.card-header').forEach(header => {
        header.addEventListener('click', function(e) {
            // CSAK akkor nem nyílik le, ha a csillagra vagy a piros "!" ikonra böktek
            if(!e.target.closest('.star-btn') && !e.target.closest('.mini-pulse-alert')) { 
                toggleCard(this); 
            }
        });
    });

    // Delegált eseménykezelők (Helyszín szűrés, Nyilvános szűrés, Kis riasztó ikonok, Kedvencek csillag)
    document.getElementById('mainContent').addEventListener('click', (e) => {
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

    // Delegált esemény a módosítás/visszavonás/térképhez ugrás gombokra
    document.getElementById('myCheckinStatus').addEventListener('click', (e) => {
        if(e.target.matches('.checkin-action-modify')) { openCheckin(); } 
        else if (e.target.matches('.checkin-action-revoke')) { revokeCheckin(e); }
        else if (e.target.closest('.jump-to-map')) { document.getElementById('infoBoxBottom').scrollIntoView({behavior: 'smooth'}); }
    });

    // Kacsintós PDF letöltés
    const pdfBtn = document.querySelector('.pdf-dl-btn');
    const pdfOverlay = document.getElementById('pdfOverlay');
    if(pdfBtn && pdfOverlay) {
        pdfBtn.addEventListener('click', function(e) {
            e.preventDefault(); 
            const targetUrl = this.href;
            pdfOverlay.classList.add('show');
            setTimeout(() => {
                window.open(targetUrl, '_blank');
                setTimeout(() => { pdfOverlay.classList.remove('show'); }, 500);
            }, 1800);
        });
    }

    // Touch animációk logókhoz
    document.querySelectorAll('.gastro-logo, .sponsor-logo').forEach(logo => {
        logo.addEventListener('touchstart', function() {
            this.classList.add('active-touch');
            setTimeout(() => this.classList.remove('active-touch'), 1500);
        });
    });

    // Csillagok állapotának visszaállítása
    document.querySelectorAll('.event-card').forEach(card => {
        if(card.id && localStorage.getItem('fav_' + card.id)) {
            const star = card.querySelector('.star-btn');
            if(star) star.classList.add('active');
        }
    });

    // Checkin URL feldolgozása
    const urlParams = new URLSearchParams(window.location.search);
    const checkinVenueId = urlParams.get('checkin');
    if(checkinVenueId && venueNames[checkinVenueId]) {
        setTimeout(() => {
            document.getElementById('ciVenue').value = checkinVenueId;
            const savedName = localStorage.getItem('myCheckinName');
            if(savedName) document.getElementById('checkinNameInput').value = savedName;
            openCheckin();
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 1000);
    }

    // Alap inicializálás
    restoreCheckinUI();
    initPostFestivalMode();
    checkLiveEvents();
    setInterval(checkLiveEvents, 60000);
    
    // Görgertés figyelése a gombhoz
    window.addEventListener('scroll', () => {
        const jumpBtn = document.getElementById('jumpBtn');
        if (document.querySelector('.day-panel.active .is-live')) jumpBtn.classList.add('show');
        else jumpBtn.classList.remove('show');
    });

    // Analytics observer
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
});

document.getElementById('btnShare').addEventListener('click', async () => {
    if (navigator.share) {
        try {
            await navigator.share({
                title: '17. Bábszínházi Találkozó',
                text: 'Kecskemét, 2026. június 13-18. Nézd meg a programot és gyere te is!',
                url: window.location.href
            });
            trackEvent('app_shared'); // Ha akarod mérni GA4-ben
        } catch (err) {
            console.log('Megosztás megszakítva', err);
        }
    } else {
        // Ha asztali gépen van, ahol nincs natív megosztás
        navigator.clipboard.writeText(window.location.href);
        showToast('Link másolva a vágólapra!');
    }
});