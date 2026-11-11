import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ArrowRight, ChevronDown, Database, FileUp, FileDown, Mail, Send, Plus, X, Pencil, Info, Trash2, Bold, Italic, Underline, List, Link, Ellipsis, ExternalLink, RefreshCw, Save } from 'lucide-react';
import { namesByLastSaved } from '../public/workspace-store.js';
import { choiceValues, isChoiceField, notionOptionColor } from '../public/notion-fields.js';
import { initStyledSelects } from '@/ui/styled-selects';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@/ui/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/ui/components/ui/field';
import { Input } from '@/ui/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/ui/components/ui/native-select';
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/ui/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from '@/ui/components/ui/dropdown-menu';

// These roots own only the new controls. The existing editor and audience engine
// keep their DOM and data ownership, so saved campaigns do not need migration.
function CampaignFlow() {
  return <nav className="page-nav workflow-nav" aria-label="Campaign steps">
    {(['recipients', 'message', 'review', 'send'] as const).map((page, index) =>
      <Button key={page} type="button" variant="ghost" className="page-link" data-page-target={page}>
        <span className="step-index" aria-hidden="true">{index + 1}</span>
        <span>{['Recipients', 'Message', 'Review', 'Send'][index]}</span>
      </Button>)}
  </nav>;
}

function PreviewTools() {
  const [theme, setTheme] = useState('light');
  const [device, setDevice] = useState('desktop');
  const [images, setImages] = useState('loaded');
  useEffect(() => {
    const sync = (event: Event) => setImages((event as CustomEvent).detail.blocked ? 'blocked' : 'loaded');
    document.addEventListener('mailbot:preview-images', sync);
    return () => document.removeEventListener('mailbot:preview-images', sync);
  }, []);
  return <div className="preview-options">
    <ToggleGroup type="single" value={device} onValueChange={v => v && setDevice(v)} spacing={0} variant="outline" aria-label="Preview device">
      <ToggleGroupItem id="desktopPreview" value="desktop">Desktop</ToggleGroupItem>
      <ToggleGroupItem id="mobilePreview" value="mobile">Mobile</ToggleGroupItem>
    </ToggleGroup>
    <ToggleGroup type="single" value={theme} onValueChange={v => v && setTheme(v)} spacing={0} variant="outline" aria-label="Preview theme">
      <ToggleGroupItem id="lightThemePreview" value="light">Light</ToggleGroupItem>
      <ToggleGroupItem id="darkThemePreview" value="dark">Dark</ToggleGroupItem>
    </ToggleGroup>
    <ToggleGroup type="single" value={images} onValueChange={v => v && setImages(v)} spacing={0} variant="outline" aria-label="External images">
      <ToggleGroupItem id="loadedContentPreview" value="loaded">Images on</ToggleGroupItem>
      <ToggleGroupItem id="blockedContentPreview" value="blocked">Images off</ToggleGroupItem>
    </ToggleGroup>
  </div>;
}

