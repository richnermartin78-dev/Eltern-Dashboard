
"use strict";

const STORAGE_KEY = "journal.entries.v2";
const DELETE_KEY = "journal.deleted.v2";
const SETTINGS_KEY = "journal.settings.v2";
const CLOUD_KEY = "journal.cloud.v2";
const LAST_SYNC_KEY = "journal.lastSync.v2";

const feelingsList = ["ruhig","zufrieden","traurig","wütend","ängstlich","gestresst","unsicher","motiviert","stolz","erschöpft"];
const selfcareList = ["Bewegung","Ruhe","Kreativität","Freunde/Familie","Natur","Musik","Zeit für mich"];
const moodEmoji = ["","😞","😕","😐","🙂","😊"];

let selectedMood = 3;
let selectedFeelings = new Set();
let selectedSelfcare = new Set();
let statsDays = 7;
let calendarDate = new Date();
let deferredPrompt = null;
let sb = null;
let currentUser = null;
let syncRunning = false;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pad = n => String(n).padStart(2,"0");

function localISO(d=new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function esc(s=""){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
function parseJSON(s,fallback){ try{return JSON.parse(s)}catch{return fallback} }
function getEntries(){ return parseJSON(localStorage.getItem(STORAGE_KEY)||"[]",[]); }
function setEntries(v){ localStorage.setItem(STORAGE_KEY,JSON.stringify(v)); }
function getDeleteQueue(){ return parseJSON(localStorage.getItem(DELETE_KEY)||"[]",[]); }
function setDeleteQueue(v){ localStorage.setItem(DELETE_KEY,JSON.stringify([...new Set(v)])); }
function getSettings(){ return parseJSON(localStorage.getItem(SETTINGS_KEY)||"{}",{}); }
function getCloudLocal(){ return parseJSON(localStorage.getItem(CLOUD_KEY)||"{}",{}); }

function toast(msg){
  const t=$("#toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>t.classList.remove("show"),2100);
}
function niceDate(dateStr){
  return new Date(dateStr+"T12:00:00").toLocaleDateString("de-CH",{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"});
}
function updateTodayLabel(){
  $("#todayLabel").textContent=new Date().toLocaleDateString("de-CH",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
}
function buildChips(){
  $("#feelings").innerHTML=feelingsList.map(x=>`<button class="chip" data-kind="feeling" data-v="${x}">${x}</button>`).join("");
  $("#selfcare").innerHTML=selfcareList.map(x=>`<button class="chip" data-kind="selfcare" data-v="${x}">${x}</button>`).join("");
  $$(".chip").forEach(btn=>btn.addEventListener("click",()=>{
    const set=btn.dataset.kind==="feeling"?selectedFeelings:selectedSelfcare;
    set.has(btn.dataset.v)?set.delete(btn.dataset.v):set.add(btn.dataset.v);
    btn.classList.toggle("active");
  }));
}
function setMood(v){
  selectedMood=Number(v);
  $$(".mood-btn").forEach(b=>b.classList.toggle("active",Number(b.dataset.v)===selectedMood));
}
function bindSliders(){
  [["energy","energyVal"],["tension","tensionVal"],["sleep","sleepVal"]].forEach(([id,out])=>{
    $("#"+id).addEventListener("input",e=>$("#"+out).textContent=e.target.value);
  });
}
function clearForm(keepDate=true){
  setMood(3); selectedFeelings.clear(); selectedSelfcare.clear();
  $$(".chip").forEach(c=>c.classList.remove("active"));
  [["energy",5],["tension",5],["sleep",3]].forEach(([id,v])=>{$("#"+id).value=v;$("#"+id+"Val").textContent=v});
  ["thoughts","good","hard","helped","moment","tomorrow"].forEach(id=>$("#"+id).value="");
  if(!keepDate) $("#entryDate").value=localISO();
  $("#formStatus").textContent="";
}
function saveEntry(){
  const date=$("#entryDate").value||localISO();
  const now=new Date().toISOString();
  const entry={
    date,mood:selectedMood,energy:+$("#energy").value,tension:+$("#tension").value,sleep:+$("#sleep").value,
    thoughts:$("#thoughts").value.trim(),good:$("#good").value.trim(),hard:$("#hard").value.trim(),
    helped:$("#helped").value.trim(),moment:$("#moment").value.trim(),tomorrow:$("#tomorrow").value.trim(),
    feelings:[...selectedFeelings],selfcare:[...selectedSelfcare],modifiedAt:now,dirty:true
  };
  let entries=getEntries();
  const i=entries.findIndex(e=>e.date===date);
  if(i>=0) entries[i]=entry; else entries.push(entry);
  entries.sort((a,b)=>a.date.localeCompare(b.date)); setEntries(entries);
  $("#formStatus").textContent=`Gespeichert: ${niceDate(date)}`;
  renderAll(); toast(i>=0?"Eintrag aktualisiert":"Eintrag gespeichert");
  if(currentUser && navigator.onLine) syncNow(false);
}
function loadEntry(date){
  const e=getEntries().find(x=>x.date===date);
  clearForm(); $("#entryDate").value=date;
  if(!e){$("#formStatus").textContent="Neuer Eintrag";return}
  setMood(e.mood||3);
  [["energy",e.energy??5],["tension",e.tension??5],["sleep",e.sleep??3]].forEach(([id,v])=>{$("#"+id).value=v;$("#"+id+"Val").textContent=v});
  ["thoughts","good","hard","helped","moment","tomorrow"].forEach(id=>$("#"+id).value=e[id]||"");
  selectedFeelings=new Set(e.feelings||[]);selectedSelfcare=new Set(e.selfcare||[]);
  $$(".chip").forEach(c=>{const set=c.dataset.kind==="feeling"?selectedFeelings:selectedSelfcare;c.classList.toggle("active",set.has(c.dataset.v))});
  $("#formStatus").textContent=e.dirty?"Lokal gespeichert · Synchronisierung ausstehend":"Gespeichert und synchronisiert";
}
function go(screen){
  $$(".screen").forEach(s=>s.classList.toggle("active",s.id==="screen-"+screen));
  $$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.screen===screen));
  if(screen==="history"){renderHistory();renderCalendar()}
  if(screen==="stats")renderStats();
  if(screen==="settings")loadSettingsUI();
  window.scrollTo({top:0,behavior:"smooth"});
}
function renderHistory(){
  const q=$("#historySearch").value.trim().toLowerCase();
  let entries=getEntries().slice().sort((a,b)=>b.date.localeCompare(a.date));
  if(q)entries=entries.filter(e=>JSON.stringify(e).toLowerCase().includes(q));
  const el=$("#historyList");
  if(!entries.length){el.innerHTML='<div class="empty-state">Noch keine passenden Einträge.</div>';return}
  el.innerHTML=entries.map(e=>{
    const preview=e.moment||e.good||e.thoughts||e.hard||"Kein Freitext.";
    return `<div class="entry">
      <div class="entry-top"><div class="entry-date">${niceDate(e.date)}</div><div class="entry-mood">${moodEmoji[e.mood]||"😐"}</div></div>
      <div class="entry-preview">${esc(preview.slice(0,220))}${preview.length>220?"…":""}</div>
      <div class="entry-meta">
        <span class="mini">⚡ ${e.energy}/10</span><span class="mini">🧠 ${e.tension}/10</span><span class="mini">😴 ${e.sleep}/5</span>
        <span class="mini">${e.dirty?"☁️ wartet":"✓ Cloud"}</span>
      </div>
      <div class="entry-actions"><button onclick="editEntry('${e.date}')">Öffnen</button><button onclick="deleteEntry('${e.date}')">Löschen</button></div>
    </div>`;
  }).join("");
}
window.editEntry=date=>{go("today");loadEntry(date)};
window.deleteEntry=date=>{
  if(!confirm(`Eintrag vom ${niceDate(date)} wirklich löschen?`))return;
  setEntries(getEntries().filter(e=>e.date!==date));
  setDeleteQueue([...getDeleteQueue(),date]);
  renderAll(); toast("Eintrag gelöscht");
  if(currentUser&&navigator.onLine)syncNow(false);
};
function renderStats(){
  const entries=getEntries().slice().sort((a,b)=>a.date.localeCompare(b.date));
  const end=new Date();end.setHours(23,59,59,999);
  const start=new Date();start.setDate(start.getDate()-(statsDays-1));start.setHours(0,0,0,0);
  const rows=entries.filter(e=>{const d=new Date(e.date+"T12:00:00");return d>=start&&d<=end});
  const avg=k=>rows.length?(rows.reduce((s,e)=>s+(Number(e[k])||0),0)/rows.length).toFixed(1):"–";
  $("#avgMood").textContent=avg("mood");$("#avgEnergy").textContent=avg("energy");$("#avgTension").textContent=avg("tension");$("#avgSleep").textContent=avg("sleep");
  drawChart(rows);
}
function drawChart(rows){
  const c=$("#chart"),ctx=c.getContext("2d"),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);
  const dark=matchMedia("(prefers-color-scheme: dark)").matches;
  ctx.fillStyle=dark?"#111827":"#fff";ctx.fillRect(0,0,w,h);
  const left=42,right=18,top=24,bottom=42,pw=w-left-right,ph=h-top-bottom;
  ctx.strokeStyle=dark?"#374151":"#e5e7eb";ctx.lineWidth=1;ctx.fillStyle=dark?"#9ca3af":"#6b7280";ctx.font="11px system-ui";
  for(let y=0;y<=10;y+=2){const py=top+ph-(y/10)*ph;ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(w-right,py);ctx.stroke();ctx.fillText(String(y),12,py+4)}
  if(!rows.length){ctx.fillText("Noch keine Daten in diesem Zeitraum.",left+15,top+ph/2);return}
  const xs=rows.map((_,i)=>left+(rows.length===1?pw/2:i*pw/(rows.length-1)));
  const series=[{k:"mood",label:"Stimmung",scale:2,dash:[]},{k:"energy",label:"Energie",scale:1,dash:[6,3]},{k:"tension",label:"Anspannung",scale:1,dash:[2,3]},{k:"sleep",label:"Schlaf",scale:2,dash:[10,4]}];
  const palette=dark?["#93c5fd","#86efac","#fca5a5","#fde68a"]:["#2563eb","#059669","#dc2626","#ca8a04"];
  series.forEach((s,si)=>{ctx.strokeStyle=palette[si];ctx.lineWidth=2.2;ctx.setLineDash(s.dash);ctx.beginPath();rows.forEach((r,i)=>{const v=Math.max(0,Math.min(10,(Number(r[s.k])||0)*s.scale)),y=top+ph-(v/10)*ph;i?ctx.lineTo(xs[i],y):ctx.moveTo(xs[i],y)});ctx.stroke();ctx.setLineDash([])});
  rows.forEach((r,i)=>{if(rows.length<=10||i%Math.ceil(rows.length/8)===0){ctx.fillStyle=dark?"#9ca3af":"#6b7280";ctx.fillText(r.date.slice(5),xs[i]-15,h-18)}});
  let lx=left;series.forEach((s,si)=>{ctx.fillStyle=palette[si];ctx.fillRect(lx,8,10,3);ctx.fillStyle=dark?"#d1d5db":"#374151";ctx.fillText(s.label,lx+14,13);lx+=95});
}
function renderCalendar(){
  const y=calendarDate.getFullYear(),m=calendarDate.getMonth();
  $("#monthTitle").textContent=new Date(y,m,1).toLocaleDateString("de-CH",{month:"long",year:"numeric"});
  const days=["Mo","Di","Mi","Do","Fr","Sa","So"],first=new Date(y,m,1),offset=(first.getDay()+6)%7,count=new Date(y,m+1,0).getDate();
  const byDate=Object.fromEntries(getEntries().map(e=>[e.date,e]));
  let html=days.map(d=>`<div class="dow">${d}</div>`).join("");
  for(let i=0;i<offset;i++)html+='<div class="day empty"></div>';
  for(let d=1;d<=count;d++){const ds=`${y}-${pad(m+1)}-${pad(d)}`,e=byDate[ds];html+=`<button class="day ${e?"has":""} ${ds===localISO()?"today":""}" onclick="calendarOpen('${ds}')"><span>${d}</span><span class="dot">${e?moodEmoji[e.mood]:""}</span></button>`}
  $("#calendar").innerHTML=html;
}
window.calendarOpen=ds=>{go("today");loadEntry(ds)};

function renderAll(){renderHistory();renderStats();renderCalendar();updateSyncBadge()}
function migrateV1(){
  if(localStorage.getItem(STORAGE_KEY))return;
  const old=parseJSON(localStorage.getItem("journal.entries.v1")||"[]",[]);
  if(!old.length)return;
  const migrated=old.map(e=>({...e,modifiedAt:e.updatedAt||new Date().toISOString(),dirty:true}));
  setEntries(migrated);toast(`${migrated.length} ältere Einträge übernommen`);
}
function applySettings(){
  const s=getSettings(),name=s.name||"Mein Tagebuch";$("#appTitle").textContent=name;document.title=name;
}
function loadSettingsUI(){
  const s=getSettings(),cloud=getEffectiveCloud();
  $("#journalName").value=s.name||"Mein Tagebuch";$("#supabaseUrl").value=cloud.url||"";$("#supabaseKey").value=cloud.key||"";
  const ls=localStorage.getItem(LAST_SYNC_KEY);$("#lastSync").textContent=ls?`Letzte Synchronisierung: ${new Date(ls).toLocaleString("de-CH")}`:"Noch nicht synchronisiert.";
  renderAuthUI();
}
function saveSettings(){
  const name=$("#journalName").value.trim()||"Mein Tagebuch";localStorage.setItem(SETTINGS_KEY,JSON.stringify({name}));applySettings();toast("Einstellungen gespeichert");
}
function getEffectiveCloud(){
  const local=getCloudLocal(),built=window.JOURNAL_CONFIG||{};
  return {url:(local.url||built.supabaseUrl||"").trim(),key:(local.key||built.supabasePublishableKey||"").trim()};
}
async function initSupabase(){
  const c=getEffectiveCloud();
  if(!c.url||!c.key||!window.supabase){sb=null;currentUser=null;renderAuthUI();updateSyncBadge();return false}
  try{
    sb=window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data,error}=await sb.auth.getSession();if(error)throw error;
    currentUser=data.session?.user||null;
    sb.auth.onAuthStateChange((_event,session)=>{currentUser=session?.user||null;renderAuthUI();updateSyncBadge();if(currentUser&&navigator.onLine)setTimeout(()=>syncNow(false),100)});
    renderAuthUI();updateSyncBadge();
    if(currentUser&&navigator.onLine)syncNow(false);
    return true;
  }catch(err){sb=null;currentUser=null;updateSyncBadge("error");toast("Supabase-Verbindung fehlgeschlagen");console.error(err);return false}
}
async function saveCloudConfig(){
  const url=$("#supabaseUrl").value.trim(),key=$("#supabaseKey").value.trim();
  if(!url||!key){alert("Bitte Project URL und Publishable Key eintragen.");return}
  if(key.startsWith("sb_secret_")||key.toLowerCase().includes("service_role")){alert("Nicht verwenden: Secret-/Service-Role-Key. Bitte den Publishable Key nehmen.");return}
  localStorage.setItem(CLOUD_KEY,JSON.stringify({url,key}));
  await initSupabase();toast(sb?"Cloud-Verbindung gespeichert":"Konfiguration gespeichert – Verbindung prüfen");
}
async function forgetCloud(){
  if(!confirm("Cloud-Verbindung auf diesem Gerät entfernen? Lokale Tagebucheinträge bleiben erhalten."))return;
  if(sb)try{await sb.auth.signOut()}catch{}
  localStorage.removeItem(CLOUD_KEY);sb=null;currentUser=null;$("#supabaseUrl").value="";$("#supabaseKey").value="";renderAuthUI();updateSyncBadge();toast("Cloud-Verbindung entfernt");
}
function renderAuthUI(){
  const configured=!!sb;
  $("#signedOutBox").classList.toggle("hidden",!!currentUser);
  $("#signedInBox").classList.toggle("hidden",!currentUser);
  if(currentUser)$("#accountEmail").textContent=currentUser.email||currentUser.id;
  $("#authNotice").classList.toggle("hidden",!!currentUser);
  if(!configured&&!currentUser)$("#authNotice .note").textContent="Die App funktioniert lokal. Unter Einstellungen kannst du Supabase verbinden und dich anmelden.";
  else if(configured&&!currentUser)$("#authNotice .note").textContent="Supabase ist verbunden. Melde dich unter Einstellungen an, um zu synchronisieren.";
}
async function signIn(){
  if(!sb){alert("Zuerst Supabase Project URL und Publishable Key speichern.");return}
  const email=$("#authEmail").value.trim(),password=$("#authPassword").value;
  if(!email||!password){alert("E-Mail und Passwort eingeben.");return}
  const {error}=await sb.auth.signInWithPassword({email,password});
  if(error){alert("Anmeldung fehlgeschlagen: "+error.message);return}
  toast("Angemeldet");go("today");
}
async function signUp(){
  if(!sb){alert("Zuerst Supabase Project URL und Publishable Key speichern.");return}
  const email=$("#authEmail").value.trim(),password=$("#authPassword").value;
  if(!email||password.length<8){alert("Bitte gültige E-Mail und mindestens 8 Zeichen Passwort verwenden.");return}
  const redirectTo=location.origin+location.pathname;
  const {data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}});
  if(error){alert("Registrierung fehlgeschlagen: "+error.message);return}
  if(data.session){toast("Konto erstellt und angemeldet");go("today")}else alert("Konto erstellt. Bitte bestätige die E-Mail, falls Supabase eine Bestätigung verlangt.");
}
async function signOut(){
  if(sb)await sb.auth.signOut();currentUser=null;renderAuthUI();updateSyncBadge();toast("Abgemeldet");
}
function toRemote(e){
  return {
    user_id:currentUser.id,entry_date:e.date,mood:e.mood,energy:e.energy,tension:e.tension,sleep:e.sleep,
    thoughts:e.thoughts||"",good:e.good||"",hard:e.hard||"",helped:e.helped||"",moment:e.moment||"",tomorrow:e.tomorrow||"",
    feelings:e.feelings||[],selfcare:e.selfcare||[],client_modified_at:e.modifiedAt||new Date().toISOString()
  };
}
function fromRemote(r){
  return {
    date:r.entry_date,mood:r.mood,energy:r.energy,tension:r.tension,sleep:r.sleep,thoughts:r.thoughts||"",good:r.good||"",
    hard:r.hard||"",helped:r.helped||"",moment:r.moment||"",tomorrow:r.tomorrow||"",feelings:r.feelings||[],selfcare:r.selfcare||[],
    modifiedAt:r.client_modified_at||r.server_updated_at||new Date().toISOString(),dirty:false
  };
}
async function syncNow(showToast=true){
  if(syncRunning)return;
  if(!sb||!currentUser){if(showToast)toast("Nicht angemeldet");return}
  if(!navigator.onLine){if(showToast)toast("Offline – später synchronisieren");return}
  syncRunning=true;updateSyncBadge("syncing");
  try{
    let entries=getEntries();
    let deleteQueue=getDeleteQueue();

    // 1) Explicit offline deletions are sent first.
    for(const date of deleteQueue){
      const {error}=await sb.from("journal_entries").delete().eq("user_id",currentUser.id).eq("entry_date",date);
      if(error)throw error;
    }
    if(deleteQueue.length){setDeleteQueue([]);deleteQueue=[]}

    // 2) Read remote state. RLS restricts this to the signed-in user.
    const {data:remote,error:readError}=await sb.from("journal_entries").select("*").eq("user_id",currentUser.id).order("entry_date");
    if(readError)throw readError;
    const remoteMap=new Map((remote||[]).map(r=>[r.entry_date,r]));
    const localMap=new Map(entries.map(e=>[e.date,e]));

    // 3) Merge. Newer modifiedAt wins. Dirty local-only entries are uploaded.
    for(const e of entries){
      const r=remoteMap.get(e.date);
      const lt=Date.parse(e.modifiedAt||0)||0,rt=Date.parse(r?.client_modified_at||r?.server_updated_at||0)||0;
      if(e.dirty && (!r || lt>=rt)){
        const {error}=await sb.from("journal_entries").upsert(toRemote(e),{onConflict:"user_id,entry_date"});
        if(error)throw error;e.dirty=false;
      }else if(r && rt>lt){
        Object.assign(e,fromRemote(r));
      }else if(r && e.dirty){
        e.dirty=false;
      }
    }

    // 4) Pull cloud-only entries. Remove local clean entries that were deleted on another device.
    const afterDates=new Set((remote||[]).map(r=>r.entry_date));
    entries=entries.filter(e=>e.dirty||afterDates.has(e.date)||remoteMap.has(e.date));
    const present=new Set(entries.map(e=>e.date));
    for(const r of (remote||[])){
      if(!present.has(r.entry_date)){entries.push(fromRemote(r));present.add(r.entry_date)}
    }

    // 5) Re-fetch to include uploads from this sync and converge both sides.
    const {data:fresh,error:freshError}=await sb.from("journal_entries").select("*").eq("user_id",currentUser.id).order("entry_date");
    if(freshError)throw freshError;
    const dirtyByDate=new Map(entries.filter(e=>e.dirty).map(e=>[e.date,e]));
    const merged=(fresh||[]).map(r=>dirtyByDate.get(r.entry_date)||fromRemote(r));
    for(const e of entries){if(e.dirty&&!merged.some(x=>x.date===e.date))merged.push(e)}
    merged.sort((a,b)=>a.date.localeCompare(b.date));setEntries(merged);

    const now=new Date().toISOString();localStorage.setItem(LAST_SYNC_KEY,now);
    $("#lastSync").textContent=`Letzte Synchronisierung: ${new Date(now).toLocaleString("de-CH")}`;
    renderAll();loadEntry($("#entryDate").value||localISO());updateSyncBadge("online");
    if(showToast)toast("Synchronisierung abgeschlossen");
  }catch(err){
    console.error(err);updateSyncBadge("error");
    if(showToast)alert("Synchronisierung fehlgeschlagen: "+(err.message||err));
  }finally{syncRunning=false}
}
function updateSyncBadge(force){
  const b=$("#syncBadge");
  b.className="sync-badge";
  if(force==="syncing"){b.classList.add("syncing");b.textContent="↻ Sync";return}
  if(force==="error"){b.classList.add("error");b.textContent="! Fehler";return}
  if(currentUser&&navigator.onLine){b.classList.add("online");b.textContent="● Cloud"}
  else if(!navigator.onLine)b.textContent="○ Offline";
  else b.textContent="● Lokal";
}
function exportFile(name,type,text){
  const blob=new Blob([text],{type}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}
function exportJSON(){
  exportFile(`tagebuch-backup-${localISO()}.json`,"application/json",JSON.stringify({version:2,exportedAt:new Date().toISOString(),settings:getSettings(),entries:getEntries().map(({dirty,...e})=>e)},null,2));
}
function csvCell(v){v=Array.isArray(v)?v.join("; "):(v??"");return `"${String(v).replaceAll('"','""')}"`}
function exportCSV(){
  const cols=["date","mood","energy","tension","sleep","feelings","selfcare","thoughts","good","hard","helped","moment","tomorrow"];
  const rows=[cols.join(",")].concat(getEntries().map(e=>cols.map(k=>csvCell(e[k])).join(",")));
  exportFile(`tagebuch-${localISO()}.csv`,"text/csv;charset=utf-8","\ufeff"+rows.join("\n"));
}
async function importJSON(file){
  try{
    const data=JSON.parse(await file.text());if(!Array.isArray(data.entries))throw new Error("Ungültiges Backup");
    if(!confirm(`${data.entries.length} Einträge importieren und vorhandene lokale Daten ersetzen?`))return;
    const now=new Date().toISOString(),entries=data.entries.map(e=>({...e,modifiedAt:e.modifiedAt||e.updatedAt||now,dirty:true}));
    setEntries(entries);if(data.settings)localStorage.setItem(SETTINGS_KEY,JSON.stringify(data.settings));
    applySettings();renderAll();toast("Backup importiert");if(currentUser&&navigator.onLine)syncNow(false);
  }catch(e){alert("Import fehlgeschlagen: "+e.message)}
}

$$(".nav-btn").forEach(b=>b.addEventListener("click",()=>go(b.dataset.screen)));
$$("[data-goto]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.goto)));
$$(".mood-btn").forEach(b=>b.addEventListener("click",()=>setMood(b.dataset.v)));
$("#saveBtn").addEventListener("click",saveEntry);
$("#clearBtn").addEventListener("click",()=>{if(confirm("Felder des aktuellen Formulars leeren?"))clearForm()});
$("#entryDate").addEventListener("change",e=>loadEntry(e.target.value));
$("#historySearch").addEventListener("input",renderHistory);
$("#prevMonth").addEventListener("click",()=>{calendarDate.setMonth(calendarDate.getMonth()-1);renderCalendar()});
$("#nextMonth").addEventListener("click",()=>{calendarDate.setMonth(calendarDate.getMonth()+1);renderCalendar()});
$$(".seg button").forEach(b=>b.addEventListener("click",()=>{statsDays=+b.dataset.days;$$(".seg button").forEach(x=>x.classList.toggle("active",x===b));renderStats()}));
$("#saveSettings").addEventListener("click",saveSettings);
$("#connectCloud").addEventListener("click",saveCloudConfig);
$("#forgetCloud").addEventListener("click",forgetCloud);
$("#signInBtn").addEventListener("click",signIn);
$("#signUpBtn").addEventListener("click",signUp);
$("#signOutBtn").addEventListener("click",signOut);
$("#syncNowBtn").addEventListener("click",()=>syncNow(true));
$("#syncBadge").addEventListener("click",()=>currentUser?syncNow(true):go("settings"));
$("#exportJson").addEventListener("click",exportJSON);
$("#exportCsv").addEventListener("click",exportCSV);
$("#importBtn").addEventListener("click",()=>$("#importFile").click());
$("#importFile").addEventListener("change",e=>e.target.files[0]&&importJSON(e.target.files[0]));
$("#deleteAll").addEventListener("click",()=>{
  if(!confirm("Wirklich ALLE lokalen Tagebuchdaten löschen? Cloud-Daten werden dadurch nicht automatisch gelöscht."))return;
  localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(DELETE_KEY);renderAll();clearForm(false);toast("Lokale Einträge gelöscht");
});
window.addEventListener("online",()=>{updateSyncBadge();if(currentUser)syncNow(false)});
window.addEventListener("offline",updateSyncBadge);

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("#installBtn").style.display="block"});
$("#installBtn").addEventListener("click",async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("#installBtn").style.display="none"});

(async function boot(){
  migrateV1();bindSliders();buildChips();updateTodayLabel();applySettings();
  $("#entryDate").value=localISO();setMood(3);loadEntry(localISO());renderAll();
  if("serviceWorker" in navigator&&location.protocol!=="file:")navigator.serviceWorker.register("./sw.js").catch(console.warn);
  await initSupabase();loadSettingsUI();
})();
