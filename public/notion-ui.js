import { initContentSizedTables } from './table-layout.js';
import { filterAudience, recipientSnapshot, operators, purposes } from './audience.js';
import { viewSettings, activeViewFilter, namedViews } from './recipient-views.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = { equals:'is', not_equals:'is not', contains:'contains', not_contains:'does not contain', empty:'is empty', not_empty:'is not empty', gt:'greater than', gte:'at least', lt:'less than', lte:'at most', before:'before', after:'after', starts_with:'starts with', ends_with:'ends with', on:'on', on_or_before:'on or before', on_or_after:'on or after' };
const defaults=['Name','First name','Last name','Email','Lists'];
const cleanSettings=()=>viewSettings();
const clone = value=>JSON.parse(JSON.stringify(value));
const countRules=node=>node?.rules ? node.rules.reduce((sum,r)=>sum+countRules(r),0) : node?.property ? 1 : 0;

export function initNotionBrowser({useSnapshot,saveSnapshot,setStatus,getCurrentSource,getSavedLists,renameSavedList}) {
  const root=document.querySelector('#notionBrowser'),dialog=document.querySelector('#audienceDialog');
  let data,busy=false,mode='campaign',settings=cleanSettings(),fields=[...defaults],csvStaged=false,viewName='',manualList=null,savingView=false;
  root.innerHTML=`<div class="database-view-toolbar">
    <label class="saved-view-label"><span class="sr-only">Saved list</span><select id="notionSavedView" aria-label="Saved list"><option value="">All contacts</option></select></label><button type="button" id="renameRecipientView" class="ghost rename-view-button" aria-label="Rename list" title="Rename list" hidden><svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 4 4 4M4 16l1-4L14 3l3 3-9 9-4 1Z"/></svg></button>
    <div class="database-view-actions"><button type="button" id="toggleViewFilters" disabled class="ghost" aria-expanded="false" aria-controls="notionFilterPanel" aria-label="Filters"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 5h14M5.5 10h9M8 15h4"/></svg><span id="viewFilterCount"></span></button><button type="button" id="toggleViewSort" disabled class="ghost" aria-label="Sort" title="Sort" aria-expanded="false" aria-controls="notionSortPanel"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 16V4m-3 3 3-3 3 3m5-3v12m-3-3 3 3 3-3"/></svg></button><label class="database-search"><span class="sr-only">Search contacts</span><input id="notionSearch" type="search" placeholder="Search"></label><button id="notionLoad" type="button" class="ghost">Refresh</button><button id="saveRecipientView" type="button" disabled>Save list</button></div>
  </div>
  <div class="notion-connection database-connection"><div><a id="notionOpen" href="https://www.notion.so/8312015036a44b90be22b9b05cd1b9df" target="_blank" rel="noopener">Notion contacts ↗</a><span id="notionStatus" role="status">Ready to load</span></div><strong id="notionCount"></strong></div>
  <section id="notionSortPanel" class="database-sort-panel" aria-label="Sort contacts" hidden><label>Sort by<select id="notionSort"></select></label><label>Order<select id="notionDirection"><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></section>
  <section id="notionFilterPanel" class="database-filter-panel" aria-label="Database filters" hidden><div class="database-filter-title"><strong>Filters</strong><button type="button" class="ghost" id="resetAudienceFilters">Clear filters</button></div><div id="notionFilters"></div><details class="view-more-options"><summary>More options</summary><div class="notion-search"><label>Batch size<select id="notionLimit"><option value="0">All matches</option><option value="50">First 50</option><option value="100">First 100</option><option value="250">First 250</option></select></label></div><details class="notion-columns"><summary>Extra personalization fields</summary><p class="hint">First name, last name and email are always included.</p><div id="notionFields"></div></details></details></section>
  <div id="notionWorkspace" hidden><p class="audience-rule database-explanation">Browse all contacts and build filters. Save the result as a named list to use again. Saving a list does not subscribe anyone or send email.</p><div class="table-wrap audience-preview-table database-contact-table" tabindex="0" aria-label="Contact table"><table><thead><tr><th>Name</th><th>Email</th><th>Lists</th></tr></thead><tbody id="notionRows"></tbody></table></div>
  <div class="audience-picker-footer"><p id="notionUseHint">Select contacts for this campaign. No email is sent.</p><button type="button" id="notionUse" class="primary">Use list</button></div></div>`;
  initContentSizedTables(root);
  const useDialog=document.createElement('dialog');useDialog.id='useAudienceDialog';useDialog.setAttribute('aria-labelledby','useAudienceTitle');
  useDialog.innerHTML=`<div class="preview-head"><h3 id="useAudienceTitle">Use list for this campaign</h3><button type="button" id="closeUseAudience" aria-label="Close list check">×</button></div><label>Message purpose<select id="useAudiencePurpose"><option value="recruiting">Application invitation</option><option value="reminder">Application reminder</option><option value="deadline">Application deadline</option><option value="newsletter">Newsletter</option></select></label><p id="useAudienceExplanation" class="hint"></p><p id="useAudienceCount"></p><div class="toolbar"><button type="button" id="cancelUseAudience">Cancel</button><button type="button" id="confirmUseAudience" class="primary">Use recipients</button></div>`;document.body.append(useDialog);
  const renameDialog=document.createElement('dialog');renameDialog.id='renameListDialog';renameDialog.setAttribute('aria-labelledby','renameListTitle');
  renameDialog.innerHTML=`<form id="renameListForm"><div class="preview-head"><h3 id="renameListTitle">Rename list</h3><button type="button" id="closeRenameList" aria-label="Close rename list">×</button></div><label>List name<input id="renamedListName" required autocomplete="off"></label><p id="renameListError" class="status error" role="alert"></p><div class="toolbar"><button type="button" id="cancelRenameList">Cancel</button><button type="submit" class="primary">Save name</button></div></form>`;document.body.append(renameDialog);
  const $=id=>root.querySelector('#'+id);
  const field=name=>data?.fields.find(f=>f.name===name)||{name,type:'text',options:[]};
  const at=path=>path.reduce((node,i)=>node.rules[i],settings.filter);
  const rule=()=>({property:'Lists',operator:'contains',value:''});
  const currentContacts=()=>manualList?manualList.recipients.map((r,i)=>({id:String(i),properties:Object.fromEntries([['Name',r.name||''],['Email',r.email||''],...(manualList.recipientColumns||[]).map(c=>[c.label,r[c.key]||''])])})):data?.contacts||[];
  const result=()=>filterAudience(currentContacts(),{...settings,purpose:'browse',filter:activeViewFilter(settings.filter)});
  function snapshot(purpose='browse'){
    const r=result();
    if(manualList)return {tableName:viewName||'New list',recipientColumns:clone(manualList.recipientColumns),recipients:r.contacts.map(c=>clone(manualList.recipients[Number(c.id)])),audienceSource:null};
    const contacts=purpose==='browse'?r.contacts:filterAudience(r.contacts,{purpose,phase:data.currentPhase}).contacts;
    return {...recipientSnapshot(contacts,fields),tableName:viewName||'Filtered contacts',audienceSource:{sourceId:data.sourceId,databaseUrl:data.databaseUrl,loadedAt:data.loadedAt,phase:data.currentPhase,...clone(settings),purpose,fields:[...fields]}};
  }
  function filterMarkup(node, path = []) {
    const pathValue = path.join('.');
    if (node.rules) {
      const rows=node.rules.map((n,i)=>{
        const childPath=[...path,i],joined=n.join||node.match||'all';
        const connector=i?`<select class="filter-join" aria-label="Join before filter ${childPath.map(x=>x+1).join('.')}" data-path="${childPath.join('.')}" data-action="join"><option value="all" ${joined==='all'?'selected':''}>AND</option><option value="any" ${joined==='any'?'selected':''}>OR</option></select>`:'<span class="filter-first-label">Where</span>';
        return `<div class="filter-item">${connector}<div class="filter-item-body">${filterMarkup(n,childPath)}</div></div>`;
      }).join('');
      return `<div class="filter-group">${rows}<div class="filter-group-actions"><button type="button" data-path="${pathValue}" data-action="add">＋ Condition</button>${path.length<2?`<button type="button" data-path="${pathValue}" data-action="group">＋ Group</button>`:''}${path.length?`<button type="button" data-path="${pathValue}" data-action="remove" aria-label="Remove filter group">Remove group</button>`:''}</div>${!path.length&&node.rules.length>1?'<p class="filter-order-hint">Conditions run from top to bottom. Use groups to combine conditions.</p>':''}</div>`;
    }
    const f = field(node.property), ops=operators[f.type] || operators.text;
    const val = ['empty','not_empty'].includes(node.operator) ? '' : f.type === 'checkbox'
      ? `<select aria-label="Filter value" data-path="${pathValue}" data-action="value"><option value="true" ${String(node.value)==='true'?'selected':''}>Yes</option><option value="false" ${String(node.value)==='false'?'selected':''}>No</option></select>`
      : f.options?.length ? `<select aria-label="Filter value" data-path="${pathValue}" data-action="value"><option value="">Choose value</option>${f.options.map(v=>`<option ${node.value===v?'selected':''} value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`
      : `<input aria-label="Filter value" data-path="${pathValue}" data-action="value" type="${f.type==='number'?'number':f.type==='date'?'date':'text'}" value="${esc(node.value)}">`;
    return `<div class="filter-rule"><select aria-label="Filter property" data-path="${pathValue}" data-action="property">${[...new Set(['Lists','Name','Email','First name','Last name',node.property])].map(name=>field(name)).map(f=>`<option ${node.property===f.name?'selected':''} value="${esc(f.name)}">${esc(f.name)}</option>`).join('')}</select><select aria-label="Filter operator" data-path="${pathValue}" data-action="operator">${ops.map(op=>`<option ${node.operator===op?'selected':''} value="${op}">${labels[op]}</option>`).join('')}</select>${val}<button type="button" data-path="${pathValue}" data-action="remove" aria-label="Remove condition">×</button></div>`;
  }
  function renderFilters(){
    $('notionFilters').innerHTML=filterMarkup(settings.filter);
    const n=countRules(activeViewFilter(settings.filter));$('viewFilterCount').textContent=n?String(n):'';
    $('toggleViewFilters').setAttribute('aria-label',n?`Filters (${n})`:'Filters');
  }
  function renderNamedViews(){
    $('notionSavedView').innerHTML='<option value="">All contacts</option>'+namedViews(getSavedLists()).map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
    $('notionSavedView').value=viewName;
    $('renameRecipientView').hidden=!viewName;
  }
  function syncControls(){
    if(!data)return;
    $('toggleViewFilters').disabled=false;$('toggleViewSort').disabled=false;
    renderNamedViews();
    $('notionSort').innerHTML=data.fields.map(f=>`<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
    for(const [id,key]of[['notionSearch','search'],['notionSort','sortProperty'],['notionDirection','sortDirection'],['notionLimit','limit']])$(id).value=String(settings[key]);
    $('notionFields').innerHTML=data.fields.map(f=>`<label><input type="checkbox" data-field="${esc(f.name)}" ${fields.includes(f.name)?'checked':''} ${['Name','First name','Last name','Email'].includes(f.name)?'disabled':''}>${esc(f.name)}</label>`).join('');
    renderFilters();render();
  }
  function render(){
    if(!data)return;
    const r=result();
    $('notionWorkspace').hidden=false;$('notionCount').textContent=`${r.contacts.length} contacts`;
    $('notionRows').innerHTML=r.contacts.map(c=>{const p=c.properties,tags=Array.isArray(p.Lists)?p.Lists:String(p.Lists||'').split('; ').filter(Boolean);return `<tr><td>${esc(p.Name)}</td><td>${esc(p.Email)}</td><td><div class="contact-list-tags">${tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div></td></tr>`;}).join('')||'<tr><td colspan="3" class="empty-table">No contacts match these filters.</td></tr>';
    $('notionUse').disabled=busy||!r.contacts.length;$('saveRecipientView').disabled=busy||!r.contacts.length;
    $('notionUse').hidden=mode==='contacts';
    $('notionUseHint').textContent=mode==='contacts'?'Save a local list for future campaigns. No subscription status is changed.':'Eligibility is checked when using this list for a campaign. No email is sent.';
  }
  async function load({apply=false}={}){
    if(busy)return;busy=true;$('notionLoad').disabled=true;$('notionStatus').textContent='Loading contacts…';render();
    try{
      const response=await fetch('/api/notion/load',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),body=await response.json();
      if(!response.ok)throw Error(body.error||'Could not load Notion.');
      data=body;$('notionOpen').href=body.databaseUrl;
      $('notionStatus').textContent=`${data.contacts.length} contacts · updated ${new Date(data.loadedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;syncControls();
      if(apply){const source=getCurrentSource();if(source&&source.purpose!=='browse')useSnapshot(snapshot(source.purpose));}
    }catch(error){$('notionStatus').textContent=error.message;setStatus(error.message,'error');}
    finally{busy=false;$('notionLoad').disabled=false;render();}
  }
  function resetView(){settings=cleanSettings();fields=[...defaults];viewName='';manualList=null;$('notionFilterPanel').hidden=true;$('toggleViewFilters').setAttribute('aria-expanded','false');$('notionSortPanel').hidden=true;$('toggleViewSort').setAttribute('aria-expanded','false');if(data)syncControls();else renderNamedViews();}
  function selectView(name){
    resetView();const list=getSavedLists()[name];if(!list)return;
    viewName=name;
    if(list.audienceSource?.sourceId){settings=viewSettings(list.audienceSource);fields=[...new Set([...(list.audienceSource.fields||defaults),'Lists'])];}
    else manualList=list;
    if(data)syncControls();
  }
  function describeSaved(){
    const selected=document.querySelector('#tableSelect').value,list=getSavedLists()[selected];
    document.querySelector('#savedListDescription').textContent=list?`${list.recipients.length} recipients · saved ${new Date(list.savedAt).toLocaleDateString('en-GB')}`:'No saved lists yet.';
    document.querySelector('#loadTableButton').disabled=!list;
  }
  function showSource(source){
    dialog.scrollTop=0;
    for(const button of document.querySelectorAll('[data-source]')){const active=button.dataset.source===source;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
    for(const [id,key]of[['pickerNotion','notion'],['pickerSaved','saved'],['pickerCsv','csv']])document.querySelector('#'+id).hidden=key!==source;
    if(source==='notion'){mode='campaign';document.querySelector('#pickerNotion').append(root);if(!data)load();else syncControls();}
    if(source==='saved')describeSaved();
    if(source==='csv'&&!csvStaged){document.querySelector('#rawRecipients').value='';document.querySelector('#csvFile').value='';csvStaged=true;}
  }
  function open(_source='notion',fromReview=null){
    csvStaged=false;mode='campaign';resetView();
    if(fromReview)settings=viewSettings(fromReview);
    document.querySelector('#pickerNotion').append(root);showSource('notion');
    if(!dialog.open)dialog.showModal();
  }
  function checkUse(){
    const purpose=document.querySelector('#useAudiencePurpose').value,selected=result().contacts,eligible=filterAudience(selected,{purpose,phase:data.currentPhase}).contacts;
    document.querySelector('#useAudienceExplanation').textContent=({deadline:`Non-members without a submitted ${data.currentPhase} application, including unfinished applications. Active opt-outs are excluded.`,recruiting:`Non-members who have not started or submitted a ${data.currentPhase} application. Active opt-outs are excluded; a missing newsletter opt-in does not exclude an invitation.`,reminder:`Only unfinished ${data.currentPhase} applications. Members and completed applications are excluded.`,newsletter:'Only contacts with an active newsletter subscription.'})[purpose];
    document.querySelector('#useAudienceCount').textContent=`${eligible.length} of ${selected.length} contacts can receive this email.`;
    const confirm=document.querySelector('#confirmUseAudience');confirm.disabled=!eligible.length;confirm.textContent=`Use ${eligible.length} recipients`;
  }
  document.querySelector('#changeRecipients').addEventListener('click',()=>open());
  document.querySelector('#manageSavedLists').addEventListener('click',()=>open());
  document.querySelector('#closeAudience').addEventListener('click',()=>dialog.close());
  // Saved lists are selected in the database toolbar, never confused with Notion tags.
  document.querySelector('#sourceSaved').hidden=true;
  for(const button of document.querySelectorAll('[data-source]')){
    button.addEventListener('click',()=>showSource(button.dataset.source));
    button.addEventListener('keydown',event=>{const buttons=[...document.querySelectorAll('[data-source]')].filter(b=>!b.hidden),i=buttons.indexOf(button);let next;if(event.key==='ArrowRight')next=(i+1)%buttons.length;if(event.key==='ArrowLeft')next=(i+buttons.length-1)%buttons.length;if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;if(next!=null){event.preventDefault();showSource(buttons[next].dataset.source);buttons[next].focus();}});
  }
  document.querySelector('#tableSelect').addEventListener('change',describeSaved);
  document.addEventListener('mailbot:lists-changed',()=>{if(savingView){viewName=document.querySelector('#tableSelect').value;savingView=false;}renderNamedViews();describeSaved();});
  document.addEventListener('mailbot:review-list-selected',event=>open('notion',event.detail.source));
  $('notionLoad').addEventListener('click',()=>load());
  $('notionSavedView').addEventListener('change',()=>selectView($('notionSavedView').value));
  document.querySelector('#saveListDialog').addEventListener('close',()=>{savingView=false;});
  $('saveRecipientView').addEventListener('click',()=>{savingView=true;saveSnapshot({...snapshot(),tableName:viewName||'New list'});});
  $('toggleViewFilters').addEventListener('click',()=>{$('notionSortPanel').hidden=true;$('toggleViewSort').setAttribute('aria-expanded','false');const panel=$('notionFilterPanel');panel.hidden=!panel.hidden;$('toggleViewFilters').setAttribute('aria-expanded',String(!panel.hidden));});
  $('toggleViewSort').addEventListener('click',()=>{$('notionFilterPanel').hidden=true;$('toggleViewFilters').setAttribute('aria-expanded','false');const panel=$('notionSortPanel');panel.hidden=!panel.hidden;$('toggleViewSort').setAttribute('aria-expanded',String(!panel.hidden));});
  $('renameRecipientView').addEventListener('click',()=>{document.querySelector('#renamedListName').value=viewName;document.querySelector('#renameListError').textContent='';renameDialog.showModal();document.querySelector('#renamedListName').select();});
  for(const id of ['closeRenameList','cancelRenameList'])document.querySelector('#'+id).addEventListener('click',()=>renameDialog.close());
  document.querySelector('#renameListForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{viewName=await renameSavedList(viewName,document.querySelector('#renamedListName').value);renderNamedViews();renameDialog.close();}catch(error){document.querySelector('#renameListError').textContent=error.message;}finally{button.disabled=false;}});
  for(const [id,key]of[['notionSearch','search'],['notionSort','sortProperty'],['notionDirection','sortDirection'],['notionLimit','limit']])$(id).addEventListener(id==='notionSearch'?'input':'change',()=>{settings[key]=key==='limit'?Number($(id).value):$(id).value;render();});
  $('notionFields').addEventListener('change',e=>{const f=e.target.dataset.field;if(!f)return;fields=e.target.checked?[...fields,f]:fields.filter(x=>x!==f);render();});
  $('notionFilters').addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b)return;const path=b.dataset.path?b.dataset.path.split('.').map(Number):[],n=at(path);if(b.dataset.action==='add')n.rules.push(rule());if(b.dataset.action==='group')n.rules.push({match:'all',rules:[rule()]});if(b.dataset.action==='remove')at(path.slice(0,-1)).rules.splice(path.at(-1),1);renderFilters();render();});
  $('notionFilters').addEventListener('input',e=>{const t=e.target;if(t.tagName!=='INPUT'||t.dataset.action!=='value')return;const path=t.dataset.path.split('.').map(Number);at(path).value=t.value;render();});
  $('notionFilters').addEventListener('change',e=>{const t=e.target;if(!t.dataset.action)return;const path=t.dataset.path?t.dataset.path.split('.').map(Number):[],n=at(path);n[t.dataset.action]=t.value;if(t.dataset.action==='property'){const f=field(t.value);n.operator=(operators[f.type]||operators.text)[0];n.value=f.type==='checkbox'?'true':'';}if(['property','operator'].includes(t.dataset.action))renderFilters();render();});
  $('resetAudienceFilters').addEventListener('click',()=>{settings.filter={match:'all',rules:[]};settings.search='';syncControls();});
  $('notionUse').addEventListener('click',()=>{if(manualList){useSnapshot(snapshot());dialog.close();return;}const current=getCurrentSource()?.purpose;document.querySelector('#useAudiencePurpose').value=['recruiting','reminder','newsletter','deadline'].includes(current)?current:'newsletter';checkUse();useDialog.showModal();});
  document.querySelector('#useAudiencePurpose').addEventListener('change',checkUse);
  for(const id of ['closeUseAudience','cancelUseAudience'])document.querySelector('#'+id).addEventListener('click',()=>useDialog.close());
  document.querySelector('#confirmUseAudience').addEventListener('click',()=>{const purpose=document.querySelector('#useAudiencePurpose').value;useSnapshot(snapshot(purpose));useDialog.close();dialog.close();});
  document.querySelector('#refreshAudience').addEventListener('click',()=>{const source=getCurrentSource();settings=viewSettings(source);manualList=null;fields=source?.fields||[...defaults];load({apply:true});});
  document.addEventListener('mailbot:page-changed',event=>{if(event.detail.page!=='contacts')return;mode='contacts';document.querySelector('#contactsHost').append(root);resetView();if(!data)load();else syncControls();});
  renderNamedViews();
  if(document.querySelector('[data-page="contacts"]').classList.contains('active')){mode='contacts';document.querySelector('#contactsHost').append(root);load();}
  return {open,describeSaved};
}