function SendControls() {
  return <>
    <div className="delivery-grid">
      <Card className="delivery-card">
        <CardHeader>
          <CardTitle>Send a test</CardTitle>
          <CardDescription>Review a real email in your inbox before sending to the list.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="testEmail">Test email address</FieldLabel>
              <Input id="testEmail" type="email" placeholder="you@example.com" autoComplete="email" />
              <FieldDescription>Uses the preview recipient’s details. Only this address receives the test.</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter><Button id="testButton" type="button" variant="outline"><Mail data-icon="inline-start" />Send test email</Button></CardFooter>
      </Card>
      <Card className="delivery-card">
        <CardHeader>
          <CardTitle>Send campaign</CardTitle>
          <CardDescription><span id="summaryRecipientCount">0</span> recipients · <span id="deliverySender">No sender connected</span></CardDescription>
          <CardAction><Badge variant="secondary" id="readinessBadge"><span id="summaryReady">Needs attention</span></Badge></CardAction>
        </CardHeader>
        <CardContent>
          <div id="sendChecklist" className="send-checklist" />
          <div className="delivery-options">
            <FieldGroup><Field>
              <FieldLabel htmlFor="delayMs">Pause between emails</FieldLabel>
              <NativeSelect id="delayMs" defaultValue="1200">
                <NativeSelectOption value="1200">1.2 seconds</NativeSelectOption>
                <NativeSelectOption value="2500">2.5 seconds</NativeSelectOption>
                <NativeSelectOption value="5000">5 seconds</NativeSelectOption>
              </NativeSelect>
            </Field></FieldGroup>
          </div>
        </CardContent>
        <CardFooter className="campaign-send-footer">
          <Button id="sendButton" type="button"><Send data-icon="inline-start" /><span id="sendButtonLabel">Send campaign</span></Button>
          <span id="sendAvailabilityNote" className="delivery-note">One personalized email per recipient.</span>
        </CardFooter>
      </Card>
    </div>
    <section id="sendProgress" className="send-progress" hidden aria-label="Sending progress">
      <div className="progress-heading"><strong id="sendProgressTitle" /><Button id="stopSendButton" type="button" variant="destructive" disabled hidden>Stop sending</Button></div>
      <progress id="sendProgressBar" max="1" value="0" />
      <p id="sendProgressCounts" /><p id="sendProgressDetail" role="status" aria-live="polite" />
    </section>
    <section className="send-log"><div className="preview-head"><strong>Delivery log</strong><Button id="clearLogsButton" type="button" variant="ghost" size="sm">Clear</Button></div><pre id="smtpLogs">No delivery details recorded in this session.</pre></section>
  </>;
}

function EditableTitle({name, kind, editable = true, children}: {
  name: string; kind: 'group' | 'mail'; editable?: boolean; children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  return <div className="title-controls">
    <div className="title-field">
      <div className={editing ? 'invisible' : undefined}>{children}</div>
      {editing && <Input
      key={name}
      autoFocus
      className={`title-name-input ${kind === 'mail' ? 'campaign-title-picker' : 'list-title-picker'}`}
      aria-label={`${kind === 'mail' ? 'Mail' : 'Group'} title`}
      defaultValue={name}
      onFocus={event => event.currentTarget.select()}
      onBlur={event => {
        setEditing(false);
        const title = event.currentTarget.value.trim();
        if (title && title !== name) document.dispatchEvent(new CustomEvent(
          kind === 'mail' ? 'mailbot:rename-draft' : 'mailbot:rename-group',
          {detail:{name:title}}
        ));
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') event.currentTarget.value = name;
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          event.currentTarget.blur();
          requestAnimationFrame(() => pencil.current?.focus());
        }
      }}
      />}
    </div>
    <Button ref={pencil} type="button" variant="outline" size="icon" className="title-edit-button" aria-label={`Rename ${kind}`} title={`Rename ${kind}`} disabled={!editable || editing} onClick={() => setEditing(true)}><Pencil /></Button>
  </div>;
}

function AudienceMenu() {
  const [title, setTitle] = useState('Choose a group');
  const [hasAudience, setHasAudience] = useState(false);
  useEffect(() => {
    const sync = (event: Event) => {
      const {tableName, hasAudience} = (event as CustomEvent).detail;
      setTitle(tableName);
      setHasAudience(hasAudience);
    };
    document.addEventListener('mailbot:campaign-state', sync);
    return () => document.removeEventListener('mailbot:campaign-state', sync);
  }, []);
  const [lists, setLists] = useState<Record<string, { recipients: unknown[] }>>({});
  const refresh = () => {
    try { setLists(JSON.parse(localStorage.getItem('club-mailbot.tables.v1') || '{}')); } catch { setLists({}); }
  };
  useEffect(() => {
    refresh();
    document.addEventListener('mailbot:lists-changed', refresh);
    return () => document.removeEventListener('mailbot:lists-changed', refresh);
  }, []);
  const source = (source: string) => setTimeout(() => document.dispatchEvent(new CustomEvent('mailbot:open-audience', { detail: { source } })), 0);
  return <EditableTitle name={title} kind="group" editable={hasAudience}><DropdownMenu onOpenChange={open => open && refresh()}>
    <DropdownMenuTrigger asChild><Button id="changeRecipients" className="list-title-picker" variant="outline" type="button" aria-label={title} title={title}><span>{title}</span><ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="audience-menu">
      <DropdownMenuGroup className="audience-menu-lists">
        {namesByLastSaved(lists).map(name =>
          <DropdownMenuItem key={name} onSelect={() => document.dispatchEvent(new CustomEvent('mailbot:use-saved-list', { detail: { name } }))}>
            <span className="audience-menu-name">{name}</span><span className="audience-menu-count">{lists[name].recipients.length}</span>
          </DropdownMenuItem>)}
      </DropdownMenuGroup>
      {Object.keys(lists).length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => source('notion')}><Database />Browse Notion contacts</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => source('csv')}><FileUp />Import CSV or paste</DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu></EditableTitle>;
}

