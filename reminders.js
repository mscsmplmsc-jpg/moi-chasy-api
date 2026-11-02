(()=>{
const st=document.createElement('style');
st.textContent=`
#rembody textarea{display:block;width:100%;margin-top:4px;padding:11px 12px;font:inherit;font-size:17px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;resize:vertical}
.ri{margin-top:8px;padding:12px;background:var(--card);border:1px solid var(--line);border-radius:14px;cursor:pointer}
.ri.past{opacity:.7}
.ri b{font-variant-numeric:tabular-nums}
`;
document.head.appendChild(st);

const RK='rem-v1';
let R={items:[]};
try{const j=JSON.parse(localStorage.getItem(RK));if(j&&Array.isArray(j.items))R=j}catch(e){}
const sv=()=>{try{localStorage.setItem(RK,JSON.stringify(R));return true}catch(e){toast('Не удалось сохранить');return false}};
window.remGet=()=>R;
window.remSet=r=>{if(r&&Array.isArray(r.items)){R=r;sv()}};

const hmOf=w=>w.split('T')[1];
const whenText=r=>r.rep?('каждый день в '+hmOf(r.when)+', с '+fdate(r.when.split('T')[0])+(r.until?' по '+fdate(r.until):'')):fdate(r.when.split('T')[0])+', '+hmOf(r.when);
const untilMs=r=>r.until?new Date(r.until+'T'+hmOf(r.when)).getTime():0;
const lastMs=r=>r.rep?(r.until?untilMs(r):Infinity):new Date(r.when).getTime();
const past=r=>lastMs(r)<Date.now();
function nextAt(r){
  const start=new Date(r.when).getTime();
  if(!r.rep)return start;
  const now=Date.now(),lim=untilMs(r)||Infinity;
  const d=new Date(start);
  while(d.getTime()<=now&&d.getTime()<=lim)d.setDate(d.getDate()+1);
  return d.getTime()<=lim?d.getTime():null;
}
const by=r=>nextAt(r)||0;
async function hy(root){for(const el of root.querySelectorAll('[data-m]')){const u=await mdb.url(el.dataset.m);if(u)el.src=u+(el.tagName==='VIDEO'?'#t=0.1':'')}}
const thumb=m=>`<button class="th" data-mv="${m.id}">${m.kind==='video'?`<video data-m="${m.id}" preload="metadata" muted playsinline></video><span class="pl">▶</span>`:`<img data-m="${m.id}" alt="">`}</button>`;

/* push-уведомления через свой сервер на Cloudflare */
const VAPID_PUB='BH6wSlSwGqoIvHsslMlIQozuf-V7R2q_ZJWmxIbSuVsWykDSghmpio9wri6FpD3T-ZWW_bDChgrMf9LYEw7KyMo';
window.VAPID_PUB=VAPID_PUB;
if(localStorage.getItem('push-sub')&&localStorage.getItem('push-key')!==VAPID_PUB)localStorage.removeItem('push-sub'); // подписка на старый ключ недействительна
const PC='push-cfg-v1';
let cfg={};try{cfg=JSON.parse(localStorage.getItem(PC))||{}}catch(e){}
const getSub=()=>{try{return JSON.parse(localStorage.getItem('push-sub'))}catch(e){return null}};
const pushOk=()=>'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const standalone=()=>navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
const unb64u=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),c=>c.charCodeAt(0))};
async function api(o){
  const c=new AbortController(),tm=setTimeout(()=>c.abort(),15000);
  try{const r=await fetch(cfg.url,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({t:cfg.token,...o}),signal:c.signal});return await r.json()}
  finally{clearTimeout(tm)}
}
const pushOn=()=>!!(cfg.url&&cfg.token&&getSub()&&pushOk()&&Notification.permission==='granted');
const pushShort=()=>pushOn()?'включены':'не настроены';
function pushStatus(){
  if(!pushOk())return 'Этот браузер не поддерживает push-уведомления.';
  if(!standalone())return 'Откройте приложение с иконки на экране «Домой»: в обычном Safari уведомления на iPhone не работают.';
  if(Notification.permission==='denied')return 'Уведомления запрещены. Разрешите их в Настройки iPhone → Уведомления → Мои часы.';
  return pushOn()?'Уведомления включены.':'Уведомления ещё не включены.';
}
async function sync(r){
  if(!pushOn()){r.push='off';return}
  const at=nextAt(r);
  if(!at||at<=Date.now()){r.push='past';return}
  try{
    const o={op:'add',id:r.id,sub:getSub(),title:'Напоминание',body:r.text,at};
    if(r.rep){o.rep='day';o.until=untilMs(r);o.tz=Intl.DateTimeFormat().resolvedOptions().timeZone;o.hm=hmOf(r.when)}
    const j=await api(o);r.push=j.ok?'ok':'err';
  }catch(e){r.push='err'}
}
async function unsync(r){if(r.push==='ok'&&cfg.url){try{await api({op:'del',id:r.id})}catch(e){}}}
window.ensurePushSub=async()=>{
  const reg=await navigator.serviceWorker.ready,want=unb64u(VAPID_PUB);
  let s=await reg.pushManager.getSubscription();
  const k=s&&s.options&&s.options.applicationServerKey;
  if(s&&k){const a=new Uint8Array(k);if(a.length!==want.length||a.some((v,i)=>v!==want[i])){await s.unsubscribe();s=null}}
  if(!s)s=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:want});
  localStorage.setItem('push-sub',JSON.stringify(s));localStorage.setItem('push-key',VAPID_PUB);
  return s;
};
function pushSheet(){
  openSheet(`<h2>Уведомления</h2><p class="mute" id="p_st">${esc(pushStatus())}</p>
  <label>Адрес сервера (Worker)<input id="p_u" value="${esc(cfg.url||'')}" placeholder="https://проект.vercel.app/api" autocapitalize="off" autocorrect="off"></label>
  <label>Секретный код<input id="p_t" type="password" value="${esc(cfg.token||'')}" autocapitalize="off" autocorrect="off"></label>
  <button class="primary" id="p_on">Сохранить и включить</button>
  <button class="ghost" id="p_test">Отправить тестовое уведомление</button>
  <div class="mute" id="p_msg"></div>
  <button class="ghost" id="p_x">Закрыть</button>`);
  const msg=t=>{$('#p_msg').textContent=t};
  const store=()=>{const old=cfg.url;cfg={url:$('#p_u').value.trim(),token:$('#p_t').value.trim()};localStorage.setItem(PC,JSON.stringify(cfg));if(old&&old!==cfg.url){R.items.forEach(r=>{if(r.push==='ok')r.push='err'});sv()}};
  window._sc=()=>show();
  $('#p_x').onclick=closeSheet;
  $('#p_on').onclick=async()=>{
    store();
    if(!cfg.url||!cfg.token){msg('Заполните адрес сервера и секретный код.');return}
    if(!pushOk()||!standalone()){msg(pushStatus());return}
    try{
      if(await Notification.requestPermission()!=='granted'){msg(pushStatus());return}
      await window.ensurePushSub();
      $('#p_st').textContent=pushStatus();msg('Готово. Нажмите «Отправить тестовое уведомление».');
    }catch(e){msg('Ошибка: '+(e&&e.message||e))}
  };
  $('#p_test').onclick=async()=>{
    store();
    if(!getSub()){msg('Сначала нажмите «Сохранить и включить».');return}
    msg('Отправляю…');
    try{const j=await api({op:'test',sub:getSub()});msg(j.ok?'Отправлено. Уведомление придёт через несколько секунд.':'Сервер ответил: '+(j.error||j.status)+' '+(j.detail||''))}
    catch(e){msg('Не удалось связаться с сервером, проверьте адрес. ('+(e&&e.message||e)+')')}
  };
}

