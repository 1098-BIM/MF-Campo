/* MF Campo — app de campo, painel e relatório (Minerbo-Fuchs) */
(function(){
"use strict";
const CFG=window.MF_CONFIG;
const sb=supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_KEY);
const $=id=>document.getElementById(id);
const views=["campo","painel","relatorio"];
const STATUS={aberta:"Aberta",analise:"Em análise",resolvida:"Resolvida"};
const PRIO={alta:"Alta",media:"Média",baixa:"Baixa"};
let user=null, docs=[], obras=[], fotosPend=[], audiosPend=[], urlCache={};

// ---------- utilidades ----------
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtData=iso=>{ try{ return new Date(iso).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}); }catch(e){ return iso; } };
const slug=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-|-$/g,"").toLowerCase()||"obra";
function codigo(){ const d=new Date(); const p=n=>String(n).padStart(2,"0");
  return "OC-"+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+"-"+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds())+"-"+Math.random().toString(36).slice(2,5).toUpperCase(); }
function setMsg(el,t,cls){ const m=$(el); m.textContent=t; m.className="status-msg "+(cls||""); }
function reduzirFoto(file){
  return new Promise((res,rej)=>{
    const img=new Image(); const u=URL.createObjectURL(file);
    img.onload=()=>{ const max=1600; let w=img.width,h=img.height; const k=Math.min(1,max/Math.max(w,h)); w=Math.round(w*k); h=Math.round(h*k);
      const c=document.createElement("canvas"); c.width=w; c.height=h; c.getContext("2d").drawImage(img,0,0,w,h);
      c.toBlob(b=>{ URL.revokeObjectURL(u); b?res(b):rej(new Error("falha ao converter")); },"image/jpeg",0.82); };
    img.onerror=()=>{ URL.revokeObjectURL(u); rej(new Error("imagem inválida")); };
    img.src=u;
  });
}
async function urlAssinada(path){
  if(urlCache[path]&&urlCache[path].exp>Date.now()) return urlCache[path].url;
  const {data,error}=await sb.storage.from("evidencias").createSignedUrl(path,3600);
  if(error||!data) return "";
  urlCache[path]={url:data.signedUrl,exp:Date.now()+3300*1000}; return data.signedUrl;
}
// preenche src de imagens/áudios marcados com data-path (chamado após cada render)
async function resolverMidias(root){
  const els=(root||document).querySelectorAll("[data-path]:not([data-ok])");
  for(const el of els){ el.setAttribute("data-ok","1"); const u=await urlAssinada(el.dataset.path); if(!u) continue;
    if(el.tagName==="IMG"){ el.src=u; el.dataset.zoom=u; } else if(el.tagName==="AUDIO"){ el.src=u; } }
}