function RecipientTools() {
  const [canRefresh, setCanRefresh] = useState(false);
  const [customized, setCustomized] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const sync = (event: Event) => {
      const {canRefresh, audienceDetails} = (event as CustomEvent).detail;
      setCanRefresh(canRefresh);
      setCustomized(Boolean(audienceDetails?.customized));
    };
    const syncRefresh = (event: Event) => setRefreshing((event as CustomEvent).detail);
    document.addEventListener('mailbot:campaign-state', sync);
    document.addEventListener('mailbot:refreshing-audience', syncRefresh);
    return () => {
      document.removeEventListener('mailbot:campaign-state', sync);
      document.removeEventListener('mailbot:refreshing-audience', syncRefresh);
    };
  }, []);
  const refresh = () => document.dispatchEvent(new CustomEvent('mailbot:refresh-audience'));
  return <div className="recipient-actions">
    <Button id="openSaveList" type="button" variant="outline" size="icon" aria-label="Save group" title="Save group"><Save /></Button>
    <Button id="refreshGroup" type="button" variant="outline" size="icon" aria-label="Refresh from Notion" title={canRefresh ? 'Refresh from Notion' : 'This group has no saved Notion filters'} aria-busy={refreshing} disabled={!canRefresh || refreshing} onClick={() => customized ? setConfirmRefresh(true) : refresh()}><RefreshCw /></Button>
    <Button id="clearButton" type="button" variant="outline" size="icon" aria-label="Clear current group" title="Clear current group"><Trash2 /></Button>
    <AlertDialog open={confirmRefresh} onOpenChange={setConfirmRefresh}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Refresh this group from Notion?</AlertDialogTitle><AlertDialogDescription>Refreshing reapplies the saved filters and replaces your local table changes.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={refresh}>Refresh group</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function ManualEditMarker() {
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    const sync = (event: Event) => setEdited(Boolean((event as CustomEvent).detail.audienceDetails?.customized));
    document.addEventListener('mailbot:campaign-state', sync);
    return () => document.removeEventListener('mailbot:campaign-state', sync);
  }, []);
  return edited ? <Badge variant="secondary">Manually Edited</Badge> : null;
}

type NotionField = {name:string; type:string; notionType?:string; options:string[]; choices?:{name:string;color:string}[]};
type Column = { key: string; label: string; role: string; readOnly?: boolean; notion?:NotionField };