let v='list',draft={files:[]},openId=null;
R.items.forEach(r=>{if(r.push==='wait')r.push='err'});

function vList(){
  const up=R.items.filter(r=>!past(r)).sort((a,b)=>by(a)-by(b));
  const ps=R.items.filter(past).sort((a,b)=>lastMs(b)-lastMs(a));
  const it=r=>`<div class="ri${past(r)?' past':''}" data-id="${r.id}"><b>${esc(whenText(r))}</b>${r.media.length?`<span class="tag">файлов: ${r.media.length}</span>`:''}${r.rep&&nextAt(r)?`<div class="mute">Ближайшее: ${fdate(iso(new Date(nextAt(r))))}</div>`:''}<div class="clip">${esc(r.text)}</div><button class="del" data-del="${r.id}">Удалить</button></div>`;
  return '<button class="primary" data-a="new">+ Новое напоминание</button><button class="ghost" data-a="push">Уведомления: '+pushShort()+'</button>'
    +(up.length?'<h2>Предстоящие</h2>'+up.map(it).join(''):'')
    +(ps.length?'<h2>Архив</h2>'+ps.map(it).join('')+'<button class="ghost" data-a="clr">Очистить архив</button>':'')
    +(R.items.length?'':'<p class="mute">Напоминаний пока нет.</p>');
}
function vNew(){
  return `<button class="ghost" data-a="list">‹ Отмена</button><h1>Новое напоминание</h1>
  <label>Текст<textarea id="r_t" rows="4"></textarea></label>
  <div class="grid2"><label>Дата<input type="date" id="r_d"></label><label>Время<input type="time" id="r_h"></label></div>
  <label class="ck"><input type="checkbox" id="r_rep"> Повторять каждый день в это время</label>
  <label id="r_ul" hidden>Повторять до (можно оставить пустым: без конца)<input type="date" id="r_until"></label>
  <label class="sm up">+ Прикрепить фото и видео<input type="file" id="r_f" accept="image/*,video/*" multiple hidden></label>
  <div id="r_fl" class="mute" style="margin-bottom:12px"></div>
  <button class="primary" data-a="save">Сохранить</button>
  <p class="mute">Уведомление придёт от приложения в указанное время. Его нужно один раз настроить кнопкой «Уведомления» в списке.</p>`;
}
function flist(){
  const el=$('#r_fl');if(!el)return;
  el.innerHTML=draft.files.length?'Прикреплено: '+draft.files.map(f=>esc(f.name)).join(', ')+'<button class="ghost" data-a="clrf" style="padding:0 0 0 10px">Убрать все</button>':'';
}
function show(){
  $('#rembody').innerHTML=v==='new'?vNew():vList();
  if(v==='new'){const d=new Date(Date.now()+36e5);$('#r_d').value=iso(d);$('#r_h').value=pad(d.getHours())+':00';flist()}
  else hy($('#rembody'));
  window.scrollTo(0,0);
}
window.remShow=()=>{v='list';show()};