// ---------- fila offline (IndexedDB) ----------
const idb={
  db:null,
  open(){ return new Promise((res,rej)=>{ if(this.db) return res(this.db); const r=indexedDB.open("mfcampo",1);
    r.onupgradeneeded=()=>{ r.result.createObjectStore("fila",{keyPath:"id"}); };
    r.onsuccess=()=>{ this.db=r.result; res(this.db); }; r.onerror=()=>rej(r.error); }); },
  async put(item){ const d=await this.open(); return new Promise((res,rej)=>{ const t=d.transaction("fila","readwrite"); t.objectStore("fila").put(item); t.oncomplete=res; t.onerror=()=>rej(t.error); }); },
  async all(){ const d=await this.open(); return new Promise((res,rej)=>{ const r=d.transaction("fila").objectStore("fila").getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); },
  async del(id){ const d=await this.open(); return new Promise((res,rej)=>{ const t=d.transaction("fila","readwrite"); t.objectStore("fila").delete(id); t.oncomplete=res; t.onerror=()=>rej(t.error); }); }
};
let sincronizando=false;
async function atualizarBanner(){ try{ const n=(await idb.all()).length; $("offline").hidden=navigator.onLine&&n===0; $("pendentes").textContent=n?`(${n} aguardando envio)`:""; }catch(e){} }
async function sincronizar(){
  if(sincronizando||!navigator.onLine||!user) return; sincronizando=true;
  try{ const itens=await idb.all(); for(const it of itens){ try{ await enviar(it); await idb.del(it.id); }catch(e){ console.warn("sync",e); break; } } }
  finally{ sincronizando=false; atualizarBanner(); }
}
window.addEventListener("online",sincronizar); window.addEventListener("offline",atualizarBanner);

// ---------- envio de um registro ----------
async function enviar(it){
  const base=slug(it.data.obra)+"/"+it.data.codigo;
  const fotos=[], audios=[];
  for(let i=0;i<it.fotos.length;i++){ const path=`${base}/foto-${i+1}.jpg`;
    const {error}=await sb.storage.from("evidencias").upload(path,it.fotos[i],{contentType:"image/jpeg",upsert:true}); if(error) throw error; fotos.push({path,mime:"image/jpeg"}); }
  for(let i=0;i<it.audios.length;i++){ const a=it.audios[i]; const ext=a.mime.includes("mp4")?"m4a":a.mime.includes("webm")?"webm":a.mime.includes("ogg")?"ogg":a.mime.includes("mpeg")?"mp3":"wav";
    const path=`${base}/audio-${i+1}.${ext}`;
    const {error}=await sb.storage.from("evidencias").upload(path,a.blob,{contentType:a.mime,upsert:true}); if(error) throw error; audios.push({path,mime:a.mime,segundos:a.segundos||null}); }
  const row=Object.assign({},it.data,{fotos,audios,transcricao_status:audios.length?"pendente":"nao_aplica",autor:user.id,autor_email:user.email});
  const {error}=await sb.from("ocorrencias").insert(row); if(error) throw error;
  if(it.data.obra&&!obras.some(o=>o.nome===it.data.obra)){ await sb.from("obras").upsert({nome:it.data.obra},{onConflict:"nome"}); carregarObras(); }
}

// ---------- captura: fotos ----------
async function addFotos(files){ for(const f of files){ try{ const b=await reduzirFoto(f); fotosPend.push({blob:b,url:URL.createObjectURL(b)}); }catch(err){ setMsg("msg","Não consegui ler uma das fotos: "+err.message,"err"); } } renderPend(); }
$("foto").addEventListener("change",e=>{ addFotos(e.target.files); e.target.value=""; });
$("galeria").addEventListener("change",e=>{ addFotos(e.target.files); e.target.value=""; });
function renderPend(){
  $("thumbs").innerHTML=fotosPend.map((p,i)=>`<div class="th"><img src="${p.url}" alt="foto ${i+1}"><button type="button" data-rm-foto="${i}" aria-label="remover">×</button></div>`).join("");
  $("audios").innerHTML=audiosPend.map((a,i)=>`<div class="au">🎙 ${a.segundos?a.segundos+"s":""} <audio controls src="${a.url}"></audio><button type="button" class="sm" data-rm-audio="${i}">×</button></div>`).join("");
}

// ---------- captura: áudio (segurar para gravar) ----------
let rec=null, recChunks=[], recStream=null, recT0=0, recTimer=null, recAtivo=false, fileFallback=null;
const btnG=$("btnGravar");
async function iniciarGravacao(){
  if(recAtivo) return; recAtivo=true;
  let stream=null;
  try{ stream=await navigator.mediaDevices.getUserMedia({audio:true}); }catch(e){ recAtivo=false; semMicrofone(); return; }
  if(!recAtivo){ stream.getTracks().forEach(t=>t.stop()); return; } // soltou antes de autorizar
  const mimes=["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg;codecs=opus"];
  const mime=mimes.find(m=>window.MediaRecorder&&MediaRecorder.isTypeSupported(m))||"";
  try{ rec=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream); }catch(e){ stream.getTracks().forEach(t=>t.stop()); recAtivo=false; semMicrofone(); return; }
  recStream=stream; recChunks=[]; recT0=Date.now();
  rec.ondataavailable=ev=>{ if(ev.data&&ev.data.size) recChunks.push(ev.data); };
  rec.onstop=()=>{
    clearInterval(recTimer); recStream.getTracks().forEach(t=>t.stop());
    const t=(rec.mimeType||mime||"audio/webm").toLowerCase().split(";")[0];
    const seg=Math.round((Date.now()-recT0)/1000);
    const blob=new Blob(recChunks,{type:t});
    if(blob.size>0&&seg>=1) audiosPend.push({blob,mime:t,segundos:seg,url:URL.createObjectURL(blob)});
    else setMsg("msg","Áudio muito curto; segure o botão enquanto fala.","err");
    renderPend(); btnG.classList.remove("rec"); $("recMeter").hidden=true; $("gravTxt").textContent="Segure para gravar áudio"; rec=null; recAtivo=false;
  };
  rec.start(500);
  btnG.classList.add("rec"); $("recMeter").hidden=false; $("gravTxt").textContent="Gravando… solte para parar";
  recTimer=setInterval(()=>{ const s=Math.round((Date.now()-recT0)/1000); $("recTempo").textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; if(s>=600) pararGravacao(); },250);
  try{ navigator.vibrate&&navigator.vibrate(30); }catch(e){}
}
function pararGravacao(){ if(rec&&rec.state==="recording"){ rec.stop(); } else { recAtivo=false; } }
function semMicrofone(){
  $("capnote").textContent="O microfone não foi liberado. Autorize o microfone para este site nas configurações do navegador, ou escolha um áudio já gravado.";
  if(!fileFallback){ fileFallback=document.createElement("input"); fileFallback.type="file"; fileFallback.accept="audio/*"; fileFallback.style.display="none"; document.body.appendChild(fileFallback);
    fileFallback.addEventListener("change",e=>{ for(const f of e.target.files){ const n=(f.name||"").toLowerCase();
      const mime=f.type||(n.endsWith(".m4a")?"audio/mp4":n.endsWith(".mp3")?"audio/mpeg":n.endsWith(".wav")?"audio/wav":"audio/webm");
      audiosPend.push({blob:f,mime,url:URL.createObjectURL(f)}); } e.target.value=""; renderPend(); }); }
  fileFallback.click();
}
btnG.addEventListener("pointerdown",e=>{ e.preventDefault(); btnG.setPointerCapture&&btnG.setPointerCapture(e.pointerId); iniciarGravacao(); });
["pointerup","pointercancel"].forEach(ev=>btnG.addEventListener(ev,e=>{ e.preventDefault(); pararGravacao(); }));
btnG.addEventListener("contextmenu",e=>e.preventDefault());
document.addEventListener("click",e=>{
  const bf=e.target.closest("[data-rm-foto]"); if(bf){ fotosPend.splice(+bf.dataset.rmFoto,1); renderPend(); }
  const ba=e.target.closest("[data-rm-audio]"); if(ba){ audiosPend.splice(+ba.dataset.rmAudio,1); renderPend(); }
});

