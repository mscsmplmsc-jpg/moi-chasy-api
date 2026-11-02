(()=>{
const hasApi=()=>typeof window.authCall==='function';
const me=()=>(window.authUser&&authUser())||null;
window.featApply=()=>{const t=$('#chattile');if(t)t.hidden=!(feat&&feat.chat&&hasApi())};
window.featApply();
if(!hasApi()){window.chatShow=()=>{$('#chatbody').innerHTML='<p class="mute">Мессенджер доступен после настройки сервера и входа в аккаунт.</p>'};return}

const st=document.createElement('style');
st.textContent=`
#chatbody textarea{display:block;width:100%;margin-top:4px;padding:11px 12px;font:inherit;font-size:17px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;resize:vertical}
.mg{max-width:84%;padding:8px 12px;border-radius:14px;margin:6px 0;white-space:pre-wrap;word-break:break-word}
.mg.me{margin-left:auto;background:var(--acc);color:var(--onacc)}
.mg.he{background:var(--card);border:1px solid var(--line)}
.mg img,.mg video{max-width:100%;max-height:50vh;border-radius:8px;display:block}
.mt{font-size:11px;opacity:.7;margin-top:2px}
`;
document.head.appendChild(st);

const CH=16384,MAX=300*1048576;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b64=a=>btoa(String.fromCharCode(...a));
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const unb64u=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return unb64(s)};
const fmtSize=n=>n<1024?n+' Б':n<1048576?Math.round(n/1024)+' КБ':(n/1048576).toFixed(1)+' МБ';
const tm=ts=>{const d=new Date(ts);return pad(d.getHours())+':'+pad(d.getMinutes())};
const dt=ts=>fdate(iso(new Date(ts)))+' '+tm(ts);
const LS=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}};
const put=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
let peers=LS('chat-peers-v1',[]),seen=LS('chat-seen-v1',{}),files=LS('chat-files-v1',[]);
let v={n:'list'},keys={},PT={},M={},lastId={},chats=[],XF={},tickBusy=false;

/* ---------- шифрование ключом, который вводит пользователь ---------- */
async function deriveKey(peer,pass){
  const salt='chat:'+[me(),peer].sort().join('|');
  const k=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encMsg(key,text){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(text)));
  const o=new Uint8Array(12+ct.length);o.set(iv);o.set(ct,12);return b64(o);
}
const GA='абвгдежзиклмнопрстуфхцчшэюяАБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789#@$%&*+=?';
function garble(raw){let o='';raw.slice(12,-16).forEach(x=>{o+=GA[x%GA.length];if(x%7===0)o+=' '});return o.trim()||'…'}
async function decMsg(key,data){
  let raw;try{raw=unb64(data)}catch(e){return '…'}
  try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.slice(0,12)},key,raw.slice(12)))}
  catch(e){return garble(raw)} // неверный ключ: бессмыслица
}