async function remove(rs){
  for(const r of rs){await unsync(r);for(const m of r.media){try{await mdb.mDel(m.id)}catch(e){}}}
  const ids=new Set(rs.map(r=>r.id));
  R.items=R.items.filter(r=>!ids.has(r.id));sv();show();
}
let saving=false;
async function save(){
  if(saving)return;
  const text=$('#r_t').value.trim(),d=$('#r_d').value,h=$('#r_h').value;
  if(!text||!d||!h){toast('Нужны текст, дата и время');return}
  const rep=$('#r_rep').checked,until=rep?$('#r_until').value:'';
  if(until&&until<d){toast('Дата окончания раньше даты начала');return}
  const r={id:mdb.uid(),text,when:d+'T'+h,media:[]};if(rep){r.rep='day';r.until=until}
  saving=true;const sb=$('[data-a="save"]');if(sb){sb.disabled=true;sb.textContent='Сохраняю…'}
  let bad=0;
  for(const f of draft.files){
    const id=mdb.uid();
    try{await mdb.mPut({id,blob:f});r.media.push({id,kind:f.type.startsWith('video')?'video':'photo',name:f.name||('media-'+id),type:f.type})}catch(e){bad++}
  }
  r.push=cfg.url?'wait':'off';
  R.items.push(r);
  if(!sv()){R.items.pop();saving=false;if(sb){sb.disabled=false;sb.textContent='Сохранить'}return}
  v='list';draft={files:[]};saving=false;show();
  if(bad)toast('Не удалось сохранить файлов: '+bad);
  detail(r,true);
  if(cfg.url)bgSync(r); // отправка на сервер идёт в фоне, окно не ждёт
}
async function bgSync(r){
  await sync(r);sv();
  if(r.push==='err')toast('Напоминание сохранено, но уведомление не запланировано: сервер не отвечает');
  if(!$('#md').hidden&&$('#d_cal')&&openId===r.id)detail(r,false);
  else if(v==='list'&&!$('#r_t'))show();
}

