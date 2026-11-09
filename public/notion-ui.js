import { initContentSizedTables } from './table-layout.js';
import { filterAudience, recipientSnapshot, operators } from './audience.js';
import { choiceValues } from './notion-fields.js';
import { viewSettings, activeViewFilter, namedViews, filterOperatorLabels as labels } from './recipient-views.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const requiredColumns=['Name','Email'];
const defaults=[...requiredColumns,'Lists'];
const cleanSettings=()=>viewSettings();
const clone = value=>JSON.parse(JSON.stringify(value));
const icon = paths => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const icons = {
  pencil:icon('<path d="M21.17 6.81a1 1 0 0 0-3.98-3.99L3 17l-1 5 5-1Z"/><path d="m15 5 4 4"/>'),
  search:icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  refresh:icon('<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.3 7a8 8 0 0 1 13.1-2L20 7M4 17l1.6 2A8 8 0 0 0 18.7 17"/>'),
  save:icon('<path d="M15.2 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.8a2 2 0 0 0-.59-1.42L16.62 3.59A2 2 0 0 0 15.2 3Z"/><path d="M7 3v5h8M7 21v-8h10v8"/>'),
  sort:icon('<path d="M7 20V4m-4 4 4-4 4 4m6-4v16m-4-4 4 4 4-4"/>'),
  external:icon('<path d="M15 3h6v6m0-6-9 9"/><path d="M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>'),
  remove:icon('<path d="m6 6 12 12M18 6 6 18"/>'),
  plus:icon('<path d="M12 5v14M5 12h14"/>'),
  chevron:icon('<path d="m6 9 6 6 6-6"/>'),
  more:icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  duplicate:icon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  group:icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 15h10"/>'),
  eye:icon('<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>'),
  eyeOff:icon('<path d="m3 3 18 18M10.6 6.1c.5-.1.9-.1 1.4-.1 6.4 0 10 6 10 6a15 15 0 0 1-3 3.3M6.3 7.7A16 16 0 0 0 2 12s3.6 6 10 6c1.5 0 2.9-.3 4.1-.8"/>')
};