/* ---------- экраны ---------- */
const initial=n=>`<span class="av">${esc((n[0]||'?').toUpperCase())}</span>`;
function vList(){
  return `<div class="row" style="grid-template-columns:1fr auto"><input id="c_peer" placeholder="Имя собеседника" autocapitalize="off" autocorrect="off"><button class="sm" data-a="start" style="margin:0">Начать чат</button></div>
  <button class="ghost" data-a="push">Уведомления о сообщениях</button>
  <div id="c_items"></div>`;
}
function renderList(){
  const el=$('#c_items');if(!el)return;
  const info={};chats.forEach(c=>{info[c.peer]=c});
  const names=[...new Set([...chats.map(c=>c.peer),...peers])].sort((a,b)=>((info[b]||{}).ts|0)-((info[a]||{}).ts|0));
  el.innerHTML=names.length?names.map(n=>{
    const c=info[n],unread=c&&c.frm!==me()&&c.id>(seen[n]||0);
    return `<div class="pc" data-a="open" data-id="${esc(n)}">${initial(n)}<div class="pi"><b>${esc(n)}</b>${unread?'<span class="tag">новое</span>':''}<div class="mute">${c?dt(c.ts):'Сообщений пока нет'}</div></div></div>`;
  }).join(''):'<p class="mute">Чатов пока нет. Введите имя собеседника, чтобы начать.</p>';
}
function vChat(){
  const peer=v.peer;
  const nav=`<div class="nav"><button class="ghost" data-a="list">‹ Чаты</button>${keys[peer]?'<button class="ghost bad" data-a="clear">Очистить переписку</button>':''}</div>`;
  if(!keys[peer])return `${nav}<h1>${esc(peer)}</h1>
  <p class="mute">Введите ключ шифрования для этого чата. Такой же ключ должен знать собеседник. Проверки правильности нет: с неверным ключом сообщения выглядят как бессмыслица.</p>
  <label>Ключ<input id="c_key" type="password" autocapitalize="off" autocorrect="off" autocomplete="off"></label><button class="primary" data-a="unlock">Открыть чат</button>`;
  return `${nav}<h1>${esc(peer)}</h1><div id="c_xf" class="mute"></div><div id="c_msgs"></div>
  <textarea id="c_in" rows="2" placeholder="Сообщение" style="margin-top:12px"></textarea>
  <div style="display:flex;gap:10px;align-items:center;margin-top:8px"><button class="primary" data-a="send" style="flex:1">Отправить</button><label class="sm up" style="margin:0">Файл<input type="file" id="c_file" hidden></label></div>
  <p class="mute">Файлы идут напрямую на устройство собеседника. Он должен быть онлайн и открыть этот чат.</p>`;
}
function show(){
  $('#chatbody').innerHTML=v.n==='chat'?vChat():vList();
  if(v.n==='chat'&&keys[v.peer]){renderMsgs(true);renderXf()}else renderList();
  window.scrollTo(0,0);
}
async function hy(root){for(const el of root.querySelectorAll('[data-m]')){const u=await mdb.url(el.dataset.m);if(u)el.src=u}}
function fileHtml(f){
  const inc=f.dir==='in';
  const body=inc&&f.type.startsWith('image')?`<img data-m="${f.id}" alt="">`:inc&&f.type.startsWith('video')?`<video data-m="${f.id}" controls playsinline></video>`:`Файл: ${esc(f.name)}`;
  return `<div class="mg ${inc?'he':'me'}">${body}<div class="mt">${esc(f.name)} · ${fmtSize(f.size)} · ${tm(f.ts)}${inc?` <button class="del" data-a="dlf" data-id="${f.id}" style="color:inherit;padding:0 0 0 8px;font-size:12px;text-decoration:underline">Скачать</button>`:' · отправлен'}</div></div>`;
}
async function renderMsgs(first){
  const peer=v.peer,key=keys[peer],el=$('#c_msgs');if(!el||!key)return;
  const items=[];
  for(const m of M[peer]||[]){
    if(PT[m.id]===undefined)PT[m.id]=await decMsg(key,m.data);
    items.push({ts:m.ts,html:`<div class="mg ${m.frm===me()?'me':'he'}">${esc(PT[m.id])}<div class="mt">${tm(m.ts)}</div></div>`});
  }
  files.filter(f=>f.peer===peer).forEach(f=>items.push({ts:f.ts,html:fileHtml(f)}));
  items.sort((a,b)=>a.ts-b.ts);
  if(v.peer!==peer||!$('#c_msgs'))return;
  const near=window.innerHeight+window.scrollY>=document.body.scrollHeight-100;
  el.innerHTML=items.map(i=>i.html).join('')||'<p class="mute">Сообщений пока нет.</p>';
  hy(el);
  if(first||near)window.scrollTo(0,document.body.scrollHeight);
}
function renderXf(){
  const el=$('#c_xf');if(!el)return;
  el.innerHTML=Object.values(XF).filter(x=>x.peer===v.peer).map(x=>{
    const pct=x.size?Math.round((x.dir==='out'?x.sent:x.got)/x.size*100):0;
    return `<div>${x.dir==='out'?'Отправка':'Получение'} «${esc(x.name)}»: ${esc(x.state)}${x.state==='отправка'||x.state==='получение'?' '+pct+'%':''}</div>`;
  }).join('');
}