// ---------- salvar ----------
function posicao(){ return new Promise(res=>{ if(!$("gps").checked||!navigator.geolocation) return res(null);
  navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lng:p.coords.longitude}),()=>res(null),{timeout:6000,maximumAge:60000}); }); }
$("f").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=$("salvar"); btn.disabled=true; setMsg("msg","Preparando…");
  try{
    const pos=await posicao();
    const item={ id:codigo(), fotos:fotosPend.map(p=>p.blob), audios:audiosPend.map(a=>({blob:a.blob,mime:a.mime,segundos:a.segundos||null})),
      data:{ codigo:"", obra:$("obra").value.trim(), local:$("local").value.trim(), disciplina:$("disc").value, prioridade:$("prio").value,
        titulo:$("titulo").value.trim(), descricao:$("desc").value.trim(), status:"aberta", lat:pos?pos.lat:null, lng:pos?pos.lng:null } };
    item.data.codigo=item.id;
    if(navigator.onLine){ setMsg("msg",`Enviando ${item.fotos.length} foto(s) e ${item.audios.length} áudio(s)…`); try{ await enviar(item); setMsg("msg","Registrado: "+item.id,"ok"); }
      catch(err){ await idb.put(item); setMsg("msg","Sem conexão estável: guardado no aparelho ("+item.id+"); envio automático quando voltar.","ok"); } }
    else{ await idb.put(item); setMsg("msg","Sem internet: guardado no aparelho ("+item.id+"); envio automático quando voltar.","ok"); }
    fotosPend=[]; audiosPend=[]; renderPend(); $("local").value=""; $("titulo").value=""; $("desc").value="";
    atualizarBanner();
  }catch(err){ setMsg("msg","Não foi possível salvar: "+(err.message||err),"err"); }
  btn.disabled=false;
});

