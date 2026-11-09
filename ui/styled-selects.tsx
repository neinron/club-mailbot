import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Select } from 'radix-ui';
import { AtSign, Calendar, Check, ChevronDown, CircleChevronDown, CircleDot, Hash, Link2, List, Phone, SquareCheck, Type, Users } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';

const propertyIcons={
  text:Type, rich_text:Type, title:Type, select:CircleChevronDown, multi_select:List,
  status:CircleDot, checkbox:SquareCheck, number:Hash, date:Calendar,
  created_time:Calendar, last_edited_time:Calendar, email:AtSign, url:Link2,
  phone_number:Phone, people:Users, person:Users, relation:Link2
};

function OptionLabel({option}: {option?:HTMLOptionElement}) {
  const type=option?.dataset.propertyType;
  const Icon=type && Object.hasOwn(propertyIcons,type) ? propertyIcons[type as keyof typeof propertyIcons] : type ? Type : null;
  return <span className="styled-select-label">{Icon && <Icon aria-hidden="true" />}<span>{option?.label || 'Choose…'}</span></span>;
}

function SelectPicker({select, label, focusOnMount}: {select:HTMLSelectElement;label:string;focusOnMount:boolean}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const options = Array.from(select.options);
  const selected = select.selectedIndex;
  useLayoutEffect(() => {
    if(focusOnMount)trigger.current?.focus();
  }, [focusOnMount]);
  return <Select.Root value={selected<0?'':String(selected)} disabled={select.matches(':disabled') || !options.length} onValueChange={value=>{
    select.selectedIndex=Number(value);
    select.dispatchEvent(new Event('input',{bubbles:true}));
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }}>
    <Select.Trigger asChild>
      <Button ref={trigger} type="button" variant="outline" className="styled-select-trigger" aria-label={label} title={options[selected]?.label}>
        <OptionLabel option={options[selected]} /><Select.Icon asChild><ChevronDown /></Select.Icon>
      </Button>
    </Select.Trigger>
    <Select.Portal container={select.closest('dialog') || undefined}>
      <Select.Content position="popper" sideOffset={5} collisionPadding={10} className="styled-select-menu">
        <Select.Viewport>
          {options.map((option,index)=><Select.Item
            key={index}
            value={String(index)}
            disabled={option.disabled || Boolean(option.closest('optgroup')?.disabled)}
            className="styled-select-option"
            title={option.label}
          >
            <Select.ItemText className="styled-select-option-text"><OptionLabel option={option} /></Select.ItemText>
            <Select.ItemIndicator asChild><Check /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}

// Keep the original controls available to the draft and filter logic.
export function initStyledSelects() {
  const controls = new Map<HTMLSelectElement,{sync:(force?:boolean)=>void;dispose:()=>void}>();
  function attach(select:HTMLSelectElement) {
    const existing=controls.get(select);
    if(existing){existing.sync();return;}
    if(select.multiple || select.size>1 || select.closest('.styled-select'))return;
    const label=select.getAttribute('aria-label') || Array.from(select.labels || [], label=>{
      const copy=label.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('select').forEach(element=>element.remove());
      return copy.textContent?.trim();
    }).filter(Boolean).join(' ');
    const mount=document.createElement('span');
    mount.className='styled-select';
    if(select.dataset.action)mount.dataset.selectAction=select.dataset.action;
    const focusOnMount=document.activeElement===select;
    select.hidden=true;
    select.after(mount);
    const root=createRoot(mount);
    let lastState='';
    let lastDialog:HTMLDialogElement|null=null;
    function sync(force=false) {
      const state=`${select.selectedIndex}:${select.matches(':disabled')}`;
      const dialog=select.closest('dialog');
      if(!force && state===lastState && dialog===lastDialog)return;
      lastState=state;
      lastDialog=dialog;
      root.render(<SelectPicker select={select} label={label || 'Select value'} focusOnMount={focusOnMount} />);
    }
    const onChange=()=>sync();
    select.addEventListener('change',onChange);
    controls.set(select,{sync,dispose:()=>{
      select.removeEventListener('change',onChange);
      root.unmount();
      mount.remove();
    }});
    sync(true);
  }

  document.querySelectorAll('select').forEach(attach);
  const syncAll=()=>controls.forEach(control=>control.sync());
  for(const event of ['mailbot:campaign-state','mailbot:lists-changed','mailbot:select-sync'])document.addEventListener(event,syncAll);
  new MutationObserver(records=>{
    for(const {target,addedNodes} of records){
      const element=target instanceof Element?target:target.parentElement;
      const select=element?.closest('select');
      if(select)controls.get(select)?.sync(true);
      if(element?.matches('fieldset'))element.querySelectorAll('select').forEach(select=>controls.get(select)?.sync());
      for(const node of addedNodes){
        if(node instanceof HTMLSelectElement)attach(node);
        else if(node instanceof Element)node.querySelectorAll('select').forEach(attach);
      }
    }
    for(const [select,control] of controls){
      if(select.isConnected)continue;
      controls.delete(select);
      control.dispose();
    }
  }).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','selected','label']});
}