/* Календарь: событие с сигналом в нужное время */
function cal(r){
  const q=s=>s.replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
  const [d,t]=r.when.split('T');
  const s=d.replace(/-/g,'')+'T'+t.replace(':','')+'00';
  const e=new Date(new Date(r.when).getTime()+30*60000);
  const end=iso(e).replace(/-/g,'')+'T'+pad(e.getHours())+pad(e.getMinutes())+'00';
  const now=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
  const title=r.text.split('\n')[0].slice(0,80);
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Moi Chasy//RU','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+r.id+'@moi-chasy','DTSTAMP:'+now,'DTSTART:'+s,'DTEND:'+end,...(r.rep?['RRULE:FREQ=DAILY'+(r.until?';UNTIL='+r.until.replace(/-/g,'')+'T'+t.replace(':','')+'00':'')]:[]),'SUMMARY:'+q(title),'DESCRIPTION:'+q(r.text),'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+q(title),'TRIGGER:PT0S','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const blob=new Blob([ics],{type:'text/calendar'});
  mdb.share(blob,'napominanie.ics','text/calendar',URL.createObjectURL(blob));
}

function detail(r,fresh){
  const psText={wait:'Отправляю уведомление на сервер…',ok:'Уведомление запланировано: оно придёт в это время.',err:'Не удалось запланировать уведомление на сервере.',off:'Уведомления не настроены, поэтому оповещения не будет.',past:'Время уже прошло, уведомление не планировалось.'}[r.push]||'Уведомление не запланировано.';
  const showPush=r.push!=='ok'&&r.push!=='past'&&r.push!=='wait';
  const pLbl=pushOn()?(r.push==='err'?'Повторить':'Запланировать уведомление'):'Настроить уведомления';
  openSheet(`<h2>${fresh?'Напоминание сохранено':'Напоминание'}</h2><b>${esc(whenText(r))}</b><p class="txt">${esc(r.text)}</p>
  ${r.media.length?`<div class="gr">${r.media.map(thumb).join('')}</div>`:''}
  <p class="mute" style="margin-top:14px">${psText}</p>
  ${showPush?`<button class="primary" id="d_push">${pLbl}</button>`:''}
  <button class="ghost" id="d_cal">Дополнительно: добавить в Календарь</button><button class="ghost" id="d_x">Закрыть</button>`);
  hy($('#sheet'));openId=r.id;window._sc=()=>{openId=null};
  $('#d_x').onclick=closeSheet;
  $('#d_cal').onclick=()=>cal(r);
  const dp=$('#d_push');if(dp)dp.onclick=async()=>{if(!pushOn()){pushSheet();return}await sync(r);sv();detail(r)};
  $('#sheet').onclick=e=>{const b=e.target.closest('[data-mv]');if(b)mview(r,b.dataset.mv)};
}
async function mview(r,id){
  const m=r.media.find(x=>x.id===id);if(!m)return;
  const u=await mdb.url(id);
  openSheet(`${m.kind==='video'?`<video class="big m" src="${u}" controls playsinline></video>`:`<img class="big m" src="${u}" alt="">`}
  <div class="acts" style="margin-top:12px"><button class="sm" id="v_dl">Скачать</button><button class="sm" id="v_x">Назад</button></div>`);
  $('#v_x').onclick=()=>detail(r);
  $('#v_dl').onclick=async()=>{const x=await mdb.mGet(id);if(x)mdb.share(x.blob,m.name,m.type,u)};
}

const body=$('#rembody');
body.addEventListener('click',async e=>{
  const d=e.target.closest('[data-del]');
  if(d){const r=R.items.find(x=>x.id===d.dataset.del);if(r&&confirm('Удалить это напоминание вместе с файлами?'))await remove([r]);return}
  const b=e.target.closest('[data-a]');
  if(b){
    const a=b.dataset.a;
    if(a==='new'){draft={files:[]};v='new';show()}
    else if(a==='list'){v='list';show()}
    else if(a==='save')save();
    else if(a==='push')pushSheet();
    else if(a==='clrf'){draft.files=[];flist()}
    else if(a==='clr'){const ps=R.items.filter(past);if(ps.length&&confirm('Удалить весь архив ('+ps.length+' шт.) вместе с файлами?'))await remove(ps)}
    return;
  }
  const it=e.target.closest('.ri');
  if(it){const r=R.items.find(x=>x.id===it.dataset.id);if(r)detail(r)}
});
body.addEventListener('change',e=>{
  if(e.target.id==='r_rep'){
    $('#r_ul').hidden=!e.target.checked;
    if(e.target.checked&&!$('#r_until').value){const [y,m,dd]=$('#r_d').value.split('-').map(Number);if(y)$('#r_until').value=iso(new Date(y,m-1,dd+29))}
    return;
  }
  if(e.target.id==='r_f'){const fs=[...e.target.files];e.target.value='';draft.files.push(...fs);flist()}
});
})();
