(() => {
  const $ = (id) => document.getElementById(id);
  const cfg = window.APP_CONFIG || {};
  const validConfig = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") && !cfg.SUPABASE_ANON_KEY.includes("PASTE_");

  const state = {
    supabase: null,
    user: null,
    family: null,
    membership: null,
    children: [],
    members: [],
    items: [],
    activeChildId: "all",
    draftType: "task"
  };

  function show(id) {
    ["configScreen","authScreen","setupScreen","dashboard"].forEach(x => $(x).classList.add("hidden"));
    $(id).classList.remove("hidden");
  }

  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 2200);
  }

  function typeLabel(type) {
    return ({task:"Pendenz",event:"Termin",info:"Wichtig",decision:"Entscheid"})[type] || type;
  }

  function statusLabel(status) {
    return ({open:"Offen",in_progress:"In Bearbeitung",done:"Erledigt"})[status] || status;
  }

  function priorityLabel(priority) {
    return ({normal:"Normal",important:"Wichtig",urgent:"Dringend"})[priority] || priority;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const [y,m,d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("de-CH").format(new Date(Date.UTC(y,m-1,d)));
  }

  async function init() {
    if (!validConfig || !window.supabase) {
      show("configScreen");
      return;
    }
    state.supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const { data: { session } } = await state.supabase.auth.getSession();
    state.user = session?.user || null;
    if (!state.user) {
      show("authScreen");
      return;
    }
    await afterLogin();
  }

  async function afterLogin() {
    $("logoutBtn").classList.remove("hidden");
    const { data: membership, error } = await state.supabase
      .from("family_members")
      .select("id,family_id,display_name,role")
      .eq("user_id", state.user.id)
      .maybeSingle();

    if (error) console.error(error);

    if (!membership) {
      show("setupScreen");
      return;
    }
    state.membership = membership;
    await loadFamily();
    show("dashboard");
    renderAll();
  }

  async function loadFamily() {
    const fid = state.membership.family_id;
    const [{data:family},{data:children},{data:members},{data:items}] = await Promise.all([
      state.supabase.from("families").select("*").eq("id",fid).single(),
      state.supabase.from("children").select("*").eq("family_id",fid).order("sort_order"),
      state.supabase.from("family_members").select("id,display_name,role,user_id").eq("family_id",fid).order("created_at"),
      state.supabase.from("family_items").select("*").eq("family_id",fid).order("created_at",{ascending:false})
    ]);
    state.family = family || null;
    state.children = children || [];
    state.members = members || [];
    state.items = items || [];
  }

  function renderAll() {
    renderChildren();
    renderOwners();
    renderItems();
    $("inviteCodeDisplay").textContent = state.family?.invite_code || "--------";
  }

  function renderChildren() {
    const switcher = $("childSwitch");
    switcher.innerHTML = "";
    const allBtn = document.createElement("button");
    allBtn.type="button";
    allBtn.className="child-btn" + (state.activeChildId==="all"?" active":"");
    allBtn.textContent="Alle";
    allBtn.addEventListener("click",()=>{state.activeChildId="all";renderAll();});
    switcher.appendChild(allBtn);

    state.children.forEach(c=>{
      const b=document.createElement("button");
      b.type="button";
      b.className="child-btn"+(state.activeChildId===c.id?" active":"");
      b.textContent=c.name;
      b.addEventListener("click",()=>{state.activeChildId=c.id;renderAll();});
      switcher.appendChild(b);
    });

    $("entryChild").innerHTML="";
    state.children.forEach(c=>{
      const o=document.createElement("option");
      o.value=c.id; o.textContent=c.name;
      $("entryChild").appendChild(o);
    });

    const active = state.children.find(c=>c.id===state.activeChildId);
    $("childHeading").textContent = active ? active.name : "Alle Kinder";
  }

  function renderOwners() {
    const sel=$("entryOwner");
    sel.innerHTML="";
    [["none","Noch offen"],["child","Kind selbst"],["both","Gemeinsam"]].forEach(([v,t])=>{
      const o=document.createElement("option");o.value=v;o.textContent=t;sel.appendChild(o);
    });
    state.members.forEach(m=>{
      const o=document.createElement("option");
      o.value="member:"+m.id;o.textContent=m.display_name;
      sel.appendChild(o);
    });
  }

  function ownerLabel(value) {
    if (!value || value==="none") return "Noch offen";
    if (value==="child") return "Kind selbst";
    if (value==="both") return "Gemeinsam";
    if (value.startsWith("member:")) {
      const id=value.split(":")[1];
      return state.members.find(m=>m.id===id)?.display_name || "Elternteil";
    }
    return value;
  }

  function filteredItems() {
    const filter=$("filterType").value;
    return state.items.filter(i=>{
      const childOK=state.activeChildId==="all" || i.child_id===state.activeChildId;
      const typeOK=filter==="all" || i.item_type===filter;
      return childOK && typeOK;
    });
  }

  function renderItems() {
    const items=filteredItems();
    const open=items.filter(i=>i.status!=="done");
    $("openCount").textContent=open.length;
    $("urgentCount").textContent=open.filter(i=>i.priority==="urgent").length;
    $("decisionCount").textContent=open.filter(i=>i.item_type==="decision").length;

    const list=$("itemsList");
    list.innerHTML="";
    $("emptyState").classList.toggle("hidden", items.length!==0);

    items.forEach(i=>{
      const child=state.children.find(c=>c.id===i.child_id);
      const card=document.createElement("article");
      card.className="item";

      const left=document.createElement("div");
      const h=document.createElement("h3"); h.textContent=i.title;
      left.appendChild(h);

      const meta=document.createElement("div"); meta.className="meta";
      const badges=[
        typeLabel(i.item_type),
        child?.name || "",
        statusLabel(i.status),
        "Zuständig: "+ownerLabel(i.owner_key)
      ];
      badges.forEach(t=>{
        if(!t) return;
        const s=document.createElement("span"); s.className="badge"; s.textContent=t; meta.appendChild(s);
      });
      if(i.priority!=="normal"){
        const s=document.createElement("span");
        s.className="badge "+i.priority;
        s.textContent=priorityLabel(i.priority);
        meta.appendChild(s);
      }
      if(i.status==="done"){
        const s=document.createElement("span");s.className="badge done";s.textContent="Erledigt";meta.appendChild(s);
      }
      if(i.due_date){
        const s=document.createElement("span");s.className="badge";s.textContent=fmtDate(i.due_date);meta.appendChild(s);
      }
      left.appendChild(meta);

      if(i.details){
        const p=document.createElement("p");p.textContent=i.details;left.appendChild(p);
      }

      const actions=document.createElement("div");actions.className="item-actions";
      const edit=document.createElement("button");edit.type="button";edit.className="icon-action";edit.textContent="Öffnen";
      edit.addEventListener("click",()=>openEdit(i));
      actions.appendChild(edit);

      if(i.status!=="done"){
        const done=document.createElement("button");done.type="button";done.className="complete-action";done.textContent="✓ Erledigt";
        done.addEventListener("click",()=>markDone(i.id));
        actions.appendChild(done);
      }

      card.append(left,actions);
      list.appendChild(card);
    });

    const check=$("parentCheckList");check.innerHTML="";
    const selected=items.filter(i=>i.status!=="done" && (i.item_type==="decision" || i.priority==="urgent")).slice(0,8);
    if(!selected.length){
      const d=document.createElement("div");d.className="muted";d.textContent="Aktuell keine dringenden oder gemeinsamen Punkte.";check.appendChild(d);
    } else {
      selected.forEach(i=>{
        const d=document.createElement("div");d.className="check-row";
        const child=state.children.find(c=>c.id===i.child_id);
        d.textContent=(child?child.name+": ":"")+i.title+(i.due_date?" · "+fmtDate(i.due_date):"");
        check.appendChild(d);
      });
    }
  }

  function resetDialog(type) {
    state.draftType=type;
    $("entryId").value="";
    $("entryTitle").value="";
    $("entryDetails").value="";
    $("entryDate").value="";
    $("entryPriority").value="normal";
    $("entryOwner").value="none";
    $("entryStatus").value="open";
    $("deleteBtn").classList.add("hidden");
    $("dialogKind").textContent=typeLabel(type);
    $("dialogHeading").textContent="Neuer Eintrag";
    if(state.activeChildId!=="all") $("entryChild").value=state.activeChildId;
    else if(state.children[0]) $("entryChild").value=state.children[0].id;
  }

  function openNew(type) {
    resetDialog(type);
    $("entryDialog").showModal();
  }

  function openEdit(item) {
    state.draftType=item.item_type;
    $("entryId").value=item.id;
    $("entryChild").value=item.child_id;
    $("entryTitle").value=item.title||"";
    $("entryDetails").value=item.details||"";
    $("entryDate").value=item.due_date||"";
    $("entryPriority").value=item.priority||"normal";
    $("entryOwner").value=item.owner_key||"none";
    $("entryStatus").value=item.status||"open";
    $("deleteBtn").classList.remove("hidden");
    $("dialogKind").textContent=typeLabel(item.item_type);
    $("dialogHeading").textContent="Eintrag bearbeiten";
    $("entryDialog").showModal();
  }

  async function saveEntry(e) {
    e.preventDefault();
    $("entryMsg").textContent="";
    const id=$("entryId").value || null;
    const payload={
      family_id:state.family.id,
      child_id:$("entryChild").value,
      item_type:state.draftType,
      title:$("entryTitle").value.trim(),
      details:$("entryDetails").value.trim() || null,
      due_date:$("entryDate").value || null,
      priority:$("entryPriority").value,
      owner_key:$("entryOwner").value,
      status:$("entryStatus").value,
      updated_by:state.user.id
    };
    if(!payload.title){$("entryMsg").textContent="Bitte einen kurzen Titel eingeben.";return;}
    let res;
    if(id){
      res=await state.supabase.from("family_items").update(payload).eq("id",id);
    }else{
      payload.created_by=state.user.id;
      res=await state.supabase.from("family_items").insert(payload);
    }
    if(res.error){$("entryMsg").textContent=res.error.message;return;}
    $("entryDialog").close();
    await loadFamily();renderAll();toast("Gespeichert");
  }

  async function markDone(id) {
    const {error}=await state.supabase.from("family_items").update({
      status:"done",updated_by:state.user.id
    }).eq("id",id);
    if(error){toast("Konnte nicht gespeichert werden");return;}
    await loadFamily();renderAll();toast("Als erledigt markiert");
  }

  async function deleteCurrent() {
    const id=$("entryId").value;
    if(!id || !confirm("Diesen Eintrag wirklich löschen?")) return;
    const {error}=await state.supabase.from("family_items").delete().eq("id",id);
    if(error){$("entryMsg").textContent=error.message;return;}
    $("entryDialog").close();await loadFamily();renderAll();toast("Gelöscht");
  }

  async function createFamily(e) {
    e.preventDefault();
    const displayName=$("createName").value.trim();
    const names=[$("childOne").value.trim(),$("childTwo").value.trim()].filter(Boolean);
    const {data,error}=await state.supabase.rpc("create_family_with_children",{
      p_display_name:displayName,
      p_child_names:names
    });
    if(error){alert(error.message);return;}
    await afterLogin();
  }

  async function joinFamily(e) {
    e.preventDefault();
    const {error}=await state.supabase.rpc("join_family_by_code",{
      p_invite_code:$("joinCode").value.trim().toUpperCase(),
      p_display_name:$("joinName").value.trim()
    });
    if(error){alert(error.message);return;}
    await afterLogin();
  }

  function bind() {
    $("loginForm").addEventListener("submit",async e=>{
      e.preventDefault();$("authMsg").textContent="";
      const {error}=await state.supabase.auth.signInWithPassword({
        email:$("loginEmail").value.trim(),password:$("loginPassword").value
      });
      if(error){$("authMsg").textContent="Anmeldung nicht möglich: "+error.message;return;}
      const {data:{user}}=await state.supabase.auth.getUser();state.user=user;await afterLogin();
    });

    $("showRegisterBtn").addEventListener("click",()=> $("registerCard").classList.toggle("hidden"));

    $("registerForm").addEventListener("submit",async e=>{
      e.preventDefault();$("authMsg").textContent="";
      const {error}=await state.supabase.auth.signUp({
        email:$("regEmail").value.trim(),password:$("regPassword").value
      });
      if(error){$("authMsg").textContent=error.message;return;}
      $("authMsg").textContent="Konto erstellt. Falls nötig, bitte E-Mail bestätigen und danach anmelden.";
    });

    $("logoutBtn").addEventListener("click",async()=>{await state.supabase.auth.signOut();location.reload();});
    $("createFamilyForm").addEventListener("submit",createFamily);
    $("joinFamilyForm").addEventListener("submit",joinFamily);
    document.querySelectorAll("[data-quick]").forEach(b=>b.addEventListener("click",()=>openNew(b.dataset.quick)));
    $("entryForm").addEventListener("submit",saveEntry);
    $("closeDialog").addEventListener("click",()=>$("entryDialog").close());
    $("cancelBtn").addEventListener("click",()=>$("entryDialog").close());
    $("deleteBtn").addEventListener("click",deleteCurrent);
    $("refreshBtn").addEventListener("click",async()=>{await loadFamily();renderAll();toast("Aktualisiert");});
    $("filterType").addEventListener("change",renderItems);
  }

  bind();
  init();
})();