// ---------- dados ----------
async function carregarObras(){ const {data}=await sb.from("obras").select("nome,acc_project_id,ativa").order("nome"); obras=data||[];
  $("obras-dl").innerHTML=obras.filter(o=>o.ativa!==false).map(o=>`<option value="${esc(o.nome)}">`).join(""); }
async function carregar(){ const {data,error}=await sb.from("ocorrencias").select("*").order("criado_em",{ascending:false}).limit(2000);
  if(error){ $("lista").innerHTML=`<div class="empty">Não foi possível ler os registros (${esc(error.message)}).</div>`; return; }
  docs=data||[]; renderTudo(); }
function renderTudo(){ renderMeus(); renderPainel(); if(!$("v-relatorio").hidden) renderRel(); }
let canal=null;
function assinarTempoReal(){ if(canal) return; canal=sb.channel("ocorrencias-live").on("postgres_changes",{event:"*",schema:"public",table:"ocorrencias"},()=>carregar()).subscribe(); }

// ---------- render ----------
function cardHTML(d,full){
  const fotos=(d.fotos||[]).map(f=>`<img data-path="${esc(f.path)}" alt="foto" loading="lazy">`).join("");
  const auds=(d.audios||[]).map(a=>`<div class="au">🎙 ${a.segundos?a.segundos+"s":""} <audio controls preload="none" data-path="${esc(a.path)}"></audio></div>`).join("");
  const trStatus=d.transcricao_status==="pendente"||d.transcricao_status==="processando"?`<span class="pill pend">Transcrição pendente</span>`:"";
  const transc=full?`<div class="field" style="margin:4px 0 0"><label for="tr-${d.id}">Transcrição do áudio ${trStatus}</label><textarea id="tr-${d.id}" data-transc="${d.id}" placeholder="Preenchida automaticamente quando a transcrição por IA estiver ativa; pode editar.">${esc(d.transcricao)}</textarea></div>`:(d.transcricao?`<div class="transc">${esc(d.transcricao)}</div>`:"");
  const build=d.build||{};
  const acc=full?`<div class="acc row"><input data-acc="issue_id" data-id="${d.id}" value="${esc(build.issue_id)}" placeholder="Issue Build nº / link"><input data-acc="rfi_id" data-id="${d.id}" value="${esc(build.rfi_id)}" placeholder="RFI Build nº / link"></div>`:"";
  const acts=full?`<div class="acts"><select data-status="${d.id}">${Object.entries(STATUS).map(([k,v])=>`<option value="${k}"${d.status===k?" selected":""}>${v}</option>`).join("")}</select>${d.autor===user.id?`<button type="button" class="sm ghost" data-del="${d.id}">Excluir</button>`:""}</div>`:"";
  const gps=d.lat?` · <a href="https://maps.google.com/?q=${d.lat},${d.lng}" target="_blank" rel="noopener">mapa</a>`:"";
  return `<article class="oc"><div class="prio ${esc(d.prioridade)}"></div><div class="body">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="code">${esc(d.codigo)}</span><span class="pill ${esc(d.status)}">${STATUS[d.status]||d.status}</span></div>
    <h3>${esc(d.titulo)}</h3>
    <div class="meta">${esc(d.obra)} · ${esc(d.local)} · ${esc(d.disciplina)} · ${PRIO[d.prioridade]||""} · ${fmtData(d.criado_em)} · ${esc(d.autor_email||"")}${gps}</div>
    ${d.descricao?`<div>${esc(d.descricao)}</div>`:""}
    ${fotos?`<div class="fotos">${fotos}</div>`:""}${auds?`<div class="audiolist">${auds}</div>`:""}
    ${transc}${acc}${acts}</div></article>`;
}
function renderMeus(){
  const meus=docs.filter(d=>d.autor===user.id).slice(0,5);
  $("meus").innerHTML=meus.length?meus.map(d=>cardHTML(d,false)).join(""):`<div class="empty">Nenhum registro seu ainda. O primeiro aparece aqui assim que você salvar.</div>`;
  resolverMidias($("meus"));
}
function fillSelect(sel,vals){ const cur=sel.value; const first=sel.options[0].outerHTML; sel.innerHTML=first+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join(""); sel.value=cur; }
function renderPainel(){
  const nomes=[...new Set([...obras.map(o=>o.nome),...docs.map(d=>d.obra)].filter(Boolean))].sort();
  fillSelect($("fObra"),nomes); fillSelect($("rObra"),nomes);
  fillSelect($("fDisc"),[...new Set([...CFG.DISCIPLINAS,...docs.map(d=>d.disciplina)])].filter(Boolean));
  const q=$("fTexto").value.toLowerCase();
  const L=docs.filter(d=>(!$("fObra").value||d.obra===$("fObra").value)&&(!$("fDisc").value||d.disciplina===$("fDisc").value)&&(!$("fStatus").value||d.status===$("fStatus").value)&&(!$("fPrio").value||d.prioridade===$("fPrio").value)&&(!q||[d.titulo,d.descricao,d.local,d.codigo,d.transcricao,d.autor_email].join(" ").toLowerCase().includes(q)));
  const n=k=>L.filter(d=>d.status===k).length;
  $("kpis").innerHTML=`<div class="kpi"><b>${L.length}</b><span>Registros</span></div><div class="kpi"><b style="color:var(--crit)">${n("aberta")}</b><span>Abertas</span></div><div class="kpi"><b style="color:var(--warn)">${n("analise")}</b><span>Em análise</span></div><div class="kpi"><b style="color:var(--ok)">${n("resolvida")}</b><span>Resolvidas</span></div><div class="kpi"><b>${L.filter(d=>d.prioridade==="alta"&&d.status!=="resolvida").length}</b><span>Alta prior. pendentes</span></div>`;
  if(document.activeElement&&$("lista").contains(document.activeElement)&&document.activeElement.tagName==="TEXTAREA") return; // não interrompe quem está digitando
  $("lista").innerHTML=L.length?L.map(d=>cardHTML(d,true)).join(""):`<div class="empty"><h3>Nenhuma incompatibilidade registrada</h3>Os registros feitos no celular pela aba Campo aparecem aqui em tempo real.</div>`;
  resolverMidias($("lista"));
}
["fObra","fDisc","fStatus","fPrio","fTexto"].forEach(id=>$(id).addEventListener("input",renderPainel));
["rObra","rStatus","rDe","rAte","rResumo"].forEach(id=>$(id).addEventListener("input",renderRel));