function notionPageHref(value = '') {
  const target = value.trim();
  if (/^[a-f0-9]{32}$|^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target)) {
    return 'https://app.notion.com/p/' + target.replaceAll('-', '');
  }
  try {
    const url = new URL(target);
    if (url.protocol === 'https:' && ['app.notion.com', 'notion.so', 'www.notion.so'].includes(url.hostname) && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}

function RecipientTable() {
  const [data, setData] = useState<{columns:Column[];rows:Record<string,string>[];canAdd:boolean}>({
    columns: [{key:'name',label:'Name',role:'text'}, {key:'email',label:'Email',role:'to'}],
    rows: [],
    canAdd: true,
  });
  const [editing, setEditing] = useState<string|null>(null);
  const [adding, setAdding] = useState(false);
  const renaming = useRef(false);
  const [dragging, setDragging] = useState<string|null>(null);
  const [dropTarget, setDropTarget] = useState<string|null>(null);
  useEffect(() => {
    const update = (event: Event) => setData((event as CustomEvent).detail);
    document.addEventListener('mailbot:recipient-table', update);
    return () => document.removeEventListener('mailbot:recipient-table', update);
  }, []);

  function moveColumn(from: string, to: string) {
    document.dispatchEvent(new CustomEvent('mailbot:move-column', {detail:{from,to}}));
  }
  function endDrag() {
    setDragging(null);
    setDropTarget(null);
  }

  return <div className="table-wrap recipient-grid" tabIndex={0} aria-label="Recipient table"><table>
    <thead id="recipientHead"><tr>{data.columns.map((column,index) => <th
      key={column.key}
      scope="col"
      draggable={editing !== column.key}
      data-dragging={dragging === column.key || undefined}
      data-drop-side={dropTarget === column.key ? (data.columns.findIndex(item => item.key === dragging) < index ? 'after' : 'before') : undefined}
      onDragStart={event => {
        if ((event.target as HTMLElement).closest('button, input')) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', column.key);
        setDragging(column.key);
      }}
      onDragOver={event => {
        if (!dragging) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(dragging === column.key ? null : column.key);
      }}
      onDrop={event => {
        if (!dragging) return;
        event.preventDefault();
        moveColumn(dragging, column.key);
        endDrag();
      }}
      onDragEnd={endDrag}
    >
      <div className="column-heading">
        {editing === column.key
          ? <Input
              autoFocus
              className="column-name-input"
              defaultValue={column.label}
              aria-label={`Column name ${column.label}`}
              onBlur={event => {
                document.dispatchEvent(new CustomEvent('mailbot:rename-column', {detail:{index,label:event.target.value}}));
                setEditing(null);
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') event.currentTarget.value = column.label;
                if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
              }}
            />
          : <>
              <span>{column.label}</span>
              {!column.readOnly && <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" className="column-menu-trigger" variant="ghost" size="icon-sm" aria-label={`Options for ${column.label}`}><Ellipsis /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onCloseAutoFocus={event => {
                  if (renaming.current) { event.preventDefault(); renaming.current = false; }
                }}>
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => { renaming.current = true; setEditing(column.key); }}><Pencil />Rename</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => document.dispatchEvent(new CustomEvent('mailbot:delete-column', {detail:{index}}))}><X />Delete</DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>}
            </>}
      </div>
    </th>)}<th className="grid-tools-column">{adding
      ? <Input autoFocus className="column-name-input" placeholder="Column name" aria-label="New column name" onBlur={event => {
          const label = event.target.value.trim();
          if (label) document.dispatchEvent(new CustomEvent('mailbot:add-column',{detail:{label}}));
          setAdding(false);
        }} onKeyDown={event => {
          if (event.key === 'Escape') event.currentTarget.value = '';
          if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
        }} />
      : <Button variant="ghost" size="icon-sm" type="button" aria-label="Add column" onClick={() => setAdding(true)}><Plus /></Button>}
    </th></tr></thead>
    <tbody id="recipientRows">{data.rows.length ? <tr className="add-person-row">{data.columns.map((column,index)=><td key={column.key}>{index===0?<Button id="gridAddPerson" type="button" variant="ghost" size="icon-sm" aria-label="Add person" onClick={()=>document.dispatchEvent(new CustomEvent('mailbot:add-person'))} disabled={!data.canAdd} title={data.canAdd?'Add a person':'Add contacts in Notion, then refresh this list.'}><Plus /></Button>:<span className="cell-placeholder" />}</td>)}<td /></tr>
      : <tr><td className="recipient-empty-cell" colSpan={data.columns.length+1}>
        <div className="recipient-empty-actions">
          <Button type="button" variant="outline" disabled={!data.canAdd} onClick={()=>document.dispatchEvent(new CustomEvent('mailbot:add-person'))}><Plus data-icon="inline-start" />Add manually</Button>
          <Button type="button" variant="outline" onClick={()=>document.dispatchEvent(new CustomEvent('mailbot:import-group'))}><Database data-icon="inline-start" />Import from Notion</Button>
        </div>
      </td></tr>}
      {data.rows.map((row,index)=><tr key={index}>{data.columns.map(column=><td key={column.key}><RecipientCell key={row[column.key]} column={column} index={index} value={row[column.key] ?? ''} /></td>)}<td className="row-tools"><Button type="button" variant="ghost" size="icon-sm" data-contact-details={index} aria-label={`Details for ${row.name || row.email || 'person'}`}><Info /></Button><Button type="button" variant="ghost" size="icon-sm" data-remove-row={index} aria-label={`Remove ${row.name || row.email || 'person'}`}><X /></Button></td></tr>)}
    </tbody></table></div>;
}