/* ---------- опрос сервера ---------- */
async function tick(){
  if(tickBusy||$('#chat').hidden||document.hidden||!me())return;
  tickBusy=true;
  const peer=v.n==='chat'&&keys[v.peer]?v.peer:'';
  try{
    const j=await authCall({op:'poll',peer,since:peer?(lastId[peer]||0):0});
    if(!j.ok)return;
    chats=(j.chats||[]).map(c=>({peer:c.a===me()?c.b:c.a,id:c.id,frm:c.frm,ts:c.ts}));
    if(peer&&j.msgs&&j.msgs.length&&keys[peer]){
      const have=new Set((M[peer]||[]).map(m=>m.id));
      M[peer]=(M[peer]||[]).concat(j.msgs.filter(m=>!have.has(m.id))).sort((a,b)=>a.id-b.id);
      lastId[peer]=Math.max(lastId[peer]||0,...j.msgs.map(m=>m.id));
      seen[peer]=Math.max(seen[peer]||0,lastId[peer]);put('chat-seen-v1',seen);
      if(v.peer===peer)renderMsgs();
    }
    if(peer&&!(j.msgs&&j.msgs.length)&&(M[peer]||[]).length===0&&lastId[peer]===undefined){lastId[peer]=0;renderMsgs()}
    for(const s of j.sigs||[])handleSig(s);
    if(v.n==='list')renderList();
  }catch(e){}finally{tickBusy=false}
}
setInterval(tick,3000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});

async function sendMsg(){
  const peer=v.peer,t=$('#c_in').value.trim();
  if(!t)return;if(t.length>2000){toast('Слишком длинное сообщение');return}
  $('#c_in').value='';
  try{
    const data=await encMsg(keys[peer],t),j=await authCall({op:'send',to:peer,data});
    if(!j.ok)throw new Error(j.error||'нет связи');
    (M[peer]=M[peer]||[]).push({id:j.id,frm:me(),data,ts:j.ts});
    seen[peer]=Math.max(seen[peer]||0,j.id);put('chat-seen-v1',seen);
    renderMsgs(true);
  }catch(e){$('#c_in').value=t;toast('Не отправлено: '+(e.message||'нет связи'))}
}

