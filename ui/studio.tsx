import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ArrowRight, ChevronDown, Database, FileUp, FileDown, Mail, Send, Plus, X, Pencil, Info, Trash2, Bold, Italic, List, Link, Minus, AArrowDown, AArrowUp } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@/ui/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/ui/components/ui/field';
import { Input } from '@/ui/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/ui/components/ui/native-select';
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/ui/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from '@/ui/components/ui/dropdown-menu';

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

function AudienceMenu() {
  const [title, setTitle] = useState('Choose a list');
  const [canRefresh,setCanRefresh] = useState(false);
  useEffect(() => { const sync = (event: Event) => { const detail=(event as CustomEvent).detail;setTitle(detail.tableName || 'Choose a list');setCanRefresh(!!detail.canRefresh); }; document.addEventListener('mailbot:campaign-state', sync); return () => document.removeEventListener('mailbot:campaign-state', sync); }, []);
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
  return <DropdownMenu onOpenChange={open => open && refresh()}>
    <DropdownMenuTrigger asChild><Button id="changeRecipients" className="list-title-picker" variant="ghost" type="button" aria-label={title} title={title}><span>{title}</span><ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="audience-menu">
      <DropdownMenuGroup className="audience-menu-lists">
        {Object.entries(lists).sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) =>
          <DropdownMenuItem key={name} onSelect={() => document.dispatchEvent(new CustomEvent('mailbot:use-saved-list', { detail: { name } }))}>
            <span className="audience-menu-name">{name}</span><span className="audience-menu-count">{list.recipients.length}</span>
          </DropdownMenuItem>)}
      </DropdownMenuGroup>
      {Object.keys(lists).length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        {canRefresh && <DropdownMenuItem onSelect={()=>document.getElementById('refreshAudience')?.click()}><Database />Refresh from Notion</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => source('notion')}><Database />Browse Notion contacts</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => source('csv')}><FileUp />Import CSV or paste</DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function RecipientTools() {
  return <div className="recipient-actions">
    <Button id="newRecipientList" type="button" variant="ghost"><Plus data-icon="inline-start" />New list</Button>
    <Button id="openSaveList" type="button" variant="outline">Save list</Button>
    <Button id="clearButton" type="button" variant="ghost" size="icon-sm" aria-label="Clear current list" title="Clear current list"><Trash2 /></Button>
  </div>;
}

type Column = {key:string; label:string; role:string};
function RecipientTable() {
  const [data, setData] = useState<{columns:Column[];rows:Record<string,string>[];canAdd:boolean}>({columns:[{key:"name",label:"Name",role:"text"},{key:"email",label:"Email",role:"to"}],rows:[],canAdd:true});
  const [editing, setEditing] = useState<string|null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const update = (e:Event) => setData((e as CustomEvent).detail);
    document.addEventListener('mailbot:recipient-table',update);
    return () => document.removeEventListener('mailbot:recipient-table',update);
  },[]);
  const addColumn = (value:string) => { if(value.trim()) document.dispatchEvent(new CustomEvent('mailbot:add-column',{detail:{label:value}})); setAdding(false); };
  return <div className="table-wrap recipient-grid" tabIndex={0} aria-label="Recipient table"><table>
    <thead id="recipientHead"><tr>{data.columns.map((column,index)=><th key={column.key}>
      <div className="column-heading">{editing===column.key
        ? <Input autoFocus defaultValue={column.label} aria-label={`Column name ${column.label}`} onBlur={event=>{document.dispatchEvent(new CustomEvent('mailbot:rename-column',{detail:{index,label:event.target.value}}));setEditing(null);}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape') {event.currentTarget.value=column.label;event.currentTarget.blur();}}} />
        : <><span>{column.label}</span><Button type="button" variant="ghost" size="icon-sm" aria-label={`Rename ${column.label} column`} onClick={()=>setEditing(column.key)}><Pencil /></Button></>}
        <Button type="button" variant="ghost" size="icon-sm" data-delete-column={index} aria-label={`Delete ${column.label} column`}><X /></Button>
      </div>
    </th>)}<th className="grid-tools-column">{adding?<Input autoFocus placeholder="Column name" aria-label="New column name" onBlur={e=>addColumn(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){e.currentTarget.value='';e.currentTarget.blur();}}} />:<Button variant="ghost" size="icon-sm" type="button" aria-label="Add column" onClick={()=>setAdding(true)}><Plus /></Button>}</th></tr></thead>
    <tbody id="recipientRows"><tr className="add-person-row">{data.columns.map((column,index)=><td key={column.key}>{index===0?<Button id="gridAddPerson" type="button" variant="ghost" size="icon-sm" aria-label="Add person" onClick={()=>document.dispatchEvent(new CustomEvent('mailbot:add-person'))} disabled={!data.canAdd} title={data.canAdd?'Add a person':'Add contacts in Notion, then refresh this list.'}><Plus /></Button>:<span className="cell-placeholder" />}</td>)}<td /></tr>
      {data.rows.map((row,index)=><tr key={index}>{data.columns.map(column=><td key={column.key}><Input key={row[column.key]+':'+column.key} defaultValue={row[column.key] || ''} data-row-index={index} data-column-key={column.key} aria-label={`${column.label}, row ${index+1}`} /></td>)}<td className="row-tools"><Button type="button" variant="ghost" size="icon-sm" data-contact-details={index} aria-label={`Details for ${row.name || row.email || 'person'}`}><Info /></Button><Button type="button" variant="ghost" size="icon-sm" data-remove-row={index} aria-label={`Remove ${row.name || row.email || 'person'}`}><X /></Button></td></tr>)}
    </tbody></table></div>;
}