function RecipientCell({column, index, value}: {column:Column; index:number; value:string}) {
  const label = `${column.label}, row ${index+1}`;
  const field = column.notion;
  const change = (value:string) => document.dispatchEvent(new CustomEvent('mailbot:recipient-cell',{detail:{index,key:column.key,value}}));
  if (column.readOnly) return <NotionPageLink value={value} />;
  if (field?.type === 'multi_select') {
    return <RecipientMultiSelect field={field} label={label} value={value} change={change} />;
  }
  if (field && isChoiceField(field)) {
    return <RecipientSingleSelect field={field} label={label} value={value} change={change} />;
  }
  if (field?.type === 'checkbox') {
    return <input type="checkbox" aria-label={label} defaultChecked={value === 'true'} onChange={event=>change(String(event.currentTarget.checked))} />;
  }
  const type = field?.type === 'number' && (!value || Number.isFinite(Number(value))) ? 'number'
    : field?.notionType === 'date' && (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) ? 'date' : 'text';
  return <Input type={type} step={type === 'number' ? 'any' : undefined} defaultValue={value} data-row-index={index} data-column-key={column.key} aria-label={label} />;
}

function NotionChoicePill({field,value}: {field:NotionField;value:string}) {
  return <span className="notion-choice-pill" data-notion-color={notionOptionColor(field,value)}>{value}</span>;
}