/* ---------- файлы напрямую (WebRTC) ---------- */
async function getIce(){try{const j=await authCall({op:'ice'});if(j.ok&&j.iceServers)return j.iceServers}catch(e){}return [{urls:'stun:stun.l.google.com:19302'}]}
function iceDone(pc){return new Promise(r=>{if(pc.iceGatheringState==='complete')return r();const f=()=>{if(pc.iceGatheringState==='complete'){pc.removeEventListener('icegatheringstatechange',f);r()}};pc.addEventListener('icegatheringstatechange',f);setTimeout(r,6000)})}
function fail(tr,msg){
  if(tr.finished)return;
  tr.finished=true;tr.state='ошибка: '+msg;try{tr.pc.close()}catch(e){}
  renderXf();setTimeout(()=>{delete XF[tr.id];renderXf()},8000);
}
function watch(tr){
  tr.pc.oniceconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(tr.pc.iceConnectionState))fail(tr,'соединение прервано или не удалось (возможно, нужна настройка TURN)')};
}
async function sendFile(peer,file){
  if(file.size>MAX){toast('Файл слишком большой (максимум 300 МБ)');return}
  const id=mdb.uid(),pc=new RTCPeerConnection({iceServers:await getIce()}),dc=pc.createDataChannel('f');
  dc.binaryType='arraybuffer';
  const tr={id,peer,dir:'out',name:file.name||'файл',size:file.size,type:file.type||'',sent:0,state:'ожидание собеседника…',pc};
  XF[id]=tr;watch(tr);renderXf();
  dc.onopen=async()=>{
    tr.state='отправка';
    try{
      for(let off=0,i=0;off<file.size;off+=CH,i++){
        while(dc.bufferedAmount>4194304)await sleep(50);
        dc.send(await file.slice(off,off+CH).arrayBuffer());
        tr.sent=Math.min(off+CH,file.size);if(i%32===0)renderXf();
      }
      dc.send('END');
      while(dc.bufferedAmount>0)await sleep(100);
      await sleep(800);
      tr.finished=true;tr.state='отправлено';
      files.push({id:mdb.uid(),peer,dir:'out',name:tr.name,size:tr.size,type:tr.type,ts:Date.now()});put('chat-files-v1',files);
      try{pc.close()}catch(e){}
      renderXf();renderMsgs();setTimeout(()=>{delete XF[id];renderXf()},4000);
    }catch(e){tr.finished=false;fail(tr,'ошибка отправки')}
  };
  try{
    await pc.setLocalDescription(await pc.createOffer());await iceDone(pc);
    await authCall({op:'sig',to:peer,notify:1,data:JSON.stringify({t:'offer',id,sdp:pc.localDescription.sdp,name:tr.name,size:tr.size,type:tr.type})});
  }catch(e){fail(tr,'не удалось начать передачу');return}
  setTimeout(()=>{if(XF[id]&&tr.state.startsWith('ожидание'))fail(tr,'собеседник не ответил: он должен быть онлайн и открыть этот чат')},60000);
}
function handleSig(s){
  let d;try{d=JSON.parse(s.data)}catch(e){return}
  if(d.t==='offer')incoming(s.frm,d);
  else if(d.t==='answer'){const x=XF[d.id];if(x&&x.dir==='out'&&x.pc.signalingState==='have-local-offer'){x.state='соединение…';x.pc.setRemoteDescription({type:'answer',sdp:d.sdp}).catch(()=>fail(x,'ошибка соединения'));renderXf()}}
  else if(d.t==='decline'){const x=XF[d.id];if(x)fail(x,'собеседник отклонил передачу')}
}
function incoming(frm,d){
  const decline=()=>authCall({op:'sig',to:frm,data:JSON.stringify({t:'decline',id:d.id})});
  if(!(d.size<=MAX)){decline();return}
  openSheet(`<h2>Входящий файл</h2><p>${esc(frm)} хочет отправить файл:</p><p><b>${esc(d.name)}</b><br><span class="mute">${fmtSize(d.size)}</span></p><p class="mute">Не сворачивайте приложение, пока идёт передача.</p><button class="primary" id="in_y">Принять</button><button class="ghost" id="in_n">Отклонить</button>`);
  window._sc=decline;
  $('#in_y').onclick=()=>{window._sc=null;closeSheet();accept(frm,d)};
  $('#in_n').onclick=closeSheet;
}
async function accept(frm,d){
  const pc=new RTCPeerConnection({iceServers:await getIce()});
  const tr={id:d.id,peer:frm,dir:'in',name:d.name||'файл',size:d.size,type:d.type||'',got:0,chunks:[],state:'соединение…',pc};
  XF[d.id]=tr;watch(tr);renderXf();
  pc.ondatachannel=e=>{
    const dc=e.channel;dc.binaryType='arraybuffer';
    dc.onmessage=async m=>{
      if(typeof m.data==='string'){if(m.data==='END')await finishIn(tr);return}
      tr.chunks.push(m.data);tr.got+=m.data.byteLength;tr.state='получение';
      if(tr.chunks.length%32===0)renderXf();
    };
  };
  try{
    await pc.setRemoteDescription({type:'offer',sdp:d.sdp});
    await pc.setLocalDescription(await pc.createAnswer());await iceDone(pc);
    await authCall({op:'sig',to:frm,data:JSON.stringify({t:'answer',id:d.id,sdp:pc.localDescription.sdp})});
  }catch(e){fail(tr,'не удалось принять файл')}
}
async function finishIn(tr){
  if(tr.finished)return;
  if(tr.got!==tr.size){fail(tr,'файл получен не полностью');return}
  tr.finished=true;
  try{
    const fid=mdb.uid();await mdb.mPut({id:fid,blob:new Blob(tr.chunks,{type:tr.type})});
    files.push({id:fid,peer:tr.peer,dir:'in',name:tr.name,size:tr.size,type:tr.type,ts:Date.now()});put('chat-files-v1',files);
    tr.state='получено';tr.chunks=[];
  }catch(e){tr.finished=false;fail(tr,'не хватило места на устройстве');return}
  try{tr.pc.close()}catch(e){}
  renderXf();renderMsgs();setTimeout(()=>{delete XF[tr.id];renderXf()},4000);
}