function CampaignMenu() {
  const [name,setName]=useState('Choose a mail');
  const [drafts,setDrafts]=useState<Record<string,unknown>>({});
  const [title,setTitle]=useState('');
  const [remove,setRemove]=useState<string|null>(null);
  const refresh=()=>{try{setDrafts(JSON.parse(localStorage.getItem('club-mailbot.drafts.v1') || '{}'));}catch{setDrafts({});}};
  useEffect(()=>{const update=(event:Event)=>{const current=(event as CustomEvent).detail.draftName;setName(current);setTitle(current);};document.addEventListener('mailbot:campaign-state',update);return()=>document.removeEventListener('mailbot:campaign-state',update);},[]);
  const rename=()=>{if(title.trim()&&title.trim()!==name){document.dispatchEvent(new CustomEvent('mailbot:rename-draft',{detail:{name:title.trim()}}));refresh();}};
  return <><DropdownMenu onOpenChange={open=>{if(open){refresh();setTitle(name);}}}>
    <h1 className="campaign-heading-title"><DropdownMenuTrigger asChild><Button type="button" variant="ghost" className="campaign-title-picker" aria-label={name} title={name}><span>{name}</span><ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger></h1>
    <DropdownMenuContent align="start" className="campaign-menu">
      <Field className="picker-name-field"><FieldLabel htmlFor="renameMail">Mail title</FieldLabel><Input id="renameMail" value={title} onChange={e=>setTitle(e.target.value)} onBlur={rename} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){rename();e.currentTarget.blur();}}} /></Field>
      <DropdownMenuSeparator /><DropdownMenuGroup className="campaign-menu-list">
        {Object.keys(drafts).sort((a,b)=>a.localeCompare(b)).map(key=><div className="draft-menu-row" key={key}><DropdownMenuItem onSelect={()=>document.dispatchEvent(new CustomEvent('mailbot:select-draft',{detail:{name:key}}))}><span>{key}</span></DropdownMenuItem><Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete draft ${key}`} onClick={()=>setRemove(key)}><X /></Button></div>)}
      </DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup className="campaign-file-actions"><DropdownMenuItem onSelect={()=>document.getElementById('importDraftButton')?.click()}><FileUp />Import draft</DropdownMenuItem><DropdownMenuItem onSelect={()=>document.getElementById('exportDraftButton')?.click()}><FileDown />Export draft</DropdownMenuItem></DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu><AlertDialog open={!!remove} onOpenChange={open=>!open&&setRemove(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this draft?</AlertDialogTitle><AlertDialogDescription>{remove}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={()=>{document.dispatchEvent(new CustomEvent('mailbot:delete-draft',{detail:{name:remove}}));setRemove(null);refresh();}}>Delete draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}

function EditorToolbar() {
  return <>
    <NativeSelect id="editorFont" aria-label="Font" defaultValue="Albert Sans"><NativeSelectOption value="Albert Sans">Albert Sans</NativeSelectOption><NativeSelectOption value="League Spartan">League Spartan</NativeSelectOption></NativeSelect>
    <NativeSelect id="editorFontWeight" aria-label="Font weight" defaultValue="400">{[100,200,300,400,500,600,700,800,900].map((w,i)=><NativeSelectOption value={w} key={w}>{['Thin','Extra light','Light','Regular','Medium','Semibold','Bold','Extra bold','Black'][i]}</NativeSelectOption>)}</NativeSelect>
    <div className="font-size-control"><Button type="button" id="editorSizeDown" variant="ghost" size="icon-sm" aria-label="Smaller text"><AArrowDown /></Button><Input id="editorFontSize" type="number" min="1" max="200" defaultValue="16" aria-label="Font size in pixels" /><Button type="button" id="editorSizeUp" variant="ghost" size="icon-sm" aria-label="Larger text"><AArrowUp /></Button></div>
    <span className="toolbar-divider" />
    <Button type="button" variant="ghost" size="icon-sm" data-format="bold" aria-label="Bold"><Bold /></Button><Button type="button" variant="ghost" size="icon-sm" data-format="italic" aria-label="Italic"><Italic /></Button><Button type="button" variant="ghost" size="sm" data-format="formatBlock" data-value="h2">Heading</Button><Button type="button" variant="ghost" size="sm" data-format="formatBlock" data-value="p">Text</Button><Button type="button" variant="ghost" size="icon-sm" data-format="insertUnorderedList" aria-label="Bulleted list"><List /></Button>
    <span className="toolbar-divider" /><Button type="button" variant="ghost" size="icon-sm" id="insertLink" aria-label="Insert link"><Link /></Button><Button type="button" variant="ghost" size="sm" id="insertButton"><Plus data-icon="inline-start" />Button</Button><Button type="button" variant="ghost" size="icon-sm" id="insertDivider" aria-label="Insert divider"><Minus /></Button>
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
  ['previewRecipientControl', <NativeSelect id="previewSelect" aria-label="Preview recipient" />],
  ['campaignMenu', <CampaignMenu />], ['newCampaignAction', <Button id="newDraft" type="button" variant="outline"><Plus data-icon="inline-start" />New mail</Button>], ['recipientTable', <RecipientTable />], ['formatToolbar', <EditorToolbar />],
  ['campaignFlow', <CampaignFlow />], ['previewTools', <PreviewTools />],
  ['deliveryControls', <SendControls />], ['audienceMenu', <AudienceMenu />],
  ['recipientTools', <RecipientTools />],
  ['sendConfirmation', <SendConfirmation />],
] as const) {
  const mount = document.getElementById(id);
  if (mount) flushSync(() => createRoot(mount).render(component));
}
document.documentElement.dataset.studioReady = 'true';
await import('/app.js');