document.addEventListener("change",async e=>{
  const s=e.target.closest("[data-status]"); if(s){ const {error}=await sb.from("ocorrencias").update({status:s.value}).eq("id",s.dataset.status); if(error) alert("Não foi possível mudar o status: "+error.message); }
  const tr=e.target.closest("[data-transc]"); if(tr){ await sb.from("ocorrencias").update({transcricao:tr.value.trim(),transcricao_status:tr.value.trim()?"concluida":"pendente"}).eq("id",tr.dataset.transc); }
  const a=e.target.closest("[data-acc]"); if(a){ const d=docs.find(x=>x.id===a.dataset.id); if(!d) return; const build=Object.assign({},d.build||{}); build[a.dataset.acc]=a.value.trim(); await sb.from("ocorrencias").update({build}).eq("id",a.dataset.id); }
});
let delPend=null;
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-del]");
  if(b){ if(delPend!==b.dataset.del){ delPend=b.dataset.del; b.textContent="Confirmar exclusão?"; return; } await sb.from("ocorrencias").delete().eq("id",b.dataset.del); delPend=null; }
  const z=e.target.closest("[data-zoom]"); if(z){ const lb=$("lightbox"); lb.querySelector("img").src=z.dataset.zoom; lb.hidden=false; }
  if(e.target.closest("#lightbox")) $("lightbox").hidden=true;
});

// ---------- relatório ----------
function relDocs(){ const de=$("rDe").value, ate=$("rAte").value;
  return docs.filter(d=>(!$("rObra").value||d.obra===$("rObra").value)&&(!$("rStatus").value||d.status===$("rStatus").value)&&(!de||d.criado_em>=de)&&(!ate||d.criado_em<=ate+"T23:59:59"))
    .slice().sort((a,b)=>(a.obra||"").localeCompare(b.obra||"")||(a.criado_em<b.criado_em?1:-1)); }