/* ---------- уведомления ---------- */
async function enablePush(){
  try{
    if(!('PushManager' in window)||!(navigator.standalone||matchMedia('(display-mode: standalone)').matches)){toast('Откройте приложение с иконки на экране «Домой»');return}
    if(await Notification.requestPermission()!=='granted'){toast('Уведомления запрещены в настройках iPhone');return}
    const s=await window.ensurePushSub();
    const j=await authCall({op:'subscribe',sub:s.toJSON()});
    toast(j.ok?'Уведомления о сообщениях включены':'Не удалось включить уведомления');
  }catch(e){toast('Ошибка: '+(e.message||e))}
}

/* ---------- действия ---------- */
const body=$('#chatbody');
body.addEventListener('click',async e=>{
  const b=e.target.closest('[data-a]');if(!b)return;
  const a=b.dataset.a,id=b.dataset.id;
  if(a==='start'){
    const j=await authCall({op:'peer',name:$('#c_peer').value});
    if(!j.ok){toast('Пользователь не найден');return}
    if(!peers.includes(j.name)){peers.push(j.name);put('chat-peers-v1',peers)}
    v={n:'chat',peer:j.name};show();
  }
  else if(a==='open'){v={n:'chat',peer:id};show()}
  else if(a==='list'){delete keys[v.peer];v={n:'list'};show();tick()}
  else if(a==='unlock'){
    const p=$('#c_key').value;if(!p){toast('Введите ключ');return}
    const peer=v.peer;b.disabled=true;
    keys[peer]=await deriveKey(peer,p);PT={};M[peer]=[];delete lastId[peer];
    show();tick();
  }
  else if(a==='send')sendMsg();
  else if(a==='push')enablePush();
  else if(a==='clear'){
    if(!confirm('Удалить переписку у вас и у собеседника? Файлы на устройствах останутся.'))return;
    const j=await authCall({op:'clear',peer:v.peer});
    if(j.ok){M[v.peer]=[];lastId[v.peer]=0;PT={};renderMsgs()}else toast('Не удалось очистить');
  }
  else if(a==='dlf'){const f=files.find(x=>x.id===id),r=f&&await mdb.mGet(id);if(r)mdb.share(r.blob,f.name,f.type,await mdb.url(id))}
});
body.addEventListener('change',e=>{
  if(e.target.id==='c_file'&&e.target.files[0]){const f=e.target.files[0];e.target.value='';sendFile(v.peer,f)}
});
window.chatShow=()=>{
  if(!me()){body.innerHTML='<p class="mute">Мессенджер доступен после входа в аккаунт.</p>';return}
  v={n:'list'};keys={};show();tick();
  try{const s=JSON.parse(localStorage.getItem('push-sub'));if(s&&s.endpoint&&Notification.permission==='granted')authCall({op:'subscribe',sub:s})}catch(e){}
};
})();