export function initNotionBrowser({useSnapshot,saveSnapshot,setStatus,getCurrentSource,getCurrentGroup,getSavedLists,renameSavedList}) {
  const root=document.querySelector('#notionBrowser'),dialog=document.querySelector('#audienceDialog');
  let data,busy=false,mode='campaign',settings=cleanSettings(),fields=[...defaults],csvStaged=false,viewName='',manualList=null,savingView=false;
  root.innerHTML=`<div class="notion-browser-header">
    <span id="notionStatus" role="status">Ready to load</span>
    <a id="notionOpen" class="notion-database-link" href="https://www.notion.so/8312015036a44b90be22b9b05cd1b9df" target="_blank" rel="noopener noreferrer">Open database in Notion ${icons.external}</a>
  </div>
  <div class="database-view-toolbar">
    <div class="database-view-group">
      <select id="notionSavedView" aria-label="Saved group"><option value="">All contacts</option></select>
      <button type="button" id="renameRecipientView" class="notion-icon-button" aria-label="Rename group" title="Rename group" hidden>${icons.pencil}</button>
    </div>
    <label class="database-search">${icons.search}<span class="sr-only">Search contacts</span><input id="notionSearch" type="search"></label>
    <div class="database-view-actions">
      <button id="saveRecipientView" type="button" class="notion-icon-button" aria-label="Save group" title="Save group" disabled>${icons.save}</button>
      <button id="notionLoad" type="button" class="notion-icon-button" aria-label="Refresh from Notion" title="Refresh from Notion">${icons.refresh}</button>
      <button id="toggleViewSort" type="button" class="notion-icon-button" aria-label="Sort and limit" title="Sort and limit" aria-expanded="false" aria-controls="notionSortPanel" disabled>${icons.sort}</button>
    </div>
  </div>
  <section id="notionFilterPanel" class="database-filter-panel" aria-labelledby="notionFilterTitle">
    <div class="database-filter-title"><strong id="notionFilterTitle">Set filters</strong><button type="button" id="resetAudienceFilters" disabled>Clear filters</button></div>
    <fieldset id="notionFilters" aria-label="Filter conditions" disabled></fieldset>
    <div id="notionFilterMenu" class="notion-popup" popover="auto" role="group" aria-label="Filter actions"></div>
  </section>
  <section id="notionSortPanel" class="database-sort-panel" aria-label="Sort contacts" hidden>
    <label>Sort by<select id="notionSort"></select></label><label>Order<select id="notionDirection"><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
    <label>Batch size<select id="notionLimit"><option value="0">All matches</option><option value="50">First 50</option><option value="100">First 100</option><option value="250">First 250</option></select></label>
  </section>
  <div id="notionWorkspace" hidden><p id="notionCount" class="notion-result-count"></p>
  <div class="table-wrap audience-preview-table database-contact-table" tabindex="0" aria-label="Contact table">
    <table><thead><tr id="notionTableHead"><th class="notion-column-action" scope="col"><button id="chooseNotionColumns" type="button" class="notion-icon-button" popovertarget="notionColumnPicker" aria-label="Choose columns" title="Choose columns">${icons.plus}</button></th></tr></thead><tbody id="notionRows"></tbody></table>
  </div>
  <div id="notionColumnPicker" class="notion-popup notion-column-picker" popover="auto" role="group" aria-label="Column visibility"></div>
  <div class="audience-picker-footer"><button type="button" id="notionUse" class="primary">Use recipients</button></div></div>`;
  initContentSizedTables(root);
  const useDialog=document.createElement('dialog');useDialog.id='useAudienceDialog';useDialog.setAttribute('aria-labelledby','useAudienceTitle');
  useDialog.innerHTML=`<div class="preview-head"><h3 id="useAudienceTitle">Use list for this campaign</h3><button type="button" id="closeUseAudience" aria-label="Close list check">×</button></div><label>Message purpose<select id="useAudiencePurpose"><option value="recruiting">Application invitation</option><option value="reminder">Application reminder</option><option value="deadline">Application deadline</option><option value="newsletter">Newsletter</option></select></label><p id="useAudienceExplanation" class="hint"></p><p id="useAudienceCount"></p><div class="toolbar"><button type="button" id="cancelUseAudience">Cancel</button><button type="button" id="confirmUseAudience" class="primary">Use recipients</button></div>`;document.body.append(useDialog);
  const renameDialog=document.createElement('dialog');renameDialog.id='renameListDialog';renameDialog.setAttribute('aria-labelledby','renameListTitle');
  renameDialog.innerHTML=`<form id="renameListForm"><div class="preview-head"><h3 id="renameListTitle">Rename group</h3><button type="button" id="closeRenameList" aria-label="Close rename group">×</button></div><label>Group name<input id="renamedListName" required autocomplete="off"></label><p id="renameListError" class="status error" role="alert"></p><div class="toolbar"><button type="button" id="cancelRenameList">Cancel</button><button type="submit" class="primary">Save name</button></div></form>`;document.body.append(renameDialog);
  const $=id=>root.querySelector('#'+id);
  const availableFields = () => manualList
    ? (manualList.recipientColumns || []).map(column=>({...column.notion,name:column.label,type:column.notion?.type || 'text'}))
    : data?.fields || [];
  const visibleFields = () => [...new Set([...requiredColumns,...fields])];
  const field=name=>availableFields().find(f=>f.name===name)||{name,type:'text',options:[]};
  const at=path=>path.reduce((node,i)=>node.rules[i],settings.filter);
  const pathFor=target=>target.dataset.path?target.dataset.path.split('.').map(Number):[];
  const textOperator=operator=>['contains','not_contains'].includes(operator);
  const rule=()=>({property:manualList && !availableFields().some(f=>f.name==='Lists')?'Name':'Lists',operator:'contains',value:''});
  const currentContacts=()=>manualList?manualList.recipients.map((r,i)=>({id:String(i),properties:Object.fromEntries([['Name',r.name||''],['Email',r.email||''],...(manualList.recipientColumns || []).map(column=>{
    const value = r[column.key] ?? '';
    const type = column.notion?.type;
    return [column.label,type==='multi_select' ? choiceValues(value,column.notion) : type==='checkbox' && value!=='' ? value==='true' : value];
  })])})):data?.contacts||[];
  const result=()=>filterAudience(currentContacts(),{...settings,purpose:'browse',filter:activeViewFilter(settings.filter)});
  function notionSnapshot(database, view, includedFields, purpose, tableName) {
    const matching = filterAudience(database.contacts, {...view, filter:activeViewFilter(view.filter)}).contacts;
    const contacts = purpose === 'browse' ? matching : filterAudience(matching, {
      purpose, phase:database.currentPhase, memberCopies:view.memberCopies
    }).contacts;
    return {...recipientSnapshot(contacts,includedFields,database.fields),tableName,audienceSource:{
      sourceId:database.sourceId,databaseUrl:database.databaseUrl,loadedAt:database.loadedAt,
      phase:database.currentPhase,...clone(view),purpose,fields:[...includedFields]
    }};
  }
  function snapshot(purpose='browse'){
    if (!manualList) return notionSnapshot(data,settings,fields,purpose,viewName||'Filtered contacts');
    const contacts = result().contacts;
    const filtered = Boolean(activeViewFilter(settings.filter) || settings.search || settings.limit);
    return {
      tableName:viewName||'New group',
      recipientColumns:clone(manualList.recipientColumns),
      recipients:contacts.map(c=>clone(manualList.recipients[Number(c.id)])),
      audienceDetails:filtered ? {...manualList.audienceDetails,...clone(settings),customized:true} : manualList.audienceDetails
    };
  }
  function filterMarkup(node, path = []) {
    const pathValue = path.join('.');
    if (node.rules) {
      const rows=node.rules.map((n,i)=>{
        const childPath=[...path,i],joined=n.join||node.match||'all';
        const connector=i?`<select class="filter-join" aria-label="Join before filter ${childPath.map(x=>x+1).join('.')}" data-path="${childPath.join('.')}" data-action="join"><option value="all" ${joined==='all'?'selected':''}>And</option><option value="any" ${joined==='any'?'selected':''}>Or</option></select>`:'<span class="filter-first-label">Where</span>';
        return `<div class="filter-item">${connector}<div class="filter-item-body">${filterMarkup(n,childPath)}</div></div>`;
      }).join('');
      return `<div class="filter-group${path.length?' nested-filter-group':''}">${rows}<div class="filter-group-actions">
        <button type="button" data-path="${pathValue}" data-filter-menu="add" aria-expanded="false" aria-controls="notionFilterMenu">${icons.plus} Add filter rule ${icons.chevron}</button>
        ${path.length?`<button type="button" class="filter-more-button" data-path="${pathValue}" data-filter-menu="row" aria-label="Filter group actions" aria-expanded="false" aria-controls="notionFilterMenu">${icons.more}</button>`:''}
      </div></div>`;
    }
    const f = field(node.property), ops=operators[f.type] || operators.text;
    const suggested = ['equals','not_equals'].includes(node.operator) && f.options?.length;
    const suggestionsId = `filter-values-${path.join('-')}`;
    const val = ['empty','not_empty'].includes(node.operator) ? '' : f.type === 'checkbox'
      ? `<select aria-label="Filter value" data-path="${pathValue}" data-action="value"><option value="true" ${String(node.value)==='true'?'selected':''}>Yes</option><option value="false" ${String(node.value)==='false'?'selected':''}>No</option></select>`
      : `<input aria-label="Filter value" data-path="${pathValue}" data-action="value" type="${f.type==='number'?'number':f.type==='date'?'date':'text'}" placeholder="Enter value" value="${esc(node.value)}" ${suggested?`list="${suggestionsId}"`:''}>${suggested?`<datalist id="${suggestionsId}">${f.options.map(option=>`<option value="${esc(option)}"></option>`).join('')}</datalist>`:''}`;
    return `<div class="filter-rule"><select aria-label="Filter property" data-path="${pathValue}" data-action="property">${[...new Set(['Lists','Name','Email','First name','Last name',...availableFields().map(f=>f.name),node.property])].map(name=>field(name)).map(f=>`<option ${node.property===f.name?'selected':''} value="${esc(f.name)}">${esc(f.name)}</option>`).join('')}</select><select aria-label="Filter operator" data-path="${pathValue}" data-action="operator">${ops.map(op=>`<option ${node.operator===op?'selected':''} value="${op}">${labels[op]}</option>`).join('')}</select>${val}<button type="button" class="filter-more-button" data-path="${pathValue}" data-filter-menu="row" aria-label="Filter rule actions" aria-expanded="false" aria-controls="notionFilterMenu">${icons.more}</button></div>`;
  }
  function renderFilters(){
    if (!settings.filter.rules.length) settings.filter.rules.push(rule());
    $('notionFilters').innerHTML=filterMarkup(settings.filter);
  }
  function renderNamedViews(){
    $('notionSavedView').innerHTML='<option value="">All contacts</option>'+namedViews(getSavedLists()).map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
    $('notionSavedView').value=viewName;
    $('renameRecipientView').hidden=!viewName;
  }
  function syncControls(){
    if(!data)return;
    $('notionFilters').disabled=false;$('resetAudienceFilters').disabled=false;$('toggleViewSort').disabled=false;
    renderNamedViews();
    $('notionSort').innerHTML=availableFields().map(f=>`<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
    for(const [id,key]of[['notionSearch','search'],['notionSort','sortProperty'],['notionDirection','sortDirection'],['notionLimit','limit']])$(id).value=String(settings[key]);
    renderFilters();renderColumnPicker();render();
  }
  function renderColumnPicker(){
    const visible = visibleFields();
    const hidden = availableFields().map(field=>field.name).filter(name=>!visible.includes(name));
    $('notionColumnPicker').innerHTML = [...visible,...hidden].map(name=>{
      const shown = visible.includes(name);
      const locked = requiredColumns.includes(name);
      return `<button type="button" data-field="${esc(name)}" aria-pressed="${shown}" ${locked?'disabled title="Required column"':''}><span>${esc(name)}</span>${shown?icons.eye:icons.eyeOff}</button>`;
    }).join('');
  }
  function placePopup(picker, trigger, alignEnd = true){
    if (!trigger || !picker.matches(':popover-open')) return;
    const anchor = trigger.getBoundingClientRect();
    const left = alignEnd ? anchor.right-picker.offsetWidth : anchor.left;
    picker.style.left = `${Math.max(8,Math.min(left,innerWidth-picker.offsetWidth-8))}px`;
    picker.style.top = `${anchor.bottom+picker.offsetHeight+6 <= innerHeight-8 ? anchor.bottom+6 : Math.max(8,anchor.top-picker.offsetHeight-6)}px`;
  }
  const placeColumnPicker = () => placePopup($('notionColumnPicker'),$('chooseNotionColumns'));
  function cellMarkup(value){
    if (Array.isArray(value)) return `<div class="contact-list-tags">${value.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div>`;
    return esc(typeof value==='boolean' ? (value?'Yes':'No') : value);
  }
  function render(){
    if(!data)return;
    const r=result();
    const columns=visibleFields();
    const head=$('notionTableHead');
    if(head.dataset.columns!==JSON.stringify(columns)){
      head.querySelectorAll('th:not(.notion-column-action)').forEach(cell=>cell.remove());
      head.lastElementChild.insertAdjacentHTML('beforebegin',columns.map(name=>`<th scope="col">${esc(name)}</th>`).join(''));
      head.dataset.columns=JSON.stringify(columns);
    }
    $('notionWorkspace').hidden=false;$('notionCount').textContent=`${r.contacts.length} ${r.contacts.length===1?'contact':'contacts'}`;
    $('notionRows').innerHTML=r.contacts.map(c=>`<tr>${columns.map(name=>`<td>${cellMarkup(c.properties[name])}</td>`).join('')}<td class="notion-column-action"></td></tr>`).join('')
      || `<tr><td colspan="${columns.length+1}" class="empty-table">No contacts match these filters.</td></tr>`;
    $('notionUse').disabled=busy||!r.contacts.length;$('saveRecipientView').disabled=busy||!r.contacts.length;
    $('notionUse').parentElement.hidden=mode==='contacts';
  }
  async function load(){
    if(busy)return;busy=true;$('notionLoad').disabled=true;$('notionLoad').setAttribute('aria-busy','true');$('notionStatus').textContent='Loading contacts…';render();
    try{
      const response=await fetch('/api/notion/load',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),body=await response.json();
      if(!response.ok)throw Error(body.error||'Could not load Notion.');
      data=body;$('notionOpen').href=body.databaseUrl;
      $('notionStatus').textContent=`Updated at ${new Date(data.loadedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;syncControls();
      return body;
    }catch(error){$('notionStatus').textContent=error.message;setStatus(error.message,'error');}
    finally{busy=false;$('notionLoad').disabled=false;$('notionLoad').removeAttribute('aria-busy');render();}
  }
  function resetView(){settings=cleanSettings();fields=[...defaults];viewName='';manualList=null;$('notionColumnPicker').hidePopover?.();$('notionFilterMenu').hidePopover?.();$('notionSortPanel').hidden=true;$('toggleViewSort').setAttribute('aria-expanded','false');}
  function selectView(name){
    resetView();const list=getSavedLists()[name];
    if(list){
      viewName=name;
      if(list.audienceSource?.sourceId){settings=viewSettings(list.audienceSource);fields=[...(list.audienceSource.fields||defaults)];}
      else {manualList=list;fields=availableFields().map(field=>field.name);}
    }
    if(data)syncControls();
  }
  function describeSaved(){
    const selected=document.querySelector('#tableSelect').value,list=getSavedLists()[selected];
    document.querySelector('#savedListDescription').textContent=list?`${list.recipients.length} recipients · saved ${new Date(list.savedAt).toLocaleDateString('en-GB')}`:'No saved lists yet.';
    document.querySelector('#loadTableButton').disabled=!list;
  }
  function showSource(source){
    dialog.scrollTop=0;
    $('notionColumnPicker').hidePopover?.();
    $('notionFilterMenu').hidePopover?.();
    for(const button of document.querySelectorAll('[data-source]')){const active=button.dataset.source===source;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
    for(const [id,key]of[['pickerNotion','notion'],['pickerSaved','saved'],['pickerCsv','csv']])document.querySelector('#'+id).hidden=key!==source;
    if(source==='notion'){mode='campaign';document.querySelector('#pickerNotion').append(root);if(!data)load();else syncControls();}
    if(source==='saved')describeSaved();
    if(source==='csv'&&!csvStaged){document.querySelector('#csvGroupName').value='';document.querySelector('#rawRecipients').value='';document.querySelector('#csvFile').value='';csvStaged=true;}
  }
  function open(_source='notion',fromReview=null){
    csvStaged=false;mode='campaign';resetView();
    if(fromReview)settings=viewSettings(fromReview);
    document.querySelector('#pickerNotion').append(root);showSource(_source);
    if(!dialog.open){
      dialog.showModal();
      dialog.querySelector('#audienceDialogTitle').focus({preventScroll:true});
    }
  }
  function checkUse(){
    const purpose=document.querySelector('#useAudiencePurpose').value,selected=result().contacts,eligible=filterAudience(selected,{purpose,phase:data.currentPhase,memberCopies:settings.memberCopies||[]}).contacts;
    document.querySelector('#useAudienceExplanation').textContent=({deadline:`Non-members without a submitted ${data.currentPhase} application, including unfinished applications. Active opt-outs are excluded.`,recruiting:`Non-members who have not started or submitted a ${data.currentPhase} application. Active opt-outs are excluded; a missing newsletter opt-in does not exclude an invitation.`,reminder:`Only unfinished ${data.currentPhase} applications. Members and completed applications are excluded.`,newsletter:'Only contacts with an active newsletter subscription.'})[purpose];
    document.querySelector('#useAudienceCount').textContent=`${eligible.length} of ${selected.length} contacts can receive this email.`;
    const confirm=document.querySelector('#confirmUseAudience');confirm.disabled=!eligible.length;confirm.textContent=`Use ${eligible.length} ${eligible.length===1?'recipient':'recipients'}`;
  }
  document.addEventListener('mailbot:open-audience',event=>open(event.detail?.source || 'notion'));
  document.querySelector('#manageSavedLists').addEventListener('click',()=>open('saved'));
  document.querySelector('#closeAudience').addEventListener('click',()=>dialog.close());
  // Saved lists are selected in the database toolbar, never confused with Notion tags.
  document.querySelector('#sourceSaved').hidden=false;
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
  $('saveRecipientView').addEventListener('click',()=>{savingView=true;saveSnapshot({...snapshot(),tableName:viewName||'New group'});});
  $('toggleViewSort').addEventListener('click',()=>{const panel=$('notionSortPanel');panel.hidden=!panel.hidden;$('toggleViewSort').setAttribute('aria-expanded',String(!panel.hidden));});
  $('renameRecipientView').addEventListener('click',()=>{document.querySelector('#renamedListName').value=viewName;document.querySelector('#renameListError').textContent='';renameDialog.showModal();document.querySelector('#renamedListName').select();});
  for(const id of ['closeRenameList','cancelRenameList'])document.querySelector('#'+id).addEventListener('click',()=>renameDialog.close());
  document.querySelector('#renameListForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{viewName=await renameSavedList(viewName,document.querySelector('#renamedListName').value);renderNamedViews();renameDialog.close();}catch(error){document.querySelector('#renameListError').textContent=error.message;}finally{button.disabled=false;}});
  for(const [id,key]of[['notionSearch','search'],['notionSort','sortProperty'],['notionDirection','sortDirection'],['notionLimit','limit']])$(id).addEventListener(id==='notionSearch'?'input':'change',()=>{settings[key]=key==='limit'?Number($(id).value):$(id).value;render();});
  const columnPicker=$('notionColumnPicker');
  const filterMenu=$('notionFilterMenu');
  let filterMenuTrigger;
  const placeFilterMenu=()=>placePopup(filterMenu,filterMenuTrigger,filterMenuTrigger?.dataset.filterMenu==='row');
  const placePopups=()=>{placeColumnPicker();placeFilterMenu();};
  columnPicker.addEventListener('toggle',event=>{
    if(event.newState!=='open')return;
    placeColumnPicker();
    columnPicker.querySelector('button:not(:disabled)')?.focus();
  });
  dialog.addEventListener('scroll',placePopups,{passive:true});
  window.addEventListener('resize',placePopups);
  columnPicker.addEventListener('click',event=>{
    const button=event.target.closest('button[data-field]');
    if(!button || button.disabled)return;
    const name=button.dataset.field;
    fields=fields.includes(name)?fields.filter(field=>field!==name):[...fields,name];
    render();renderColumnPicker();placeColumnPicker();
    [...columnPicker.querySelectorAll('button')].find(item=>item.dataset.field===name)?.focus();
  });
  $('notionFilters').addEventListener('click',event=>{
    const button=event.target.closest('button[data-filter-menu]');
    if(!button)return;
    if(button===filterMenuTrigger && filterMenu.matches(':popover-open')){filterMenu.hidePopover();return;}
    filterMenuTrigger?.setAttribute('aria-expanded','false');
    filterMenuTrigger=button;
    const path=pathFor(button);
    const node=at(path);
    const actions=button.dataset.filterMenu==='add'
      ? [['add','Add filter rule',icons.plus],...(path.length<2?[['group','Add filter group',icons.group]]:[])]
      : [['remove','Remove',icons.remove],['duplicate','Duplicate',icons.duplicate],...(!node.rules && path.length<3?[['wrap','Turn into group',icons.group]]:[])];
    filterMenu.innerHTML=actions.map(([action,label,glyph])=>`<button type="button" data-filter-action="${action}">${glyph}<span>${label}</span></button>`).join('');
    filterMenu.showPopover();
    button.setAttribute('aria-expanded','true');
    placeFilterMenu();
    filterMenu.firstElementChild.focus();
  });
  filterMenu.addEventListener('beforetoggle',event=>{
    if(event.newState==='closed')filterMenuTrigger?.setAttribute('aria-expanded','false');
  });
  filterMenu.addEventListener('click',event=>{
    const action=event.target.closest('button[data-filter-action]')?.dataset.filterAction;
    if(!action || !filterMenuTrigger)return;
    const path=pathFor(filterMenuTrigger);
    const node=at(path);
    filterMenu.hidePopover();
    let focusPath=path;
    if(action==='add' || action==='group'){
      focusPath=[...path,node.rules.length];
      node.rules.push(action==='add'?rule():{match:'all',rules:[rule()]});
    }else{
      const siblings=at(path.slice(0,-1)).rules;
      const index=path.at(-1);
      if(action==='remove')siblings.splice(index,1);
      if(action==='duplicate'){siblings.splice(index+1,0,clone(node));focusPath=[...path.slice(0,-1),index+1];}
      if(action==='wrap'){
        const {join,...condition}=node;
        siblings[index]={match:'all',join,rules:[condition]};
      }
    }
    renderFilters();render();
    const controls=$('notionFilters');
    (controls.querySelector(`[data-action="property"][data-path="${focusPath.join('.')}"]`)
      || controls.querySelector(`[data-action="property"][data-path^="${focusPath.join('.')}."]`)
      || controls.querySelector('[data-action="property"]'))?.focus();
  });
  $('notionFilters').addEventListener('input',event=>{
    const target=event.target;
    if(target.tagName!=='INPUT'||target.dataset.action!=='value')return;
    const node=at(pathFor(target));
    node.value=target.value;
    if(textOperator(node.operator))node.partialMatch=true;
    render();
  });
  $('notionFilters').addEventListener('change',event=>{
    const target=event.target;
    const action=target.dataset.action;
    if(!action)return;
    const node=at(pathFor(target));
    node[action]=target.value;
    if(action==='property'){
      const f=field(target.value);
      node.operator=(operators[f.type]||operators.text)[0];
      node.value=f.type==='checkbox'?'true':'';
      delete node.partialMatch;
    }
    if(action==='property'||action==='operator'){
      renderFilters();
      $('notionFilters').querySelector(`[data-action="${action}"][data-path="${target.dataset.path}"]`)?.focus();
    }
    render();
  });
  $('resetAudienceFilters').addEventListener('click',()=>{settings.filter={match:'all',rules:[]};syncControls();});
  $('notionUse').addEventListener('click',()=>{if(manualList){useSnapshot(snapshot());dialog.close();return;}const current=getCurrentSource()?.purpose;document.querySelector('#useAudiencePurpose').value=['recruiting','reminder','newsletter','deadline'].includes(current)?current:'newsletter';checkUse();useDialog.showModal();});
  document.querySelector('#useAudiencePurpose').addEventListener('change',checkUse);
  for(const id of ['closeUseAudience','cancelUseAudience'])document.querySelector('#'+id).addEventListener('click',()=>useDialog.close());
  document.querySelector('#confirmUseAudience').addEventListener('click',()=>{const purpose=document.querySelector('#useAudiencePurpose').value;useSnapshot(snapshot(purpose));useDialog.close();dialog.close();});
  document.addEventListener('mailbot:refresh-audience',async()=>{
    const source = getCurrentSource();
    if (!source?.sourceId || busy) return;
    const group = getCurrentGroup();
    const setRefreshing = value => document.dispatchEvent(new CustomEvent('mailbot:refreshing-audience',{detail:value}));
    setRefreshing(true);
    try {
      const database = await load();
      if (!database) return;
      if (database.sourceId !== source.sourceId) {
        setStatus('The connected Notion database does not match this group.','error');
        return;
      }
      const current = getCurrentGroup();
      if (getCurrentSource() !== source || current.name !== group.name ||
          current.draft !== group.draft || current.details !== group.details) return;
      useSnapshot(notionSnapshot(database,viewSettings(source),source.fields||defaults,source.purpose||'browse',group.name));
    } finally { setRefreshing(false); }
  });
  document.addEventListener('mailbot:page-changed',event=>{if(event.detail.page!=='contacts')return;mode='contacts';document.querySelector('#contactsHost').append(root);resetView();if(!data)load();else syncControls();});
  renderNamedViews();
  renderFilters();
  if(document.querySelector('[data-page="contacts"]').classList.contains('active')){mode='contacts';document.querySelector('#contactsHost').append(root);load();}
  return {open,describeSaved};
}