function relTexto(){ const L=relDocs(); const hoje=new Date().toLocaleDateString("pt-BR"); const resumo=$("rResumo").value.trim();
  let t=`RELATÓRIO DE INCOMPATIBILIDADES EM OBRA — ${CFG.EMPRESA}\nData: ${hoje}\nObra: ${$("rObra").value||"todas"}\nTotal: ${L.length}\n`;
  if(resumo) t+=`\nRESUMO EXECUTIVO\n${resumo}\n`;
  L.forEach((d,i)=>{ t+=`\n${i+1}. [${d.codigo}] ${d.titulo}\n   Obra: ${d.obra} | Local: ${d.local} | Disciplina: ${d.disciplina} | Prioridade: ${PRIO[d.prioridade]} | Status: ${STATUS[d.status]} | Registrado: ${fmtData(d.criado_em)} por ${d.autor_email||""}\n`;
    if(d.descricao) t+=`   Descrição: ${d.descricao}\n`; if(d.transcricao) t+=`   Transcrição do áudio: ${d.transcricao}\n`;
    const b=d.build||{}; if(b.issue_id||b.rfi_id) t+=`   Autodesk Build: ${[b.issue_id&&"Issue "+b.issue_id,b.rfi_id&&"RFI "+b.rfi_id].filter(Boolean).join(" · ")}\n`;
    t+=`   Fotos: ${(d.fotos||[]).length} | Áudios: ${(d.audios||[]).length}\n`; });
  return t; }
function renderRel(){
  if($("v-relatorio").hidden) return;
  const L=relDocs(); const hoje=new Date().toLocaleDateString("pt-BR"); const resumo=$("rResumo").value.trim();
  const n=k=>L.filter(d=>d.status===k).length;
  const linhas=L.map((d,i)=>`<tr><td>${i+1}</td><td style="font-family:var(--mono);font-size:.8rem">${esc(d.codigo)}</td><td>${esc(d.titulo)}</td><td>${esc(d.disciplina)}</td><td>${PRIO[d.prioridade]||""}</td><td>${STATUS[d.status]||""}</td></tr>`).join("");
  const itens=L.map((d,i)=>{ const b=d.build||{}; return `<div class="item"><div class="eyebrow">${i+1} · ${esc(d.codigo)} · ${esc(d.obra)}</div><h3>${esc(d.titulo)}</h3>
    <div class="note">${esc(d.local)} · ${esc(d.disciplina)} · Prioridade ${PRIO[d.prioridade]||""} · ${STATUS[d.status]||""} · ${fmtData(d.criado_em)} · ${esc(d.autor_email||"")}</div>
    ${d.descricao?`<p>${esc(d.descricao)}</p>`:""}${d.transcricao?`<div class="transc"><b>Transcrição do áudio:</b> ${esc(d.transcricao)}</div>`:""}
    ${(b.issue_id||b.rfi_id)?`<p class="note">Autodesk Build: ${b.issue_id?"Issue "+esc(b.issue_id):""} ${b.rfi_id?"RFI "+esc(b.rfi_id):""}</p>`:""}
    ${(d.fotos||[]).length?`<div class="ph">${d.fotos.map(f=>`<img data-path="${esc(f.path)}" alt="" loading="lazy">`).join("")}</div>`:""}
    ${(d.audios||[]).length?`<div class="audiolist">${d.audios.map(a=>`<div class="au">🎙 ${a.segundos?a.segundos+"s":""} <audio controls preload="none" data-path="${esc(a.path)}"></audio></div>`).join("")}</div>`:""}</div>`; }).join("");
  $("rel").innerHTML=`<div class="cab"><div><div class="mf">${esc(CFG.EMPRESA).toUpperCase()}</div><div class="eyebrow">Relatório de incompatibilidades em obra</div></div>
    <div style="text-align:right;font-size:.85rem"><div>Emissão: ${hoje}</div><div>Obra: ${esc($("rObra").value||"todas")}</div></div></div>
    <div class="kpis"><div class="kpi"><b>${L.length}</b><span>Registros</span></div><div class="kpi"><b>${n("aberta")}</b><span>Abertas</span></div><div class="kpi"><b>${n("analise")}</b><span>Em análise</span></div><div class="kpi"><b>${n("resolvida")}</b><span>Resolvidas</span></div></div>
    ${resumo?`<h3>Resumo executivo</h3><div class="resumo">${esc(resumo)}</div>`:""}
    ${L.length?`<h3>Quadro-resumo</h3><div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Código</th><th>Título</th><th>Disciplina</th><th>Prior.</th><th>Status</th></tr></thead><tbody>${linhas}</tbody></table></div><h3>Detalhamento</h3>${itens}`:`<div class="empty">Sem registros para os filtros escolhidos.</div>`}`;
  resolverMidias($("rel"));
}
$("btnCopiar").addEventListener("click",async()=>{ const t=relTexto(); try{ await navigator.clipboard.writeText(t); $("btnCopiar").textContent="Copiado ✓"; }catch(e){ $("btnCopiar").textContent="Não foi possível copiar"; } setTimeout(()=>$("btnCopiar").textContent="Copiar texto",2500); });
$("btnImprimir").addEventListener("click",async()=>{ await resolverMidias($("rel")); const imgs=[...$("rel").querySelectorAll("img")]; await Promise.all(imgs.map(i=>i.complete?null:new Promise(r=>{ i.onload=i.onerror=r; }))); window.print(); });