function RecipientSingleSelect({field,label,value,change}: {field:NotionField;label:string;value:string;change:(value:string)=>void}) {
  const [selected,setSelected] = useState(value);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" className="recipient-multi-select" variant="outline" aria-label={label} title={selected}>
        {selected ? <NotionChoicePill field={field} value={selected} /> : <span>—</span>}<ChevronDown />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="recipient-choice-menu">
      <DropdownMenuRadioGroup value={selected} onValueChange={next=>{setSelected(next);change(next);}}>
        <DropdownMenuRadioItem value="">Clear value</DropdownMenuRadioItem>
        {selected && !field.options.includes(selected) && <DropdownMenuRadioItem value={selected} disabled><NotionChoicePill field={field} value={selected} /></DropdownMenuRadioItem>}
        {field.options.map(option=><DropdownMenuRadioItem key={option} value={option}><NotionChoicePill field={field} value={option} /></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function RecipientMultiSelect({field,label,value,change}: {field:NotionField;label:string;value:string;change:(value:string)=>void}) {
  const [selected, setSelected] = useState(() => choiceValues(value, field));
  const options = [...new Set([...field.options,...choiceValues(value,field)])];
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" className="recipient-multi-select" variant="outline" aria-label={label} title={selected.join(', ')}>
        <span className="recipient-choice-selection">{selected.length ? selected.map(option=><NotionChoicePill key={option} field={field} value={option} />) : '—'}</span><ChevronDown />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="recipient-choice-menu">
      {options.map(option=><DropdownMenuCheckboxItem key={option} checked={selected.includes(option)} onSelect={event=>event.preventDefault()} onCheckedChange={checked=>{
        const next = checked ? [...selected, option] : selected.filter(value=>value!==option);
        setSelected(next);
        change(next.join('; '));
      }}><NotionChoicePill field={field} value={option} /></DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function NotionPageLink({value}: {value?: string}) {
  const href = notionPageHref(value);
  return href ? <a className="notion-page-link" href={href} target="_blank" rel="noreferrer">Open page <ExternalLink aria-hidden="true" /></a> : <span className="muted">—</span>;
}

function MessageSenderFields() {
  return <FieldGroup className="message-sender-fields">
    <Field><FieldLabel htmlFor="fromName">Sender name</FieldLabel><Input id="fromName" defaultValue="Social AI Club" /></Field>
    <Field><FieldLabel htmlFor="replyTo">Reply-to email</FieldLabel><Input id="replyTo" type="email" placeholder="Optional" /></Field>
  </FieldGroup>;
}

function CampaignMenu() {
  const [name,setName]=useState('Choose a mail');
  const [drafts,setDrafts]=useState<Record<string,unknown>>({});
  const [remove,setRemove]=useState<string|null>(null);
  const refresh=()=>{try{setDrafts(JSON.parse(localStorage.getItem('club-mailbot.drafts.v1') || '{}'));}catch{setDrafts({});}};
  useEffect(()=>{const update=(event:Event)=>setName((event as CustomEvent).detail.draftName);document.addEventListener('mailbot:campaign-state',update);return()=>document.removeEventListener('mailbot:campaign-state',update);},[]);
  return <><EditableTitle name={name} kind="mail"><DropdownMenu onOpenChange={open=>open&&refresh()}>
    <h1 className="campaign-heading-title"><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="campaign-title-picker" aria-label={name} title={name}><span>{name}</span><ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger></h1>
    <DropdownMenuContent align="start" className="campaign-menu">
      <DropdownMenuGroup className="campaign-menu-list">
        {namesByLastSaved(drafts).map(key=><div className="draft-menu-row" key={key}><DropdownMenuItem onSelect={()=>document.dispatchEvent(new CustomEvent('mailbot:select-draft',{detail:{name:key}}))}><span>{key}</span></DropdownMenuItem><Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete draft ${key}`} onClick={()=>setRemove(key)}><X /></Button></div>)}
      </DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup className="campaign-file-actions"><DropdownMenuItem onSelect={()=>document.getElementById('importDraftButton')?.click()}><FileUp />Import draft</DropdownMenuItem><DropdownMenuItem onSelect={()=>document.getElementById('exportDraftButton')?.click()}><FileDown />Export draft</DropdownMenuItem></DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu></EditableTitle><AlertDialog open={!!remove} onOpenChange={open=>!open&&setRemove(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this draft?</AlertDialogTitle><AlertDialogDescription>{remove}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={()=>{document.dispatchEvent(new CustomEvent('mailbot:delete-draft',{detail:{name:remove}}));setRemove(null);refresh();}}>Delete draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}

function EditorToolbar() {
  return <>
    <NativeSelect className="editor-font-family" id="editorFont" aria-label="Font" defaultValue="Albert Sans">
      <NativeSelectOption value="Albert Sans">Albert Sans</NativeSelectOption>
      <NativeSelectOption value="League Spartan">League Spartan</NativeSelectOption>
    </NativeSelect>
    <NativeSelect className="editor-font-weight" id="editorFontWeight" aria-label="Font weight" defaultValue="400">
      {['Thin','Extra light','Light','Regular','Medium','Semibold','Bold','Extra bold','Black'].map((label, index) =>
        <NativeSelectOption value={(index + 1) * 100} key={label}>{label}</NativeSelectOption>)}
    </NativeSelect>
    <div className="editor-control-group" role="group" aria-label="Font size">
      <Input id="editorFontSize" type="number" min="1" max="200" defaultValue="16" aria-label="Font size in pixels" />
      <Button type="button" id="editorSizeDown" variant="outline" size="icon" aria-label="Smaller text" title="Smaller text">A</Button>
      <Button type="button" id="editorSizeUp" variant="outline" size="icon" aria-label="Larger text" title="Larger text">A</Button>
    </div>
    <div className="editor-control-group" role="group" aria-label="Text formatting">
      <Button type="button" variant="outline" size="icon" data-format="bold" aria-label="Bold" aria-pressed={false} title="Bold"><Bold /></Button>
      <Button type="button" variant="outline" size="icon" data-format="italic" aria-label="Italic" aria-pressed={false} title="Italic"><Italic /></Button>
      <Button type="button" variant="outline" size="icon" data-format="underline" aria-label="Underline" aria-pressed={false} title="Underline"><Underline /></Button>
      <Button type="button" variant="outline" data-format="formatBlock" data-value="p" aria-pressed={false}>Body</Button>
      <Button type="button" variant="outline" data-format="formatBlock" data-value="h2" aria-pressed={false}>Heading</Button>
      <Button type="button" variant="outline" size="icon" data-format="insertUnorderedList" aria-label="Bulleted list" aria-pressed={false} title="Bulleted list"><List /></Button>
    </div>
    <div className="editor-control-group editor-insert-controls" role="group" aria-label="Insert content">
      <Button type="button" variant="outline" size="icon" id="insertLink" aria-label="Insert link" title="Insert link"><Link /></Button>
      <Button type="button" variant="outline" id="insertButton">Add Button</Button>
      <Button type="button" variant="outline" id="insertDivider" title="Insert horizontal divider">Divider</Button>
      <details className="variable-menu">
        <summary>Insert Personalization<ChevronDown aria-hidden="true" /></summary>
        <div id="editorVariables" className="variable-chips" />
      </details>
    </div>
  </>;
}

type SendRequest = { count: number; sender: string; subject: string; resolve: (value: boolean) => void };
function SendConfirmation() {
  const [request, setRequest] = useState<SendRequest | null>(null);
  useEffect(() => {
    const handler = (event: Event) => setRequest((event as CustomEvent<SendRequest>).detail);
    document.addEventListener('mailbot:confirm-send', handler);
    return () => document.removeEventListener('mailbot:confirm-send', handler);
  }, []);
  const finish = (accepted: boolean) => { request?.resolve(accepted); setRequest(null); };
  return <AlertDialog open={!!request} onOpenChange={open => !open && finish(false)}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Send to {request?.count} recipients?</AlertDialogTitle>
        <AlertDialogDescription>Each recipient will receive their own personalized email from {request?.sender}.</AlertDialogDescription>
      </AlertDialogHeader>
      <p className="confirmation-subject">{request?.subject}</p>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={() => finish(false)}>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={() => finish(true)}>Send campaign<ArrowRight data-icon="inline-end" /></AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

for (const [id, component] of [
  ['messageSenderFields', <MessageSenderFields />],
  ['previewRecipientControl', <NativeSelect id="previewSelect" aria-label="Preview recipient" />],
  ['campaignMenu', <CampaignMenu />], ['newCampaignAction', <Button id="newDraft" type="button" variant="outline"><Plus data-icon="inline-start" />New mail</Button>], ['recipientTable', <RecipientTable />], ['formatToolbar', <EditorToolbar />],
  ['campaignFlow', <CampaignFlow />], ['previewTools', <PreviewTools />],
  ['deliveryControls', <SendControls />], ['audienceMenu', <AudienceMenu />],
  ['recipientTools', <RecipientTools />], ['manualEditMarker', <ManualEditMarker />],
  ['newGroupAction', <Button id="newRecipientList" type="button" variant="outline"><Plus data-icon="inline-start" />New group</Button>],
  ['sendConfirmation', <SendConfirmation />],
] as const) {
  const mount = document.getElementById(id);
  if (mount) flushSync(() => createRoot(mount).render(component));
}
document.documentElement.dataset.studioReady = 'true';
await import('/app.js');
initStyledSelects();