// ---------- navegação ----------
function route(){
  let v=(location.hash||"").replace("#","");
  if(!views.includes(v)) v="campo";
  views.forEach(n=>{ $("v-"+n).hidden=(n!==v); });
  document.querySelectorAll("#tabs a").forEach(a=>a.classList.toggle("on",a.dataset.v===v));
  if(v==="relatorio") renderRel();
}
window.addEventListener("hashchange",route);

// ---------- login ----------
$("disc").innerHTML=CFG.DISCIPLINAS.map(d=>`<option>${esc(d)}</option>`).join("");
$("f-login").addEventListener("submit",async e=>{ e.preventDefault(); $("l-entrar").disabled=true; setMsg("l-msg","Entrando…");
  const {error}=await sb.auth.signInWithPassword({email:$("l-email").value.trim(),password:$("l-senha").value});
  if(error) setMsg("l-msg","E-mail ou senha incorretos.","err"); $("l-entrar").disabled=false; });
$("l-esqueci").addEventListener("click",async()=>{ const email=$("l-email").value.trim(); if(!email){ setMsg("l-msg","Digite seu e-mail e clique de novo.","err"); return; }
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
  setMsg("l-msg",error?"Não foi possível enviar: "+error.message:"Enviei um link para "+email+". Abra-o neste aparelho para definir a senha.",error?"err":"ok"); });
$("f-senha").addEventListener("submit",async e=>{ e.preventDefault(); const {error}=await sb.auth.updateUser({password:$("s-senha").value});
  if(error) setMsg("s-msg","Não foi possível salvar: "+error.message,"err"); else { setMsg("s-msg","Senha salva.","ok"); setTimeout(()=>{ $("v-senha").hidden=true; mostrarApp(); },800); } });
$("sair").addEventListener("click",async()=>{ await sb.auth.signOut(); location.hash=""; location.reload(); });

function mostrarLogin(){ $("app").hidden=true; $("v-senha").hidden=true; $("v-login").hidden=false; }
async function mostrarApp(){ $("v-login").hidden=true; $("app").hidden=false; $("usuario").textContent=user.email; route();
  await carregarObras(); await carregar(); assinarTempoReal(); atualizarBanner(); sincronizar(); }
let iniciado=false;
sb.auth.onAuthStateChange((evt,session)=>{
  user=session?session.user:null;
  if(evt==="PASSWORD_RECOVERY"){ $("v-login").hidden=true; $("app").hidden=true; $("v-senha").hidden=false; return; }
  if(!user){ mostrarLogin(); iniciado=false; return; }
  if(!iniciado){ iniciado=true; mostrarApp(); }
});

// service worker (instalável / offline)
if("serviceWorker" in navigator){ window.addEventListener("load",()=>{ navigator.serviceWorker.register("sw.js").catch(()=>{}); }); }
})();
